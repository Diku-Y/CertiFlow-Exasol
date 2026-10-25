import mongoose, { Schema, Document } from "mongoose";

export interface IBeneficiary extends Document {
    id: number;
    customer_id: number;
    account_number: string;
    name: string;
    nickname: string;
    last_paid_at: Date | null;
    created_at: Date;
}

const schema = new Schema<IBeneficiary>({
    id: { type: Number, required: true, unique: true },
    customer_id: { type: Number, required: true, index: true },
    account_number: { type: String, required: true },
    name: { type: String, required: true },
    nickname: { type: String, default: "" },
    last_paid_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now }
}, { versionKey: false });
schema.index({ customer_id: 1, account_number: 1 }, { unique: true });

export default mongoose.model<IBeneficiary>("Beneficiary", schema);
