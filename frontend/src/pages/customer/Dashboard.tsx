import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Icon from "../../components/Icon";
import { BarChart, HBars, HourHeat } from "../../components/charts";
import { TxnDrawer, TxnRow } from "../../components/payment";
import { Card, CopyButton, Empty, ErrorBox, Kpi, Notice, PageHead, Seg, Skeleton } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useFetch } from "../../lib/hooks";
import { useLive } from "../../lib/live";
import { hourLabel, inr, monthLabel, num, pct, shortDate } from "../../lib/format";

export default function Dashboard() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState(30);
  const [reveal, setReveal] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const dash = useFetch<any>(`/banking/dashboard?range=${range}`, []);
  const recent = useFetch<any>("/banking/transactions?limit=6");
  const reload = () => { void dash.reload(); void recent.reload(); };
  useLive(["balance", "notification"], reload);

  const acct = me?.account;
  const d = dash.data;
  const first = me?.user?.name?.split(" ")[0] || "";
  const hour = new Date().getHours();

  return (
    <main className="page">
      <PageHead
        title={`Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${first}`}
        sub="Here’s your money at a glance."
        actions={
          <Seg
            value={range}
            onChange={setRange}
            options={[
              { value: 7, label: "7 days" },
              { value: 30, label: "30 days" },
              { value: 90, label: "90 days" },
            ]}
          />
        }
      />

      {!me?.user?.pin_set && (
        <div className="mb">
          <Notice tone="warn">
            Set your transaction PIN to start sending money.{" "}
            <Link to="/app/profile">Set PIN now →</Link>
          </Notice>
        </div>
      )}

      {acct?.status === "BLOCKED" && (
        <div className="mb">
          <Notice tone="bad">
            Your account is blocked for payments. Please contact CertiFlow support.
          </Notice>
        </div>
      )}

      <div className="grid g-2-1">
        <section className="card balance-card">
          <div className="row between wrap">
            <div>
              <div className="small muted">
                {acct?.account_type === "CURRENT" ? "Current" : "Savings"} account · {acct?.bank}
              </div>
              <div className="amount" style={{ marginTop: 6 }}>
                {inr(d?.balance ?? acct?.balance)}
              </div>
              {d?.pending_count > 0 && (
                <div className="small" style={{ marginTop: 4 }}>
                  {inr(d.pending_amount)} on hold for review ({d.pending_count})
                </div>
              )}
            </div>

            <div style={{ textAlign: "right" }}>
              <div className="small muted">Account number</div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <span
                  className="mono"
                  style={{ fontSize: "1.05rem", letterSpacing: ".05em" }}
                >
                  {reveal ? acct?.account_number : acct?.masked_account_number}
                </span>
                <button
                  className="btn sm"
                  onClick={() => setReveal((r) => !r)}
                  aria-label="Show or hide account number"
                >
                  <Icon name="eye" size={14} />
                </button>
                {reveal && acct && <CopyButton text={acct.account_number} />}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                IFSC {acct?.ifsc}
              </div>
            </div>
          </div>

          <div className="row wrap" style={{ marginTop: 22 }}>
            <button className="btn solid" onClick={() => navigate("/app/send")}>
              <Icon name="send" size={16} />
              Send money
            </button>
            <button className="btn" onClick={() => navigate("/app/pay")}>
              <Icon name="store" size={16} />
              Pay bills
            </button>
            <button className="btn" onClick={() => navigate("/app/payees")}>
              <Icon name="users" size={16} />
              Payees
            </button>
          </div>
        </section>

        <Card title="Insights">
          {!d ? (
            <Skeleton h={120} />
          ) : d.insights.length === 0 ? (
            <p className="muted small">Insights appear after a few transactions.</p>
          ) : (
            <div className="col gap-sm">
              {d.insights.slice(0, 4).map((i: any, k: number) => (
                <div key={k} className="row top small">
                  <span
                    style={{
                      color:
                        i.tone === "good"
                          ? "var(--ok)"
                          : i.tone === "warn"
                            ? "var(--warn)"
                            : "var(--brand)",
                      marginTop: 2,
                    }}
                  >
                    <Icon
                      name={
                        i.tone === "good"
                          ? "trend"
                          : i.tone === "warn"
                            ? "alert"
                            : "info"
                      }
                      size={16}
                    />
                  </span>
                  <span>{i.text}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {dash.error && (
        <div className="mt">
          <ErrorBox message={dash.error} retry={dash.reload} />
        </div>
      )}

      <div className="grid g4 mt">
        <Kpi
          icon="download"
          label="Money in"
          value={d ? inr(d.summary.income, { decimals: false }) : "…"}
          delta={d?.summary.income_change_pct}
          sub={`last ${range} days`}
          tone="pos"
        />
        <Kpi
          icon="send"
          label="Money out"
          value={d ? inr(d.summary.spending, { decimals: false }) : "…"}
          sub={
            d && d.summary.spending_change_pct !== null ? (
              <span className={d.summary.spending_change_pct > 0 ? "neg" : "pos"}>
                {d.summary.spending_change_pct > 0 ? "▲" : "▼"}{" "}
                {Math.abs(d.summary.spending_change_pct)}% vs previous
              </span>
            ) : (
              `last ${range} days`
            )
          }
        />
        <Kpi
          icon="trend"
          label="Net cash flow"
          value={d ? inr(d.summary.net, { decimals: false }) : "…"}
          tone={d && d.summary.net < 0 ? "neg" : "pos"}
          sub={
            d?.summary.savings_rate !== null && d
              ? `Savings rate ${pct(d.summary.savings_rate, 0)}`
              : undefined
          }
        />
        <Kpi
          icon="receipt"
          label="Payments"
          value={d ? num(d.summary.transactions) : "…"}
          sub={d ? `Avg ${inr(d.summary.average_payment, { decimals: false })}` : undefined}
        />
      </div>

      <div className="mt">
        <Card title="Income vs Spending · 6 months">
          {!d ? (
            <Skeleton h={240} />
          ) : (
            <BarChart
              height={260}
              data={d.monthly}
              xLabel={(x: any) => monthLabel(x.month)}
              tipFormat={(n: number) => inr(n, { decimals: false })}
              series={[
                { key: "income", label: "Income", color: "#22c55e" },
                { key: "spending", label: "Spending", color: "#ef4444" },
              ]}
            />
          )}
        </Card>
      </div>

      <div className="grid g-3 mt">
        <Card title="Top payees">
          {!d ? (
            <Skeleton h={200} />
          ) : d.top_payees.length === 0 ? (
            <p className="muted small">No payments yet.</p>
          ) : (
            <HBars
              items={d.top_payees.map((p: any) => ({
                label: p.name,
                value: p.amount,
                right: inr(p.amount, { compact: true }),
              }))}
            />
          )}

          {d && d.modes.length > 0 && (
            <>
              <hr className="divider" />
              <div className="small muted" style={{ marginBottom: 4 }}>
                By payment mode
              </div>
              <HBars
                items={d.modes.map((m: any) => ({
                  label: m.mode,
                  value: m.amount,
                  color: "var(--brand-2)",
                  right: `${m.count} · ${inr(m.amount, { compact: true })}`,
                }))}
              />
            </>
          )}
        </Card>

        <Card
          title="Security & behaviour profile"
          action={<span className="badge ok">Guard on</span>}
        >
          {!d ? (
            <Skeleton h={200} />
          ) : (
            <div className="col">
              <div className="small muted">Your usual activity hours</div>
              <HourHeat hours={d.hours} />
              <dl className="kv" style={{ gridTemplateColumns: "120px 1fr" }}>
                <dt>Usual hours</dt>
                <dd>
                  {d.security.usual_hours.length
                    ? d.security.usual_hours.map(hourLabel).join(", ")
                    : "—"}
                </dd>
                <dt>Trusted devices</dt>
                <dd>{d.security.known_devices}</dd>
                <dt>Known places</dt>
                <dd>
                  {d.security.known_locations.length
                    ? d.security.known_locations.join(", ")
                    : "—"}
                </dd>
                <dt>Typical payment</dt>
                <dd>{inr(d.security.typical_payment, { decimals: false })}</dd>
                <dt>Flagged</dt>
                <dd>
                  {d.security.flagged_in_period} in {range} days
                </dd>
              </dl>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Recent transactions"
        className="mt"
        action={
          <Link to="/app/transactions" className="small">
            View all →
          </Link>
        }
      >
        {recent.loading ? (
          <Skeleton h={160} />
        ) : recent.data?.items.length ? (
          recent.data.items.map((t: any) => (
            <TxnRow key={t.id} t={t} onClick={() => setOpen(t.id)} />
          ))
        ) : (
          <Empty
            icon="receipt"
            title="No transactions yet"
            text="Make your first payment to see it here."
          />
        )}
      </Card>

      {open !== null && (
        <TxnDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />
      )}
    </main>
  );
}