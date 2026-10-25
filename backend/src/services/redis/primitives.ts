/**
 * Redis building blocks: caching with epoch-based invalidation, fixed-window rate limiting,
 * distributed locks and operational counters. All of them degrade gracefully when Redis is down.
 */
import { randomBytes } from "crypto";
import { getRedis, safe } from "./client";

export const K = (...parts: (string | number)[]): string => `cf:${parts.join(":")}`;

// ------------------------------------------------------------------ metrics
export const bump = (name: string, by = 1): void => {
    void safe(r => r.incrBy(K("metric", name), by), 0);
};

export const readMetrics = async (names: string[]): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const n of names) out[n] = Number((await safe(r => r.get(K("metric", n)), null)) ?? 0);
    return out;
};

// ------------------------------------------------------------------ cache
/** Per-scope epoch: bumping it makes every cached value keyed with the old epoch unreachable. */
export const getEpoch = async (scope: string): Promise<string> => (await safe(r => r.get(K("epoch", scope)), null)) ?? "0";
export const bumpEpoch = async (...scopes: string[]): Promise<void> => {
    for (const scope of scopes) await safe(r => r.incrBy(K("epoch", scope), 1), 0);
};

export const cached = async <T>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> => {
    const r = getRedis();
    if (r) {
        const hit = await safe(x => x.get(key), null);
        if (hit !== null) {
            bump("cache_hit");
            try { return JSON.parse(hit) as T; } catch { /* corrupted entry - reload */ }
        }
        bump("cache_miss");
    }
    const value = await loader();
    await safe(x => x.set(key, JSON.stringify(value), ttlSec), undefined);
    return value;
};

export const uncache = async (...keys: string[]): Promise<void> => { await safe(r => r.del(...keys), 0); };

// -------------------------------------------------------------- rate limiting
const memoryWindows = new Map<string, { count: number; resetAt: number }>();

export interface RateResult { allowed: boolean; remaining: number; retryAfter: number; limit: number }

/** Fixed-window counter. Falls back to a per-process window when Redis is unavailable. */
export const rateLimitHit = async (name: string, id: string, windowSec: number, max: number): Promise<RateResult> => {
    const key = K("rl", name, id);
    const r = getRedis();
    if (r) {
        try {
            const { count, ttl } = await r.incrWindow(key, windowSec);
            const allowed = count <= max;
            if (!allowed) bump("rate_limited");
            return { allowed, remaining: Math.max(0, max - count), retryAfter: ttl > 0 ? ttl : windowSec, limit: max };
        } catch { /* fall through to memory */ }
    }
    const now = Date.now();
    let entry = memoryWindows.get(key);
    if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowSec * 1000 };
        memoryWindows.set(key, entry);
        if (memoryWindows.size > 20000) for (const [k, v] of memoryWindows) if (v.resetAt <= now) memoryWindows.delete(k);
    }
    entry.count += 1;
    return { allowed: entry.count <= max, remaining: Math.max(0, max - entry.count),
        retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)), limit: max };
};

// --------------------------------------------------------------------- locks
export type LockHandle = { key: string; token: string } | "unprotected";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Acquire a distributed lock. Returns null when it could not be acquired within `waitMs`.
 * When Redis is down returns "unprotected": callers continue because MongoDB conditional
 * updates are the last line of defence against overdrafts.
 */
export const acquireLock = async (name: string, ttlMs = 15000, waitMs = 3000): Promise<LockHandle | null> => {
    const r = getRedis();
    if (!r) return "unprotected";
    const key = K("lock", name);
    const token = randomBytes(12).toString("hex");
    const deadline = Date.now() + waitMs;
    try {
        do {
            if (await r.setNx(key, token, ttlMs)) return { key, token };
            await sleep(60);
        } while (Date.now() < deadline);
        return null;
    } catch {
        return "unprotected";
    }
};

export const releaseLock = async (lock: LockHandle | null): Promise<void> => {
    if (!lock || lock === "unprotected") return;
    await safe(r => r.delIfEquals(lock.key, lock.token), false);
};

/** Non-blocking variant (alert claiming): true if this caller now owns the lock. */
export const tryLock = async (name: string, owner: string, ttlMs: number): Promise<{ acquired: boolean; owner: string | null }> => {
    const r = getRedis();
    if (!r) return { acquired: true, owner };
    const key = K("lock", name);
    try {
        if (await r.setNx(key, owner, ttlMs)) return { acquired: true, owner };
        const current = await r.get(key);
        return { acquired: current === owner, owner: current };
    } catch {
        return { acquired: true, owner };
    }
};

export const unlockIfOwner = async (name: string, owner: string): Promise<void> => {
    await safe(r => r.delIfEquals(K("lock", name), owner), false);
};
