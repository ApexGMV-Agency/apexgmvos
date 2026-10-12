// Trend series for the v3 dashboard (ReportDashboardV3), built from a run of
// reports' raw content, oldest first — the last point is the open report.
// Used by the monthly v3 views; each point's label is supplied by the caller
// ("Mar", "Apr", …) so the same builder serves any period.

const toN = (v: any): number | null =>
  (v == null || v === '') ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

export function buildV3Series(rows: { label: string; content: any }[]) {
  const pts = rows.map(r => ({ label: r.label, cn: (r.content ?? {}) as any }));
  return {
    wow: pts.map(({ label, cn }) => ({
      label, gmv: Number(cn?.overall?.total_gmv) || 0, orders: Number(cn?.overall?.orders) || 0,
    })),
    sampleSeries: pts.map(({ label, cn }) => ({
      label, samples: toN(cn?.sampling?.samples_approved), videos: toN(cn?.sampling?.new_videos_posted),
    })),
    offsiteSeries: pts.map(({ label, cn }) => ({
      label,
      offsite_gmv: toN(cn?.offsite?.offsite_gmv),
      tiktok_shop_gmv: toN(cn?.offsite?.tiktok_shop_gmv),
      offsite_effect: toN(cn?.offsite?.offsite_effect),
    })),
    affiliateSeries: pts.map(({ label, cn }) => ({
      label,
      affiliate_gmv: toN(cn?.affiliate?.affiliate_gmv),
      live_sessions: toN(cn?.affiliate?.live_sessions),
      contacted_creators: toN(cn?.affiliate?.contacted_creators),
    })),
    gmvMaxSeries: pts.map(({ label, cn }) => {
      const gr: any[] = Array.isArray(cn?.gmv_max) ? cn.gmv_max : [];
      const nv = (v: any) => Number(v) || 0;
      const cost = gr.reduce((s, r) => s + nv(r.cost), 0);
      const rev = gr.reduce((s, r) => s + nv(r.gross_revenue), 0);
      const orders = gr.reduce((s, r) => s + nv(r.sku_orders), 0);
      return {
        label,
        ad_spend: gr.length ? cost : null, revenue: gr.length ? rev : null,
        roas: cost > 0 ? rev / cost : null, cpo: orders > 0 ? cost / orders : null,
      };
    }),
  };
}

/** "2026-03" -> "Mar" (chart axis label for a monthly report). */
export function shortMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short' });
}
