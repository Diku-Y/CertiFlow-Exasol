/**
 * Payment pipeline for bank transfers and merchant payments.
 *
 *  1. validate input, kill-switch, customer / account status
 *  2. idempotent replay (Idempotency-Key)            -> MongoDB unique index + Redis lock
 *  3. verify transaction PIN (attempt counting, lock-out)
 *  4. take a distributed lock on the sender's account (Redis)  -> serialises concurrent payments
 *  5. limits + balance checks
 *  6. behavioural features (Redis profile / attempts / fan-in, MongoDB fallback)
 *  7. ML score + business rules -> risk assessment -> ALLOW / ALLOW_NOTIFY / HOLD / BLOCK
 *  8. atomic persistence in a MongoDB transaction (ledger, balances, alert, notifications)
 *  9. post-commit: update Redis behaviour state, publish real-time events, bump caches, audit
 */
import { ClientSession } from "mongoose";
import Account from "../models/Account";
import Beneficiary from "../models/Beneficiary";
import Customer from "../models/Customer";
import FraudAlert from "../models/FraudAlert";
import Investigation from "../models/Investigation";
import Transaction, { ITransaction } from "../models/Transaction";
import { getMerchant, PAYMENT_MODES, PaymentMode, TRANSFER_CATEGORY, TXN_TYPES } from "../constants";
import { runInTransaction } from "../config/database";
import { RequestContext } from "../middleware/context";
import { getNextSequence } from "../utils/counter";
import { AppError, badRequest, forbidden, notFound } from "../utils/httpError";
import { generateAlertNumber, generateTransactionNumber, maskAccount, roundMoney } from "../utils/ids";
import { localHour, startOfLocalDay } from "../utils/time";
import { audit } from "./auditService";
import { verifyPin } from "./authService";
import * as behavior from "./behaviorService";
import { computeFeatures, type Features } from "./featureEngine";
import { predictRisk } from "./mlService";
import { announceNotification, createNotification, NotificationInput } from "./notificationService";
import { publishEvent } from "./redis/events";
import { acquireLock, bump, bumpEpoch, releaseLock } from "./redis/primitives";
import { assess, type RiskAssessment } from "./riskEngine";
import { getRules, getSettings } from "./settingsService";
import { receiptView } from "./transactionViews";
import { publishTransactionAnalytics } from "./exasolAnalyticsService";

