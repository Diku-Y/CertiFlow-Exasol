import { useEffect, useState } from "react";
import Icon from "./Icon";
import { Badge, Drawer, Empty, ErrorBox, Loading, Notice } from "./ui";
import { ScoreRing } from "./charts";
import { api, getSim } from "../lib/api";
import { categoryColor, dateTime, initials, inr, titleCase } from "../lib/format";
import { useToast } from "../context/ToastContext";

export function PinPad({ value, onChange, length = 6, onComplete }: { value: string; onChange: (v: string) => void; length?: number; onComplete?: (v: string) => void }) {
  const push = (d: string) => { if (value.length < length) { const v = value + d; onChange(v); if (v.length === length) onComplete?.(v); } };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) push(e.key);
      else if (e.key === "Backspace") onChange(value.slice(0, -1));
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }); // re-bound each render so it always sees the latest value
  return (
    <div>
      <div className="pin-dots" aria-label={`${value.length} of ${length} digits entered`}>{Array.from({ length }).map((_, i) => <i key={i} className={i < value.length ? "on" : ""} />)}</div>
      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => <button type="button" key={d} onClick={() => push(d)}>{d}</button>)}
        <button type="button" onClick={() => onChange("")} aria-label="Clear" style={{ fontSize: ".85rem" }}>Clear</button>
        <button type="button" onClick={() => push("0")}>0</button>
        <button type="button" onClick={() => onChange(value.slice(0, -1))} aria-label="Delete">⌫</button>
      </div>
    </div>
  );
}

export const TxnIcon = ({ t }: { t: any }) => {
  const credit = t.direction === "CREDIT";
  const bg = credit ? "var(--ok)" : categoryColor(t.category);
  return <div className="txn-ico" style={{ background: bg }} aria-hidden="true">{credit ? "↓" : initials(t.counterparty || "?")}</div>;
};

export const statusBadge = (status: string) => status === "COMPLETED" ? null : <Badge value={status} />;

export function TxnRow({ t, onClick }: { t: any; onClick?: () => void }) {
  const credit = t.direction === "CREDIT";
  const pending = t.status === "HELD";
  return (
    <div className="txn" onClick={onClick} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && onClick?.()}>
      <TxnIcon t={t} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.counterparty}</div>
        <div className="small muted">{dateTime(t.created_at)} · {t.category}{t.mode && t.mode !== "BANK" ? ` · ${t.mode}` : ""}</div>
      </div>
      <div>
        <div className={`amt ${credit && t.status === "COMPLETED" ? "pos" : ""}`} style={t.status !== "COMPLETED" ? { color: "var(--text-3)", textDecoration: t.status === "HELD" ? "none" : "line-through" } : undefined}>
          {credit ? "+" : "−"}{inr(t.amount)}
        </div>
        <div className="right">{pending || t.status !== "COMPLETED" ? <Badge value={t.status} /> : null}</div>
      </div>
    </div>
  );
}

