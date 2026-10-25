import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEATURES, applyToProfile, computeFeatures, emptyProfile, type Attempt } from "../src/services/featureEngine";

const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "feature_parity.json"), "utf8"));

test("feature names and order match the Python feature spec", () => {
    assert.deepEqual([...FEATURES], fixture.features);
});

test("TypeScript feature engine reproduces the Python reference for 400 sequential events", () => {
    const profile = emptyProfile();
    const attempts: Attempt[] = [];
    let compared = 0;
    for (const step of fixture.steps) {
        if (step.kind === "fail") {
            attempts.push({ ts: step.ts, amount: step.amount, status: "F" });
            continue;
        }
        const c = step.ctx;
        const got = computeFeatures(profile, attempts, {
            ts: c.ts, hour: c.hour, amount: c.amount, balanceBefore: c.balance, accountCreatedTs: fixture.account_created_ts,
            device: c.device, location: c.location, recipient: c.recipient, category: c.category, isP2P: c.is_p2p, fanIn: c.fan_in
        });
        for (const name of FEATURES) {
            assert.ok(Math.abs(got[name] - step.expected[name]) < 1e-9,
                `step ${compared}: ${name} expected ${step.expected[name]} got ${got[name]}`);
        }
        compared++;
        attempts.push({ ts: c.ts, amount: c.amount, status: step.status });
        if (step.status === "C") {
            applyToProfile(profile, { amount: c.amount, hour: c.hour, device: c.device, location: c.location, recipient: c.recipient, category: c.category });
        }
    }
    assert.ok(compared > 300);
});
