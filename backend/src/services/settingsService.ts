import FraudRule from "../models/FraudRule";
import Setting from "../models/Setting";
import { DEFAULT_DAILY_LIMIT, DEFAULT_RISK_THRESHOLDS } from "../constants";
import { getNextSequence } from "../utils/counter";
import { badRequest } from "../utils/httpError";
import { bumpEpoch, cached, getEpoch, K } from "./redis/primitives";
import { DEFAULT_RULES, type RuleConfig, type Thresholds } from "./riskEngine";

export interface BankSettings {
    transfers_enabled: boolean;
    ml_enabled: boolean;
    risk_thresholds: Thresholds;
    default_daily_limit: { SAVINGS: number; CURRENT: number };
}

export const DEFAULT_SETTINGS: BankSettings = {
    transfers_enabled: true,
    ml_enabled: true,
    risk_thresholds: DEFAULT_RISK_THRESHOLDS,
    default_daily_limit: { SAVINGS: DEFAULT_DAILY_LIMIT.SAVINGS, CURRENT: DEFAULT_DAILY_LIMIT.CURRENT }
};

export const getSettings = async (): Promise<BankSettings> => {
    const epoch = await getEpoch("settings");
    return cached(K("cache", "settings", epoch), 60, async () => {
        const docs = await Setting.find().lean();
        const stored = Object.fromEntries(docs.map(d => [d.key, d.value]));
        return {
            transfers_enabled: (stored.transfers_enabled as boolean) ?? DEFAULT_SETTINGS.transfers_enabled,
            ml_enabled: (stored.ml_enabled as boolean) ?? DEFAULT_SETTINGS.ml_enabled,
            risk_thresholds: { ...DEFAULT_SETTINGS.risk_thresholds, ...(stored.risk_thresholds as object) },
            default_daily_limit: { ...DEFAULT_SETTINGS.default_daily_limit, ...(stored.default_daily_limit as object) }
        };
    });
};

export const updateSettings = async (patch: Partial<BankSettings>, actorId: number): Promise<BankSettings> => {
    const current = await getSettings();
    const next: BankSettings = {
        transfers_enabled: patch.transfers_enabled ?? current.transfers_enabled,
        ml_enabled: patch.ml_enabled ?? current.ml_enabled,
        risk_thresholds: { ...current.risk_thresholds, ...(patch.risk_thresholds ?? {}) },
        default_daily_limit: { ...current.default_daily_limit, ...(patch.default_daily_limit ?? {}) }
    };
    const t = next.risk_thresholds;
    if (![t.medium, t.hold, t.block].every(v => Number.isFinite(v) && v >= 1 && v <= 100) || !(t.medium < t.hold && t.hold < t.block)) {
        throw badRequest("Risk thresholds must satisfy 1 <= medium < hold < block <= 100");
    }
    for (const type of ["SAVINGS", "CURRENT"] as const) {
        const v = next.default_daily_limit[type];
        if (!Number.isFinite(v) || v < 1000 || v > 100000000) throw badRequest("Daily limits must be between 1,000 and 10,00,00,000");
    }
    for (const [key, value] of Object.entries(next)) {
        await Setting.updateOne({ key }, { $set: { value, updated_by: actorId, updated_at: new Date() } }, { upsert: true });
    }
    await bumpEpoch("settings");
    return next;
};

// -------------------------------------------------------------------- rules
export const ensureDefaultRules = async (): Promise<void> => {
    for (const rule of DEFAULT_RULES) {
        if (await FraudRule.exists({ code: rule.code })) continue;
        await FraudRule.create({ id: await getNextSequence("fraud_rule_id"), ...rule, description: "", enabled: true });
    }
};

export const getRules = async (): Promise<RuleConfig[]> => {
    const epoch = await getEpoch("rules");
    return cached(K("cache", "rules", epoch), 60, async () => {
        const rules = await FraudRule.find().sort({ id: 1 }).lean();
        return rules.map(r => ({ code: r.code, title: r.title, threshold: r.threshold, risk_points: r.risk_points,
            enabled: r.enabled, notify_customer: r.notify_customer, notify_analyst: r.notify_analyst }));
    });
};

export const invalidateRules = (): Promise<void> => bumpEpoch("rules");
