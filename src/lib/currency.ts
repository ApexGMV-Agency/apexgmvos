// Report currency — a single source of truth for how money is rendered in
// reports. Brands each choose a currency (USD/EUR/GBP/…); a dashboard sets it
// once at the top of its render via setReportCurrency(brand.currency), and every
// money formatter (reportSchemaV3/v2 formatValue, the classic + monthly inline
// helpers) reads it through formatMoney(). Set it during render, NOT in an
// effect — an effect runs after children render, so the first paint would use a
// stale currency. Only one report renders at a time, so a module global is safe.

let _code = 'USD';

export function setReportCurrency(code?: string | null): void {
  _code = (code || 'USD').toUpperCase();
}
export function getReportCurrency(): string {
  return _code;
}

// Currencies offered on the brand page. Kept small and common; extend freely.
export const CURRENCIES: { code: string; label: string }[] = [
  { code: 'USD', label: 'USD — US Dollar ($)' },
  { code: 'EUR', label: 'EUR — Euro (€)' },
  { code: 'GBP', label: 'GBP — British Pound (£)' },
  { code: 'CAD', label: 'CAD — Canadian Dollar (C$)' },
  { code: 'AUD', label: 'AUD — Australian Dollar (A$)' },
  { code: 'AED', label: 'AED — UAE Dirham (د.إ)' },
  { code: 'SAR', label: 'SAR — Saudi Riyal (﷼)' },
  { code: 'PKR', label: 'PKR — Pakistani Rupee (₨)' },
  { code: 'INR', label: 'INR — Indian Rupee (₹)' },
  { code: 'JPY', label: 'JPY — Japanese Yen (¥)' },
];

/* ── Brand region ──
   A brand belongs to one of three regions; the region fixes the currency (and
   therefore the money symbol) shown for that brand EVERYWHERE in the app —
   reports, paid collab, share links, contracts. `brands.region` is the field
   the user picks; `brands.currency` is kept in sync (region → currency) so the
   existing report currency machinery keeps working unchanged. Default: US. */
export type Region = 'US' | 'UK' | 'EURO';

export const REGIONS: { value: Region; label: string; currency: string; symbol: string }[] = [
  { value: 'US',   label: 'US — US Dollar ($)',    currency: 'USD', symbol: '$' },
  { value: 'UK',   label: 'UK — British Pound (£)', currency: 'GBP', symbol: '£' },
  { value: 'EURO', label: 'EURO — Euro (€)',        currency: 'EUR', symbol: '€' },
];

const REGION_CURRENCY: Record<Region, string> = { US: 'USD', UK: 'GBP', EURO: 'EUR' };

/** Region → ISO currency code (defaults to USD for anything unknown). */
export function regionToCurrency(region?: string | null): string {
  const r = (region || 'US').toUpperCase();
  return REGION_CURRENCY[r as Region] ?? 'USD';
}

/** ISO currency code → region (GBP→UK, EUR→EURO, everything else → US). */
export function currencyToRegion(code?: string | null): Region {
  const c = (code || 'USD').toUpperCase();
  if (c === 'GBP') return 'UK';
  if (c === 'EUR') return 'EURO';
  return 'US';
}

/** The money symbol for a brand's region ($ / £ / €). */
export function regionSymbol(region?: string | null): string {
  return currencySymbol(regionToCurrency(region));
}

const _symCache: Record<string, string> = {};
export function currencySymbol(code?: string | null): string {
  code = (code || _code);
  if (_symCache[code]) return _symCache[code];
  try {
    // Pin the locale to en-US so symbols are stable regardless of the viewer's
    // locale — USD stays '$' (matching the app's prior hardcoded output).
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).formatToParts(0);
    return (_symCache[code] = parts.find(p => p.type === 'currency')?.value ?? `${code} `);
  } catch {
    return (_symCache[code] = `${code} `);
  }
}

// Format a number as money in the active report currency. Preserves the app's
// existing prefix layout + custom compact "k" behaviour so USD output is byte-
// identical to before (currencySymbol('USD') === '$').
export function formatMoney(n: number, opts?: { compact?: boolean; maximumFractionDigits?: number }): string {
  const sym = currencySymbol();
  const abs = Math.abs(n);
  if (opts?.compact && abs >= 10000) return `${sym}${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: opts?.maximumFractionDigits ?? 2 })}`;
}

// Whole-number money in the active currency — the paid-collab "$1,234" style
// (no decimals). Pass an explicit `code` for multi-brand rows; omit it to use the
// currency last set via setReportCurrency() (single-brand views set it at render).
export function fmtWhole(n: number, code?: string | null): string {
  return `${currencySymbol(code)}${Math.round(n || 0).toLocaleString()}`;
}
