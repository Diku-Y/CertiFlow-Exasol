import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PinPad, Receipt } from "../../components/payment";
import { Badge, Card, Empty, Field, Loading, Notice, PageHead } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { api, newIdempotencyKey } from "../../lib/api";
import { inr, initials } from "../../lib/format";
import { useFetch } from "../../lib/hooks";

const STEPS = ["Payee", "Amount", "Confirm", "Receipt"];

export default function SendMoney() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const cfg = useFetch<any>("/banking/config");
  const payees = useFetch<any[]>("/banking/beneficiaries");
  const [step, setStep] = useState(0);
  const [acc, setAcc] = useState(params.get("to") || "");
  const [verified, setVerified] = useState<any>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("UPI");
  const [remarks, setRemarks] = useState("");
  const [save, setSave] = useState(true);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [key, setKey] = useState(newIdempotencyKey);

  const balance = me?.account?.balance ?? 0;
  const amt = Number(amount);
  const modes: any[] = cfg.data?.modes || [];
  const modeInfo = modes.find(m => m.key === mode);
  const saved = payees.data?.find(p => p.account_number === verified?.account_number);

  const verify = async (number: string) => {
    setLookupErr(null); setLooking(true); setVerified(null);
    try { setVerified(await api(`/banking/payee-lookup?account_number=${encodeURIComponent(number.trim())}`)); }
    catch (e: any) { setLookupErr(e.message); } finally { setLooking(false); }
  };
  useEffect(() => { if (params.get("to")) void verify(params.get("to")!); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const amountError = (): string | null => {
    if (!amount) return null;
    if (!Number.isFinite(amt) || amt <= 0) return "Enter a valid amount";
    if (Math.round(amt * 100) / 100 !== amt) return "Use at most 2 decimal places";
    if (amt > balance) return `Insufficient balance (available ${inr(balance)})`;
    if (modeInfo && amt < modeInfo.min) return `${mode} payments start at ${inr(modeInfo.min, { decimals: false })}`;
    if (modeInfo && amt > modeInfo.max) return `${mode} is limited to ${inr(modeInfo.max, { decimals: false })} per payment`;
    return null;
  };
  const aErr = amountError();

  const submit = async (code: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api("/banking/transfer", { idempotencyKey: key, body: { to_account_number: verified.account_number, amount: amt, mode, remarks, pin: code, save_beneficiary: save && !saved } });
      setReceipt(r); setStep(3); setKey(newIdempotencyKey()); void refresh(); void payees.reload();
    } catch (e: any) {
      setError(e.message); setPin("");
      if (["DAILY_LIMIT_EXCEEDED", "INSUFFICIENT_FUNDS", "PAYEE_BLOCKED", "PAYMENTS_DISABLED", "ACCOUNT_BLOCKED"].includes(e.code)) setKey(newIdempotencyKey());
      if (e.code === "INSUFFICIENT_FUNDS") void refresh();
    } finally { setBusy(false); }
  };

  const reset = () => { setStep(0); setAcc(""); setVerified(null); setAmount(""); setRemarks(""); setPin(""); setReceipt(null); setError(null); };
  if (cfg.loading) return <Loading />;
  if (!me?.user?.pin_set) return <main className="page"><PageHead title="Send money" /><Notice tone="warn">Set your transaction PIN before sending money. <a href="/app/profile">Go to Profile & security →</a></Notice></main>;

  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <PageHead title="Send money" sub="Transfer to any CertiFlow account instantly." />
      <div className="stepper" aria-label="Progress">
        {STEPS.map((s, i) => <span key={s} className="row"><span className={`step ${i === step ? "on" : i < step ? "done" : ""}`}><span className="n">{i < step ? "✓" : i + 1}</span>{s}</span>{i < STEPS.length - 1 && <span className="step-line" />}</span>)}
      </div>

      {step === 0 && (
        <Card title="Who are you paying?">
          {payees.data && payees.data.length > 0 && <div className="col mb"><span className="small muted">Saved payees</span>
            {payees.data.slice(0, 5).map(p => (
              <button key={p.id} className={`payee ${verified?.account_number === p.account_number ? "on" : ""}`} onClick={() => { setAcc(p.account_number); void verify(p.account_number); }}>
                <span className="avatar">{initials(p.name)}</span><span className="grow"><strong>{p.nickname || p.name}</strong><br /><span className="small muted">{p.name} · {p.masked_account_number}</span></span>
              </button>))}
          </div>}
          <Field label="Or enter an account number" hint="12-digit CertiFlow account number" error={lookupErr}>
            <div className="row"><input className="input mono" inputMode="numeric" maxLength={12} placeholder="5XXXXXXXXXXX" value={acc} onChange={e => { setAcc(e.target.value.replace(/\D/g, "")); setVerified(null); setLookupErr(null); }} />
              <button className="btn" disabled={acc.length !== 12 || looking} onClick={() => verify(acc)}>{looking ? <span className="spinner" /> : "Verify"}</button></div>
          </Field>
          {verified && (
            <div className="alert-box ok mt"><span className="ico">✓</span><div className="grow"><strong>{verified.holder_name_masked}</strong><div className="small muted">{verified.bank} · {verified.masked_account_number} · IFSC {verified.ifsc}</div>{!verified.can_receive && <div className="small neg">This account cannot receive payments right now.</div>}</div></div>
          )}
          <button className="btn primary lg block mt" disabled={!verified || !verified.can_receive} onClick={() => setStep(1)}>Continue</button>
        </Card>
      )}

      {step === 1 && verified && (
        <Card title={`Paying ${verified.holder_name_masked}`}>
          <Field label="Amount" error={aErr} hint={`Available balance ${inr(balance)}`}>
            <div className="input-group"><span className="prefix">₹</span><input className="input input-lg" inputMode="decimal" autoFocus placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} /></div>
          </Field>
          <div className="row wrap mt">{[500, 1000, 5000, 10000].map(v => <button key={v} className="btn sm" onClick={() => setAmount(String(v))}>{inr(v, { decimals: false })}</button>)}</div>
          <div className="mt-lg"><span className="small muted">Payment mode</span>
            <div className="grid g2" style={{ marginTop: 6 }}>{modes.map(m => (
              <button key={m.key} className={`mode-card ${mode === m.key ? "on" : ""}`} onClick={() => setMode(m.key)}><strong>{m.label}</strong><br /><span className="small muted">{m.description}</span></button>))}</div></div>
          <div className="mt-lg"><Field label="Remarks (optional)"><input className="input" maxLength={60} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="What’s this for?" /></Field></div>
          <div className="row mt-lg"><button className="btn" onClick={() => setStep(0)}>Back</button><button className="btn primary grow" disabled={!amount || !!aErr} onClick={() => { setPin(""); setError(null); setStep(2); }}>Review</button></div>
        </Card>
      )}

      {step === 2 && verified && (
        <Card title="Confirm with your PIN">
          <div className="card soft col gap-sm" style={{ marginBottom: 12 }}>
            <div className="row between"><span className="muted">To</span><strong>{verified.holder_name_masked}</strong></div>
            <div className="row between"><span className="muted">Account</span><span className="mono">{verified.masked_account_number}</span></div>
            <div className="row between"><span className="muted">Amount</span><strong style={{ fontSize: "1.2rem" }}>{inr(amt)}</strong></div>
            <div className="row between"><span className="muted">Mode</span><span>{mode}</span></div>
            {remarks && <div className="row between"><span className="muted">Remarks</span><span>{remarks}</span></div>}
          </div>
          {!saved && <label className="check mb"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} />Save as payee for next time</label>}
          {error && <div className="mb"><Notice tone="bad">{error}</Notice></div>}
          <div className="center small muted">Enter your 6-digit transaction PIN</div>
          {busy ? <Loading text="Processing securely…" /> : <PinPad value={pin} onChange={setPin} onComplete={submit} />}
          <div className="row mt-lg"><button className="btn" disabled={busy} onClick={() => setStep(1)}>Back</button></div>
        </Card>
      )}

      {step === 3 && receipt && <Card><Receipt r={receipt} onDone={() => navigate("/app")} doneLabel="Back to overview" extra={<button className="btn block" onClick={reset}>Make another payment</button>} /></Card>}
      {step === 0 && !payees.loading && !payees.data?.length && <div className="mt"><Empty icon="users" title="No saved payees yet" text="Enter an account number above to send your first payment." /></div>}
      <div className="hide-sm center tiny faint mt-lg"><Badge value="ok" label="Secured" tone="ok" /> Payments are checked in real time by CertiFlow Guard</div>
    </main>
  );
}
