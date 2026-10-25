import mongoose, { Schema, Document } from "mongoose";

export type Role = "USER" | "FRAUD_ANALYST" | "ADMIN";

export interface IUser extends Document {
    id: number;
    name: string;
    email: string;
    password_hash: string;
    role: Role;
    status: "ACTIVE" | "DISABLED";
    pin_hash: string | null;
    pin_failed_count: number;
    pin_locked_until: Date | null;
    failed_login_count: number;
    locked_until: Date | null;
    token_version: number;
    must_change_password: boolean;
    last_login_at: Date | null;
    last_login_ip: string | null;
    created_by: number | null;
    created_at: Date;
}

const schema = new Schema<IUser>({
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ["USER", "FRAUD_ANALYST", "ADMIN"], default: "USER", index: true },
    status: { type: String, enum: ["ACTIVE", "DISABLED"], default: "ACTIVE" },
    pin_hash: { type: String, default: null },
    pin_failed_count: { type: Number, default: 0 },
    pin_locked_until: { type: Date, default: null },
    failed_login_count: { type: Number, default: 0 },
    locked_until: { type: Date, default: null },
    token_version: { type: Number, default: 0 },
    must_change_password: { type: Boolean, default: false },
    last_login_at: { type: Date, default: null },
    last_login_ip: { type: String, default: null },
    created_by: { type: Number, default: null },
    created_at: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model<IUser>("User", schema);
