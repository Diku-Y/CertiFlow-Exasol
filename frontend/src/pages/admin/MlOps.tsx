import { useEffect, useState } from "react";
import { BarChart, CalibrationChart, HBars } from "../../components/charts";
import { Badge, Card, ErrorBox, Kpi, Loading, Notice, PageHead, Skeleton, useConfirm } from "../../components/ui";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { dateTime, pct, titleCase } from "../../lib/format";
import { useFetch, useInterval } from "../../lib/hooks";

const f3 = (n: any) => (n === null || n === undefined ? "—" : Number(n).toFixed(3));

export default function MlOps() {
  const { toast } = useToast();
  const { data, error, loading, reload } = useFetch<any>("/admin/ml");
  const drift = useFetch<any>("/admin/ml/drift");
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();

  const poll = async () => { try { setStatus(await api("/admin/ml/retrain/status")); } catch { /* ML down */ } };
  useEffect(() => { void poll(); }, []);
  useInterval(() => { if (status?.state === "running") { void poll(); } }, 2000);
  useEffect(() => { if (status?.state === "done") { void reload(); } }, [status?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useInterval(() => { void drift.reload(); }, 30000);

  if (loading && !data) return <Loading />;
  if (error || !data) return <main className="page"><ErrorBox message={error || "No data"} retry={reload} /></main>;
  const m = data.model, live = data.live, fb = data.feedback;
  if (m.error) return <main className="page"><PageHead title="ML operations" /><ErrorBox message={`The ML service is unreachable: ${m.error}`} retry={reload} /></main>;
  const t = m.metrics.test;

  const retrain = async () => {
    if (!(await ask({ title: "Retrain the model?", text: `The new model learns from ${fb.total} analyst-reviewed transactions on top of the base data. It only replaces the current model if it performs at least as well on held-out data.`, confirm: "Start retraining" }))) return;
    setBusy(true);
    try { await api("/admin/ml/retrain", { body: {} }); toast({ tone: "info", title: "Retraining started", text: "This takes a minute or two." }); setStatus({ state: "running" }); }
    catch (e: any) { toast({ tone: "error", title: "Could not start", text: e.message }); } finally { setBusy(false); }
  };
  const rollback = async (v: number) => {
    if (!(await ask({ title: `Activate model v${v}?`, text: "All new payments are scored by this version immediately.", confirm: "Activate", danger: true }))) return;
    try { await api("/admin/ml/rollback", { body: { version: v } }); toast({ tone: "success", title: `Model v${v} is live` }); void reload(); } catch (e: any) { toast({ tone: "error", title: "Rollback failed", text: e.message }); }
  };
  const res = status?.result;

  return (
    <main className="page">
      <PageHead title="ML operations" sub={<>Active model <strong>v{m.version}</strong> · trained {dateTime(m.trained_at)} · decision threshold {(m.threshold * 100).toFixed(0)}%</>}
        actions={<button className="btn primary" disabled={busy || !fb.ready || status?.state === "running"} onClick={retrain}>{status?.state === "running" ? <><span className="spinner" /> Retraining…</> : "Retrain with analyst feedback"}</button>} />
      <div className="mb"><Notice tone={fb.ready ? "info" : "warn"}>Analyst labels available for retraining: <strong>{fb.fraud}</strong> fraud · <strong>{fb.legit}</strong> legitimate{fb.ready ? "." : ` — need at least 20 in total, with 3+ of each. Resolve more alerts in the fraud queue.`}</Notice></div>
      {status?.state === "failed" && <div className="mb"><ErrorBox message={`Retraining failed: ${status.error}`} /></div>}
      {res && (
        <div className="mb"><Notice tone={res.promoted ? "ok" : "warn"}>
          <strong>{res.promoted ? `Model v${res.new_version} is now live.` : `Model v${res.new_version} was trained but NOT promoted.`}</strong> {res.reasons.join(" ")}
          <div className="small muted" style={{ marginTop: 4 }}>Champion PR-AUC {f3(res.champion.synthetic_test?.pr_auc)} → challenger {f3(res.challenger.synthetic_test?.pr_auc)}{res.challenger.feedback_holdout ? ` · on real analyst labels ${f3(res.champion.feedback_holdout?.pr_auc)} → ${f3(res.challenger.feedback_holdout?.pr_auc)}` : ""}</div></Notice></div>)}

      <div className="grid g5">
        <Kpi label="PR-AUC" value={f3(t.pr_auc)} sub="ranking quality on fraud" /><Kpi label="ROC-AUC" value={f3(t.roc_auc)} />
        <Kpi label="Recall" value={pct(t.recall * 100, 1)} sub="fraud caught" /><Kpi label="Precision" value={pct(t.precision * 100, 1)} sub="alerts that are real" /><Kpi label="False-positive rate" value={pct(t.false_positive_rate * 100, 2)} sub={`alert rate ${pct(t.alert_rate * 100, 2)}`} />
      </div>

      <div className="grid g-1-2 mt">
        <Card title="Confusion matrix · hold-out customers">
          <div className="grid g2 center" style={{ gap: 8 }}>
            {[["True negatives", t.confusion_matrix.tn, "var(--ok-bg)"], ["False positives", t.confusion_matrix.fp, "var(--warn-bg)"], ["Missed fraud", t.confusion_matrix.fn, "var(--bad-bg)"], ["Caught fraud", t.confusion_matrix.tp, "var(--ok-bg)"]].map(([l, v, bg]: any) => <div key={l} style={{ background: bg, borderRadius: 12, padding: 14 }}><div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{Number(v).toLocaleString("en-IN")}</div><div className="small muted">{l}</div></div>)}
          </div>
          <div className="small muted mt">{t.rows.toLocaleString("en-IN")} test payments · {t.fraud_rows} fraudulent ({pct(t.fraud_rate * 100, 2)}). Customers in the test set were never seen during training.</div>
        </Card>
        <Card title="How each scenario is handled" action={<span className="small muted">flag rate at the threshold</span>}>
          <div className="table-wrap"><table className="table"><thead><tr><th>Scenario</th><th>Kind</th><th className="right">Rows</th><th>Flagged</th></tr></thead><tbody>
            {Object.entries(t.per_scenario || {}).sort((a: any, b: any) => (a[1].type === b[1].type ? b[1].flagged_rate - a[1].flagged_rate : a[1].type === "fraud" ? -1 : 1)).map(([name, r]: any) => (
              <tr key={name}><td>{titleCase(name)}</td><td><Badge value={r.type === "fraud" ? "FRAUD" : "LEGIT"} label={r.type} /></td><td className="right">{r.rows.toLocaleString("en-IN")}</td>
                <td style={{ width: "38%" }}><div className="row"><div className="bar-track grow"><div className="bar-fill" style={{ width: `${Math.max(1, r.flagged_rate * 100)}%`, background: r.type === "fraud" ? "var(--ok)" : "var(--warn)" }} /></div><span className="small" style={{ width: 48, textAlign: "right" }}>{pct(r.flagged_rate * 100, 0)}</span></div></td></tr>))}
          </tbody></table></div>
          <p className="tiny muted mt">Fraud rows should be flagged often; legitimate “hard” rows (travel, new device, festival bursts) should be flagged rarely.</p>
        </Card>
      </div>

      <div className="grid g2 mt">
        <Card title="What drives the model"><HBars items={m.feature_importance.slice(0, 12).map((f: any) => ({ label: titleCase(f.feature), value: f.importance, right: f.importance.toFixed(4) }))} /></Card>
        <Card title="Calibration"><div className="row top wrap"><CalibrationChart points={t.calibration || []} /><p className="small muted grow" style={{ minWidth: 200 }}>A well-calibrated model’s curve hugs the dashed diagonal: when it says 80% fraud probability, about 80% of those payments really are fraud. Calibrated probabilities make the 0–100 risk score and thresholds meaningful. Brier score <strong>{f3(t.brier)}</strong>.</p></div></Card>
      </div>

      <div className="grid g2 mt">
        <Card title="Live serving" action={<button className="btn sm ghost" onClick={reload}>Refresh</button>}>
          {!live || !live.samples ? <p className="muted small">No payments scored yet since the service started.</p> : <>
            <div className="grid g3"><div><div className="small muted">Latency p50</div><strong>{live.latency_ms.p50} ms</strong></div><div><div className="small muted">Latency p95</div><strong>{live.latency_ms.p95} ms</strong></div><div><div className="small muted">Flag rate</div><strong>{pct(live.flag_rate * 100, 1)}</strong></div></div>
            <div className="mt"><BarChart height={150} data={live.score_histogram} xLabel={(d: any) => d.range.split("-")[0]} series={[{ key: "count", label: "Payments by risk score (live)", color: "#6366f1" }]} format={(n: number) => String(Math.round(n))} /></div></>}
        </Card>
        <Card title="Data drift" action={drift.data?.ready ? <Badge value={drift.data.overall} /> : undefined}>
          {!drift.data ? <Skeleton h={160} /> : !drift.data.ready ? <p className="muted small">{drift.data.message}</p> : <>
            <p className="small muted mb">Population Stability Index of live inputs vs. training data (&lt;0.1 stable, 0.1–0.25 moderate, &gt;0.25 significant). {drift.data.samples} live samples.</p>
            {drift.data.features.slice(0, 6).map((f: any) => <div className="row between small" key={f.feature} style={{ padding: "4px 0" }}><span>{f.label}</span><span className="row"><span className="mono">{f.psi.toFixed(3)}</span><Badge value={f.status} /></span></div>)}</>}
        </Card>
      </div>

      <Card title="Model versions" className="mt">
        <div className="table-wrap"><table className="table"><thead><tr><th>Version</th><th>Trained</th><th>PR-AUC</th><th>Recall</th><th>Precision</th><th>Analyst labels used</th><th /></tr></thead><tbody>
          {[...m.versions].reverse().map((v: any) => <tr key={v.version}><td><strong>v{v.version}</strong> {v.active && <Badge value="ACTIVE" label="Live" />}</td><td className="small">{dateTime(v.trained_at)}</td><td>{f3(v.pr_auc)}</td><td>{pct(v.recall * 100, 1)}</td><td>{pct(v.precision * 100, 1)}</td><td>{v.feedback_rows}</td>
            <td className="right">{!v.active && <button className="btn sm" onClick={() => rollback(v.version)}>Activate</button>}</td></tr>)}
        </tbody></table></div>
        <p className="tiny muted mt">{m.training_info.algorithm} · {m.training_info.synthetic_customers?.toLocaleString("en-IN")} simulated customers · {m.training_info.synthetic_rows?.toLocaleString("en-IN")} base rows · feedback weight ×{m.training_info.feedback_weight}</p>
      </Card>
      {dialog}
    </main>
  );
}
