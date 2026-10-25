import mongoose, { Schema, Document } from "mongoose";

export interface ITransaction extends Document {
    id: number;
    transaction_number: string;
    customer_id: number;              // payer (0 = the bank, for deposits)
    sender_name: string;
    sender_account_number: string | null;
    recipient_customer_id: number | null;
    recipient_account_number: string | null;
    recipient_name: string | null;
    merchant_id: string | null;
    amount: number;
    currency: string;
    transaction_type: "BANK_TRANSFER" | "MERCHANT_PAYMENT" | "DEPOSIT";
    payment_mode: string;
    category: string;
    remarks: string;
    status: "COMPLETED" | "HELD" | "BLOCKED" | "FAILED" | "CANCELLED";
    failure_reason: string | null;
    location: string;
    device_id: string;
    ip_address: string;
    // fraud engine output
    risk_score: number;
    risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    rule_score: number;
    ml_score: number | null;
    ml_probability: number | null;
    ml_anomaly: number | null;
    ml_model_version: number | null;
    ml_available: boolean;
    ml_features: Record<string, number> | null;   // exact model input (used for feedback retraining)
    risk_reasons: { code: string; title: string; detail: string; points: number }[];
    ml_drivers: { feature: string; label: string; detail: string; impact: number }[];
    decision: "ALLOW" | "ALLOW_NOTIFY" | "HOLD" | "BLOCK";
    // analyst feedback
    review_decision: "FRAUD" | "LEGIT" | null;
    reviewed_by: number | null;
    reviewed_at: Date | null;
    customer_response: "ME" | "NOT_ME" | null;
    sender_balance_after: number | null;
    recipient_balance_after: number | null;
    idempotency_key: string | null;
    created_at: Date;
    completed_at: Date | null;
}

const reasonSchema = new Schema({ code: String, title: String, detail: String, points: Number }, { _id: false });
const driverSchema = new Schema({ feature: String, label: String, detail: String, impact: Number }, { _id: false });

const schema = new Schema<ITransaction>({
    id: { type: Number, required: true, unique: true },
    transaction_number: { type: String, required: true, unique: true },
    customer_id: { type: Number, required: true },
    sender_name: { type: String, required: true },
    sender_account_number: { type: String, default: null },
    recipient_customer_id: { type: Number, default: null },
    recipient_account_number: { type: String, default: null },
    recipient_name: { type: String, default: null },
    merchant_id: { type: String, default: null },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    transaction_type: { type: String, enum: ["BANK_TRANSFER", "MERCHANT_PAYMENT", "DEPOSIT"], required: true },
    payment_mode: { type: String, default: "UPI" },
    category: { type: String, default: "Transfers" },
    remarks: { type: String, default: "" },
    status: { type: String, enum: ["COMPLETED", "HELD", "BLOCKED", "FAILED", "CANCELLED"], required: true },
    failure_reason: { type: String, default: null },
    location: { type: String, default: "Unknown" },
    device_id: { type: String, default: "unknown" },
    ip_address: { type: String, default: "" },
    risk_score: { type: Number, default: 0 },
    risk_level: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], default: "LOW" },
    rule_score: { type: Number, default: 0 },
    ml_score: { type: Number, default: null },
    ml_probability: { type: Number, default: null },
    ml_anomaly: { type: Number, default: null },
    ml_model_version: { type: Number, default: null },
    ml_available: { type: Boolean, default: false },
    ml_features: { type: Schema.Types.Mixed, default: null },
    risk_reasons: { type: [reasonSchema], default: [] },
    ml_drivers: { type: [driverSchema], default: [] },
    decision: { type: String, enum: ["ALLOW", "ALLOW_NOTIFY", "HOLD", "BLOCK"], default: "ALLOW" },
    review_decision: { type: String, enum: ["FRAUD", "LEGIT", null], default: null },
    reviewed_by: { type: Number, default: null },
    reviewed_at: { type: Date, default: null },
    customer_response: { type: String, enum: ["ME", "NOT_ME", null], default: null },
    sender_balance_after: { type: Number, default: null },
    recipient_balance_after: { type: Number, default: null },
    idempotency_key: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
    completed_at: { type: Date, default: null }
}, { versionKey: false });

schema.index({ customer_id: 1, created_at: -1 });
schema.index({ recipient_customer_id: 1, created_at: -1 });
schema.index({ status: 1, created_at: -1 });
schema.index({ review_decision: 1 });
schema.index({ created_at: -1 });
schema.index({ customer_id: 1, idempotency_key: 1 }, { unique: true, partialFilterExpression: { idempotency_key: { $type: "string" } } });

export default mongoose.model<ITransaction>("Transaction", schema);
