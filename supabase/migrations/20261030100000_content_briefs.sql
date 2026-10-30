-- =========================================================
-- Content Briefs — free-form HTML briefs written by Claude.
--
-- There is no fixed structure: Claude designs each brief as a self-contained
-- HTML page (the way it makes an artifact) and saves it through the Supabase
-- MCP by calling save_content_brief(). The app only stores and shows it, in a
-- sandboxed iframe (allow-scripts, NEVER allow-same-origin), in Brand Detail →
-- Briefs and on the public /brief/<token> page.
--
-- A brief keeps every version: each save appends a row to
-- content_brief_versions and bumps content_briefs.current_version. Restoring an
-- old version is just saving its HTML again.
--
-- Claude's flow (via the Supabase MCP, which runs as postgres → bypasses RLS):
--   1. select public.content_brief_context('<brand uuid>');   -- brand, products,
--      sample goals, resources, SOP sections, existing briefs
--   2. select public.save_content_brief('<brand uuid>', 'Launch brief', '<html>');
--   3. edits: select public.content_brief_html('<brief uuid>');  then
--      select public.save_content_brief('<brand uuid>', null, '<html>', '<brief uuid>', 'Bigger hooks');
--
-- Access in the app mirrors SOPs: write = Bob + the brand's Team Lead
-- (sop_editor), read = also the assigned APC + Ads Manager (sop_reader).
--
-- Idempotent — also folded into supabase/schema_baseline.sql (§11d).
-- =========================================================

create table if not exists public.content_briefs (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brands(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 200),
  current_version int  not null default 0,
  share_enabled   boolean not null default false,
  share_token     text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by      uuid references auth.users(id) on delete set null,
  updated_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists content_briefs_brand_idx on public.content_briefs(brand_id, updated_at desc);

create table if not exists public.content_brief_versions (
  id         uuid primary key default gen_random_uuid(),
  brief_id   uuid not null references public.content_briefs(id) on delete cascade,
  version    int  not null,
  -- 2 MB cap: a brief is one page of HTML/CSS/JS; images belong on a CDN/URL.
  html       text not null check (length(html) between 1 and 2000000),
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (brief_id, version)
);

drop trigger if exists content_briefs_set_updated_at on public.content_briefs;
create trigger content_briefs_set_updated_at before update on public.content_briefs
  for each row execute function public.set_updated_at();

alter table public.content_briefs         enable row level security;
alter table public.content_brief_versions enable row level security;

drop policy if exists "briefs read" on public.content_briefs;
create policy "briefs read" on public.content_briefs
  for select using (public.sop_reader(brand_id));

drop policy if exists "briefs insert" on public.content_briefs;
create policy "briefs insert" on public.content_briefs
  for insert with check (public.sop_editor(brand_id));

drop policy if exists "briefs update" on public.content_briefs;
create policy "briefs update" on public.content_briefs
  for update using (public.sop_editor(brand_id)) with check (public.sop_editor(brand_id));

drop policy if exists "briefs delete" on public.content_briefs;
create policy "briefs delete" on public.content_briefs
  for delete using (public.sop_editor(brand_id));

-- Versions are append-only: no update/delete policy (they go with the brief
-- through the cascade).
drop policy if exists "brief versions read" on public.content_brief_versions;
create policy "brief versions read" on public.content_brief_versions
  for select using (exists (
    select 1 from public.content_briefs b
     where b.id = brief_id and public.sop_reader(b.brand_id)));

drop policy if exists "brief versions insert" on public.content_brief_versions;
create policy "brief versions insert" on public.content_brief_versions
  for insert with check (exists (
    select 1 from public.content_briefs b
     where b.id = brief_id and public.sop_editor(b.brand_id)));

-- Create a brief (p_brief null) or append a version to one. SECURITY INVOKER:
-- app users go through the RLS above; the Supabase MCP (postgres) bypasses it.
-- p_name renames when given. Returns {brief_id, version, share_token}.
create or replace function public.save_content_brief(
  p_brand uuid,
  p_name  text,
  p_html  text,
  p_brief uuid default null,
  p_note  text default null
) returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  v_brief public.content_briefs%rowtype;
  v_next  int;
begin
  if coalesce(btrim(p_html), '') = '' then
    raise exception 'save_content_brief: html is empty';
  end if;

  if p_brief is null then
    if coalesce(btrim(p_name), '') = '' then
      raise exception 'save_content_brief: a new brief needs a name';
    end if;
    insert into public.content_briefs (brand_id, name, created_by, updated_by)
    values (p_brand, btrim(p_name), auth.uid(), auth.uid())
    returning * into v_brief;
  else
    select * into v_brief from public.content_briefs where id = p_brief for update;
    if not found then
      raise exception 'save_content_brief: brief % not found (or no access)', p_brief;
    end if;
    if p_brand is not null and v_brief.brand_id <> p_brand then
      raise exception 'save_content_brief: brief % belongs to another brand', p_brief;
    end if;
  end if;

  v_next := v_brief.current_version + 1;
  insert into public.content_brief_versions (brief_id, version, html, note, created_by)
  values (v_brief.id, v_next, p_html, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  update public.content_briefs
     set current_version = v_next,
         name            = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         updated_by      = auth.uid()
   where id = v_brief.id;

  return jsonb_build_object('brief_id', v_brief.id, 'version', v_next, 'share_token', v_brief.share_token);
end;
$$;

-- The current (or a given) version's HTML — what Claude reads before an edit.
create or replace function public.content_brief_html(p_brief uuid, p_version int default null)
returns text language sql stable security invoker set search_path = public as $$
  select v.html
    from public.content_brief_versions v
    join public.content_briefs b on b.id = v.brief_id
   where v.brief_id = p_brief
     and v.version = coalesce(p_version, b.current_version);
$$;

-- Everything Claude needs to write a brief for one brand, in one call.
-- SECURITY INVOKER, so an app user only gets what RLS already shows them.
create or replace function public.content_brief_context(p_brand uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'brand', jsonb_build_object(
      'id', b.id, 'name', b.name, 'client', b.client, 'region', b.region,
      'currency', b.currency, 'scope', to_jsonb(coalesce(b.scope, '{}'::text[])),
      'status', b.client_status, 'notes', b.notes),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', p.name,
               'external_product_id', p.external_product_id,
               'tiktok_link', p.tiktok_link,
               'standard_commission', p.standard_commission,
               'shop_ads_commission', case when p.shop_ads_commission_not_set then null else p.shop_ads_commission end
             ) order by p.name)
        from public.brand_products p where p.brand_id = b.id), '[]'::jsonb),
    'sample_goals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', sp.name,
               'external_product_id', sp.external_product_id,
               'monthly_goals', sp.monthly_goals
             ) order by sp.sort_order, sp.created_at)
        from public.brand_samples_products sp where sp.brand_id = b.id), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', r.name, 'url', r.url, 'description', r.description
             ) order by r.pinned desc, r.sort_order, r.name)
        from public.resources r where r.scope = 'brand' and r.brand_id = b.id), '[]'::jsonb),
    'sop_sections', (select s.sections from public.brand_sops s where s.brand_id = b.id),
    'existing_briefs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', cb.id, 'name', cb.name, 'version', cb.current_version, 'updated_at', cb.updated_at
             ) order by cb.updated_at desc)
        from public.content_briefs cb where cb.brand_id = b.id), '[]'::jsonb)
  )
  from public.brands b
  where b.id = p_brand;
