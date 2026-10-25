/**
 * Loads a customer's behavioural state for scoring (Redis first, MongoDB rebuild on a miss)
 * and records the outcome of every payment attempt afterwards.
 */
import Transaction from "../models/Transaction";
import { localHour } from "../utils/time";
import { applyToProfile, emptyProfile, type Attempt, type Profile } from "./featureEngine";
import * as store from "./redis/behavior";
import { getRedis } from "./redis/client";
import { bump } from "./redis/primitives";

const STATUS_MAP: Record<string, Attempt["status"]> = { COMPLETED: "C", HELD: "H", BLOCKED: "B", FAILED: "F", CANCELLED: "B" };

export const rebuildProfile = async (customerId: number): Promise<Profile> => {
    const history = await Transaction.find({ customer_id: customerId, status: "COMPLETED", transaction_type: { $ne: "DEPOSIT" } })
        .sort({ created_at: 1 }).limit(5000)
        .select("amount created_at device_id location recipient_account_number merchant_id category").lean();
    const profile = emptyProfile();
    for (const t of history) {
        applyToProfile(profile, {
            amount: t.amount, hour: localHour(t.created_at), device: t.device_id, location: t.location,
            recipient: (t.recipient_account_number ?? t.merchant_id ?? "unknown") as string, category: t.category
        });
    }
    return profile;
};

export const loadProfile = async (customerId: number): Promise<Profile> => {
    const cachedProfile = await store.readProfile(customerId);
    if (cachedProfile) { bump("profile_hit"); return cachedProfile; }
    bump("profile_rebuild");
    const rebuilt = await rebuildProfile(customerId);
    await store.writeProfile(customerId, rebuilt);
    return rebuilt;
};

export const loadAttempts = async (customerId: number, now: Date): Promise<Attempt[]> => {
    const fromRedis = await store.readAttempts(customerId, now.getTime());
    if (fromRedis) return fromRedis;
    const since = new Date(now.getTime() - 7 * 86400000);
    const rows = await Transaction.find({ customer_id: customerId, created_at: { $gte: since }, transaction_type: { $ne: "DEPOSIT" } })
        .select("amount status created_at").lean();
    const attempts = rows.map(r => ({ ts: r.created_at.getTime() / 1000, amount: r.amount, status: STATUS_MAP[r.status] ?? "C" }));
    await store.seedAttempts(customerId, attempts);
    return attempts;
};

export const recipientFanIn = async (recipientAccount: string, senderId: number, now: Date): Promise<number> => {
    if (getRedis()) return store.fanInCount(recipientAccount, senderId, now.getTime());
    const senders = await Transaction.distinct("customer_id", {
        recipient_account_number: recipientAccount, created_at: { $gte: new Date(now.getTime() - 86400000) },
        status: { $in: ["COMPLETED", "HELD", "BLOCKED"] }, customer_id: { $ne: senderId }
    });
    return senders.length;
};

export const recordFailedAttempt = async (customerId: number, amount: number): Promise<void> => {
    await store.pushAttempt(customerId, { ts: Date.now() / 1000, amount, status: "F" });
};

export interface Outcome {
    customerId: number;
    profile: Profile;
    attempt: Attempt;
    completedDebit?: { amount: number; hour: number; device: string; location: string; recipient: string; category: string };
    p2pRecipient?: string;
}

export const recordOutcome = async (o: Outcome): Promise<void> => {
    await store.pushAttempt(o.customerId, o.attempt);
    if (o.completedDebit) {
        applyToProfile(o.profile, o.completedDebit);
        await store.writeProfile(o.customerId, o.profile);
    }
    if (o.p2pRecipient) await store.pushFanIn(o.p2pRecipient, o.customerId, Date.now());
};
