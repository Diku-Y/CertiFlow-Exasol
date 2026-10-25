/**
 * Decision engine: configurable business rules + ML score -> final risk score and action.
 * Pure (no I/O) so the whole policy can be unit-tested.
 */
import type { Features } from "./featureEngine";

export interface RuleConfig {
    code: string;
    title: string;
    threshold: number;
    risk_points: number;
    enabled: boolean;
    notify_customer: boolean;
    notify_analyst: boolean;
}

export interface Thresholds { medium: number; hold: number; block: number }

export interface MlResult {
    ml_risk_score: number;
    fraud_probability: number;
    anomaly_score: number;
    prediction: number;
    model_version: number;
    risk_drivers: { feature: string; label: string; detail: string; impact: number }[];
}

export type Decision = "ALLOW" | "ALLOW_NOTIFY" | "HOLD" | "BLOCK";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RuleHit { code: string; title: string; detail: string; points: number; notify_customer: boolean; notify_analyst: boolean }

export interface RiskAssessment {
    ruleScore: number;
    mlScore: number | null;
    finalScore: number;
    riskLevel: RiskLevel;
    decision: Decision;
    hits: RuleHit[];
    createAlert: boolean;
    notifyCustomer: boolean;
    mlAvailable: boolean;
    notes: string[];
}

const inr = (n: number) => `INR ${Math.round(n).toLocaleString("en-IN")}`;

/** Each rule inspects the same feature vector that the model sees. `maturity` avoids flagging brand-new accounts. */
const RULE_TESTS: Record<string, (f: Features, threshold: number) => string | null> = {
    LARGE_AMOUNT: (f, t) => (f.amount >= t ? `Amount ${inr(f.amount)} is at or above the ${inr(t)} large-payment limit` : null),
    RAPID_TRANSACTIONS: (f, t) => (f.velocity_2m + 1 >= t ? `${f.velocity_2m + 1} payment attempts within 2 minutes` : null),
    NEW_DEVICE: (f) => (f.history_txn_count >= 3 && f.known_device === 0 ? "Payment initiated from a device not seen on this account before" : null),
    UNUSUAL_LOCATION: (f) => (f.history_txn_count >= 3 && f.known_location === 0 ? "Payment initiated from a location not seen on this account before" : null),
    ABNORMAL_SPENDING: (f, t) => (f.history_txn_count >= 5 && f.amount_to_avg_ratio >= t ? `Amount is ${f.amount_to_avg_ratio.toFixed(1)}x the customer's average payment` : null),
    FAILED_THEN_SUCCESS: (f, t) => (f.failed_last_10m >= t ? `${f.failed_last_10m} failed attempts in the last 10 minutes before this payment` : null),
    NEW_RECIPIENT_LARGE: (f, t) => (f.is_p2p === 1 && f.known_recipient === 0 && f.history_txn_count >= 3 && f.amount >= t ? `First transfer to this recipient and amount is ${inr(f.amount)}` : null),
    BALANCE_DRAIN: (f, t) => (f.amount_to_balance_ratio >= t && f.amount >= 5000 ? `Payment drains ${(f.amount_to_balance_ratio * 100).toFixed(0)}% of the available balance` : null),
    MULE_FAN_IN: (f, t) => (f.is_p2p === 1 && f.recipient_fan_in_24h >= t ? `Recipient received money from ${f.recipient_fan_in_24h} other customers in 24 hours` : null),
    UNUSUAL_HOUR: (f) => (f.history_txn_count >= 20 && f.is_night === 1 && f.hour_frequency < 0.02 ? "Customer has never transacted at this time of night" : null)
};

