import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import Icon, { Logo } from "./Icon";
import { Field, Modal, Notice, Switch } from "./ui";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { api, connectStream, currentDevice, getSim, newDeviceId, realDeviceId, setSim } from "../lib/api";
import { CITIES, initials, titleCase } from "../lib/format";
import { emitLive, useLive } from "../lib/live";

export interface NavItem { to: string; label: string; icon: string; end?: boolean; group?: string; badge?: "alerts" | "notifications" | "applications" }

function ThemeButton() {
  const { resolved, toggle, choice } = useTheme();
  return (
    <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`} title={`Theme: ${choice}`}>
      <Icon name={resolved === "dark" ? "sun" : "moon"} />
    </button>
  );
}

function useOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [onOut]);
  return ref;
}

/** Simulation controls: pretend to be on another device / in another city to see the fraud engine react. */
function SimLab() {
  const [open, setOpen] = useState(false);
  const [sim, setLocal] = useState(getSim());
  const ref = useOutside(useCallback(() => setOpen(false), []));
  const { me } = useAuth();
  useEffect(() => { const fn = () => setLocal(getSim()); window.addEventListener("cf-sim", fn); return () => window.removeEventListener("cf-sim", fn); }, []);
  const usualDevice = sim.device === null;
  const home = me?.customer?.city || "Chennai";
  const changed = !usualDevice || (sim.location !== null && sim.location !== home);
  return (
    <div className="rel" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(o => !o)} aria-label="Simulation lab" title="Simulation lab"><Icon name="flask" />{changed && <span className="dot">!</span>}</button>
      {open && (
        <div className="menu" style={{ width: 330, padding: 16 }}>
          <div className="row"><Icon name="flask" /><strong>Simulation lab</strong></div>
          <p className="small muted" style={{ margin: "6px 0 12px" }}>Real banking apps detect your device and location automatically. Here you can change them to watch the fraud engine react.</p>
          <div className="col">
            <div className="field"><label>Device</label>
              <div className="row between small"><span className="mono">{usualDevice ? realDeviceId() : currentDevice()}</span><Badge2 on={usualDevice} /></div>
              <div className="row"><button className="btn sm" onClick={() => setSim({ device: newDeviceId() })}>Use a brand-new device</button>{!usualDevice && <button className="btn sm ghost" onClick={() => setSim({ device: null })}>Back to usual</button>}</div>
            </div>
            <div className="field"><label>Location</label>
              <select className="select" value={sim.location ?? home} onChange={e => setSim({ location: e.target.value === home ? null : e.target.value })}>
                {[home, ...CITIES.filter(c => c !== home)].map(c => <option key={c} value={c}>{c}{c === home ? " (home)" : ""}</option>)}
              </select>
            </div>
            <label className="row" style={{ justifyContent: "space-between" }}><span><strong className="small">Show fraud-engine insights</strong><br /><span className="tiny muted">Risk score and reasons on receipts</span></span>
              <Switch checked={sim.insights} onChange={v => setSim({ insights: v })} /></label>
          </div>
        </div>
      )}
    </div>
  );
}
const Badge2 = ({ on }: { on: boolean }) => <span className={`badge ${on ? "ok" : "warn"}`}>{on ? "Recognised" : "New device"}</span>;

/** Staff created with a temporary password must choose their own before doing anything else. */
function ForcePasswordChange() {
  const { refresh, logout } = useAuth();
  const [f, setF] = useState({ current_password: "", new_password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await api("/auth/password", { body: f }); await refresh(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Choose a new password" sub="Your administrator gave you a temporary password. Set your own to continue." onClose={() => undefined}
      actions={<><button className="btn" onClick={() => void logout()}>Sign out</button><button className="btn primary" disabled={busy || !f.current_password || f.new_password.length < 8} onClick={submit}>{busy ? <span className="spinner" /> : "Update password"}</button></>}>
      {err && <Notice tone="bad">{err}</Notice>}
      <Field label="Temporary password"><input className="input" type="password" autoComplete="current-password" value={f.current_password} onChange={e => setF({ ...f, current_password: e.target.value })} /></Field>
      <Field label="New password" hint="8+ characters with letters and numbers"><input className="input" type="password" autoComplete="new-password" value={f.new_password} onChange={e => setF({ ...f, new_password: e.target.value })} /></Field>
    </Modal>
  );
}

export default function Shell({ nav, area }: { nav: NavItem[]; area: "customer" | "staff" | "admin" }) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [counts, setCounts] = useState<{ alerts: number; notifications: number; applications: number }>({ alerts: 0, notifications: 0, applications: 0 });
  const menuRef = useOutside(useCallback(() => setMenu(false), []));
  const isStaff = area !== "customer";

  const loadCounts = useCallback(async () => {
    try {
      if (isStaff) {
        const [s, n, a] = await Promise.all([
          api("/staff/alerts/stats"), api("/staff/notifications?limit=1"),
          area === "admin" ? api("/admin/customers?status=PENDING&limit=1") : Promise.resolve({ total: 0 })
        ]);
        setCounts({ alerts: s.new + s.in_review, notifications: n.unread, applications: a.total });
      } else {
        const n = await api("/banking/notifications?limit=1");
        setCounts(c => ({ ...c, notifications: n.unread }));
      }
    } catch { /* counts are cosmetic */ }
  }, [isStaff, area]);

  useEffect(() => { void loadCounts(); }, [loadCounts, loc.pathname]);
  useLive(["notification", "alert.created", "alert.updated", "balance"], loadCounts);
  useEffect(() => {
    const stop = connectStream((type, data) => {
      emitLive(type, data);
      if (type === "notification") toast({ tone: data.severity === "CRITICAL" ? "error" : data.severity === "WARNING" ? "warning" : "info", title: data.title, text: data.message });
      if (type === "alert.created") toast({ tone: "warning", title: "New fraud alert", text: `Severity ${data.severity}` });
    });
    return stop;
  }, [toast]);
  useEffect(() => setOpen(false), [loc.pathname]);

  const home = area === "customer" ? "/app" : area === "staff" ? "/staff" : "/admin";
  const groups = Array.from(new Set(nav.map(n => n.group || "")));
  const bellTo = area === "customer" ? "/app/notifications" : null;

  return (
    <div className="app">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand"><Logo /><div>CertiFlow<small>{area === "customer" ? "Digital bank" : area === "staff" ? "Fraud operations" : "Administration"}</small></div></div>
        <nav aria-label="Main">
          {groups.map(g => (
            <div key={g}>
              {g && <div className="nav-group">{g}</div>}
              {nav.filter(n => (n.group || "") === g).map(n => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
                  <Icon name={n.icon} size={18} />{n.label}
                  {n.badge && counts[n.badge] > 0 && <span className="count">{counts[n.badge] > 99 ? "99+" : counts[n.badge]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot"><Icon name="shield" size={14} /> Protected by CertiFlow Guard<br />Real-time ML + rules monitoring</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <button className="btn ghost sm hide-sm" onClick={() => navigate(home)} style={{ fontWeight: 700 }}>{area === "customer" ? "My banking" : area === "staff" ? "Fraud analyst workspace" : "Admin console"}</button>
          <div className="grow" />
          {area === "customer" && <SimLab />}
          <ThemeButton />
          <button className="icon-btn" aria-label="Notifications" onClick={() => navigate(bellTo || (area === "admin" ? "/admin/alerts" : "/staff"))}>
            <Icon name="bell" />{counts.notifications > 0 && <span className="dot">{counts.notifications > 9 ? "9+" : counts.notifications}</span>}
          </button>
          <div className="rel" ref={menuRef}>
            <button className="user-chip" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu}>
              <span className="avatar">{initials(me?.user?.name || "?")}</span>
              <span className="hide-sm" style={{ textAlign: "left", lineHeight: 1.2 }}><strong className="small">{me?.user?.name}</strong><br /><span className="tiny muted">{titleCase(me?.user?.role || "")}</span></span>
              <Icon name="down" size={14} />
            </button>
            {menu && (
              <div className="menu" role="menu">
                <div style={{ padding: "8px 11px" }}><strong>{me?.user?.name}</strong><div className="small muted">{me?.user?.email}</div></div><hr />
                {area === "customer" && <button className="item" onClick={() => { setMenu(false); navigate("/app/profile"); }}><Icon name="user" size={16} />Profile & security</button>}
                <button className="item" onClick={async () => { await logout(); navigate("/login"); }}><Icon name="logout" size={16} />Sign out</button>
              </div>
            )}
          </div>
        </header>
        <Outlet />
      </div>
      {me?.user?.must_change_password && <ForcePasswordChange />}
    </div>
  );
}

export function PageShell({ children }: { children: ReactNode }) { return <main className="page">{children}</main>; }
export { Notice };
