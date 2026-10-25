/**
 * Fraud analyst workflow: queue, claim (distributed lock), decisions, customer responses.
 * A decision on a HELD payment either releases the money or cancels it; every decision becomes
 * a training label (review_decision) used by the ML feedback loop.
 */
import Account from "../models/Account";
import Customer from "../models/Customer";
import FraudAlert from "../models/FraudAlert";
import Investigation from "../models/Investigation";
import Transaction from "../models/Transaction";
import User from "../models/User";
import { runInTransaction } from "../config/database";
import { getNextSequence } from "../utils/counter";
import { AppError, badRequest, conflict, forbidden, notFound } from "../utils/httpError";
import { escapeRegex, paging } from "../utils/validate";
import { audit, Actor } from "./auditService";
import { announceNotification, createNotification, NotificationInput } from "./notificationService";
import { publishEvent } from "./redis/events";
import { bumpEpoch, tryLock, unlockIfOwner } from "./redis/primitives";
import * as behavior from "./behaviorService";
import { dropProfile } from "./redis/behavior";
import { localHour } from "../utils/time";
import { staffView } from "./transactionViews";
import { revokeAllSessions } from "./redis/sessions";
import { generateAlertNumber } from "../utils/ids";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * Self-heal legacy/inconsistent data: every HELD or BLOCKED transaction should have
 * a fraud alert. This also repairs transactions created before alert persistence was fixed.
 */
const reconcileMissingTransactionAlerts = async () => {
    const transactions = await Transaction.find({ status: { $in: ["HELD", "BLOCKED"] } })
        .select("id customer_id risk_score rule_score ml_score risk_level decision created_at")
        .sort({ created_at: -1 })
        .limit(500)
        .lean();

    for (const txn of transactions) {
        const existing = await FraudAlert.findOne({ transaction_id: txn.id }).select("id").lean();
        if (existing) continue;

        const score = Number(txn.risk_score ?? 0);
        const severity = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(txn.risk_level))
            ? txn.risk_level
            : score >= 85 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW";
        try {
            const alert = await FraudAlert.create({
                id: await getNextSequence("fraud_alert_id"),
                alert_number: generateAlertNumber(),
                transaction_id: txn.id,
                customer_id: txn.customer_id,
                risk_score: score,
                rule_score: Number(txn.rule_score ?? 0),
                ml_score: txn.ml_score ?? null,
                severity,
                status: "NEW",
                created_at: txn.created_at ?? new Date(),
                updated_at: new Date()
            });
            await Investigation.create({
                id: await getNextSequence("investigation_id"),
                alert_id: alert.id,
                actor_id: null,
                actor_name: "System",
                action: "CREATED",
                notes: `Alert reconstructed for existing ${txn.status} transaction ${txn.id}.`
            });
            void publishEvent({ audience: "staff", type: "alert.created", data: { alert_id: alert.id, transaction_id: txn.id } });
        } catch (error: any) {
            // A concurrent request may have created the alert after our initial check.
            if (error?.code !== 11000) throw error;
        }
    }
};