$$;

-- Rotate the share link (invoker: only an editor's UPDATE touches a row).
create or replace function public.content_brief_reset_share_token(p_id uuid)
returns text language sql volatile security invoker set search_path = public as $$
  update public.content_briefs
     set share_token = replace(gen_random_uuid()::text, '-', ''),
         updated_by  = auth.uid()
   where id = p_id
  returning share_token;
$$;

-- Public read of a shared brief (anon). Checks token + share_enabled; returns
-- only the current version. null = bad or disabled link.
create or replace function public.content_brief_shared(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'brand_name', b.name,
    'name',       cb.name,
    'html',       v.html,
    'updated_at', cb.updated_at
  )
  from public.content_briefs cb
  join public.brands b on b.id = cb.brand_id
  join public.content_brief_versions v on v.brief_id = cb.id and v.version = cb.current_version
  where cb.share_token = p_code
    and cb.share_enabled
    and length(coalesce(p_code, '')) >= 16;
$$;

grant all on public.content_briefs, public.content_brief_versions to authenticated, service_role;
revoke all on public.content_briefs, public.content_brief_versions from anon;
revoke all on function public.save_content_brief(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.content_brief_html(uuid, int)                   from public, anon;
revoke all on function public.content_brief_context(uuid)                     from public, anon;
revoke all on function public.content_brief_reset_share_token(uuid)           from public, anon;
grant execute on function public.save_content_brief(uuid, text, text, uuid, text) to authenticated, service_role;
grant execute on function public.content_brief_html(uuid, int)                   to authenticated, service_role;
grant execute on function public.content_brief_context(uuid)                     to authenticated, service_role;
grant execute on function public.content_brief_reset_share_token(uuid)           to authenticated, service_role;
grant execute on function public.content_brief_shared(text)                      to anon, authenticated, service_role;
