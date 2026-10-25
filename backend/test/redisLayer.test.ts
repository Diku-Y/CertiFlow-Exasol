import { MemoryRedis } from "./helpers";
import test from "node:test";
import assert from "node:assert/strict";
import { setRedisForTests } from "../src/services/redis/client";
import { acquireLock, bumpEpoch, cached, getEpoch, rateLimitHit, releaseLock, tryLock, unlockIfOwner } from "../src/services/redis/primitives";
import { createSession, isSessionActive, listSessions, revokeAllSessions, revokeSession } from "../src/services/redis/sessions";
import * as store from "../src/services/redis/behavior";
import { emptyProfile, applyToProfile } from "../src/services/featureEngine";
import { addClient, initEvents, publishEvent } from "../src/services/redis/events";

const redis = new MemoryRedis();
test.before(() => setRedisForTests(redis));

test("rate limiter allows up to max then blocks, and reports retry-after", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await rateLimitHit("t", "ip1", 60, 3));
    assert.deepEqual(results.map(r => r.allowed), [true, true, true, false, false]);
    assert.equal(results[0].remaining, 2);
    assert.ok(results[3].retryAfter > 0 && results[3].retryAfter <= 60);
    assert.equal((await rateLimitHit("t", "ip2", 60, 3)).allowed, true, "different key has its own window");
});

test("rate limiter falls back to an in-process window when Redis is down", async () => {
    setRedisForTests(null);
    const a = await rateLimitHit("fallback", "x", 60, 2), b = await rateLimitHit("fallback", "x", 60, 2), c = await rateLimitHit("fallback", "x", 60, 2);
    assert.deepEqual([a.allowed, b.allowed, c.allowed], [true, true, false]);
    setRedisForTests(redis);
});

test("distributed lock is exclusive, expires, and is only released by its owner", async () => {
    const first = await acquireLock("acct:1", 5000, 0);
    assert.ok(first && first !== "unprotected");
    assert.equal(await acquireLock("acct:1", 5000, 100), null, "second caller cannot acquire while held");
    await releaseLock({ key: (first as any).key, token: "wrong-token" });
    assert.equal(await acquireLock("acct:1", 5000, 0), null, "wrong token must not release the lock");
    await releaseLock(first);
    const again = await acquireLock("acct:1", 5000, 0);
    assert.ok(again && again !== "unprotected");
    await releaseLock(again);
    setRedisForTests(null);
    assert.equal(await acquireLock("acct:9"), "unprotected", "Redis down -> unprotected, not an error");
    setRedisForTests(redis);
});

test("alert claim lock: second analyst is refused until the first releases", async () => {
    assert.deepEqual(await tryLock("alert:5", "1", 60000), { acquired: true, owner: "1" });
    assert.deepEqual(await tryLock("alert:5", "1", 60000), { acquired: true, owner: "1" }, "same analyst keeps it");
    assert.deepEqual(await tryLock("alert:5", "2", 60000), { acquired: false, owner: "1" });
    await unlockIfOwner("alert:5", "2");
    assert.equal((await tryLock("alert:5", "2", 60000)).acquired, false, "non-owner cannot unlock");
    await unlockIfOwner("alert:5", "1");
    assert.equal((await tryLock("alert:5", "2", 60000)).acquired, true);
});

test("cache returns stored value until the epoch is bumped", async () => {
    let loads = 0;
    const load = async () => ({ n: ++loads });
    const key = async () => `cf:cache:test:${await getEpoch("cust:1")}`;
    assert.deepEqual(await cached(await key(), 30, load), { n: 1 });
    assert.deepEqual(await cached(await key(), 30, load), { n: 1 }, "cache hit");
    await bumpEpoch("cust:1");
    assert.deepEqual(await cached(await key(), 30, load), { n: 2 }, "new epoch -> reload");
});

test("sessions: create, validate, revoke one, revoke all but current", async () => {
    for (const jti of ["a", "b", "c"]) await createSession({ jti, uid: 7, role: "USER", ip: "1.1.1.1", userAgent: "t", deviceId: "d", createdAt: new Date().toISOString() }, 3600);
    assert.equal(await isSessionActive("a"), true);
    await revokeSession(7, "a");
    assert.equal(await isSessionActive("a"), false);
    assert.equal((await listSessions(7)).length, 2);
    assert.equal(await revokeAllSessions(7, "b"), 1);
    assert.equal(await isSessionActive("b"), true);
    assert.equal(await isSessionActive("c"), false);
    setRedisForTests(null);
    assert.equal(await isSessionActive("b"), null, "Redis down -> null so auth falls back to MongoDB");
    setRedisForTests(redis);
});

test("behaviour store: profile round-trip, attempts window and recipient fan-in", async () => {
    const p = applyToProfile(emptyProfile(), { amount: 500, hour: 10, device: "d", location: "Chennai", recipient: "r", category: "Food" });
    await store.writeProfile(1, p);
    assert.deepEqual(await store.readProfile(1), p);
    assert.equal(await store.readProfile(2), null);

    const now = Date.now();
    assert.equal(await store.readAttempts(1, now), null, "no data yet -> caller rebuilds from MongoDB");
    await store.seedAttempts(1, []);
    assert.deepEqual(await store.readAttempts(1, now), [], "seeded empty is distinguishable from missing");
    await store.pushAttempt(1, { ts: now / 1000 - 30, amount: 100, status: "F" });
    await store.pushAttempt(1, { ts: now / 1000 - 8 * 86400, amount: 5, status: "C" });
    const attempts = (await store.readAttempts(1, now))!;
    assert.equal(attempts.length, 1, "attempts older than 7 days are not returned");
    assert.equal(attempts[0].status, "F");

    await store.pushFanIn("acc-mule", 10, now);
    await store.pushFanIn("acc-mule", 11, now - 1000);
    await store.pushFanIn("acc-mule", 12, now - 2 * 86400000);
    assert.equal(await store.fanInCount("acc-mule", 99, now), 2, "distinct senders in last 24h, excluding old ones");
    assert.equal(await store.fanInCount("acc-mule", 10, now), 1, "excludes the sender itself");
});

test("events: published events reach only the right SSE clients", async () => {
    await initEvents();
    const written: Record<string, string[]> = { staff: [], user5: [], user6: [] };
    const fake = (k: string) => ({ write: (s: string) => { written[k].push(s); return true; } }) as any;
    const off = [addClient(1, "ADMIN", fake("staff")), addClient(5, "USER", fake("user5")), addClient(6, "USER", fake("user6"))];
    await publishEvent({ audience: "staff", type: "alert.created", data: { id: 1 } });
    await publishEvent({ audience: "user:5", type: "balance", data: { b: 1 } });
    assert.equal(written.staff.length, 1);
    assert.equal(written.user5.length, 1);
    assert.equal(written.user6.length, 0);
    assert.match(written.user5[0], /^event: balance\ndata: /);
    off.forEach(f => f());
});
