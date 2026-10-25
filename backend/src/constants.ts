export const BANK_NAME = "CertiFlow Bank";
export const IFSC_CODE = "CFLW0000001";
export const BRANCH_NAME = "CertiFlow Digital Main Branch";
export const SYSTEM_CUSTOMER_ID = 0; // the bank itself (deposits, salary credits)
export const SYSTEM_NAME = "CertiFlow Bank";

export const ROLES = { USER: "USER", FRAUD_ANALYST: "FRAUD_ANALYST", ADMIN: "ADMIN" } as const;

export type PaymentMode = "UPI" | "IMPS" | "NEFT" | "RTGS";
export const PAYMENT_MODES: Record<PaymentMode, { label: string; min: number; max: number; description: string }> = {
    UPI: { label: "UPI", min: 1, max: 100000, description: "Instant, up to ₹1,00,000" },
    IMPS: { label: "IMPS", min: 1, max: 500000, description: "Instant, up to ₹5,00,000" },
    NEFT: { label: "NEFT", min: 1, max: 5000000, description: "Batch settled, up to ₹50,00,000" },
    RTGS: { label: "RTGS", min: 200000, max: 10000000, description: "High value, minimum ₹2,00,000" }
};

export const TXN_TYPES = { TRANSFER: "BANK_TRANSFER", MERCHANT: "MERCHANT_PAYMENT", DEPOSIT: "DEPOSIT" } as const;

export const TXN_STATUS = {
    COMPLETED: "COMPLETED",
    HELD: "HELD",
    BLOCKED: "BLOCKED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED"
} as const;

export const CATEGORIES = [
    "Food & Dining", "Groceries", "Shopping", "Bills & Utilities", "Travel",
    "Entertainment", "Health", "Fuel", "Education", "Transfers"
] as const;

export interface Merchant { id: string; name: string; category: string; hint: string }

export const MERCHANTS: Merchant[] = [
    { id: "swiggy", name: "Swiggy", category: "Food & Dining", hint: "Food delivery" },
    { id: "zomato", name: "Zomato", category: "Food & Dining", hint: "Food delivery" },
    { id: "starbucks", name: "Starbucks", category: "Food & Dining", hint: "Cafe" },
    { id: "bigbasket", name: "BigBasket", category: "Groceries", hint: "Online groceries" },
    { id: "dmart", name: "DMart", category: "Groceries", hint: "Supermarket" },
    { id: "amazon", name: "Amazon", category: "Shopping", hint: "Online shopping" },
    { id: "flipkart", name: "Flipkart", category: "Shopping", hint: "Online shopping" },
    { id: "myntra", name: "Myntra", category: "Shopping", hint: "Fashion" },
    { id: "croma", name: "Croma", category: "Shopping", hint: "Electronics" },
    { id: "tneb", name: "TANGEDCO Electricity", category: "Bills & Utilities", hint: "Electricity bill" },
    { id: "airtel", name: "Airtel Postpaid", category: "Bills & Utilities", hint: "Mobile bill" },
    { id: "jio", name: "Jio Fiber", category: "Bills & Utilities", hint: "Broadband" },
    { id: "metrowater", name: "Metro Water Board", category: "Bills & Utilities", hint: "Water bill" },
    { id: "irctc", name: "IRCTC", category: "Travel", hint: "Train tickets" },
    { id: "uber", name: "Uber", category: "Travel", hint: "Cab rides" },
    { id: "makemytrip", name: "MakeMyTrip", category: "Travel", hint: "Flights & hotels" },
    { id: "netflix", name: "Netflix", category: "Entertainment", hint: "Subscription" },
    { id: "spotify", name: "Spotify", category: "Entertainment", hint: "Subscription" },
    { id: "bookmyshow", name: "BookMyShow", category: "Entertainment", hint: "Movies & events" },
    { id: "apollo", name: "Apollo Pharmacy", category: "Health", hint: "Pharmacy" },
    { id: "cultfit", name: "Cult.fit", category: "Health", hint: "Fitness" },
    { id: "iocl", name: "Indian Oil", category: "Fuel", hint: "Fuel station" },
    { id: "udemy", name: "Udemy", category: "Education", hint: "Online courses" },
    { id: "school", name: "CertiFlow School Fees", category: "Education", hint: "Tuition" }
];

export const getMerchant = (id: string): Merchant | undefined => MERCHANTS.find(m => m.id === id);

export const TRANSFER_CATEGORY = "Transfers";
export const DEPOSIT_CATEGORY = "Deposit";

export const DEFAULT_DAILY_LIMIT = { SAVINGS: 300000, CURRENT: 1000000 } as Record<string, number>;

export const DEFAULT_RISK_THRESHOLDS = { medium: 30, hold: 60, block: 80 };
