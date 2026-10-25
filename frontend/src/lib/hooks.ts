import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Fetch on mount / when `deps` change. `reload()` refetches without flashing the loading state. */
export function useFetch<T = any>(path: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const seq = useRef(0);
  const run = useCallback(async (silent: boolean) => {
    if (path === null) return;
    const mine = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const res = await api<T>(path);
      if (mine === seq.current) { setData(res); setError(null); }
    } catch (e: any) {
      if (mine === seq.current) setError(e.message || "Failed to load");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void run(false); }, [run, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: () => run(true), setData };
}

export function useInterval(fn: () => void, ms: number | null) {
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; }, [fn]);
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}
