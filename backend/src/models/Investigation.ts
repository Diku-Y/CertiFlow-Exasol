import mongoose, { Schema, Document } from "mongoose";

/** Timeline entry of an alert: claim, note, decision, customer response. */
export interface IInvestigation extends Document {
    id: number;
    alert_id: number;
    actor_id: number | null;
    actor_name: string;
    action: "CREATED" | "CLAIMED" | "NOTE" | "DECISION" | "CUSTOMER_RESPONSE" | "REASSIGNED";
    notes: string;
    created_at: Date;
}

const schema = new Schema<IInvestigation>({
    id: { type: Number, required: true, unique: true },
    alert_id: { type: Number, required: true, index: true },
    actor_id: { type: Number, default: null },
    actor_name: { type: String, default: "System" },
    action: { type: String, required: true },
    notes: { type: String, default: "" },
    created_at: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model<IInvestigation>("Investigation", schema);
