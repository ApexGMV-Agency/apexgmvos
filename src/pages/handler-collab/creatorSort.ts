/* ════════════════════════════════════════════════════════════════════
   Creator ordering for the handler workspace — the brand drilldown and
   the Creators tab.

   The GROUPS these lists show are not affected by any of this: the
   drilldown still groups by payment status, the Creators tab still blocks
   by month. Both call the comparator as a SECONDARY key, so a pick here
   only orders creators inside the group they already belong to. Sorting
   across groups would shatter them (the Creators tab builds its month
   blocks from consecutive rows).

   Pure module, no React — so it can be unit-checked directly.
   ════════════════════════════════════════════════════════════════════ */

export interface SortableCreator {
  name?: string | null;
  amount?: number | string | null;
  created_at?: string | null;
  onboarded_on?: string | null;
  video_codes?: unknown;
}

export const CREATOR_SORTS = [
  { value: 'added', label: 'Added (oldest first)' },
  { value: 'added_desc', label: 'Recently added' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'deal_desc', label: 'Deal (high to low)' },
  { value: 'videos_desc', label: 'Videos delivered' },
  // what both lists did before a sort control existed — kept so nobody loses it
  { value: 'onboarded_desc', label: 'Onboarded (newest)' },
] as const;

export type CreatorSort = typeof CREATOR_SORTS[number]['value'];

/* The order the handler entered them: the one order that never reshuffles
   under you as statuses, deals and video counts change. */
export const CREATOR_SORT_DEFAULT: CreatorSort = 'added';

export const isCreatorSort = (v: unknown): v is CreatorSort =>
  CREATOR_SORTS.some(s => s.value === v);

const txt = (v: unknown) => String(v ?? '');
const deliveredVideos = (c: SortableCreator) =>
  (Array.isArray(c?.video_codes) ? c.video_codes : [])
    // extra videos (outside the deal) never count as delivered
    .filter((v: any) => !v?.extra && String(v?.video || '').trim()).length;

/**
 * Comparator for one sort choice. Every branch ends in the same tiebreak
 * (added, then name) so equal keys never reorder between renders — a list
 * that reshuffles itself on each autosave reads as a bug.
 */
export function creatorSortCmp(sort: CreatorSort | string) {
  const tie = (a: SortableCreator, b: SortableCreator) =>
    txt(a.created_at).localeCompare(txt(b.created_at)) || txt(a.name).localeCompare(txt(b.name));
  switch (sort) {
    case 'added_desc':
      return (a: SortableCreator, b: SortableCreator) =>
        txt(b.created_at).localeCompare(txt(a.created_at)) || tie(a, b);
    case 'name':
      return (a: SortableCreator, b: SortableCreator) =>
        txt(a.name).localeCompare(txt(b.name)) || tie(a, b);
    case 'deal_desc':
      return (a: SortableCreator, b: SortableCreator) =>
        (Number(b.amount) || 0) - (Number(a.amount) || 0) || tie(a, b);
    case 'videos_desc':
      return (a: SortableCreator, b: SortableCreator) =>
        deliveredVideos(b) - deliveredVideos(a) || tie(a, b);
    case 'onboarded_desc':
      // the pre-sort-control behaviour of both lists
      return (a: SortableCreator, b: SortableCreator) =>
        txt(b.onboarded_on).localeCompare(txt(a.onboarded_on))
        || txt(b.created_at).localeCompare(txt(a.created_at))
        || txt(a.name).localeCompare(txt(b.name));
    case 'added':
    default:
      return tie;
  }
}
