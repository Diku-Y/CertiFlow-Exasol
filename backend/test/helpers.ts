/** Test helpers: stub packages that are not needed for pure-logic tests, and an in-memory RedisOps. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
    if (request === "redis") return { createClient: () => { throw new Error("redis stub"); } };
    if (request === "dotenv") return { config: () => undefined };
    return originalLoad.call(this, request, ...rest);
};

process.env.JWT_SECRET = "test-secret-test-secret";
process.env.MONGODB_URI = "mongodb://localhost/test";

import type { RedisOps } from "../src/services/redis/client";

export class MemoryRedis implements RedisOps {
    kv = new Map<string, { v: string; exp: number | null }>();
    z = new Map<string, Map<string, number>>();
    s = new Map<string, Set<string>>();
    handlers = new Map<string, ((m: string) => void)[]>();
    now = () => Date.now();
    private alive(key: string) { const e = this.kv.get(key); if (e && e.exp !== null && e.exp <= this.now()) { this.kv.delete(key); return undefined; } return e; }
    async get(key: string) { return this.alive(key)?.v ?? null; }
    async set(key: string, value: string, ttlSec?: number) { this.kv.set(key, { v: value, exp: ttlSec ? this.now() + ttlSec * 1000 : null }); }
    async setNx(key: string, value: string, ttlMs: number) { if (this.alive(key)) return false; this.kv.set(key, { v: value, exp: this.now() + ttlMs }); return true; }
    async del(...keys: string[]) { let n = 0; for (const k of keys) { if (this.kv.delete(k)) n++; if (this.z.delete(k)) n++; if (this.s.delete(k)) n++; } return n; }
    async incrWindow(key: string, ttlSec: number) {
        const e = this.alive(key);
        const count = Number(e?.v ?? 0) + 1;
        this.kv.set(key, { v: String(count), exp: e?.exp ?? this.now() + ttlSec * 1000 });
        return { count, ttl: Math.ceil(((this.kv.get(key)!.exp as number) - this.now()) / 1000) };
    }
    async incrBy(key: string, by: number) { const e = this.alive(key); const n = Number(e?.v ?? 0) + by; this.kv.set(key, { v: String(n), exp: e?.exp ?? null }); return n; }
    async expire(key: string, ttlSec: number) { const e = this.kv.get(key); if (e) e.exp = this.now() + ttlSec * 1000; }
    async zAdd(key: string, score: number, member: string) { if (!this.z.has(key)) this.z.set(key, new Map()); this.z.get(key)!.set(member, score); }
    async zRemRangeByScore(key: string, min: number, max: number) { const m = this.z.get(key); if (m) for (const [k, v] of m) if (v >= min && v <= max) m.delete(k); }
    async zRangeByScore(key: string, min: number, max: number) { return [...(this.z.get(key) ?? [])].filter(([, v]) => v >= min && v <= max).sort((a, b) => a[1] - b[1]).map(([k]) => k); }
    async zCard(key: string) { return this.z.get(key)?.size ?? 0; }
    async sAdd(key: string, member: string) { if (!this.s.has(key)) this.s.set(key, new Set()); this.s.get(key)!.add(member); }
    async sRem(key: string, member: string) { this.s.get(key)?.delete(member); }
    async sMembers(key: string) { return [...(this.s.get(key) ?? [])]; }
    async publish(channel: string, message: string) { for (const h of this.handlers.get(channel) ?? []) h(message); }
    async subscribe(channel: string, handler: (m: string) => void) { this.handlers.set(channel, [...(this.handlers.get(channel) ?? []), handler]); }
    async delIfEquals(key: string, value: string) { if (this.alive(key)?.v === value) { this.kv.delete(key); return true; } return false; }
    async scanCount(pattern: string) { const rx = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"); return [...this.kv.keys()].filter(k => rx.test(k)).length; }
    async ping() { return 1; }
    async info() { return {}; }
    async dbSize() { return this.kv.size; }
    async flushNamespace(prefix: string) { let n = 0; for (const k of [...this.kv.keys()]) if (k.startsWith(prefix)) { this.kv.delete(k); n++; } return n; }
}
