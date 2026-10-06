-- =========================================================
-- Brand SOPs — one standard-operating-procedure document per brand.
--
-- The document is `sections jsonb`: an ordered array of
-- {id, kind, title, body?}. The fixed spine (Focus Products, Tasks, GMV Max,
-- Discounts, Resource Links) is re-imposed by the app on every read
-- (src/pages/sops/sopSections.ts → normalizeSections), so the jsonb only has
-- to carry the WRITTEN bodies. Derived sections store nothing; their data is
-- read live (loadSopLive in the app, the `live` bag of sop_shared here).
--
-- Write: Bob + the brand's Team Lead.  Read: also the assigned APC and Ads
-- Manager.  Anyone else only through the share link (/sop/<token>).
--
-- Idempotent — also folded into supabase/schema_baseline.sql (§13).
-- =========================================================

create table if not exists public.brand_sops (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null unique references public.brands(id) on delete cascade,
  sections      jsonb not null default '[]'::jsonb,
  share_enabled boolean not null default false,
  -- 32 hex chars from a v4 uuid (122 random bits). gen_random_uuid() is core,
  -- so this does not depend on which schema pgcrypto landed in.
  share_token   text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists brand_sops_set_updated_at on public.brand_sops;
create trigger brand_sops_set_updated_at before update on public.brand_sops
  for each row execute function public.set_updated_at();

-- Who may write a brand's SOP: Bob, or the Team Lead holding the brand.
create or replace function public.sop_editor(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_bob() or public.team_lead_has_brand(b_id);
$$;

-- Who may read it in the app: editors + the assigned APC + the Ads Manager.
create or replace function public.sop_reader(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_has_brand_access(b_id) or public.ads_manager_has_brand(b_id);
$$;

alter table public.brand_sops enable row level security;

drop policy if exists "sops read" on public.brand_sops;
create policy "sops read" on public.brand_sops
  for select using (public.sop_reader(brand_id));

drop policy if exists "sops insert" on public.brand_sops;
create policy "sops insert" on public.brand_sops
  for insert with check (public.sop_editor(brand_id));

drop policy if exists "sops update" on public.brand_sops;
create policy "sops update" on public.brand_sops
  for update using (public.sop_editor(brand_id)) with check (public.sop_editor(brand_id));

drop policy if exists "sops delete" on public.brand_sops;
create policy "sops delete" on public.brand_sops
  for delete using (public.sop_editor(brand_id));

-- Rotate the share link. SECURITY INVOKER: the UPDATE runs under the caller's
-- RLS, so only an editor can rotate (anyone else updates zero rows → null).
create or replace function public.sop_reset_share_token(p_id uuid)
returns text language sql volatile security invoker set search_path = public as $$
  update public.brand_sops
     set share_token = replace(gen_random_uuid()::text, '-', ''),
         updated_by  = auth.uid()
   where id = p_id
  returning share_token;
$$;

-- Public read of a shared SOP. Granted to anon. Checks the token AND
-- share_enabled before returning anything, takes no brand parameter, and pins
-- every live select to the SOP's own brand. Returns null for a bad/disabled
-- link. The `live` bag mirrors loadSopLive() in sopSections.ts — change both
-- together.
create or replace function public.sop_shared(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'brand_name', b.name,
    'sections',   s.sections,
    'updated_at', s.updated_at,
    'live', jsonb_build_object(
      'scope', to_jsonb(coalesce(b.scope, '{}'::text[])),
      'products', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', p.id,
                 'name', p.name,
                 'external_product_id', p.external_product_id,
                 'tiktok_link', p.tiktok_link,
                 'standard_commission', p.standard_commission,
                 'shop_ads_commission', p.shop_ads_commission,
                 'shop_ads_commission_not_set', p.shop_ads_commission_not_set
               ) order by p.name)
          from public.brand_products p
         where p.brand_id = s.brand_id), '[]'::jsonb),
      'samples', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'external_product_id', sp.external_product_id,
                 'name', sp.name,
                 'monthly_goals', sp.monthly_goals
               ) order by sp.sort_order, sp.created_at)
          from public.brand_samples_products sp
         where sp.brand_id = s.brand_id), '[]'::jsonb),
      'resources', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', r.id,
                 'name', r.name,
                 'url', r.url,
                 'description', r.description
               ) order by r.pinned desc, r.sort_order, r.name)
          from public.resources r
         where r.scope = 'brand' and r.brand_id = s.brand_id), '[]'::jsonb)
    )
  )
  from public.brand_sops s
  join public.brands b on b.id = s.brand_id
  where s.share_token = p_code
    and s.share_enabled
    and length(coalesce(p_code, '')) >= 16;
$$;

grant all on public.brand_sops to anon, authenticated, service_role;
grant execute on function public.sop_editor(uuid)            to authenticated;
grant execute on function public.sop_reader(uuid)            to authenticated;
grant execute on function public.sop_reset_share_token(uuid) to authenticated;
grant execute on function public.sop_shared(text)            to anon, authenticated;
