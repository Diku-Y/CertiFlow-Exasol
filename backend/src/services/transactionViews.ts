import { env } from "../config/env";
import { SYSTEM_CUSTOMER_ID } from "../constants";
import { maskAccount } from "../utils/ids";
import type { ITransaction } from "../models/Transaction";

/** What a customer is allowed to see of a transaction (direction-aware, no internal risk data by default). */
export const customerView = (t: ITransaction | any, customerId: number) => {
    const isDebit = t.customer_id === customerId;
    const view: Record<string, unknown> = {
        id: t.id, reference: t.transaction_number, direction: isDebit ? "DEBIT" : "CREDIT",
        amount: t.amount, currency: t.currency, status: t.status, type: t.transaction_type,
        mode: t.payment_mode, category: t.category, remarks: t.remarks,
        counterparty: isDebit ? (t.recipient_name ?? "Merchant") : (t.customer_id === SYSTEM_CUSTOMER_ID ? "CertiFlow Bank" : t.sender_name),
        counterparty_account: isDebit ? maskAccount(t.recipient_account_number) : maskAccount(t.sender_account_number),
        balance_after: isDebit ? t.sender_balance_after : t.recipient_balance_after,
        failure_reason: isDebit ? t.failure_reason : null,
        location: isDebit ? t.location : null,
        needs_response: isDebit && ["HELD", "BLOCKED", "COMPLETED"].includes(t.status) && t.decision !== "ALLOW" && !t.customer_response && !t.review_decision,
        customer_response: isDebit ? t.customer_response : null,
        created_at: t.created_at, completed_at: t.completed_at
    };
    if (isDebit && env.demoShowRiskToCustomer) view.security = securityView(t);
    return view;
};

export const securityView = (t: ITransaction | any) => ({
    decision: t.decision, risk_score: t.risk_score, risk_level: t.risk_level, rule_score: t.rule_score,
    ml_score: t.ml_score, ml_probability: t.ml_probability, ml_anomaly: t.ml_anomaly, ml_model_version: t.ml_model_version,
    ml_available: t.ml_available, reasons: t.risk_reasons ?? [], drivers: t.ml_drivers ?? []
});

/** Full internal view for analysts and administrators. */
export const staffView = (t: ITransaction | any, names: Map<number, string> = new Map()) => ({
    id: t.id, reference: t.transaction_number, customer_id: t.customer_id,
    customer_name: names.get(t.customer_id) ?? t.sender_name, sender_name: t.sender_name,
    recipient_customer_id: t.recipient_customer_id, recipient_name: t.recipient_name,
    sender_account: t.sender_account_number, recipient_account: t.recipient_account_number, merchant_id: t.merchant_id,
    amount: t.amount, status: t.status, type: t.transaction_type, mode: t.payment_mode, category: t.category,
    remarks: t.remarks, failure_reason: t.failure_reason, location: t.location, device_id: t.device_id, ip_address: t.ip_address,
    review_decision: t.review_decision, customer_response: t.customer_response,
    sender_balance_after: t.sender_balance_after, created_at: t.created_at, completed_at: t.completed_at,
    ...securityView(t)
});

export const receiptView = (t: ITransaction | any, customerId: number, balance: number | null) => {
    const base = customerView(t, customerId) as Record<string, unknown>;
    const message: Record<string, string> = {
        COMPLETED: "Payment successful",
        HELD: "Your payment is under a quick security review. We will notify you as soon as it is processed.",
        BLOCKED: "We could not process this payment for security reasons. If you did not attempt it, please tell us right away.",
        FAILED: "Payment failed", CANCELLED: "Payment cancelled"
    };
    return { ...base, message: message[t.status] ?? "", available_balance: balance };
};
