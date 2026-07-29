// Supabase Edge Function: post-approval-decision
// Public — validates a share token, records the client's decision (approve /
// changes_requested) on a report, and notifies Bob + assigned APCs.
// Deploy: npx supabase functions deploy post-approval-decision

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const reqBody = await req.json();
    const { token, report_id, decision, decided_by_name, comment } = reqBody;
    const report_type: 'weekly' | 'monthly' = reqBody.report_type === 'monthly' ? 'monthly' : 'weekly';
    if (!token || !report_id || !decision || !decided_by_name) {
      return json({ error: 'token, report_id, decision, decided_by_name required' }, 400);
    }
    if (decision !== 'approved' && decision !== 'changes_requested') {
      return json({ error: 'Invalid decision' }, 400);
    }

    const { data: link } = await admin.from('report_share_links')
      .select('*').eq('token', token).maybeSingle();
    if (!link) return json({ error: 'Invalid link' }, 404);
    if (link.revoked_at) return json({ error: 'Link revoked' }, 410);

    const reportTable = report_type === 'monthly' ? 'monthly_reports' : 'weekly_reports';
    const periodLabelField = report_type === 'monthly' ? 'month' : 'week_number';
    const { data: report } = await admin.from(reportTable)
      .select(`id,brand_id,${periodLabelField},is_shared,content`).eq('id', report_id).maybeSingle();
    if (!report) return json({ error: 'Report not found' }, 404);

    const brandIds: string[] = link.brand_ids ?? [];
    if (!brandIds.includes(report.brand_id)) return json({ error: 'Not allowed' }, 403);
    if (report.is_shared === false) return json({ error: 'This report is no longer shared' }, 403);
    if (!report.content?.approval?.enabled) return json({ error: 'Report has no approval request' }, 400);

    const { data: brand } = await admin.from('brands')
      .select('id,name,share_enabled').eq('id', report.brand_id).maybeSingle();
    if (!brand?.share_enabled) return json({ error: 'Sharing is disabled for this brand' }, 403);

    const cleanName = String(decided_by_name).trim().slice(0, 80);
    const cleanComment = comment ? String(comment).trim().slice(0, 4000) : null;

    // Decisions are immutable: one per (report × link). If the client has
    // already decided on this report via this link, refuse the update — they
    // should follow up via the comment thread instead.
    const { data: existing } = await admin.from('report_approval_decisions')
      .select('id, decision, decided_at')
      .eq('report_id', report_id)
      .eq('share_link_id', link.id)
      .maybeSingle();
    if (existing) {
      return json({
        error: 'Your decision has already been recorded. Decisions can\'t be changed — please reply in the report\'s Approval Needed thread to follow up.',
        code: 'DECISION_ALREADY_RECORDED',
        existing,
      }, 409);
    }

    const { data: inserted, error } = await admin.from('report_approval_decisions')
      .insert({
        report_id,
        report_type,
        share_link_id: link.id,
        decision,
        comment: cleanComment,
        decided_by_name: cleanName,
        decided_at: new Date().toISOString(),
      })
      .select().single();
    if (error) return json({ error: error.message }, 500);

    // Mirror the decision (and any comment) into report_comments so it joins
    // the section's regular thread — staff can reply, the offcanvas shows it,
    // and notifications can deep-link to a real comment id.
    let mirrorComment: any = null;
    {
      const verb = decision === 'approved' ? 'Approved' : 'Requested changes';
      const body = cleanComment
        ? `[${verb}] ${cleanComment}`
        : `[${verb}]`;
      const { data: cm } = await admin.from('report_comments').insert({
        report_id,
        report_type,
        section: 'approval',
        author_type: 'client',
        author_name: cleanName,
        body,
        parent_id: null,
      }).select().single();
      mirrorComment = cm;
    }

    // Notify Bob + assigned APCs + the brand's Team Lead (best-effort)
    try {
      const [{ data: bobs }, { data: apcRows }, { data: leadRows }] = await Promise.all([
        admin.from('profiles').select('id').eq('role', 'bob'),
        admin.from('apc_brands').select('apc_id').eq('brand_id', report.brand_id),
        admin.from('team_lead_brands').select('team_lead_id').eq('brand_id', report.brand_id),
      ]);
      const recipientIds = new Set<string>();
      (bobs ?? []).forEach((p: any) => recipientIds.add(p.id));
      (apcRows ?? []).forEach((r: any) => recipientIds.add(r.apc_id));
      (leadRows ?? []).forEach((r: any) => recipientIds.add(r.team_lead_id));

      const verb = decision === 'approved' ? 'approved' : 'requested changes on';
      const periodLabel = report_type === 'monthly'
        ? `Month ${(report as any).month ?? ''}`
        : `Week #${(report as any).week_number}`;
      const routeBase = report_type === 'monthly' ? 'monthly' : 'weekly';
      const title = `${cleanName} ${verb} ${brand?.name ?? 'a brand'} report`;
      const bodyText = cleanComment
        ? `${periodLabel}. Comment: "${cleanComment.slice(0, 160)}${cleanComment.length > 160 ? '…' : ''}"`
        : `${periodLabel}. No comment.`;
      const linkUrl = mirrorComment?.id
        ? `/reporting/${routeBase}/${report_id}?section=approval&comment=${mirrorComment.id}`
        : `/reporting/${routeBase}/${report_id}?section=approval`;
      const payload = {
        report_id, report_type, brand_id: report.brand_id,
        decision, decision_id: (inserted as any).id,
        section: 'approval',
        comment_id: mirrorComment?.id ?? null,
      };
      const rows = Array.from(recipientIds).map(uid => ({
        user_id: uid,
        type: 'approval_decision',
        title, body: bodyText, link: linkUrl, payload,
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

    return json({ decision: inserted, comment: mirrorComment });
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
