import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import mongoose from "mongoose";
import { env } from "../config/env";
import { isDatabaseReady, runInTransaction } from "../config/database";
import Account from "../models/Account";
import AuditLog from "../models/AuditLog";
import Customer from "../models/Customer";
import FraudAlert from "../models/FraudAlert";
import Transaction from "../models/Transaction";
import User from "../models/User";
import { getNextSequence } from "../utils/counter";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { roundMoney } from "../utils/ids";
import { escapeRegex, paging } from "../utils/validate";
import { localDateKey, startOfLocalDay } from "../utils/time";
import { audit, Actor } from "./auditService";
import { accountView, creditFromBank, openAccount } from "./accountService";
import { forceLogout } from "./authService";
import { loadProfile } from "./behaviorService";
import { mlHealth, mlRequest } from "./mlService";
import { announceNotification, createNotification, NotificationInput } from "./notificationService";
import { dropProfile } from "./redis/behavior";
import { redisStatus, getRedis } from "./redis/client";
import { connectedClients } from "./redis/events";
import { bumpEpoch, cached, getEpoch, K, readMetrics } from "./redis/primitives";
import { countActiveSessions, listSessions } from "./redis/sessions";
import { staffView } from "./transactionViews";
import { customerNames } from "./transactionQueries";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

// ------------------------------------------------------------------ overview
export const overview = async () => {
    const epoch = await getEpoch("admin");
    return cached(K("cache", "admin-overview", epoch), 20, computeOverview);
};

