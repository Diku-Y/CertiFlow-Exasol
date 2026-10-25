import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import Customer from "../models/Customer";
import User, { IUser } from "../models/User";
import { getNextSequence } from "../utils/counter";
import { AppError, badRequest, conflict, forbidden, unauthorized } from "../utils/httpError";
import * as v from "../utils/validate";
import { audit, Actor } from "./auditService";
import { createSession, revokeAllSessions } from "./redis/sessions";
import { RequestContext } from "../middleware/context";
import { dropProfile } from "./redis/behavior";

const MAX_LOGIN_FAILURES = 5;
const LOCK_MINUTES = 15;
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password-1", 10);

const expiresInSeconds = (): number => {
    const m = /^(\d+)([smhd])$/.exec(env.jwtExpiresIn);
    if (!m) return 7200;
    return Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]];
};

export const publicUser = (user: IUser | any) => ({
    id: user.id, name: user.name, email: user.email, role: user.role, status: user.status,
    pin_set: Boolean(user.pin_hash), must_change_password: Boolean(user.must_change_password),
    last_login_at: user.last_login_at ?? null
});

export const registerCustomer = async (body: any) => {
    const name = v.str(body.name, "Full name", { min: 2, max: 80 });
    const email = v.email(body.email);
    const phone = v.phone(body.phone);
    const city = v.str(body.city, "City", { max: 40, optional: true }) || "Chennai";
    const passwordPlain = v.password(body.password);
    if (await User.exists({ email })) throw conflict("An account with this email already exists", "EMAIL_EXISTS");
    const userId = await getNextSequence("user_id");
    const customerId = await getNextSequence("customer_id");
    await User.create({ id: userId, name, email, password_hash: await bcrypt.hash(passwordPlain, 12), role: "USER" });
    const customer = await Customer.create({
        id: customerId, customer_number: `CIF${String(customerId).padStart(8, "0")}`,
        user_id: userId, name, email, phone, city, status: "PENDING"
    });
    audit({ id: userId, name, role: "USER" }, "CUSTOMER_REGISTERED", { type: "customer", id: customer.id }, `${name} applied for an account`);
    return { message: "Application received. You will be able to bank as soon as it is approved.", customer_number: customer.customer_number };
};

export const login = async (body: any, ctx: RequestContext) => {
    const email = v.email(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const user = await User.findOne({ email });
    const actor: Actor = { id: user?.id ?? null, name: user?.name ?? email, role: user?.role ?? "UNKNOWN", ip: ctx.ip };

    if (user?.locked_until && user.locked_until > new Date()) {
        const mins = Math.ceil((user.locked_until.getTime() - Date.now()) / 60000);
        throw new AppError(423, `Too many failed attempts. Try again in ${mins} minute(s) or contact support.`, "ACCOUNT_LOCKED");
    }
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
        if (user) {
            user.failed_login_count += 1;
            if (user.failed_login_count >= MAX_LOGIN_FAILURES) {
                user.locked_until = new Date(Date.now() + LOCK_MINUTES * 60000);
                user.failed_login_count = 0;
                audit(actor, "ACCOUNT_LOCKED", { type: "user", id: user.id }, "Locked after repeated failed sign-ins");
            }
            await user.save();
        }
        audit(actor, "LOGIN_FAILED", { type: "user", id: user?.id ?? "" }, "Invalid credentials");
        throw unauthorized("Incorrect email or password", "INVALID_CREDENTIALS");
    }
    if (user.status !== "ACTIVE") throw forbidden("This profile has been disabled. Please contact your administrator.", "USER_DISABLED");

    user.failed_login_count = 0;
    user.locked_until = null;
    user.last_login_at = new Date();
    user.last_login_ip = ctx.ip;
    await user.save();

    const jti = randomUUID();
    const ttl = expiresInSeconds();
    const token = jwt.sign({ role: user.role, jti, tv: user.token_version, nm: user.name }, env.jwtSecret, { subject: String(user.id), expiresIn: ttl });
    await createSession({ jti, uid: user.id, role: user.role, ip: ctx.ip, userAgent: ctx.userAgent, deviceId: ctx.deviceId, createdAt: new Date().toISOString() }, ttl);
    if (user.role !== "USER") audit({ ...actor, role: user.role }, "STAFF_LOGIN", { type: "user", id: user.id }, "Staff sign-in");

    let customer: any = null;
    if (user.role === "USER") {
        customer = await Customer.findOne({ user_id: user.id }).lean();
    }
    return { token, expires_in: ttl, user: publicUser(user), customer: customer && { id: customer.id, status: customer.status, customer_number: customer.customer_number } };
};

export const changePassword = async (userId: number, body: any, currentJti: string) => {
    const user = await User.findOne({ id: userId });
    if (!user) throw unauthorized();
    if (!(await bcrypt.compare(String(body.current_password ?? ""), user.password_hash))) throw badRequest("Current password is incorrect", "WRONG_PASSWORD");
    const next = v.password(body.new_password, "New password");
    if (next === body.current_password) throw badRequest("Choose a password different from the current one");
    user.password_hash = await bcrypt.hash(next, 12);
    user.must_change_password = false;
    await user.save();
    await revokeAllSessions(userId, currentJti); // sign out every other device
};

export const setPin = async (userId: number, body: any) => {
    const user = await User.findOne({ id: userId });
    if (!user) throw unauthorized();
    if (!(await bcrypt.compare(String(body.password ?? ""), user.password_hash))) throw badRequest("Password is incorrect", "WRONG_PASSWORD");
    const pin = v.pin(body.pin, "New PIN");
    user.pin_hash = await bcrypt.hash(pin, 10);
    user.pin_failed_count = 0;
    user.pin_locked_until = null;
    await user.save();
};

/** Verify the transaction PIN with attempt counting and lock-out. Returns normally only for a correct PIN. */
export const verifyPin = async (userId: number, pin: unknown, onWrongAttempt: () => Promise<void>): Promise<void> => {
    const user = await User.findOne({ id: userId });
    if (!user) throw unauthorized();
    if (!user.pin_hash) throw badRequest("Set your transaction PIN before making payments", "PIN_NOT_SET");
    if (user.pin_locked_until && user.pin_locked_until > new Date()) {
        const mins = Math.ceil((user.pin_locked_until.getTime() - Date.now()) / 60000);
        throw new AppError(423, `PIN locked after too many wrong attempts. Try again in ${mins} minute(s).`, "PIN_LOCKED");
    }
    if (typeof pin !== "string" || !(await bcrypt.compare(pin, user.pin_hash))) {
        user.pin_failed_count += 1;
        const left = 3 - user.pin_failed_count;
        if (left <= 0) {
            user.pin_locked_until = new Date(Date.now() + 30 * 60000);
            user.pin_failed_count = 0;
            audit({ id: user.id, name: user.name, role: user.role }, "PIN_LOCKED", { type: "user", id: user.id }, "Transaction PIN locked");
        }
        await user.save();
        await onWrongAttempt();
        throw new AppError(401, left > 0 ? `Incorrect PIN. ${left} attempt(s) left.` : "Incorrect PIN. Your PIN is now locked for 30 minutes.", "WRONG_PIN");
    }
    if (user.pin_failed_count) { user.pin_failed_count = 0; await user.save(); }
};

export const forceLogout = async (userId: number): Promise<void> => {
    await User.updateOne({ id: userId }, { $inc: { token_version: 1 } });
    await revokeAllSessions(userId);
};

export const clearCustomerCache = dropProfile;
