import { useEffect, useState } from "react";
import { Badge, Card, ErrorBox, Field, Loading, Notice, PageHead, Switch, useConfirm } from "../../components/ui";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { useFetch } from "../../lib/hooks";

const HELP: Record<string, string> = {
  LARGE_AMOUNT: "Payment amount in ₹ at or above this value", RAPID_TRANSACTIONS: "Attempts within 2 minutes (including this one)",
  NEW_DEVICE: "Fires on an unrecognised device once the account has 3+ payments", UNUSUAL_LOCATION: "Fires on an unfamiliar location once the account has 3+ payments",
  ABNORMAL_SPENDING: "Multiple of the customer's average payment", FAILED_THEN_SUCCESS: "Failed attempts (wrong PIN, no funds) in the last 10 minutes",
  NEW_RECIPIENT_LARGE: "First transfer to a new person with amount in ₹ at or above this", BALANCE_DRAIN: "Share of available balance, 0 to 1 (e.g. 0.8 = 80%)",
  MULE_FAN_IN: "Distinct other senders paying the same recipient in 24 hours", UNUSUAL_HOUR: "Customer has never transacted at this night-time hour"
};
const NO_THRESHOLD = ["NEW_DEVICE", "UNUSUAL_LOCATION", "UNUSUAL_HOUR"];

function RuleRow({ rule, onSaved }: { rule: any; onSaved: () => void }) {
  const { toast } = useToast();
  const [r, setR] = useState(rule);
  const [busy, setBusy] = useState(false);
  useEffect(() => setR(rule), [rule]);
  const dirty = JSON.stringify(r) !== JSON.stringify(rule);
  const save = async () => {
    setBusy(true);
    try { await api(`/admin/rules/${r.code}`, { method: "PUT", body: { threshold: Number(r.threshold), risk_points: Number(r.risk_points), enabled: r.enabled, notify_customer: r.notify_customer, notify_analyst: r.notify_analyst } }); toast({ tone: "success", title: `${r.title} saved`, text: "Takes effect on the next payment." }); onSaved(); }
    catch (e: any) { toast({ tone: "error", title: "Could not save rule", text: e.message }); } finally { setBusy(false); }
  };
  return (
    <tr>
      <td style={{ minWidth: 220 }}><strong>{r.title}</strong><div className="tiny muted">{HELP[r.code]}</div></td>
      <td><input className="input" style={{ width: 100 }} inputMode="decimal" disabled={NO_THRESHOLD.includes(r.code)} value={NO_THRESHOLD.includes(r.code) ? "—" : r.threshold} onChange={e => setR({ ...r, threshold: e.target.value })} aria-label={`${r.title} threshold`} /></td>
      <td><input className="input" style={{ width: 80 }} inputMode="numeric" value={r.risk_points} onChange={e => setR({ ...r, risk_points: e.target.value })} aria-label={`${r.title} risk points`} /></td>
      <td><Switch checked={r.notify_customer} onChange={v => setR({ ...r, notify_customer: v })} /></td>
      <td><Switch checked={r.notify_analyst} onChange={v => setR({ ...r, notify_analyst: v })} /></td>
      <td><Switch checked={r.enabled} onChange={v => setR({ ...r, enabled: v })} /></td>
      <td className="right"><button className="btn sm primary" disabled={!dirty || busy} onClick={save}>{busy ? <span className="spinner" /> : "Save"}</button></td>
    </tr>
  );
}