/** Fraud-engine view (only available when the backend runs with DEMO_SHOW_RISK_TO_CUSTOMER and the user enabled insights). */
export function SecurityInsights({ s }: { s: any }) {
  if (!s) return null;
  return (
    <div className="card soft col" style={{ textAlign: "left" }}>
      <div className="row"><Icon name="shield" /><strong>Security engine insights</strong><span className="badge plain info">demo</span></div>
      <div className="row" style={{ gap: 18 }}>
        <ScoreRing score={s.risk_score} />
        <div className="col gap-sm small">
          <div>Decision: <Badge value={s.decision} /></div>
          <div className="muted">Rules score <strong>{s.rule_score}</strong> · ML score <strong>{s.ml_score ?? "n/a"}</strong>{s.ml_probability !== null && s.ml_probability !== undefined && <> · fraud probability <strong>{(s.ml_probability * 100).toFixed(1)}%</strong></>}</div>
          {s.ml_model_version && <div className="faint">Model v{s.ml_model_version}{s.ml_available ? "" : " (unavailable - rules only)"}</div>}
        </div>
      </div>
      {s.reasons?.length > 0 && <div><div className="small muted" style={{ marginBottom: 4 }}>Rules that fired</div>{s.reasons.map((r: any) => <div key={r.code} className="small">• <strong>{r.title}</strong> (+{r.points}) — {r.detail}</div>)}</div>}
      {s.drivers?.length > 0 && <div><div className="small muted" style={{ marginBottom: 4 }}>What the model noticed</div>{s.drivers.map((d: any) => (
        <div key={d.feature} className="small" style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 8, alignItems: "center", padding: "3px 0" }}>
          <span>{d.detail}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${d.impact}%`, background: "var(--bad)" }} /></div>
        </div>))}</div>}
      {!s.reasons?.length && !s.drivers?.length && <div className="small muted">Nothing unusual about this payment.</div>}
    </div>
  );
}

export function Receipt({ r, onDone, doneLabel = "Done", extra }: { r: any; onDone: () => void; doneLabel?: string; extra?: React.ReactNode }) {
  const tone = r.status === "COMPLETED" ? "ok" : r.status === "HELD" ? "warn" : "bad";
  const icon = r.status === "COMPLETED" ? "✓" : r.status === "HELD" ? "⏳" : "✕";
  const title = r.status === "COMPLETED" ? "Payment successful" : r.status === "HELD" ? "Payment under review" : "Payment declined";
  const showSec = getSim().insights && r.security;
  return (
    <div className="receipt col gap-lg">
      <div><div className={`tick ${tone}`}>{icon}</div><h2>{title}</h2><div className="amt">{inr(r.amount)}</div><div className="muted">to {r.counterparty}</div></div>
      {r.status !== "COMPLETED" && <Notice tone={r.status === "HELD" ? "warn" : "bad"}>{r.message}</Notice>}
      <dl className="kv">
        <dt>Reference</dt><dd className="mono">{r.reference}</dd>
        <dt>Date & time</dt><dd>{dateTime(r.created_at)}</dd>
        <dt>Mode</dt><dd>{r.mode}</dd>
        {r.counterparty_account && <><dt>To account</dt><dd className="mono">{r.counterparty_account}</dd></>}
        {r.remarks && <><dt>Remarks</dt><dd>{r.remarks}</dd></>}
        {r.status === "COMPLETED" && <><dt>Balance</dt><dd>{inr(r.available_balance)}</dd></>}
      </dl>
      {showSec && <SecurityInsights s={r.security} />}
      {extra}
      <button className="btn primary lg block" onClick={onDone}>{doneLabel}</button>
    </div>
  );
}

export function TxnDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged?: () => void }) {
  const [t, setT] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const load = () => api(`/banking/transactions/${id}`).then(setT).catch(e => setError(e.message));
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const respond = async (response: "ME" | "NOT_ME") => {
    setBusy(true);
    try {
      await api(`/banking/transactions/${id}/response`, { body: { response } });
      toast({ tone: response === "ME" ? "success" : "warning", title: response === "ME" ? "Thanks for confirming" : "We’re on it", text: response === "ME" ? "Your confirmation helps us protect you." : "Our security team has been alerted and will contact you." });
      await load(); onChanged?.();
    } catch (e: any) { toast({ tone: "error", title: "Could not send response", text: e.message }); } finally { setBusy(false); }
  };
  return (
    <Drawer title="Transaction details" onClose={onClose}>
      {error ? <ErrorBox message={error} /> : !t ? <Loading /> : (
        <>
          <div className="center"><TxnIcon t={t} /><div className="amt" style={{ fontSize: "1.9rem", fontWeight: 800, marginTop: 8 }}>{t.direction === "CREDIT" ? "+" : "−"}{inr(t.amount)}</div><div className="muted">{t.direction === "CREDIT" ? "from" : "to"} {t.counterparty}</div><div className="mt"><Badge value={t.status} /></div></div>
          {t.status === "HELD" && <Notice tone="warn">This payment is on hold for a security review. The money has not left your account yet.</Notice>}
          {t.status === "BLOCKED" && <Notice tone="bad">We declined this payment for security reasons.</Notice>}
          {t.failure_reason && t.status !== "BLOCKED" && <Notice tone="bad">{t.failure_reason}</Notice>}
          <dl className="kv">
            <dt>Reference</dt><dd className="mono">{t.reference}</dd><dt>Date & time</dt><dd>{dateTime(t.created_at)}</dd>
            <dt>Type</dt><dd>{titleCase(t.type)}</dd><dt>Mode</dt><dd>{t.mode}</dd><dt>Category</dt><dd>{t.category}</dd>
            {t.counterparty_account && <><dt>Account</dt><dd className="mono">{t.counterparty_account}</dd></>}
            {t.remarks && <><dt>Remarks</dt><dd>{t.remarks}</dd></>}
            {t.location && <><dt>Initiated from</dt><dd>{t.location}</dd></>}
            {t.balance_after !== null && t.balance_after !== undefined && <><dt>Balance after</dt><dd>{inr(t.balance_after)}</dd></>}
          </dl>
          {t.needs_response && (
            <div className="card soft col"><strong>Was this payment made by you?</strong><div className="row"><button className="btn good grow" disabled={busy} onClick={() => respond("ME")}>Yes, it was me</button><button className="btn danger grow" disabled={busy} onClick={() => respond("NOT_ME")}>No, it wasn’t me</button></div></div>
          )}
          {t.customer_response && <Notice tone={t.customer_response === "ME" ? "ok" : "warn"}>You told us this {t.customer_response === "ME" ? "was" : "was NOT"} you.</Notice>}
          {getSim().insights && t.security && <SecurityInsights s={t.security} />}
        </>
      )}
    </Drawer>
  );
}

export const NoTransactions = () => <Empty icon="receipt" title="No transactions yet" text="Your payments and deposits will appear here." />;