export const listAlerts = async (query: Record<string, any>) => {
    await reconcileMissingTransactionAlerts();
    const { page, limit, skip } = paging(query, 20, 100);
    const filter: Record<string, any> = {};
    if (query.status && query.status !== "ALL") filter.status = query.status === "OPEN" ? { $in: ["NEW", "IN_REVIEW"] } : query.status;
    if (query.severity && query.severity !== "ALL") filter.severity = query.severity;
    if (query.assigned === "me" && query.userId) filter.assigned_to = Number(query.userId);
    if (query.q) {
        const customers = await Customer.find({ name: { $regex: escapeRegex(String(query.q)), $options: "i" } }).select("id").limit(50).lean();
        filter.$or = [{ alert_number: { $regex: escapeRegex(String(query.q)), $options: "i" } }, { customer_id: { $in: customers.map(c => c.id) } }];
    }
    const sevOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as Record<string, number>;
    const allMatchingAlerts = await FraudAlert.find(filter).lean();
    allMatchingAlerts.sort((x, y) =>
        (x.status === "RESOLVED" ? 1 : 0) - (y.status === "RESOLVED" ? 1 : 0) ||
        ((sevOrder[y.severity] ?? 0) - (sevOrder[x.severity] ?? 0)) ||
        (+new Date(y.created_at) - +new Date(x.created_at))
    );
    const total = allMatchingAlerts.length;
    const alerts = allMatchingAlerts.slice(skip, skip + limit);
    const [customers, txns, users] = await Promise.all([
        Customer.find({ id: { $in: alerts.map(a => a.customer_id) } }).select("id name").lean(),
        Transaction.find({ id: { $in: alerts.map(a => a.transaction_id) } }).select("id transaction_number amount status recipient_name location decision").lean(),
        User.find({ id: { $in: alerts.map(a => a.assigned_to).filter(Boolean) as number[] } }).select("id name").lean()
    ]);
    const cm = new Map(customers.map(c => [c.id, c.name])), tm = new Map(txns.map(t => [t.id, t])), um = new Map(users.map(u => [u.id, u.name]));
    const items = alerts.map(a => ({ ...a, customer_name: cm.get(a.customer_id) ?? "Unknown", assigned_name: a.assigned_to ? um.get(a.assigned_to) ?? null : null, transaction: tm.get(a.transaction_id) ?? null }));
    return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
};

export const alertStats = async () => {
    const [byStatus, bySeverity, resolved, avgResolution] = await Promise.all([
        FraudAlert.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
        FraudAlert.aggregate([{ $match: { status: { $ne: "RESOLVED" } } }, { $group: { _id: "$severity", n: { $sum: 1 } } }]),
        FraudAlert.aggregate([{ $match: { status: "RESOLVED" } }, { $group: { _id: "$resolution", n: { $sum: 1 } } }]),
        FraudAlert.aggregate([{ $match: { status: "RESOLVED", resolved_at: { $ne: null } } },
            { $group: { _id: null, ms: { $avg: { $subtract: ["$resolved_at", "$created_at"] } } } }])
    ]);
    const get = (rows: any[], k: string) => rows.find(r => r._id === k)?.n ?? 0;
    return {
        new: get(byStatus, "NEW"), in_review: get(byStatus, "IN_REVIEW"), resolved: get(byStatus, "RESOLVED"),
        open_by_severity: { CRITICAL: get(bySeverity, "CRITICAL"), HIGH: get(bySeverity, "HIGH"), MEDIUM: get(bySeverity, "MEDIUM"), LOW: get(bySeverity, "LOW") },
        confirmed_fraud: get(resolved, "CONFIRMED_FRAUD"), false_positives: get(resolved, "FALSE_POSITIVE"),
        avg_resolution_minutes: avgResolution[0]?.ms ? Math.round(avgResolution[0].ms / 60000) : null
    };
};

export const alertDetail = async (id: number) => {
    const alert = await FraudAlert.findOne({ id }).lean();
    if (!alert) throw notFound("Alert not found");
    const [txn, customer, account, timeline, recent, claim] = await Promise.all([
        Transaction.findOne({ id: alert.transaction_id }).lean(),
        Customer.findOne({ id: alert.customer_id }).lean(),
        Account.findOne({ customer_id: alert.customer_id }).lean(),
        Investigation.find({ alert_id: id }).sort({ created_at: 1 }).lean(),
        Transaction.find({ customer_id: alert.customer_id, transaction_type: { $ne: "DEPOSIT" } }).sort({ created_at: -1 }).limit(12).lean(),
        User.findOne({ id: alert.assigned_to ?? -1 }).select("name").lean()
    ]);
    if (!txn) throw notFound("Transaction for this alert is missing");
    const profile = await behavior.loadProfile(alert.customer_id);
    const names = new Map<number, string>([[alert.customer_id, customer?.name ?? "Unknown"]]);
    return {
        alert: { ...alert, assigned_name: claim?.name ?? null },
        transaction: staffView(txn, names),
        customer: customer && { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, city: customer.city, status: customer.status, risk_level: customer.risk_level, customer_number: customer.customer_number, since: customer.created_at },
        account: account && { account_number: account.account_number, balance: account.balance_paise / 100, status: account.status, daily_limit: account.daily_limit, opened_on: account.created_at },
        behaviour: {
            history_count: profile.count, average_amount: profile.count ? Math.round(profile.total / profile.count) : 0, largest_amount: profile.max_amount,
            devices: profile.devices.length, locations: profile.locations, known_recipients: profile.recipients.length,
            active_hours: profile.hours.map((c, h) => ({ hour: h, count: c }))
        },
        timeline, recent_transactions: recent.map(t => staffView(t, names))
    };
};

