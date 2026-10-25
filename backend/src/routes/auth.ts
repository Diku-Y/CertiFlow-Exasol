import { Router } from "express";
import { authenticate, limit, withCustomer } from "../middleware/auth";
import Account from "../models/Account";
import Customer from "../models/Customer";
import User from "../models/User";
import { accountView } from "../services/accountService";
import * as auth from "../services/authService";
import { listSessions, revokeAllSessions, revokeSession } from "../services/redis/sessions";
import { audit } from "../services/auditService";
import { unauthorized } from "../utils/httpError";

const router = Router();

router.post("/register", limit({ name: "register", windowSec: 3600, max: 8, message: "Too many applications from this network. Try again later." }),
    async (req, res) => { res.status(201).json(await auth.registerCustomer(req.body ?? {})); });

router.post("/login", limit({ name: "login-ip", windowSec: 900, max: 40, message: "Too many sign-in attempts. Please wait a few minutes." }),
    limit({ name: "login", windowSec: 900, max: 10, by: "ip+body.email", message: "Too many sign-in attempts for this account. Please wait a few minutes." }),
    async (req, res) => { res.json(await auth.login(req.body ?? {}, req.ctx)); });

router.post("/logout", authenticate, async (req, res) => {
    await revokeSession(req.user!.id, req.user!.jti);
    res.json({ ok: true });
});

router.get("/me", authenticate, async (req, res) => {
    const user = await User.findOne({ id: req.user!.id });
    if (!user) throw unauthorized();
    let customer: any = null, account: any = null;
    if (user.role === "USER") {
        customer = await Customer.findOne({ user_id: user.id }).lean();
        if (customer) { const a = await Account.findOne({ customer_id: customer.id }); account = a ? accountView(a) : null; }
    }
    res.json({ user: auth.publicUser(user), customer, account });
});

router.post("/password", authenticate, limit({ name: "pw-change", windowSec: 900, max: 8, by: "user" }), async (req, res) => {
    await auth.changePassword(req.user!.id, req.body ?? {}, req.user!.jti);
    audit({ id: req.user!.id, name: req.user!.name, role: req.user!.role, ip: req.ctx.ip }, "PASSWORD_CHANGED", { type: "user", id: req.user!.id }, "Password changed");
    res.json({ message: "Password updated. Other devices have been signed out." });
});

router.post("/pin", authenticate, withCustomer, limit({ name: "pin-set", windowSec: 900, max: 8, by: "user" }), async (req, res) => {
    await auth.setPin(req.user!.id, req.body ?? {});
    audit({ id: req.user!.id, name: req.user!.name, role: "USER", ip: req.ctx.ip }, "PIN_CHANGED", { type: "user", id: req.user!.id }, "Transaction PIN set/changed");
    res.json({ message: "Transaction PIN saved" });
});

router.get("/sessions", authenticate, async (req, res) => {
    const sessions = await listSessions(req.user!.id);
    res.json(sessions.map(s => ({ current: s.jti === req.user!.jti, ip: s.ip, device_id: s.deviceId, user_agent: s.userAgent, created_at: s.createdAt })));
});

router.post("/sessions/revoke-others", authenticate, async (req, res) => {
    res.json({ revoked: await revokeAllSessions(req.user!.id, req.user!.jti) });
});

export default router;
