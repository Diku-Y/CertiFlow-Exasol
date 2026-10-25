import mongoose, { Schema, Document } from "mongoose";

export interface ICustomer extends Document {
    id: number;
    customer_number: string;
    user_id: number;
    name: string;
    email: string;
    phone: string;
    city: string;
    status: "PENDING" | "ACTIVE" | "REJECTED" | "SUSPENDED";
    risk_level: "LOW" | "MEDIUM" | "HIGH";
    rejection_reason: string | null;
    reviewed_by: number | null;
    reviewed_at: Date | null;
    created_at: Date;
}

const schema = new Schema<ICustomer>({
    id: { type: Number, required: true, unique: true },
    customer_number: { type: String, required: true, unique: true },
    user_id: { type: Number, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true },
    city: { type: String, default: "Chennai" },
    status: { type: String, enum: ["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"], default: "PENDING", index: true },
    risk_level: { type: String, enum: ["LOW", "MEDIUM", "HIGH"], default: "LOW" },
    rejection_reason: { type: String, default: null },
    reviewed_by: { type: Number, default: null },
    reviewed_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model<ICustomer>("Customer", schema);