export interface PaymentRequest {
    userId: number;
    customer: any;
    kind: "TRANSFER" | "MERCHANT";
    amount: number;
    mode: PaymentMode;
    remarks: string;
    toAccountNumber?: string;
    saveBeneficiary?: boolean;
    merchantId?: string;
    pin: string;
    idempotencyKey?: string;
    ctx: RequestContext;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const processPayment = async (req: PaymentRequest) => {
    const settings = await getSettings();
    if (!settings.transfers_enabled) {
        throw new AppError(503, "Payments are temporarily unavailable while we carry out maintenance. Please try again shortly.", "PAYMENTS_DISABLED");
    }
    const { customer, ctx } = req;
    if (customer.status !== "ACTIVE") throw forbidden("Your account is not active yet", "CUSTOMER_NOT_ACTIVE");

    if (req.idempotencyKey) {
        const existing = await Transaction.findOne({ customer_id: customer.id, idempotency_key: req.idempotencyKey });
        if (existing) {
            const account = await Account.findOne({ customer_id: customer.id }).lean();
            return { ...receiptView(existing, customer.id, account ? account.balance_paise / 100 : null), replayed: true };
        }
    }

    const mode: PaymentMode = req.kind === "MERCHANT" ? "UPI" : req.mode;
    const limits = PAYMENT_MODES[mode];
    if (req.amount < limits.min) throw badRequest(`${limits.label} payments start at ${inr(limits.min)}`, "BELOW_MODE_MINIMUM");
    if (req.amount > limits.max) throw badRequest(`${limits.label} payments are limited to ${inr(limits.max)} per transaction`, "ABOVE_MODE_LIMIT");

    const account0 = await Account.findOne({ customer_id: customer.id }).lean();
    if (!account0) throw notFound("No bank account found", "NO_ACCOUNT");
    if (account0.status !== "ACTIVE") throw forbidden("Your account is blocked for payments. Please contact CertiFlow support.", "ACCOUNT_BLOCKED");

    await verifyPin(req.userId, req.pin, () => behavior.recordFailedAttempt(customer.id, req.amount));

    const lock = await acquireLock(`acct:${account0.id}`, 20000, 4000);
    if (!lock) throw new AppError(429, "Another payment on your account is still being processed. Please wait a moment.", "ACCOUNT_BUSY");
    try {
        return await execute(req, mode);
    } finally {
        await releaseLock(lock);
    }
};

const execute = async (req: PaymentRequest, mode: PaymentMode) => {
    const { customer, ctx } = req;
    const now = new Date();
    const account = await Account.findOne({ customer_id: customer.id });
    if (!account || account.status !== "ACTIVE") throw forbidden("Your account is blocked for payments", "ACCOUNT_BLOCKED");

    // ---- counterparty ---------------------------------------------------------------------------------
    let recipientAccount: any = null;
    let recipientCustomer: any = null;
    let merchant: ReturnType<typeof getMerchant> | undefined;
    if (req.kind === "TRANSFER") {
        if (!req.toAccountNumber || !/^\d{12}$/.test(req.toAccountNumber)) throw badRequest("Enter a valid 12-digit account number");
        recipientAccount = await Account.findOne({ account_number: req.toAccountNumber });
        if (!recipientAccount || recipientAccount.status === "CLOSED") throw notFound("No account found with this number", "PAYEE_NOT_FOUND");
        if (recipientAccount.customer_id === customer.id) throw badRequest("You cannot send money to your own account", "SELF_TRANSFER");
        if (recipientAccount.status !== "ACTIVE") throw badRequest("The recipient's account cannot receive payments right now", "PAYEE_BLOCKED");
        recipientCustomer = await Customer.findOne({ id: recipientAccount.customer_id }).lean();
    } else {
        merchant = getMerchant(req.merchantId ?? "");
        if (!merchant) throw badRequest("Unknown merchant", "UNKNOWN_MERCHANT");
    }
    const category = req.kind === "TRANSFER" ? TRANSFER_CATEGORY : merchant!.category;
    const recipientKey = req.kind === "TRANSFER" ? req.toAccountNumber! : `m:${merchant!.id}`;
    const recipientName = req.kind === "TRANSFER" ? (recipientCustomer?.name ?? "Account holder") : merchant!.name;

    // ---- limits & balance -----------------------------------------------------------------------------
    const usedToday = await Transaction.aggregate([
        { $match: { customer_id: customer.id, status: { $in: ["COMPLETED", "HELD"] }, transaction_type: { $ne: "DEPOSIT" }, created_at: { $gte: startOfLocalDay(now) } } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const used = usedToday[0]?.total ?? 0;
    if (used + req.amount > account.daily_limit) {
        const remaining = Math.max(0, account.daily_limit - used);
        throw new AppError(400, `This payment exceeds your daily limit of ${inr(account.daily_limit)}. You can still send ${inr(remaining)} today.`, "DAILY_LIMIT_EXCEEDED");
    }
    const balanceBefore = account.balance_paise / 100;
    if (req.amount > balanceBefore) {
        const failed = await persistFailed(req, account, recipientAccount, recipientName, recipientKey, category, mode, "Insufficient balance");
        await behavior.recordFailedAttempt(customer.id, req.amount);
        bump("txn_failed");
        throw new AppError(400, `Insufficient balance. Available: ${inr(balanceBefore)}.`, "INSUFFICIENT_FUNDS", { reference: failed.transaction_number });
    }

    // ---- behavioural features + risk ------------------------------------------------------------------
    const [profile, attempts, fanIn] = await Promise.all([
        behavior.loadProfile(customer.id),
        behavior.loadAttempts(customer.id, now),
        req.kind === "TRANSFER" ? behavior.recipientFanIn(req.toAccountNumber!, customer.id, now) : Promise.resolve(0)
    ]);
    const hour = localHour(now);
    const features: Features = computeFeatures(profile, attempts, {
        ts: now.getTime() / 1000, hour, amount: req.amount, balanceBefore, accountCreatedTs: account.created_at.getTime() / 1000,
        device: ctx.deviceId, location: ctx.location, recipient: recipientKey, category, isP2P: req.kind === "TRANSFER", fanIn
    });
    const settings = await getSettings();
    const [ml, rules] = await Promise.all([settings.ml_enabled ? predictRisk(features) : Promise.resolve(null), getRules()]);
    const risk = assess(features, rules, settings.risk_thresholds, ml, { mlEnabled: settings.ml_enabled });
    const status: ITransaction["status"] = risk.decision === "BLOCK" ? "BLOCKED" : risk.decision === "HOLD" ? "HELD" : "COMPLETED";
    bump(`decision_${risk.decision.toLowerCase()}`);

    // ---- atomic persistence ---------------------------------------------------------------------------
    const paise = Math.round(req.amount * 100);
    const pendingNotifications: { input: NotificationInput; doc?: any }[] = [];
    let alertDoc: any = null;

    const saved = await runInTransaction(async session => {
        pendingNotifications.length = 0;
        alertDoc = null;
        let senderAfter: number | null = null;
        let recipientAfter: number | null = null;
        if (status === "COMPLETED") {
            const debited = await Account.findOneAndUpdate(
                { id: account.id, status: "ACTIVE", balance_paise: { $gte: paise } }, { $inc: { balance_paise: -paise } }, { new: true, session });
            if (!debited) throw new AppError(409, "Your balance changed while processing. Please try again.", "BALANCE_CHANGED");
            senderAfter = debited.balance_paise / 100;
            if (recipientAccount) {
                const credited = await Account.findOneAndUpdate({ id: recipientAccount.id, status: "ACTIVE" }, { $inc: { balance_paise: paise } }, { new: true, session });
                if (!credited) throw new AppError(409, "The recipient's account is unavailable. Your money was not debited.", "PAYEE_BLOCKED");
                recipientAfter = credited.balance_paise / 100;
            }
        }
        const [txn] = await Transaction.create([{
            id: await getNextSequence("transaction_id", session), transaction_number: generateTransactionNumber(),
            customer_id: customer.id, sender_name: customer.name, sender_account_number: account.account_number,
            recipient_customer_id: recipientAccount?.customer_id ?? null, recipient_account_number: recipientAccount?.account_number ?? null,
            recipient_name: recipientName, merchant_id: merchant?.id ?? null, amount: req.amount,
            transaction_type: req.kind === "TRANSFER" ? TXN_TYPES.TRANSFER : TXN_TYPES.MERCHANT, payment_mode: mode, category,
            remarks: req.remarks, status, location: ctx.location, device_id: ctx.deviceId, ip_address: ctx.ip,
            risk_score: risk.finalScore, risk_level: risk.riskLevel, rule_score: risk.ruleScore, ml_score: risk.mlScore,
            ml_probability: ml?.fraud_probability ?? null, ml_anomaly: ml?.anomaly_score ?? null, ml_model_version: ml?.model_version ?? null,
            ml_available: risk.mlAvailable, ml_features: features,
            risk_reasons: risk.hits.map(h => ({ code: h.code, title: h.title, detail: h.detail, points: h.points })),
            ml_drivers: ml?.risk_drivers ?? [], decision: risk.decision,
            sender_balance_after: senderAfter, recipient_balance_after: recipientAfter,
            idempotency_key: req.idempotencyKey ?? null, created_at: now, completed_at: status === "COMPLETED" ? now : null
        }], { session });

        if (status === "COMPLETED" && req.saveBeneficiary && recipientAccount) {
            await upsertBeneficiary(customer.id, recipientAccount.account_number, recipientName, session);
        }
        if (recipientAccount) {
            await Beneficiary.updateOne({ customer_id: customer.id, account_number: recipientAccount.account_number }, { $set: { last_paid_at: now } }, { session });
        }

        if (risk.createAlert) {
            const [alert] = await FraudAlert.create([{
                id: await getNextSequence("fraud_alert_id", session), alert_number: generateAlertNumber(), transaction_id: txn.id,
                customer_id: customer.id, risk_score: risk.finalScore, rule_score: risk.ruleScore, ml_score: risk.mlScore,
                severity: risk.riskLevel, status: "NEW"
            }], { session });
            alertDoc = alert;
            await Investigation.create([{
                id: await getNextSequence("investigation_id", session), alert_id: alert.id, action: "CREATED",
                notes: `Alert opened automatically (${risk.decision}, score ${risk.finalScore}).`
            }], { session });
            const n: NotificationInput = {
                recipientType: "STAFF", alertId: alert.id, transactionId: txn.id, type: "FRAUD_ALERT",
                severity: risk.riskLevel === "CRITICAL" ? "CRITICAL" : "WARNING", title: `${risk.riskLevel} risk payment ${txn.transaction_number}`,
                message: `${customer.name}: ${inr(req.amount)} → ${recipientName} (${risk.decision}, score ${risk.finalScore}).`
            };
            pendingNotifications.push({ input: n, doc: await createNotification(n, session) });
        }

        const mk = async (n: NotificationInput) => { pendingNotifications.push({ input: n, doc: await createNotification(n, session) }); };
        const base = { recipientType: "CUSTOMER" as const, customerId: customer.id, userId: customer.user_id, transactionId: txn.id };
        if (status === "COMPLETED") {
            await mk({ ...base, type: "DEBIT", title: `${inr(req.amount)} debited`,
                message: `Paid to ${recipientName} via ${mode}. Ref ${txn.transaction_number}. Balance ${inr(senderAfter ?? 0)}.` });
            if (risk.decision === "ALLOW_NOTIFY" || risk.hits.some(h => h.notify_customer)) {
                await mk({ ...base, type: "SECURITY_CHECK", severity: "WARNING", actionRequired: true, title: "Was this payment made by you?",
                    message: `We noticed this ${inr(req.amount)} payment to ${recipientName} looked a little different from your usual activity. Please confirm it was you.` });
            }
            if (recipientAccount) {
                await mk({ recipientType: "CUSTOMER", customerId: recipientAccount.customer_id, userId: recipientCustomer?.user_id, transactionId: txn.id,
                    type: "CREDIT", title: `${inr(req.amount)} received`,
                    message: `From ${customer.name} via ${mode}. Ref ${txn.transaction_number}. Balance ${inr(recipientAfter ?? 0)}.` });
            }
        } else if (status === "HELD") {
            await mk({ ...base, type: "PAYMENT_HELD", severity: "WARNING", actionRequired: true, alertId: alertDoc?.id ?? null, title: "Your payment is on hold",
                message: `For your safety we are reviewing your ${inr(req.amount)} payment to ${recipientName}. Funds have not left your account. Please confirm if this was you.` });
        } else {
            await mk({ ...base, type: "PAYMENT_DECLINED", severity: "CRITICAL", actionRequired: true, alertId: alertDoc?.id ?? null, title: "Payment declined for your safety",
                message: `We declined a ${inr(req.amount)} payment to ${recipientName}. If this was not you, tell us right away and we will protect your account.` });
        }
        return { txn, senderAfter };
    });

    // ---- post-commit side effects (never fail the payment) --------------------------------------------
    try {
        await behavior.recordOutcome({
            customerId: customer.id, profile,
            attempt: { ts: now.getTime() / 1000, amount: req.amount, status: status === "COMPLETED" ? "C" : status === "HELD" ? "H" : "B" },
            completedDebit: status === "COMPLETED" ? { amount: req.amount, hour, device: ctx.deviceId, location: ctx.location, recipient: recipientKey, category } : undefined,
            p2pRecipient: req.kind === "TRANSFER" ? recipientKey : undefined
        });
        await bumpEpoch(`cust:${customer.id}`, "admin", ...(recipientAccount ? [`cust:${recipientAccount.customer_id}`] : []));
        for (const p of pendingNotifications) if (p.doc) announceNotification(p.input, p.doc);
        void publishEvent({ audience: `user:${req.userId}`, type: "balance", data: { balance: saved.senderAfter, transaction_id: saved.txn.id, status } });
        if (recipientCustomer) void publishEvent({ audience: `user:${recipientCustomer.user_id}`, type: "balance", data: { transaction_id: saved.txn.id, status } });
        if (alertDoc) void publishEvent({ audience: "staff", type: "alert.created", data: { alert_id: alertDoc.id, severity: risk.riskLevel, transaction_id: saved.txn.id } });
        if (risk.decision === "HOLD" || risk.decision === "BLOCK") {
            audit({ id: req.userId, name: customer.name, role: "USER", ip: ctx.ip }, `PAYMENT_${risk.decision}`, { type: "transaction", id: saved.txn.id },
                `${inr(req.amount)} to ${recipientName} ${risk.decision === "HOLD" ? "held" : "blocked"} (score ${risk.finalScore})`, { reasons: risk.hits.map(h => h.code), ml: ml?.fraud_probability });
        }
    } catch (error) {
        console.error("post-payment side effects failed:", (error as Error).message);
    }

    // Analytics is deliberately asynchronous and best-effort: MongoDB remains the ledger of record.
    publishTransactionAnalytics({
        transaction_id: saved.txn.id,
        customer_id: customer.id,
        amount: req.amount,
        status: saved.txn.status,
        risk_score: saved.txn.risk_score,
        risk_level: saved.txn.risk_level,
        decision: saved.txn.decision,
        transaction_type: saved.txn.transaction_type,
        category: saved.txn.category,
        payment_mode: saved.txn.payment_mode
    });

    const balance = status === "COMPLETED" ? saved.senderAfter : balanceBefore;
    return { ...receiptView(saved.txn, customer.id, balance), replayed: false };
};

const upsertBeneficiary = async (customerId: number, accountNumber: string, name: string, session?: ClientSession) => {
    if (await Beneficiary.exists({ customer_id: customerId, account_number: accountNumber })) return;
    await Beneficiary.create([{ id: await getNextSequence("beneficiary_id", session), customer_id: customerId, account_number: accountNumber, name }], { session });
};

const persistFailed = async (req: PaymentRequest, account: any, recipientAccount: any, recipientName: string, recipientKey: string, category: string, mode: PaymentMode, reason: string) => {
    const [txn] = await Transaction.create([{
        id: await getNextSequence("transaction_id"), transaction_number: generateTransactionNumber(),
        customer_id: req.customer.id, sender_name: req.customer.name, sender_account_number: account.account_number,
        recipient_customer_id: recipientAccount?.customer_id ?? null, recipient_account_number: recipientAccount?.account_number ?? null,
        recipient_name: recipientName, merchant_id: req.kind === "MERCHANT" ? req.merchantId : null, amount: req.amount,
        transaction_type: req.kind === "TRANSFER" ? TXN_TYPES.TRANSFER : TXN_TYPES.MERCHANT, payment_mode: mode, category,
        remarks: req.remarks, status: "FAILED", failure_reason: reason, location: req.ctx.location, device_id: req.ctx.deviceId, ip_address: req.ctx.ip,
        decision: "ALLOW", idempotency_key: req.idempotencyKey ?? null
    }]);
    publishTransactionAnalytics({
        transaction_id: txn.id,
        customer_id: req.customer.id,
        amount: req.amount,
        status: txn.status,
        risk_score: txn.risk_score,
        risk_level: txn.risk_level,
        decision: txn.decision,
        transaction_type: txn.transaction_type,
        category: txn.category,
        payment_mode: txn.payment_mode
    });
    void recipientKey;
    return txn;
};

export { maskAccount, roundMoney };
export type { RiskAssessment };
