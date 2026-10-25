import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

type Tone = "success" | "error" | "info" | "warning";
interface Toast { id: number; tone: Tone; title: string; text?: string }
const Ctx = createContext<{ toast: (t: Omit<Toast, "id">) => void }>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = idRef.current++;
    setItems(prev => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setItems(prev => prev.filter(x => x.id !== id)), t.tone === "error" ? 7000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <strong>{t.title}</strong>
            {t.text && <span>{t.text}</span>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
