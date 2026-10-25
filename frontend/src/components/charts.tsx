import { useState } from "react";

const W = 640;
const nice = (max: number) => {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};
const compact = (n: number) => (n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(Math.round(n)));

export interface SeriesDef { key: string; label: string; color: string; area?: boolean }

/** Multi-series line / area chart with hover tooltip. */
export function LineAreaChart({ data, series, height = 220, xLabel, format = compact, tipFormat }: {
  data: Record<string, any>[]; series: SeriesDef[]; height?: number; xLabel: (d: any) => string; format?: (n: number) => string; tipFormat?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const L = 44, R = 10, T = 10, B = 24, w = W - L - R, h = height - T - B;
  const max = nice(Math.max(1, ...data.flatMap(d => series.map(s => Number(d[s.key]) || 0))));
  const x = (i: number) => L + (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v: number) => T + h - (v / max) * h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * max);
  const step = Math.max(1, Math.ceil(data.length / 7));
  const path = (key: string) => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(d[key]) || 0).toFixed(1)}`).join("");
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => <g key={i}><line className="grid-line" x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text x={L - 6} y={y(t) + 3} textAnchor="end">{format(t)}</text></g>)}
        {series.map(s => (
          <g key={s.key}>
            {s.area && data.length > 1 && <path d={`${path(s.key)}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={s.color} opacity=".14" />}
            <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {data.map((d, i) => i % step === 0 && <text key={i} x={x(i)} y={height - 6} textAnchor="middle">{xLabel(d)}</text>)}
        {hover !== null && data[hover] && (
          <g className="chart-tip">
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + h} stroke="var(--border-strong)" />
            {series.map(s => <circle key={s.key} cx={x(hover)} cy={y(Number(data[hover][s.key]) || 0)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />)}
          </g>
        )}
        {data.map((_, i) => <rect key={i} x={x(i) - w / data.length / 2} y={T} width={Math.max(8, w / data.length)} height={h} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
      </svg>
      <div className="row between wrap small" style={{ minHeight: 22 }}>
        <div className="legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
        {hover !== null && data[hover] && <div className="muted"><strong>{xLabel(data[hover])}</strong>{series.map(s => <span key={s.key}> · {s.label} {(tipFormat || format)(Number(data[hover][s.key]) || 0)}</span>)}</div>}
      </div>
    </div>
  );
}

