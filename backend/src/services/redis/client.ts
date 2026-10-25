/**
 * Thin Redis adapter.
 *
 * Every Redis feature in CertiFlow talks to this `RedisOps` interface instead of node-redis
 * directly. That gives us three things: (1) one place that knows the node-redis API,
 * (2) a graceful "Redis is down" mode - getRedis() returns null and callers fall back to
 * MongoDB / in-process logic, (3) an in-memory implementation used by the unit tests.
 */
import { createClient } from "redis";
import { env } from "../../config/env";

export interface RedisOps {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSec?: number): Promise<void>;
    /** SET key value NX PX ttl - returns true when the key was created. */
    setNx(key: string, value: string, ttlMs: number): Promise<boolean>;
    del(...keys: string[]): Promise<number>;
    /** INCR + EXPIRE NX in one MULTI. Returns the counter and the remaining TTL in seconds. */
    incrWindow(key: string, ttlSec: number): Promise<{ count: number; ttl: number }>;
    incrBy(key: string, by: number): Promise<number>;
    expire(key: string, ttlSec: number): Promise<void>;
    zAdd(key: string, score: number, member: string): Promise<void>;
    zRemRangeByScore(key: string, min: number, max: number): Promise<void>;
    zRangeByScore(key: string, min: number, max: number): Promise<string[]>;
    zCard(key: string): Promise<number>;
    sAdd(key: string, member: string): Promise<void>;
    sRem(key: string, member: string): Promise<void>;
    sMembers(key: string): Promise<string[]>;
    publish(channel: string, message: string): Promise<void>;
    subscribe(channel: string, handler: (message: string) => void): Promise<void>;
    /** Compare-and-delete used to release locks safely. */
    delIfEquals(key: string, value: string): Promise<boolean>;
    scanCount(pattern: string, max?: number): Promise<number>;
    ping(): Promise<number>;
    info(): Promise<Record<string, string>>;
    dbSize(): Promise<number>;
    flushNamespace(prefix: string): Promise<number>;
}

const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

let ops: RedisOps | null = null;
let ready = false;
let lastError: string | null = null;

const parseInfo = (raw: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of raw.split("\r\n")) {
        const idx = line.indexOf(":");
        if (idx > 0 && !line.startsWith("#")) out[line.slice(0, idx)] = line.slice(idx + 1);
    }
    return out;
};

const wrap = (client: any): RedisOps => ({
    get: key => client.get(key),
    set: async (key, value, ttlSec) => {
        if (ttlSec) await client.set(key, value, { expiration: { type: "EX", value: ttlSec } });
        else await client.set(key, value);
    },
    setNx: async (key, value, ttlMs) =>
        (await client.set(key, value, { condition: "NX", expiration: { type: "PX", value: ttlMs } })) === "OK",
    del: async (...keys) => (keys.length ? client.del(keys) : 0),
    incrWindow: async (key, ttlSec) => {
        const [count, , ttl] = await client.multi().incr(key).expire(key, ttlSec, "NX").ttl(key).exec();
        return { count: Number(count), ttl: Number(ttl) };
    },
    incrBy: async (key, by) => Number(await client.incrBy(key, by)),
    expire: async (key, ttlSec) => { await client.expire(key, ttlSec); },
    zAdd: async (key, score, member) => { await client.zAdd(key, { score, value: member }); },
    zRemRangeByScore: async (key, min, max) => { await client.zRemRangeByScore(key, min, max); },
    zRangeByScore: (key, min, max) => client.zRangeByScore(key, min, max),
    zCard: async key => Number(await client.zCard(key)),
    sAdd: async (key, member) => { await client.sAdd(key, member); },
    sRem: async (key, member) => { await client.sRem(key, member); },
    sMembers: key => client.sMembers(key),
    publish: async (channel, message) => { await client.publish(channel, message); },
    subscribe: async (channel, handler) => {
        const sub = client.duplicate();
        sub.on("error", () => undefined);
        await sub.connect();
        await sub.subscribe(channel, (message: string) => handler(message));
    },
    delIfEquals: async (key, value) =>
        Number(await client.eval(RELEASE_LOCK, { keys: [key], arguments: [value] })) === 1,
    scanCount: async (pattern, max = 5000) => {
        let n = 0;
        for await (const batch of client.scanIterator({ MATCH: pattern, COUNT: 500 })) {
            n += Array.isArray(batch) ? batch.length : 1;
            if (n >= max) break;
        }
        return n;
    },
    ping: async () => {
        const started = Date.now();
        await client.ping();
        return Date.now() - started;
    },
    info: async () => parseInfo(await client.info()),
    dbSize: async () => Number(await client.dbSize()),
    flushNamespace: async prefix => {
        let n = 0;
        const keys: string[] = [];
        for await (const batch of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 500 })) {
            if (Array.isArray(batch)) keys.push(...batch); else keys.push(batch);
        }
        for (let i = 0; i < keys.length; i += 500) n += Number(await client.del(keys.slice(i, i + 500)));
        return n;
    }
});

export const connectRedis = async (): Promise<boolean> => {
    try {
        const client = createClient({
            url: env.redisUrl,
            socket: { reconnectStrategy: retries => Math.min(retries * 200, 5000), connectTimeout: 4000 }
        });
        client.on("error", (error: Error) => { ready = false; lastError = error.message; });
        client.on("ready", () => { ready = true; lastError = null; console.log("Redis connected"); });
        client.on("end", () => { ready = false; });
        await client.connect();
        ops = wrap(client);
        ready = true;
        return true;
    } catch (error) {
        lastError = (error as Error).message;
        console.warn(`Redis unavailable (${lastError}) - running in degraded mode (MongoDB fallbacks)`);
        return false;
    }
};

/** Returns the Redis adapter, or null when Redis is not connected right now. */
export const getRedis = (): RedisOps | null => (ops && ready ? ops : null);
export const redisStatus = () => ({ connected: ready, lastError });

/** Test hook: inject an in-memory implementation. */
export const setRedisForTests = (impl: RedisOps | null): void => { ops = impl; ready = impl !== null; };

/** Run a Redis operation; on failure return the fallback instead of failing the request. */
export const safe = async <T>(fn: (r: RedisOps) => Promise<T>, fallback: T): Promise<T> => {
    const r = getRedis();
    if (!r) return fallback;
    try {
        return await fn(r);
    } catch (error) {
        lastError = (error as Error).message;
        return fallback;
    }
};
