/* ════════════════════════════════════════════════════════════
   Message templates — the vocabulary, and filling one in.

   PURE: no React, no DOM, no Supabase. The handler workspace's Templates tab
   drives it, and keeping the rules here is what makes "does {deal} resolve to
   the right figure" a question that can be answered without a browser.

   ‼️ A PLACEHOLDER THAT CANNOT BE FILLED IS LEFT ON SCREEN AS ITS OWN TOKEN,
   never blanked. This text is pasted into a real conversation with a creator
   or a client: a visible "{deal}" is embarrassing and gets noticed, while a
   silent gap ("Your payment of  is being processed") reads as finished and
   gets sent. The fill panel counts them so it can say so before you copy.

   ‼️ THE TOKEN LIST IS CLOSED, and `audience` decides which half applies. A
   creator template may not reach for {budget}: that is the client's figure,
   and a template that quietly names it would eventually be pasted to the
   creator. Anything not on this list is reported as UNKNOWN (a typo like
   {craetor}) rather than silently treated as empty — those are different
   mistakes and only one of them is fixed by picking a creator.
════════════════════════════════════════════════════════════ */

/** Who the message is addressed to. Mirrors the SQL CHECK on `audience`. */
export type TemplateAudience = 'creator' | 'brand';

export const TEMPLATE_AUDIENCES: { id: TemplateAudience; label: string; icon: string; hint: string }[] = [
  {
    id: 'creator',
    label: 'To a creator',
    icon: 'bi-person-video2',
    hint: 'Sent to the creator themselves — a nudge, an ad-code ask, a payment note.',
  },
  {
    id: 'brand',
    label: 'To a brand',
    icon: 'bi-shop',
    hint: 'Sent to the client — a kick-off, a month update, chasing an approval.',
  },
];

export function audienceMeta(id: string) {
  return TEMPLATE_AUDIENCES.find(a => a.id === id) || TEMPLATE_AUDIENCES[0];
}

