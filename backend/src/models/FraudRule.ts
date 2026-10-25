import mongoose, { Schema, Document } from "mongoose";

export interface IFraudRule extends Document {
    id: number;
    code: string;
    title: string;
    description: string;
    threshold: number;
    risk_points: number;
    enabled: boolean;
    notify_customer: boolean;
    notify_analyst: boolean;
    updated_by: number | null;
    updated_at: Date;
}

const schema = new Schema<IFraudRule>({
    id: { type: Number, required: true, unique: true },
    code: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    threshold: { type: Number, required: true },
    risk_points: { type: Number, required: true, min: 0, max: 100 },
    enabled: { type: Boolean, default: true },
    notify_customer: { type: Boolean, default: false },
    notify_analyst: { type: Boolean, default: true },
    updated_by: { type: Number, default: null },
    updated_at: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model<IFraudRule>("FraudRule", schema);
