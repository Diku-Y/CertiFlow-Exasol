import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Icon, { Logo } from "../components/Icon";
import { Field, Notice } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { api } from "../lib/api";
import { CITIES } from "../lib/format";
import { homeFor } from "../App";

const DEMOS = [
  { label: "Customer", email: "aarav@certiflow.test", password: "Customer@123" },
  { label: "Fraud analyst", email: "analyst@certiflow.test", password: "Analyst@12345" },
  { label: "Admin", email: "admin@certiflow.test", password: "Admin@12345" }
];

export default function Login() {
  const { me, login } = useAuth();
  const { resolved, toggle } = useTheme();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    city: "Chennai",
    password: "",
    confirm: ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  if (me) return <Navigate to={homeFor(me.user.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);

    if (mode === "register" && form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }

    setBusy(true);

    try {
      if (mode === "login") {
        const data = await login(form.email.trim(), form.password);
        navigate(homeFor(data.user.role), { replace: true });
      } else {
        const res = await api("/auth/register", {
          body: {
            name: form.name,
            email: form.email,
            phone: form.phone,
            city: form.city,
            password: form.password
          }
        });

        setDone(res.message);
        setMode("login");
        setForm(f => ({ ...f, password: "", confirm: "" }));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="auth"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "72px 20px 32px",
        position: "relative"
      }}
    >
      <button
        className="icon-btn"
        style={{ position: "absolute", top: 18, right: 18 }}
        onClick={toggle}
        aria-label="Toggle theme"
        type="button"
      >
        <Icon name={resolved === "dark" ? "sun" : "moon"} />
      </button>

      <section
        style={{
          width: "100%",
          maxWidth: 440,
          margin: "auto"
        }}
      >
        <div
          className="row"
          style={{
            justifyContent: "center",
            gap: 12,
            marginBottom: 28
          }}
        >
          <Logo size={42} />
          <strong style={{ fontSize: "1.65rem", letterSpacing: "-.03em" }}>
            CertiFlow
          </strong>
        </div>

        <form
          className="auth-card col gap-lg"
          onSubmit={submit}
          noValidate
          style={{
            width: "100%",
            boxSizing: "border-box"
          }}
        >
          <div>
            <h1>
              {mode === "login" ? "Welcome back" : "Open your account"}
            </h1>
            <p className="muted mt" style={{ marginTop: 6 }}>
              {mode === "login"
                ? "Sign in to CertiFlow Bank"
                : "Create your account to get started."}
            </p>
          </div>

          {done && <Notice tone="ok">{done}</Notice>}
          {error && <Notice tone="bad">{error}</Notice>}

          {mode === "register" && (
            <Field label="Full name">
              <input
                className="input"
                value={form.name}
                onChange={set("name")}
                autoComplete="name"
                required
              />
            </Field>
          )}

          <Field label="Email">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={set("email")}
              autoComplete="email"
              required
            />
          </Field>

          {mode === "register" && (
            <div className="grid g2">
              <Field label="Mobile number">
                <input
                  className="input"
                  inputMode="numeric"
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder="98400 12345"
                  autoComplete="tel"
                />
              </Field>

              <Field label="City">
                <select
                  className="select"
                  value={form.city}
                  onChange={set("city")}
                >
                  {CITIES.map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <Field
            label="Password"
            hint={
              mode === "register"
                ? "At least 8 characters with letters and numbers"
                : undefined
            }
          >
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={set("password")}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
            />
          </Field>

          {mode === "register" && (
            <Field label="Confirm password">
              <input
                className="input"
                type="password"
                value={form.confirm}
                onChange={set("confirm")}
                autoComplete="new-password"
                required
              />
            </Field>
          )}

          <button
            className="btn primary lg block"
            disabled={busy}
            type="submit"
          >
            {busy ? (
              <span className="spinner" />
            ) : mode === "login" ? (
              "Sign in"
            ) : (
              "Submit application"
            )}
          </button>

          <p className="center small muted">
            {mode === "login"
              ? "New to CertiFlow?"
              : "Already have an account?"}{" "}
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
                setDone(null);
              }}
            >
              {mode === "login" ? "Open an account" : "Sign in"}
            </button>
          </p>

          {mode === "login" && (
            <div className="demo-box">
              <strong>Demo accounts</strong>{" "}
              <span className="faint">(after running the seed script)</span>

              <div
                className="row wrap"
                style={{ marginTop: 8, gap: 14 }}
              >
                {DEMOS.map(d => (
                  <button
                    type="button"
                    key={d.label}
                    onClick={() =>
                      setForm(f => ({
                        ...f,
                        email: d.email,
                        password: d.password
                      }))
                    }
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              <div className="tiny faint" style={{ marginTop: 6 }}>
                Customer transaction PIN: 482916
              </div>
            </div>
          )}
        </form>

        <p
          className="center tiny faint"
          style={{ marginTop: 20 }}
        >
          Secure banking. Smarter protection.
        </p>
      </section>
    </main>
  );
}