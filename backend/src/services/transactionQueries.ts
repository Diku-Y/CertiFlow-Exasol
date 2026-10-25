import Customer from "../models/Customer";
import Transaction from "../models/Transaction";
import { badRequest, notFound } from "../utils/httpError";
import { escapeRegex, paging, parseDate } from "../utils/validate";
import { customerView, staffView } from "./transactionViews";

const textFilter = (q: string) => {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    return [{ recipient_name: rx }, { sender_name: rx }, { remarks: rx }, { transaction_number: rx }, { category: rx }];
};

const dateAndAmount = (query: Record<string, any>, filter: Record<string, any>) => {
    const from = parseDate(query.from, "From date"), to = parseDate(query.to, "To date");
    if (from || to) {
        filter.created_at = {};
        if (from) filter.created_at.$gte = from;
        if (to) filter.created_at.$lte = new Date(to.getTime() + (String(query.to).length <= 10 ? 86399999 : 0));
    }
    const min = query.min !== undefined && query.min !== "" ? Number(query.min) : undefined;
    const max = query.max !== undefined && query.max !== "" ? Number(query.max) : undefined;
    if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))) throw badRequest("Amount filters must be numbers");
    if (min !== undefined || max !== undefined) {
        filter.amount = {};
        if (min !== undefined) filter.amount.$gte = min;
        if (max !== undefined) filter.amount.$lte = max;
    }
};

const customerFilter = (customerId: number, query: Record<string, any>) => {
    const filter: Record<string, any> = {};
    const type = query.type ?? "all";
    // Recipients only ever see completed credits - never held or blocked payments aimed at them.
    if (type === "debit") filter.customer_id = customerId;
    else if (type === "credit") { filter.recipient_customer_id = customerId; filter.status = "COMPLETED"; }
    else filter.$or = [{ customer_id: customerId }, { recipient_customer_id: customerId, status: "COMPLETED" }];
    if (query.status && query.status !== "ALL" && type !== "credit") filter.status = query.status;
    if (query.category && query.category !== "ALL") filter.category = query.category;
    if (query.mode && query.mode !== "ALL") filter.payment_mode = query.mode;
    if (query.q) filter.$and = [{ $or: textFilter(String(query.q).slice(0, 60)) }];
    dateAndAmount(query, filter);
    return filter;
};

export const listCustomerTransactions = async (customerId: number, query: Record<string, any>) => {
    const { page, limit, skip } = paging(query, 15, 100);
    const filter = customerFilter(customerId, query);
    const [rows, total] = await Promise.all([
        Transaction.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
        Transaction.countDocuments(filter)
    ]);
    return { items: rows.map(t => customerView(t, customerId)), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
};

export const getCustomerTransaction = async (customerId: number, id: number) => {
    const t = await Transaction.findOne({ id, $or: [{ customer_id: customerId }, { recipient_customer_id: customerId, status: "COMPLETED" }] }).lean();
    if (!t) throw notFound("Transaction not found");
    return customerView(t, customerId);
};

const csvCell = (value: unknown): string => {
    let s = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const exportCustomerCsv = async (customerId: number, query: Record<string, any>): Promise<string> => {
    const rows = await Transaction.find(customerFilter(customerId, query)).sort({ created_at: -1 }).limit(5000).lean();
    const header = ["Date", "Reference", "Description", "Type", "Mode", "Category", "Status", "Debit", "Credit", "Balance", "Remarks"];
    const lines = [header.join(",")];
    for (const t of rows) {
        const v = customerView(t, customerId) as any;
        lines.push([
            new Date(t.created_at).toISOString(), t.transaction_number, v.counterparty, v.direction, t.payment_mode, t.category, t.status,
            v.direction === "DEBIT" ? t.amount.toFixed(2) : "", v.direction === "CREDIT" ? t.amount.toFixed(2) : "", v.balance_after ?? "", t.remarks
        ].map(csvCell).join(","));
    }
    return lines.join("\n");
};

export const listStaffTransactions = async (query: Record<string, any>) => {
    const { page, limit, skip } = paging(query, 20, 100);
    const filter: Record<string, any> = {};
    for (const key of ["status", "risk_level", "decision", "category"]) if (query[key] && query[key] !== "ALL") filter[key] = query[key];
    if (query.type && query.type !== "ALL") filter.transaction_type = query.type;
    if (query.customer_id) filter.customer_id = Number(query.customer_id);
    if (query.min_risk) filter.risk_score = { $gte: Number(query.min_risk) || 0 };
    if (query.review === "FRAUD" || query.review === "LEGIT") filter.review_decision = query.review;
    if (query.q) {
        const q = String(query.q).slice(0, 60);
        const matched = await Customer.find({ name: { $regex: escapeRegex(q), $options: "i" } }).select("id").limit(100).lean();
        filter.$and = [{ $or: [...textFilter(q), { customer_id: { $in: matched.map(c => c.id) } }] }];
    }
    dateAndAmount(query, filter);
    const [rows, total] = await Promise.all([
        Transaction.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
        Transaction.countDocuments(filter)
    ]);
    const names = await customerNames(rows.map(r => r.customer_id));
    return { items: rows.map(t => staffView(t, names)), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
};

export const customerNames = async (ids: number[]): Promise<Map<number, string>> => {
    const customers = await Customer.find({ id: { $in: [...new Set(ids)] } }).select("id name").lean();
    return new Map(customers.map(c => [c.id, c.name]));
};

export const getStaffTransaction = async (id: number) => {
    const t = await Transaction.findOne({ id }).lean();
    if (!t) throw notFound("Transaction not found");
    return staffView(t, await customerNames([t.customer_id]));
};
