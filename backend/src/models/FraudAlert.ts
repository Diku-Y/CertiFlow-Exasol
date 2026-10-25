import mongoose, { Schema, Document } from "mongoose";

export interface IFraudAlert extends Document {
    id: number;
    alert_number: string;
    transaction_id: number;
    customer_id: number;
    risk_score: number;
    rule_score: number;
    ml_score: number | null;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    status: "NEW" | "IN_REVIEW" | "RESOLVED";
    assigned_to: number | null;
    resolution: "CONFIRMED_FRAUD" | "FALSE_POSITIVE" | null;
    resolution_notes: string | null;
    customer_response: "ME" | "NOT_ME" | null;
    created_at: Date;
    updated_at: Date;
    resolved_at: Date | null;
}

const schema = new Schema<IFraudAlert>({
    id: { type: Number, required: true, unique: true },
    alert_number: { type: String, required: true, unique: true },
    transaction_id: { type: Number, required: true, unique: true },
    customer_id: { type: Number, required: true, index: true },
    risk_score: { type: Number, required: true },
    rule_score: { type: Number, default: 0 },
    ml_score: { type: Number, default: null },
    severity: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], required: true },
    status: { type: String, enum: ["NEW", "IN_REVIEW", "RESOLVED"], default: "NEW", index: true },
    assigned_to: { type: Number, default: null },
    resolution: { type: String, enum: ["CONFIRMED_FRAUD", "FALSE_POSITIVE", null], default: null },
    resolution_notes: { type: String, default: null },
    customer_response: { type: String, enum: ["ME", "NOT_ME", null], default: null },
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now },
    resolved_at: { type: Date, default: null }
}, { versionKey: false });

export default mongoose.model<IFraudAlert>("FraudAlert", schema);
