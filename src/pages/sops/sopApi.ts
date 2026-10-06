import { supabase } from '../../lib/supabase';
import { defaultSections, normalizeSections, normalizeLive, type SopLive, type SopSection } from './sopSections';

/** The brand_sops row as the app uses it. `sections` is always normalized. */
export interface SopRow {
  id: string;
  brand_id: string;
  sections: SopSection[];
  share_enabled: boolean;
  share_token: string;
  updated_by: string | null;
  updated_at: string;
}

const COLS = 'id,brand_id,sections,share_enabled,share_token,updated_by,updated_at';
const toRow = (r: any): SopRow => ({ ...r, sections: normalizeSections(r.sections) });

export async function loadSop(brandId: string): Promise<SopRow | null> {
  const { data, error } = await supabase.from('brand_sops').select(COLS).eq('brand_id', brandId).maybeSingle();
  if (error) throw error;
  return data ? toRow(data) : null;
}

export async function createSop(brandId: string, userId: string | undefined): Promise<SopRow> {
  const { data, error } = await supabase.from('brand_sops')
    .insert({ brand_id: brandId, sections: defaultSections(), created_by: userId, updated_by: userId })
    .select(COLS).single();
  if (error) throw error;
  return toRow(data);
}

/** Sends `sections` only (plus the editor stamp). Returns the new stamp. */
export async function saveSop(id: string, sections: SopSection[], userId: string | undefined): Promise<{ updated_at: string; updated_by: string | null }> {
  const { data, error } = await supabase.from('brand_sops')
    .update({ sections, updated_by: userId }).eq('id', id).select('updated_at,updated_by').single();
  if (error) throw error;
  return data as { updated_at: string; updated_by: string | null };
}

export async function setShareEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('brand_sops').update({ share_enabled: enabled }).eq('id', id);
  if (error) throw error;
}

export async function resetShareToken(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('sop_reset_share_token', { p_id: id });
  if (error) throw error;
  if (!data) throw new Error('You cannot change this SOP\'s link.');
  return data as string;
}

export async function deleteSop(id: string): Promise<void> {
  const { error } = await supabase.from('brand_sops').delete().eq('id', id);
  if (error) throw error;
}

export interface SharedSop { brandName: string; sections: SopSection[]; updatedAt: string; live: SopLive; }

/** Public read through the share token (anon). null = bad or disabled link. */
export async function loadSharedSop(code: string): Promise<SharedSop | null> {
  const { data, error } = await supabase.rpc('sop_shared', { p_code: code });
  if (error) throw error;
  if (!data) return null;
  return {
    brandName: data.brand_name,
    sections: normalizeSections(data.sections),
    updatedAt: data.updated_at,
    live: normalizeLive(data.live),
  };
}

export const sopShareUrl = (token: string) => `${window.location.origin}/sop/${token}`;
