// ============================================================================
//  Section 14 — Key Stats Dashboard (client-facing, fully auto-computed)
// ----------------------------------------------------------------------------
//  Derives every 14.1–14.6 KPI, the chart series, and the 14.6 RAG signals
//  from the v2 report content (+ the previous week for trends). Pure — no React,
//  no IO — so the staff preview and the client view share identical numbers.
// ============================================================================

import { FieldFormat } from './reportSchemaV2';

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  prev: number | null;
  format: FieldFormat;
  lowerIsBetter?: boolean;
  hint?: string;
}
export type RagStatus = 'red' | 'amber' | 'green' | 'na';
export interface RagSignal {
  key: string;
  label: string;
  status: RagStatus;
  detail: string;
}
export interface MixSlice { label: string; value: number; pct: number | null; color: string; }
export interface FunnelStage { label: string; value: number | null; rate: number | null; }

export interface Section14 {
  northStar: Kpi[];          // 14.1
  mix: { slices: MixSlice[]; creator: number | null; seller: number | null }; // 14.2
  funnel: { stages: FunnelStage[]; rates: Kpi[] }; // 14.3
  productivity: Kpi[];       // 14.4
  sps: number | null;        // 14.4 (gauge)
  paid: Kpi[];               // 14.5
  signals: RagSignal[];      // 14.6
  hasAnyData: boolean;
}

const MIX_COLORS = ['#e8862e', '#0d6efd', '#198754', '#8b5cf6', '#06b6d4'];

