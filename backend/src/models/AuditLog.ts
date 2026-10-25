import mongoose, { Schema, Document } from "mongoose";

export interface IAuditLog extends Document {
    actor_id: number | null;
    actor_name: string;
    actor_role: string;
    action: string;
    target_type: string;
    target_id: string;
    summary: string;
    details: Record<string, unknown> | null;
    ip: string;
    created_at: Date;
}

const schema = new Schema<IAuditLog>({
    actor_id: { type: Number, default: null },
    actor_name: { type: String, default: "System" },
    actor_role: { type: String, default: "SYSTEM" },
    action: { type: String, required: true, index: true },
    target_type: { type: String, default: "" },
    target_id: { type: String, default: "" },
    summary: { type: String, default: "" },
    details: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: "" },
    created_at: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

export default mongoose.model<IAuditLog>("AuditLog", schema);
