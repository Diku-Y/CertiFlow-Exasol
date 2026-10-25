import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import FraudRule from "../models/FraudRule";
import * as admin from "../services/adminService";
import { audit } from "../services/auditService";
import { getRules, getSettings, invalidateRules, updateSettings } from "../services/settingsService";
import { badRequest, notFound } from "../utils/httpError";
import * as v from "../utils/validate";
import { getExasolAnalyticsOverview } from "../services/exasolAnalyticsService";

const router = Router();
router.use(authenticate, authorize("ADMIN"));
const actor = (req: any) => ({ id: req.user.id as number, name: req.user.name as string, role: "ADMIN", ip: req.ctx.ip as string });
const cid = (req: any) => v.int(req.params.id, "id", { min: 1 });

router.get("/overview", async (_req, res) => { res.json(await admin.overview()); });
router.get("/exasol", async (_req, res) => { res.json(await getExasolAnalyticsOverview()); });

// --- customers & applications
router.get("/customers", async (req, res) => { res.json(await admin.listCustomers(req.query)); });
router.get("/customers/:id", async (req, res) => { res.json(await admin.customerDetail(cid(req))); });
router.post("/customers/:id/approve", async (req, res) => {
    const b = req.body ?? {};
    const opening = b.opening_balance === undefined || b.opening_balance === "" ? 0 : Number(b.opening_balance);
    if (!Number.isFinite(opening) || opening < 0 || opening > 10000000) throw badRequest("Opening balance must be between 0 and ₹1,00,00,000");
    res.json(await admin.approveRequest(cid(req), { account_type: v.oneOf(b.account_type, ["SAVINGS", "CURRENT"] as const, "Account type", "SAVINGS"), opening_balance: opening }, actor(req)));
});
router.post("/customers/:id/reject", async (req, res) => {
    await admin.rejectRequest(cid(req), v.str(req.body?.reason, "Reason", { min: 3, max: 200 }), actor(req));
    res.json({ ok: true });
});
router.post("/customers/:id/status", async (req, res) => {
    await admin.setCustomerStatus(cid(req), v.oneOf(req.body?.status, ["ACTIVE", "SUSPENDED"] as const, "Status"), v.str(req.body?.reason, "Reason", { max: 200, optional: true }), actor(req));
    res.json({ ok: true });
});
router.post("/customers/:id/account-status", async (req, res) => {
    await admin.setAccountStatus(cid(req), v.oneOf(req.body?.status, ["ACTIVE", "BLOCKED"] as const, "Status"), actor(req));
    res.json({ ok: true });
});
router.post("/customers/:id/limit", async (req, res) => { await admin.setDailyLimit(cid(req), Number(req.body?.daily_limit), actor(req)); res.json({ ok: true }); });
router.post("/customers/:id/risk-level", async (req, res) => {
    await admin.setRiskLevel(cid(req), v.oneOf(req.body?.risk_level, ["LOW", "MEDIUM", "HIGH"] as const, "Risk level"), actor(req));
    res.json({ ok: true });
});
router.post("/customers/:id/unlock", async (req, res) => { await admin.unlockCustomer(cid(req), actor(req)); res.json({ ok: true }); });
router.post("/customers/:id/force-logout", async (req, res) => { await admin.forceLogoutCustomer(cid(req), actor(req)); res.json({ ok: true }); });
router.post("/customers/:id/deposit", async (req, res) => {
    const amount = v.money(req.body?.amount);
    if (amount > 10000000) throw badRequest("Single deposits are limited to ₹1,00,00,000");
    res.status(201).json(await admin.depositFunds(cid(req), amount, v.str(req.body?.remarks, "Remarks", { max: 60, optional: true }), actor(req)));
});

// --- staff
router.get("/staff", async (_req, res) => { res.json(await admin.listStaff()); });
router.post("/staff", async (req, res) => {
    const b = req.body ?? {};
    res.status(201).json(await admin.createStaff({ name: v.str(b.name, "Name", { min: 2, max: 80 }), email: v.email(b.email),
        role: v.oneOf(b.role, ["FRAUD_ANALYST", "ADMIN"] as const, "Role"), password: b.password ? v.password(b.password) : undefined }, actor(req)));
});
router.patch("/staff/:id", async (req, res) => {
    const b = req.body ?? {};
    const patch: any = {};
    if (b.name !== undefined) patch.name = v.str(b.name, "Name", { min: 2, max: 80 });
    if (b.role !== undefined) patch.role = v.oneOf(b.role, ["FRAUD_ANALYST", "ADMIN"] as const, "Role");
    if (b.status !== undefined) patch.status = v.oneOf(b.status, ["ACTIVE", "DISABLED"] as const, "Status");
    res.json(await admin.updateStaff(cid(req), patch, actor(req)));
});
router.post("/staff/:id/reset-password", async (req, res) => { res.json(await admin.resetStaffPassword(cid(req), actor(req))); });

// --- fraud rules & settings
router.get("/rules", async (_req, res) => { res.json(await getRules()); });
router.put("/rules/:code", async (req, res) => {
    const rule = await FraudRule.findOne({ code: String(req.params.code) });
    if (!rule) throw notFound("Rule not found");
    const b = req.body ?? {};
    if (b.threshold !== undefined) { const t = Number(b.threshold); if (!Number.isFinite(t) || t < 0) throw badRequest("Threshold must be a positive number"); rule.threshold = t; }
    if (b.risk_points !== undefined) { const p = Number(b.risk_points); if (!Number.isFinite(p) || p < 0 || p > 100) throw badRequest("Risk points must be between 0 and 100"); rule.risk_points = p; }
    for (const k of ["enabled", "notify_customer", "notify_analyst"] as const) if (b[k] !== undefined) rule[k] = Boolean(b[k]);
    rule.updated_by = req.user!.id; rule.updated_at = new Date();
    await rule.save();
    await invalidateRules();
    audit(actor(req), "RULE_UPDATED", { type: "rule", id: rule.code }, `${rule.title}: threshold ${rule.threshold}, points ${rule.risk_points}, ${rule.enabled ? "enabled" : "disabled"}`);
    res.json({ ok: true });
});
router.get("/settings", async (_req, res) => { res.json(await getSettings()); });
router.put("/settings", async (req, res) => {
    const b = req.body ?? {};
    const next = await updateSettings({
        transfers_enabled: b.transfers_enabled === undefined ? undefined : Boolean(b.transfers_enabled),
        ml_enabled: b.ml_enabled === undefined ? undefined : Boolean(b.ml_enabled),
        risk_thresholds: b.risk_thresholds, default_daily_limit: b.default_daily_limit
    }, req.user!.id);
    audit(actor(req), "SETTINGS_UPDATED", { type: "settings" }, "Bank settings updated", b);
    res.json(next);
});

// --- ML operations
router.get("/ml", async (_req, res) => { res.json(await admin.mlOverview()); });
router.get("/ml/drift", async (_req, res) => { res.json(await admin.mlProxy.drift()); });
router.get("/ml/retrain/status", async (_req, res) => { res.json(await admin.mlProxy.status()); });
router.post("/ml/retrain", async (req, res) => { res.status(202).json(await admin.startRetrain(actor(req))); });
router.post("/ml/rollback", async (req, res) => { res.json(await admin.mlProxy.rollback(v.int(req.body?.version, "version", { min: 1 }), actor(req))); });

// --- system & audit
router.get("/system", async (_req, res) => { res.json(await admin.systemHealth()); });
router.get("/audit", async (req, res) => { res.json(await admin.listAudit(req.query)); });

export default router;