/** One template row, as the library stores it. */
export interface MessageTemplate {
  id: string;
  name: string;
  audience: TemplateAudience;
  category: string;
  body: string;
  created_by: string | null;
  created_by_name: string;
  updated_by: string | null;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface PlaceholderDef {
  /** The bare token name, without braces. Lowercase; matching ignores case. */
  token: string;
  label: string;
  /** Which templates may use it. 'any' rides both. */
  audience: TemplateAudience | 'any';
  /** Shown in the picker so a handler knows what they are inserting. */
  example: string;
}

/* ‼️ The brand half is offered to CREATOR templates too, and that is the
   difference between "which brand is this about" and "what is the client
   paying". A creator message naming the brand and its content guide is
   ordinary; one naming the budget is a leak. So {brand} / {month} /
   {content_guide} / {products} are 'any', and {budget} / {remaining} /
   {creators} are 'brand'. */
export const PLACEHOLDERS: PlaceholderDef[] = [
  // — the creator this message is for —
  { token: 'creator', label: "Creator's name", audience: 'creator', example: 'Jane Doe' },
  { token: 'handle', label: "Creator's @handle", audience: 'creator', example: '@janedoe' },
  { token: 'deal', label: 'Their fee', audience: 'creator', example: '$200' },
  { token: 'status', label: 'Their payment status', audience: 'creator', example: 'Videos in Progress' },
  /* The e-signing link the creator opens to read and sign — /sign/<token>,
     never the legacy hand-pasted contract_url unless that is all there is. A
     DEACTIVATED, unsigned link resolves to nothing the creator can use, so it
     counts as missing rather than being sent as a dead URL. */
  { token: 'contract', label: 'Their contract link', audience: 'creator', example: 'https://…/sign/…' },
  // — counts: the same two words mean the creator's deal on a creator
  //   template and the whole month on a brand one, which is why they carry no
  //   audience of their own —
  { token: 'videos', label: 'Videos agreed', audience: 'any', example: '5' },
  { token: 'delivered', label: 'Videos delivered', audience: 'any', example: '3' },
  { token: 'remaining_videos', label: 'Videos still to come', audience: 'any', example: '2' },
  // — the brand —
  { token: 'brand', label: 'Brand name', audience: 'any', example: 'Wetcat' },
  { token: 'month', label: 'Program month', audience: 'any', example: 'September 2026' },
  { token: 'content_guide', label: 'Content brief link', audience: 'any', example: 'https://…' },
  /* ‼️ {products} CARRIES THE LINKS and is a BLOCK, one product per line —
     "here are the products" is the thing actually being sent, and a creator
     cannot open a product they were only told the name of. {product_names} is
     the inline comma-joined form, kept for the mid-sentence case ("we are
     focusing on Serum, Cleanser") that a multi-line block would break. Both
     read the brand's own focus products (the "+ Focus product" chips on the
     handler's Edit-budget popup), NOT the brand_products catalogue, which this
     workspace never loads. */
  { token: 'products', label: 'Focus products, with links', audience: 'any', example: 'Serum — https://…' },
  { token: 'product_names', label: 'Focus product names only', audience: 'any', example: 'Serum, Cleanser' },
  // — the client's own figures —
  { token: 'budget', label: "Month's budget", audience: 'brand', example: '$5,000' },
  { token: 'remaining', label: 'Budget left', audience: 'brand', example: '$1,200' },
  { token: 'creators', label: 'Creators live', audience: 'brand', example: '8' },
  // — us —
  { token: 'me', label: 'Your own name', audience: 'any', example: 'Talal' },
];

/** The tokens a template of this audience is allowed to use. */
export function placeholdersFor(audience: TemplateAudience): PlaceholderDef[] {
  return PLACEHOLDERS.filter(p => p.audience === 'any' || p.audience === audience);
}

export function placeholderDef(token: string): PlaceholderDef | undefined {
  const t = token.trim().toLowerCase();
  return PLACEHOLDERS.find(p => p.token === t);
}

/* Braces, tolerant of the spaces people type inside them and of capitals.
   Deliberately narrow on what a token may contain (letters, digits,
   underscore) so an ordinary brace in prose — "{see attached}" — is left
   alone rather than reported as an unknown placeholder. */
const TOKEN_RE = /\{\s*([A-Za-z0-9_]+)\s*\}/g;

/** Every token a body uses, lowercased, in first-appearance order, deduped. */
export function placeholdersIn(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(body || '').matchAll(TOKEN_RE)) {
    const t = m[1].toLowerCase();
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export interface FillResult {
  /** The message to copy. */
  text: string;
  /** Known tokens that got a value. */
  filled: string[];
  /** Known tokens with nothing to put in them — left as "{token}" in `text`. */
  missing: string[];
  /** Tokens that are not placeholders at all (a typo, or ordinary prose). */
  unknown: string[];
}

/**
 * Substitute what we know into a template body.
 *
 * `values` is keyed by bare token name. A value that is blank, whitespace or
 * absent counts as MISSING — "we have no figure" and "the figure is an empty
 * string" are the same thing to whoever reads the message, and both must be
 * visible rather than pasted.
 *
 * An UNKNOWN token is left exactly as written and never looked up, so a body
 * containing "{craetor}" cannot be quietly filled from a near-miss.
 */
export function fillTemplate(body: string, values: Record<string, unknown>): FillResult {
  const filled: string[] = [];
  const missing: string[] = [];
  const unknown: string[] = [];

  const text = String(body || '').replace(TOKEN_RE, (whole, raw: string) => {
    const token = raw.toLowerCase();
    if (!placeholderDef(token)) {
      if (!unknown.includes(token)) unknown.push(token);
      return whole;
    }
    const v = values[token];
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (!s) {
      if (!missing.includes(token)) missing.push(token);
      return whole;
    }
    if (!filled.includes(token)) filled.push(token);
    return s;
  });

  return { text, filled, missing, unknown };
}

/* ── Categories ──
   Free text in the database (see the migration for why there is no catalogue
   table). These are the starters a new library offers; the picker unions them
   with whatever the team has actually used, so the list grows by itself and
   nothing has to be migrated to add one. */
export const STARTER_CATEGORIES = [
  'Follow-up',
  'Onboarding',
  'Ad codes',
  'Payment',
  'Samples',
  'Content brief',
  'Other',
];

/**
 * The category suggestions to offer: the starters plus every category already
 * in use, compared case-insensitively with the first spelling seen winning, so
 * "follow-up" typed by one handler does not become a second entry beside
 * "Follow-up".
 */
export function categoryOptions(rows: readonly { category?: string | null }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    const s = String(raw ?? '').trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  STARTER_CATEGORIES.forEach(add);
  rows.forEach(r => add(r?.category));
  return out;
}

/** First non-empty line of a body, for a one-line preview in the library. */
export function templatePreview(body: string, max = 140): string {
  const line = String(body || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * Does this template match what the handler typed in the search box?
 * Name, category and the message itself — somebody hunting a template
 * remembers a phrase from it as often as they remember what it is called.
 */
export function templateMatches(t: MessageTemplate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    t.name.toLowerCase().includes(q) ||
    (t.category || '').toLowerCase().includes(q) ||
    t.body.toLowerCase().includes(q)
  );
}
