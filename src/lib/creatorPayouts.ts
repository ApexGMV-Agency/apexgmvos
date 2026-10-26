/* ════════════════════════════════════════════════════════════
   A deal's payment methods.

   handler_collab_creators.payouts is [{label, value}] with ANY label — see
   migration 20260872090000. The `paypal` / `zelle` columns still exist as
   mirrors the DB trigger maintains, so every legacy reader keeps working;
   this module is what turns either shape into one list.

   ‼️ Pure — no React, no Supabase. Four surfaces render payouts (the handler
   workspace, the shared read-only rows, the client portal's Creators page and
   the public share link) and they must not each invent their own rule for
   what "PayPal" is called or which values are links.
════════════════════════════════════════════════════════════ */

export interface Payout { label: string; value: string; }

/* The two labels that still have a mirrored column behind them. Kept
   generous about spelling because the label is typed by hand. Mirrors SQL
   payout_label_kind() — keep the two in lockstep. */
export function payoutKindOf(label?: string | null): 'paypal' | 'zelle' | 'other' {
  switch (String(label || '').trim().toLowerCase()) {
    case 'paypal': case 'pay pal': case 'pp': return 'paypal';
    case 'zelle': case 'z': return 'zelle';
    default: return 'other';
  }
}

/* Every payment method on a deal, in the handler's own order.

   Falls back to the legacy pair when `payouts` is absent or empty — that
   covers a row written before the migration, and any caller still selecting
   only the old columns (the client portal's own query does exactly that). */
export function creatorPayouts(c?: {
  payouts?: unknown; paypal?: string | null; zelle?: string | null;
} | null): Payout[] {
  const raw = c?.payouts;
  if (Array.isArray(raw)) {
    const list = raw
      .map((p: any) => ({
        label: String(p?.label ?? '').trim() || 'Other',
        value: String(p?.value ?? '').trim(),
      }))
      .filter(p => p.value);
    if (list.length) return list;
  }
  const legacy: Payout[] = [];
  if (String(c?.paypal || '').trim()) legacy.push({ label: 'PayPal', value: String(c!.paypal).trim() });
  if (String(c?.zelle || '').trim()) legacy.push({ label: 'Zelle', value: String(c!.zelle).trim() });
  return legacy;
}

/* Short badge text for a table cell: PP / Z for the two we have always had,
   otherwise the label's initials. Two characters, because the badge sits in a
   column sized for "PP". */
export function payoutTag(label: string): string {
  const kind = payoutKindOf(label);
  if (kind === 'paypal') return 'PP';
  if (kind === 'zelle') return 'Z';
  const words = String(label || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '•';
  const initials = words.length > 1
    ? words.slice(0, 2).map(w => w[0]).join('')
    : words[0].slice(0, 2);
  return initials.toUpperCase();
}

/* CSS modifier on .pc-paytag — the two known methods keep their colours,
   everything else shares one neutral tone. */
export function payoutTagClass(label: string): 'pp' | 'zl' | 'other' {
  const kind = payoutKindOf(label);
  return kind === 'paypal' ? 'pp' : kind === 'zelle' ? 'zl' : 'other';
}

/* An openable link, or null for a plain email / account number.

   Applied to EVERY method now, not just PayPal as before: a custom "Wise" or
   "Payoneer" entry is as likely to be a payment link as a paypal.me one, and
   a value that is a URL is a URL whatever the label above it says. */
export function payoutUrl(value?: string | null): string | null {
  const t = String(value || '').trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(www\.|paypal\.me\/|paypal\.com\/)/i.test(t)) return `https://${t.replace(/^\/+/, '')}`;
  return null;
}

/* Suggestions in the deal editor's method box. A datalist, not a fixed
   dropdown — the whole point is that a method we have never used before can be
   typed in.

   ‼️ PayPal and Zelle are deliberately NOT here. That box is the editor's
   "other payment methods" list, and those two have their own labelled fields
   above it — offering them here would only invite a duplicate entry. */
export const PAYOUT_SUGGESTIONS = [
  'Wise', 'Bank transfer', 'Venmo', 'Cash App', 'Payoneer', 'Revolut', 'Crypto',
];
