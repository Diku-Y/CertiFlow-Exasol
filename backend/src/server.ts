import cors from "cors";
import express from "express";
import { assertRuntimeConfig, env } from "./config/env";
import { connectDatabase } from "./config/database";
import { limit } from "./middleware/auth";
import { requestContext, securityHeaders } from "./middleware/context";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import bankingRoutes from "./routes/banking";
import healthRoutes from "./routes/health";
import staffRoutes from "./routes/staff";
import streamRoutes from "./routes/stream";
import { FEATURES } from "./services/featureEngine";
import { checkFeatureContract } from "./services/mlService";
import { connectRedis } from "./services/redis/client";
import { initEvents } from "./services/redis/events";
import { ensureDefaultRules } from "./services/settingsService";

export const buildApp = () => {
    const app = express();
    app.set("trust proxy", env.trustProxy);
    app.disable("x-powered-by");
    app.use(securityHeaders);
    app.use(cors({
        origin: env.corsOrigins,
        allowedHeaders: ["Content-Type", "Authorization", "X-Device-Id", "X-Client-Location", "Idempotency-Key"],
        exposedHeaders: ["RateLimit-Remaining", "Retry-After", "Content-Disposition"]
    }));
    app.use(express.json({ limit: "50kb" }));
    app.use(requestContext);
    app.use("/api/health", healthRoutes);
    app.use("/api", limit({ name: "api", windowSec: 60, max: 600, by: "ip" }));
    app.use("/api/auth", authRoutes);
    app.use("/api/banking", bankingRoutes);
    app.use("/api/staff", staffRoutes);
    app.use("/api/admin", adminRoutes);
    app.use("/api/stream", streamRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
};

const start = async () => {
    assertRuntimeConfig();
    await connectDatabase();
    await connectRedis();
    await initEvents();
    await ensureDefaultRules();
    void checkFeatureContract(FEATURES);
    const server = buildApp().listen(env.port, () => console.log(`CertiFlow API listening on port ${env.port}`));
    const shutdown = (signal: string) => {
        console.log(`${signal} received, shutting down`);
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
};

if (require.main === module) {
    start().catch(error => { console.error("Failed to start CertiFlow API:", error); process.exit(1); });
}
