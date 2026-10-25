import { env } from "../config/env";

export interface TransactionAnalyticsEvent {
    transaction_id: string | number;
    customer_id: string | number;
    amount: number;
    status: string;
    risk_score?: number | null;
    risk_level?: string | null;
    decision: string;
    transaction_type?: string | null;
    category?: string | null;
    payment_mode?: string | null;
}

/**
 * Best-effort analytics delivery. The MongoDB transaction is the source of truth for
 * payment processing; Exasol ingestion must never delay or roll back a committed payment.
 */
export const publishTransactionAnalytics = (event: TransactionAnalyticsEvent): void => {
    if (!env.exasolAnalyticsUrl) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    void fetch(`${env.exasolAnalyticsUrl.replace(/\/$/, "")}/events`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(env.exasolIngestKey ? { "X-Service-Key": env.exasolIngestKey } : {})
        },
        body: JSON.stringify({ ...event, event_type: "RISK_DECISION" }),
        signal: controller.signal
    }).then(async response => {
        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            console.warn(`Exasol analytics ingestion returned ${response.status}: ${detail.slice(0, 300)}`);
        }
    }).catch(error => {
        console.warn("Exasol analytics ingestion unavailable; banking transaction remains committed:", (error as Error).message);
    }).finally(() => clearTimeout(timeout));
};

export const getExasolAnalyticsOverview = async () => {
    if (!env.exasolAnalyticsUrl) return { platform: "Exasol Personal", configured: false, connected: false };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
        const response = await fetch(`${env.exasolAnalyticsUrl.replace(/\/$/, "")}/overview`, { signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        return { ...(body as Record<string, unknown>), http_ok: response.ok };
    } catch (error) {
        return { platform: "Exasol Personal", connected: false, error: (error as Error).message };
    } finally {
        clearTimeout(timeout);
    }
};