// ---- safe arithmetic -------------------------------------------------------
function n(v: any): number | null {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function div(a: any, b: any): number | null {
  const x = n(a), y = n(b);
  if (x == null || y == null || y === 0) return null;
  return x / y;
}
function pct(a: any, b: any): number | null {
  const r = div(a, b);
  return r == null ? null : r * 100;
}
/** First non-null among candidates. */
function pick(...vals: any[]): number | null {
  for (const v of vals) { const x = n(v); if (x != null) return x; }
  return null;
}

// ---- canonical metric accessors (read v2 content, tolerate missing) --------
function metrics(c: any) {
  const gp = c?.gmv_performance ?? {};
  const sa = c?.shop_analytics ?? {};
  const sn = c?.snapshot ?? {};
  const act = c?.activity ?? {};
  const gb = c?.gmv_breakdown ?? {};
  const si = c?.search_insights ?? {};
  const mo = c?.marketing_offsite ?? {};
  const ao = c?.ad_overall ?? {};
  const ss = c?.shop_score ?? {};
  const af = c?.affiliate_summary ?? {};
  const traffic: any[] = Array.isArray(c?.product_traffic) ? c.product_traffic : [];
  const overall = traffic.find(r => String(r?.channel) === 'Overall') ?? {};
  const creators: any[] = Array.isArray(c?.top_creators) ? c.top_creators : [];
  const activeCreators = creators.filter(r => String(r?.username ?? '').trim() !== '').length || null;

  const totalGmv = pick(gp.total_gmv, sn.total_gmv, sa.gmv);
  const orders = pick(sa.orders, sn.orders);
  return {
    totalGmv,
    orders,
    aov: pick(sa.aov, sn.aov) ?? div(totalGmv, orders),
    affiliateGmv: pick(gp.affiliate_gmv, sn.affiliate_gmv),
    videoGmv: n(gp.video_gmv),
    liveGmv: pick(gp.live_gmv, sn.live_gmv),
    shopTabGmv: pick(gp.shop_tab_gmv, gb.shop_tab_gmv),
    creatorContentGmv: n(gb.creator_content_gmv),
    sellerContentGmv: n(gb.seller_content_gmv),
    searchGmv: n(si.search_gmv),
    newVideos: pick(act.new_videos_posted, sn.new_videos_posted),
    samples: n(act.samples_approved),
    liveStreams: n(act.live_streams),
    impressions: n(overall.impressions),
    clicks: n(overall.clicks),
    addToCart: n(overall.add_to_cart),
    offsiteGmv: n(mo.offsite_gmv),
    offsiteEffect: pick(mo.offsite_effect, sn.offsite_effect),
    adSpend: pick(ao.ad_spend, sn.ad_spend),
    paidOrders: n(ao.total_orders_paid),
    paidGmv: n(ao.gmv_generated),
    sps: pick(ss.shop_performance_score, sn.shop_performance_score),
    violations: n(ss.violations),
    creatorAttributedGmv: pick(af.creator_attributed_gmv, gp.affiliate_gmv),
    activeCreators,
    creators,
  };
}

export function computeSection14(c: any, prev: any | null): Section14 {
  const m = metrics(c);
  const p = prev ? metrics(prev) : null;

  // 14.1 North-Star & Efficiency
  const northStar: Kpi[] = [
    { key: 'gmv', label: 'Total GMV', value: m.totalGmv, prev: p?.totalGmv ?? null, format: 'currency' },
    { key: 'aov', label: 'AOV', value: m.aov, prev: p?.aov ?? null, format: 'currency', hint: 'GMV ÷ Orders' },
    { key: 'gmv_per_video', label: 'GMV per new video', value: div(m.totalGmv, m.newVideos), prev: p ? div(p.totalGmv, p.newVideos) : null, format: 'currency' },
    { key: 'orders_per_video', label: 'Orders per new video', value: div(m.orders, m.newVideos), prev: p ? div(p.orders, p.newVideos) : null, format: 'decimal' },
    { key: 'sample_to_content', label: 'Sample → content rate', value: div(m.newVideos, m.samples), prev: p ? div(p.newVideos, p.samples) : null, format: 'ratio', hint: 'Videos ÷ Samples' },
  ];

  // 14.2 Channel & Source Mix (share of total GMV)
  const sliceDefs: { label: string; value: number | null }[] = [
    { label: 'Video', value: m.videoGmv },
    { label: 'LIVE', value: m.liveGmv },
    { label: 'Shop Tab', value: m.shopTabGmv },
    { label: 'Affiliate', value: m.affiliateGmv },
    { label: 'Search', value: m.searchGmv },
  ];
  const slices: MixSlice[] = sliceDefs.map((s, i) => ({
    label: s.label,
    value: n(s.value) ?? 0,
    pct: pct(s.value, m.totalGmv),
    color: MIX_COLORS[i % MIX_COLORS.length],
  }));

  // 14.3 Conversion Funnel (blended, from §7 Overall + orders)
  const stages: FunnelStage[] = [
    { label: 'Impressions', value: m.impressions, rate: null },
    { label: 'Clicks', value: m.clicks, rate: pct(m.clicks, m.impressions) },
    { label: 'Add-to-Cart', value: m.addToCart, rate: pct(m.addToCart, m.clicks) },
    { label: 'Orders', value: m.orders, rate: pct(m.orders, m.clicks) },
  ];
  const funnelRates: Kpi[] = [
    { key: 'ctr', label: 'Product CTR', value: pct(m.clicks, m.impressions), prev: p ? pct(p.clicks, p.impressions) : null, format: 'percent' },
    { key: 'atc', label: 'Add-to-cart rate', value: pct(m.addToCart, m.clicks), prev: p ? pct(p.addToCart, p.clicks) : null, format: 'percent' },
    { key: 'cvr', label: 'Click-to-order (CVR)', value: pct(m.orders, m.clicks), prev: p ? pct(p.orders, p.clicks) : null, format: 'percent' },
    { key: 'i2o', label: 'Impression-to-order', value: pct(m.orders, m.impressions), prev: p ? pct(p.orders, p.impressions) : null, format: 'percent' },
  ];

  // 14.4 Productivity & Marketing
  const productivity: Kpi[] = [
    { key: 'gmv_per_creator', label: 'GMV per creator', value: div(m.creatorAttributedGmv, m.activeCreators), prev: p ? div(p.creatorAttributedGmv, p.activeCreators) : null, format: 'currency' },
    { key: 'gmv_per_live', label: 'GMV per LIVE stream', value: div(m.liveGmv, m.liveStreams), prev: p ? div(p.liveGmv, p.liveStreams) : null, format: 'currency' },
    { key: 'offsite_pct', label: 'Offsite GMV contribution', value: pct(m.offsiteGmv, m.totalGmv), prev: p ? pct(p.offsiteGmv, p.totalGmv) : null, format: 'percent' },
  ];

  // 14.5 Paid Media Efficiency
  const paid: Kpi[] = [
    { key: 'ad_spend', label: 'Ad Spend', value: m.adSpend, prev: p?.adSpend ?? null, format: 'currency' },
    { key: 'roas', label: 'ROI / ROAS', value: div(m.paidGmv, m.adSpend), prev: p ? div(p.paidGmv, p.adSpend) : null, format: 'ratio' },
    { key: 'cpo', label: 'Cost per order (CPO)', value: div(m.adSpend, m.paidOrders), prev: p ? div(p.adSpend, p.paidOrders) : null, format: 'currency', lowerIsBetter: true },
    { key: 'tacos', label: 'Ad % of GMV (TACoS)', value: pct(m.adSpend, m.totalGmv), prev: p ? pct(p.adSpend, p.totalGmv) : null, format: 'percent', lowerIsBetter: true },
    { key: 'paid_gmv_pct', label: 'Paid GMV contribution', value: pct(m.paidGmv, m.totalGmv), prev: p ? pct(p.paidGmv, p.totalGmv) : null, format: 'percent' },
    { key: 'paid_orders_pct', label: 'Paid orders % of total', value: pct(m.paidOrders, m.orders), prev: p ? pct(p.paidOrders, p.orders) : null, format: 'percent' },
  ];

  // 14.6 Health & Risk Signals (RAG)
  const signals = computeSignals(m, p, slices);

  const sps = m.sps;
  const hasAnyData = [m.totalGmv, m.orders, m.adSpend, m.impressions, m.affiliateGmv].some(v => v != null);

  return {
    northStar,
    mix: { slices, creator: m.creatorContentGmv, seller: m.sellerContentGmv },
    funnel: { stages, rates: funnelRates },
    productivity,
    sps,
    paid,
    signals,
    hasAnyData,
  };
}

function computeSignals(m: ReturnType<typeof metrics>, p: ReturnType<typeof metrics> | null, slices: MixSlice[]): RagSignal[] {
  const out: RagSignal[] = [];
  const wow = (cur: number | null, prev: number | null) => (cur != null && prev != null && prev !== 0) ? (cur - prev) / Math.abs(prev) : null;

  // GMV trend
  const gmvChange = wow(m.totalGmv, p?.totalGmv ?? null);
  out.push({
    key: 'gmv_trend', label: 'GMV trend',
    status: gmvChange == null ? 'na' : gmvChange < -0.15 ? 'red' : gmvChange < 0 ? 'amber' : 'green',
    detail: gmvChange == null ? 'No prior week to compare.'
      : `${gmvChange >= 0 ? 'Up' : 'Down'} ${Math.abs(gmvChange * 100).toFixed(0)}% week-over-week.`,
  });

  // Channel concentration — one surface > ~70% of GMV
  const topShare = slices.reduce((mx, s) => (s.pct != null && s.pct > (mx?.pct ?? -1) ? s : mx), null as MixSlice | null);
  out.push({
    key: 'channel_conc', label: 'Channel concentration',
    status: topShare?.pct == null ? 'na' : topShare.pct > 70 ? 'red' : topShare.pct > 50 ? 'amber' : 'green',
    detail: topShare?.pct == null ? 'Channel mix not available.'
      : `${topShare.label} is ${topShare.pct.toFixed(0)}% of GMV.`,
  });

  // Creator concentration — one creator > ~50% of affiliate GMV
  const cGmvs = m.creators.map(r => n(r?.creator_gmv) ?? 0);
  const cSum = cGmvs.reduce((a, b) => a + b, 0);
  const cMax = cGmvs.length ? Math.max(...cGmvs) : 0;
  const cShare = cSum > 0 ? (cMax / cSum) * 100 : null;
  out.push({
    key: 'creator_conc', label: 'Creator concentration',
    status: cShare == null ? 'na' : cShare > 50 ? 'red' : cShare > 35 ? 'amber' : 'green',
    detail: cShare == null ? 'No creator GMV to compare.'
      : `Top creator drives ${cShare.toFixed(0)}% of affiliate GMV.`,
  });

  // Funnel leak — CTR/ATC dropping while impressions hold/grow
  const ctrNow = pct(m.clicks, m.impressions), ctrPrev = p ? pct(p.clicks, p.impressions) : null;
  const ctrDrop = wow(ctrNow, ctrPrev);
  const imprUp = (m.impressions != null && p?.impressions != null) ? m.impressions >= p.impressions : false;
  out.push({
    key: 'funnel_leak', label: 'Funnel leak',
    status: ctrDrop == null ? 'na' : (ctrDrop < -0.1 && imprUp) ? 'red' : ctrDrop < 0 ? 'amber' : 'green',
    detail: ctrDrop == null ? 'Not enough funnel history.'
      : `CTR ${ctrDrop >= 0 ? 'up' : 'down'} ${Math.abs(ctrDrop * 100).toFixed(0)}%${imprUp ? ' while impressions held' : ''}.`,
  });

  // Content efficiency — GMV/video falling while video count rises
  const gpvNow = div(m.totalGmv, m.newVideos), gpvPrev = p ? div(p.totalGmv, p.newVideos) : null;
  const gpvDrop = wow(gpvNow, gpvPrev);
  const videosUp = (m.newVideos != null && p?.newVideos != null) ? m.newVideos > p.newVideos : false;
  out.push({
    key: 'content_eff', label: 'Content efficiency',
    status: gpvDrop == null ? 'na' : (gpvDrop < 0 && videosUp) ? 'red' : gpvDrop < 0 ? 'amber' : 'green',
    detail: gpvDrop == null ? 'No prior week to compare.'
      : `GMV per video ${gpvDrop >= 0 ? 'up' : 'down'} ${Math.abs(gpvDrop * 100).toFixed(0)}%${videosUp ? ' as output rose' : ''}.`,
  });

  // Ad efficiency — spend rising while ROAS falling
  const roasNow = div(m.paidGmv, m.adSpend), roasPrev = p ? div(p.paidGmv, p.adSpend) : null;
  const roasDrop = wow(roasNow, roasPrev);
  const spendUp = (m.adSpend != null && p?.adSpend != null) ? m.adSpend > p.adSpend : false;
  out.push({
    key: 'ad_eff', label: 'Ad efficiency',
    status: roasDrop == null ? 'na' : (roasDrop < 0 && spendUp) ? 'red' : roasDrop < 0 ? 'amber' : 'green',
    detail: roasDrop == null ? 'No paid history to compare.'
      : `ROAS ${roasDrop >= 0 ? 'up' : 'down'} ${Math.abs(roasDrop * 100).toFixed(0)}%${spendUp ? ' as spend rose' : ''}.`,
  });

  // Ad dependency — TACoS climbing WoW
  const tacosNow = pct(m.adSpend, m.totalGmv), tacosPrev = p ? pct(p.adSpend, p.totalGmv) : null;
  const tacosChange = (tacosNow != null && tacosPrev != null) ? tacosNow - tacosPrev : null;
  out.push({
    key: 'ad_dependency', label: 'Ad dependency (TACoS)',
    status: tacosChange == null ? 'na' : tacosChange > 5 ? 'red' : tacosChange > 0 ? 'amber' : 'green',
    detail: tacosChange == null ? 'No prior week to compare.'
      : `TACoS ${tacosChange >= 0 ? 'up' : 'down'} ${Math.abs(tacosChange).toFixed(1)} pts to ${tacosNow!.toFixed(1)}%.`,
  });

  // Account health — new violations or declining score
  const scoreDrop = (m.sps != null && p?.sps != null) ? m.sps < p.sps : false;
  const hasViolations = (m.violations ?? 0) > 0;
  out.push({
    key: 'account_health', label: 'Account health',
    status: (m.sps == null && m.violations == null) ? 'na' : (hasViolations || scoreDrop) ? (hasViolations ? 'red' : 'amber') : 'green',
    detail: hasViolations ? `${m.violations} violation${m.violations === 1 ? '' : 's'} logged.`
      : scoreDrop ? 'Shop performance score declined.'
      : m.sps != null ? `Score steady at ${m.sps.toFixed(1)}.` : 'No issues flagged.',
  });

  return out;
}
