import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import Shell from "./components/Shell";
import type { NavItem } from "./components/Shell";
import { Loading } from "./components/ui";
import Login from "./pages/Login";
import CustomerGate from "./pages/customer/CustomerGate";
import Dashboard from "./pages/customer/Dashboard";
import Transactions from "./pages/customer/Transactions";
import SendMoney from "./pages/customer/SendMoney";
import PayBills from "./pages/customer/PayBills";
import Payees from "./pages/customer/Payees";
import Notifications from "./pages/customer/Notifications";
import Profile from "./pages/customer/Profile";
import Alerts from "./pages/staff/Alerts";
import AlertDetail from "./pages/staff/AlertDetail";
import TxnExplorer from "./pages/staff/TxnExplorer";
import Overview from "./pages/admin/Overview";
import Applications from "./pages/admin/Applications";
import Customers from "./pages/admin/Customers";
import StaffMgmt from "./pages/admin/StaffMgmt";
import Policy from "./pages/admin/Policy";
import MlOps from "./pages/admin/MlOps";
import SystemHealth from "./pages/admin/SystemHealth";
import Audit from "./pages/admin/Audit";

const customerNav: NavItem[] = [
  { to: "/app", label: "Overview", icon: "home", end: true },
  { to: "/app/transactions", label: "Transactions", icon: "receipt" },
  { to: "/app/send", label: "Send money", icon: "send", group: "Pay" },
  { to: "/app/pay", label: "Pay bills & shop", icon: "store", group: "Pay" },
  { to: "/app/payees", label: "Payees", icon: "users", group: "Pay" },
  { to: "/app/notifications", label: "Notifications", icon: "bell", badge: "notifications", group: "Account" },
  { to: "/app/profile", label: "Profile & security", icon: "shield", group: "Account" }
];
const staffNav: NavItem[] = [
  { to: "/staff", label: "Alert queue", icon: "alert", end: true, badge: "alerts" },
  { to: "/staff/transactions", label: "Transactions", icon: "list" }
];
const adminNav: NavItem[] = [
  { to: "/admin", label: "Overview", icon: "chart", end: true },
  { to: "/admin/applications", label: "Applications", icon: "file", badge: "applications", group: "Customers" },
  { to: "/admin/customers", label: "Customers", icon: "users", group: "Customers" },
  { to: "/admin/alerts", label: "Fraud alerts", icon: "alert", badge: "alerts", group: "Fraud" },
  { to: "/admin/transactions", label: "Transactions", icon: "list", group: "Fraud" },
  { to: "/admin/policy", label: "Rules & settings", icon: "cog", group: "Fraud" },
  { to: "/admin/ml", label: "ML operations", icon: "brain", group: "Platform" },
  { to: "/admin/system", label: "System health", icon: "server", group: "Platform" },
  { to: "/admin/staff", label: "Staff", icon: "user", group: "Platform" },
  { to: "/admin/audit", label: "Audit log", icon: "shield", group: "Platform" }
];

export const homeFor = (role?: string) => (role === "ADMIN" ? "/admin" : role === "FRAUD_ANALYST" ? "/staff" : "/app");

function Require({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Loading text="Loading CertiFlow…" />;
  if (!me) return <Navigate to="/login" replace />;
  if (!roles.includes(me.user.role)) return <Navigate to={homeFor(me.user.role)} replace />;
  return <>{children}</>;
}

function Root() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  return <Navigate to={me ? homeFor(me.user.role) : "/login"} replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Root />} />
              <Route path="/login" element={<Login />} />
              <Route path="/app" element={<Require roles={["USER"]}><CustomerGate><Shell nav={customerNav} area="customer" /></CustomerGate></Require>}>
                <Route index element={<Dashboard />} />
                <Route path="transactions" element={<Transactions />} />
                <Route path="send" element={<SendMoney />} />
                <Route path="pay" element={<PayBills />} />
                <Route path="payees" element={<Payees />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="profile" element={<Profile />} />
              </Route>
              <Route path="/staff" element={<Require roles={["FRAUD_ANALYST", "ADMIN"]}><Shell nav={staffNav} area="staff" /></Require>}>
                <Route index element={<Alerts base="/staff" />} />
                <Route path="alerts/:id" element={<AlertDetail base="/staff" />} />
                <Route path="transactions" element={<TxnExplorer />} />
              </Route>
              <Route path="/admin" element={<Require roles={["ADMIN"]}><Shell nav={adminNav} area="admin" /></Require>}>
                <Route index element={<Overview />} />
                <Route path="applications" element={<Applications />} />
                <Route path="customers" element={<Customers />} />
                <Route path="customers/:id" element={<Customers />} />
                <Route path="alerts" element={<Alerts base="/admin" />} />
                <Route path="alerts/:id" element={<AlertDetail base="/admin" />} />
                <Route path="transactions" element={<TxnExplorer />} />
                <Route path="policy" element={<Policy />} />
                <Route path="ml" element={<MlOps />} />
                <Route path="system" element={<SystemHealth />} />
                <Route path="staff" element={<StaffMgmt />} />
                <Route path="audit" element={<Audit />} />
              </Route>
              <Route path="*" element={<Root />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
