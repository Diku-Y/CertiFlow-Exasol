import { badRequest } from "./httpError";

export const str = (value: unknown, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string => {
    if (value === undefined || value === null || value === "") {
        if (opts.optional) return "";
        throw badRequest(`${field} is required`);
    }
    if (typeof value !== "string") throw badRequest(`${field} must be text`);
    const v = value.trim();
    if (opts.min !== undefined && v.length < opts.min) throw badRequest(`${field} must be at least ${opts.min} characters`);
    if (opts.max !== undefined && v.length > opts.max) throw badRequest(`${field} must be at most ${opts.max} characters`);
    return v;
};

export const money = (value: unknown, field = "Amount"): number => {
    const n = typeof value === "string" ? Number(value) : (value as number);
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw badRequest(`${field} must be a positive number`);
    if (Math.round(n * 100) / 100 !== n) throw badRequest(`${field} can have at most 2 decimal places`);
    if (n > 1e9) throw badRequest(`${field} is too large`);
    return n;
};

export const int = (value: unknown, field: string, opts: { min?: number; max?: number; fallback?: number } = {}): number => {
    if ((value === undefined || value === null || value === "") && opts.fallback !== undefined) return opts.fallback;
    const n = Number(value);
    if (!Number.isInteger(n)) throw badRequest(`${field} must be a whole number`);
    if (opts.min !== undefined && n < opts.min) throw badRequest(`${field} must be at least ${opts.min}`);
    if (opts.max !== undefined && n > opts.max) throw badRequest(`${field} must be at most ${opts.max}`);
    return n;
};

export const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T => {
    if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
    if (typeof value !== "string" || !allowed.includes(value as T)) throw badRequest(`${field} must be one of: ${allowed.join(", ")}`);
    return value as T;
};

export const email = (value: unknown): string => {
    const v = str(value, "Email", { max: 120 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw badRequest("Enter a valid email address");
    return v;
};

export const phone = (value: unknown): string => {
    const v = str(value, "Phone", { max: 20 }).replace(/[\s-]/g, "");
    if (!/^(\+91)?[6-9]\d{9}$/.test(v)) throw badRequest("Enter a valid 10-digit Indian mobile number");
    return v.replace(/^\+91/, "");
};

export const password = (value: unknown, field = "Password"): string => {
    if (typeof value !== "string" || value.length < 8) throw badRequest(`${field} must be at least 8 characters`);
    if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) throw badRequest(`${field} must contain letters and numbers`);
    if (value.length > 100) throw badRequest(`${field} is too long`);
    return value;
};

export const pin = (value: unknown, field = "PIN"): string => {
    if (typeof value !== "string" || !/^\d{6}$/.test(value)) throw badRequest(`${field} must be exactly 6 digits`);
    if (/^(\d)\1{5}$/.test(value) || "0123456789".includes(value) || "9876543210".includes(value)) {
        throw badRequest(`${field} is too easy to guess`);
    }
    return value;
};

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const parseDate = (value: unknown, field: string): Date | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) throw badRequest(`${field} is not a valid date`);
    return d;
};

export const paging = (query: Record<string, unknown>, defaultLimit = 20, maxLimit = 100) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(maxLimit, Math.max(1, Number(query.limit) || defaultLimit));
    return { page, limit, skip: (page - 1) * limit };
};