export default function Policy() {
  const { toast } = useToast();
  const rules = useFetch<any[]>("/admin/rules");
  const settings = useFetch<any>("/admin/settings");
  const [s, setS] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
  useEffect(() => { if (settings.data) setS(JSON.parse(JSON.stringify(settings.data))); }, [settings.data]);

  const save = async (patch: any, ok: string) => {
    setBusy(true);
    try { await api("/admin/settings", { method: "PUT", body: patch }); toast({ tone: "success", title: ok }); await settings.reload(); }
    catch (e: any) { toast({ tone: "error", title: "Could not save", text: e.message }); } finally { setBusy(false); }
  };
  if (rules.loading || settings.loading || !s) return <Loading />;
  if (rules.error || settings.error) return <main className="page"><ErrorBox message={rules.error || settings.error || ""} /></main>;
  const t = s.risk_thresholds;
  const dirty = JSON.stringify(s) !== JSON.stringify(settings.data);

  return (
    <main className="page">
      <PageHead title="Rules & settings" sub="Tune how aggressively CertiFlow Guard intervenes. Changes apply to the next payment." />
      {!s.transfers_enabled && <div className="mb"><Notice tone="bad"><strong>Payments are switched off.</strong> Customers cannot send money until you re-enable them.</Notice></div>}
      <div className="grid g2">
        <Card title="Operations">
          <div className="col gap-lg">
            <div className="row between"><div><strong>Payments enabled</strong><div className="small muted">Emergency kill switch for all transfers and merchant payments.</div></div>
              <Switch checked={s.transfers_enabled} disabled={busy} onChange={async v => { if (!v && !(await ask({ title: "Stop all payments?", text: "Every customer payment will be rejected until you switch this back on.", confirm: "Stop payments", danger: true }))) return; void save({ transfers_enabled: v }, v ? "Payments enabled" : "Payments stopped"); }} /></div>
            <div className="row between"><div><strong>Use ML model in decisions</strong><div className="small muted">When off, only the business rules below decide.</div></div>
              <Switch checked={s.ml_enabled} disabled={busy} onChange={v => save({ ml_enabled: v }, v ? "ML scoring enabled" : "ML scoring disabled")} /></div>
          </div>
        </Card>
        <Card title="Default daily limits" action={<Badge value="INFO" label="applies to new accounts" tone="info" />}>
          <div className="grid g2">{(["SAVINGS", "CURRENT"] as const).map(k => <Field key={k} label={`${k[0] + k.slice(1).toLowerCase()} account (₹)`}><input className="input" inputMode="numeric" value={s.default_daily_limit[k]} onChange={e => setS({ ...s, default_daily_limit: { ...s.default_daily_limit, [k]: Number(e.target.value.replace(/\D/g, "")) } })} /></Field>)}</div>
        </Card>
      </div>
      <Card title="Risk bands" className="mt" action={<button className="btn primary sm" disabled={!dirty || busy} onClick={() => save({ risk_thresholds: t, default_daily_limit: s.default_daily_limit }, "Settings saved")}>Save settings</button>}>
        <p className="muted small mb">The final risk score (0–100) combines the rules and the ML model. The bands decide what happens to the payment.</p>
        <div style={{ display: "flex", height: 34, borderRadius: 10, overflow: "hidden", fontSize: ".75rem", fontWeight: 650, color: "#fff" }}>
          <div style={{ flex: t.medium, background: "#22c55e", display: "grid", placeItems: "center" }}>Allow</div><div style={{ flex: Math.max(1, t.hold - t.medium), background: "#eab308", display: "grid", placeItems: "center" }}>Allow + notify</div>
          <div style={{ flex: Math.max(1, t.block - t.hold), background: "#f97316", display: "grid", placeItems: "center" }}>Hold</div><div style={{ flex: Math.max(1, 100 - t.block), background: "#ef4444", display: "grid", placeItems: "center" }}>Block</div></div>
        <div className="grid g3 mt">
          {(["medium", "hold", "block"] as const).map(k => <Field key={k} label={k === "medium" ? "Notify customer from" : k === "hold" ? "Hold for review from" : "Block from"}><input className="input" inputMode="numeric" value={t[k]} onChange={e => setS({ ...s, risk_thresholds: { ...t, [k]: Number(e.target.value.replace(/\D/g, "")) } })} /></Field>)}
        </div>
      </Card>
      <Card title="Fraud rules" className="mt">
        <p className="muted small mb">Each rule adds risk points when it fires (capped at 100 in total). “Notify analyst” opens an alert when the final score is at least the notify band.</p>
        <div className="table-wrap"><table className="table"><thead><tr><th>Rule</th><th>Threshold</th><th>Points</th><th>Tell customer</th><th>Flag analyst</th><th>Enabled</th><th /></tr></thead><tbody>
          {rules.data?.map(r => <RuleRow key={r.code} rule={r} onSaved={rules.reload} />)}
        </tbody></table></div>
      </Card>
      {dialog}
    </main>
  );
}