const notifyCustomer = async (customerUserId: number, customerId: number, txnId: number, alertId: number, input: Partial<NotificationInput>, session?: any) => {
    const full: NotificationInput = { recipientType: "CUSTOMER", customerId, userId: customerUserId, transactionId: txnId, alertId, type: "SECURITY_UPDATE", title: "", message: "", ...input } as NotificationInput;
    const doc = await createNotification(full, session);
    return { input: full, doc };
};

export const claimAlert = async (alertId: number, actor: Actor) => {
    const alert = await FraudAlert.findOne({ id: alertId });
    if (!alert) throw notFound("Alert not found");
    if (alert.status === "RESOLVED") throw conflict("This alert has already been resolved", "ALREADY_RESOLVED");
    const lock = await tryLock(`alert:${alertId}`, String(actor.id), CLAIM_TTL_MS);
    if (!lock.acquired) {
        const other = lock.owner ? await User.findOne({ id: Number(lock.owner) }).select("name").lean() : null;
        throw conflict(`${other?.name ?? "Another analyst"} is reviewing this alert right now`, "ALERT_LOCKED");
    }
    alert.status = "IN_REVIEW";
    alert.assigned_to = actor.id;
    alert.updated_at = new Date();
    await alert.save();
    await Investigation.create({ id: await getNextSequence("investigation_id"), alert_id: alertId, actor_id: actor.id, actor_name: actor.name, action: "CLAIMED", notes: "Started reviewing" });
    void publishEvent({ audience: "staff", type: "alert.updated", data: { alert_id: alertId, status: "IN_REVIEW", assigned_to: actor.id } });
    return { ok: true };
};

export const addNote = async (alertId: number, actor: Actor, notes: string) => {
    if (!(await FraudAlert.exists({ id: alertId }))) throw notFound("Alert not found");
    await Investigation.create({ id: await getNextSequence("investigation_id"), alert_id: alertId, actor_id: actor.id, actor_name: actor.name, action: "NOTE", notes });
};

