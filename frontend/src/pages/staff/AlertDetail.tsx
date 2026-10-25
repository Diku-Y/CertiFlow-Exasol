import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { HourHeat } from "../../components/charts";
import { RiskExplain } from "../../components/staff";
import { Badge, Card, Empty, ErrorBox, Loading, Modal, Notice, PageHead } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { ago, dateTime, inr, titleCase } from "../../lib/format";
import { useFetch } from "../../lib/hooks";
import { useLive } from "../../lib/live";

export default function AlertDetail({ base }: { base: string }) {
  const { id } = useParams();
  const { me } = useAuth();
  const { toast } = useToast();
  const { data, error, loading, reload } = useFetch<any>(`/staff/alerts/${id}`);
  useLive(["alert.updated"], reload);
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<null | "FALSE_POSITIVE" | "CONFIRMED_FRAUD">(null);
  const [notes, setNotes] = useState("");
  const [freeze, setFreeze] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <main className="page"><ErrorBox message={error || "Alert not found"} retry={reload} /></main>;
  const { alert, transaction: t, customer, account, behaviour, timeline, recent_transactions } = data;
  const mine = alert.assigned_to === me?.user?.id;
  const resolved = alert.status === "RESOLVED";

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { const r = await fn(); toast({ tone: "success", title: ok, text: r?.released ? "The held payment was released to the recipient." : undefined }); await reload(); return true; }
    catch (e: any) { toast({ tone: "error", title: "Action failed", text: e.message }); return false; } finally { setBusy(false); }
  };
  const submitDecision = async () => {
    if (!decision) return;
    if (await act(() => api(`/staff/alerts/${alert.id}/decision`, { body: { decision, notes, freeze_account: freeze } }), decision === "CONFIRMED_FRAUD" ? "Marked as confirmed fraud" : "Marked as legitimate")) { setDecision(null); setNotes(""); setFreeze(false); }
  };
  const effect = decision === "FALSE_POSITIVE"
    ? (t.status === "HELD" ? "The held payment will be released to the recipient (if the balance still covers it)." : t.status === "BLOCKED" ? "The customer will be told they can retry the payment." : "The alert is closed as legitimate.")
    : (t.status === "HELD" ? "The held payment will be cancelled — no money moves." : t.status === "COMPLETED" ? "The payment already completed; funds recovery is a manual process. The customer is flagged HIGH risk." : "The block stands and the customer is flagged HIGH risk.");

  return (
    <main className="page">
      <PageHead title={<span className="row wrap">{alert.alert_number}<Badge value={alert.severity} /><Badge value={alert.status} />{alert.resolution && <Badge value={alert.resolution} />}</span>}
        sub={<>Raised {ago(alert.created_at)} · <Link to={base + (base === "/admin" ? "/alerts" : "")}>← Back to queue</Link></>}
        actions={!resolved && <>
          {!mine && <button className="btn" disabled={busy} onClick={() => act(() => api(`/staff/alerts/${alert.id}/claim`, { body: {} }), "Alert claimed")}>{alert.assigned_name ? `Take over from ${alert.assigned_name}` : "Claim alert"}</button>}
          <button className="btn good" disabled={busy} onClick={() => setDecision("FALSE_POSITIVE")}>{t.status === "HELD" ? "Unblock & release" : "Mark legitimate"}</button>
          <button className="btn danger" disabled={busy} onClick={() => setDecision("CONFIRMED_FRAUD")}>{t.status === "HELD" ? "Block as fraud" : "Confirm fraud"}</button></>} />
      {alert.customer_response === "NOT_ME" && <div className="mb"><Notice tone="bad"><strong>The customer says they did NOT make this payment.</strong> {t.status === "CANCELLED" ? "The held payment was auto-cancelled." : ""}</Notice></div>}
      {alert.customer_response === "ME" && <div className="mb"><Notice tone="ok">The customer confirmed this payment was theirs.</Notice></div>}
      {resolved && alert.resolution_notes && <div className="mb"><Notice tone={alert.resolution === "CONFIRMED_FRAUD" ? "bad" : "ok"}><strong>{titleCase(alert.resolution)}.</strong> {alert.resolution_notes}</Notice></div>}

      <div className="grid g-3-2">
        <div className="col gap-lg">
          <Card title="The payment" action={<Badge value={t.status} />}>
            <div className="row between wrap"><div style={{ fontSize: "2rem", fontWeight: 800 }}>{inr(t.amount)}</div><div className="small muted right">{dateTime(t.created_at)}<br />{t.mode} · {titleCase(t.type)}</div></div>
            <dl className="kv mt">
              <dt>From</dt><dd>{t.customer_name} <span className="mono small muted">{t.sender_account}</span></dd>
              <dt>To</dt><dd>{t.recipient_name} <span className="mono small muted">{t.recipient_account || t.merchant_id}</span></dd>
              <dt>Device</dt><dd className="mono">{t.device_id}</dd><dt>Location / IP</dt><dd>{t.location} · {t.ip_address}</dd>
              {t.remarks && <><dt>Remarks</dt><dd>{t.remarks}</dd></>}
            </dl>
          </Card>
          <Card title="Why it was flagged"><RiskExplain t={t} /></Card>
          <Card title="Customer’s recent transactions">
            <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>To</th><th>Amount</th><th>Where</th><th>Status</th><th>Risk</th></tr></thead><tbody>
              {recent_transactions.map((r: any) => <tr key={r.id} style={r.id === t.id ? { background: "var(--warn-bg)" } : undefined}><td className="small nowrap">{ago(r.created_at)}</td><td>{r.recipient_name}</td><td>{inr(r.amount, { decimals: false })}</td><td className="small">{r.location}</td><td><Badge value={r.status} /></td><td><strong>{r.risk_score}</strong></td></tr>)}
            </tbody></table></div>
          </Card>
        </div>
        <div className="col gap-lg">
          {customer && <Card title="Customer">
            <div className="row between"><strong style={{ fontSize: "1.05rem" }}>{customer.name}</strong><Badge value={customer.risk_level} label={`${titleCase(customer.risk_level)} risk`} /></div>
            <dl className="kv mt" style={{ gridTemplateColumns: "110px 1fr" }}>
              <dt>Customer ID</dt><dd className="mono">{customer.customer_number}</dd><dt>Contact</dt><dd>{customer.phone}<br /><span className="small muted">{customer.email}</span></dd><dt>Home city</dt><dd>{customer.city}</dd><dt>Status</dt><dd><Badge value={customer.status} /></dd>
              {account && <><dt>Balance</dt><dd>{inr(account.balance)} <Badge value={account.status} /></dd><dt>Daily limit</dt><dd>{inr(account.daily_limit, { decimals: false })}</dd></>}
            </dl>
            {base === "/admin" && <Link className="btn sm mt" to={`/admin/customers/${customer.id}`}>Open customer file →</Link>}
          </Card>}
          <Card title="Normal behaviour for this customer">
            <dl className="kv" style={{ gridTemplateColumns: "130px 1fr" }}>
              <dt>Payments on record</dt><dd>{behaviour.history_count}</dd><dt>Average payment</dt><dd>{inr(behaviour.average_amount, { decimals: false })}</dd><dt>Largest payment</dt><dd>{inr(behaviour.largest_amount, { decimals: false })}</dd>
              <dt>Known devices</dt><dd>{behaviour.devices}</dd><dt>Known payees</dt><dd>{behaviour.known_recipients}</dd>
              <dt>Known places</dt><dd><div className="pill-list">{behaviour.locations.map((l: string) => <span className="pill" key={l}>{l}</span>)}</div></dd>
            </dl>
            <div className="small muted mt">Usual hours of activity</div><HourHeat hours={behaviour.active_hours.map((h: any) => h.count)} />
          </Card>
          <Card title="Investigation timeline">
            {!timeline.length ? <Empty title="No activity" /> : <div className="timeline">{timeline.map((e: any) => (
              <div className="tl" key={e.id}><span className="dot" /><div><div className="small"><strong>{e.actor_name}</strong> · {titleCase(e.action)} <span className="faint">· {ago(e.created_at)}</span></div><div className="small muted">{e.notes}</div></div></div>))}</div>}
            {!resolved && <div className="col mt"><textarea className="textarea" placeholder="Add an investigation note…" value={note} onChange={e => setNote(e.target.value)} />
              <button className="btn" disabled={busy || note.trim().length < 2} onClick={async () => { if (await act(() => api(`/staff/alerts/${alert.id}/notes`, { body: { notes: note } }), "Note added")) setNote(""); }}>Add note</button></div>}
          </Card>
        </div>
      </div>

      {decision && (
        <Modal title={decision === "CONFIRMED_FRAUD" ? (t.status === "HELD" ? "Block held payment as fraud" : "Confirm fraud") : (t.status === "HELD" ? "Unblock and release held payment" : "Mark as legitimate")} sub={effect} onClose={() => setDecision(null)}
          actions={<><button className="btn" onClick={() => setDecision(null)}>Cancel</button><button className={`btn ${decision === "CONFIRMED_FRAUD" ? "danger" : "good"}`} disabled={busy || notes.trim().length < 5} onClick={submitDecision}>{busy ? <span className="spinner" /> : "Submit decision"}</button></>}>
          <div className="field"><label>Decision notes (required)</label><textarea className="textarea" autoFocus value={notes} onChange={e => setNotes(e.target.value)} placeholder={decision === "CONFIRMED_FRAUD" ? "Evidence, customer contact, next steps…" : "How was this verified?"} /></div>
          {decision === "CONFIRMED_FRAUD" && <label className="check"><input type="checkbox" checked={freeze} onChange={e => setFreeze(e.target.checked)} />Freeze the customer’s account and sign them out</label>}
          <p className="small muted">This decision is recorded as a training label for the ML model.</p>
        </Modal>
      )}
    </main>
  );
}
