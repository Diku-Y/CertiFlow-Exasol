/** Spending analytics for the customer dashboard ("transaction metrics"). Cached in Redis per customer epoch. */
import { env } from "../config/env";
import Account from "../models/Account";
import Transaction from "../models/Transaction";
import { localDateKey } from "../utils/time";
import { roundMoney } from "../utils/ids";
import { loadProfile } from "./behaviorService";
import { cached, getEpoch, K } from "./redis/primitives";

const tz = env.timezone;
const dayKey = { $dateToString: { format: "%Y-%m-%d", date: "$created_at", timezone: tz } };
const monthKey = { $dateToString: { format: "%Y-%m", date: "$created_at", timezone: tz } };

const pct = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const customerAnalytics = async (customer: any, rangeDays: number) => {
    const epoch = await getEpoch(`cust:${customer.id}`);
    return cached(K("cache", "dash", customer.id, rangeDays, epoch), 45, () => compute(customer, rangeDays));
};

const compute = async (customer: any, rangeDays: number) => {
    const cid = customer.id;
    const now = new Date();
    const since = new Date(now.getTime() - rangeDays * 86400000);
    const prevSince = new Date(since.getTime() - rangeDays * 86400000);
    const sixMonths = new Date(now.getTime() - 190 * 86400000);
    const spend = (from: Date, to?: Date) => ({ customer_id: cid, status: "COMPLETED", transaction_type: { $ne: "DEPOSIT" }, created_at: to ? { $gte: from, $lt: to } : { $gte: from } });
    const earn = (from: Date, to?: Date) => ({ recipient_customer_id: cid, status: "COMPLETED", created_at: to ? { $gte: from, $lt: to } : { $gte: from } });
    const total = (match: object) => Transaction.aggregate([{ $match: match }, { $group: { _id: null, sum: { $sum: "$amount" }, n: { $sum: 1 }, avg: { $avg: "$amount" } } }]);

    const [account, spendNow, earnNow, spendPrev, earnPrev, byCategory, daily, dailyIn, monthlySpend, monthlyIncome, topPayees, byMode, byHour, largest, held, flagged, profile, recent] = await Promise.all([
        Account.findOne({ customer_id: cid }).lean(),
        total(spend(since)), total(earn(since)), total(spend(prevSince, since)), total(earn(prevSince, since)),
        Transaction.aggregate([{ $match: spend(since) }, { $group: { _id: "$category", amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
        Transaction.aggregate([{ $match: spend(since) }, { $group: { _id: dayKey, amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
        Transaction.aggregate([{ $match: earn(since) }, { $group: { _id: dayKey, amount: { $sum: "$amount" } } }]),
        Transaction.aggregate([{ $match: spend(sixMonths) }, { $group: { _id: monthKey, amount: { $sum: "$amount" } } }]),
        Transaction.aggregate([{ $match: earn(sixMonths) }, { $group: { _id: monthKey, amount: { $sum: "$amount" } } }]),
        Transaction.aggregate([{ $match: spend(since) }, { $group: { _id: { $ifNull: ["$recipient_name", "Unknown"] }, amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }, { $limit: 5 }]),
        Transaction.aggregate([{ $match: spend(since) }, { $group: { _id: "$payment_mode", amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
        Transaction.aggregate([{ $match: spend(since) }, { $group: { _id: { $hour: { date: "$created_at", timezone: tz } }, count: { $sum: 1 } } }]),
        Transaction.findOne(spend(since)).sort({ amount: -1 }).select("amount recipient_name created_at category").lean(),
        Transaction.aggregate([{ $match: { customer_id: cid, status: "HELD" } }, { $group: { _id: null, sum: { $sum: "$amount" }, n: { $sum: 1 } } }]),
        Transaction.countDocuments({ customer_id: cid, status: { $in: ["HELD", "BLOCKED"] }, created_at: { $gte: since } }),
        loadProfile(cid),
        Transaction.find({ $or: [{ customer_id: cid }, { recipient_customer_id: cid, status: "COMPLETED" }] }).sort({ created_at: -1 }).limit(6).lean()
    ]);

    const spending = roundMoney(spendNow[0]?.sum ?? 0), income = roundMoney(earnNow[0]?.sum ?? 0);
    const prevSpending = spendPrev[0]?.sum ?? 0, prevIncome = earnPrev[0]?.sum ?? 0;

    const days: string[] = [];
    for (let i = rangeDays - 1; i >= 0; i--) days.push(localDateKey(new Date(now.getTime() - i * 86400000)));
    const dm = new Map(daily.map((d: any) => [d._id, d])), im = new Map(dailyIn.map((d: any) => [d._id, d.amount]));
    const series = days.map(date => ({ date, spending: roundMoney((dm.get(date) as any)?.amount ?? 0), count: (dm.get(date) as any)?.count ?? 0, income: roundMoney((im.get(date) as number) ?? 0) }));

    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
        months.push(localDateKey(d).slice(0, 7));
    }
    const ms = new Map(monthlySpend.map((d: any) => [d._id, d.amount])), mi = new Map(monthlyIncome.map((d: any) => [d._id, d.amount]));
    const monthly = months.map(m => ({ month: m, spending: roundMoney((ms.get(m) as number) ?? 0), income: roundMoney((mi.get(m) as number) ?? 0) }));

    const catTotal = byCategory.reduce((s: number, c: any) => s + c.amount, 0) || 1;
    const categories = byCategory.map((c: any) => ({ category: c._id, amount: roundMoney(c.amount), count: c.count, share: Math.round((c.amount / catTotal) * 1000) / 10 }));
    const hours = new Array(24).fill(0);
    for (const h of byHour) hours[h._id] = h.count;

    const insights: { tone: "info" | "good" | "warn"; text: string }[] = [];
    const change = pct(spending, prevSpending);
    if (change !== null && Math.abs(change) >= 5) insights.push({ tone: change > 0 ? "warn" : "good", text: `You spent ${Math.abs(change)}% ${change > 0 ? "more" : "less"} than in the previous ${rangeDays} days.` });
    if (categories[0]) insights.push({ tone: "info", text: `${categories[0].category} is your biggest category at ${categories[0].share}% of spending (${inr(categories[0].amount)}).` });
    if (income > 0 && spending > 0) insights.push({ tone: spending <= income ? "good" : "warn", text: spending <= income ? `You saved ${inr(income - spending)} - ${Math.round(((income - spending) / income) * 100)}% of what came in.` : `You spent ${inr(spending - income)} more than you received this period.` });
    if (largest) insights.push({ tone: "info", text: `Your largest payment was ${inr(largest.amount)} to ${largest.recipient_name ?? "a merchant"}.` });
    if (flagged > 0) insights.push({ tone: "warn", text: `${flagged} payment(s) were held or declined for security checks in this period.` });

    const topHours = hours.map((count, hour) => ({ hour, count })).sort((a, b) => b.count - a.count).slice(0, 3).filter(h => h.count > 0).map(h => h.hour).sort((a, b) => a - b);

    return {
        range_days: rangeDays,
        balance: account ? roundMoney(account.balance_paise / 100) : 0,
        pending_amount: roundMoney(held[0]?.sum ?? 0), pending_count: held[0]?.n ?? 0,
        summary: {
            income, spending, net: roundMoney(income - spending), transactions: spendNow[0]?.n ?? 0,
            average_payment: roundMoney(spendNow[0]?.avg ?? 0), largest_payment: largest ? { amount: largest.amount, to: largest.recipient_name, date: largest.created_at, category: largest.category } : null,
            spending_change_pct: change, income_change_pct: pct(income, prevIncome), savings_rate: income > 0 ? Math.max(-100, Math.round(((income - spending) / income) * 100)) : null
        },
        categories, series, monthly,
        top_payees: topPayees.map((p: any) => ({ name: p._id, amount: roundMoney(p.amount), count: p.count })),
        modes: byMode.map((m: any) => ({ mode: m._id, amount: roundMoney(m.amount), count: m.count })),
        hours, insights,
        security: {
            flagged_in_period: flagged, known_devices: profile.devices.length, known_locations: profile.locations,
            known_payees: profile.recipients.length, usual_hours: topHours, typical_payment: profile.count ? Math.round(profile.total / profile.count) : 0
        },
        recent_ids: recent.map(r => r.id)
    };
};