const computeOverview = async () => {
    const now = new Date();
    const dayStart = startOfLocalDay(now);
    const since30 = new Date(now.getTime() - 30 * 86400000);
    const since14 = new Date(now.getTime() - 14 * 86400000);
    const dayKey = { $dateToString: { format: "%Y-%m-%d", date: "$created_at", timezone: env.timezone } };
    const real = { transaction_type: { $ne: "DEPOSIT" } };

    const [custByStatus, deposits, today, volume, risk, protectedAmt, alertsOpen, resolved, topRisky, recentAlerts, activeStaff, byDecision] = await Promise.all([
        Customer.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
        Account.aggregate([{ $group: { _id: null, sum: { $sum: "$balance_paise" }, n: { $sum: 1 } } }]),
        Transaction.aggregate([{ $match: { ...real, created_at: { $gte: dayStart } } }, { $group: { _id: "$status", n: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
        Transaction.aggregate([{ $match: { ...real, created_at: { $gte: since14 } } }, { $group: { _id: { d: dayKey, s: "$status" }, n: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
        Transaction.aggregate([{ $match: { ...real, status: { $ne: "FAILED" }, created_at: { $gte: since30 } } }, { $group: { _id: "$risk_level", n: { $sum: 1 } } }]),
        Transaction.aggregate([{ $match: { ...real, created_at: { $gte: since30 }, $or: [{ status: { $in: ["BLOCKED", "CANCELLED"] }, review_decision: { $ne: "LEGIT" } }, { status: "HELD" }] } }, { $group: { _id: null, sum: { $sum: "$amount" }, n: { $sum: 1 } } }]),
        FraudAlert.countDocuments({ status: { $ne: "RESOLVED" } }),
        FraudAlert.aggregate([{ $match: { status: "RESOLVED" } }, { $group: { _id: "$resolution", n: { $sum: 1 } } }]),
        FraudAlert.aggregate([{ $match: { created_at: { $gte: since30 } } }, { $group: { _id: "$customer_id", alerts: { $sum: 1 }, max: { $max: "$risk_score" } } }, { $sort: { alerts: -1, max: -1 } }, { $limit: 5 }]),
        FraudAlert.find().sort({ created_at: -1 }).limit(6).lean(),
        User.countDocuments({ role: { $ne: "USER" }, status: "ACTIVE" }),
        Transaction.aggregate([{ $match: { ...real, created_at: { $gte: since30 } } }, { $group: { _id: "$decision", n: { $sum: 1 } } }])
    ]);

    const cs = (k: string) => custByStatus.find(c => c._id === k)?.n ?? 0;
    const td = (k: string) => today.find(t => t._id === k) ?? { n: 0, amount: 0 };
    const fp = resolved.find(r => r._id === "FALSE_POSITIVE")?.n ?? 0, fr = resolved.find(r => r._id === "CONFIRMED_FRAUD")?.n ?? 0;

    const days: string[] = [];
    for (let i = 13; i >= 0; i--) days.push(localDateKey(new Date(now.getTime() - i * 86400000)));
    const series = days.map(date => {
        const pick = (s: string) => volume.find(v => v._id.d === date && v._id.s === s);
        return { date, completed: pick("COMPLETED")?.n ?? 0, amount: roundMoney(pick("COMPLETED")?.amount ?? 0), held: pick("HELD")?.n ?? 0, blocked: pick("BLOCKED")?.n ?? 0 };
    });

    const names = await customerNames([...topRisky.map(t => t._id), ...recentAlerts.map(a => a.customer_id)]);
    return {
        customers: { total: custByStatus.reduce((s, c) => s + c.n, 0), active: cs("ACTIVE"), pending: cs("PENDING"), suspended: cs("SUSPENDED"), rejected: cs("REJECTED") },
        accounts: deposits[0]?.n ?? 0, total_deposits: roundMoney((deposits[0]?.sum ?? 0) / 100),
        today: { completed: td("COMPLETED").n, volume: roundMoney(td("COMPLETED").amount), held: td("HELD").n, blocked: td("BLOCKED").n, failed: td("FAILED").n },
        open_alerts: alertsOpen, confirmed_fraud: fr, false_positives: fp,
        false_positive_rate: fp + fr > 0 ? Math.round((fp / (fp + fr)) * 100) : null,
        protected_amount: roundMoney(protectedAmt[0]?.sum ?? 0), protected_count: protectedAmt[0]?.n ?? 0,
        staff_active: activeStaff, series,
        risk_distribution: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map(l => ({ level: l, count: risk.find(r => r._id === l)?.n ?? 0 })),
        decisions: ["ALLOW", "ALLOW_NOTIFY", "HOLD", "BLOCK"].map(d => ({ decision: d, count: byDecision.find(r => r._id === d)?.n ?? 0 })),
        top_risky_customers: topRisky.map(t => ({ customer_id: t._id, name: names.get(t._id) ?? "Unknown", alerts: t.alerts, max_score: t.max })),
        recent_alerts: recentAlerts.map(a => ({ id: a.id, alert_number: a.alert_number, severity: a.severity, status: a.status, risk_score: a.risk_score, customer_name: names.get(a.customer_id) ?? "Unknown", created_at: a.created_at }))
    };
};

// ----------------------------------------------------------------- customers
export const listCustomers = async (query: Record<string, any>) => {
    const { page, limit, skip } = paging(query, 15, 100);
    const filter: Record<string, any> = {};
    if (query.status && query.status !== "ALL") filter.status = query.status;
    if (query.risk && query.risk !== "ALL") filter.risk_level = query.risk;
    if (query.q) {
        const rx = { $regex: escapeRegex(String(query.q).slice(0, 60)), $options: "i" };
        const accs = await Account.find({ account_number: rx }).select("customer_id").limit(50).lean();
        filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { customer_number: rx }, { id: { $in: accs.map(a => a.customer_id) } }];
    }
    const [rows, total] = await Promise.all([Customer.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(), Customer.countDocuments(filter)]);
    const accounts = await Account.find({ customer_id: { $in: rows.map(r => r.id) } }).lean();
    const am = new Map(accounts.map(a => [a.customer_id, a]));
    return {
        items: rows.map(c => ({ ...c, account: am.get(c.id) ? accountView(am.get(c.id)) : null })),
        total, page, pages: Math.max(1, Math.ceil(total / limit))
    };
};

export const customerDetail = async (id: number) => {
    const customer = await Customer.findOne({ id }).lean();
    if (!customer) throw notFound("Customer not found");
    const [user, account, stats, recent, alerts] = await Promise.all([
        User.findOne({ id: customer.user_id }).select("status last_login_at last_login_ip locked_until pin_hash pin_locked_until").lean(),
        Account.findOne({ customer_id: id }).lean(),
        Transaction.aggregate([{ $match: { customer_id: id, status: "COMPLETED", transaction_type: { $ne: "DEPOSIT" } } }, { $group: { _id: null, n: { $sum: 1 }, volume: { $sum: "$amount" } } }]),
        Transaction.find({ $or: [{ customer_id: id }, { recipient_customer_id: id, status: "COMPLETED" }] }).sort({ created_at: -1 }).limit(10).lean(),
        FraudAlert.find({ customer_id: id }).sort({ created_at: -1 }).limit(10).lean()
    ]);
    const profile = await loadProfile(id);
    const sessions = await listSessions(customer.user_id);
    const names = await customerNames([id, ...recent.map(r => r.customer_id)]);
    return {
        customer, account: account ? accountView(account) : null,
        user: user && { status: user.status, last_login_at: user.last_login_at, last_login_ip: user.last_login_ip, login_locked: Boolean(user.locked_until && user.locked_until > new Date()), pin_set: Boolean(user.pin_hash), pin_locked: Boolean(user.pin_locked_until && user.pin_locked_until > new Date()) },
        stats: { transactions: stats[0]?.n ?? 0, volume: roundMoney(stats[0]?.volume ?? 0) },
        behaviour: { history_count: profile.count, average_amount: profile.count ? Math.round(profile.total / profile.count) : 0, largest_amount: profile.max_amount, devices: profile.devices.length, locations: profile.locations, known_recipients: profile.recipients.length },
        sessions: sessions.map(s => ({ ip: s.ip, device_id: s.deviceId, user_agent: s.userAgent, created_at: s.createdAt })),
        recent_transactions: recent.map(t => staffView(t, names)),
        alerts: alerts.map(a => ({ id: a.id, alert_number: a.alert_number, severity: a.severity, status: a.status, risk_score: a.risk_score, resolution: a.resolution, created_at: a.created_at }))
    };
};

const notify = async (customer: any, input: Partial<NotificationInput>) => {
    const full = { recipientType: "CUSTOMER", customerId: customer.id, userId: customer.user_id, type: "ACCOUNT", title: "", message: "", ...input } as NotificationInput;
    announceNotification(full, await createNotification(full));
};

export const approveRequest = async (id: number, body: { account_type: "SAVINGS" | "CURRENT"; opening_balance: number }, actor: Actor) => {
    const customer = await Customer.findOne({ id });
    if (!customer) throw notFound("Customer not found");
    if (customer.status !== "PENDING") throw conflict("This application has already been reviewed", "ALREADY_REVIEWED");
    const account = await runInTransaction(async session => {
        customer.status = "ACTIVE"; customer.reviewed_by = actor.id; customer.reviewed_at = new Date(); customer.rejection_reason = null;
        await customer.save({ session });
        return openAccount(customer.id, body.account_type, body.opening_balance, session);
    });
    await notify(customer, { title: "Welcome to CertiFlow!", message: `Your ${body.account_type.toLowerCase()} account ${account.account_number} is open. Set your transaction PIN in Profile to start paying.`, severity: "INFO" });
    await bumpEpoch("admin");
    audit(actor, "ACCOUNT_APPROVED", { type: "customer", id }, `Approved ${customer.name} (${body.account_type}, opening ${inr(body.opening_balance)})`);
    return { customer_id: id, account_number: account.account_number };
};

export const rejectRequest = async (id: number, reason: string, actor: Actor) => {
    const customer = await Customer.findOne({ id });
    if (!customer) throw notFound("Customer not found");
    if (customer.status !== "PENDING") throw conflict("This application has already been reviewed", "ALREADY_REVIEWED");
    customer.status = "REJECTED"; customer.rejection_reason = reason; customer.reviewed_by = actor.id; customer.reviewed_at = new Date();
    await customer.save();
    await bumpEpoch("admin");
    audit(actor, "ACCOUNT_REJECTED", { type: "customer", id }, `Rejected ${customer.name}: ${reason}`);
};

export const setCustomerStatus = async (id: number, status: "ACTIVE" | "SUSPENDED", reason: string, actor: Actor) => {
    const customer = await Customer.findOne({ id });
    if (!customer) throw notFound("Customer not found");
    if (customer.status !== "ACTIVE" && customer.status !== "SUSPENDED") throw badRequest("Only active or suspended customers can be changed");
    customer.status = status;
    await customer.save();
    if (status === "SUSPENDED") await forceLogout(customer.user_id);
    await notify(customer, { severity: status === "SUSPENDED" ? "CRITICAL" : "INFO", title: status === "SUSPENDED" ? "Your profile has been suspended" : "Your profile has been reinstated",
        message: status === "SUSPENDED" ? "Please contact CertiFlow support for assistance." : "You can use all banking services again." });
    await bumpEpoch("admin");
    audit(actor, status === "SUSPENDED" ? "CUSTOMER_SUSPENDED" : "CUSTOMER_REINSTATED", { type: "customer", id }, `${customer.name}: ${reason || "no reason given"}`);
};

export const setAccountStatus = async (id: number, status: "ACTIVE" | "BLOCKED", actor: Actor) => {
    const account = await Account.findOneAndUpdate({ customer_id: id, status: { $ne: "CLOSED" } }, { $set: { status } }, { new: true });
    if (!account) throw notFound("Account not found");
    await dropProfile(id);
    await bumpEpoch("admin", `cust:${id}`);
    audit(actor, status === "BLOCKED" ? "ACCOUNT_FROZEN" : "ACCOUNT_UNFROZEN", { type: "account", id: account.id }, `Account ${account.account_number} -> ${status}`);
};

export const setDailyLimit = async (id: number, limit: number, actor: Actor) => {
    if (!Number.isFinite(limit) || limit < 1000 || limit > 100000000) throw badRequest("Daily limit must be between ₹1,000 and ₹10,00,00,000");
    const account = await Account.findOneAndUpdate({ customer_id: id }, { $set: { daily_limit: limit } }, { new: true });
    if (!account) throw notFound("Account not found");
    audit(actor, "LIMIT_CHANGED", { type: "account", id: account.id }, `Daily limit set to ${inr(limit)}`);
};

export const setRiskLevel = async (id: number, level: "LOW" | "MEDIUM" | "HIGH", actor: Actor) => {
    const c = await Customer.findOneAndUpdate({ id }, { $set: { risk_level: level } });
    if (!c) throw notFound("Customer not found");
    audit(actor, "RISK_LEVEL_CHANGED", { type: "customer", id }, `${c.name}: ${c.risk_level} -> ${level}`);
};

export const unlockCustomer = async (id: number, actor: Actor) => {
    const c = await Customer.findOne({ id }).lean();
    if (!c) throw notFound("Customer not found");
    await User.updateOne({ id: c.user_id }, { $set: { locked_until: null, failed_login_count: 0, pin_locked_until: null, pin_failed_count: 0 } });
    audit(actor, "CUSTOMER_UNLOCKED", { type: "customer", id }, `Cleared login/PIN lock for ${c.name}`);
};

export const forceLogoutCustomer = async (id: number, actor: Actor) => {
    const c = await Customer.findOne({ id }).lean();
    if (!c) throw notFound("Customer not found");
    await forceLogout(c.user_id);
    audit(actor, "FORCE_LOGOUT", { type: "customer", id }, `Signed ${c.name} out of all devices`);
};

export const depositFunds = async (id: number, amount: number, remarks: string, actor: Actor) => {
    const customer = await Customer.findOne({ id });
    const account = await Account.findOne({ customer_id: id });
    if (!customer || !account) throw notFound("Customer or account not found");
    if (account.status !== "ACTIVE") throw badRequest("Cannot deposit into a blocked account");
    const { account: updated, transaction } = await runInTransaction(session => creditFromBank(account, amount, remarks || "Cash deposit", session));
    await notify(customer, { type: "CREDIT", title: `${inr(amount)} deposited`, message: `${remarks || "Cash deposit"}. Ref ${transaction.transaction_number}. Balance ${inr(updated.balance_paise / 100)}.`, transactionId: transaction.id });
    await bumpEpoch("admin", `cust:${id}`);
    audit(actor, "FUNDS_DEPOSITED", { type: "account", id: account.id }, `${inr(amount)} deposited for ${customer.name}`, { reference: transaction.transaction_number });
    return { balance: updated.balance_paise / 100, reference: transaction.transaction_number };
};

// --------------------------------------------------------------------- staff
const tempPassword = () => `${randomBytes(6).toString("base64url")}A9`;

export const listStaff = async () => {
    const staff = await User.find({ role: { $ne: "USER" } }).sort({ id: 1 }).select("id name email role status last_login_at created_at must_change_password locked_until").lean();
    return staff.map(s => ({ ...s, locked: Boolean(s.locked_until && s.locked_until > new Date()) }));
};

export const createStaff = async (body: { name: string; email: string; role: "FRAUD_ANALYST" | "ADMIN"; password?: string }, actor: Actor) => {
    if (await User.exists({ email: body.email })) throw conflict("A user with this email already exists", "EMAIL_EXISTS");
    const password = body.password || tempPassword();
    const user = await User.create({ id: await getNextSequence("user_id"), name: body.name, email: body.email, role: body.role,
        password_hash: await bcrypt.hash(password, 12), must_change_password: true, created_by: actor.id });
    audit(actor, "STAFF_CREATED", { type: "user", id: user.id }, `${body.role} account created for ${body.name}`);
    return { id: user.id, name: user.name, email: user.email, role: user.role, temporary_password: password };
};

const activeAdmins = () => User.countDocuments({ role: "ADMIN", status: "ACTIVE" });

export const updateStaff = async (id: number, patch: { name?: string; role?: "FRAUD_ANALYST" | "ADMIN"; status?: "ACTIVE" | "DISABLED" }, actor: Actor) => {
    const user = await User.findOne({ id, role: { $ne: "USER" } });
    if (!user) throw notFound("Staff member not found");
    const demotes = patch.role && patch.role !== user.role && user.role === "ADMIN";
    const disables = patch.status === "DISABLED" && user.status === "ACTIVE";
    if (id === actor.id && (demotes || disables)) throw badRequest("You cannot disable or demote your own account", "SELF_CHANGE");
    if ((demotes || (disables && user.role === "ADMIN")) && (await activeAdmins()) <= 1) throw badRequest("At least one active administrator is required", "LAST_ADMIN");
    if (patch.name) user.name = patch.name;
    if (patch.role) user.role = patch.role;
    if (patch.status) user.status = patch.status;
    await user.save();
    if (disables || demotes) await forceLogout(user.id);
    audit(actor, "STAFF_UPDATED", { type: "user", id }, `${user.name}: ${JSON.stringify(patch)}`);
    return { id: user.id };
};

export const resetStaffPassword = async (id: number, actor: Actor) => {
    const user = await User.findOne({ id, role: { $ne: "USER" } });
    if (!user) throw notFound("Staff member not found");
    const password = tempPassword();
    user.password_hash = await bcrypt.hash(password, 12);
    user.must_change_password = true; user.locked_until = null; user.failed_login_count = 0;
    await user.save();
    await forceLogout(user.id);
    audit(actor, "STAFF_PASSWORD_RESET", { type: "user", id }, `Password reset for ${user.name}`);
    return { temporary_password: password };
};

// ------------------------------------------------------------------ audit log
export const listAudit = async (query: Record<string, any>) => {
    const { page, limit, skip } = paging(query, 25, 100);
    const filter: Record<string, any> = {};
    if (query.action && query.action !== "ALL") filter.action = query.action;
    if (query.actor_role && query.actor_role !== "ALL") filter.actor_role = query.actor_role;
    if (query.q) filter.$or = [{ summary: { $regex: escapeRegex(String(query.q).slice(0, 60)), $options: "i" } }, { actor_name: { $regex: escapeRegex(String(query.q).slice(0, 60)), $options: "i" } }];
    const [items, total, actions] = await Promise.all([
        AuditLog.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(), AuditLog.countDocuments(filter), AuditLog.distinct("action")
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)), actions: actions.sort() };
};

// -------------------------------------------------------------- system health
export const systemHealth = async () => {
    const mongoStarted = Date.now();
    let mongo: any = { up: false };
    try {
        if (isDatabaseReady()) {
            await mongoose.connection.db!.admin().ping();
            mongo = { up: true, latencyMs: Date.now() - mongoStarted, database: mongoose.connection.name, transactions: env.mongoTransactions };
        }
    } catch (error) { mongo = { up: false, error: (error as Error).message }; }

    const r = getRedis();
    let redis: any = { up: false, ...redisStatus() };
    if (r) {
        try {
            const [latency, info, keys, sessions] = await Promise.all([r.ping(), r.info(), r.dbSize(), countActiveSessions()]);
            const hits = Number(info.keyspace_hits ?? 0), misses = Number(info.keyspace_misses ?? 0);
            redis = { up: true, latencyMs: latency, version: info.redis_version, uptimeSeconds: Number(info.uptime_in_seconds ?? 0), memory: info.used_memory_human, peakMemory: info.used_memory_peak_human,
                clients: Number(info.connected_clients ?? 0), keys, hitRate: hits + misses ? Math.round((hits / (hits + misses)) * 1000) / 10 : null, activeSessions: sessions, sseClients: connectedClients(), evictedKeys: Number(info.evicted_keys ?? 0) };
        } catch (error) { redis = { up: false, error: (error as Error).message }; }
    }
    const metrics = await readMetrics(["cache_hit", "cache_miss", "rate_limited", "profile_hit", "profile_rebuild", "ml_calls", "ml_failures", "decision_allow", "decision_allow_notify", "decision_hold", "decision_block", "txn_failed"]);
    return { mongo, redis, ml: await mlHealth(), metrics, app: { uptimeSeconds: Math.round(process.uptime()), node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1048576), env: env.nodeEnv }, checked_at: new Date() };
};

// ----------------------------------------------------------------------- ML ops
export const mlOverview = async () => {
    const [info, stats, labelled] = await Promise.all([
        mlRequest("/model-info").catch(e => ({ error: (e as Error).message })),
        mlRequest("/stats").catch(() => null),
        feedbackCounts()
    ]);
    return { model: info, live: stats, feedback: labelled };
};

const feedbackCounts = async () => {
    const rows = await Transaction.aggregate([{ $match: { review_decision: { $ne: null }, ml_features: { $ne: null } } }, { $group: { _id: "$review_decision", n: { $sum: 1 } } }]);
    const fraud = rows.find(r => r._id === "FRAUD")?.n ?? 0, legit = rows.find(r => r._id === "LEGIT")?.n ?? 0;
    return { fraud, legit, total: fraud + legit, ready: fraud + legit >= 20 && fraud >= 3 && legit >= 3 };
};

export const startRetrain = async (actor: Actor) => {
    const counts = await feedbackCounts();
    if (!counts.ready) throw badRequest(`Need at least 20 analyst-labelled transactions with 3+ fraud and 3+ legitimate. Currently ${counts.total} (${counts.fraud} fraud / ${counts.legit} legitimate).`, "NOT_ENOUGH_FEEDBACK");
    const rows = await Transaction.find({ review_decision: { $ne: null }, ml_features: { $ne: null } }).sort({ reviewed_at: -1 }).limit(5000).select("ml_features review_decision").lean();
    const feedback = rows.map(r => ({ features: r.ml_features, is_fraud: r.review_decision === "FRAUD" ? 1 : 0 }));
    const result = await mlRequest("/retrain", "POST", { feedback }, 15000);
    audit(actor, "ML_RETRAIN_STARTED", { type: "model" }, `Retraining started with ${feedback.length} analyst labels`);
    return result;
};

export const mlProxy = {
    status: () => mlRequest("/retrain/status"),
    drift: () => mlRequest("/drift"),
    rollback: async (version: number, actor: Actor) => {
        const result = await mlRequest("/rollback", "POST", { version });
        audit(actor, "ML_ROLLBACK", { type: "model", id: version }, `Model v${version} activated`);
        return result;
    }
};
