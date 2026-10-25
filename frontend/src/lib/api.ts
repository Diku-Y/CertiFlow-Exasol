export const API_URL: string = (import.meta as any).env?.VITE_API_URL || "http://localhost:5000/api";

export class ApiError extends Error {
  status: number;
  code: string;
  details: any;
  constructor(status: number, message: string, code = "ERROR", details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---- session + simulation state (sessionStorage = one login per browser tab) -------------------------
const TOKEN_KEY = "cf_token";
export const getToken = (): string | null => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY));

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Stable id for this browser - the "device" the bank recognises. */
export const realDeviceId = (): string => {
  let id = localStorage.getItem("cf_device");
  if (!id) { id = "dev-" + randomId(); localStorage.setItem("cf_device", id); }
  return id;
};

export interface Sim { device: string | null; location: string | null; insights: boolean }
export const getSim = (): Sim => {
  try { return { device: null, location: null, insights: false, ...JSON.parse(localStorage.getItem("cf_sim") || "{}") }; }
  catch { return { device: null, location: null, insights: false }; }
};
export const setSim = (patch: Partial<Sim>) => {
  localStorage.setItem("cf_sim", JSON.stringify({ ...getSim(), ...patch }));
  window.dispatchEvent(new Event("cf-sim"));
};
let homeCity = "Chennai";
export const setHomeCity = (c: string) => { homeCity = c || "Chennai"; };
export const currentDevice = () => getSim().device || realDeviceId();
export const currentLocation = () => getSim().location || homeCity;
export const newDeviceId = () => "dev-new-" + randomId();

const baseHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { "X-Device-Id": currentDevice(), "X-Client-Location": currentLocation() };
  const t = getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
};

let onSessionExpired: (() => void) | null = null;
export const setSessionExpiredHandler = (fn: (() => void) | null) => { onSessionExpired = fn; };

export const newIdempotencyKey = () => (crypto as any).randomUUID ? crypto.randomUUID() : randomId() + randomId();

export async function api<T = any>(path: string, opts: { method?: string; body?: any; idempotencyKey?: string; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = baseHeaders();
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, "Cannot reach CertiFlow servers. Check your connection and try again.", "NETWORK");
  }
  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, "Download failed", "DOWNLOAD");
    return (await res.blob()) as any;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.code === "SESSION_EXPIRED" && getToken()) { setToken(null); onSessionExpired?.(); }
    throw new ApiError(res.status, data.message || "Something went wrong", data.code, data.details);
  }
  return data as T;
}

export const qs = (params: Record<string, any>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== "ALL") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** Live events (Server-Sent Events over fetch so the Authorization header can be used). */
export function connectStream(onEvent: (type: string, data: any) => void): () => void {
  let stop = false;
  let controller: AbortController | null = null;
  const run = async () => {
    while (!stop) {
      try {
        controller = new AbortController();
        const res = await fetch(API_URL + "/stream", { headers: baseHeaders(), signal: controller.signal });
        if (res.status === 401) return;
        if (!res.ok || !res.body) throw new Error("stream failed");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let type = "message", data = "";
            for (const line of chunk.split("\n")) {
              if (line.startsWith("event:")) type = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (data) { try { onEvent(type, JSON.parse(data)); } catch { /* ignore */ } }
          }
        }
      } catch { /* reconnect below */ }
      if (!stop) await new Promise(r => setTimeout(r, 3000));
    }
  };
  void run();
  return () => { stop = true; controller?.abort(); };
}
