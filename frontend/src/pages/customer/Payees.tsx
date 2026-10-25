import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Empty, Field, Modal, PageHead, Skeleton, useConfirm } from "../../components/ui";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { ago, initials } from "../../lib/format";
import { useFetch } from "../../lib/hooks";

export default function Payees() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data, loading, reload } = useFetch<any[]>("/banking/beneficiaries");
  const [adding, setAdding] = useState(false);
  const [acc, setAcc] = useState("");
  const [nick, setNick] = useState("");
  const [found, setFound] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();

  const close = () => { setAdding(false); setAcc(""); setNick(""); setFound(null); setErr(null); };
  const verify = async () => { setErr(null); setBusy(true); try { setFound(await api(`/banking/payee-lookup?account_number=${acc}`)); } catch (e: any) { setErr(e.message); setFound(null); } finally { setBusy(false); } };
  const add = async () => {
    setBusy(true);
    try { await api("/banking/beneficiaries", { body: { account_number: acc, nickname: nick } }); toast({ tone: "success", title: "Payee saved" }); close(); void reload(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const remove = async (p: any) => {
    if (!(await ask({ title: "Remove payee?", text: `${p.name} will be removed from your saved payees.`, confirm: "Remove", danger: true }))) return;
    try { await api(`/banking/beneficiaries/${p.id}`, { method: "DELETE" }); toast({ tone: "success", title: "Payee removed" }); void reload(); } catch (e: any) { toast({ tone: "error", title: "Could not remove", text: e.message }); }
  };

  return (
    <main className="page">
      <PageHead title="Payees" sub="People you pay often." actions={<button className="btn primary" onClick={() => setAdding(true)}>+ Add payee</button>} />
      <Card>
        {loading ? <Skeleton h={180} /> : !data?.length ? <Empty icon="users" title="No payees yet" text="Add someone to pay them in two taps." action={<button className="btn primary" onClick={() => setAdding(true)}>Add your first payee</button>} /> :
          data.map(p => (
            <div className="txn" key={p.id} style={{ cursor: "default" }}>
              <span className="avatar" style={{ width: 42, height: 42 }}>{initials(p.name)}</span>
              <div className="grow"><div className="name">{p.nickname || p.name}</div><div className="small muted">{p.name} · {p.masked_account_number} · {p.last_paid_at ? `last paid ${ago(p.last_paid_at)}` : "never paid"}</div></div>
              <button className="btn sm primary" onClick={() => navigate(`/app/send?to=${p.account_number}`)}>Send</button>
              <button className="btn sm ghost" onClick={() => remove(p)} aria-label={`Remove ${p.name}`}>Remove</button>
            </div>))}
      </Card>
      {adding && (
        <Modal title="Add payee" sub="We’ll check the account holder’s name before saving." onClose={close} actions={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!found || busy} onClick={add}>Save payee</button></>}>
          <Field label="Account number" error={err}><div className="row"><input className="input mono" inputMode="numeric" maxLength={12} value={acc} onChange={e => { setAcc(e.target.value.replace(/\D/g, "")); setFound(null); }} /><button className="btn" disabled={acc.length !== 12 || busy} onClick={verify}>Verify</button></div></Field>
          {found && <div className="alert-box ok"><span className="ico">✓</span><div><strong>{found.holder_name_masked}</strong><div className="small muted">{found.bank} · {found.masked_account_number}</div></div></div>}
          <Field label="Nickname (optional)"><input className="input" maxLength={30} value={nick} onChange={e => setNick(e.target.value)} /></Field>
        </Modal>
      )}
      {dialog}
    </main>
  );
}
