import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { StaffTxnDrawer } from "../../components/staff";
import { Badge, Card, Drawer, Empty, ErrorBox, Field, Loading, Modal, PageHead, Pager, Skeleton, useConfirm } from "../../components/ui";
import { useToast } from "../../context/ToastContext";
import { api, qs } from "../../lib/api";
import { ago, dateTime, inr } from "../../lib/format";
import { useDebounced, useFetch } from "../../lib/hooks";

type Act = null | "limit" | "deposit";

function CustomerDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<any>(`/admin/customers/${id}`);
  const [act, setAct] = useState<Act>(null);
  const [val, setVal] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [txn, setTxn] = useState<number | null>(null);
  const [ask, dialog] = useConfirm();

  const run = async (path: string, body: any, ok: string) => {
    setBusy(true);
    try { await api(`/admin/customers/${id}/${path}`, { body }); toast({ tone: "success", title: ok }); await reload(); onChanged(); return true; }
    catch (e: any) { toast({ tone: "error", title: "Action failed", text: e.message }); return false; } finally { setBusy(false); }
  };
  if (error) return <Drawer title="Customer" onClose={onClose}><ErrorBox message={error} /></Drawer>;
  if (!data) return <Drawer title="Customer" onClose={onClose}><Loading /></Drawer>;
  const { customer: c, account: a, user: u, stats, behaviour: b, sessions, recent_transactions, alerts } = data;
  const active = c.status === "ACTIVE", suspended = c.status === "SUSPENDED";

  return (
    <Drawer title={c.name} onClose={onClose} wide>
      <div className="row wrap"><Badge value={c.status} /><Badge value={c.risk_level} label={`${c.risk_level[0] + c.risk_level.slice(1).toLowerCase()} risk`} />{a && <Badge value={a.status} label={`Account ${a.status.toLowerCase()}`} />}{u?.login_locked && <Badge value="HIGH" label="Login locked" />}{u?.pin_locked && <Badge value="HIGH" label="PIN locked" />}</div>
      <dl className="kv"><dt>Customer ID</dt><dd className="mono">{c.customer_number}</dd><dt>Email / phone</dt><dd>{c.email} · {c.phone}</dd><dt>City</dt><dd>{c.city}</dd><dt>Customer since</dt><dd>{dateTime(c.created_at)}</dd>
        <dt>Last sign-in</dt><dd>{u?.last_login_at ? `${ago(u.last_login_at)} from ${u.last_login_ip}` : "never"}</dd><dt>Transaction PIN</dt><dd>{u?.pin_set ? "Set" : "Not set"}</dd>
        {a && <><dt>Account</dt><dd><span className="mono">{a.account_number}</span> · {a.account_type}</dd><dt>Balance</dt><dd><strong>{inr(a.balance)}</strong></dd><dt>Daily limit</dt><dd>{inr(a.daily_limit, { decimals: false })}</dd></>}
        <dt>Lifetime</dt><dd>{stats.transactions} payments · {inr(stats.volume, { compact: true })} sent</dd></dl>

      {(active || suspended) && (
        <Card title="Actions" tight>
          <div className="row wrap">
            {active && <button className="btn sm" disabled={busy} onClick={() => setAct("deposit")}>Deposit funds</button>}
            {a && <button className="btn sm" disabled={busy} onClick={() => { setVal(String(a.daily_limit)); setAct("limit"); }}>Change daily limit</button>}
            {a && (a.status === "ACTIVE" ? <button className="btn sm" disabled={busy} onClick={async () => { if (await ask({ title: "Freeze account?", text: "The customer will not be able to make payments until you unfreeze it.", confirm: "Freeze", danger: true })) await run("account-status", { status: "BLOCKED" }, "Account frozen"); }}>Freeze account</button>
              : <button className="btn sm" disabled={busy} onClick={() => run("account-status", { status: "ACTIVE" }, "Account unfrozen")}>Unfreeze account</button>)}
            <button className="btn sm" disabled={busy} onClick={() => run("unlock", {}, "Locks cleared")}>Clear login/PIN lock</button>
            <button className="btn sm" disabled={busy} onClick={() => run("force-logout", {}, "Signed out everywhere")}>Force sign-out</button>
            {active && <button className="btn sm danger" disabled={busy} onClick={async () => { if (await ask({ title: `Suspend ${c.name}?`, text: "They are signed out immediately and cannot bank until reinstated.", confirm: "Suspend", danger: true })) await run("status", { status: "SUSPENDED", reason: "Suspended by administrator" }, "Customer suspended"); }}>Suspend</button>}
            {suspended && <button className="btn sm good" disabled={busy} onClick={() => run("status", { status: "ACTIVE" }, "Customer reinstated")}>Reinstate</button>}
            <select className="select" style={{ width: "auto", padding: "5px 10px" }} value={c.risk_level} onChange={e => run("risk-level", { risk_level: e.target.value }, "Risk level updated")} aria-label="Risk level">{["LOW", "MEDIUM", "HIGH"].map(r => <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase()} risk</option>)}</select>
          </div>
        </Card>)}

      <Card title="Behaviour profile (what the fraud model sees)" tight>
        <dl className="kv" style={{ gridTemplateColumns: "140px 1fr" }}><dt>Payments learned</dt><dd>{b.history_count}</dd><dt>Average / largest</dt><dd>{inr(b.average_amount, { decimals: false })} / {inr(b.largest_amount, { decimals: false })}</dd><dt>Trusted devices</dt><dd>{b.devices}</dd><dt>Known payees</dt><dd>{b.known_recipients}</dd><dt>Known places</dt><dd><div className="pill-list">{b.locations.map((l: string) => <span key={l} className="pill">{l}</span>)}</div></dd></dl>
      </Card>
      {alerts.length > 0 && <Card title="Fraud alerts" tight>{alerts.map((x: any) => <div className="row between" key={x.id} style={{ padding: "6px 0", cursor: "pointer" }} onClick={() => navigate(`/admin/alerts/${x.id}`)}><span className="mono small">{x.alert_number}</span><span className="row"><Badge value={x.severity} />{x.resolution ? <Badge value={x.resolution} /> : <Badge value={x.status} />}<span className="small muted">score {x.risk_score}</span></span></div>)}</Card>}
      <Card title="Recent transactions" tight>{recent_transactions.length === 0 ? <Empty title="None yet" /> : <div className="table-wrap"><table className="table"><tbody>{recent_transactions.map((t: any) => (
        <tr key={t.id} className="click" onClick={() => setTxn(t.id)}><td className="small nowrap">{ago(t.created_at)}</td><td>{t.customer_id === c.id ? `→ ${t.recipient_name || "—"}` : `← ${t.sender_name}`}</td><td><strong>{inr(t.amount, { decimals: false })}</strong></td><td><Badge value={t.status} /></td><td className="small">risk {t.risk_score}</td></tr>))}</tbody></table></div>}</Card>
      {sessions.length > 0 && <Card title="Active sessions" tight>{sessions.map((s: any, i: number) => <div className="small row between" key={i} style={{ padding: "4px 0" }}><span className="mono">{s.device_id}</span><span className="muted">{s.ip} · {ago(s.created_at)}</span></div>)}</Card>}

      {act === "deposit" && <Modal title="Deposit funds" sub={`Credit ${c.name}'s account from the bank.`} onClose={() => setAct(null)} actions={<><button className="btn" onClick={() => setAct(null)}>Cancel</button><button className="btn primary" disabled={busy || !Number(val)} onClick={async () => { if (await run("deposit", { amount: Number(val), remarks }, "Funds deposited")) { setAct(null); setVal(""); setRemarks(""); } }}>Deposit</button></>}>
        <Field label="Amount (₹)"><input className="input" inputMode="decimal" autoFocus value={val} onChange={e => setVal(e.target.value.replace(/[^\d.]/g, ""))} /></Field><Field label="Remarks"><input className="input" maxLength={60} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Cash deposit" /></Field></Modal>}
      {act === "limit" && <Modal title="Daily transfer limit" onClose={() => setAct(null)} actions={<><button className="btn" onClick={() => setAct(null)}>Cancel</button><button className="btn primary" disabled={busy || !Number(val)} onClick={async () => { if (await run("limit", { daily_limit: Number(val) }, "Limit updated")) setAct(null); }}>Save</button></>}>
        <Field label="Limit per day (₹)" hint="Between ₹1,000 and ₹10,00,00,000"><input className="input" inputMode="numeric" autoFocus value={val} onChange={e => setVal(e.target.value.replace(/\D/g, ""))} /></Field></Modal>}
      {txn !== null && <StaffTxnDrawer id={txn} onClose={() => setTxn(null)} />}
      {dialog}
    </Drawer>
  );
}

