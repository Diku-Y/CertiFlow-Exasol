/**
 * Real-time events. Publishers call publishEvent(); every backend instance subscribes to the Redis
 * channel and forwards matching events to its connected Server-Sent-Events clients.
 * Without Redis, events are delivered in-process (single instance still works).
 */
import { Response } from "express";
import { getRedis } from "./client";
import { K } from "./primitives";

export type Audience = "staff" | `user:${number}`;
export interface AppEvent { audience: Audience; type: string; data: unknown }

interface Client { id: number; userId: number; role: string; res: Response }
const clients = new Map<number, Client>();
let nextId = 1;
let subscribed = false;

const CHANNEL = K("events");

const dispatch = (event: AppEvent): void => {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const c of clients.values()) {
        const staff = c.role === "ADMIN" || c.role === "FRAUD_ANALYST";
        const matches = event.audience === "staff" ? staff : event.audience === `user:${c.userId}`;
        if (matches) {
            try { c.res.write(payload); } catch { clients.delete(c.id); }
        }
    }
};

export const initEvents = async (): Promise<void> => {
    const r = getRedis();
    if (!r || subscribed) return;
    try {
        await r.subscribe(CHANNEL, message => {
            try { dispatch(JSON.parse(message) as AppEvent); } catch { /* ignore malformed */ }
        });
        subscribed = true;
    } catch (error) {
        console.warn("Redis pub/sub unavailable, using in-process events:", (error as Error).message);
    }
};

export const publishEvent = async (event: AppEvent): Promise<void> => {
    const r = getRedis();
    if (r && subscribed) {
        try {
            await r.publish(CHANNEL, JSON.stringify(event));
            return;
        } catch { /* fall back to local delivery */ }
    }
    dispatch(event);
};

export const addClient = (userId: number, role: string, res: Response): (() => void) => {
    const id = nextId++;
    clients.set(id, { id, userId, role, res });
    const heartbeat = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 25000);
    return () => { clearInterval(heartbeat); clients.delete(id); };
};

export const connectedClients = (): number => clients.size;
