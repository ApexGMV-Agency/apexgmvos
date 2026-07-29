// Supabase Edge Function: post-staff-comment
// Authenticated. Inserts a Bob reply into report_comments and dispatches
// in-app + (optionally) web-push notifications to the other staff watching
// the brand. Mirrors the public post-shared-comment flow, but for the staff
// side of the thread (where direct table inserts can't write notifications
// because of RLS).

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Accept any short, safe section key: classic + v2 section ids, the §14
// sub-section keys (14.1–14.7), and custom-section ids (cs:<uuid>).
function isValidSection(s: string): boolean {
  return typeof s === 'string' && s.length > 0 && s.length <= 64 && /^[a-z0-9:._-]+$/i.test(s);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const { data: { user } } = await admin.auth.getUser(authHeader);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { data: profile } = await admin.from('profiles')
      .select('id,role,full_name,email').eq('id', user.id).single();
    if (!profile) return json({ error: 'Profile not found' }, 401);
    // Replying to client feedback is Bob-only (APCs / Team Leads read-only).
    if (profile.role !== 'bob') {
      return json({ error: 'Not allowed' }, 403);
    }

    const reqBody = await req.json();
    const { report_id, section, body, parent_id } = reqBody;
    const report_type: 'weekly' | 'monthly' = reqBody.report_type === 'monthly' ? 'monthly' : 'weekly';
    if (!report_id || !section || !body) {
      return json({ error: 'report_id, section, body required' }, 400);
    }
    if (!isValidSection(section)) return json({ error: 'Invalid section' }, 400);
    if (String(body).trim().length === 0) return json({ error: 'Empty comment' }, 400);

    const reportTable = report_type === 'monthly' ? 'monthly_reports' : 'weekly_reports';
    const periodLabelField = report_type === 'monthly' ? 'month' : 'week_number';
    const { data: report } = await admin.from(reportTable)
      .select(`id,brand_id,${periodLabelField},content`).eq('id', report_id).single();
    if (!report) return json({ error: 'Report not found' }, 404);

    if (parent_id) {
      const { data: parent } = await admin.from('report_comments')
        .select('report_id,report_type').eq('id', parent_id).maybeSingle();
      if (!parent || parent.report_id !== report_id || (parent as any).report_type !== report_type) {
        return json({ error: 'Invalid parent' }, 400);
      }
    }

    const cleanBody = String(body).trim().slice(0, 4000);
    const authorName = profile.full_name || profile.email || 'Staff';

    const { data: inserted, error } = await admin.from('report_comments').insert({
      report_id,
      report_type,
      section,
      author_type: 'bob',
      author_name: authorName,
      body: cleanBody,
      parent_id: parent_id ?? null,
    }).select().single();
    if (error) return json({ error: error.message }, 500);

    // Best-effort notifications to OTHER Bob + APCs assigned to this brand.
    try {
      const sectionLabels: Record<string, string> = {
        overall: 'Overall Performance', top_creators: 'Top Creators', top_videos: 'Top Videos',
        video_performance: 'Video Performance', gmv_max: 'GMV Max',
        product_highlights: 'Product Highlights', shop_health: 'Shop Health',
        insights: 'Insights', approval: 'Approval Needed',
        snapshot: 'Executive Snapshot',
        // v3 (12-section TikTok-Shop) template
        sampling: 'Sampling & Videos', product_analytics: 'Product Analytics',
        product_traffic: 'Product Traffic', traffic_analysis: 'Traffic Analysis',
        channel_analytics: 'Channel Analytics', offsite: 'Offsite Performance',
        affiliate: 'Affiliate Performance', top_lives: 'Top Live Sessions',
        '14.1': 'Key Stats — North-Star & Efficiency', '14.2': 'Key Stats — Channel & Source Mix',
        '14.3': 'Key Stats — Conversion Funnel', '14.4': 'Key Stats — Productivity & Marketing',
        '14.5': 'Key Stats — Paid Media Efficiency', '14.6': 'Key Stats — Health & Risk Signals',
        '14.7': 'Key Stats — Weekly Targets & Action Items',
      };
      const labelFor = (s: string): string => {
        if (sectionLabels[s]) return sectionLabels[s];
        if (s.startsWith('cs:')) {
          const id = s.slice(3);
          const cs = (report.content?.custom_sections ?? []).find((x: any) => x?.id === id);
          if (cs?.name) return String(cs.name);
        }
        return s;
      };
      const [{ data: brand }, { data: bobs }, { data: apcRows }, { data: leadRows }] = await Promise.all([
        admin.from('brands').select('id,name').eq('id', report.brand_id).single(),
        admin.from('profiles').select('id').eq('role', 'bob'),
        admin.from('apc_brands').select('apc_id').eq('brand_id', report.brand_id),
        admin.from('team_lead_brands').select('team_lead_id').eq('brand_id', report.brand_id),
      ]);
      const recipientIds = new Set<string>();
      (bobs ?? []).forEach((p: any) => recipientIds.add(p.id));
      (apcRows ?? []).forEach((r: any) => recipientIds.add(r.apc_id));
      (leadRows ?? []).forEach((r: any) => recipientIds.add(r.team_lead_id));
      recipientIds.delete(profile.id);  // don't notify self

      const periodLabel = report_type === 'monthly'
        ? `Month ${(report as any).month ?? ''}`
        : `Week #${(report as any).week_number}`;
      const title = `${authorName} replied on ${brand?.name ?? 'a brand'} report`;
      const bodyText = `${labelFor(section)} (${periodLabel}): "${cleanBody.slice(0, 140)}${cleanBody.length > 140 ? '…' : ''}"`;
      const routeBase = report_type === 'monthly' ? 'monthly' : 'weekly';
      const linkUrl = `/reporting/${routeBase}/${report_id}?section=${encodeURIComponent(section)}&comment=${(inserted as any).id}`;
      const payload = {
        report_id, brand_id: report.brand_id, section, comment_id: (inserted as any).id,
      };
      const rows = Array.from(recipientIds).map(uid => ({
        user_id: uid, type: 'staff_comment', title, body: bodyText, link: linkUrl, payload,
      }));
      if (rows.length > 0) await admin.from('notifications').insert(rows);

      const vapidConfigured = !!Deno.env.get('VAPID_PUBLIC_KEY');
      if (vapidConfigured && rows.length > 0) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
            body: JSON.stringify({ user_ids: Array.from(recipientIds), title, body: bodyText, link: linkUrl }),
          });
        } catch (_) { /* best effort */ }
      }
    } catch (notifyErr) {
      console.error('Notification dispatch failed:', notifyErr);
    }

    return json({ comment: inserted });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
