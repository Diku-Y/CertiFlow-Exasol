import { Router } from "express";
import { isDatabaseReady } from "../config/database";
import { redisStatus } from "../services/redis/client";

const router = Router();

/** Liveness/readiness for Docker & load balancers. Redis being down is degraded, not unhealthy. */
router.get("/", (_req, res) => {
    const mongo = isDatabaseReady();
    const redis = redisStatus().connected;
    res.status(mongo ? 200 : 503).json({ status: !mongo ? "unavailable" : redis ? "ok" : "degraded", mongo, redis, time: new Date().toISOString() });
});

export default router;
