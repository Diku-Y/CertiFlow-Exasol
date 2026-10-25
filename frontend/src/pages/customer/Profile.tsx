import { useState } from "react";
import type { FormEvent } from "react";
import { Badge, Card, CopyButton, Field, Notice, PageHead, Seg } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import type { ThemeChoice } from "../../context/ThemeContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { dateTime, inr } from "../../lib/format";
import { useFetch } from "../../lib/hooks";

export default function Profile() {
  const { me, refresh } = useAuth();
  const { choice, setChoice } = useTheme();
  const { toast } = useToast();
  const sessions = useFetch<any[]>("/auth/sessions");
  const [pw, setPw] = useState({ password: "", pin: "", pin2: "" });
  const [cp, setCp] = useState({ current_password: "", new_password: "" });
  const [msg, setMsg] = useState<{ pin?: string; pw?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const a = me?.account, c = me?.customer;

  const savePin = async (e: FormEvent) => {
    e.preventDefault(); setMsg(m => ({ ...m, pin: undefined }));
    if (pw.pin !== pw.pin2) return setMsg(m => ({ ...m, pin: "PINs do not match" }));
    setBusy("pin");
    try { await api("/auth/pin", { body: { password: pw.password, pin: pw.pin } }); toast({ tone: "success", title: me?.user?.pin_set ? "PIN changed" : "PIN set", text: "You can now make payments." }); setPw({ password: "", pin: "", pin2: "" }); await refresh(); }
    catch (err: any) { setMsg(m => ({ ...m, pin: err.message })); } finally { setBusy(null); }
  };
  const savePw = async (e: FormEvent) => {
    e.preventDefault(); setMsg(m => ({ ...m, pw: undefined })); setBusy("pw");
    try { await api("/auth/password", { body: cp }); toast({ tone: "success", title: "Password updated", text: "Other devices were signed out." }); setCp({ current_password: "", new_password: "" }); void sessions.reload(); }
    catch (err: any) { setMsg(m => ({ ...m, pw: err.message })); } finally { setBusy(null); }
  };
  const revokeOthers = async () => { const r = await api("/auth/sessions/revoke-others", { body: {} }); toast({ tone: "success", title: `Signed out ${r.revoked} other session(s)` }); void sessions.reload(); };

  return (
    <main className="page">
      <PageHead title="Profile & security" sub="Manage your account, PIN, password and devices." />
      <div className="grid g2">
        <Card title="Account details">
          <dl className="kv">
            <dt>Name</dt><dd>{c?.name}</dd><dt>Customer ID</dt><dd className="mono">{c?.customer_number}</dd><dt>Email</dt><dd>{c?.email}</dd><dt>Mobile</dt><dd>{c?.phone}</dd><dt>City</dt><dd>{c?.city}</dd>
            <dt>Account</dt><dd className="row"><span className="mono">{a?.account_number}</span>{a && <CopyButton text={a.account_number} />}</dd>
            <dt>Type</dt><dd>{a?.account_type === "CURRENT" ? "Current" : "Savings"} <Badge value={a?.status || "ACTIVE"} /></dd>
            <dt>IFSC / Branch</dt><dd>{a?.ifsc} · {a?.branch}</dd><dt>Daily limit</dt><dd>{inr(a?.daily_limit, { decimals: false })}</dd><dt>Opened</dt><dd>{dateTime(a?.opened_on)}</dd>
          </dl>
        </Card>
        <Card title="Appearance">
          <p className="muted small mb">Choose how CertiFlow looks on this device.</p>
          <Seg<ThemeChoice> value={choice} onChange={setChoice} options={[{ value: "light", label: "☀ Light" }, { value: "dark", label: "🌙 Dark" }, { value: "system", label: "Auto" }]} />
        </Card>
        <Card title={me?.user?.pin_set ? "Change transaction PIN" : "Set transaction PIN"}>
          {!me?.user?.pin_set && <div className="mb"><Notice tone="warn">You need a PIN to make payments.</Notice></div>}
          <form className="col" onSubmit={savePin}>
            {msg.pin && <Notice tone="bad">{msg.pin}</Notice>}
            <Field label="Account password"><input className="input" type="password" autoComplete="current-password" value={pw.password} onChange={e => setPw({ ...pw, password: e.target.value })} required /></Field>
            <div className="grid g2"><Field label="New 6-digit PIN" hint="Avoid 123456 or 111111"><input className="input" type="password" inputMode="numeric" maxLength={6} value={pw.pin} onChange={e => setPw({ ...pw, pin: e.target.value.replace(/\D/g, "") })} required /></Field>
              <Field label="Confirm PIN"><input className="input" type="password" inputMode="numeric" maxLength={6} value={pw.pin2} onChange={e => setPw({ ...pw, pin2: e.target.value.replace(/\D/g, "") })} required /></Field></div>
            <button className="btn primary" disabled={busy === "pin" || pw.pin.length !== 6}>{busy === "pin" ? <span className="spinner" /> : "Save PIN"}</button>
          </form>
        </Card>
        <Card title="Change password">
          <form className="col" onSubmit={savePw}>
            {msg.pw && <Notice tone="bad">{msg.pw}</Notice>}
            <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={cp.current_password} onChange={e => setCp({ ...cp, current_password: e.target.value })} required /></Field>
            <Field label="New password" hint="8+ characters with letters and numbers"><input className="input" type="password" autoComplete="new-password" value={cp.new_password} onChange={e => setCp({ ...cp, new_password: e.target.value })} required /></Field>
            <button className="btn primary" disabled={busy === "pw"}>{busy === "pw" ? <span className="spinner" /> : "Update password"}</button>
          </form>
        </Card>
      </div>
      <Card title="Signed-in devices" className="mt" action={sessions.data && sessions.data.length > 1 ? <button className="btn sm" onClick={revokeOthers}>Sign out other devices</button> : undefined}>
        {sessions.data?.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Device</th><th>Signed in</th><th>IP</th><th /></tr></thead><tbody>
          {sessions.data.map((s, i) => <tr key={i}><td><span className="mono small">{s.device_id}</span><div className="tiny muted" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.user_agent}</div></td><td>{dateTime(s.created_at)}</td><td className="mono small">{s.ip}</td><td>{s.current && <Badge value="ok" label="This device" />}</td></tr>)}
        </tbody></table></div> : <p className="muted small">Session tracking needs Redis to be running.</p>}
      </Card>
    </main>
  );
}
