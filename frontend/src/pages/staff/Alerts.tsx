import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Card, Empty, ErrorBox, Field, Kpi, Modal, PageHead, Pager, Skeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api, qs } from "../../lib/api";
import { ago, inr } from "../../lib/format";
import { useDebounced, useFetch } from "../../lib/hooks";
import { useLive } from "../../lib/live";

type HeldDecision = "FALSE_POSITIVE" | "CONFIRMED_FRAUD";

export default function Alerts({ base }: { base: string }) {
  const { me } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState({ status: "OPEN", severity: "ALL", q: "", assigned: "" });
  const [page, setPage] = useState(1);
  const [heldDecision, setHeldDecision] = useState<{ alert: any; decision: HeldDecision } | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [freezeAccount, setFreezeAccount] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const q = useDebounced(f.q);
  const stats = useFetch<any>("/staff/alerts/stats");
  const list = useFetch<any>(`/staff/alerts${qs({ ...f, q, page, limit: 15 })}`);
  // Keep held payments in their own actionable queue, separate from the general alert list.
  const heldList = useFetch<any>("/staff/alerts?status=OPEN&limit=100");
  const reloadAll = () => { void list.reload(); void stats.reload(); void heldList.reload(); };
  useLive(["alert.created", "alert.updated"], reloadAll);
  const set = (k: string, v: string) => { setF(s => ({ ...s, [k]: v })); setPage(1); };
  const s = stats.data;
  const heldAlerts = (heldList.data?.items ?? []).filter((a: any) => a.transaction?.status === "HELD");

  const submitHeldDecision = async () => {
    if (!heldDecision || decisionNotes.trim().length < 5) return;
    setDecisionBusy(true);
    try {
      const result = await api(`/staff/alerts/${heldDecision.alert.id}/decision`, {
        body: {
          decision: heldDecision.decision,
          notes: decisionNotes.trim(),
          freeze_account: freezeAccount
        }
      });
      if (heldDecision.decision === "FALSE_POSITIVE") {
        if (result?.released) {
          toast({ tone: "success", title: "Payment unblocked and released", text: "The held payment was processed." });
        } else if (result?.release_failed) {
          toast({ tone: "error", title: "Payment could not be released", text: result.release_failed });
        } else {
          toast({ tone: "success", title: "Payment cleared", text: "The alert was resolved as legitimate." });
        }
      } else {
        toast({ tone: "success", title: "Payment blocked as fraud", text: "The held payment was cancelled; no money was transferred." });
      }
      setHeldDecision(null);
      setDecisionNotes("");
      setFreezeAccount(false);
      reloadAll();
    } catch (e: any) {
      toast({ tone: "error", title: "Could not update payment", text: e.message });
    } finally {
      setDecisionBusy(false);
    }
  };

  return (
    <main className="page">
      <PageHead title="Fraud alert queue" sub="Review held payments first, then investigate the remaining alerts." />
      <div className="grid g4 mb">
        <Kpi icon="alert" label="Needs attention" value={s ? s.new + s.in_review : "…"} sub={s ? `${s.new} new · ${s.in_review} in review` : undefined} tone={s && s.new > 0 ? "warnc" : undefined} />
        <Kpi icon="shield" label="Critical / High open" value={s ? s.open_by_severity.CRITICAL + s.open_by_severity.HIGH : "…"} tone={s && s.open_by_severity.CRITICAL > 0 ? "neg" : undefined} />
        <Kpi icon="check" label="Resolved" value={s ? s.resolved : "…"} sub={s ? `${s.confirmed_fraud} fraud · ${s.false_positives} false positive` : undefined} />
        <Kpi icon="trend" label="Avg time to resolve" value={s?.avg_resolution_minutes != null ? `${s.avg_resolution_minutes} min` : "—"} />
      </div>

      <Card title={`Held payments awaiting a decision${heldAlerts.length ? ` (${heldAlerts.length})` : ""}`}>
        <p className="small muted mb">These payments are paused. Mark each one legitimate to unblock and release it, or confirm fraud to cancel it.</p>
        {heldList.error ? <ErrorBox message={heldList.error} retry={heldList.reload} /> : heldList.loading && !heldList.data ? <Skeleton h={180} /> : !heldAlerts.length ? (
          <Empty icon="shield" title="No held payments awaiting review" text="New held payments will appear here automatically." />
        ) : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Customer</th><th>Payment</th><th>Risk</th><th>Severity</th><th>Raised</th><th>Actions</th></tr></thead><tbody>
            {heldAlerts.map((a: any) => (
              <tr key={a.id}>
                <td><strong>{a.customer_name}</strong><div className="tiny muted">{a.alert_number}</div></td>
                <td><strong>{inr(a.transaction.amount)}</strong><div className="tiny muted">→ {a.transaction.recipient_name} · {a.transaction.location}</div></td>
                <td><strong>{a.risk_score}</strong><div className="tiny muted">rules {a.rule_score} · ML {a.ml_score ?? "–"}</div></td>
                <td><Badge value={a.severity} /></td>
                <td className="small nowrap">{ago(a.created_at)}</td>
                <td><div className="row wrap" style={{ gap: 6 }}>
                  <button className="btn good sm" disabled={decisionBusy} onClick={() => { setDecisionNotes(""); setFreezeAccount(false); setHeldDecision({ alert: a, decision: "FALSE_POSITIVE" }); }}>Unblock & release</button>
                  <button className="btn danger sm" disabled={decisionBusy} onClick={() => { setDecisionNotes(""); setFreezeAccount(false); setHeldDecision({ alert: a, decision: "CONFIRMED_FRAUD" }); }}>Block as fraud</button>
                  <button className="btn sm" onClick={() => navigate(`${base}/alerts/${a.id}`)}>Details</button>
                </div></td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>

      <div style={{ height: 18 }} />
      <Card>
        <div className="filters">
          <Field label="Status"><select className="select" value={f.status} onChange={e => set("status", e.target.value)}><option value="OPEN">Open</option><option value="NEW">New</option><option value="IN_REVIEW">In review</option><option value="RESOLVED">Resolved</option><option value="ALL">All</option></select></Field>
          <Field label="Severity"><select className="select" value={f.severity} onChange={e => set("severity", e.target.value)}><option value="ALL">All</option>{["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(x => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Search"><input className="input" placeholder="Alert # or customer" value={f.q} onChange={e => set("q", e.target.value)} /></Field>
          <label className="check" style={{ paddingBottom: 10 }}><input type="checkbox" checked={f.assigned === "me"} onChange={e => set("assigned", e.target.checked ? "me" : "")} />Assigned to me</label>
        </div>
        {list.error ? <ErrorBox message={list.error} retry={list.reload} /> : list.loading && !list.data ? <Skeleton h={320} /> : !list.data?.items.length ? <Empty icon="shield" title="No alerts here" text="Nothing matches these filters — good news if the queue is empty." /> : (
          <>
            <div className="table-wrap"><table className="table"><thead><tr><th>Alert</th><th>Customer</th><th>Payment</th><th>Score</th><th>Severity</th><th>Status</th><th>Assigned</th><th>Raised</th></tr></thead><tbody>
              {list.data.items.map((a: any) => (
                <tr key={a.id} className="click" onClick={() => navigate(`${base}/alerts/${a.id}`)}>
                  <td className="mono small">{a.alert_number}</td><td><strong>{a.customer_name}</strong></td>
                  <td>{a.transaction ? <>{inr(a.transaction.amount)}<div className="tiny muted">→ {a.transaction.recipient_name} · {a.transaction.location}</div></> : "—"}</td>
                  <td><strong>{a.risk_score}</strong><div className="tiny muted">rules {a.rule_score} · ML {a.ml_score ?? "–"}</div></td>
                  <td><Badge value={a.severity} /></td>
                  <td><Badge value={a.status} />{a.customer_response === "NOT_ME" && <div className="tiny neg">customer: not me</div>}</td>
                  <td className="small">{a.assigned_to === me?.user?.id ? <strong>You</strong> : a.assigned_name || <span className="faint">—</span>}</td>
                  <td className="small nowrap">{ago(a.created_at)}</td>
                </tr>))}
            </tbody></table></div>
            <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} label="alerts" />
          </>
        )}
      </Card>

      {heldDecision && (
        <Modal
          title={heldDecision.decision === "CONFIRMED_FRAUD" ? "Block held payment as fraud?" : "Unblock and release held payment?"}
          sub={heldDecision.decision === "CONFIRMED_FRAUD"
            ? `This will cancel the ${inr(heldDecision.alert.transaction.amount)} payment to ${heldDecision.alert.transaction.recipient_name}. No money will be transferred.`
            : `This will mark the ${inr(heldDecision.alert.transaction.amount)} payment to ${heldDecision.alert.transaction.recipient_name} as legitimate and attempt to release it.`}
          onClose={() => { if (!decisionBusy) setHeldDecision(null); }}
          actions={<><button className="btn" disabled={decisionBusy} onClick={() => setHeldDecision(null)}>Cancel</button><button className={`btn ${heldDecision.decision === "CONFIRMED_FRAUD" ? "danger" : "good"}`} disabled={decisionBusy || decisionNotes.trim().length < 5} onClick={submitHeldDecision}>{decisionBusy ? <span className="spinner" /> : heldDecision.decision === "CONFIRMED_FRAUD" ? "Confirm block" : "Confirm release"}</button></>}
        >
          <div className="field"><label>Decision notes (required)</label><textarea className="textarea" autoFocus value={decisionNotes} onChange={e => setDecisionNotes(e.target.value)} placeholder={heldDecision.decision === "CONFIRMED_FRAUD" ? "Evidence or reason for blocking this payment…" : "How was this payment verified as legitimate?"} /></div>
          {heldDecision.decision === "CONFIRMED_FRAUD" && <label className="check"><input type="checkbox" checked={freezeAccount} onChange={e => setFreezeAccount(e.target.checked)} />Also block the customer’s account and sign them out</label>}
          <p className="small muted">Your decision and notes will be saved in the investigation timeline.</p>
        </Modal>
      )}
    </main>
  );
}