export const DEFAULT_RULES: Omit<RuleConfig, "enabled">[] = [
    { code: "LARGE_AMOUNT", title: "Large payment", threshold: 100000, risk_points: 25, notify_customer: false, notify_analyst: true },
    { code: "RAPID_TRANSACTIONS", title: "Rapid successive payments", threshold: 4, risk_points: 30, notify_customer: true, notify_analyst: true },
    { code: "NEW_DEVICE", title: "New device", threshold: 1, risk_points: 20, notify_customer: true, notify_analyst: false },
    { code: "UNUSUAL_LOCATION", title: "Unusual location", threshold: 1, risk_points: 20, notify_customer: true, notify_analyst: false },
    { code: "ABNORMAL_SPENDING", title: "Abnormal spending amount", threshold: 4, risk_points: 25, notify_customer: false, notify_analyst: true },
    { code: "FAILED_THEN_SUCCESS", title: "Failed attempts before payment", threshold: 3, risk_points: 30, notify_customer: true, notify_analyst: true },
    { code: "NEW_RECIPIENT_LARGE", title: "Large first transfer to new recipient", threshold: 25000, risk_points: 20, notify_customer: true, notify_analyst: false },
    { code: "BALANCE_DRAIN", title: "Balance drain", threshold: 0.8, risk_points: 25, notify_customer: true, notify_analyst: true },
    { code: "MULE_FAN_IN", title: "Possible mule account", threshold: 3, risk_points: 30, notify_customer: false, notify_analyst: true },
    { code: "UNUSUAL_HOUR", title: "Unusual time of night", threshold: 1, risk_points: 10, notify_customer: false, notify_analyst: false }
];

export const levelOf = (score: number, t: Thresholds): RiskLevel =>
    score >= t.block ? "CRITICAL" : score >= t.hold ? "HIGH" : score >= t.medium ? "MEDIUM" : "LOW";

export const assess = (
    features: Features,
    rules: RuleConfig[],
    thresholds: Thresholds,
    ml: MlResult | null,
    opts: { mlEnabled: boolean }
): RiskAssessment => {
    const hits: RuleHit[] = [];
    for (const rule of rules) {
        if (!rule.enabled) continue;
        const test = RULE_TESTS[rule.code];
        if (!test) continue;
        const detail = test(features, rule.threshold);
        if (detail) hits.push({ code: rule.code, title: rule.title, detail, points: rule.risk_points,
            notify_customer: rule.notify_customer, notify_analyst: rule.notify_analyst });
    }
    const ruleScore = Math.min(100, hits.reduce((s, h) => s + h.points, 0));
    const notes: string[] = [];
    const mlUsed = opts.mlEnabled && ml !== null;
    const mlScore = mlUsed ? ml!.ml_risk_score : null;

    let finalScore: number;
    if (mlUsed) {
        // Blend, but never let one very confident signal be averaged away by a quiet one.
        finalScore = Math.round(Math.max(0.4 * ruleScore + 0.6 * mlScore!, 0.75 * ruleScore, 0.75 * mlScore!));
    } else {
        finalScore = ruleScore;
        if (opts.mlEnabled) {
            notes.push("ML scoring unavailable - decision based on rules only");
            // Fail safe: do not let large, unscored payments through unreviewed.
            if (features.amount >= 100000) {
                finalScore = Math.max(finalScore, thresholds.hold);
                notes.push("Large payment held because the ML model could not be consulted");
            }
        }
    }
    finalScore = Math.max(0, Math.min(100, finalScore));
    const decision: Decision = finalScore >= thresholds.block ? "BLOCK"
        : finalScore >= thresholds.hold ? "HOLD"
        : finalScore >= thresholds.medium ? "ALLOW_NOTIFY" : "ALLOW";
    const analystFlag = hits.some(h => h.notify_analyst) || (mlUsed && ml!.prediction === 1);
    return {
        ruleScore, mlScore, finalScore,
        riskLevel: levelOf(finalScore, thresholds),
        decision,
        hits,
        createAlert: decision === "HOLD" || decision === "BLOCK" || (finalScore >= thresholds.medium && analystFlag),
        notifyCustomer: decision !== "ALLOW" || hits.some(h => h.notify_customer),
        mlAvailable: mlUsed,
        notes
    };
};
