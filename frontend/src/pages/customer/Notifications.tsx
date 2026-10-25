import { useState } from "react";
import Icon from "../../components/Icon";
import { TxnDrawer } from "../../components/payment";
import { Badge, Card, Empty, ErrorBox, PageHead, Pager, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { ago } from "../../lib/format";
import { useFetch } from "../../lib/hooks";
import { useLive } from "../../lib/live";

const ICON: Record<string, string> = { DEBIT: "send", CREDIT: "download", SECURITY_CHECK: "shield", PAYMENT_HELD: "lock", PAYMENT_DECLINED: "alert", PAYMENT_RELEASED: "check", PAYMENT_CANCELLED: "x", ACCOUNT: "user", SECURITY_UPDATE: "shield", PAYMENT_FAILED: "alert" };
const COLOR: Record<string, string> = { INFO: "var(--brand)", WARNING: "var(--warn)", CRITICAL: "var(--bad)" };

export default function Notifications() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const { data, loading, error, reload } = useFetch<any>(`/banking/notifications?page=${page}&limit=15`, []);
  useLive(["notification"], reload);
  const markAll = async () => { await api("/banking/notifications/read", { body: {} }); void reload(); };

  return (
    <main className="page" style={{ maxWidth: 820 }}>
      <PageHead title="Notifications" sub={data?.unread ? `${data.unread} unread` : "You’re all caught up"} actions={data?.unread > 0 && <button className="btn" onClick={markAll}>Mark all as read</button>} />
      <Card>
        {error ? <ErrorBox message={error} retry={reload} /> : loading && !data ? <Skeleton h={260} /> : !data?.items.length ? <Empty icon="bell" title="No notifications" text="Alerts about your account and payments show up here." /> :
          <>{data.items.map((n: any) => (
            <div key={n.id} className="txn" style={{ cursor: n.transaction_id ? "pointer" : "default", background: n.is_read ? undefined : "color-mix(in srgb, var(--brand) 6%, transparent)" }}
              onClick={() => { if (n.transaction_id) setOpen(n.transaction_id); if (!n.is_read) void api("/banking/notifications/read", { body: { ids: [n.id] } }).then(reload); }}>
              <div className="txn-ico" style={{ background: COLOR[n.severity] || "var(--brand)" }}><Icon name={ICON[n.notification_type] || "bell"} size={18} /></div>
              <div className="grow"><div className="name row">{n.title}{!n.is_read && <span className="badge plain info">new</span>}{n.action_required && n.transaction_id && <Badge value="WARNING" label="Action needed" />}</div>
                <div className="small muted">{n.message}</div></div>
              <div className="small faint nowrap">{ago(n.created_at)}</div>
            </div>))}
            <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} label="notifications" /></>}
      </Card>
      {open !== null && <TxnDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </main>
  );
}
