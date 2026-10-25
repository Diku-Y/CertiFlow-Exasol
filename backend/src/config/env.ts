import dotenv from "dotenv";

dotenv.config();

const num = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && value !== undefined && value !== "" ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean =>
    value === undefined || value === "" ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase());

export const env = {
    port: num(process.env.PORT, 5000),
    nodeEnv: process.env.NODE_ENV || "development",
    mongoUri: process.env.MONGODB_URI || "",
    mongoTransactions: bool(process.env.MONGO_TRANSACTIONS, true),
    jwtSecret: process.env.JWT_SECRET || "",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "2h",
    redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
    mlUrl: process.env.ML_SERVICE_URL || "http://127.0.0.1:8000",
    mlApiKey: process.env.ML_API_KEY || "",
    mlTimeoutMs: num(process.env.ML_TIMEOUT_MS, 3000),
    exasolAnalyticsUrl: process.env.EXASOL_ANALYTICS_URL || "",
    exasolIngestKey: process.env.EXASOL_INGEST_KEY || "",
    corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:3000")
        .split(",").map(s => s.trim()).filter(Boolean),
    trustProxy: bool(process.env.TRUST_PROXY, false),
    timezone: process.env.BANK_TIMEZONE || "Asia/Kolkata",
    // Demo convenience: include risk scores in customer-facing responses (real banks never do this).
    demoShowRiskToCustomer: bool(process.env.DEMO_SHOW_RISK_TO_CUSTOMER, false),
    isProduction: (process.env.NODE_ENV || "development") === "production"
};

export const assertRuntimeConfig = (): void => {
    if (!env.mongoUri) throw new Error("MONGODB_URI is not configured");
    if (!env.jwtSecret || env.jwtSecret.length < 16) {
        throw new Error("JWT_SECRET must be set to a random string of at least 16 characters");
    }
};
