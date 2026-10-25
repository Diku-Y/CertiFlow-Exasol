import mongoose, { Schema, Document } from "mongoose";

export interface IAccount extends Document {
    id: number;
    customer_id: number;
    account_number: string;
    account_type: "SAVINGS" | "CURRENT";
    balance_paise: number; // integer paise - avoids floating point drift
    currency: string;
    status: "ACTIVE" | "BLOCKED" | "CLOSED";
    daily_limit: number;
    ifsc: string;
    branch: string;
    created_at: Date;
}

const schema = new Schema<IAccount>({
    id: { type: Number, required: true, unique: true },
    customer_id: { type: Number, required: true, unique: true },
    account_number: { type: String, required: true, unique: true },
    account_type: { type: String, enum: ["SAVINGS", "CURRENT"], default: "SAVINGS" },
    balance_paise: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["ACTIVE", "BLOCKED", "CLOSED"], default: "ACTIVE" },
    daily_limit: { type: Number, required: true },
    ifsc: { type: String, required: true },
    branch: { type: String, required: true },
    created_at: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model<IAccount>("Account", schema);
