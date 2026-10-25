import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Icon from "./Icon";
import { titleCase } from "../lib/format";

export const Card = ({ title, action, children, className = "", tight }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; tight?: boolean }) => (
  <section className={`card ${tight ? "tight" : ""} ${className}`}>
    {(title || action) && <div className="card-head">{typeof title === "string" ? <h3>{title}</h3> : title}{action}</div>}
    {children}
  </section>
);

export const PageHead = ({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) => (
  <div className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{actions && <div className="row wrap">{actions}</div>}</div>
);

export const Kpi = ({ label, value, sub, delta, icon, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; delta?: number | null; icon?: string; tone?: "pos" | "neg" | "warnc" }) => (
  <div className="card kpi">
    <div className="label">{icon && <Icon name={icon} size={15} />}{label}</div>
    <div className={`value ${tone || ""}`}>{value}</div>
    <div className="sub row wrap gap-sm">{delta !== undefined && delta !== null && <Delta value={delta} />}{sub}</div>
  </div>
);

/** `invert`: for spending, an increase is "bad". */
export const Delta = ({ value, invert }: { value: number; invert?: boolean }) => {
  const up = value > 0, flat = Math.abs(value) < 0.5;
  const good = invert ? !up : up;
  return <span className={`delta ${flat ? "flat" : good ? "up" : "down"}`}>{flat ? "–" : up ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%</span>;
};

const TONES: Record<string, string> = {
  COMPLETED: "ok", ACTIVE: "ok", RESOLVED: "ok", LOW: "ok", ALLOW: "ok", FALSE_POSITIVE: "ok", LEGIT: "ok", ok: "ok", up: "ok", stable: "ok",
  HELD: "warn", PENDING: "warn", MEDIUM: "warn", NEW: "warn", IN_REVIEW: "info", ALLOW_NOTIFY: "warn", HOLD: "warn", moderate: "warn", SUSPENDED: "warn", WARNING: "warn", INFO: "info",
  BLOCKED: "bad", FAILED: "bad", HIGH: "bad", CRITICAL: "bad", BLOCK: "bad", REJECTED: "bad", CONFIRMED_FRAUD: "bad", FRAUD: "bad", DISABLED: "bad", CANCELLED: "plain", significant: "bad", down: "bad",
  ADMIN: "purple", FRAUD_ANALYST: "info", USER: "plain"
};
export const Badge = ({ value, label, tone }: { value: string; label?: string; tone?: string }) => (
  <span className={`badge ${tone || TONES[value] || ""}`}>{label || titleCase(value)}</span>
);

export const Loading = ({ text }: { text?: string }) => <div className="page-loading"><div className="col center gap-sm" style={{ alignItems: "center" }}><span className="spinner" />{text && <span className="muted small">{text}</span>}</div></div>;
export const ErrorBox = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div className="alert-box bad"><span className="ico"><Icon name="alert" /></span><div className="grow">{message}</div>{retry && <button className="btn sm" onClick={retry}>Retry</button>}</div>
);
export const Empty = ({ icon = "list", title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) => (
  <div className="empty"><div className="big"><Icon name={icon} size={34} /></div><h3>{title}</h3>{text && <p className="small mt">{text}</p>}{action && <div className="mt">{action}</div>}</div>
);
export const Notice = ({ tone = "info", children, icon }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode; icon?: string }) => (
  <div className={`alert-box ${tone === "info" ? "" : tone}`}><span className="ico"><Icon name={icon || (tone === "ok" ? "check" : tone === "info" ? "info" : "alert")} /></span><div className="grow">{children}</div></div>
);

export function Field({ label, hint, error, children }: { label?: string; hint?: string; error?: string | null; children: ReactNode }) {
  return <div className="field">{label && <label>{label}</label>}{children}{error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}</div>;
}
export const Switch = ({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <label className="switch"><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span /></label>
);
export const Seg = <T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) => (
  <div className="seg">{options.map(o => <button key={String(o.value)} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>
);

export function Modal({ title, sub, onClose, children, actions }: { title: string; sub?: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="overlay center" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>{sub && <p className="muted small">{sub}</p>}
        <div className="col mt">{children}</div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <aside className={`drawer ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="drawer-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function Pager({ page, pages, total, onPage, label = "items" }: { page: number; pages: number; total?: number; onPage: (p: number) => void; label?: string }) {
  if (pages <= 1 && !total) return null;
  return (
    <div className="pager">
      <span>{total !== undefined ? `${total.toLocaleString("en-IN")} ${label}` : ""}</span>
      <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button><span>Page {page} of {pages}</span><button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button></div>
    </div>
  );
}

export const Skeleton = ({ h = 20, w = "100%" }: { h?: number; w?: number | string }) => <div className="skeleton" style={{ height: h, width: w }} />;

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(t => <button key={t.value} role="tab" aria-selected={t.value === value} className={t.value === value ? "on" : ""} onClick={() => onChange(t.value)}>{t.label}</button>)}</div>;
}

/** Confirm dialog helper hook: const [ask, dialog] = useConfirm(); await ask({...}) */
export function useConfirm() {
  const [state, setState] = useState<null | { title: string; text: string; confirm: string; danger?: boolean; resolve: (v: boolean) => void }>(null);
  const ask = (o: { title: string; text: string; confirm?: string; danger?: boolean }) => new Promise<boolean>(resolve => setState({ title: o.title, text: o.text, confirm: o.confirm || "Confirm", danger: o.danger, resolve }));
  const done = (v: boolean) => { state?.resolve(v); setState(null); };
  const dialog = state ? (
    <Modal title={state.title} onClose={() => done(false)} actions={<><button className="btn" onClick={() => done(false)}>Cancel</button><button className={`btn ${state.danger ? "danger" : "primary"}`} onClick={() => done(true)}>{state.confirm}</button></>}>
      <p className="muted">{state.text}</p>
    </Modal>
  ) : null;
  return [ask, dialog] as const;
}

export const CopyButton = ({ text, label = "Copy" }: { text: string; label?: string }) => {
  const [done, setDone] = useState(false);
  return <button className="btn sm ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } }}><Icon name={done ? "check" : "copy"} size={14} />{done ? "Copied" : label}</button>;
};
