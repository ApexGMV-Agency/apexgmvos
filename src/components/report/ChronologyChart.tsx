import { useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Dot,
} from 'recharts';
import { formatValue, FieldFormat } from '../../lib/reportSchemaV2';

export interface ChronoPoint {
  label: string;
  samples: number | null;
  videos: number | null;
  lives: number | null;
  total_gmv: number | null;
  orders: number | null;
  aov: number | null;
}

const METRICS: { key: keyof ChronoPoint; label: string; format: FieldFormat; color: string }[] = [
  { key: 'total_gmv', label: 'Total GMV', format: 'currency', color: '#e8862e' },
  { key: 'orders', label: 'Orders', format: 'number', color: '#0d6efd' },
  { key: 'aov', label: 'AOV', format: 'currency', color: '#198754' },
  { key: 'samples', label: 'Samples', format: 'number', color: '#8b5cf6' },
  { key: 'videos', label: 'Videos', format: 'number', color: '#06b6d4' },
  { key: 'lives', label: 'LIVEs', format: 'number', color: '#f59e0b' },
];

function fmtPct(p: number) {
  const a = Math.abs(p);
  const body = a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : a.toFixed(a < 10 ? 1 : 0);
  return p < 0 ? `-${body}` : body;
}

export default function ChronologyChart({ data }: { data: ChronoPoint[] }) {
  const [metricKey, setMetricKey] = useState<keyof ChronoPoint>('total_gmv');
  const metric = METRICS.find(m => m.key === metricKey)!;

  // Only weeks that have a value for the selected metric.
  const series = data
    .map(d => ({ label: d.label, value: d[metricKey] as number | null }))
    .filter(d => d.value != null) as { label: string; value: number }[];

  const hasData = series.length > 0;
  const last = series[series.length - 1]?.value ?? null;
  const prev = series.length > 1 ? series[series.length - 2].value : null;
  const wow = (last != null && prev != null && prev !== 0) ? ((last - prev) / Math.abs(prev)) * 100 : null;
  const up = wow != null && wow >= 0;

  const gid = `chrono-grad-${metric.key}`;

  return (
    <div>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex flex-wrap gap-1">
          {METRICS.map(m => {
            const active = m.key === metricKey;
            return (
              <button key={m.key} type="button" className="chrono-chip"
                onClick={() => setMetricKey(m.key)}
                style={active
                  ? { background: m.color, color: '#fff', borderColor: m.color }
                  : { color: m.color, borderColor: '#e5e7eb' }}>
                {m.label}
              </button>
            );
          })}
        </div>
        {wow != null && (
          <span className={`chrono-wow ${up ? 'is-up' : 'is-down'}`} title={`${wow >= 0 ? '+' : ''}${wow.toFixed(1)}% vs last week`}>
            <i className={`bi ${up ? 'bi-arrow-up-right' : 'bi-arrow-down-right'}`} />
            {wow >= 0 ? '+' : ''}{fmtPct(wow)}% <span className="text-muted fw-normal ms-1">vs last week</span>
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="text-muted text-center py-5 small">No data yet for {metric.label}. Fill §1 / §3 to populate this timeline.</div>
      ) : (
        <div style={{ height: 300 }}>
          <ResponsiveContainer>
            <AreaChart data={series} margin={{ top: 10, right: 16, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={metric.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={metric.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#8a93a6' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
              <YAxis
                tick={{ fontSize: 12, fill: '#8a93a6' }} tickLine={false} axisLine={false} width={64}
                tickFormatter={(v: number) => formatValue(metric.format, v, { compact: true })}
              />
              <Tooltip
                formatter={(v: any) => [formatValue(metric.format, Number(v)), metric.label]}
                contentStyle={{ borderRadius: 10, border: '1px solid #eef0f4', boxShadow: '0 6px 18px rgba(16,24,40,.08)' }}
              />
              <Area
                type="monotone" dataKey="value" stroke={metric.color} strokeWidth={3}
                fill={`url(#${gid})`}
                dot={(props: any) => {
                  const isLast = props.index === series.length - 1;
                  return <Dot key={props.index} cx={props.cx} cy={props.cy} r={isLast ? 6 : 4}
                    fill={isLast ? metric.color : '#fff'} stroke={metric.color} strokeWidth={2} />;
                }}
                activeDot={{ r: 6 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
