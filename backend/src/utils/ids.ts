import { randomInt } from "crypto";

export const generateTransactionNumber = (): string => {
    const d = new Date();
    const stamp = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
    return `CF${stamp}${String(randomInt(0, 10 ** 10)).padStart(10, "0")}`;
};

export const generateAccountNumber = (): string => `5${String(randomInt(0, 10 ** 11)).padStart(11, "0")}`;
export const generateAlertNumber = (): string => `ALR-${Date.now().toString(36).toUpperCase()}${randomInt(100, 999)}`;
export const generateNotificationNumber = (): string => `NTF-${Date.now().toString(36).toUpperCase()}${randomInt(100, 999)}`;

export const maskAccount = (accountNumber: string | null | undefined): string | null =>
    accountNumber ? `XXXX${accountNumber.slice(-4)}` : null;

export const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
export const toMinor = (rupees: number): number => Math.round(rupees * 100);
export const fromMinor = (minor: number): number => Math.round(minor) / 100;
