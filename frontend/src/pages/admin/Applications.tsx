import { useState } from "react";
import { Badge, Card, Empty, Field, Modal, PageHead, Skeleton } from "../../components/ui";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { ago, dateTime } from "../../lib/format";
import { useFetch } from "../../lib/hooks";

export default function Applications() {
  const { toast } = useToast();
  const { data, loading, reload } = useFetch<any>("/admin/customers?status=PENDING&limit=50");
  const [sel, setSel] = useState<{ c: any; mode: "approve" | "reject" } | null>(null);
  const [type, setType] = useState("SAVINGS");
  const [opening, setOpening] = useState("10000");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => { setSel(null); setReason(""); setOpening("10000"); setType("SAVINGS"); };
  const submit = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      if (sel.mode === "approve") { const r = await api(`/admin/customers/${sel.c.id}/approve`, { body: { account_type: type, opening_balance: Number(opening || 0) } }); toast({ tone: "success", title: "Account opened", text: `Account number ${r.account_number}` }); }
      else { await api(`/admin/customers/${sel.c.id}/reject`, { body: { reason } }); toast({ tone: "info", title: "Application rejected" }); }
      close(); void reload();
    } catch (e: any) { toast({ tone: "error", title: "Failed", text: e.message }); } finally { setBusy(false); }
  };

  return (
    <main className="page">
      <PageHead title="Account applications" sub="Review new customers before they can bank." />
      <Card>
        {loading ? <Skeleton h={200} /> : !data?.items.length ? <Empty icon="file" title="No pending applications" text="New sign-ups will appear here for approval." /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Applicant</th><th>Contact</th><th>City</th><th>Applied</th><th /></tr></thead><tbody>
            {data.items.map((c: any) => <tr key={c.id}><td><strong>{c.name}</strong><div className="tiny muted mono">{c.customer_number}</div></td><td>{c.email}<div className="small muted">{c.phone}</div></td><td>{c.city}</td><td title={dateTime(c.created_at)}>{ago(c.created_at)}</td>
              <td className="right nowrap"><button className="btn sm good" onClick={() => setSel({ c, mode: "approve" })}>Approve</button> <button className="btn sm" onClick={() => setSel({ c, mode: "reject" })}>Reject</button></td></tr>)}
          </tbody></table></div>)}
      </Card>
      {sel?.mode === "approve" && (
        <Modal title={`Approve ${sel.c.name}`} sub="This opens a bank account immediately." onClose={close} actions={<><button className="btn" onClick={close}>Cancel</button><button className="btn good" disabled={busy} onClick={submit}>{busy ? <span className="spinner" /> : "Approve & open account"}</button></>}>
          <Field label="Account type"><select className="select" value={type} onChange={e => setType(e.target.value)}><option value="SAVINGS">Savings (daily limit ₹3,00,000)</option><option value="CURRENT">Current (daily limit ₹10,00,000)</option></select></Field>
          <Field label="Opening balance (₹)" hint="Recorded as a deposit on the ledger"><input className="input" inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
        </Modal>)}
      {sel?.mode === "reject" && (
        <Modal title={`Reject ${sel.c.name}`} onClose={close} actions={<><button className="btn" onClick={close}>Cancel</button><button className="btn danger" disabled={busy || reason.trim().length < 3} onClick={submit}>Reject application</button></>}>
          <Field label="Reason (shown to the applicant)"><textarea className="textarea" value={reason} onChange={e => setReason(e.target.value)} /></Field>
        </Modal>)}
      <div className="hide-sm" style={{ display: "none" }}><Badge value="PENDING" /></div>
    </main>
  );
}
