import { useEffect, useState } from "react";
import { Badge, Drawer, ErrorBox, Loading } from "./ui";
import { ScoreRing } from "./charts";
import { api } from "../lib/api";
import { dateTime, inr, titleCase } from "../lib/format";

/** Explains a risk decision: score breakdown, rules that fired, model drivers. */
export function RiskExplain({ t }: { t: any }) {
  const reasons = t.reasons || [], drivers = t.drivers || [];
  return (
    <div className="col">
      <div className="row" style={{ gap: 20, alignItems: "center" }}>
        <ScoreRing score={t.risk_score ?? 0} size={104} label={t.risk_level?.toLowerCase()} />
        <div className="col gap-sm small">
          <div>Decision <Badge value={t.decision} /></div>
          <div className="muted">Rules <strong>{t.rule_score}</strong> · ML <strong>{t.ml_score ?? "n/a"}</strong></div>
          {t.ml_probability !== null && t.ml_probability !== undefined && <div className="muted">Fraud probability <strong>{(t.ml_probability * 100).toFixed(1)}%</strong> · anomaly percentile <strong>{t.ml_anomaly}</strong></div>}
          <div className="faint">{t.ml_available ? `Model v${t.ml_model_version}` : "ML unavailable — rules only"}</div>
        </div>
      </div>
      <div>
        <div className="small muted" style={{ marginBottom: 4 }}>Business rules that fired</div>
        {reasons.length ? reasons.map((r: any) => <div key={r.code} className="driver"><div className="row between"><strong>{r.title}</strong><span className="badge warn plain">+{r.points}</span></div><div className="small muted">{r.detail}</div></div>) : <div className="small faint">No rules fired.</div>}
      </div>
      <div>
        <div className="small muted" style={{ marginBottom: 4 }}>What the ML model noticed <span className="faint">(share of the risk signal)</span></div>
        {drivers.length ? drivers.map((d: any) => (
          <div key={d.feature} className="driver"><div className="row between small"><span>{d.detail}</span><strong>{d.impact}%</strong></div><div className="bar-track" style={{ marginTop: 5 }}><div className="bar-fill" style={{ width: `${d.impact}%`, background: "var(--bad)" }} /></div></div>
        )) : <div className="small faint">The model found nothing unusual{t.ml_available ? "" : " (model unavailable)"}.</div>}
      </div>
    </div>
  );
}

export function StaffTxnDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const [t, setT] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api(`/staff/transactions/${id}`).then(setT).catch(e => setErr(e.message)); }, [id]);
  return (
    <Drawer title="Transaction" onClose={onClose} wide>
      {err ? <ErrorBox message={err} /> : !t ? <Loading /> : (
        <>
          <div className="row between wrap"><div><div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{inr(t.amount)}</div><div className="muted">{t.customer_name} → {t.recipient_name || "—"}</div></div><div className="row"><Badge value={t.status} />{t.review_decision && <Badge value={t.review_decision} />}</div></div>
          <dl className="kv">
            <dt>Reference</dt><dd className="mono">{t.reference}</dd><dt>Time</dt><dd>{dateTime(t.created_at)}</dd>
            <dt>Type / mode</dt><dd>{titleCase(t.type)} · {t.mode}</dd><dt>Category</dt><dd>{t.category}</dd>
            <dt>From account</dt><dd className="mono">{t.sender_account || "—"}</dd><dt>To account</dt><dd className="mono">{t.recipient_account || t.merchant_id || "—"}</dd>
            <dt>Device</dt><dd className="mono">{t.device_id}</dd><dt>Location / IP</dt><dd>{t.location} · {t.ip_address}</dd>
            {t.customer_response && <><dt>Customer said</dt><dd>{t.customer_response === "ME" ? "It was me" : "It was NOT me"}</dd></>}
            {t.failure_reason && <><dt>Note</dt><dd>{t.failure_reason}</dd></>}
          </dl>
          <RiskExplain t={t} />
        </>
      )}
    </Drawer>
  );
}
