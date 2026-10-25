import mongoose, { Schema, Document } from "mongoose";

export interface INotification extends Document {
    id: number;
    notification_number: string;
    recipient_type: "CUSTOMER" | "STAFF";
    customer_id: number | null;
    alert_id: number | null;
    transaction_id: number | null;
    notification_type: string;
    title: string;
    message: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    action_required: boolean;
    is_read: boolean;
    created_at: Date;
}

const schema = new Schema<INotification>({
    id: { type: Number, required: true, unique: true },
    notification_number: { type: String, required: true, unique: true },
    recipient_type: { type: String, enum: ["CUSTOMER", "STAFF"], required: true },
    customer_id: { type: Number, default: null },
    alert_id: { type: Number, default: null },
    transaction_id: { type: Number, default: null },
    notification_type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    severity: { type: String, enum: ["INFO", "WARNING", "CRITICAL"], default: "INFO" },
    action_required: { type: Boolean, default: false },
    is_read: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now }
}, { versionKey: false });
schema.index({ customer_id: 1, created_at: -1 });
schema.index({ recipient_type: 1, created_at: -1 });

export default mongoose.model<INotification>("Notification", schema);
