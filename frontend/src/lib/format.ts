export const inr = (n: number | null | undefined, opts: { decimals?: boolean; compact?: boolean } = {}): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (opts.compact) {
    const a = Math.abs(n);
    if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
    if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  }
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: opts.decimals === false ? 0 : 2, maximumFractionDigits: opts.decimals === false ? 0 : 2 });
};

export const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-IN"));
export const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "—" : `${n.toFixed(d)}%`);

export const dateTime = (d: string | Date | null | undefined): string =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }) : "—";
export const dateOnly = (d: string | Date | null | undefined): string =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const shortDate = (iso: string): string => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const monthLabel = (m: string): string => new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short" });

export const ago = (d: string | Date): string => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d ago`;
  return dateOnly(d);
};

export const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("");
export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

export const CITIES = ["Chennai", "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Kolkata", "Pune", "Ahmedabad", "Kochi", "Jaipur"];
export const CATEGORY_COLORS: Record<string, string> = {
  "Food & Dining": "#f97316", Groceries: "#22c55e", Shopping: "#a855f7", "Bills & Utilities": "#3b82f6", Travel: "#06b6d4",
  Entertainment: "#ec4899", Health: "#ef4444", Fuel: "#eab308", Education: "#6366f1", Transfers: "#14b8a6"
};
export const categoryColor = (c: string) => CATEGORY_COLORS[c] || "#94a3b8";
