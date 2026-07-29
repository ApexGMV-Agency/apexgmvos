// Supabase Edge Function: get-shared-reports
// Public — no auth required. Validates a share token and returns brands + reports.
// Deploy in dashboard (Edge Functions → Deploy a new function → "get-shared-reports")

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const token = url.searchParams.get('token') ?? (await safeJson(req))?.token;
    if (!token) return json({ error: 'token required' }, 400);

    const { data: link, error: linkErr } = await admin
      .from('report_share_links')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (linkErr) return json({ error: linkErr.message }, 500);
    if (!link) return json({ error: 'Invalid link' }, 404);
    if (link.revoked_at) return json({ error: 'Link revoked' }, 410);

    const linkMode: 'brand' | 'general' = link.link_mode === 'general' ? 'general' : 'brand';
    const brandIds: string[] = link.brand_ids ?? [];
    if (linkMode === 'brand' && brandIds.length === 0) {
      return json({ error: 'No brands assigned to this link' }, 400);
    }

    // General-mode links: no reports, only the explicitly-picked general resources.
    if (linkMode === 'general') {
      const explicitIds: string[] = link.resource_ids ?? [];
      if (explicitIds.length === 0) return json({ error: 'No resources assigned to this link' }, 400);

      const [{ data: client }, { data: rawResources }] = await Promise.all([
        admin.from('clients').select('id,name').eq('id', link.client_id).single(),
        admin.from('resources').select('*').in('id', explicitIds),
      ]);
      // Defense in depth: only general scope + still flagged is_shared
      const resources = (rawResources ?? []).filter((r: any) => r.scope === 'general' && r.is_shared);
      const sharedResourceIds = resources.map((r: any) => r.id);
      const { data: resource_comments } = sharedResourceIds.length > 0
        ? await admin.from('resource_comments').select('*').in('resource_id', sharedResourceIds).order('created_at', { ascending: true })
        : { data: [] };
      return json({
        client,
        brands: [],
        reports: [],
        resources,
        comments: [],
        resource_comments: resource_comments ?? [],
        label: link.label ?? null,
        include_reports: false,
        include_resources: true,
        link_mode: 'general',
      });
    }

    const includeReports         = link.include_reports          !== false;
    const includeMonthlyReports  = link.include_monthly_reports  === true;
    const includeResources       = link.include_resources        !== false;

    const [
      { data: client },
      { data: allBrands },
      { data: rawWeekly },
      { data: rawMonthly },
      { data: rawResources },
    ] = await Promise.all([
      admin.from('clients').select('id,name').eq('id', link.client_id).single(),
      admin.from('brands').select('id,name,client,client_id,share_enabled,payment_popup_default,currency').in('id', brandIds),
      includeReports
        ? admin.from('weekly_reports').select('*').in('brand_id', brandIds)
            .eq('is_shared', true)
            .order('week_start', { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
      includeMonthlyReports
        ? admin.from('monthly_reports').select('*').in('brand_id', brandIds)
            .eq('is_shared', true)
            .order('month', { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
      includeResources
        ? admin.from('resources').select('*').eq('is_shared', true)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    // Defense in depth: drop brands whose master share toggle is off (admin may have disabled it after the link was created).
    const brands = (allBrands ?? []).filter((b: any) => b.share_enabled === true)
      .map(({ share_enabled: _share, ...rest }: any) => rest);
    const allowedBrandIds = new Set(brands.map((b: any) => b.id));
    const reports         = (rawWeekly ?? []).filter((r: any) => allowedBrandIds.has(r.brand_id));
    const monthly_reports = (rawMonthly ?? []).filter((r: any) => allowedBrandIds.has(r.brand_id));

    // Auto-include is_shared resources: general (always) + brand-scope where the brand is in the link AND share_enabled.
    const resources = (rawResources ?? []).filter((r: any) =>
      r.scope === 'general' || (r.brand_id && allowedBrandIds.has(r.brand_id))
    );

    const reportIds        = reports.map((r: any) => r.id);
    const monthlyReportIds = monthly_reports.map((r: any) => r.id);

    // Comments: filter by both report_id and report_type to match the polymorphic schema
    const [{ data: weeklyComments }, { data: monthlyComments }] = await Promise.all([
      reportIds.length > 0
        ? admin.from('report_comments').select('*')
            .in('report_id', reportIds).eq('report_type', 'weekly')
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
      monthlyReportIds.length > 0
        ? admin.from('report_comments').select('*')
            .in('report_id', monthlyReportIds).eq('report_type', 'monthly')
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const comments = [...(weeklyComments ?? []), ...(monthlyComments ?? [])];

    const sharedResourceIds = (resources ?? []).map((r: any) => r.id);
    const { data: resource_comments } = sharedResourceIds.length > 0
      ? await admin.from('resource_comments').select('*').in('resource_id', sharedResourceIds).order('created_at', { ascending: true })
      : { data: [] };

    // Approval decisions — across both report types. approval_decisions_all
    // carries EVERY link's decisions on this link's reports (the "Approved"
    // history tab must survive link rotation); approval_decisions stays the
    // per-link subset that drives the "your decision" state + pending popup.
    const [{ data: weeklyDecisions }, { data: monthlyDecisions }] = await Promise.all([
      reportIds.length > 0
        ? admin.from('report_approval_decisions').select('*')
            .in('report_id', reportIds).eq('report_type', 'weekly')
        : Promise.resolve({ data: [] as any[] }),
      monthlyReportIds.length > 0
        ? admin.from('report_approval_decisions').select('*')
            .in('report_id', monthlyReportIds).eq('report_type', 'monthly')
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const approval_decisions_all = [...(weeklyDecisions ?? []), ...(monthlyDecisions ?? [])];
    const approval_decisions = approval_decisions_all.filter((d: any) => d.share_link_id === link.id);

    // Sample-seeding rows for the v3 report's §1 MTD tiles + §3 per-product
    // "samples approved this week" column (the public client can't read
    // brand_samples_* directly). Only fetched when a v3 report is shared,
    // windowed to the span the shared reports actually cover (a week that
    // straddles a month boundary needs its pre-1st days, hence week_start).
    let samples_daily: any[] = [];
    let samples_products: any[] = [];
    const v3Reports = (reports ?? []).filter((r: any) => r?.content?.format_version === 'v3');
    if (brands.length > 0 && v3Reports.length > 0) {
      const allowedIds = brands.map((b: any) => b.id);
      const froms = v3Reports.map((r: any) => {
        const monthStart = `${String(r.week_end).slice(0, 7)}-01`;
        return String(r.week_start) < monthStart ? String(r.week_start) : monthStart;
      }).sort();
      const tos = v3Reports.map((r: any) => String(r.week_end)).sort();
      const [{ data: sdRows }, { data: spRows }] = await Promise.all([
        admin.from('brand_samples_daily')
          .select('brand_id,entry_date,new_videos,others_count,product_counts')
          .in('brand_id', allowedIds).gte('entry_date', froms[0]).lte('entry_date', tos[tos.length - 1]),
        admin.from('brand_samples_products')
          .select('id,brand_id,external_product_id').in('brand_id', allowedIds),
      ]);
      samples_daily = sdRows ?? [];
      samples_products = spRows ?? [];
    }

    return json({
      client,
      brands,
      reports,
      monthly_reports,
      resources: resources ?? [],
      comments,
      resource_comments: resource_comments ?? [],
      approval_decisions,
      approval_decisions_all,
      label: link.label ?? null,
      include_reports: includeReports,
      include_monthly_reports: includeMonthlyReports,
      include_resources: includeResources,
      samples_daily,
      samples_products,
      link_mode: 'brand',
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

async function safeJson(req: Request) {
  try { return await req.json(); } catch { return null; }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
