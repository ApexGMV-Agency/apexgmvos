// Supabase Edge Function: post-shared-comment
// Public — validates a share token, confirms the report belongs to the link,
// and inserts a client comment.
// Deploy in dashboard (Edge Functions → Deploy → "post-shared-comment")

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

    const reqBody = await req.json();
    const { token, report_id, section, author_name, body, parent_id } = reqBody;
    const report_type: 'weekly' | 'monthly' = reqBody.report_type === 'monthly' ? 'monthly' : 'weekly';
    if (!token || !report_id || !section || !author_name || !body) {
      return json({ error: 'token, report_id, section, author_name, body required' }, 400);
    }
    if (!isValidSection(section)) return json({ error: 'Invalid section' }, 400);
    if (String(body).trim().length === 0) return json({ error: 'Empty comment' }, 400);

    const { data: link } = await admin.from('report_share_links')
      .select('*').eq('token', token).maybeSingle();
    if (!link) return json({ error: 'Invalid link' }, 404);
    if (link.revoked_at) return json({ error: 'Link revoked' }, 410);

    const reportTable = report_type === 'monthly' ? 'monthly_reports' : 'weekly_reports';
    const periodLabelField = report_type === 'monthly' ? 'month' : 'week_number';
    const { data: report } = await admin.from(reportTable)
      .select(`id,brand_id,content,is_shared,${periodLabelField}`).eq('id', report_id).maybeSingle();
    if (!report) return json({ error: 'Report not found' }, 404);
    const brandIds: string[] = link.brand_ids ?? [];
    if (!brandIds.includes(report.brand_id)) return json({ error: 'Not allowed' }, 403);
    if (report.is_shared === false) return json({ error: 'This report is no longer shared' }, 403);

    const { data: brand } = await admin.from('brands')
      .select('id,share_enabled').eq('id', report.brand_id).maybeSingle();
    if (!brand?.share_enabled) return json({ error: 'Sharing is disabled for this brand' }, 403);

    if (parent_id) {
      const { data: parent } = await admin.from('report_comments')
        .select('report_id,report_type').eq('id', parent_id).maybeSingle();
      if (!parent || parent.report_id !== report_id || (parent as any).report_type !== report_type) {
        return json({ error: 'Invalid parent' }, 400);
      }
    }

    const cleanName = String(author_name).trim().slice(0, 80);
    const cleanBody = String(body).trim().slice(0, 4000);

    const { data: inserted, error } = await admin.from('report_comments').insert({
      report_id,
      report_type,
      section,
      author_type: 'client',
      author_name: cleanName,
      body: cleanBody,
      parent_id: parent_id ?? null,
    }).select().single();
    if (error) return json({ error: error.message }, 500);

    // Notify Bob + assigned APCs + the brand's Team Lead. Best-effort; don't fail the comment if this errors.
    try {
      const sectionLabel: Record<string, string> = {
        overall: 'Overall Performance', top_creators: 'Top Creators', top_videos: 'Top Videos',
        video_performance: 'Video Performance', gmv_max: 'GMV Max',
        product_highlights: 'Product Highlights', shop_health: 'Shop Health', insights: 'Insights',
        approval: 'Approval Needed',
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
        if (sectionLabel[s]) return sectionLabel[s];
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

      const title = `New comment on ${brand?.name ?? 'brand'} report`;
      const bodyText = `${cleanName} commented on ${labelFor(section)}: "${cleanBody.slice(0, 140)}${cleanBody.length > 140 ? '…' : ''}"`;
      const routeBase = report_type === 'monthly' ? 'monthly' : 'weekly';
      const link = `/reporting/${routeBase}/${report_id}?section=${encodeURIComponent(section)}&comment=${(inserted as any).id}`;
      const payload = {
        report_id, brand_id: report.brand_id, section, comment_id: (inserted as any).id,
      };
      const rows = Array.from(recipientIds).map(uid => ({
        user_id: uid, type: 'client_comment', title, body: bodyText, link, payload,
      }));
      if (rows.length > 0) await admin.from('notifications').insert(rows);

      // Phase 2: web push if VAPID configured + send-push function deployed
      const vapidConfigured = !!Deno.env.get('VAPID_PUBLIC_KEY');
      if (vapidConfigured && rows.length > 0) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
            body: JSON.stringify({ user_ids: Array.from(recipientIds), title, body: bodyText, link }),
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
