import { NextFunction, Request, Response } from "express";
import type { Role } from "../models/User";

export interface AuthUser { id: number; role: Role; jti: string; name: string }
export interface RequestContext { ip: string; userAgent: string; deviceId: string; location: string }

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthUser;
            ctx: RequestContext;
            customer?: any;
        }
    }
}

const clean = (value: unknown, max: number, fallback: string): string => {
    const v = typeof value === "string" ? value.trim().replace(/[^\w .:@\-]/g, "").slice(0, max) : "";
    return v || fallback;
};

/** Per-request context: client IP, user agent, the browser's stable device id and the (simulated) location. */
export const requestContext = (req: Request, _res: Response, next: NextFunction): void => {
    req.ctx = {
        ip: req.ip || req.socket.remoteAddress || "",
        userAgent: clean(req.headers["user-agent"], 160, "unknown"),
        deviceId: clean(req.headers["x-device-id"], 64, "unknown-device"),
        location: clean(req.headers["x-client-location"], 40, "Unknown")
    };
    next();
};

export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.removeHeader("X-Powered-By");
    next();
};