export const decide = async (alertId: number, actor: Actor, body: { decision: "FALSE_POSITIVE" | "CONFIRMED_FRAUD"; notes: string; freezeAccount?: boolean }) => {
    const alert = await FraudAlert.findOne({ id: alertId });
    if (!alert) throw notFound("Alert not found");
    if (alert.status === "RESOLVED") throw conflict("This alert has already been resolved", "ALREADY_RESOLVED");
    const lock = await tryLock(`alert:${alertId}`, String(actor.id), CLAIM_TTL_MS);
    if (!lock.acquired) throw conflict("Another analyst is reviewing this alert right now", "ALERT_LOCKED");

    const txn = await Transaction.findOne({ id: alert.transaction_id });
    const customer = await Customer.findOne({ id: alert.customer_id });
    if (!txn || !customer) throw notFound("Related records not found");
    const fraud = body.decision === "CONFIRMED_FRAUD";
    const pending: { input: NotificationInput; doc: any }[] = [];
    let released = false;
    let releaseFailed: string | null = null;

    try {
        await runInTransaction(async session => {
            pending.length = 0; released = false; releaseFailed = null;
            if (txn.status === "HELD") {
                if (fraud) {
                    txn.status = "CANCELLED";
                    txn.failure_reason = "Cancelled after fraud review";
                    pending.push(await notifyCustomer(customer.user_id, customer.id, txn.id, alert.id, { type: "PAYMENT_CANCELLED", severity: "WARNING", title: "Payment cancelled for your safety",
                        message: `Our security team cancelled the held ${inr(txn.amount)} payment to ${txn.recipient_name}. No money left your account.` }, session));
                } else {
                    const paise = Math.round(txn.amount * 100);
                    const debited = await Account.findOneAndUpdate({ customer_id: customer.id, status: "ACTIVE", balance_paise: { $gte: paise } }, { $inc: { balance_paise: -paise } }, { new: true, session });
                    if (!debited) {
                        txn.status = "FAILED";
                        txn.failure_reason = "Insufficient balance or account blocked at release time";
                        releaseFailed = txn.failure_reason;
                        pending.push(await notifyCustomer(customer.user_id, customer.id, txn.id, alert.id, { type: "PAYMENT_FAILED", severity: "WARNING", title: "Payment could not be completed",
                            message: `Your held ${inr(txn.amount)} payment to ${txn.recipient_name} was approved but could not be completed because your balance changed.` }, session));
                    } else {
                        txn.sender_balance_after = debited.balance_paise / 100;
                        if (txn.recipient_account_number) {
                            const credited = await Account.findOneAndUpdate({ account_number: txn.recipient_account_number, status: "ACTIVE" }, { $inc: { balance_paise: paise } }, { new: true, session });
                            if (!credited) throw new AppError(409, "Recipient account is unavailable; release aborted", "PAYEE_BLOCKED");
                            txn.recipient_balance_after = credited.balance_paise / 100;
                            const rc = await Customer.findOne({ id: credited.customer_id }).lean();
                            pending.push(await notifyCustomer(rc?.user_id ?? 0, credited.customer_id, txn.id, alert.id, { type: "CREDIT", severity: "INFO", title: `${inr(txn.amount)} received`,
                                message: `From ${txn.sender_name}. Ref ${txn.transaction_number}.` }, session));
                        }
                        txn.status = "COMPLETED";
                        txn.completed_at = new Date();
                        released = true;
                        pending.push(await notifyCustomer(customer.user_id, customer.id, txn.id, alert.id, { type: "PAYMENT_RELEASED", severity: "INFO", title: "Your payment has been processed",
                            message: `Thanks for your patience. ${inr(txn.amount)} was sent to ${txn.recipient_name}. Ref ${txn.transaction_number}.` }, session));
                    }
                }
            } else if (txn.status === "BLOCKED" && !fraud) {
                pending.push(await notifyCustomer(customer.user_id, customer.id, txn.id, alert.id, { type: "SECURITY_UPDATE", title: "You can retry your payment",
                    message: `Our team reviewed the declined ${inr(txn.amount)} payment to ${txn.recipient_name} and cleared it. Please try the payment again.` }, session));
            } else if (fraud) {
                pending.push(await notifyCustomer(customer.user_id, customer.id, txn.id, alert.id, { type: "SECURITY_UPDATE", severity: "CRITICAL", title: "We are protecting your account",
                    message: `We confirmed suspicious activity involving the ${inr(txn.amount)} payment ${txn.transaction_number}. Our team will contact you. Please change your password and PIN.` }, session));
            }
            txn.review_decision = fraud ? "FRAUD" : "LEGIT";
            txn.reviewed_by = actor.id;
            txn.reviewed_at = new Date();
            await txn.save({ session });
            alert.status = "RESOLVED";
            alert.resolution = body.decision;
            alert.resolution_notes = body.notes;
            alert.assigned_to = alert.assigned_to ?? actor.id;
            alert.resolved_at = new Date();
            alert.updated_at = new Date();
            await alert.save({ session });
            await Investigation.create([{ id: await getNextSequence("investigation_id", session), alert_id: alert.id, actor_id: actor.id, actor_name: actor.name, action: "DECISION",
                notes: `${fraud ? "Confirmed fraud" : "Marked legitimate"}${released ? " - payment released" : ""}${releaseFailed ? ` - release failed: ${releaseFailed}` : ""}. ${body.notes}` }], { session });
            if (fraud) {
                customer.risk_level = "HIGH";
                await customer.save({ session });
                if (body.freezeAccount) await Account.updateOne({ customer_id: customer.id }, { $set: { status: "BLOCKED" } }, { session });
            }
        });
    } finally {
        await unlockIfOwner(`alert:${alertId}`, String(actor.id));
    }

    if (released) {
        const profile = await behavior.loadProfile(customer.id);
        await behavior.recordOutcome({ customerId: customer.id, profile, attempt: { ts: Date.now() / 1000, amount: txn.amount, status: "C" },
            completedDebit: { amount: txn.amount, hour: localHour(new Date()), device: txn.device_id, location: txn.location, recipient: (txn.recipient_account_number ?? txn.merchant_id ?? "unknown"), category: txn.category } });
    }
    if (fraud && body.freezeAccount) {
        await dropProfile(customer.id);
        await revokeAllSessions(customer.user_id);
    }
    for (const p of pending) announceNotification(p.input, p.doc);
    await bumpEpoch(`cust:${customer.id}`, "admin");
    void publishEvent({ audience: "staff", type: "alert.updated", data: { alert_id: alertId, status: "RESOLVED", resolution: body.decision } });
    void publishEvent({ audience: `user:${customer.user_id}`, type: "balance", data: { transaction_id: txn.id, status: txn.status } });
    audit(actor, "ALERT_RESOLVED", { type: "alert", id: alertId }, `${alert.alert_number}: ${body.decision}${released ? " (payment released)" : ""}`, { freeze: Boolean(body.freezeAccount) });
    return { ok: true, status: txn.status, released, release_failed: releaseFailed };
};

