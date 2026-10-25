import { Router } from "express";
import { authenticate, limit, withCustomer } from "../middleware/auth";
import Beneficiary from "../models/Beneficiary";
import Customer from "../models/Customer";
import Account from "../models/Account";
import Notification from "../models/Notification";
import { CATEGORIES, MERCHANTS, PAYMENT_MODES, PaymentMode } from "../constants";
import { accountView, getAccountForCustomer, lookupPayee } from "../services/accountService";
import { customerResponse } from "../services/alertService";
import { customerAnalytics } from "../services/analyticsService";
import { processPayment } from "../services/paymentService";
import { exportCustomerCsv, getCustomerTransaction, listCustomerTransactions } from "../services/transactionQueries";
import { getNextSequence } from "../utils/counter";
import { maskAccount } from "../utils/ids";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { int, money, oneOf, paging, str } from "../utils/validate";
import { bumpEpoch } from "../services/redis/primitives";

const router = Router();
router.use(authenticate, withCustomer);

router.get("/account", async (req, res) => {
    res.json({ account: accountView(await getAccountForCustomer(req.customer.id)), customer: { name: req.customer.name, customer_number: req.customer.customer_number, status: req.customer.status } });
});

router.get("/dashboard", async (req, res) => {
    const range = int(req.query.range, "range", { fallback: 30, min: 7, max: 90 });
    res.json(await customerAnalytics(req.customer, range));
});

router.get("/config", (_req, res) => {
    res.json({ modes: Object.entries(PAYMENT_MODES).map(([key, m]) => ({ key, ...m })), merchants: MERCHANTS, categories: CATEGORIES });
});

// --------------------------------------------------------------- beneficiaries
router.get("/payee-lookup", limit({ name: "lookup", windowSec: 60, max: 20, by: "user", message: "Too many account look-ups. Please wait a minute." }),
    async (req, res) => { res.json(await lookupPayee(str(req.query.account_number, "Account number"), req.customer.id)); });

router.get("/beneficiaries", async (req, res) => {
    const list = await Beneficiary.find({ customer_id: req.customer.id }).sort({ last_paid_at: -1, created_at: -1 }).lean();
    res.json(list.map(b => ({ id: b.id, name: b.name, nickname: b.nickname, account_number: b.account_number, masked_account_number: maskAccount(b.account_number), last_paid_at: b.last_paid_at })));
});

router.post("/beneficiaries", async (req, res) => {
    const accountNumber = str(req.body?.account_number, "Account number");
    const nickname = str(req.body?.nickname, "Nickname", { max: 30, optional: true });
    await lookupPayee(accountNumber, req.customer.id);
    const account = await Account.findOne({ account_number: accountNumber }).lean();
    const holder = await Customer.findOne({ id: account!.customer_id }).select("name").lean();
    if (await Beneficiary.exists({ customer_id: req.customer.id, account_number: accountNumber })) throw conflict("This payee is already saved", "ALREADY_SAVED");
    const b = await Beneficiary.create({ id: await getNextSequence("beneficiary_id"), customer_id: req.customer.id, account_number: accountNumber, name: holder?.name ?? "Account holder", nickname });
    res.status(201).json({ id: b.id, name: b.name, nickname: b.nickname, account_number: b.account_number, masked_account_number: maskAccount(b.account_number), last_paid_at: null });
});

router.delete("/beneficiaries/:id", async (req, res) => {
    const result = await Beneficiary.deleteOne({ id: Number(req.params.id), customer_id: req.customer.id });
    if (!result.deletedCount) throw notFound("Payee not found");
    res.json({ ok: true });
});

// -------------------------------------------------------------------- payments
const paymentLimit = limit({ name: "pay", windowSec: 60, max: 10, by: "user", message: "You are making payments too quickly. Please wait a minute." });
const idemKey = (h: unknown): string | undefined => (typeof h === "string" && /^[\w-]{8,64}$/.test(h) ? h : undefined);

router.post("/transfer", paymentLimit, async (req, res) => {
    const b = req.body ?? {};
    const result = await processPayment({
        userId: req.user!.id, customer: req.customer, kind: "TRANSFER", amount: money(b.amount),
        mode: oneOf<PaymentMode>(b.mode, ["UPI", "IMPS", "NEFT", "RTGS"], "Payment mode", "UPI"),
        remarks: str(b.remarks, "Remarks", { max: 60, optional: true }), toAccountNumber: str(b.to_account_number, "Recipient account number"),
        saveBeneficiary: Boolean(b.save_beneficiary), pin: String(b.pin ?? ""), idempotencyKey: idemKey(req.headers["idempotency-key"]), ctx: req.ctx
    });
    res.status(result.replayed ? 200 : 201).json(result);
});

router.post("/pay", paymentLimit, async (req, res) => {
    const b = req.body ?? {};
    const result = await processPayment({
        userId: req.user!.id, customer: req.customer, kind: "MERCHANT", amount: money(b.amount), mode: "UPI",
        remarks: str(b.remarks, "Remarks", { max: 60, optional: true }), merchantId: str(b.merchant_id, "Merchant"),
        pin: String(b.pin ?? ""), idempotencyKey: idemKey(req.headers["idempotency-key"]), ctx: req.ctx
    });
    res.status(result.replayed ? 200 : 201).json(result);
});

// ---------------------------------------------------------------- transactions
router.get("/transactions", async (req, res) => { res.json(await listCustomerTransactions(req.customer.id, req.query)); });

router.get("/transactions/export", limit({ name: "export", windowSec: 300, max: 10, by: "user" }), async (req, res) => {
    const csv = await exportCustomerCsv(req.customer.id, req.query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="CertiFlow-statement-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
});

router.get("/transactions/:id", async (req, res) => { res.json(await getCustomerTransaction(req.customer.id, Number(req.params.id))); });

router.post("/transactions/:id/response", async (req, res) => {
    const response = oneOf(req.body?.response, ["ME", "NOT_ME"] as const, "Response");
    res.json(await customerResponse(req.customer, Number(req.params.id), response));
});

// --------------------------------------------------------------- notifications
router.get("/notifications", async (req, res) => {
    const { page, limit: lim, skip } = paging(req.query, 20, 50);
    const filter = { recipient_type: "CUSTOMER", customer_id: req.customer.id };
    const [items, total, unread] = await Promise.all([
        Notification.find(filter).sort({ created_at: -1 }).skip(skip).limit(lim).lean(),
        Notification.countDocuments(filter), Notification.countDocuments({ ...filter, is_read: false })
    ]);
    res.json({ items, total, unread, page, pages: Math.max(1, Math.ceil(total / lim)) });
});

router.post("/notifications/read", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
    const filter: Record<string, unknown> = { recipient_type: "CUSTOMER", customer_id: req.customer.id, is_read: false };
    if (ids) filter.id = { $in: ids };
    const r = await Notification.updateMany(filter, { $set: { is_read: true } });
    res.json({ updated: r.modifiedCount });
});

void badRequest; void bumpEpoch;
export default router;
