// Helper for uploading inline report images to Supabase Storage.
// Bucket: 'report-images' (public-read, authed-write — see migration).
//
// Returns a public URL that can be saved into report content (image_url).

import { supabase } from './supabase';

const BUCKET = 'report-images';

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export async function uploadReportImage(file: File, opts: { brandId?: string; reportType?: 'weekly' | 'monthly' } = {}): Promise<string> {
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().slice(0, 8) || 'bin';
  const base = slugify(file.name.replace(/\.[^.]+$/, '') || 'image') || 'image';
  const folder = [opts.reportType ?? 'monthly', opts.brandId ?? 'misc'].join('/');
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not resolve public URL for uploaded image');
  return data.publicUrl;
}

// Rasterize an uploaded SVG signature to a PNG data URL (jsPDF can't embed SVG
// directly). Shared by the handler's contract template and the public creator
// signing page.
export function svgToPngDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w = 600;
        const ratio = img.width > 0 && img.height > 0 ? img.height / img.width : 0.3;
        const h = Math.max(60, Math.round(w * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable SVG')); };
    img.src = url;
  });
}

// Profile photos live in the 'avatars' bucket (public-read), each user writing
// only inside their own uid-prefixed folder (RLS — see migration 20260709090000).
const AVATAR_BUCKET = 'avatars';

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 8) || 'jpg';
  // A fresh filename each time busts the CDN cache so the new photo shows at once.
  const path = `${userId}/avatar-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || undefined,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not resolve public URL for uploaded avatar');
  return data.publicUrl;
}

// Contract signature images (handler contract template) share the avatars
// bucket — same per-uid folder write RLS, public read. Always PNG (drawn on
// canvas, or an uploaded SVG rasterized client-side before calling this).
export async function uploadSignature(userId: string, blob: Blob): Promise<string> {
  const path = `${userId}/signature-${Date.now()}.png`;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    cacheControl: '3600',
    upsert: true,
    contentType: 'image/png',
  });
  if (error) throw error;
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not resolve public URL for uploaded signature');
  return data.publicUrl;
}