/** Grouped (or stacked) bar chart. */
export function BarChart({ data, series, height = 220, xLabel, format = compact, stacked, tipFormat }: {
  data: Record<string, any>[]; series: SeriesDef[]; height?: number; xLabel: (d: any) => string; format?: (n: number) => string; stacked?: boolean; tipFormat?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const L = 44, R = 10, T = 10, B = 24, w = W - L - R, h = height - T - B;
  const totals = data.map(d => (stacked ? series.reduce((s, k) => s + (Number(d[k.key]) || 0), 0) : Math.max(...series.map(k => Number(d[k.key]) || 0))));
  const max = nice(Math.max(1, ...totals));
  const slot = w / Math.max(1, data.length);
  const bw = Math.min(34, (slot * 0.72) / (stacked ? 1 : series.length));
  const y = (v: number) => T + h - (v / max) * h;
  const step = Math.max(1, Math.ceil(data.length / 10));
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => <g key={i}><line className="grid-line" x1={L} x2={W - R} y1={y(t * max)} y2={y(t * max)} /><text x={L - 6} y={y(t * max) + 3} textAnchor="end">{format(t * max)}</text></g>)}
        {data.map((d, i) => {
          const cx = L + slot * i + slot / 2;
          let acc = 0;
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.55} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={cx - slot / 2} y={T} width={slot} height={h} fill="transparent" />
              {series.map((s, k) => {
                const v = Number(d[s.key]) || 0;
                if (stacked) { const top = y(acc + v), base = y(acc); acc += v; return <rect key={s.key} x={cx - bw / 2} y={top} width={bw} height={Math.max(0, base - top)} fill={s.color} rx="3" />; }
                const bx = cx - (bw * series.length) / 2 + k * bw;
                return <rect key={s.key} x={bx + 1} y={y(v)} width={Math.max(2, bw - 2)} height={Math.max(0, y(0) - y(v))} fill={s.color} rx="3" />;
              })}
              {i % step === 0 && <text x={cx} y={height - 6} textAnchor="middle">{xLabel(d)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="row between wrap small" style={{ minHeight: 22 }}>
        <div className="legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
        {hover !== null && data[hover] && <div className="muted"><strong>{xLabel(data[hover])}</strong>{series.map(s => <span key={s.key}> · {s.label} {(tipFormat || format)(Number(data[hover][s.key]) || 0)}</span>)}</div>}
      </div>
    </div>
  );
}

export interface Slice { label: string; value: number; color: string }
export function Donut({ slices, size = 170, center, sub }: { slices: Slice[]; size?: number; center?: string; sub?: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 14, c = size / 2, circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" style={{ flex: "none" }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="20" />
      {total > 0 && slices.filter(s => s.value > 0).map((s, i) => {
        const len = (s.value / total) * circ;
        const el = <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth="20" strokeDasharray={`${Math.max(0, len - 1.5)} ${circ - len + 1.5}`} strokeDashoffset={-offset} transform={`rotate(-90 ${c} ${c})`} />;
        offset += len;
        return el;
      })}
      {center && <text x={c} y={c + (sub ? 0 : 6)} textAnchor="middle" style={{ fill: "var(--text)", fontSize: 19, fontWeight: 750 }}>{center}</text>}
      {sub && <text x={c} y={c + 18} textAnchor="middle" style={{ fontSize: 11 }}>{sub}</text>}
    </svg>
  );
}

export function HBars({ items, format = (n: number) => String(n), max }: { items: { label: string; value: number; color?: string; right?: string }[]; format?: (n: number) => string; max?: number }) {
  const m = max ?? Math.max(1, ...items.map(i => i.value));
  return (
    <div>{items.map(i => (
      <div className="bar-row" key={i.label}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.label}>{i.label}</span>
        <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, (i.value / m) * 100)}%`, background: i.color || "var(--brand)" }} /></div>
        <span className="right small muted">{i.right ?? format(i.value)}</span>
      </div>
    ))}</div>
  );
}

export function HourHeat({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  return (
    <div>
      <div className="heat">{hours.map((c, h) => <div key={h} title={`${h}:00 - ${c} payment(s)`} style={{ opacity: c === 0 ? 0.08 : 0.2 + 0.8 * (c / max) }} />)}</div>
      <div className="row between tiny faint mt" style={{ marginTop: 6 }}><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
    </div>
  );
}

/** Circular risk score 0-100. */
export function ScoreRing({ score, size = 96, label }: { score: number; size?: number; label?: string }) {
  const color = score >= 80 ? "var(--bad)" : score >= 60 ? "#ea580c" : score >= 30 ? "var(--warn)" : "var(--ok)";
  const r = size / 2 - 8, c = size / 2, circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Risk score ${score}`}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="9" />
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(Math.min(100, score) / 100) * circ} ${circ}`} transform={`rotate(-90 ${c} ${c})`} />
      <text x={c} y={c + 2} textAnchor="middle" style={{ fill: "var(--text)", fontSize: size * 0.3, fontWeight: 800 }}>{score}</text>
      <text x={c} y={c + size * 0.2} textAnchor="middle" style={{ fontSize: 10 }}>{label || "risk"}</text>
    </svg>
  );
}

/** Reliability diagram: predicted probability vs observed fraud rate. */
export function CalibrationChart({ points }: { points: { predicted: number; observed: number; count: number }[] }) {
  const S = 220, P = 30;
  const x = (v: number) => P + v * (S - P - 8), y = (v: number) => S - P - v * (S - P - 8);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="chart" style={{ maxWidth: 280 }} role="img" aria-label="Calibration curve">
      {[0, 0.5, 1].map(t => <g key={t}><line className="grid-line" x1={P} x2={S - 8} y1={y(t)} y2={y(t)} /><text x={P - 5} y={y(t) + 3} textAnchor="end">{t}</text><text x={x(t)} y={S - P + 14} textAnchor="middle">{t}</text></g>)}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--text-3)" strokeDasharray="4 4" />
      <path d={points.map((p, i) => `${i ? "L" : "M"}${x(p.predicted)},${y(p.observed)}`).join("")} fill="none" stroke="var(--brand)" strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={x(p.predicted)} cy={y(p.observed)} r="3.5" fill="var(--brand)"><title>{`predicted ${p.predicted.toFixed(2)} observed ${p.observed.toFixed(2)} (${p.count})`}</title></circle>)}
      <text x={S / 2} y={S - 2} textAnchor="middle">predicted probability</text>
    </svg>
  );
}
