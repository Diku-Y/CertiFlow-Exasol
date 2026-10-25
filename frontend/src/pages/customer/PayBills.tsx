import { useMemo, useState } from "react";
import Icon from "../../components/Icon";
import { PinPad, Receipt } from "../../components/payment";
import { Card, Field, Loading, Modal, Notice, PageHead } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { api, newIdempotencyKey } from "../../lib/api";
import { categoryColor, initials, inr } from "../../lib/format";
import { useFetch } from "../../lib/hooks";
import { Link } from "react-router-dom";

export default function PayBills() {
  const { me, refresh } = useAuth();
  const cfg = useFetch<any>("/banking/config");
  const [sel, setSel] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState<"amount" | "pin" | "done">("amount");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [key, setKey] = useState(newIdempotencyKey);

  const groups = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const m of cfg.data?.merchants || []) (g[m.category] ||= []).push(m);
    return g;
  }, [cfg.data]);

  const close = () => { setSel(null); setAmount(""); setRemarks(""); setPin(""); setStage("amount"); setError(null); setReceipt(null); };
  const balance = me?.account?.balance ?? 0;
  const amt = Number(amount);
  const amtErr = amount && (!Number.isFinite(amt) || amt <= 0 || Math.round(amt * 100) / 100 !== amt) ? "Enter a valid amount" : amt > balance ? `Insufficient balance (available ${inr(balance)})` : amt > 100000 ? "UPI payments are limited to ₹1,00,000" : null;

  const pay = async (code: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      setReceipt(await api("/banking/pay", { idempotencyKey: key, body: { merchant_id: sel.id, amount: amt, remarks, pin: code } }));
      setStage("done"); setKey(newIdempotencyKey()); void refresh();
    } catch (e: any) { setError(e.message); setPin(""); } finally { setBusy(false); }
  };

  if (cfg.loading) return <Loading />;
  return (
    <main className="page">
      <PageHead title="Pay bills & shop" sub="Pay merchants and utilities instantly with UPI." />
      {!me?.user?.pin_set && <div className="mb"><Notice tone="warn">Set your transaction PIN first. <Link to="/app/profile">Go to Profile →</Link></Notice></div>}
      {Object.entries(groups).map(([cat, list]) => (
        <section key={cat} className="mb">
          <h3 className="mb row"><span style={{ width: 10, height: 10, borderRadius: 3, background: categoryColor(cat), display: "inline-block" }} />{cat}</h3>
          <div className="grid g5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
            {list.map(m => <button key={m.id} className="merchant" disabled={!me?.user?.pin_set} onClick={() => setSel(m)}>
              <span className="txn-ico" style={{ background: categoryColor(cat) }}>{initials(m.name)}</span><span>{m.name}</span><span className="small muted" style={{ fontWeight: 400 }}>{m.hint}</span></button>)}
          </div>
        </section>
      ))}
      {sel && (
        <Modal title={stage === "done" ? "Payment" : `Pay ${sel.name}`} sub={stage === "amount" ? sel.hint : undefined} onClose={close}>
          {stage === "amount" && <>
            <Field label="Amount" error={amtErr} hint={`Available ${inr(balance)}`}><div className="input-group"><span className="prefix">₹</span><input className="input input-lg" autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" /></div></Field>
            <Field label="Note (optional)"><input className="input" maxLength={60} value={remarks} onChange={e => setRemarks(e.target.value)} /></Field>
            <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!amount || !!amtErr} onClick={() => setStage("pin")}><Icon name="lock" size={15} />Continue</button></div>
          </>}
          {stage === "pin" && <>
            <div className="center"><div className="muted small">Paying {sel.name}</div><div style={{ fontSize: "1.8rem", fontWeight: 800 }}>{inr(amt)}</div></div>
            {error && <Notice tone="bad">{error}</Notice>}
            {busy ? <Loading text="Processing securely…" /> : <PinPad value={pin} onChange={setPin} onComplete={pay} />}
            <button className="btn" disabled={busy} onClick={() => setStage("amount")}>Back</button>
          </>}
          {stage === "done" && receipt && <Receipt r={receipt} onDone={close} />}
        </Modal>
      )}
      <Card className="mt tight"><span className="small muted">Merchants on this page are simulated. Each payment still passes through the full fraud-detection pipeline.</span></Card>
    </main>
  );
}
