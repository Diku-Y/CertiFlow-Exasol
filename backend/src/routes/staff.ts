import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import Notification from "../models/Notification";
import { addNote, alertDetail, alertStats, claimAlert, decide, listAlerts } from "../services/alertService";
import { addClient } from "../services/redis/events";
import { getStaffTransaction, listStaffTransactions } from "../services/transactionQueries";
import { oneOf, paging, str } from "../utils/validate";

const router = Router();
router.use(authenticate, authorize("FRAUD_ANALYST", "ADMIN"));
const actor = (req: any) => ({ id: req.user.id as number, name: req.user.name as string, role: req.user.role as string, ip: req.ctx.ip as string });

router.get("/alerts", async (req, res) => { res.json(await listAlerts({ ...req.query, userId: req.user!.id })); });
router.get("/alerts/stats", async (_req, res) => { res.json(await alertStats()); });
router.get("/alerts/:id", async (req, res) => { res.json(await alertDetail(Number(req.params.id))); });
router.post("/alerts/:id/claim", async (req, res) => { res.json(await claimAlert(Number(req.params.id), actor(req))); });
router.post("/alerts/:id/notes", async (req, res) => {
    await addNote(Number(req.params.id), actor(req), str(req.body?.notes, "Note", { min: 2, max: 500 }));
    res.status(201).json({ ok: true });
});
router.post("/alerts/:id/decision", async (req, res) => {
    const decision = oneOf(req.body?.decision, ["FALSE_POSITIVE", "CONFIRMED_FRAUD"] as const, "Decision");
    const notes = str(req.body?.notes, "Decision notes", { min: 5, max: 500 });
    res.json(await decide(Number(req.params.id), actor(req), { decision, notes, freezeAccount: Boolean(req.body?.freeze_account) }));
});

router.get("/transactions", async (req, res) => { res.json(await listStaffTransactions(req.query)); });
router.get("/transactions/:id", async (req, res) => { res.json(await getStaffTransaction(Number(req.params.id))); });

router.get("/notifications", async (req, res) => {
    const { page, limit, skip } = paging(req.query, 20, 50);
    const [items, unread] = await Promise.all([
        Notification.find({ recipient_type: "STAFF" }).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
        Notification.countDocuments({ recipient_type: "STAFF", is_read: false })
    ]);
    res.json({ items, unread, page });
});
router.post("/notifications/read", async (_req, res) => {
    const r = await Notification.updateMany({ recipient_type: "STAFF", is_read: false }, { $set: { is_read: true } });
    res.json({ updated: r.modifiedCount });
});

export default router;