/** Customer answers "was this you?" from the notification / transaction screen. */
export const customerResponse = async (customer: any, txnId: number, response: "ME" | "NOT_ME") => {
    const txn = await Transaction.findOne({ id: txnId, customer_id: customer.id });
    if (!txn) throw notFound("Transaction not found");
    if (txn.customer_response) throw conflict("You have already responded to this payment", "ALREADY_RESPONDED");
    if (txn.review_decision) throw conflict("This payment has already been reviewed by our team", "ALREADY_REVIEWED");
    txn.customer_response = response;
    const alert = await FraudAlert.findOne({ transaction_id: txn.id });
    const staffNotes: NotificationInput[] = [];
    if (response === "NOT_ME") {
        if (txn.status === "HELD") { txn.status = "CANCELLED"; txn.failure_reason = "Cancelled - customer did not authorise"; }
        await Customer.updateOne({ id: customer.id }, { $set: { risk_level: "HIGH" } });
    }
    await txn.save();
    if (alert && alert.status !== "RESOLVED") {
        alert.customer_response = response;
        if (response === "NOT_ME") alert.severity = "CRITICAL";
        alert.updated_at = new Date();
        await alert.save();
        await Investigation.create({ id: await getNextSequence("investigation_id"), alert_id: alert.id, actor_id: null, actor_name: customer.name, action: "CUSTOMER_RESPONSE",
            notes: response === "ME" ? "Customer confirmed the payment was theirs." : "Customer says they did NOT make this payment." + (txn.status === "CANCELLED" ? " Held payment auto-cancelled." : "") });
    }
    staffNotes.push({ recipientType: "STAFF", alertId: alert?.id ?? null, transactionId: txn.id, type: "CUSTOMER_RESPONSE", severity: response === "NOT_ME" ? "CRITICAL" : "INFO",
        title: response === "NOT_ME" ? "Customer disowned a payment" : "Customer confirmed a payment",
        message: `${customer.name} said the ${inr(txn.amount)} payment ${txn.transaction_number} was ${response === "NOT_ME" ? "NOT" : ""} made by them.` });
    for (const n of staffNotes) announceNotification(n, await createNotification(n));
    void publishEvent({ audience: "staff", type: "alert.updated", data: { alert_id: alert?.id, customer_response: response } });
    await bumpEpoch(`cust:${customer.id}`, "admin");
    audit({ id: customer.user_id, name: customer.name, role: "USER" }, `CUSTOMER_${response}`, { type: "transaction", id: txn.id }, `Customer answered "${response}"`);
    return { ok: true, status: txn.status };
};

export const assertStaffCanAct = (actor: Actor) => { if (actor.role !== "FRAUD_ANALYST" && actor.role !== "ADMIN") throw forbidden(); };
export const invalidInput = badRequest;
