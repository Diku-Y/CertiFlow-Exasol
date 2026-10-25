import { Badge, Card, ErrorBox, Kpi, Loading, PageHead } from "../../components/ui";
import { HBars } from "../../components/charts";
import { num, pct } from "../../lib/format";
import { useFetch, useInterval } from "../../lib/hooks";

const dur = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);

const USES = [
  ["cf:sess:*", "Sessions", "Server-side login sessions: instant logout, sign-out-everywhere, admin force-logout. Falls back to MongoDB token_version if Redis is down."],
  ["cf:profile:{customer}", "Behaviour profile", "Per-customer learned habits (amount stats, hours, devices, places, payees). Feeds 28 ML features; rebuilt from MongoDB if missing."],
  ["cf:att:{customer}", "Attempt window", "7-day sorted set of every attempt (completed / held / blocked / failed) for velocity and failed-attempt features."],
  ["cf:fanin:{recipient}", "Mule detection", "Distinct senders paying the same account in 24 h — a classic money-mule signal."],
  ["cf:rl:*", "Rate limits", "Atomic fixed-window counters for sign-in, payments, look-ups and the API. In-process fallback if Redis is down."],
  ["cf:lock:*", "Distributed locks", "One payment at a time per account (prevents double-spend races) and one analyst per alert."],
  ["cf:cache:* + epochs", "Caches", "Dashboard analytics, admin overview, rules and settings. Epoch counters invalidate instantly on every transaction."],
  ["cf:events (pub/sub)", "Live events", "Fan-out of new alerts, balances and notifications to every API instance’s open browser streams."]
];

function Status({ up }: { up: boolean }) { return <Badge value={up ? "ok" : "down"} label={up ? "Operational" : "Down"} tone={up ? "ok" : "bad"} />; }

export default function SystemHealth() {
  const { data: d, error, loading, reload } = useFetch<any>("/admin/system");
  useInterval(() => void reload(), 10000);
  if (loading && !d) return <Loading />;
  if (error || !d) return <main className="page"><ErrorBox message={error || "No data"} retry={reload} /></main>;
  const { mongo, redis, ml, metrics: m, app } = d;
  const hits = m.cache_hit, miss = m.cache_miss;
  const decisions = [["Allowed", m.decision_allow, "#22c55e"], ["Allowed + notified", m.decision_allow_notify, "#eab308"], ["Held", m.decision_hold, "#f97316"], ["Blocked", m.decision_block, "#ef4444"]];

  return (
    <main className="page">
      <PageHead title="System health" sub="Auto-refreshes every 10 seconds." actions={<button className="btn" onClick={reload}>Refresh now</button>} />
      <div className="grid g4">
        <Card><div className="row between"><strong>MongoDB</strong><Status up={mongo.up} /></div><div className="small muted mt">{mongo.up ? `${mongo.latencyMs} ms · db “${mongo.database}”` : mongo.error}</div><div className="tiny faint">{mongo.up && (mongo.transactions ? "Multi-document transactions on" : "Transactions disabled")}</div></Card>
        <Card><div className="row between"><strong>Redis</strong><Status up={redis.up} /></div><div className="small muted mt">{redis.up ? `${redis.latencyMs} ms · v${redis.version} · up ${dur(redis.uptimeSeconds)}` : "Degraded mode: MongoDB fallbacks and in-process rate limits are in use."}</div></Card>
        <Card><div className="row between"><strong>ML service</strong><Status up={ml.up} /></div><div className="small muted mt">{ml.up ? `${ml.latencyMs} ms · model v${ml.version}` : ml.error || "Unreachable — payments are scored by rules only."}</div>{ml.breakerOpen && <div className="tiny neg">Circuit breaker open</div>}</Card>
        <Card><div className="row between"><strong>API</strong><Status up /></div><div className="small muted mt">up {dur(app.uptimeSeconds)} · {app.memoryMb} MB · Node {app.node}</div></Card>
      </div>
      {redis.up && (
        <div className="grid g5 mt">
          <Kpi label="Redis memory" value={redis.memory} sub={`peak ${redis.peakMemory}`} /><Kpi label="Keys" value={num(redis.keys)} /><Kpi label="Active sessions" value={num(redis.activeSessions)} /><Kpi label="Live browser streams" value={num(redis.sseClients)} /><Kpi label="Server hit rate" value={redis.hitRate !== null ? pct(redis.hitRate, 1) : "—"} sub={`${redis.evictedKeys} evicted`} />
        </div>)}
      <div className="grid g3 mt">
        <Card title="Application cache"><div className="kpi"><div className="value">{hits + miss ? pct((hits / (hits + miss)) * 100, 1) : "—"}</div><div className="sub">{num(hits)} hits · {num(miss)} misses</div></div></Card>
        <Card title="Behaviour profile store"><div className="kpi"><div className="value">{m.profile_hit + m.profile_rebuild ? pct((m.profile_hit / (m.profile_hit + m.profile_rebuild)) * 100, 1) : "—"}</div><div className="sub">{num(m.profile_hit)} served from Redis · {num(m.profile_rebuild)} rebuilt from MongoDB</div></div></Card>
        <Card title="Protection"><div className="kpi"><div className="value">{num(m.rate_limited)}</div><div className="sub">requests rate-limited · {num(m.ml_failures)} ML failures of {num(m.ml_calls)} calls · {num(m.txn_failed)} failed payments</div></div></Card>
      </div>
      <Card title="Engine decisions since counters began" className="mt"><HBars items={decisions.map(([label, value, color]: any) => ({ label, value, color, right: num(value) }))} /></Card>
      <Card title="What Redis does in CertiFlow" className="mt">
        <div className="table-wrap"><table className="table"><thead><tr><th>Key pattern</th><th>Purpose</th><th>Details</th></tr></thead><tbody>
          {USES.map(([k, p, t]) => <tr key={k}><td className="mono small nowrap">{k}</td><td><strong>{p}</strong></td><td className="small muted">{t}</td></tr>)}
        </tbody></table></div>
      </Card>
    </main>
  );
}
