import { supabase } from '../../lib/supabase';

/* ════════════════════════════════════════════════════════════
   PUBLIC LINKS TO THE CREATORS DATABASE — the data layer.

   Two halves that never meet:

     • the MANAGEMENT half (`loadShareLinks` … `rotateShareToken`) runs as a
       signed-in colleague against `creator_db_share_links` under RLS. Reading
       the list is the database's own audience; making, changing and removing a
       link is Bob's alone.

     • the PUBLIC half (`fetchSharedCreatorDb`) runs with the ANON key against
       `creator_db_shared()`, a SECURITY DEFINER function. The token in the URL
       is the credential and that function is the only door — the tables have
       no anon policy at all.

   ‼️ NOTHING HERE SENDS `share_token`, `created_by`, `created_by_name` or
   `created_at`. A BEFORE trigger mints and stamps all four and ignores what the
   caller says, so a value sent from here would be silently overwritten — which
   is worse than not sending it, because the code would read as though it
   decided something. See migration 20260909090000.

   ‼️ THE TOKEN IS THE ONLY THING THE PUBLIC READ TAKES. The database is
   company-wide rather than brand-scoped, so there is no second parameter a
   visitor could use to widen what a link covers.
════════════════════════════════════════════════════════════ */

export interface CreatorDbShareLink {
  id: string;
  label: string;
  share_token: string;
  enabled: boolean;
  /** Does this link publish phone / email / PayPal / Zelle / notes? Default no. */
  include_contact: boolean;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

const COLS =
  'id,label,share_token,enabled,include_contact,created_by,created_by_name,created_at,updated_at';

export async function loadShareLinks(): Promise<CreatorDbShareLink[]> {
  const { data, error } = await supabase
    .from('creator_db_share_links')
    .select(COLS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CreatorDbShareLink[];
}

/** Make a link. The label is the only thing a caller decides at this point —
 *  the token is the server's, and contact details start withheld. */
export async function createShareLink(label: string): Promise<CreatorDbShareLink> {
  const { data, error } = await supabase
    .from('creator_db_share_links')
    .insert({ label: label.trim() })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as CreatorDbShareLink;
}

/** Rename, switch on/off, or change what a link publishes. */
export async function updateShareLink(
  id: string,
  patch: Partial<Pick<CreatorDbShareLink, 'label' | 'enabled' | 'include_contact'>>,
): Promise<CreatorDbShareLink> {
  const { data, error } = await supabase
    .from('creator_db_share_links')
    .update(patch)
    .eq('id', id)
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as CreatorDbShareLink;
}

export async function deleteShareLink(id: string): Promise<void> {
  const { error } = await supabase.from('creator_db_share_links').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Issue a new URL, revoking every copy of the old one.
 *
 * ‼️ It goes through the RPC and not an UPDATE: the fill trigger pins
 * `share_token` on every ordinary write, and the RPC is the one write it lets
 * through. An UPDATE from here would appear to succeed and change nothing —
 * which is how a leaked link stays live while looking revoked.
 */
export async function rotateShareToken(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('creator_db_reset_share_token', { p_id: id });
  if (error) throw new Error(error.message);
  return String(data ?? '');
}

/** The public URL for a token. */
export function creatorDbShareUrl(token: string): string {
  return `${window.location.origin}/creators/${token}`;
}

/* ──────────────────────────── the public read ─────────────────────────── */

/** One banked creator, as the public page receives them. */
export interface SharedDirectoryRow {
  identity_key: string;
  name: string;
  tiktok_handle: string;
  categories: string[] | null;
  category: string;
  region: string;
  followers: number | null;
  rate: number | null;
  tags: string[] | null;
  created_at: string;
  /* Empty strings unless the link publishes them — withheld by the function,
     not by this page. */
  phone: string;
  email: string;
  paypal: string;
  zelle: string;
  notes: string;
}

/** One deal, as the public page receives it. */
export interface SharedDealRow {
  id: string;
  brand_id: string | null;
  brand_name: string;
  brand_currency: string;
  name: string;
  tiktok_handle: string;
  category: string;
  payment_status: string;
  amount: number | null;
  videos_count: number | null;
  /** ‼️ A COUNT, not the video rows — `video_codes` carries our ad codes. */
  videos_delivered: number;
  monthly: Record<string, any> | null;
  onboarded_on: string | null;
  // 'YYYY-MM' — the program the deal is filed under (absent on an older RPC).
  program_month?: string | null;
  created_at: string;
  phone: string;
  email: string;
  paypal: string;
  zelle: string;
}

export interface SharedCreatorDb {
  label: string;
  /** What the link publishes, so the page can say so rather than guess. */
  include_contact: boolean;
  generated_at: string;
  directory: SharedDirectoryRow[];
  deals: SharedDealRow[];
  /** Reacher's cached figures keyed by lowercase handle — only handles Reacher
      found. Same row shape as creator_reacher_stats. */
  reacher: Record<string, { found: boolean; tt_gmv: number | null; level: string | null;
    followers: number | null; avg_views: number | null; fetched_at: string }>;
}

export class CreatorDbLinkError extends Error {
  constructor(public reason: 'not_found' | 'revoked', message: string) {
    super(message);
  }
}

/**
 * Resolve a public link.
 *
 * The two failure reasons are kept apart deliberately: "switched off" tells the
 * reader to ask for a current link, "not valid" tells them the URL is wrong.
 * Neither leaks the other — an unknown token and a revoked one are separate
 * answers from the function, and neither carries any creator data.
 */
export async function fetchSharedCreatorDb(code: string): Promise<SharedCreatorDb> {
  const { data, error } = await supabase.rpc('creator_db_shared', { p_code: code });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as any;
  if (!row.ok) {
    if (row.reason === 'revoked') {
      throw new CreatorDbLinkError(
        'revoked',
        'This link has been switched off. Ask ApexGMV for a current one.',
      );
    }
    throw new CreatorDbLinkError('not_found', 'This link is not valid.');
  }
  return {
    label: row.label ?? '',
    include_contact: !!row.include_contact,
    generated_at: row.generated_at ?? '',
    directory: Array.isArray(row.directory) ? row.directory : [],
    deals: Array.isArray(row.deals) ? row.deals : [],
    reacher: row.reacher && typeof row.reacher === 'object' && !Array.isArray(row.reacher) ? row.reacher : {},
  };
}
