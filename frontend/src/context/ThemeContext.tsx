import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemeChoice = "light" | "dark" | "system";
interface ThemeCtx { choice: ThemeChoice; resolved: "light" | "dark"; setChoice: (c: ThemeChoice) => void; toggle: () => void }
const Ctx = createContext<ThemeCtx>({ choice: "system", resolved: "light", setChoice: () => {}, toggle: () => {} });

const systemDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
const read = (): ThemeChoice => { try { return (localStorage.getItem("cf_theme") as ThemeChoice) || "system"; } catch { return "system"; } };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(read);
  const [sysDark, setSysDark] = useState<boolean>(systemDark);
  const resolved: "light" | "dark" = choice === "system" ? (sysDark ? "dark" : "light") : choice;

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const fn = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = resolved; }, [resolved]);

  const setChoice = useCallback((c: ThemeChoice) => { setChoiceState(c); try { localStorage.setItem("cf_theme", c); } catch { /* private mode */ } }, []);
  const toggle = useCallback(() => setChoice(resolved === "dark" ? "light" : "dark"), [resolved, setChoice]);
  const value = useMemo(() => ({ choice, resolved, setChoice, toggle }), [choice, resolved, setChoice, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
