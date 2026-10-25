import mongoose from "mongoose";
import { env } from "./env";

export const connectDatabase = async (): Promise<void> => {
    if (!env.mongoUri) throw new Error("MONGODB_URI is not configured in .env");
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 15000 });
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
};

export const isDatabaseReady = (): boolean => mongoose.connection.readyState === 1;

/**
 * Runs `work` inside a MongoDB transaction (replica set / Atlas required).
 * With MONGO_TRANSACTIONS=false (standalone mongod) it runs without a session, relying on
 * the conditional balance updates for safety - fine for local experiments, not for production.
 * NOTE: `work` may be retried by the driver, so it must contain only database writes.
 */
export const runInTransaction = async <T>(work: (session: mongoose.ClientSession | undefined) => Promise<T>): Promise<T> => {
    if (!env.mongoTransactions) return work(undefined);
    const session = await mongoose.startSession();
    try {
        let result!: T;
        await session.withTransaction(async () => {
            result = await work(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
};

export default mongoose;
