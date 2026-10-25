import { useState } from "react";
import { StaffTxnDrawer } from "../../components/staff";
import { Badge, Card, Empty, ErrorBox, Field, PageHead, Pager, Skeleton } from "../../components/ui";
import { qs } from "../../lib/api";
import { dateTime, inr, titleCase } from "../../lib/format";
import { useDebounced, useFetch } from "../../lib/hooks";

export default function TxnExplorer() {
  const [f, setF] = useState({ q: "", status: "ALL", decision: "ALL", risk_level: "ALL", type: "ALL", review: "", min_risk: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const q = useDebounced(f.q);
  const { data, loading, error, reload } = useFetch<any>(`/staff/transactions${qs({ ...f, q, page, limit: 20 })}`);
  const set = (k: string, v: string) => { setF(s => ({ ...s, [k]: v })); setPage(1); };
  const sel = (k: string, label: string, opts: string[]) => <Field label={label}><select className="select" value={(f as any)[k]} onChange={e => set(k, e.target.value)}><option value="ALL">All</option>{opts.map(o => <option key={o} value={o}>{titleCase(o)}</option>)}</select></Field>;
  return (
    <main className="page">
      <PageHead title="Transactions" sub="Every payment with its risk assessment." />
      <Card>
        <div className="filters">
          <Field label="Search"><input className="input" placeholder="Customer, payee, reference" value={f.q} onChange={e => set("q", e.target.value)} /></Field>
          {sel("status", "Status", ["COMPLETED", "HELD", "BLOCKED", "FAILED", "CANCELLED"])}
          {sel("decision", "Engine decision", ["ALLOW", "ALLOW_NOTIFY", "HOLD", "BLOCK"])}
          {sel("risk_level", "Risk level", ["LOW", "MEDIUM", "HIGH", "CRITICAL"])}
          {sel("type", "Type", ["BANK_TRANSFER", "MERCHANT_PAYMENT", "DEPOSIT"])}
          <Field label="Analyst label"><select className="select" value={f.review} onChange={e => set("review", e.target.value)}><option value="">Any</option><option value="FRAUD">Fraud</option><option value="LEGIT">Legitimate</option></select></Field>
          <Field label="Min risk score"><input className="input" style={{ width: 90 }} inputMode="numeric" value={f.min_risk} onChange={e => set("min_risk", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="From"><input className="input" type="date" value={f.from} onChange={e => set("from", e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={f.to} onChange={e => set("to", e.target.value)} /></Field>
        </div>
        {error ? <ErrorBox message={error} retry={reload} /> : loading && !data ? <Skeleton h={340} /> : !data?.items.length ? <Empty icon="list" title="No transactions match" /> : (
          <><div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Customer</th><th>To</th><th>Amount</th><th>Where</th><th>Status</th><th>Decision</th><th>Risk</th></tr></thead><tbody>
            {data.items.map((t: any) => <tr key={t.id} className="click" onClick={() => setOpen(t.id)}>
              <td className="small nowrap">{dateTime(t.created_at)}</td><td>{t.customer_name}</td><td>{t.recipient_name || "—"}<div className="tiny muted">{titleCase(t.type)}</div></td>
              <td><strong>{inr(t.amount)}</strong></td><td className="small">{t.location}</td><td><Badge value={t.status} /></td>
              <td><Badge value={t.decision} />{t.review_decision && <div style={{ marginTop: 3 }}><Badge value={t.review_decision} /></div>}</td>
              <td><strong>{t.risk_score}</strong><div className="tiny muted">ML {t.ml_score ?? "–"}</div></td></tr>)}
          </tbody></table></div><Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} label="transactions" /></>
        )}
      </Card>
      {open !== null && <StaffTxnDrawer id={open} onClose={() => setOpen(null)} />}
    </main>
  );
}
