/**
 * Behavioural feature engine - TypeScript port of ml/features.py (see ml/feature_spec.py for the
 * definition of every feature). Pure functions only; no I/O, so it is unit-tested against the Python
 * reference implementation (backend/test/featureParity.test.ts) to prevent train/serve skew.
 */

export const FEATURES = [
    "amount", "amount_to_avg_ratio", "amount_zscore", "amount_to_balance_ratio", "amount_to_max_ratio",
    "history_txn_count", "account_age_days", "txns_last_1h", "txns_last_24h", "txns_last_7d", "velocity_2m",
    "amount_sum_24h_ratio", "minutes_since_last_txn", "known_device", "known_location", "known_recipient",
    "unique_device_count", "unique_location_count", "hour_sin", "hour_cos", "hour_frequency", "is_night",
    "category_frequency", "is_p2p", "recipient_fan_in_24h", "failed_last_24h", "failed_last_10m", "is_round_amount"
] as const;

export type FeatureName = typeof FEATURES[number];
export type Features = Record<FeatureName, number>;

export interface Profile {
    count: number;
    total: number;
    total_sq: number;
    max_amount: number;
    hours: number[];
    devices: string[];
    locations: string[];
    recipients: string[];
    categories: Record<string, number>;
}

export interface Attempt {
    ts: number;                      // epoch seconds
    amount: number;
    status: "C" | "H" | "B" | "F";   // completed / held / blocked / failed
}

export interface PaymentContext {
    ts: number;                      // epoch seconds
    hour: number;                    // 0-23 in the bank's timezone
    amount: number;
    balanceBefore: number;
    accountCreatedTs: number;        // epoch seconds
    device: string;
    location: string;
    recipient: string;               // account number or merchant id
    category: string;
    isP2P: boolean;
    fanIn: number;
}

const CAP = 200; // bound the size of the membership sets stored in Redis

export const emptyProfile = (): Profile => ({
    count: 0, total: 0, total_sq: 0, max_amount: 0, hours: new Array(24).fill(0),
    devices: [], locations: [], recipients: [], categories: {}
});

const clip = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const computeFeatures = (profile: Profile, attemptsIn: Attempt[], ctx: PaymentContext): Features => {
    const week = 7 * 86400;
    const attempts = attemptsIn.filter(a => ctx.ts - a.ts <= week);
    const n = profile.count;
    const mean = n ? profile.total / n : ctx.amount;
    const variance = n ? Math.max(profile.total_sq / n - mean * mean, 0) : 0;
    const std = Math.sqrt(variance);

    let c2m = 0, c1h = 0, c24h = 0, c7d = 0, f24h = 0, f10m = 0, sum24h = 0;
    let lastTs: number | null = null;
    for (const a of attempts) {
        const age = ctx.ts - a.ts;
        if (age < 0) continue;
        c7d++;
        if (age <= 86400) { c24h++; sum24h += a.amount; if (a.status === "F") f24h++; }
        if (age <= 3600) c1h++;
        if (age <= 120) c2m++;
        if (age <= 600 && a.status === "F") f10m++;
        if (lastTs === null || a.ts > lastTs) lastTs = a.ts;
    }
    const minutesSince = lastTs !== null ? (ctx.ts - lastTs) / 60 : 10080;

    let hourFrequency = 0.5, categoryFrequency = 0, zscore = 0, maxRatio = 1, avgRatio = 1;
    if (n) {
        const h = profile.hours;
        hourFrequency = (h[(ctx.hour + 23) % 24] + h[ctx.hour] + h[(ctx.hour + 1) % 24]) / n;
        categoryFrequency = (profile.categories[ctx.category] ?? 0) / n;
        zscore = (ctx.amount - mean) / Math.max(std, 0.3 * mean, 1);
        maxRatio = ctx.amount / Math.max(profile.max_amount, 1);
        avgRatio = mean > 0 ? ctx.amount / mean : 1;
    }

    return {
        amount: ctx.amount,
        amount_to_avg_ratio: clip(avgRatio, 0, 100),
        amount_zscore: clip(zscore, -5, 20),
        amount_to_balance_ratio: clip(ctx.amount / Math.max(ctx.balanceBefore, 1), 0, 1),
        amount_to_max_ratio: clip(maxRatio, 0, 20),
        history_txn_count: n,
        account_age_days: clip(Math.max(0, (ctx.ts - ctx.accountCreatedTs) / 86400), 0, 3650),
        txns_last_1h: c1h,
        txns_last_24h: c24h,
        txns_last_7d: c7d,
        velocity_2m: c2m,
        amount_sum_24h_ratio: clip(sum24h / Math.max(mean, 1), 0, 50),
        minutes_since_last_txn: clip(minutesSince, 0, 10080),
        known_device: profile.devices.includes(ctx.device) ? 1 : 0,
        known_location: profile.locations.includes(ctx.location) ? 1 : 0,
        known_recipient: profile.recipients.includes(ctx.recipient) ? 1 : 0,
        unique_device_count: profile.devices.length,
        unique_location_count: profile.locations.length,
        hour_sin: Math.sin((2 * Math.PI * ctx.hour) / 24),
        hour_cos: Math.cos((2 * Math.PI * ctx.hour) / 24),
        hour_frequency: hourFrequency,
        is_night: ctx.hour < 6 ? 1 : 0,
        category_frequency: categoryFrequency,
        is_p2p: ctx.isP2P ? 1 : 0,
        recipient_fan_in_24h: ctx.fanIn,
        failed_last_24h: f24h,
        failed_last_10m: f10m,
        is_round_amount: ctx.amount >= 1000 && ctx.amount % 500 === 0 ? 1 : 0
    };
};

const addCapped = (list: string[], value: string): void => {
    if (list.includes(value)) return;
    list.push(value);
    if (list.length > CAP) list.shift();
};

/** Fold a COMPLETED debit into the profile (mutates and returns it). */
export const applyToProfile = (
    profile: Profile,
    tx: { amount: number; hour: number; device: string; location: string; recipient: string; category: string }
): Profile => {
    profile.count += 1;
    profile.total += tx.amount;
    profile.total_sq += tx.amount * tx.amount;
    profile.max_amount = Math.max(profile.max_amount, tx.amount);
    profile.hours[tx.hour] = (profile.hours[tx.hour] ?? 0) + 1;
    addCapped(profile.devices, tx.device);
    addCapped(profile.locations, tx.location);
    addCapped(profile.recipients, tx.recipient);
    profile.categories[tx.category] = (profile.categories[tx.category] ?? 0) + 1;
    return profile;
};
