import AuditLog from "../models/AuditLog";

export interface Actor { id: number | null; name: string; role: string; ip?: string }

export const SYSTEM_ACTOR: Actor = { id: null, name: "System", role: "SYSTEM" };

/** Fire-and-forget: a failed audit write must never fail the business operation (it is logged loudly instead). */
export const audit = (actor: Actor, action: string, target: { type?: string; id?: string | number } = {}, summary = "", details: Record<string, unknown> | null = null): void => {
    AuditLog.create({
        actor_id: actor.id, actor_name: actor.name, actor_role: actor.role, action,
        target_type: target.type ?? "", target_id: target.id !== undefined ? String(target.id) : "",
        summary, details, ip: actor.ip ?? ""
    }).catch(error => console.error("AUDIT WRITE FAILED", action, (error as Error).message));
};
