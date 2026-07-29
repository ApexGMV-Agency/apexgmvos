import { REGIONS, Region } from '../lib/currency';

/**
 * Small informational chip for a brand's region — a colored currency-symbol
 * badge ($ / £ / €) plus the region name (US / UK / EURO). Purely presentational
 * (not clickable); the per-region accent is driven by CSS via `data-region`.
 * `size="sm"` renders a tighter variant for dense cards.
 */
export default function RegionChip({ region, size, className }: {
  region?: string | null;
  size?: 'sm';
  className?: string;
}) {
  const value = (region as Region) || 'US';
  const meta = REGIONS.find(r => r.value === value) ?? REGIONS[0];
  return (
    <span
      className={`ac-region-chip${size === 'sm' ? ' ac-region-chip--sm' : ''}${className ? ` ${className}` : ''}`}
      data-region={meta.value}
      title={`Region: ${meta.value} · ${meta.currency} (${meta.symbol})`}
    >
      <span className="ac-region-sym" aria-hidden="true">{meta.symbol}</span>
      <span className="ac-region-name">{meta.value}</span>
    </span>
  );
}
