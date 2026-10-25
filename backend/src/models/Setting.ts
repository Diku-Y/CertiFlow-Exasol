import mongoose, { Schema, Document } from "mongoose";

export interface ISetting extends Document {
    key: string;
    value: unknown;
    updated_by: number | null;
    updated_at: Date;
}

const schema = new Schema<ISetting>({
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updated_by: { type: Number, default: null },
    updated_at: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model<ISetting>("Setting", schema);
