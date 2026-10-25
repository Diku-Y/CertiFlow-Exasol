import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../../components/Icon";
import { Notice } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";

/** Gate: customers can only bank once an administrator has approved their application. */
export default function CustomerGate({ children }: { children: ReactNode }) {
  const { me, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const status = me?.customer?.status;
  if (status === "ACTIVE") return <>{children}</>;
  const copy: Record<string, { title: string; body: ReactNode; tone: "info" | "warn" | "bad" }> = {
    PENDING: { title: "Your application is under review", tone: "info", body: <>Thanks for applying, {me?.user?.name?.split(" ")[0]}. Our team verifies every new account. You’ll get full access as soon as it’s approved — usually within one working day.</> },
    REJECTED: { title: "We couldn’t open your account", tone: "bad", body: <>Reason: {me?.customer?.rejection_reason || "not specified"}. Please contact CertiFlow support if you think this is a mistake.</> },
    SUSPENDED: { title: "Your profile is suspended", tone: "warn", body: <>For your protection, access to your account is paused. Please contact CertiFlow support.</> }
  };
  const c = copy[status || ""] || { title: "Account unavailable", tone: "warn" as const, body: "We could not load your customer profile." };
  return (
    <div className="auth-form" style={{ minHeight: "100%" }}>
      <div className="auth-card col gap-lg center" style={{ alignItems: "center" }}>
        <Logo size={52} /><h1>{c.title}</h1><Notice tone={c.tone}>{c.body}</Notice>
        <div className="row"><button className="btn" onClick={() => void refresh()}>Check status</button><button className="btn ghost" onClick={async () => { await logout(); navigate("/login"); }}>Sign out</button></div>
      </div>
    </div>
  );
}
