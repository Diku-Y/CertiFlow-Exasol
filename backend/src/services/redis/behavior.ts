/**
 * Redis storage for the real-time behavioural profile that feeds the ML model.
 *
 *  cf:profile:{customerId}     JSON profile of COMPLETED debits (amount stats, hour histogram,
 *                              known devices / locations / recipients, category counts)
 *  cf:att:{customerId}         ZSET of attempts in the last 7 days, score = epoch ms,
 *                              member = "ts|amount|status|nonce"  (status C/H/B/F)
 *  cf:fanin:{recipientKey}     ZSET senderId -> last payment ts (distinct senders in 24h = mule signal)
 *
 * MongoDB is the source of truth. If a key is missing (eviction, restart, Redis down) the caller
 * rebuilds it from MongoDB (see services/behaviorService.ts), so Redis loss only costs latency.
 */
import { randomBytes } from "crypto";
import { safe } from "./client";
import { K } from "./primitives";
import type { Attempt, Profile } from "../featureEngine";

const WEEK_MS = 7 * 86400000;
const DAY_MS = 86400000;
const PROFILE_TTL = 60 * 86400;

export const readProfile = async (customerId: number): Promise<Profile | null> => {
    const raw = await safe(r => r.get(K("profile", customerId)), null);
    if (!raw) return null;
    try { return JSON.parse(raw) as Profile; } catch { return null; }
};

export const writeProfile = async (customerId: number, profile: Profile): Promise<void> => {
    await safe(r => r.set(K("profile", customerId), JSON.stringify(profile), PROFILE_TTL), undefined);
};

export const dropProfile = async (customerId: number): Promise<void> => {
    await safe(async r => { await r.del(K("profile", customerId), K("att", customerId)); }, undefined);
};

/** null = Redis has no data / unavailable (caller must use MongoDB). */
export const readAttempts = async (customerId: number, nowMs: number): Promise<Attempt[] | null> => {
    const key = K("att", customerId);
    const exists = await safe(async r => (await r.zCard(key)) > 0 || (await r.get(K("att-init", customerId))) !== null, null);
    if (exists === null || exists === false) return null;
    const members = await safe(r => r.zRangeByScore(key, nowMs - WEEK_MS, nowMs + 1000), null);
    if (!members) return null;
    return members.map(m => {
        const [ts, amount, status] = m.split("|");
        return { ts: Number(ts) / 1000, amount: Number(amount), status: status as Attempt["status"] };
    });
};

export const seedAttempts = async (customerId: number, attempts: Attempt[]): Promise<void> => {
    await safe(async r => {
        for (const a of attempts) await r.zAdd(K("att", customerId), a.ts * 1000, `${Math.round(a.ts * 1000)}|${a.amount}|${a.status}|${randomBytes(3).toString("hex")}`);
        await r.set(K("att-init", customerId), "1", 8 * 86400);
        await r.expire(K("att", customerId), 8 * 86400);
    }, undefined);
};

export const pushAttempt = async (customerId: number, attempt: Attempt): Promise<void> => {
    await safe(async r => {
        const key = K("att", customerId);
        const ms = Math.round(attempt.ts * 1000);
        await r.zAdd(key, ms, `${ms}|${attempt.amount}|${attempt.status}|${randomBytes(3).toString("hex")}`);
        await r.zRemRangeByScore(key, 0, ms - WEEK_MS);
        await r.expire(key, 8 * 86400);
        await r.set(K("att-init", customerId), "1", 8 * 86400);
    }, undefined);
};

export const fanInCount = async (recipientKey: string, senderId: number, nowMs: number): Promise<number> => {
    return safe(async r => {
        const key = K("fanin", recipientKey);
        await r.zRemRangeByScore(key, 0, nowMs - DAY_MS);
        const senders = await r.zRangeByScore(key, nowMs - DAY_MS, nowMs + 1000);
        return senders.filter(s => s !== String(senderId)).length;
    }, 0);
};

export const pushFanIn = async (recipientKey: string, senderId: number, nowMs: number): Promise<void> => {
    await safe(async r => {
        const key = K("fanin", recipientKey);
        await r.zAdd(key, nowMs, String(senderId));
        await r.expire(key, 2 * 86400);
    }, undefined);
};
