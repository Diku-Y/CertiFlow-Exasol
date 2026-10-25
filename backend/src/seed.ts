/**
 * Demo data for CertiFlow:  npm run seed
 *
 * Simulates ~45 days of banking for 10 customers. Every payment is pushed through the SAME feature
 * engine, ML model (when the ML service is reachable) and rule engine as a live payment, so risk scores,
 * reason codes, alerts and analyst labels in the demo are genuine outputs of the pipeline - not hard-coded.
 * Includes legitimate "hard" behaviour (travel, big purchase, festival burst, new phone) and five fraud
 * scenarios (account takeover, card-testing burst, authorised-push-payment scam, slow drain, credential stuffing).
 *
 * WARNING: wipes all CertiFlow collections. Refuses to run in production without --force.
 */
import bcrypt from "bcrypt";
import { assertRuntimeConfig, env } from "./config/env";
import { connectDatabase } from "./config/database";
import mongoose from "mongoose";
import Account from "./models/Account";
import AuditLog from "./models/AuditLog";
import Beneficiary from "./models/Beneficiary";
import Counter from "./models/Counter";
import Customer from "./models/Customer";
import FraudAlert from "./models/FraudAlert";
import FraudRule from "./models/FraudRule";
import Investigation from "./models/Investigation";
import Notification from "./models/Notification";
import Setting from "./models/Setting";
import Transaction from "./models/Transaction";
import User from "./models/User";
import { BANK_NAME, BRANCH_NAME, DEFAULT_DAILY_LIMIT, IFSC_CODE, MERCHANTS, SYSTEM_CUSTOMER_ID, SYSTEM_NAME } from "./constants";
import { applyToProfile, computeFeatures, emptyProfile, type Attempt, type Profile } from "./services/featureEngine";
import { mlHealth, predictRisk } from "./services/mlService";
import { connectRedis, getRedis } from "./services/redis/client";
import { assess } from "./services/riskEngine";
import { DEFAULT_SETTINGS, ensureDefaultRules, getRules } from "./services/settingsService";
import { localHour } from "./utils/time";

const DEMO = { adminPassword: "Admin@12345", staffPassword: "Analyst@12345", customerPassword: "Customer@123", pin: "482916" };
const DAYS = 45, OPEN_AFTER_DAY = 41, HOUR = 3600000, DAY = 86400000;

// ------------------------------------------------------------- deterministic RNG
let seedState = 20260901;
const rnd = () => { seedState |= 0; seedState = (seedState + 0x6d2b79f5) | 0; let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a: number, b: number) => a + rnd() * (b - a);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const poisson = (l: number) => { let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= rnd(); } while (p > L); return k - 1; };
const lognormal = (mu: number, sigma: number) => Math.exp(mu + sigma * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()));
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Person { name: string; email: string; phone: string; city: string; income: number; ticket: number; night?: boolean; type?: "SAVINGS" | "CURRENT"; since: number }
const PEOPLE: Person[] = [
    { name: "Aarav Sharma", email: "aarav@certiflow.test", phone: "9840012345", city: "Chennai", income: 95000, ticket: 1100, since: 900 },
    { name: "Meera Iyer", email: "meera@certiflow.test", phone: "9841123456", city: "Chennai", income: 72000, ticket: 800, since: 600 },
    { name: "Rohan Gupta", email: "rohan@certiflow.test", phone: "9811234567", city: "Delhi", income: 110000, ticket: 1500, since: 1400 },
    { name: "Priya Nair", email: "priya@certiflow.test", phone: "9895123456", city: "Kochi", income: 64000, ticket: 700, since: 400 },
    { name: "Karthik Raman", email: "karthik@certiflow.test", phone: "9884098765", city: "Chennai", income: 140000, ticket: 2100, since: 1700 },
    { name: "Sneha Patil", email: "sneha@certiflow.test", phone: "9822011223", city: "Pune", income: 58000, ticket: 650, since: 300 },
    { name: "Dev Malhotra", email: "dev@certiflow.test", phone: "9910045678", city: "Delhi", income: 88000, ticket: 1200, since: 1100 },
    { name: "Anita Reddy", email: "anita@certiflow.test", phone: "9849055667", city: "Hyderabad", income: 76000, ticket: 900, since: 700 },
    { name: "Imran Sheikh", email: "imran@certiflow.test", phone: "9833022114", city: "Mumbai", income: 210000, ticket: 2800, type: "CURRENT", since: 1900 },
    { name: "Lakshmi Subramanian", email: "lakshmi@certiflow.test", phone: "9840077889", city: "Chennai", income: 52000, ticket: 550, since: 2400 },
    { name: "Vikram Traders", email: "vikram.traders@certiflow.test", phone: "9000011122", city: "Jaipur", income: 30000, ticket: 400, type: "CURRENT", since: 21 } // the mule account used by fraud scenarios
];
const MULE = PEOPLE.length - 1;
const CITIES = ["Chennai", "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Kolkata", "Pune", "Kochi", "Jaipur"];

