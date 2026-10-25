import { ClientSession } from "mongoose";
import Account, { IAccount } from "../models/Account";
import Customer from "../models/Customer";
import Transaction from "../models/Transaction";
import { BANK_NAME, BRANCH_NAME, DEPOSIT_CATEGORY, IFSC_CODE, SYSTEM_CUSTOMER_ID, SYSTEM_NAME } from "../constants";
import { getNextSequence } from "../utils/counter";
import { generateAccountNumber, generateTransactionNumber, maskAccount, roundMoney } from "../utils/ids";
import { badRequest, notFound } from "../utils/httpError";
import { getSettings } from "./settingsService";

export const maskName = (name: string): string =>
    name.split(/\s+/).filter(Boolean).map(p => p[0] + "*".repeat(Math.max(2, Math.min(p.length - 1, 6)))).join(" ");

export const accountView = (a: IAccount | any) => ({
    id: a.id, account_number: a.account_number, masked_account_number: maskAccount(a.account_number),
    account_type: a.account_type, balance: roundMoney(a.balance_paise / 100), currency: a.currency, status: a.status,
    daily_limit: a.daily_limit, ifsc: a.ifsc, branch: a.branch, bank: BANK_NAME, opened_on: a.created_at
});

export const getAccountForCustomer = async (customerId: number) => {
    const account = await Account.findOne({ customer_id: customerId });
    if (!account) throw notFound("No bank account found for this customer", "NO_ACCOUNT");
    return account;
};

/** Name-check a payee before money moves (like UPI / NEFT beneficiary verification). */
export const lookupPayee = async (accountNumber: string, requesterCustomerId: number) => {
    if (!/^\d{12}$/.test(accountNumber)) throw badRequest("Account numbers have 12 digits");
    const account = await Account.findOne({ account_number: accountNumber }).lean();
    if (!account || account.status === "CLOSED") throw notFound("No account found with this number", "PAYEE_NOT_FOUND");
    if (account.customer_id === requesterCustomerId) throw badRequest("You cannot send money to your own account", "SELF_TRANSFER");
    const customer = await Customer.findOne({ id: account.customer_id }).select("name").lean();
    return {
        account_number: account.account_number, masked_account_number: maskAccount(account.account_number),
        holder_name_masked: maskName(customer?.name ?? "Account holder"), bank: BANK_NAME, ifsc: account.ifsc,
        can_receive: account.status === "ACTIVE"
    };
};

/** Credit money from the bank into an account (opening balance, salary, cash deposit). */
export const creditFromBank = async (
    account: IAccount, amount: number, remarks: string, session?: ClientSession, category = DEPOSIT_CATEGORY
) => {
    const paise = Math.round(amount * 100);
    const updated = await Account.findOneAndUpdate({ id: account.id }, { $inc: { balance_paise: paise } }, { new: true, session });
    if (!updated) throw notFound("Account not found");
    const customer = await Customer.findOne({ id: account.customer_id }).select("name").session(session ?? null).lean();
    const now = new Date();
    const [txn] = await Transaction.create([{
        id: await getNextSequence("transaction_id", session), transaction_number: generateTransactionNumber(),
        customer_id: SYSTEM_CUSTOMER_ID, sender_name: SYSTEM_NAME,
        recipient_customer_id: account.customer_id, recipient_account_number: account.account_number,
        recipient_name: customer?.name ?? null, amount: roundMoney(amount), transaction_type: "DEPOSIT",
        payment_mode: "BANK", category, remarks, status: "COMPLETED", decision: "ALLOW",
        recipient_balance_after: updated.balance_paise / 100, created_at: now, completed_at: now
    }], { session });
    return { account: updated, transaction: txn };
};

export const openAccount = async (
    customerId: number, type: "SAVINGS" | "CURRENT", openingBalance: number, session?: ClientSession
) => {
    const settings = await getSettings();
    const [account] = await Account.create([{
        id: await getNextSequence("account_id", session), customer_id: customerId,
        account_number: generateAccountNumber(), account_type: type, balance_paise: 0, status: "ACTIVE",
        daily_limit: settings.default_daily_limit[type], ifsc: IFSC_CODE, branch: BRANCH_NAME
    }], { session });
    if (openingBalance > 0) await creditFromBank(account, openingBalance, "Opening balance", session);
    return account;
};
