import { supabase } from '../../lib/supabase';

/**
 * Content briefs: free-form HTML pages Claude writes and saves through the
 * Supabase MCP (save_content_brief). The app lists, shows, shares and
 * versions them — it never edits the HTML itself.
 */
export interface BriefRow {
  id: string;
  brand_id: string;
  name: string;
  current_version: number;
  share_enabled: boolean;
  share_token: string;
  updated_at: string;
}

export interface BriefVersion {
  id: string;
  version: number;
  note: string | null;
  created_at: string;
}

const COLS = 'id,brand_id,name,current_version,share_enabled,share_token,updated_at';

export async function listBriefs(brandId: string): Promise<BriefRow[]> {
  const { data, error } = await supabase.from('content_briefs').select(COLS)
    .eq('brand_id', brandId).order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as BriefRow[]) ?? [];
}

export async function listVersions(briefId: string): Promise<BriefVersion[]> {
  const { data, error } = await supabase.from('content_brief_versions')
    .select('id,version,note,created_at').eq('brief_id', briefId).order('version', { ascending: false });
  if (error) throw error;
  return (data as BriefVersion[]) ?? [];
}

export async function loadVersionHtml(briefId: string, version: number): Promise<string> {
  const { data, error } = await supabase.from('content_brief_versions')
    .select('html').eq('brief_id', briefId).eq('version', version).single();
  if (error) throw error;
  return (data as { html: string }).html;
}

/** Re-save an old version's HTML as the newest version. */
export async function restoreVersion(brief: BriefRow, version: number): Promise<void> {
  const html = await loadVersionHtml(brief.id, version);
  const { error } = await supabase.rpc('save_content_brief', {
    p_brand: brief.brand_id, p_name: null, p_html: html, p_brief: brief.id, p_note: `Restored v${version}`,
  });
  if (error) throw error;
}

export async function renameBrief(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('content_briefs').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function setBriefShareEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('content_briefs').update({ share_enabled: enabled }).eq('id', id);
  if (error) throw error;
}

export async function resetBriefShareToken(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('content_brief_reset_share_token', { p_id: id });
  if (error) throw error;
  if (!data) throw new Error('You cannot change this brief\'s link.');
  return data as string;
}

export async function deleteBrief(id: string): Promise<void> {
  const { error } = await supabase.from('content_briefs').delete().eq('id', id);
  if (error) throw error;
}

export interface SharedBrief { brandName: string; name: string; html: string; updatedAt: string; }

/** Public read through the share token (anon). null = bad or disabled link. */
export async function loadSharedBrief(code: string): Promise<SharedBrief | null> {
  const { data, error } = await supabase.rpc('content_brief_shared', { p_code: code });
  if (error) throw error;
  if (!data) return null;
  return { brandName: data.brand_name, name: data.name, html: data.html, updatedAt: data.updated_at };
}

export const briefShareUrl = (token: string) => `${window.location.origin}/brief/${token}`;

/** The Supabase project ref, so the Claude prompt names the right MCP project. */
const projectRef = () => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname.split('.')[0]; }
  catch { return ''; }
};

/** Instructions to paste into Claude (with the Supabase MCP connected). */
export function claudeBriefPrompt(brandId: string, brandName: string): string {
  return [
    `Make a content brief for the brand "${brandName}" and save it into ApexGMVOS.`,
    ``,
    `Use the Supabase MCP, project ref ${projectRef()}. Brand id: ${brandId}`,
    ``,
    `1. Read the brand's data first:`,
    `   select public.content_brief_context('${brandId}');`,
    `   (brand, products + commissions, monthly sample goals, resource links, SOP sections, existing briefs)`,
    `2. Design the brief as ONE self-contained HTML page — your own structure and style, like an artifact.`,
    `   Inline all CSS/JS; scripts may load from a CDN; images must be https URLs (no big base64).`,
    `   It renders in a sandboxed iframe: no access to cookies, storage, or the parent page.`,
    `3. Save it with dollar-quoting so quotes in the HTML are safe:`,
    `   select public.save_content_brief('${brandId}', '<brief name>', $brief$<!doctype html>...$brief$);`,
    ``,
    `To change an existing brief: read it with select public.content_brief_html('<brief id>');`,
    `then save the new HTML as a new version:`,
    `   select public.save_content_brief('${brandId}', null, $brief$...$brief$, '<brief id>', '<what changed>');`,
    ``,
    `Brief request: `,
  ].join('\n');
}