interface Sim { idx: number; person: Person; customerId: number; userId: number; accountNumber: string; accountCreated: number; balance: number; profile: Profile; attempts: Attempt[]; devices: string[] }
interface Ev { ts: number; sim: number; kind: "merchant" | "p2p" | "salary" | "fail"; amount?: number; device?: string; location?: string; recipientSim?: number; merchantIdx?: number;
    fraud?: string; legitTag?: string; balanceFrac?: number; remarks?: string }

const main = async () => {
    if (env.isProduction && !process.argv.includes("--force")) throw new Error("Refusing to wipe a production database. Pass --force to override.");
    assertRuntimeConfig();
    await connectDatabase();
    await connectRedis();
    const redis = getRedis();
    if (redis) { const n = await redis.flushNamespace("cf:"); console.log(`Cleared ${n} Redis keys`); }
    await Promise.all([Account, AuditLog, Beneficiary, Counter, Customer, FraudAlert, FraudRule, Investigation, Notification, Setting, Transaction, User].map(m => (m as any).deleteMany({})));
    await ensureDefaultRules();
    const ml = await mlHealth();
    console.log(ml.up ? `ML service reachable (model v${ml.version}) - scoring seed data with the real model` : "ML service NOT reachable - seed data scored by rules only (start the ML service and re-seed for model scores)");

    const counters: Record<string, number> = {};
    const next = (n: string) => (counters[n] = (counters[n] ?? 0) + 1);
    const now = Date.now(), start = now - DAYS * DAY;

    // ---- staff ------------------------------------------------------------------------------------
    const staffHash = await bcrypt.hash(DEMO.staffPassword, 10), adminHash = await bcrypt.hash(DEMO.adminPassword, 10), custHash = await bcrypt.hash(DEMO.customerPassword, 10), pinHash = await bcrypt.hash(DEMO.pin, 10);
    const staff = [
        { name: "Neha Kapoor", email: "admin@certiflow.test", role: "ADMIN", hash: adminHash }, { name: "Rahul Menon", email: "admin2@certiflow.test", role: "ADMIN", hash: adminHash },
        { name: "Divya Krishnan", email: "analyst@certiflow.test", role: "FRAUD_ANALYST", hash: staffHash }, { name: "Arjun Bhat", email: "analyst2@certiflow.test", role: "FRAUD_ANALYST", hash: staffHash }
    ].map(s => ({ id: next("user_id"), name: s.name, email: s.email, role: s.role, password_hash: s.hash, last_login_at: new Date(now - between(1, 30) * HOUR) }));
    await User.insertMany(staff);
    const analyst1 = staff[2], analyst2 = staff[3];

    // ---- customers & accounts ----------------------------------------------------------------------
    const sims: Sim[] = [];
    const users: any[] = [], customers: any[] = [], accounts: any[] = [];
    PEOPLE.forEach((p, idx) => {
        const userId = next("user_id"), customerId = next("customer_id"), accountId = next("account_id");
        const created = new Date(now - p.since * DAY);
        const accountNumber = `5${String(Math.floor(100000000 + rnd() * 899999999)).padStart(10, "0")}${idx}`.slice(0, 12);
        users.push({ id: userId, name: p.name, email: p.email, role: "USER", password_hash: custHash, pin_hash: pinHash, last_login_at: new Date(now - between(1, 48) * HOUR), created_at: created });
        customers.push({ id: customerId, customer_number: `CIF${String(customerId).padStart(8, "0")}`, user_id: userId, name: p.name, email: p.email, phone: p.phone, city: p.city, status: "ACTIVE", risk_level: "LOW", reviewed_by: staff[0].id, reviewed_at: created, created_at: created });
        accounts.push({ id: accountId, customer_id: customerId, account_number: accountNumber, account_type: p.type ?? "SAVINGS", balance_paise: 0, status: "ACTIVE", daily_limit: DEFAULT_DAILY_LIMIT[p.type ?? "SAVINGS"], ifsc: IFSC_CODE, branch: BRANCH_NAME, created_at: created });
        sims.push({ idx, person: p, customerId, userId, accountNumber, accountCreated: created.getTime(), balance: p.income * between(1.2, 2.5), profile: emptyProfile(), attempts: [],
            devices: [`dev-${p.name.split(" ")[0].toLowerCase()}-phone`, ...(rnd() < 0.4 ? [`dev-${p.name.split(" ")[0].toLowerCase()}-laptop`] : [])] });
    });
    // two applications waiting for admin approval
    for (const p of [{ name: "Neha Verma", email: "neha.verma@certiflow.test", phone: "9876543210", city: "Bengaluru" }, { name: "Siddharth Rao", email: "siddharth@certiflow.test", phone: "9812345670", city: "Hyderabad" }]) {
        const userId = next("user_id"), customerId = next("customer_id");
        users.push({ id: userId, name: p.name, email: p.email, role: "USER", password_hash: custHash, created_at: new Date(now - between(2, 20) * HOUR) });
        customers.push({ id: customerId, customer_number: `CIF${String(customerId).padStart(8, "0")}`, user_id: userId, name: p.name, email: p.email, phone: p.phone, city: p.city, status: "PENDING", created_at: new Date(now - between(2, 20) * HOUR) });
    }

    // ---- event generation --------------------------------------------------------------------------
    const events: Ev[] = [];
    const at = (day: number, hour: number) => start + day * DAY + hour * HOUR + between(0, 3500) * 1000;
    const hourPick = (night?: boolean) => { const h = Math.floor(between(8, 22)); return night ? (h + 12) % 24 : h; };
    const FRIENDS = (i: number) => sims.map((_, j) => j).filter(j => j !== i && j !== MULE).sort(() => rnd() - 0.5).slice(0, 3);

    sims.forEach((s, i) => {
        if (i === MULE) return;
        const p = s.person;
        const friends = FRIENDS(i);
        const travel = i === 5 ? { from: 20, to: 24, city: "Mumbai" } : null;
        for (let d = 0; d < DAYS; d++) {
            if (d % 30 === 1) events.push({ ts: at(d, 9), sim: i, kind: "salary", amount: p.income });
            const loc = travel && d >= travel.from && d <= travel.to ? travel.city : p.city;
            for (let k = poisson(1.4); k > 0; k--) {
                const dev = rnd() < 0.8 ? s.devices[0] : pick(s.devices);
                const h = hourPick(p.night);
                if (rnd() < 0.22) events.push({ ts: at(d, h), sim: i, kind: "p2p", recipientSim: pick(friends), amount: Math.max(100, Math.round(p.ticket * between(2, 7) / 100) * 100), device: dev, location: loc, remarks: pick(["Dinner split", "Rent share", "Gift", "Groceries", "Cab fare", "Loan return"]) });
                else events.push({ ts: at(d, h), sim: i, kind: "merchant", merchantIdx: Math.floor(rnd() * MERCHANTS.length), amount: r2(Math.max(20, lognormal(Math.log(p.ticket * 0.7), 0.6))), device: dev, location: loc });
            }
            if (d % 30 === 3 && i % 2 === 0) events.push({ ts: at(d, 10), sim: i, kind: "p2p", recipientSim: friends[0], amount: Math.round(p.income * 0.28 / 500) * 500, device: s.devices[0], location: p.city, remarks: "House rent", legitTag: "rent" });
        }
    });
    // legitimate hard cases
    events.push({ ts: at(42, 15), sim: 0, kind: "merchant", merchantIdx: MERCHANTS.findIndex(m => m.id === "croma"), amount: 78499, device: sims[0].devices[0], location: "Chennai", legitTag: "big purchase" });
    for (let k = 0; k < 6; k++) events.push({ ts: at(30, 12) + k * 240000, sim: 6, kind: "merchant", merchantIdx: MERCHANTS.findIndex(m => m.id === "myntra"), amount: r2(between(1500, 4200)), device: sims[6].devices[0], location: "Delhi", legitTag: "festival burst" });
    for (let d = 33; d < DAYS; d++) for (let k = poisson(1.3); k > 0; k--) events.push({ ts: at(d, hourPick()), sim: 7, kind: "merchant", merchantIdx: Math.floor(rnd() * MERCHANTS.length), amount: r2(lognormal(Math.log(600), 0.6)), device: "dev-anita-new-phone", location: "Hyderabad", legitTag: "new phone" });
    // fraud scenarios
    events.push({ ts: at(43, 3.2), sim: 0, kind: "p2p", recipientSim: MULE, balanceFrac: 0.62, device: "dev-unknown-7f3a", location: "Jaipur", fraud: "ATO" });
    events.push({ ts: at(43, 3.3), sim: 0, kind: "p2p", recipientSim: MULE, balanceFrac: 0.55, device: "dev-unknown-7f3a", location: "Jaipur", fraud: "ATO" });
    for (let k = 0; k < 9; k++) events.push({ ts: at(44, 1.5) + k * 14000, sim: 1, kind: "merchant", merchantIdx: Math.floor(rnd() * MERCHANTS.length), amount: r2(between(40, 380)), device: "dev-bot-91c2", location: "Kolkata", fraud: "CARD TESTING" });
    events.push({ ts: at(36, 14), sim: 2, kind: "p2p", recipientSim: MULE, amount: 45000, device: sims[2].devices[0], location: "Delhi", fraud: "APP SCAM", remarks: "Investment opportunity" });
    for (let k = 0; k < 4; k++) events.push({ ts: at(30, 2) + k * 2 * HOUR, sim: 3, kind: "p2p", recipientSim: MULE, amount: Math.round(between(9000, 16000) / 100) * 100, device: k % 2 ? "dev-unknown-b21e" : sims[3].devices[0], location: k % 2 ? "Jaipur" : "Kochi", fraud: "SLOW DRAIN" });
    for (let k = 0; k < 4; k++) events.push({ ts: at(25, 4) + k * 40000, sim: 4, kind: "fail", amount: 0, fraud: "CREDENTIAL STUFFING" });
    events.push({ ts: at(25, 4) + 4 * 40000, sim: 4, kind: "p2p", recipientSim: MULE, balanceFrac: 0.45, device: "dev-unknown-5aa0", location: "Jaipur", fraud: "CREDENTIAL STUFFING" });
    events.sort((a, b) => a.ts - b.ts);

    // ---- replay -----------------------------------------------------------------------------------
    const rules = await getRules();
    const thresholds = DEFAULT_SETTINGS.risk_thresholds;
    const mlOn = ml.up;
    const txns: any[] = [], alerts: any[] = [], invest: any[] = [], notes: any[] = [];
    const fanIn = new Map<string, Map<number, number>>();
    const payees = new Map<string, Set<number>>();
    const recipientAccountOf = (j: number) => sims[j].accountNumber;
    let flagged = 0, fraudCaught = 0, fraudMissed = 0;
    const stats = { total: 0, hold: 0, block: 0, notify: 0 };

    const note = (cust: Sim, type: string, title: string, message: string, ts: number, extra: any = {}) =>
        notes.push({ id: next("notification_id"), notification_number: `NTF-SEED${notes.length + 1}`, recipient_type: "CUSTOMER", customer_id: cust.customerId, notification_type: type, title, message, severity: extra.severity ?? "INFO", action_required: extra.action ?? false, is_read: ts < now - 3 * DAY, created_at: new Date(ts), ...extra.link });

    for (const ev of events) {
        const s = sims[ev.sim];
        const ts = ev.ts;
        if (ev.kind === "salary") {
            s.balance += ev.amount!;
            txns.push(depositDoc(next("transaction_id"), s, ev.amount!, "Salary credit", ts, s.balance));
            continue;
        }
        if (ev.kind === "fail") { s.attempts.push({ ts: ts / 1000, amount: 0, status: "F" }); continue; }

        const date = new Date(ts), hour = localHour(date);
        const rec = ev.kind === "p2p" ? sims[ev.recipientSim!] : null;
        const merchant = ev.kind === "merchant" ? MERCHANTS[ev.merchantIdx!] : null;
        let amount = ev.amount ?? r2(Math.max(500, s.balance * (ev.balanceFrac ?? 0.2)));
        if (amount > s.balance) { if (ev.fraud) amount = r2(s.balance * 0.9); else { s.attempts.push({ ts: ts / 1000, amount, status: "F" }); continue; } }
        if (amount < 10) continue;
        const recipientKey = rec ? rec.accountNumber : `m:${merchant!.id}`;
        const category = rec ? "Transfers" : merchant!.category;
        const fan = rec ? [...(fanIn.get(recipientKey)?.entries() ?? [])].filter(([sid, t]) => sid !== s.customerId && ts - t <= DAY).length : 0;
        const ctx = { ts: ts / 1000, hour, amount, balanceBefore: s.balance, accountCreatedTs: s.accountCreated / 1000, device: ev.device ?? s.devices[0], location: ev.location ?? s.person.city, recipient: recipientKey, category, isP2P: Boolean(rec), fanIn: fan };
        const features = computeFeatures(s.profile, s.attempts, ctx);
        const mlRes = mlOn ? await predictRisk(features) : null;
        const risk = assess(features, rules, thresholds, mlRes, { mlEnabled: true });
        stats.total++;
        if (risk.decision === "HOLD") stats.hold++; else if (risk.decision === "BLOCK") stats.block++; else if (risk.decision === "ALLOW_NOTIFY") stats.notify++;

        const isFraud = Boolean(ev.fraud);
        const open = ts >= start + OPEN_AFTER_DAY * DAY;
        const slipped = isFraud && risk.decision !== "HOLD" && risk.decision !== "BLOCK";
        const needsAlert = risk.createAlert || slipped;
        let status: string = risk.decision === "BLOCK" ? "BLOCKED" : risk.decision === "HOLD" ? "HELD" : "COMPLETED";
        let review: "FRAUD" | "LEGIT" | null = null, completedAt: Date | null = status === "COMPLETED" ? date : null;
        let moved = status === "COMPLETED";
        let resolution: "CONFIRMED_FRAUD" | "FALSE_POSITIVE" | null = null;

        if (needsAlert && !open) {
            if (isFraud) { resolution = "CONFIRMED_FRAUD"; review = "FRAUD"; if (status === "HELD") status = "CANCELLED"; }
            else { resolution = "FALSE_POSITIVE"; review = "LEGIT"; if (status === "HELD") { status = "COMPLETED"; moved = true; completedAt = new Date(ts + 25 * 60000); } }
        } else if (!needsAlert && !isFraud && rnd() < 0.04) review = "LEGIT"; // analyst QA sample
        if (isFraud) isFraud && (slipped ? fraudMissed++ : fraudCaught++);

        const txnId = next("transaction_id");
        let senderAfter: number | null = null, recAfter: number | null = null;
        if (moved) {
            s.balance = r2(s.balance - amount); senderAfter = s.balance;
            if (rec) { rec.balance = r2(rec.balance + amount); recAfter = rec.balance; }
        }
        txns.push({
            id: txnId, transaction_number: `CF${new Date(ts).toISOString().slice(2, 10).replace(/-/g, "")}${String(txnId).padStart(10, "0")}`,
            customer_id: s.customerId, sender_name: s.person.name, sender_account_number: s.accountNumber,
            recipient_customer_id: rec?.customerId ?? null, recipient_account_number: rec?.accountNumber ?? null,
            recipient_name: rec ? rec.person.name : merchant!.name, merchant_id: merchant?.id ?? null, amount, currency: "INR",
            transaction_type: rec ? "BANK_TRANSFER" : "MERCHANT_PAYMENT", payment_mode: rec ? (amount > 100000 ? "IMPS" : pick(["UPI", "UPI", "IMPS"])) : "UPI",
            category, remarks: ev.remarks ?? (merchant ? merchant.name : ""), status, location: ctx.location, device_id: ctx.device, ip_address: "10.0.0." + (ev.sim + 10),
            risk_score: risk.finalScore, risk_level: risk.riskLevel, rule_score: risk.ruleScore, ml_score: risk.mlScore, ml_probability: mlRes?.fraud_probability ?? null,
            ml_anomaly: mlRes?.anomaly_score ?? null, ml_model_version: mlRes?.model_version ?? null, ml_available: risk.mlAvailable, ml_features: features,
            risk_reasons: risk.hits.map(h => ({ code: h.code, title: h.title, detail: h.detail, points: h.points })), ml_drivers: mlRes?.risk_drivers ?? [], decision: risk.decision,
            review_decision: review, reviewed_by: review ? analyst1.id : null, reviewed_at: review ? new Date(ts + 40 * 60000) : null,
            customer_response: isFraud && !open ? "NOT_ME" : null, sender_balance_after: senderAfter, recipient_balance_after: recAfter, created_at: date, completed_at: completedAt
        });

        s.attempts.push({ ts: ts / 1000, amount, status: status === "COMPLETED" || (status === "CANCELLED" ? false : false) ? "C" : risk.decision === "HOLD" ? "H" : risk.decision === "BLOCK" ? "B" : "C" });
        if (moved) applyToProfile(s.profile, { amount, hour, device: ctx.device, location: ctx.location, recipient: recipientKey, category });
        if (rec) { const m = fanIn.get(recipientKey) ?? new Map(); m.set(s.customerId, ts); fanIn.set(recipientKey, m); }
        if (rec && !isFraud) { const set = payees.get(String(s.customerId)) ?? new Set<number>(); set.add(ev.recipientSim!); payees.set(String(s.customerId), set); }

        if (needsAlert) {
            flagged++;
            const alertId = next("fraud_alert_id");
            const inReview = open && alerts.filter(a => a.status !== "RESOLVED").length === 1;
            const sev = slipped ? "HIGH" : risk.riskLevel;
            alerts.push({ id: alertId, alert_number: `ALR-SEED${String(alertId).padStart(4, "0")}`, transaction_id: txnId, customer_id: s.customerId, risk_score: Math.max(risk.finalScore, slipped ? 60 : 0), rule_score: risk.ruleScore, ml_score: risk.mlScore, severity: sev,
                status: resolution ? "RESOLVED" : inReview ? "IN_REVIEW" : "NEW", assigned_to: resolution || inReview ? (alertId % 2 ? analyst1.id : analyst2.id) : null, resolution,
                resolution_notes: resolution === "CONFIRMED_FRAUD" ? (slipped ? `Reported by customer after the fact (${ev.fraud}).` : `Confirmed ${ev.fraud}: ${risk.hits.map(h => h.title).join(", ") || "model flagged"}.`) : resolution ? `Verified with customer - genuine ${ev.legitTag ?? "activity"}.` : null,
                customer_response: isFraud && !open ? "NOT_ME" : null, created_at: date, updated_at: new Date(ts + 30 * 60000), resolved_at: resolution ? new Date(ts + 40 * 60000) : null });
            invest.push({ id: next("investigation_id"), alert_id: alertId, actor_name: "System", action: "CREATED", notes: `Alert opened automatically (${risk.decision}, score ${risk.finalScore}).`, created_at: date });
            if (resolution) invest.push({ id: next("investigation_id"), alert_id: alertId, actor_id: analyst1.id, actor_name: analyst1.name, action: "DECISION", notes: alerts[alerts.length - 1].resolution_notes, created_at: new Date(ts + 40 * 60000) });
            if (open) notes.push({ id: next("notification_id"), notification_number: `NTF-SEEDS${alertId}`, recipient_type: "STAFF", alert_id: alertId, transaction_id: txnId, notification_type: "FRAUD_ALERT", title: `${sev} risk payment`, message: `${s.person.name}: ₹${amount.toLocaleString("en-IN")} → ${rec ? rec.person.name : merchant!.name} (${risk.decision}, score ${risk.finalScore}).`, severity: sev === "CRITICAL" ? "CRITICAL" : "WARNING", is_read: false, created_at: date });
        }
        if (ts > now - 10 * DAY) {
            const link = { transaction_id: txnId };
            if (status === "HELD") note(s, "PAYMENT_HELD", "Your payment is on hold", `We are reviewing your ₹${amount.toLocaleString("en-IN")} payment to ${txns[txns.length - 1].recipient_name} for your safety.`, ts, { severity: "WARNING", action: true, link });
            else if (status === "BLOCKED") note(s, "PAYMENT_DECLINED", "Payment declined for your safety", `We declined a ₹${amount.toLocaleString("en-IN")} payment. If this was not you, tell us right away.`, ts, { severity: "CRITICAL", action: !resolution, link });
            else if (moved) {
                note(s, "DEBIT", `₹${amount.toLocaleString("en-IN")} debited`, `Paid to ${txns[txns.length - 1].recipient_name}. Balance ₹${(senderAfter ?? 0).toLocaleString("en-IN")}.`, ts, { link });
                if (rec) note(rec, "CREDIT", `₹${amount.toLocaleString("en-IN")} received`, `From ${s.person.name}. Balance ₹${(recAfter ?? 0).toLocaleString("en-IN")}.`, ts, { link });
            }
        }
    }

    // ---- persist ----------------------------------------------------------------------------------
    sims.forEach((s, i) => { accounts[i].balance_paise = Math.max(0, Math.round(s.balance * 100)); });
    sims.forEach((s, i) => { if (i !== MULE) s.profile.count >= 0; });
    flaggedCustomerRisk(customers, sims, alerts);
    await User.insertMany(users); await Customer.insertMany(customers); await Account.insertMany(accounts);
    await Transaction.insertMany(txns, { ordered: false }); await FraudAlert.insertMany(alerts); await Investigation.insertMany(invest); await Notification.insertMany(notes);
    const bene: any[] = [];
    for (const [cid, set] of payees) for (const j of set) bene.push({ id: next("beneficiary_id"), customer_id: Number(cid), account_number: recipientAccountOf(j), name: sims[j].person.name });
    if (bene.length) await Beneficiary.insertMany(bene);
    await Setting.insertMany(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })));
    await AuditLog.insertMany([
        { actor_id: staff[0].id, actor_name: staff[0].name, actor_role: "ADMIN", action: "ACCOUNT_APPROVED", summary: "Seed data: demo customers approved", created_at: new Date(start) },
        { actor_id: analyst1.id, actor_name: analyst1.name, actor_role: "FRAUD_ANALYST", action: "ALERT_RESOLVED", summary: `Seed data: ${alerts.filter(a => a.status === "RESOLVED").length} alerts resolved`, created_at: new Date(now - 2 * DAY) }
    ]);
    await Counter.insertMany(Object.entries(counters).map(([name, seq]) => ({ name, seq })));

    const open = alerts.filter(a => a.status !== "RESOLVED").length;
    console.log(`\nSeeded ${PEOPLE.length} customers, ${txns.length} transactions, ${alerts.length} alerts (${open} open), ${bene.length} payees.`);
    console.log(`Pipeline decisions - ALLOW_NOTIFY ${stats.notify}, HOLD ${stats.hold}, BLOCK ${stats.block} of ${stats.total}. Fraud caught ${fraudCaught}, slipped through ${fraudMissed}.`);
    console.log(`Labelled for ML feedback: ${txns.filter(t => t.review_decision).length}`);
    console.log("\nDemo logins");
    console.log(`  Admin     admin@certiflow.test    / ${DEMO.adminPassword}`);
    console.log(`  Analyst   analyst@certiflow.test  / ${DEMO.staffPassword}`);
    console.log(`  Customer  aarav@certiflow.test    / ${DEMO.customerPassword}   (transaction PIN ${DEMO.pin})`);
    console.log(`  Pending applications: neha.verma@certiflow.test, siddharth@certiflow.test (approve them as admin)`);
    await mongoose.disconnect();
    process.exit(0);
};

const depositDoc = (id: number, s: Sim, amount: number, remarks: string, ts: number, balanceAfter: number) => ({
    id, transaction_number: `CF${new Date(ts).toISOString().slice(2, 10).replace(/-/g, "")}${String(id).padStart(10, "0")}`, customer_id: SYSTEM_CUSTOMER_ID, sender_name: SYSTEM_NAME,
    recipient_customer_id: s.customerId, recipient_account_number: s.accountNumber, recipient_name: s.person.name, amount, transaction_type: "DEPOSIT", payment_mode: "BANK",
    category: "Deposit", remarks, status: "COMPLETED", decision: "ALLOW", recipient_balance_after: balanceAfter, created_at: new Date(ts), completed_at: new Date(ts)
});

const flaggedCustomerRisk = (customers: any[], sims: Sim[], alerts: any[]) => {
    for (const a of alerts) {
        const c = customers.find(x => x.id === a.customer_id);
        if (c && a.resolution === "CONFIRMED_FRAUD") c.risk_level = "HIGH";
        else if (c && c.risk_level === "LOW" && a.severity !== "LOW") c.risk_level = "MEDIUM";
    }
    void sims; void BANK_NAME;
};

main().catch(error => { console.error("Seed failed:", error); process.exit(1); });
