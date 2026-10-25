/**
 * Server-side session registry. JWTs carry a `jti`; the session exists in Redis for the
 * lifetime of the token, which gives instant logout, "sign out all devices" and admin force-logout.
 * When Redis is down the auth middleware falls back to MongoDB (user.token_version).
 */
import { getRedis, safe } from "./client";
import { K } from "./primitives";

export interface SessionInfo {
    jti: string;
    uid: number;
    role: string;
    ip: string;
    userAgent: string;
    deviceId: string;
    createdAt: string;
}

export const createSession = async (info: SessionInfo, ttlSec: number): Promise<void> => {
    await safe(async r => {
        await r.set(K("sess", info.jti), JSON.stringify(info), ttlSec);
        await r.sAdd(K("usess", info.uid), info.jti);
        await r.expire(K("usess", info.uid), ttlSec + 60);
    }, undefined);
};

/** true = valid, false = revoked/expired, null = Redis unavailable (caller falls back). */
export const isSessionActive = async (jti: string): Promise<boolean | null> => {
    const r = getRedis();
    if (!r) return null;
    try {
        return (await r.get(K("sess", jti))) !== null;
    } catch {
        return null;
    }
};

export const revokeSession = async (uid: number, jti: string): Promise<void> => {
    await safe(async r => {
        await r.del(K("sess", jti));
        await r.sRem(K("usess", uid), jti);
    }, undefined);
};

export const revokeAllSessions = async (uid: number, exceptJti?: string): Promise<number> => {
    return safe(async r => {
        const jtis = await r.sMembers(K("usess", uid));
        let n = 0;
        for (const jti of jtis) {
            if (jti === exceptJti) continue;
            n += await r.del(K("sess", jti));
            await r.sRem(K("usess", uid), jti);
        }
        return n;
    }, 0);
};

export const listSessions = async (uid: number): Promise<SessionInfo[]> => {
    return safe(async r => {
        const jtis = await r.sMembers(K("usess", uid));
        const out: SessionInfo[] = [];
        for (const jti of jtis) {
            const raw = await r.get(K("sess", jti));
            if (raw) out.push(JSON.parse(raw));
            else await r.sRem(K("usess", uid), jti);
        }
        return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, [] as SessionInfo[]);
};

export const countActiveSessions = async (): Promise<number> => safe(r => r.scanCount(K("sess", "*")), 0);
