import { Link, useNavigate } from "react-router-dom";
import { BarChart, Donut, HBars } from "../../components/charts";
import { Badge, Card, ErrorBox, Kpi, PageHead, Skeleton } from "../../components/ui";
import { ago, inr, num, pct, shortDate } from "../../lib/format";
import { useFetch, useInterval } from "../../lib/hooks";
import { useLive } from "../../lib/live";

const RISK_COLORS: Record<string, string> = { LOW: "#22c55e", MEDIUM: "#eab308", HIGH: "#f97316", CRITICAL: "#ef4444" };
const DEC_COLORS: Record<string, string> = { ALLOW: "#22c55e", ALLOW_NOTIFY: "#eab308", HOLD: "#f97316", BLOCK: "#ef4444" };
const DEC_LABEL: Record<string, string> = { ALLOW: "Allowed", ALLOW_NOTIFY: "Allowed + notified", HOLD: "Held for review", BLOCK: "Blocked" };

export default function Overview() {
  const navigate = useNavigate();
  const { data: d, error, reload } = useFetch<any>("/admin/overview");
  useLive(["alert.created", "alert.updated", "balance"], reload);
  useInterval(() => void reload(), 30000);
  return (
    <main className="page">
      <PageHead title="Bank overview" sub="Operations and fraud protection at a glance." />
      {error && <ErrorBox message={error} retry={reload} />}
      <div className="grid g4">
        <Kpi icon="users" label="Customers" value={d ? num(d.customers.active) : "…"} sub={d ? `${d.customers.pending} awaiting approval · ${d.customers.suspended} suspended` : undefined} />
        <Kpi icon="card" label="Deposits held" value={d ? inr(d.total_deposits, { compact: true }) : "…"} sub={d ? `${d.accounts} accounts` : undefined} />
        <Kpi icon="send" label="Payments today" value={d ? num(d.today.completed) : "…"} sub={d ? `${inr(d.today.volume, { compact: true })} moved` : undefined} />
        <Kpi icon="alert" label="Open fraud alerts" value={d ? d.open_alerts : "…"} tone={d && d.open_alerts > 0 ? "warnc" : undefined} sub={d ? `${d.today.held} held · ${d.today.blocked} blocked today` : undefined} />
      </div>
      <div className="grid g4 mt">
        <Kpi icon="shield" label="Money protected (30d)" value={d ? inr(d.protected_amount, { compact: true }) : "…"} tone="pos" sub={d ? `${d.protected_count} payments stopped` : undefined} />
        <Kpi icon="check" label="Confirmed fraud" value={d ? d.confirmed_fraud : "…"} />
        <Kpi icon="info" label="False-positive rate" value={d ? pct(d.false_positive_rate, 0) : "…"} sub="of analyst-reviewed alerts" />
        <Kpi icon="user" label="Active staff" value={d ? d.staff_active : "…"} />
      </div>
      <div className="grid g-3-2 mt">
        <Card title="Completed payments · last 14 days">{!d ? <Skeleton h={230} /> : <BarChart data={d.series} xLabel={(x: any) => shortDate(x.date)} series={[{ key: "completed", label: "Completed", color: "#3b82f6" }, { key: "held", label: "Held", color: "#f97316" }, { key: "blocked", label: "Blocked", color: "#ef4444" }]} format={(n: number) => String(Math.round(n))} stacked />}</Card>
        <Card title="Risk distribution · 30 days">{!d ? <Skeleton h={230} /> : (
          <div className="donut-wrap"><Donut slices={d.risk_distribution.map((r: any) => ({ label: r.level, value: r.count, color: RISK_COLORS[r.level] }))} center={num(d.risk_distribution.reduce((s: number, r: any) => s + r.count, 0))} sub="payments" />
            <div className="cat-list">{d.risk_distribution.map((r: any) => <div className="cat-item" key={r.level}><span className="sw" style={{ background: RISK_COLORS[r.level] }} /><span className="grow">{r.level[0] + r.level.slice(1).toLowerCase()}</span><strong>{num(r.count)}</strong></div>)}</div></div>)}</Card>
      </div>
      <div className="grid g3 mt">
        <Card title="Engine decisions · 30 days">{!d ? <Skeleton h={160} /> : <HBars items={d.decisions.map((x: any) => ({ label: DEC_LABEL[x.decision], value: x.count, color: DEC_COLORS[x.decision], right: num(x.count) }))} />}</Card>
        <Card title="Customers with most alerts">{!d ? <Skeleton h={160} /> : d.top_risky_customers.length === 0 ? <p className="muted small">No alerts in the last 30 days.</p> : d.top_risky_customers.map((c: any) => (
          <div className="row between" key={c.customer_id} style={{ padding: "7px 0", borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => navigate(`/admin/customers/${c.customer_id}`)}><strong>{c.name}</strong><span className="small muted">{c.alerts} alert(s) · peak {c.max_score}</span></div>))}</Card>
        <Card title="Latest alerts" action={<Link to="/admin/alerts" className="small">All →</Link>}>{!d ? <Skeleton h={160} /> : d.recent_alerts.length === 0 ? <p className="muted small">None yet.</p> : d.recent_alerts.map((a: any) => (
          <div className="row between" key={a.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => navigate(`/admin/alerts/${a.id}`)}><span><strong>{a.customer_name}</strong><div className="tiny muted">{ago(a.created_at)} · score {a.risk_score}</div></span><span className="row"><Badge value={a.severity} /><Badge value={a.status} /></span></div>))}</Card>
      </div>
    </main>
  );
}
