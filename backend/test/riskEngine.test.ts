import "./helpers";
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, assess, type MlResult } from "../src/services/riskEngine";
import { DEFAULT_RISK_THRESHOLDS } from "../src/constants";
import { FEATURES, type Features } from "../src/services/featureEngine";

const rules = DEFAULT_RULES.map(r => ({ ...r, enabled: true }));
const T = DEFAULT_RISK_THRESHOLDS;
const normal = (over: Partial<Features> = {}): Features => ({ ...Object.fromEntries(FEATURES.map(f => [f, 0])), amount: 800, amount_to_avg_ratio: 1, history_txn_count: 60, known_device: 1, known_location: 1, known_recipient: 1,
    hour_frequency: 0.3, account_age_days: 400, ...over } as Features);
const ml = (score: number, prob = score / 100): MlResult => ({ ml_risk_score: score, fraud_probability: prob, anomaly_score: 50, prediction: prob >= 0.5 ? 1 : 0, model_version: 1, risk_drivers: [] });

test("ordinary payment is allowed with no alert", () => {
    const r = assess(normal(), rules, T, ml(2), { mlEnabled: true });
    assert.equal(r.decision, "ALLOW"); assert.equal(r.createAlert, false); assert.equal(r.hits.length, 0);
});

test("brand-new accounts are not flagged for new device / location (no baseline yet)", () => {
    const r = assess(normal({ history_txn_count: 0, known_device: 0, known_location: 0, known_recipient: 0 }), rules, T, ml(5), { mlEnabled: true });
    assert.equal(r.hits.length, 0);
});

test("new device + new location on an established account fire rules and notify the customer", () => {
    const r = assess(normal({ known_device: 0, known_location: 0 }), rules, T, ml(10), { mlEnabled: true });
    assert.deepEqual(r.hits.map(h => h.code).sort(), ["NEW_DEVICE", "UNUSUAL_LOCATION"]);
    assert.equal(r.notifyCustomer, true);
});

test("a very confident model alone cannot be averaged away by quiet rules", () => {
    const r = assess(normal(), rules, T, ml(100, 0.99), { mlEnabled: true });
    assert.ok(r.finalScore >= 75 && r.decision === "HOLD", `got ${r.finalScore} ${r.decision}`);
    assert.equal(r.createAlert, true);
});

test("strong rules and strong model together block", () => {
    const f = normal({ amount: 150000, known_device: 0, known_location: 0, known_recipient: 0, is_p2p: 1, amount_to_avg_ratio: 30, amount_to_balance_ratio: 0.9 });
    const r = assess(f, rules, T, ml(100, 0.99), { mlEnabled: true });
    assert.equal(r.decision, "BLOCK"); assert.equal(r.riskLevel, "CRITICAL");
});

test("ML outage: rules only, large payments fail safe into HOLD, small ones pass", () => {
    const small = assess(normal(), rules, T, null, { mlEnabled: true });
    assert.equal(small.decision, "ALLOW"); assert.equal(small.mlAvailable, false); assert.ok(small.notes.length > 0);
    const large = assess(normal({ amount: 250000 }), rules, T, null, { mlEnabled: true });
    assert.equal(large.decision, "HOLD");
});

test("disabled rules never fire; ML can be switched off entirely", () => {
    const off = rules.map(r => ({ ...r, enabled: false }));
    const r = assess(normal({ known_device: 0, amount: 500000 }), off, T, null, { mlEnabled: false });
    assert.equal(r.hits.length, 0); assert.equal(r.decision, "ALLOW"); assert.equal(r.notes.length, 0);
});

test("mule fan-in, balance drain and rapid velocity rules", () => {
    const r = assess(normal({ is_p2p: 1, recipient_fan_in_24h: 4, amount: 40000, amount_to_balance_ratio: 0.95, velocity_2m: 4 }), rules, T, ml(20), { mlEnabled: true });
    const codes = r.hits.map(h => h.code);
    for (const c of ["MULE_FAN_IN", "BALANCE_DRAIN", "RAPID_TRANSACTIONS"]) assert.ok(codes.includes(c), c);
});
