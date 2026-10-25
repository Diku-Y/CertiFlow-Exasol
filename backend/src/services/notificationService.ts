import { ClientSession } from "mongoose";
import Notification from "../models/Notification";
import { getNextSequence } from "../utils/counter";
import { generateNotificationNumber } from "../utils/ids";
import { publishEvent } from "./redis/events";

export interface NotificationInput {
    recipientType: "CUSTOMER" | "STAFF";
    customerId?: number | null;
    userId?: number | null;      // for real-time delivery to the customer's browser
    alertId?: number | null;
    transactionId?: number | null;
    type: string;
    title: string;
    message: string;
    severity?: "INFO" | "WARNING" | "CRITICAL";
    actionRequired?: boolean;
}

/** DB write only (safe inside a Mongo transaction). Call announceNotification() after commit. */
export const createNotification = async (input: NotificationInput, session?: ClientSession) => {
    const [doc] = await Notification.create([{
        id: await getNextSequence("notification_id", session),
        notification_number: generateNotificationNumber(),
        recipient_type: input.recipientType,
        customer_id: input.customerId ?? null,
        alert_id: input.alertId ?? null,
        transaction_id: input.transactionId ?? null,
        notification_type: input.type,
        title: input.title,
        message: input.message,
        severity: input.severity ?? "INFO",
        action_required: input.actionRequired ?? false
    }], { session });
    return doc;
};

export const announceNotification = (input: NotificationInput, doc: { id: number; title: string; message: string; severity: string; created_at: Date }): void => {
    const data = { id: doc.id, title: doc.title, message: doc.message, severity: doc.severity, created_at: doc.created_at, type: input.type };
    if (input.recipientType === "STAFF") void publishEvent({ audience: "staff", type: "notification", data });
    else if (input.userId) void publishEvent({ audience: `user:${input.userId}`, type: "notification", data });
};
