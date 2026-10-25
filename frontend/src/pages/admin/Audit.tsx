import { useState } from "react";
import { Badge, Card, Empty, ErrorBox, Field, PageHead, Pager, Skeleton } from "../../components/ui";
import { qs } from "../../lib/api";
import { dateTime, titleCase } from "../../lib/format";
import { useDebounced, useFetch } from "../../lib/hooks";

export default function Audit() {
  const [f, setF] = useState({ q: "", action: "ALL", actor_role: "ALL" });
  const [page, setPage] = useState(1);
  const q = useDebounced(f.q);
  const { data, loading, error, reload } = useFetch<any>(`/admin/audit${qs({ ...f, q, page, limit: 25 })}`);
  const set = (k: string, v: string) => { setF(s => ({ ...s, [k]: v })); setPage(1); };
  return (
    <main className="page">
      <PageHead title="Audit log" sub="Immutable record of sensitive actions by staff, customers and the system." />
      <Card>
        <div className="filters">
          <Field label="Search"><input className="input" placeholder="Summary or person" value={f.q} onChange={e => set("q", e.target.value)} /></Field>
          <Field label="Action"><select className="select" value={f.action} onChange={e => set("action", e.target.value)}><option value="ALL">All actions</option>{data?.actions.map((a: string) => <option key={a} value={a}>{titleCase(a)}</option>)}</select></Field>
          <Field label="Actor"><select className="select" value={f.actor_role} onChange={e => set("actor_role", e.target.value)}><option value="ALL">Anyone</option>{["ADMIN", "FRAUD_ANALYST", "USER", "SYSTEM"].map(r => <option key={r} value={r}>{titleCase(r)}</option>)}</select></Field>
        </div>
        {error ? <ErrorBox message={error} retry={reload} /> : loading && !data ? <Skeleton h={300} /> : !data?.items.length ? <Empty icon="shield" title="No audit entries" /> : (
          <><div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th><th>IP</th></tr></thead><tbody>
            {data.items.map((a: any) => <tr key={a._id}><td className="small nowrap">{dateTime(a.created_at)}</td><td><strong>{a.actor_name}</strong><div className="tiny muted">{titleCase(a.actor_role)}</div></td><td><Badge value={a.action} label={titleCase(a.action)} tone={/LOCK|FREEZE|FROZEN|BLOCK|HOLD|SUSPEND|FAILED|FORCE/.test(a.action) ? "warn" : /FRAUD|REJECT/.test(a.action) ? "bad" : "info"} /></td><td className="small">{a.summary}</td><td className="mono tiny">{a.ip}</td></tr>)}
          </tbody></table></div><Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} label="entries" /></>)}
      </Card>
    </main>
  );
}
