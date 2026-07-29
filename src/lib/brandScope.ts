// Brand scope metadata — the "what we do for this brand" tags. Shared by the
// Brands list (create/edit + card chips) and the Brand Detail header so the
// label + icon for each scope stay in one place.

export type ScopeKey = 'affiliate' | 'ads' | 'shop';

export const SCOPE_OPTIONS: { key: ScopeKey; label: string; icon: string }[] = [
  { key: 'affiliate',    label: 'Affiliates',      icon: 'bi-link-45deg' },
  { key: 'ads',          label: 'GMV Max',         icon: 'bi-graph-up-arrow' },
  { key: 'shop',         label: 'Shop Monitoring', icon: 'bi-shop' },
];

export const SCOPE_LABEL: Record<string, string> = Object.fromEntries(SCOPE_OPTIONS.map(o => [o.key, o.label]));
export const SCOPE_ICON:  Record<string, string> = Object.fromEntries(SCOPE_OPTIONS.map(o => [o.key, o.icon]));
