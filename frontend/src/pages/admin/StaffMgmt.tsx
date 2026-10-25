import { useState } from "react";
import { Badge, Card, CopyButton, Field, Modal, Notice, PageHead, Skeleton, useConfirm } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { ago } from "../../lib/format";
import { useFetch } from "../../lib/hooks";

export default function StaffMgmt() {
  const { me } = useAuth();
  const { toast } = useToast();
  const { data, loading, reload } = useFetch<any[]>("/admin/staff");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "FRAUD_ANALYST", password: "" });
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ask, dialog] = useConfirm();

  const create = async () => {
    setBusy(true); setErr(null);
    try { const r = await api("/admin/staff", { body: { ...form, password: form.password || undefined } }); setCreating(false); setForm({ name: "", email: "", role: "FRAUD_ANALYST", password: "" }); setSecret({ who: r.name, password: r.temporary_password }); void reload(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const patch = async (id: number, body: any, ok: string) => { try { await api(`/admin/staff/${id}`, { method: "PATCH", body }); toast({ tone: "success", title: ok }); void reload(); } catch (e: any) { toast({ tone: "error", title: "Could not update", text: e.message }); } };
  const reset = async (s: any) => {
    if (!(await ask({ title: `Reset password for ${s.name}?`, text: "A new temporary password is generated and they are signed out everywhere.", confirm: "Reset password" }))) return;
    try { const r = await api(`/admin/staff/${s.id}/reset-password`, { body: {} }); setSecret({ who: s.name, password: r.temporary_password }); } catch (e: any) { toast({ tone: "error", title: "Reset failed", text: e.message }); }
  };

  return (
    <main className="page">
      <PageHead title="Staff" sub="Fraud analysts and administrators." actions={<button className="btn primary" onClick={() => setCreating(true)}>+ Add staff member</button>} />
      <Card>
        {loading ? <Skeleton h={200} /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead><tbody>
            {data?.map(s => { const self = s.id === me?.user?.id; return (
              <tr key={s.id}><td><strong>{s.name}</strong>{self && <span className="badge plain info" style={{ marginLeft: 8 }}>you</span>}<div className="tiny muted">{s.email}</div></td>
                <td><select className="select" style={{ width: "auto", padding: "4px 8px" }} disabled={self} value={s.role} onChange={e => patch(s.id, { role: e.target.value }, "Role updated")} aria-label={`Role of ${s.name}`}><option value="FRAUD_ANALYST">Fraud analyst</option><option value="ADMIN">Administrator</option></select></td>
                <td><Badge value={s.status} />{s.locked && <Badge value="HIGH" label="Locked" />}{s.must_change_password && <span className="tiny muted"> · temp password</span>}</td>
                <td className="small">{s.last_login_at ? ago(s.last_login_at) : "never"}</td>
                <td className="right nowrap"><button className="btn sm" onClick={() => reset(s)}>Reset password</button>{" "}
                  {s.status === "ACTIVE" ? <button className="btn sm danger" disabled={self} onClick={async () => { if (await ask({ title: `Disable ${s.name}?`, text: "They are signed out immediately and cannot sign in again until re-enabled.", confirm: "Disable", danger: true })) void patch(s.id, { status: "DISABLED" }, "Staff member disabled"); }}>Disable</button>
                    : <button className="btn sm good" onClick={() => patch(s.id, { status: "ACTIVE" }, "Staff member enabled")}>Enable</button>}</td></tr>); })}
          </tbody></table></div>)}
      </Card>
      {creating && <Modal title="Add staff member" sub="They must change the temporary password at first sign-in." onClose={() => setCreating(false)} actions={<><button className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary" disabled={busy || !form.name || !form.email} onClick={create}>{busy ? <span className="spinner" /> : "Create"}</button></>}>
        {err && <Notice tone="bad">{err}</Notice>}
        <Field label="Full name"><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Role"><select className="select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="FRAUD_ANALYST">Fraud analyst — works the alert queue</option><option value="ADMIN">Administrator — full control</option></select></Field>
        <Field label="Temporary password (optional)" hint="Leave blank to generate a secure one"><input className="input" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></Field></Modal>}
      {secret && <Modal title="Temporary password" sub={`Share this with ${secret.who} securely. It is shown only once.`} onClose={() => setSecret(null)} actions={<button className="btn primary" onClick={() => setSecret(null)}>Done</button>}>
        <div className="card soft row between"><span className="mono" style={{ fontSize: "1.15rem" }}>{secret.password}</span><CopyButton text={secret.password} /></div></Modal>}
      {dialog}
    </main>
  );
}
