import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import User, { Role } from "../models/User";
import Customer from "../models/Customer";
import { forbidden, tooMany, unauthorized } from "../utils/httpError";
import { rateLimitHit } from "../services/redis/primitives";
import { isSessionActive } from "../services/redis/sessions";

export interface JwtPayload { sub: string; jti: string; role: Role; tv: number; nm?: string }

export const authenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized("Please sign in to continue");
    let payload: JwtPayload;
    try {
        payload = jwt.verify(header.slice(7), env.jwtSecret) as JwtPayload;
    } catch {
        throw unauthorized("Your session has expired. Please sign in again.", "SESSION_EXPIRED");
    }
    const userId = Number(payload.sub);
    const active = await isSessionActive(payload.jti);
    if (active === false) throw unauthorized("Your session has ended. Please sign in again.", "SESSION_EXPIRED");

    let name = payload.nm ?? "";
    if (active === null || req.method !== "GET") {
        // Redis unavailable (or state-changing request): the database is the authority.
        const user = await User.findOne({ id: userId }).select("name role status token_version").lean();
        if (!user || user.status !== "ACTIVE" || user.token_version !== payload.tv) {
            throw unauthorized("Your session has ended. Please sign in again.", "SESSION_EXPIRED");
        }
        payload.role = user.role;
        name = user.name;
    }
    req.user = { id: userId, role: payload.role, jti: payload.jti, name };
    next();
};

export const authorize = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden("You do not have permission to perform this action");
    next();
};

/** Loads the signed-in customer's profile; use for customer-only endpoints. */
export const withCustomer = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || req.user.role !== "USER") throw forbidden("This area is for bank customers");
    const customer = await Customer.findOne({ user_id: req.user.id });
    if (!customer) throw forbidden("Customer profile not found");
    req.customer = customer;
    next();
};

interface LimitOptions { name: string; windowSec: number; max: number; by?: "ip" | "user" | "ip+body.email"; message?: string }

export const limit = (opts: LimitOptions) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let id = req.ctx?.ip || "unknown";
    if (opts.by === "user" && req.user) id = String(req.user.id);
    if (opts.by === "ip+body.email") id = `${id}:${String(req.body?.email ?? "").toLowerCase().slice(0, 80)}`;
    const result = await rateLimitHit(opts.name, id, opts.windowSec, opts.max);
    res.setHeader("RateLimit-Limit", String(result.limit));
    res.setHeader("RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfter));
        throw tooMany(opts.message ?? "Too many requests. Please slow down and try again shortly.", result.retryAfter);
    }
    next();
};
