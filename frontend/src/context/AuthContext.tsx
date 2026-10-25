import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, getToken, setHomeCity, setSessionExpiredHandler, setToken } from "../lib/api";

export interface Me { user: any; customer: any; account: any }
interface AuthCtx {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>({ me: null, loading: true, login: async () => { throw new Error("no provider"); }, logout: async () => {}, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(getToken()));

  const load = useCallback(async (): Promise<Me | null> => {
    if (!getToken()) { setMe(null); return null; }
    try {
      const data = await api<Me>("/auth/me");
      if (data.customer?.city) setHomeCity(data.customer.city);
      setMe(data);
      return data;
    } catch { setToken(null); setMe(null); return null; }
  }, []);

  useEffect(() => { void load().finally(() => setLoading(false)); }, [load]);
  useEffect(() => { setSessionExpiredHandler(() => setMe(null)); return () => setSessionExpiredHandler(null); }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string }>("/auth/login", { body: { email, password } });
    setToken(res.token);
    const data = await load();
    if (!data) throw new Error("Could not load your profile");
    return data;
  }, [load]);

  const logout = useCallback(async () => {
    try { await api("/auth/logout", { method: "POST", body: {} }); } catch { /* already gone */ }
    setToken(null);
    setMe(null);
  }, []);

  const value = useMemo(() => ({ me, loading, login, logout, refresh: async () => { await load(); } }), [me, loading, login, logout, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
