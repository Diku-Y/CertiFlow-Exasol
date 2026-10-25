import { useEffect, useRef } from "react";

/** Broadcast a live server event to any mounted page. */
export const emitLive = (type: string, data: any) => window.dispatchEvent(new CustomEvent("cf-live", { detail: { type, data } }));

/** Run `fn` whenever one of the given live event types arrives (debounced so bursts reload once). */
export function useLive(types: string[], fn: () => void) {
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; }, [fn]);
  useEffect(() => {
    let timer: any;
    const handler = (e: Event) => {
      const { type } = (e as CustomEvent).detail;
      if (types.includes(type)) { clearTimeout(timer); timer = setTimeout(() => saved.current(), 400); }
    };
    window.addEventListener("cf-live", handler);
    return () => { window.removeEventListener("cf-live", handler); clearTimeout(timer); };
  }, [types.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
}
