/**
 * Brand product catalog — the `brand_products` table behind Brand Detail's
 * Products tab and the per-product rows on the GMV Max tab.
 *
 * Commissions are percentages. `shop_ads_commission_not_set` distinguishes
 * "0%" from "we haven't been told yet", which the UI renders differently.
 */
export interface BrandProduct {
  id: string;
  brand_id: string;
  external_product_id: string | null;
  name: string;
  tiktok_link: string | null;
  standard_commission: number;
  shop_ads_commission: number;
  shop_ads_commission_not_set: boolean;
  created_at: string;
  updated_at: string;
}
