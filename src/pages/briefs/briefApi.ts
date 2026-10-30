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

/** Just enough for Claude (or any AI with the Supabase MCP) to find the brand. */
export function brandAccessDetails(brandId: string, brandName: string): string {
  return [
    `Brand: ${brandName}`,
    `Brand id: ${brandId}`,
    `Supabase project: ${projectRef()}`,
    `Brief functions: public.content_brief_context, public.save_content_brief`,
  ].join('\n');
}