export default function Customers() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [f, setF] = useState({ q: "", status: "ALL", risk: "ALL" });
  const [page, setPage] = useState(1);
  const q = useDebounced(f.q);
  const { data, loading, error, reload } = useFetch<any>(`/admin/customers${qs({ ...f, q, page, limit: 15 })}`);
  const set = (k: string, v: string) => { setF(s => ({ ...s, [k]: v })); setPage(1); };
  return (
    <main className="page">
      <PageHead title="Customers" sub="Search, review and manage customer accounts." />
      <Card>
        <div className="filters">
          <Field label="Search"><input className="input" placeholder="Name, email, phone, account no." value={f.q} onChange={e => set("q", e.target.value)} /></Field>
          <Field label="Status"><select className="select" value={f.status} onChange={e => set("status", e.target.value)}><option value="ALL">All</option>{["ACTIVE", "PENDING", "SUSPENDED", "REJECTED"].map(s => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</select></Field>
          <Field label="Risk"><select className="select" value={f.risk} onChange={e => set("risk", e.target.value)}><option value="ALL">All</option>{["LOW", "MEDIUM", "HIGH"].map(s => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</select></Field>
        </div>
        {error ? <ErrorBox message={error} retry={reload} /> : loading && !data ? <Skeleton h={300} /> : !data?.items.length ? <Empty icon="users" title="No customers found" /> : (
          <><div className="table-wrap"><table className="table"><thead><tr><th>Customer</th><th>Account</th><th>Balance</th><th>Status</th><th>Risk</th><th>Since</th></tr></thead><tbody>
            {data.items.map((c: any) => <tr key={c.id} className="click" onClick={() => navigate(`/admin/customers/${c.id}`)}><td><strong>{c.name}</strong><div className="tiny muted">{c.email}</div></td><td className="mono small">{c.account?.account_number || "—"}</td><td>{c.account ? inr(c.account.balance) : "—"}</td><td><Badge value={c.status} /></td><td><Badge value={c.risk_level} /></td><td className="small">{ago(c.created_at)}</td></tr>)}
          </tbody></table></div><Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} label="customers" /></>)}
      </Card>
      {id && <CustomerDrawer id={Number(id)} onClose={() => navigate("/admin/customers")} onChanged={reload} />}
    </main>
  );
}
