import { useState } from "react";
import Icon from "../../components/Icon";
import { TxnDrawer, TxnRow } from "../../components/payment";
import { Card, Empty, ErrorBox, Field, PageHead, Pager, Seg, Skeleton } from "../../components/ui";
import { useToast } from "../../context/ToastContext";
import { api, qs } from "../../lib/api";
import { CATEGORY_COLORS } from "../../lib/format";
import { useDebounced, useFetch } from "../../lib/hooks";
import { useLive } from "../../lib/live";

export default function Transactions() {
  const { toast } = useToast();
  const [f, setF] = useState({ type: "all", status: "ALL", category: "ALL", q: "", from: "", to: "", min: "", max: "" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(f.q);
  const query = qs({ ...f, q, page, limit: 15 });
  const { data, loading, error, reload } = useFetch<any>(`/banking/transactions${query}`);
  useLive(["balance"], reload);
  const set = (k: string, v: string) => { setF(s => ({ ...s, [k]: v })); setPage(1); };

  const exportCsv = async () => {
    setBusy(true);
    try {
      const blob: Blob = await api(`/banking/transactions/export${qs({ ...f, q })}`, { raw: true });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `CertiFlow-statement-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) { toast({ tone: "error", title: "Export failed", text: e.message }); } finally { setBusy(false); }
  };
  const clear = () => { setF({ type: "all", status: "ALL", category: "ALL", q: "", from: "", to: "", min: "", max: "" }); setPage(1); };
  const active = Object.entries(f).some(([k, v]) => v && v !== "ALL" && !(k === "type" && v === "all"));

  return (
    <main className="page">
      <PageHead title="Transactions" sub="Search, filter and download your statement." actions={<button className="btn" onClick={exportCsv} disabled={busy}><Icon name="download" size={16} />Download CSV</button>} />
      <Card>
        <div className="filters">
          <Seg value={f.type} onChange={v => set("type", v)} options={[{ value: "all", label: "All" }, { value: "debit", label: "Money out" }, { value: "credit", label: "Money in" }]} />
          <Field label="Search"><input className="input" placeholder="Name, reference, remarks" value={f.q} onChange={e => set("q", e.target.value)} /></Field>
          <Field label="Status"><select className="select" value={f.status} onChange={e => set("status", e.target.value)}><option value="ALL">All</option>{["COMPLETED", "HELD", "BLOCKED", "FAILED", "CANCELLED"].map(s => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</select></Field>
          <Field label="Category"><select className="select" value={f.category} onChange={e => set("category", e.target.value)}><option value="ALL">All</option>{Object.keys(CATEGORY_COLORS).map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="From"><input className="input" type="date" value={f.from} onChange={e => set("from", e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={f.to} onChange={e => set("to", e.target.value)} /></Field>
          <Field label="Min ₹"><input className="input" inputMode="decimal" style={{ width: 100 }} value={f.min} onChange={e => set("min", e.target.value)} /></Field>
          <Field label="Max ₹"><input className="input" inputMode="decimal" style={{ width: 100 }} value={f.max} onChange={e => set("max", e.target.value)} /></Field>
          {active && <button className="btn ghost sm" onClick={clear}>Clear filters</button>}
        </div>
        {error ? <ErrorBox message={error} retry={reload} /> : loading && !data ? <Skeleton h={300} /> : data?.items.length === 0 ? <Empty icon="receipt" title="No matching transactions" text={active ? "Try changing or clearing your filters." : "Your payments will appear here."} /> :
          <>{data?.items.map((t: any) => <TxnRow key={t.id} t={t} onClick={() => setOpen(t.id)} />)}<Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total} onPage={setPage} label="transactions" /></>}
      </Card>
      {open !== null && <TxnDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </main>
  );
}
