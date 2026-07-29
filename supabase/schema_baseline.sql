-- =========================================================
-- ApexGMVOS — consolidated baseline schema
--
-- Run this ONCE, top to bottom, in a NEW empty Supabase project's SQL editor.
-- It replaces the old supabase/schema*.sql + 144 dated migrations (archived
-- under supabase/legacy/), folded into their final shape and with three
-- feature areas removed entirely:
--
--   * Paid Collab  (handler workspace, client portal, legacy paid_creator_*,
--                   creator directory, contracts, AI content briefs)
--   * Tasks        (tasks, folders, labels, reminders, recurrences)
--   * Chats        (conversations, messages, brand groups, bookmarks, notes)
--
-- What remains: profiles/roles, brands, clients, weekly + monthly reporting
-- (incl. review, comments, approvals, share links, canvas templates), GMV Max,
-- sample seeding, products, payments, billing, company budget, resources and
-- notifications.
--
-- Roles: bob (+ is_superbob flag), team_lead, apc, ads_manager, pending.
--
-- Idempotent: every object uses "if not exists" / "or replace" / a guarded
-- DO block, so re-running is safe.
-- =========================================================

create extension if not exists pgcrypto;

-- =========================================================
-- 1. Shared trigger function
-- =========================================================

-- search_path is pinned on every function in this file, including this one:
-- an unpinned search_path on a trigger function is a privilege-escalation
-- vector (Supabase's security linter flags it as function_search_path_mutable).
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

-- =========================================================
-- 2. Tables
-- =========================================================

-- ---------- 2.1 Identity ----------

create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text not null,
  full_name          text,
  role               text not null default 'pending',
  avatar_url         text,
  -- Per-user permission flags.
  can_edit_brands    boolean not null default false,
  can_manage_gmv_max boolean not null default false,
  -- Super Boss: a flag on a role='bob' account, never a role string of its own,
  -- so every is_bob() / role='bob' check keeps working unchanged.
  is_superbob        boolean not null default false,
  -- Which Team Lead owns this APC (null = directly under Bob).
  team_lead_id       uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists profiles_team_lead_idx on public.profiles(team_lead_id);

create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.brands (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  client        text not null,
  client_id     uuid references public.clients(id),
  -- Multi-tag scope: 'ads' (GMV Max), 'samples', … Drives Ads Manager auto-assign.
  scope         text[] not null default '{}'::text[],
  client_status text not null default 'in_progress',
  shop_code     text,
  notes         text,
  region        text not null default 'US',
  -- Kept in sync with region (US→USD, UK→GBP, EURO→EUR); read by every money formatter.
  currency      text not null default 'USD',
  share_enabled boolean not null default false,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint brands_client_status_check
    check (client_status in ('onboarding', 'in_progress', 'paused', 'closed')),
  constraint brands_region_check check (region in ('US', 'UK', 'EURO'))
);
create index if not exists brands_client_status_idx on public.brands(client_status);
create index if not exists brands_shop_code_idx     on public.brands(shop_code);
create index if not exists brands_client_id_idx     on public.brands(client_id);

-- ---------- 2.2 Brand assignment ----------

create table if not exists public.apc_brands (
  apc_id      uuid not null references public.profiles(id) on delete cascade,
  brand_id    uuid not null references public.brands(id)   on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (apc_id, brand_id)
);
create index if not exists apc_brands_apc_idx   on public.apc_brands(apc_id);
create index if not exists apc_brands_brand_idx on public.apc_brands(brand_id);

-- Bob → Team Lead grant. One brand → one Team Lead (best-effort unique below).
create table if not exists public.team_lead_brands (
  team_lead_id uuid not null references public.profiles(id) on delete cascade,
  brand_id     uuid not null references public.brands(id)   on delete cascade,
  assigned_at  timestamptz not null default now(),
  primary key (team_lead_id, brand_id)
);
create index if not exists tlb_lead_idx  on public.team_lead_brands(team_lead_id);
create index if not exists tlb_brand_idx on public.team_lead_brands(brand_id);

do $$
begin
  begin
    alter table public.team_lead_brands
      add constraint team_lead_brands_brand_uniq unique (brand_id);
  exception when others then
    null;  -- already present; the UI also prevents duplicates.
  end;
end $$;

-- Derived set: (every ads_manager) × (every brand whose scope contains 'ads').
-- Rebuilt by reconcile_ads_manager_brands(); NOT exclusive with APC/Team Lead.
create table if not exists public.ads_manager_brands (
  ads_manager_id uuid not null references public.profiles(id) on delete cascade,
  brand_id       uuid not null references public.brands(id)   on delete cascade,
  assigned_at    timestamptz not null default now(),
  primary key (ads_manager_id, brand_id)
);
create index if not exists amb_manager_idx on public.ads_manager_brands(ads_manager_id);
create index if not exists amb_brand_idx   on public.ads_manager_brands(brand_id);

-- ---------- 2.3 Reporting ----------

-- Canvas template builder. Reports may optionally point at one.
create table if not exists public.report_templates (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  report_kind    text not null default 'weekly'
                   check (report_kind in ('weekly', 'monthly', 'custom')),
  is_global      boolean not null default false,
  schema_json    jsonb not null default jsonb_build_object(
                   'version', 1,
                   'canvas', jsonb_build_object('width', 1200, 'background', '#ffffff'),
                   'blocks', '[]'::jsonb
                 ),
  schema_version int not null default 1,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists report_templates_kind_idx   on public.report_templates(report_kind);
create index if not exists report_templates_global_idx on public.report_templates(is_global) where is_global;

create table if not exists public.report_template_brands (
  template_id uuid not null references public.report_templates(id) on delete cascade,
  brand_id    uuid not null references public.brands(id)           on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (template_id, brand_id)
);
create index if not exists rtb_brand_idx on public.report_template_brands(brand_id);

-- Per-brand start of the weekly reporting cycle. Set once, then fixed.
create table if not exists public.brand_report_settings (
  brand_id      uuid primary key references public.brands(id) on delete cascade,
  weekly_anchor date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.weekly_reports (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id) on delete cascade,
  created_by    uuid references auth.users(id) on delete set null,
  week_start    date not null,
  week_end      date not null,
  week_number   int  not null,                    -- 1-based; 1 == anchor week
  status        text not null default 'draft',    -- draft | submitted
  content       jsonb not null default '{}'::jsonb,
  is_shared     boolean not null default false,
  template_id   uuid references public.report_templates(id) on delete set null,
  -- Internal APC → Team Lead review.
  review_status text not null default 'none',
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (brand_id, week_start),
  constraint weekly_reports_review_status_ck
    check (review_status in ('none','submitted','approved','rejected'))
);
create index if not exists weekly_reports_brand_idx     on public.weekly_reports(brand_id);
create index if not exists weekly_reports_creator_idx   on public.weekly_reports(created_by);
create index if not exists weekly_reports_week_idx      on public.weekly_reports(week_start);
create index if not exists weekly_reports_is_shared_idx on public.weekly_reports(brand_id) where is_shared;
create index if not exists weekly_reports_template_idx  on public.weekly_reports(template_id) where template_id is not null;

create table if not exists public.monthly_reports (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id) on delete cascade,
  month         text not null,                    -- 'YYYY-MM'
  status        text not null default 'draft',
  content       jsonb not null default '{}'::jsonb,
  is_shared     boolean not null default false,
  template_id   uuid references public.report_templates(id) on delete set null,
  review_status text not null default 'none',
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (brand_id, month),
  constraint monthly_reports_review_status_ck
    check (review_status in ('none','submitted','approved','rejected'))
);
create index if not exists monthly_reports_brand_idx     on public.monthly_reports(brand_id);
create index if not exists monthly_reports_brand_month   on public.monthly_reports(brand_id, month);
create index if not exists monthly_reports_is_shared_idx on public.monthly_reports(brand_id) where is_shared;
create index if not exists monthly_reports_template_idx  on public.monthly_reports(template_id) where template_id is not null;

-- Polymorphic across weekly + monthly: report_id carries NO foreign key, and
-- cleanup_*_report_refs() triggers stand in for cascade delete.
-- `section` is intentionally unconstrained — custom sections use free-form ids.
create table if not exists public.report_comments (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null,
  report_type text not null default 'weekly',
  section     text not null,
  author_type text not null check (author_type in ('client','bob','apc')),
  author_name text not null,
  body        text not null,
  parent_id   uuid references public.report_comments(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists rc_report_idx        on public.report_comments(report_id);
create index if not exists rc_section_idx       on public.report_comments(report_id, section);
create index if not exists rc_parent_idx        on public.report_comments(parent_id);
create index if not exists report_comments_type_id on public.report_comments(report_type, report_id);

create table if not exists public.report_share_links (
  id                      uuid primary key default gen_random_uuid(),
  token                   text unique not null,
  label                   text,
  client_id               uuid not null references public.clients(id) on delete cascade,
  brand_ids               uuid[] not null default '{}'::uuid[],
  resource_ids            uuid[] not null default '{}'::uuid[],
  include_reports         boolean not null default true,
  include_monthly_reports boolean not null default false,
  include_resources       boolean not null default true,
  link_mode               text not null default 'brand',
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  revoked_at              timestamptz,
  constraint report_share_links_link_mode_check check (link_mode in ('brand','general'))
);
create index if not exists rsl_token_idx on public.report_share_links(token);

-- One client decision per (report × share link). Written by the
-- post-approval-decision edge function under the service role.
create table if not exists public.report_approval_decisions (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null,
  report_type     text not null default 'weekly',
  share_link_id   uuid not null references public.report_share_links(id) on delete cascade,
  decision        text not null check (decision in ('approved', 'changes_requested')),
  comment         text,
  decided_by_name text not null,
  decided_at      timestamptz not null default now(),
  unique (report_id, share_link_id)
);
create index if not exists rad_report_idx on public.report_approval_decisions(report_id);
create index if not exists rad_link_idx   on public.report_approval_decisions(share_link_id);
create index if not exists report_approval_decisions_type_id
  on public.report_approval_decisions(report_type, report_id);

-- Shared preset libraries (weekly + monthly).
create table if not exists public.section_presets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  payload    jsonb not null,
  kind       text not null default 'custom',
  section_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint section_presets_kind_check check (kind in ('custom','standard'))
);
create index if not exists section_presets_created_at_idx on public.section_presets(created_at desc);
create index if not exists section_presets_kind_idx       on public.section_presets(kind, section_id);

create table if not exists public.monthly_section_presets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  payload    jsonb not null,
  kind       text not null default 'custom',
  section_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- 2.4 GMV Max ----------

create table if not exists public.brand_gmv_max_monthly (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  month            text not null,                 -- 'YYYY-MM'
  allocated_budget numeric(14,2) not null default 0,
  spend_to_date    numeric(14,2) not null default 0,
  target_roi       numeric(10,4) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (brand_id, month)
);
create index if not exists bgmm_brand_idx on public.brand_gmv_max_monthly(brand_id);

-- Parent weekly row. ad_spend/roi/orders/cpo/gmv are AUTO-COMPUTED from the
-- product children by gmv_max_weekly_recompute().
create table if not exists public.brand_gmv_max_weekly (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  week_start date not null,
  week_end   date not null,
  ad_spend   numeric(14,2) not null default 0,
  roi        numeric(10,4) not null default 0,
  orders     integer not null default 0,
  cpo        numeric(14,2) not null default 0,
  gmv        numeric(14,2) not null default 0,
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, week_start)
);
create index if not exists bgmw_brand_idx      on public.brand_gmv_max_weekly(brand_id);
create index if not exists bgmw_brand_week_idx on public.brand_gmv_max_weekly(brand_id, week_start);

create table if not exists public.brand_products (
  id                          uuid primary key default gen_random_uuid(),
  brand_id                    uuid not null references public.brands(id) on delete cascade,
  external_product_id         text,
  name                        text not null,
  tiktok_link                 text,
  standard_commission         numeric(6,2) not null default 0,
  shop_ads_commission         numeric(6,2) not null default 0,
  shop_ads_commission_not_set boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists bp_brand_idx on public.brand_products(brand_id);

-- Per-product breakdown of a weekly GMV Max entry, plus one "Other Products" row.
create table if not exists public.brand_gmv_max_weekly_products (
  id         uuid primary key default gen_random_uuid(),
  weekly_id  uuid not null references public.brand_gmv_max_weekly(id) on delete cascade,
  product_id uuid references public.brand_products(id) on delete set null,
  is_other   boolean not null default false,
  ad_spend   numeric(14,2) not null default 0,
  roi        numeric(10,4) not null default 0,
  orders     integer not null default 0,
  cpo        numeric(14,2) not null default 0,
  gmv        numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bgmwp_weekly_idx on public.brand_gmv_max_weekly_products(weekly_id);
create unique index if not exists bgmwp_weekly_product_uidx
  on public.brand_gmv_max_weekly_products(weekly_id, product_id) where product_id is not null;
create unique index if not exists bgmwp_weekly_other_uidx
  on public.brand_gmv_max_weekly_products(weekly_id) where is_other;

-- Free-text per-product weekly entries feeding weekly report §11.2.
create table if not exists public.brand_gmv_max_product_weekly (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  week_start date not null,
  week_end   date not null,
  product    text not null default '',
  product_id text not null default '',
  spend      numeric(14,2) not null default 0,
  orders     integer not null default 0,
  gmv        numeric(14,2) not null default 0,
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bgmpw_brand_idx      on public.brand_gmv_max_product_weekly(brand_id);
create index if not exists bgmpw_brand_week_idx on public.brand_gmv_max_product_weekly(brand_id, week_start);

-- ---------- 2.5 Sample seeding ----------

create table if not exists public.brand_samples_products (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brands(id) on delete cascade,
  external_product_id text,
  name                text not null,
  -- Legacy single global goal; still read as a fallback by BrandSamplesTab.
  monthly_goal        int,
  -- Current model: { 'YYYY-MM': goal } so each month is edited independently.
  monthly_goals       jsonb not null default '{}'::jsonb,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists bsp_brand_idx on public.brand_samples_products(brand_id);

create table if not exists public.brand_samples_periods (
  brand_id   uuid not null references public.brands(id) on delete cascade,
  month      text not null,                       -- 'YYYY-MM'
  total_goal int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (brand_id, month)
);

create table if not exists public.brand_samples_daily (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.brands(id) on delete cascade,
  entry_date     date not null,
  new_videos     int,
  live_sessions  int,
  daily_sps      numeric(3,1),
  reason_of_drop text,
  others_count   int not null default 0,
  -- { '<brand_samples_products.id>': count }
  product_counts jsonb not null default '{}'::jsonb,
  dump_usernames text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (brand_id, entry_date)
);
create index if not exists bsd_brand_date_idx on public.brand_samples_daily(brand_id, entry_date);

create table if not exists public.brand_samples_weekly_gmv (
  brand_id      uuid not null references public.brands(id) on delete cascade,
  month         text not null,
  week_index    int not null check (week_index between 1 and 5),
  affiliate_gmv numeric(14,2),
  updated_at    timestamptz not null default now(),
  primary key (brand_id, month, week_index)
);

-- ---------- 2.6 Money (Bob-only) ----------

create table if not exists public.brand_payments (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  month      date not null,                       -- first day of the billing month
  amount     numeric(10,2) not null default 0,
  paid_at    timestamptz not null default now(),
  notes      text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, month)
);
create index if not exists brand_payments_brand_idx on public.brand_payments(brand_id);
create index if not exists brand_payments_month_idx on public.brand_payments(month);

-- The management fee lives here, NOT on brands: RLS is row-level and cannot
-- hide a single column, so an APC reading brands.* would have seen the fee.
create table if not exists public.brand_billing (
  brand_id    uuid primary key references public.brands(id) on delete cascade,
  monthly_fee numeric(10,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.income_entries (
  id          uuid primary key default gen_random_uuid(),
  month       date not null,
  source      text not null,
  amount      numeric(12,2) not null default 0,
  received_at date,
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists income_entries_month_idx on public.income_entries(month);

create table if not exists public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  icon       text default 'bi-tag',
  color      text default '#6e6e80',
  sort_order int not null default 100,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.expense_entries (
  id          uuid primary key default gen_random_uuid(),
  month       date not null,
  category_id uuid references public.expense_categories(id) on delete set null,
  label       text not null,
  amount      numeric(12,2) not null default 0,
  spent_at    date,
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists expense_entries_month_idx    on public.expense_entries(month);
create index if not exists expense_entries_category_idx on public.expense_entries(category_id);

-- ---------- 2.7 Resources ----------

create table if not exists public.resource_folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  scope      text not null check (scope in ('general','brand')),
  brand_id   uuid references public.brands(id) on delete cascade,
  parent_id  uuid references public.resource_folders(id) on delete cascade,
  pinned     boolean not null default false,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resource_folders_scope_brand_ck check (
    (scope = 'general' and brand_id is null)
    or (scope = 'brand' and brand_id is not null)
  )
);
create index if not exists resource_folders_parent_idx on public.resource_folders(parent_id);
create index if not exists resource_folders_brand_idx  on public.resource_folders(brand_id);
create index if not exists resource_folders_scope_idx  on public.resource_folders(scope);
create index if not exists resource_folders_pinned_idx on public.resource_folders(pinned) where pinned;

create table if not exists public.resources (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  url            text not null,
  description    text,
  scope          text not null default 'general' check (scope in ('general','brand')),
  brand_id       uuid references public.brands(id) on delete cascade,
  folder_id      uuid references public.resource_folders(id) on delete set null,
  -- Legacy free-text folder name, superseded by folder_id but still read.
  general_folder text,
  pinned         boolean not null default false,
  sort_order     int not null default 0,
  is_shared      boolean not null default false,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint scope_brand_consistency check (
    (scope = 'general' and brand_id is null)
    or (scope = 'brand' and brand_id is not null)
  )
);
create index if not exists resources_brand_idx          on public.resources(brand_id);
create index if not exists resources_scope_idx          on public.resources(scope);
create index if not exists resources_folder_idx         on public.resources(folder_id);
create index if not exists resources_pinned_idx         on public.resources(pinned) where pinned;
create index if not exists resources_is_shared_idx      on public.resources(brand_id) where is_shared;
create index if not exists resources_general_folder_idx on public.resources(general_folder) where scope = 'general';

create table if not exists public.resource_comments (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  parent_id   uuid references public.resource_comments(id) on delete cascade,
  author_type text not null check (author_type in ('client','bob','apc')),
  author_name text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists rsc_resource_idx on public.resource_comments(resource_id);
create index if not exists rsc_parent_idx   on public.resource_comments(parent_id);

-- ---------- 2.8 Notifications ----------

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- 'client_comment' | 'reply' | 'report_review' | 'team_assignment'
  -- | 'brand_assignment' | 'role_change'
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  payload    jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx    on public.notifications(user_id, read_at, created_at desc);
create index if not exists notifications_created_idx on public.notifications(created_at);

-- Single-row throttle for the (currently disabled) auto-purge sweep.
create table if not exists public.notifications_purge_state (
  id             boolean primary key default true check (id),
  last_purged_at timestamptz not null default '-infinity'
);
insert into public.notifications_purge_state (id) values (true) on conflict (id) do nothing;

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- =========================================================
-- 3. updated_at triggers
-- =========================================================

do $$
declare t text;
begin
  foreach t in array array[
    'brands', 'brand_report_settings', 'weekly_reports', 'monthly_reports',
    'report_templates', 'brand_gmv_max_monthly', 'brand_gmv_max_weekly',
    'brand_gmv_max_weekly_products', 'brand_gmv_max_product_weekly',
    'brand_samples_periods', 'brand_samples_daily', 'brand_samples_weekly_gmv',
    'brand_products', 'brand_payments', 'brand_billing',
    'income_entries', 'expense_entries', 'resources', 'resource_folders'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;

-- =========================================================
-- 4. Helper functions
--
-- All SECURITY DEFINER so RLS policies can call them without recursing back
-- into the policies on profiles / *_brands.
-- =========================================================

create or replace function public.is_bob()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'bob');
$$;

-- Super Boss: role bob + flag. Gates only the EXTRA powers (Bob account
-- management, changing anyone's is_superbob, demoting another Super Boss).
create or replace function public.is_superbob()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'bob' and is_superbob
  );
$$;

create or replace function public.is_apc()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'apc');
$$;

create or replace function public.is_team_lead()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'team_lead');
$$;

create or replace function public.is_ads_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'ads_manager');
$$;

-- Is a GIVEN user a Bob? (Lets a policy check someone else's role without
-- depending on the caller's read access to profiles.)
create or replace function public.is_bob_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and role = 'bob');
$$;

-- Everyone with an internal staff seat. Previously derived from the chat
-- roster (is_chat_staff); with Chats removed this is a plain role check.
create or replace function public.is_internal_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('bob', 'team_lead', 'apc', 'ads_manager')
  );
$$;

create or replace function public.my_team_lead()
returns uuid language sql stable security definer set search_path = public as $$
  select team_lead_id from public.profiles where id = auth.uid();
$$;

-- Does the calling Team Lead hold a Bob-granted assignment for this brand?
create or replace function public.team_lead_has_brand(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_lead_brands tlb
    where tlb.team_lead_id = auth.uid() and tlb.brand_id = b_id
  );
$$;

-- Does the calling Team Lead own this APC profile?
create or replace function public.manages_apc(apc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = apc and p.role = 'apc' and p.team_lead_id = auth.uid()
  );
$$;

create or replace function public.ads_manager_has_brand(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ads_manager_brands amb
    where amb.ads_manager_id = auth.uid() and amb.brand_id = b_id
  );
$$;

-- Is there a Team Lead who can review this brand's reports?
create or replace function public.brand_has_team_lead(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_lead_brands where brand_id = b_id);
$$;

-- Backs the `for all` policies on brand_products and the template tables.
-- Historically this also carried paid-collab client/handler arms; with that
-- module gone it is bob / assigned APC / assigned Team Lead. Ads Managers are
-- deliberately excluded — they must stay read-only, and get their access from
-- the parallel ads_manager_has_brand() policies instead.
create or replace function public.user_has_brand_access(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_bob()
    or exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = b_id and ab.apc_id = auth.uid()
    )
    or exists (
      select 1 from public.team_lead_brands tlb
      where tlb.brand_id = b_id and tlb.team_lead_id = auth.uid()
    );
$$;

grant execute on function public.is_superbob()                to authenticated;
grant execute on function public.is_apc()                     to authenticated;
grant execute on function public.is_bob_user(uuid)            to authenticated;
grant execute on function public.my_team_lead()               to authenticated;
grant execute on function public.brand_has_team_lead(uuid)    to authenticated;

-- =========================================================
-- 5. Auth wiring
-- =========================================================

-- New sign-ups land as 'pending'; Bob promotes them.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'pending');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Closes the privilege-escalation hole in the permissive profile UPDATE
-- policies ("profiles self update" lets anyone edit their own row):
--   * is_superbob may only be changed by a Super Boss
--   * role may only be changed by a Bob, and a Super Boss's role only by a Super Boss
-- Service role / SQL editor (auth.uid() is null) is always allowed.
create or replace function public.profiles_protect_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if new.is_superbob is distinct from old.is_superbob and not public.is_superbob() then
    raise exception 'Only a Super Bob can change Super Bob status';
  end if;

  if new.role is distinct from old.role then
    if not public.is_bob() then
      raise exception 'Not allowed to change roles';
    end if;
    if old.is_superbob and not public.is_superbob() then
      raise exception 'Only a Super Bob can change a Super Bob''s role';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges
  before update on public.profiles
  for each row execute function public.profiles_protect_privileges();

-- =========================================================
-- 6. Row Level Security
-- =========================================================

alter table public.profiles                      enable row level security;
alter table public.clients                       enable row level security;
alter table public.brands                        enable row level security;
alter table public.apc_brands                    enable row level security;
alter table public.team_lead_brands              enable row level security;
alter table public.ads_manager_brands            enable row level security;
alter table public.report_templates              enable row level security;
alter table public.report_template_brands        enable row level security;
alter table public.brand_report_settings         enable row level security;
alter table public.weekly_reports                enable row level security;
alter table public.monthly_reports               enable row level security;
alter table public.report_comments               enable row level security;
alter table public.report_approval_decisions     enable row level security;
alter table public.report_share_links            enable row level security;
alter table public.section_presets               enable row level security;
alter table public.monthly_section_presets       enable row level security;
alter table public.brand_gmv_max_monthly         enable row level security;
alter table public.brand_gmv_max_weekly          enable row level security;
alter table public.brand_gmv_max_weekly_products enable row level security;
alter table public.brand_gmv_max_product_weekly  enable row level security;
alter table public.brand_products                enable row level security;
alter table public.brand_samples_products        enable row level security;
alter table public.brand_samples_periods         enable row level security;
alter table public.brand_samples_daily           enable row level security;
alter table public.brand_samples_weekly_gmv      enable row level security;
alter table public.brand_payments                enable row level security;
alter table public.brand_billing                 enable row level security;
alter table public.income_entries                enable row level security;
alter table public.expense_categories            enable row level security;
alter table public.expense_entries               enable row level security;
alter table public.resource_folders              enable row level security;
alter table public.resources                     enable row level security;
alter table public.resource_comments             enable row level security;
alter table public.notifications                 enable row level security;
-- Internal only: RLS on with NO policies. The SECURITY DEFINER purge function
-- is the sole accessor.
alter table public.notifications_purge_state     enable row level security;
alter table public.push_subscriptions            enable row level security;

-- ---------- 6.1 profiles ----------

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (auth.uid() = id or public.is_bob());

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "profiles bob update" on public.profiles;
create policy "profiles bob update" on public.profiles
  for update using (public.is_bob());

-- An APC can read their own Team Lead's row (name shown in their UI).
drop policy if exists "profiles apc read own lead" on public.profiles;
create policy "profiles apc read own lead" on public.profiles
  for select using (id = public.my_team_lead());

-- A Team Lead reads + edits the APCs they own. WITH CHECK pins role and
-- ownership so they cannot promote an APC or steal another lead's.
drop policy if exists "profiles team_lead read apcs" on public.profiles;
create policy "profiles team_lead read apcs" on public.profiles
  for select using (role = 'apc' and team_lead_id = auth.uid());

drop policy if exists "profiles team_lead update apcs" on public.profiles;
create policy "profiles team_lead update apcs" on public.profiles
  for update
  using (role = 'apc' and team_lead_id = auth.uid())
  with check (role = 'apc' and team_lead_id = auth.uid());

-- …and can see unassigned APCs in order to claim them.
drop policy if exists "profiles team_lead read unassigned apcs" on public.profiles;
create policy "profiles team_lead read unassigned apcs" on public.profiles
  for select using (role = 'apc' and team_lead_id is null and public.is_team_lead());

-- Staff read Bob + Ads Manager rows (names in pickers and "assigned by" labels).
drop policy if exists "profiles staff read bobs" on public.profiles;
create policy "profiles staff read bobs" on public.profiles
  for select using (role = 'bob' and public.is_internal_staff());

drop policy if exists "profiles staff read ads managers" on public.profiles;
create policy "profiles staff read ads managers" on public.profiles
  for select using (role = 'ads_manager' and public.is_internal_staff());

-- ---------- 6.2 clients ----------

drop policy if exists "clients read auth" on public.clients;
create policy "clients read auth" on public.clients
  for select using (auth.role() = 'authenticated');

drop policy if exists "clients bob write" on public.clients;
create policy "clients bob write" on public.clients
  for all using (public.is_bob()) with check (public.is_bob());

-- ---------- 6.3 brands ----------

drop policy if exists "brands read scoped" on public.brands;
create policy "brands read scoped" on public.brands
  for select using (
    public.is_bob()
    or exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brands.id and ab.apc_id = auth.uid()
    )
  );

drop policy if exists "brands bob insert" on public.brands;
create policy "brands bob insert" on public.brands
  for insert with check (public.is_bob());

drop policy if exists "brands bob update" on public.brands;
create policy "brands bob update" on public.brands
  for update using (public.is_bob());

drop policy if exists "brands bob delete" on public.brands;
create policy "brands bob delete" on public.brands
  for delete using (public.is_bob());

-- An APC with the can_edit_brands flag may edit brands assigned to them.
drop policy if exists "brands apc update" on public.brands;
create policy "brands apc update" on public.brands
  for update using (
    exists (
      select 1 from public.profiles p
      join public.apc_brands ab on ab.apc_id = p.id
      where p.id = auth.uid() and p.can_edit_brands and ab.brand_id = brands.id
    )
  ) with check (
    exists (
      select 1 from public.profiles p
      join public.apc_brands ab on ab.apc_id = p.id
      where p.id = auth.uid() and p.can_edit_brands and ab.brand_id = brands.id
    )
  );

drop policy if exists "brands team_lead read" on public.brands;
create policy "brands team_lead read" on public.brands
  for select using (public.team_lead_has_brand(id));

drop policy if exists "brands team_lead update" on public.brands;
create policy "brands team_lead update" on public.brands
  for update using (public.team_lead_has_brand(id))
  with check (public.team_lead_has_brand(id));

drop policy if exists "brands ads_manager read" on public.brands;
create policy "brands ads_manager read" on public.brands
  for select using (public.ads_manager_has_brand(id));

-- ---------- 6.4 assignment tables ----------

drop policy if exists "apc_brands bob all" on public.apc_brands;
create policy "apc_brands bob all" on public.apc_brands
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "apc_brands self read" on public.apc_brands;
create policy "apc_brands self read" on public.apc_brands
  for select using (apc_id = auth.uid());

drop policy if exists "apc_brands team_lead read" on public.apc_brands;
create policy "apc_brands team_lead read" on public.apc_brands
  for select using (public.manages_apc(apc_id));

drop policy if exists "apc_brands team_lead insert" on public.apc_brands;
create policy "apc_brands team_lead insert" on public.apc_brands
  for insert with check (public.manages_apc(apc_id) and public.team_lead_has_brand(brand_id));

drop policy if exists "apc_brands team_lead delete" on public.apc_brands;
create policy "apc_brands team_lead delete" on public.apc_brands
  for delete using (public.manages_apc(apc_id) and public.team_lead_has_brand(brand_id));

drop policy if exists "tlb bob all" on public.team_lead_brands;
create policy "tlb bob all" on public.team_lead_brands
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "tlb self read" on public.team_lead_brands;
create policy "tlb self read" on public.team_lead_brands
  for select using (team_lead_id = auth.uid());

drop policy if exists "amb bob all" on public.ads_manager_brands;
create policy "amb bob all" on public.ads_manager_brands
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "amb self read" on public.ads_manager_brands;
create policy "amb self read" on public.ads_manager_brands
  for select using (ads_manager_id = auth.uid());

-- ---------- 6.5 report templates ----------

drop policy if exists "rt bob all" on public.report_templates;
create policy "rt bob all" on public.report_templates
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "rt visible read" on public.report_templates;
create policy "rt visible read" on public.report_templates
  for select using (
    is_global
    or exists (
      select 1 from public.report_template_brands rtb
      where rtb.template_id = report_templates.id
        and public.user_has_brand_access(rtb.brand_id)
    )
  );

drop policy if exists "rtb bob all" on public.report_template_brands;
create policy "rtb bob all" on public.report_template_brands
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "rtb scoped read" on public.report_template_brands;
create policy "rtb scoped read" on public.report_template_brands
  for select using (public.user_has_brand_access(brand_id));

-- ---------- 6.6 brand_report_settings ----------

drop policy if exists "brs read scoped" on public.brand_report_settings;
create policy "brs read scoped" on public.brand_report_settings
  for select using (
    public.is_bob()
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = brand_report_settings.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "brs write scoped" on public.brand_report_settings;
create policy "brs write scoped" on public.brand_report_settings
  for all using (
    public.is_bob()
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = brand_report_settings.brand_id and ab.apc_id = auth.uid())
  ) with check (
    public.is_bob()
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = brand_report_settings.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "brs team_lead all" on public.brand_report_settings;
create policy "brs team_lead all" on public.brand_report_settings
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

drop policy if exists "brs ads_manager read" on public.brand_report_settings;
create policy "brs ads_manager read" on public.brand_report_settings
  for select using (public.ads_manager_has_brand(brand_id));

-- ---------- 6.7 weekly_reports ----------

drop policy if exists "wr read scoped" on public.weekly_reports;
create policy "wr read scoped" on public.weekly_reports
  for select using (
    public.is_bob()
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = weekly_reports.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "wr insert scoped" on public.weekly_reports;
create policy "wr insert scoped" on public.weekly_reports
  for insert with check (
    created_by = auth.uid() and (
      public.is_bob()
      or exists (select 1 from public.apc_brands ab
                 where ab.brand_id = weekly_reports.brand_id and ab.apc_id = auth.uid())
    )
  );

drop policy if exists "wr update scoped" on public.weekly_reports;
create policy "wr update scoped" on public.weekly_reports
  for update using (
    public.is_bob()
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = weekly_reports.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "wr delete bob" on public.weekly_reports;
create policy "wr delete bob" on public.weekly_reports
  for delete using (public.is_bob());

drop policy if exists "wr team_lead read" on public.weekly_reports;
create policy "wr team_lead read" on public.weekly_reports
  for select using (public.team_lead_has_brand(brand_id));

drop policy if exists "wr team_lead insert" on public.weekly_reports;
create policy "wr team_lead insert" on public.weekly_reports
  for insert with check (created_by = auth.uid() and public.team_lead_has_brand(brand_id));

drop policy if exists "wr team_lead update" on public.weekly_reports;
create policy "wr team_lead update" on public.weekly_reports
  for update using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

drop policy if exists "wr ads_manager read" on public.weekly_reports;
create policy "wr ads_manager read" on public.weekly_reports
  for select using (public.ads_manager_has_brand(brand_id));

-- ---------- 6.8 monthly_reports ----------

drop policy if exists "mr bob all" on public.monthly_reports;
create policy "mr bob all" on public.monthly_reports
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "mr apc read" on public.monthly_reports;
create policy "mr apc read" on public.monthly_reports
  for select using (
    exists (select 1 from public.apc_brands ab
            where ab.brand_id = monthly_reports.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "mr apc write" on public.monthly_reports;
create policy "mr apc write" on public.monthly_reports
  for all using (
    exists (select 1 from public.apc_brands ab
            where ab.brand_id = monthly_reports.brand_id and ab.apc_id = auth.uid())
  ) with check (
    exists (select 1 from public.apc_brands ab
            where ab.brand_id = monthly_reports.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "mr team_lead all" on public.monthly_reports;
create policy "mr team_lead all" on public.monthly_reports
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

drop policy if exists "mr ads_manager read" on public.monthly_reports;
create policy "mr ads_manager read" on public.monthly_reports
  for select using (public.ads_manager_has_brand(brand_id));

-- ---------- 6.9 report_comments ----------
-- Client feedback: staff other than Bob may only READ. Clients post through the
-- public edge functions (service role), Bob replies via post-staff-comment.

drop policy if exists "rc bob all" on public.report_comments;
create policy "rc bob all" on public.report_comments
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "rc apc read" on public.report_comments;
create policy "rc apc read" on public.report_comments
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      join public.apc_brands ab on ab.brand_id = wr.brand_id
      where wr.id = report_comments.report_id and ab.apc_id = auth.uid()
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      join public.apc_brands ab on ab.brand_id = mr.brand_id
      where mr.id = report_comments.report_id and ab.apc_id = auth.uid()
    ))
  );

-- Historical APC-authored comments keep a delete path (disabled in the UI).
drop policy if exists "rc apc delete own" on public.report_comments;
create policy "rc apc delete own" on public.report_comments
  for delete using (
    author_type = 'apc' and (
      (report_type = 'weekly' and exists (
        select 1 from public.weekly_reports wr
        join public.apc_brands ab on ab.brand_id = wr.brand_id
        where wr.id = report_comments.report_id and ab.apc_id = auth.uid()
      ))
      or (report_type = 'monthly' and exists (
        select 1 from public.monthly_reports mr
        join public.apc_brands ab on ab.brand_id = mr.brand_id
        where mr.id = report_comments.report_id and ab.apc_id = auth.uid()
      ))
    )
  );

drop policy if exists "rc team_lead read" on public.report_comments;
create policy "rc team_lead read" on public.report_comments
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      where wr.id = report_comments.report_id and public.team_lead_has_brand(wr.brand_id)
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      where mr.id = report_comments.report_id and public.team_lead_has_brand(mr.brand_id)
    ))
  );

drop policy if exists "rc ads_manager read" on public.report_comments;
create policy "rc ads_manager read" on public.report_comments
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      where wr.id = report_comments.report_id and public.ads_manager_has_brand(wr.brand_id)
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      where mr.id = report_comments.report_id and public.ads_manager_has_brand(mr.brand_id)
    ))
  );

-- ---------- 6.10 report_approval_decisions ----------
-- Written only by the post-approval-decision edge function; staff read.

drop policy if exists "rad bob read" on public.report_approval_decisions;
create policy "rad bob read" on public.report_approval_decisions
  for select using (public.is_bob());

drop policy if exists "rad apc read" on public.report_approval_decisions;
create policy "rad apc read" on public.report_approval_decisions
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      join public.apc_brands ab on ab.brand_id = wr.brand_id
      where wr.id = report_approval_decisions.report_id and ab.apc_id = auth.uid()
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      join public.apc_brands ab on ab.brand_id = mr.brand_id
      where mr.id = report_approval_decisions.report_id and ab.apc_id = auth.uid()
    ))
  );

drop policy if exists "rad team_lead read" on public.report_approval_decisions;
create policy "rad team_lead read" on public.report_approval_decisions
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      where wr.id = report_approval_decisions.report_id and public.team_lead_has_brand(wr.brand_id)
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      where mr.id = report_approval_decisions.report_id and public.team_lead_has_brand(mr.brand_id)
    ))
  );

drop policy if exists "rad ads_manager read" on public.report_approval_decisions;
create policy "rad ads_manager read" on public.report_approval_decisions
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      where wr.id = report_approval_decisions.report_id and public.ads_manager_has_brand(wr.brand_id)
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      where mr.id = report_approval_decisions.report_id and public.ads_manager_has_brand(mr.brand_id)
    ))
  );

-- ---------- 6.11 share links + presets ----------

drop policy if exists "rsl bob all" on public.report_share_links;
create policy "rsl bob all" on public.report_share_links
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "presets read auth" on public.section_presets;
create policy "presets read auth" on public.section_presets
  for select using (auth.role() = 'authenticated');

drop policy if exists "presets insert auth" on public.section_presets;
create policy "presets insert auth" on public.section_presets
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "presets delete owner_or_bob" on public.section_presets;
create policy "presets delete owner_or_bob" on public.section_presets
  for delete using (created_by = auth.uid() or public.is_bob());

drop policy if exists "msp read" on public.monthly_section_presets;
create policy "msp read" on public.monthly_section_presets
  for select using (auth.uid() is not null);

drop policy if exists "msp insert" on public.monthly_section_presets;
create policy "msp insert" on public.monthly_section_presets
  for insert with check (auth.uid() is not null);

drop policy if exists "msp delete own or bob" on public.monthly_section_presets;
create policy "msp delete own or bob" on public.monthly_section_presets
  for delete using (auth.uid() = created_by or public.is_bob());

-- ---------- 6.12 GMV Max ----------
-- Ads Managers get FULL EDIT here — it is the one surface their role owns.

drop policy if exists "bgmm bob all" on public.brand_gmv_max_monthly;
create policy "bgmm bob all" on public.brand_gmv_max_monthly
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "bgmm apc read" on public.brand_gmv_max_monthly;
create policy "bgmm apc read" on public.brand_gmv_max_monthly
  for select using (
    exists (select 1 from public.apc_brands ab
            where ab.brand_id = brand_gmv_max_monthly.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "bgmm apc write" on public.brand_gmv_max_monthly;
create policy "bgmm apc write" on public.brand_gmv_max_monthly
  for all using (
    exists (select 1 from public.profiles p
            join public.apc_brands ab on ab.apc_id = p.id
            where p.id = auth.uid() and p.can_manage_gmv_max
              and ab.brand_id = brand_gmv_max_monthly.brand_id)
  ) with check (
    exists (select 1 from public.profiles p
            join public.apc_brands ab on ab.apc_id = p.id
            where p.id = auth.uid() and p.can_manage_gmv_max
              and ab.brand_id = brand_gmv_max_monthly.brand_id)
  );

drop policy if exists "bgmm team_lead all" on public.brand_gmv_max_monthly;
create policy "bgmm team_lead all" on public.brand_gmv_max_monthly
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

drop policy if exists "bgmm ads_manager all" on public.brand_gmv_max_monthly;
create policy "bgmm ads_manager all" on public.brand_gmv_max_monthly
  for all using (public.ads_manager_has_brand(brand_id))
  with check (public.ads_manager_has_brand(brand_id));

drop policy if exists "bgmw bob all" on public.brand_gmv_max_weekly;
create policy "bgmw bob all" on public.brand_gmv_max_weekly
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "bgmw apc read" on public.brand_gmv_max_weekly;
create policy "bgmw apc read" on public.brand_gmv_max_weekly
  for select using (
    exists (select 1 from public.apc_brands ab
            where ab.brand_id = brand_gmv_max_weekly.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "bgmw apc write" on public.brand_gmv_max_weekly;
create policy "bgmw apc write" on public.brand_gmv_max_weekly
  for all using (
    exists (select 1 from public.profiles p
            join public.apc_brands ab on ab.apc_id = p.id
            where p.id = auth.uid() and p.can_manage_gmv_max
              and ab.brand_id = brand_gmv_max_weekly.brand_id)
  ) with check (
    exists (select 1 from public.profiles p
            join public.apc_brands ab on ab.apc_id = p.id
            where p.id = auth.uid() and p.can_manage_gmv_max
              and ab.brand_id = brand_gmv_max_weekly.brand_id)
  );

drop policy if exists "bgmw team_lead all" on public.brand_gmv_max_weekly;
create policy "bgmw team_lead all" on public.brand_gmv_max_weekly
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

drop policy if exists "bgmw ads_manager all" on public.brand_gmv_max_weekly;
create policy "bgmw ads_manager all" on public.brand_gmv_max_weekly
  for all using (public.ads_manager_has_brand(brand_id))
  with check (public.ads_manager_has_brand(brand_id));

-- Child product rows inherit access from their parent weekly row.
drop policy if exists "bgmwp read" on public.brand_gmv_max_weekly_products;
create policy "bgmwp read" on public.brand_gmv_max_weekly_products
  for select using (
    exists (
      select 1 from public.brand_gmv_max_weekly w
      where w.id = brand_gmv_max_weekly_products.weekly_id
        and (
          public.is_bob()
          or public.team_lead_has_brand(w.brand_id)
          or public.ads_manager_has_brand(w.brand_id)
          or exists (select 1 from public.apc_brands ab
                     where ab.brand_id = w.brand_id and ab.apc_id = auth.uid())
        )
    )
  );

drop policy if exists "bgmwp write" on public.brand_gmv_max_weekly_products;
create policy "bgmwp write" on public.brand_gmv_max_weekly_products
  for all using (
    exists (
      select 1 from public.brand_gmv_max_weekly w
      where w.id = brand_gmv_max_weekly_products.weekly_id
        and (
          public.is_bob()
          or public.team_lead_has_brand(w.brand_id)
          or public.ads_manager_has_brand(w.brand_id)
          or exists (select 1 from public.profiles p
                     join public.apc_brands ab on ab.apc_id = p.id
                     where p.id = auth.uid() and p.can_manage_gmv_max and ab.brand_id = w.brand_id)
        )
    )
  ) with check (
    exists (
      select 1 from public.brand_gmv_max_weekly w
      where w.id = brand_gmv_max_weekly_products.weekly_id
        and (
          public.is_bob()
          or public.team_lead_has_brand(w.brand_id)
          or public.ads_manager_has_brand(w.brand_id)
          or exists (select 1 from public.profiles p
                     join public.apc_brands ab on ab.apc_id = p.id
                     where p.id = auth.uid() and p.can_manage_gmv_max and ab.brand_id = w.brand_id)
        )
    )
  );

drop policy if exists "bgmpw bob all" on public.brand_gmv_max_product_weekly;
create policy "bgmpw bob all" on public.brand_gmv_max_product_weekly
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "bgmpw apc read" on public.brand_gmv_max_product_weekly;
create policy "bgmpw apc read" on public.brand_gmv_max_product_weekly
  for select using (
    exists (select 1 from public.apc_brands ab
            where ab.brand_id = brand_gmv_max_product_weekly.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "bgmpw apc write" on public.brand_gmv_max_product_weekly;
create policy "bgmpw apc write" on public.brand_gmv_max_product_weekly
  for all using (
    exists (select 1 from public.profiles p
            join public.apc_brands ab on ab.apc_id = p.id
            where p.id = auth.uid() and p.can_manage_gmv_max
              and ab.brand_id = brand_gmv_max_product_weekly.brand_id)
  ) with check (
    exists (select 1 from public.profiles p
            join public.apc_brands ab on ab.apc_id = p.id
            where p.id = auth.uid() and p.can_manage_gmv_max
              and ab.brand_id = brand_gmv_max_product_weekly.brand_id)
  );

drop policy if exists "bgmpw team_lead all" on public.brand_gmv_max_product_weekly;
create policy "bgmpw team_lead all" on public.brand_gmv_max_product_weekly
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- ---------- 6.13 brand_products ----------

drop policy if exists "bp scoped" on public.brand_products;
create policy "bp scoped" on public.brand_products
  for all using (public.user_has_brand_access(brand_id))
  with check (public.user_has_brand_access(brand_id));

drop policy if exists "bp team_lead all" on public.brand_products;
create policy "bp team_lead all" on public.brand_products
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

drop policy if exists "bp ads_manager read" on public.brand_products;
create policy "bp ads_manager read" on public.brand_products
  for select using (public.ads_manager_has_brand(brand_id));

-- ---------- 6.14 sample seeding ----------
-- Bob + assigned APC + Team Lead read/write; Ads Manager reads.

do $$
declare
  t text;
  p text;
begin
  foreach t in array array[
    'brand_samples_products', 'brand_samples_periods',
    'brand_samples_daily', 'brand_samples_weekly_gmv'
  ] loop
    p := case t
           when 'brand_samples_products'   then 'bsp'
           when 'brand_samples_periods'    then 'bspd'
           when 'brand_samples_daily'      then 'bsd'
           when 'brand_samples_weekly_gmv' then 'bswg'
         end;

    execute format('drop policy if exists %I on public.%I', p || ' bob all', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_bob()) with check (public.is_bob())',
      p || ' bob all', t);

    execute format('drop policy if exists %I on public.%I', p || ' apc all', t);
    execute format(
      'create policy %I on public.%I for all
         using (exists (select 1 from public.apc_brands ab
                        where ab.brand_id = %I.brand_id and ab.apc_id = auth.uid()))
         with check (exists (select 1 from public.apc_brands ab
                             where ab.brand_id = %I.brand_id and ab.apc_id = auth.uid()))',
      p || ' apc all', t, t, t);

    execute format('drop policy if exists %I on public.%I', p || ' team_lead all', t);
    execute format(
      'create policy %I on public.%I for all
         using (public.team_lead_has_brand(brand_id))
         with check (public.team_lead_has_brand(brand_id))',
      p || ' team_lead all', t);

    execute format('drop policy if exists %I on public.%I', p || ' ads_manager read', t);
    execute format(
      'create policy %I on public.%I for select using (public.ads_manager_has_brand(brand_id))',
      p || ' ads_manager read', t);
  end loop;
end $$;

-- ---------- 6.15 money — Bob only, no other role has any access ----------

do $$
declare t text;
begin
  foreach t in array array[
    'brand_payments', 'brand_billing', 'income_entries',
    'expense_categories', 'expense_entries'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || ' bob all', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_bob()) with check (public.is_bob())',
      t || ' bob all', t);
  end loop;
end $$;

-- ---------- 6.16 resources ----------

drop policy if exists "resources bob all" on public.resources;
create policy "resources bob all" on public.resources
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "resources apc read" on public.resources;
create policy "resources apc read" on public.resources
  for select using (
    scope = 'general'
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = resources.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "resources apc general write" on public.resources;
create policy "resources apc general write" on public.resources
  for all using (
    scope = 'general' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('bob','apc'))
  ) with check (
    scope = 'general' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('bob','apc'))
  );

drop policy if exists "resources apc brand write" on public.resources;
create policy "resources apc brand write" on public.resources
  for all using (
    scope = 'brand' and exists (select 1 from public.apc_brands ab
                                where ab.brand_id = resources.brand_id and ab.apc_id = auth.uid())
  ) with check (
    scope = 'brand' and exists (select 1 from public.apc_brands ab
                                where ab.brand_id = resources.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "resources team_lead general all" on public.resources;
create policy "resources team_lead general all" on public.resources
  for all using (scope = 'general' and public.is_team_lead())
  with check (scope = 'general' and public.is_team_lead());

drop policy if exists "resources team_lead brand all" on public.resources;
create policy "resources team_lead brand all" on public.resources
  for all using (scope = 'brand' and public.team_lead_has_brand(brand_id))
  with check (scope = 'brand' and public.team_lead_has_brand(brand_id));

drop policy if exists "resources ads_manager read" on public.resources;
create policy "resources ads_manager read" on public.resources
  for select using (
    public.is_ads_manager()
    and (scope = 'general' or public.ads_manager_has_brand(brand_id))
  );

drop policy if exists "rf bob all" on public.resource_folders;
create policy "rf bob all" on public.resource_folders
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "rf apc general all" on public.resource_folders;
create policy "rf apc general all" on public.resource_folders
  for all using (
    scope = 'general' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('bob','apc'))
  ) with check (
    scope = 'general' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('bob','apc'))
  );

drop policy if exists "rf apc brand all" on public.resource_folders;
create policy "rf apc brand all" on public.resource_folders
  for all using (
    scope = 'brand' and exists (select 1 from public.apc_brands ab
                                where ab.brand_id = resource_folders.brand_id and ab.apc_id = auth.uid())
  ) with check (
    scope = 'brand' and exists (select 1 from public.apc_brands ab
                                where ab.brand_id = resource_folders.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "rf team_lead general all" on public.resource_folders;
create policy "rf team_lead general all" on public.resource_folders
  for all using (scope = 'general' and public.is_team_lead())
  with check (scope = 'general' and public.is_team_lead());

drop policy if exists "rf team_lead brand all" on public.resource_folders;
create policy "rf team_lead brand all" on public.resource_folders
  for all using (scope = 'brand' and public.team_lead_has_brand(brand_id))
  with check (scope = 'brand' and public.team_lead_has_brand(brand_id));

drop policy if exists "rf ads_manager read" on public.resource_folders;
create policy "rf ads_manager read" on public.resource_folders
  for select using (
    public.is_ads_manager()
    and (scope = 'general' or public.ads_manager_has_brand(brand_id))
  );

-- resource_comments: staff read + post (clients post via edge function).

drop policy if exists "rsc bob all" on public.resource_comments;
create policy "rsc bob all" on public.resource_comments
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "rsc apc read" on public.resource_comments;
create policy "rsc apc read" on public.resource_comments
  for select using (
    exists (
      select 1 from public.resources r
      where r.id = resource_comments.resource_id
        and (r.scope = 'general'
             or exists (select 1 from public.apc_brands ab
                        where ab.brand_id = r.brand_id and ab.apc_id = auth.uid()))
    )
  );

drop policy if exists "rsc apc insert" on public.resource_comments;
create policy "rsc apc insert" on public.resource_comments
  for insert with check (
    exists (
      select 1 from public.resources r
      where r.id = resource_comments.resource_id
        and (r.scope = 'general'
             or exists (select 1 from public.apc_brands ab
                        where ab.brand_id = r.brand_id and ab.apc_id = auth.uid()))
    )
  );

drop policy if exists "rsc ads_manager read" on public.resource_comments;
create policy "rsc ads_manager read" on public.resource_comments
  for select using (
    exists (
      select 1 from public.resources r
      where r.id = resource_comments.resource_id
        and ((r.scope = 'general' and public.is_ads_manager())
             or public.ads_manager_has_brand(r.brand_id))
    )
  );

drop policy if exists "rsc ads_manager insert" on public.resource_comments;
create policy "rsc ads_manager insert" on public.resource_comments
  for insert with check (
    exists (
      select 1 from public.resources r
      where r.id = resource_comments.resource_id
        and ((r.scope = 'general' and public.is_ads_manager())
             or public.ads_manager_has_brand(r.brand_id))
    )
  );

-- ---------- 6.17 notifications ----------
-- No INSERT policy: rows are only ever written by SECURITY DEFINER RPCs and
-- the service role.

drop policy if exists "notifications self read" on public.notifications;
create policy "notifications self read" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications self update" on public.notifications;
create policy "notifications self update" on public.notifications
  for update using (auth.uid() = user_id);

drop policy if exists "notifications self delete" on public.notifications;
create policy "notifications self delete" on public.notifications
  for delete using (auth.uid() = user_id);

drop policy if exists "notifications bob read" on public.notifications;
create policy "notifications bob read" on public.notifications
  for select using (public.is_bob());

drop policy if exists "push subs self" on public.push_subscriptions;
create policy "push subs self" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- 7. Triggers: derived data + referential cleanup
-- =========================================================

-- ---------- 7.1 Polymorphic comment cleanup (report_id has no FK) ----------

create or replace function public.cleanup_weekly_report_refs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.report_comments
   where report_type = 'weekly' and report_id = old.id;
  delete from public.report_approval_decisions
   where report_type = 'weekly' and report_id = old.id;
  return old;
end;
$$;

drop trigger if exists weekly_reports_cleanup on public.weekly_reports;
create trigger weekly_reports_cleanup
  before delete on public.weekly_reports
  for each row execute function public.cleanup_weekly_report_refs();

create or replace function public.cleanup_monthly_report_refs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.report_comments
   where report_type = 'monthly' and report_id = old.id;
  delete from public.report_approval_decisions
   where report_type = 'monthly' and report_id = old.id;
  return old;
end;
$$;

drop trigger if exists monthly_reports_cleanup on public.monthly_reports;
create trigger monthly_reports_cleanup
  before delete on public.monthly_reports
  for each row execute function public.cleanup_monthly_report_refs();

-- ---------- 7.2 GMV Max weekly totals roll up from the product rows ----------

create or replace function public.gmv_max_weekly_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_weekly uuid := coalesce(new.weekly_id, old.weekly_id);
  v_spend  numeric(14,2);
  v_orders integer;
  v_gmv    numeric(14,2);
begin
  select coalesce(sum(ad_spend), 0), coalesce(sum(orders), 0), coalesce(sum(gmv), 0)
    into v_spend, v_orders, v_gmv
    from public.brand_gmv_max_weekly_products
   where weekly_id = v_weekly;

  update public.brand_gmv_max_weekly w
     set ad_spend   = v_spend,
         orders     = v_orders,
         gmv        = v_gmv,
         roi        = case when v_spend  > 0 then round(v_gmv   / v_spend,  4) else 0 end,
         cpo        = case when v_orders > 0 then round(v_spend / v_orders, 2) else 0 end,
         updated_at = now()
   where w.id = v_weekly;

  return null;
end $$;

drop trigger if exists bgmwp_recompute on public.brand_gmv_max_weekly_products;
create trigger bgmwp_recompute
  after insert or update or delete on public.brand_gmv_max_weekly_products
  for each row execute function public.gmv_max_weekly_recompute();

-- ---------- 7.3 ads_manager_brands is a derived set ----------
-- Always equals (every ads_manager) × (every brand with 'ads' in scope).

create or replace function public.reconcile_ads_manager_brands()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.ads_manager_brands amb
   where not exists (select 1 from public.brands b
                      where b.id = amb.brand_id and 'ads' = any(b.scope))
      or not exists (select 1 from public.profiles p
                      where p.id = amb.ads_manager_id and p.role = 'ads_manager');

  insert into public.ads_manager_brands (ads_manager_id, brand_id)
  select p.id, b.id
    from public.profiles p
    cross join public.brands b
   where p.role = 'ads_manager'
     and 'ads' = any(b.scope)
     and not exists (select 1 from public.ads_manager_brands amb
                      where amb.ads_manager_id = p.id and amb.brand_id = b.id);
end;
$$;
revoke all on function public.reconcile_ads_manager_brands() from public;

create or replace function public.tg_brands_reconcile_ads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.reconcile_ads_manager_brands();
  return null;
end;
$$;

drop trigger if exists brands_reconcile_ads_insert on public.brands;
create trigger brands_reconcile_ads_insert
  after insert on public.brands
  for each statement execute function public.tg_brands_reconcile_ads();

drop trigger if exists brands_reconcile_ads_scope on public.brands;
create trigger brands_reconcile_ads_scope
  after update of scope on public.brands
  for each statement execute function public.tg_brands_reconcile_ads();

create or replace function public.tg_profiles_reconcile_ads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.reconcile_ads_manager_brands();
  return null;
end;
$$;

drop trigger if exists profiles_reconcile_ads on public.profiles;
create trigger profiles_reconcile_ads
  after insert or update of role on public.profiles
  for each statement execute function public.tg_profiles_reconcile_ads();

-- =========================================================
-- 8. RPCs
--
-- All SECURITY DEFINER: they fan out notifications (the table has no INSERT
-- policy) and touch rows belonging to other users.
-- =========================================================

-- ---------- 8.1 Bob: set the APC roster under a Team Lead ----------

create or replace function public.set_team_lead_apcs(p_lead uuid, p_apc_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_lead_name text; v_apc uuid; v_old uuid; v_apc_name text;
  v_ids uuid[] := coalesce(p_apc_ids, '{}'::uuid[]);
begin
  if not public.is_bob() then raise exception 'Only Bob can set a Team Lead''s APCs'; end if;
  if (select role from public.profiles where id = p_lead) <> 'team_lead' then
    raise exception 'Target is not a Team Lead';
  end if;
  select coalesce(nullif(full_name,''), email) into v_lead_name from public.profiles where id = p_lead;

  -- Detach APCs removed from this lead's roster → notify them.
  for v_apc in
    select id from public.profiles
     where role = 'apc' and team_lead_id = p_lead and not (id = any(v_ids))
  loop
    update public.profiles set team_lead_id = null where id = v_apc;
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (v_apc, 'team_assignment', 'You were removed from a team',
            'You are no longer on ' || coalesce(v_lead_name, 'a Team Lead') || '''s team.',
            '/brands', jsonb_build_object('team_lead_id', p_lead, 'kind', 'apc_removed'));
  end loop;

  -- Attach selected APCs; notify the APC, and the previous lead if they moved.
  foreach v_apc in array v_ids loop
    if exists (select 1 from public.profiles where id = v_apc and role = 'apc') then
      select team_lead_id into v_old from public.profiles where id = v_apc;
      if v_old is distinct from p_lead then
        update public.profiles set team_lead_id = p_lead where id = v_apc and role = 'apc';
        select coalesce(nullif(full_name,''), email) into v_apc_name from public.profiles where id = v_apc;

        insert into public.notifications (user_id, type, title, body, link, payload)
        values (v_apc, 'team_assignment', 'You''ve been added to a team',
                'You now report to ' || coalesce(v_lead_name, 'a Team Lead') || '.',
                '/brands', jsonb_build_object('team_lead_id', p_lead, 'kind', 'apc_assigned'));

        if v_old is not null then
          insert into public.notifications (user_id, type, title, body, link, payload)
          values (v_old, 'team_assignment', 'An APC left your team',
                  coalesce(v_apc_name, 'An APC') || ' was moved to another team.',
                  '/apcs', jsonb_build_object('apc_id', v_apc, 'kind', 'apc_moved_out'));
        end if;
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.set_team_lead_apcs(uuid, uuid[]) from public;
grant execute on function public.set_team_lead_apcs(uuid, uuid[]) to authenticated;

-- ---------- 8.2 Bob / managing Team Lead: replace an APC's brands ----------
-- Diff-based, so only the brands actually unticked are removed. Enforces
-- one brand → one APC.

create or replace function public.set_apc_brands(p_apc uuid, p_brand_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_is_bob boolean := public.is_bob();
  v_ids uuid[] := coalesce(p_brand_ids, '{}'::uuid[]);
  v_added uuid[];
  v_names text;
  v_other uuid;
  bid uuid;
begin
  if not v_is_bob and not public.manages_apc(p_apc) then raise exception 'not allowed'; end if;
  if (select role from public.profiles where id = p_apc) <> 'apc' then
    raise exception 'Target is not an APC';
  end if;

  -- A Team Lead may only assign brands Bob granted them.
  if not v_is_bob then
    foreach bid in array v_ids loop
      if not public.team_lead_has_brand(bid) then
        raise exception 'You can only assign brands that have been assigned to you';
      end if;
    end loop;
  end if;

  -- One brand → one APC.
  foreach bid in array v_ids loop
    select apc_id into v_other from public.apc_brands
     where brand_id = bid and apc_id <> p_apc limit 1;
    if v_other is not null then
      raise exception 'That brand is already assigned to another APC — unassign it there first';
    end if;
  end loop;

  select array_agg(b) into v_added
  from unnest(v_ids) b
  where not exists (select 1 from public.apc_brands where apc_id = p_apc and brand_id = b);

  delete from public.apc_brands where apc_id = p_apc and not (brand_id = any(v_ids));
  if v_added is not null and array_length(v_added, 1) > 0 then
    insert into public.apc_brands (apc_id, brand_id) select p_apc, unnest(v_added);

    select string_agg(name, ', ' order by name) into v_names
      from public.brands where id = any(v_added);
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (p_apc, 'brand_assignment',
            'New brand' || case when array_length(v_added,1) > 1 then 's' else '' end
              || ' assigned to you',
            coalesce(v_names, 'A brand'), '/brands',
            jsonb_build_object('brand_ids', to_jsonb(v_added), 'kind', 'brand_assigned'));
  end if;
end;
$$;
revoke all on function public.set_apc_brands(uuid, uuid[]) from public;
grant execute on function public.set_apc_brands(uuid, uuid[]) to authenticated;

-- ---------- 8.3 Team Lead claims an unassigned APC ----------

create or replace function public.claim_apc(p_apc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_lead_name text;
begin
  if not public.is_team_lead() then raise exception 'Only a Team Lead can claim an APC'; end if;
  if not exists (select 1 from public.profiles
                  where id = p_apc and role = 'apc' and team_lead_id is null) then
    raise exception 'That APC is not available (already on a team, or not an APC)';
  end if;

  update public.profiles set team_lead_id = auth.uid()
    where id = p_apc and role = 'apc' and team_lead_id is null;

  select coalesce(nullif(full_name,''), email) into v_lead_name
    from public.profiles where id = auth.uid();
  insert into public.notifications (user_id, type, title, body, link, payload)
  values (p_apc, 'team_assignment', 'You''ve been added to a team',
          'You now report to ' || coalesce(v_lead_name, 'a Team Lead') || '.',
          '/brands', jsonb_build_object('team_lead_id', auth.uid(), 'kind', 'apc_assigned'));
end;
$$;
revoke all on function public.claim_apc(uuid) from public;
grant execute on function public.claim_apc(uuid) to authenticated;

-- ---------- 8.4 Promote APC → Team Lead (Bob) ----------
-- Data-safe: authored rows are keyed by user id and untouched; only role,
-- flags and brand-assignment bookkeeping change.

create or replace function public.promote_apc_to_team_lead(p_apc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if not public.is_bob() then raise exception 'Only Bob can promote a user to Team Lead'; end if;

  select role into v_role from public.profiles where id = p_apc;
  if v_role is null then raise exception 'User not found'; end if;
  if v_role <> 'apc' then raise exception 'Only an APC can be promoted to Team Lead'; end if;

  -- Carry their brands over to the Team Lead grant table, then drop the
  -- now-redundant APC assignments.
  insert into public.team_lead_brands (team_lead_id, brand_id)
  select p_apc, ab.brand_id from public.apc_brands ab where ab.apc_id = p_apc
  on conflict do nothing;

  delete from public.apc_brands where apc_id = p_apc;

  update public.profiles
     set role = 'team_lead',
         can_edit_brands = true,
         can_manage_gmv_max = true,
         team_lead_id = null
   where id = p_apc;
end;
$$;
revoke all on function public.promote_apc_to_team_lead(uuid) from public;
grant execute on function public.promote_apc_to_team_lead(uuid) to authenticated;

-- ---------- 8.5 Demote Team Lead → APC (Bob) — exact reverse ----------

create or replace function public.demote_team_lead_to_apc(p_lead uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if not public.is_bob() then raise exception 'Only Bob can demote a Team Lead'; end if;

  select role into v_role from public.profiles where id = p_lead;
  if v_role is null then raise exception 'User not found'; end if;
  if v_role <> 'team_lead' then raise exception 'Only a Team Lead can be demoted to APC'; end if;

  -- Their APCs fall back to no team, keeping their own brands.
  update public.profiles set team_lead_id = null
   where role = 'apc' and team_lead_id = p_lead;

  -- Carry back only the brands no downstream APC already holds, so
  -- one brand → one APC stays intact.
  insert into public.apc_brands (apc_id, brand_id)
  select p_lead, tlb.brand_id
    from public.team_lead_brands tlb
   where tlb.team_lead_id = p_lead
     and not exists (select 1 from public.apc_brands ab where ab.brand_id = tlb.brand_id)
  on conflict do nothing;

  delete from public.team_lead_brands where team_lead_id = p_lead;

  update public.profiles
     set role = 'apc', team_lead_id = null
   where id = p_lead;
end;
$$;
revoke all on function public.demote_team_lead_to_apc(uuid) from public;
grant execute on function public.demote_team_lead_to_apc(uuid) to authenticated;

-- ---------- 8.6 Bob: set one brand's owner from the Brands page ----------

create or replace function public.set_brand_assignment(p_brand uuid, p_lead uuid, p_apc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_lead uuid;
  v_apc_existing  boolean := true;   -- assume "already had it" → no notification
  v_lead_existing boolean := true;
  v_bname text;
begin
  if not public.is_bob() then raise exception 'Only Bob can assign brands'; end if;
  if not exists (select 1 from public.brands where id = p_brand) then
    raise exception 'Brand not found';
  end if;

  -- Picking an APC drags their own Team Lead along.
  if p_apc is not null then
    if (select role from public.profiles where id = p_apc) <> 'apc' then
      raise exception 'Target is not an APC';
    end if;
    v_lead := coalesce((select team_lead_id from public.profiles where id = p_apc), p_lead);
  else
    v_lead := p_lead;
  end if;

  if v_lead is not null and (select role from public.profiles where id = v_lead) <> 'team_lead' then
    raise exception 'Target is not a Team Lead';
  end if;

  -- One brand → one lead.
  delete from public.team_lead_brands
   where brand_id = p_brand and (v_lead is null or team_lead_id <> v_lead);
  if v_lead is not null then
    select exists (select 1 from public.team_lead_brands
                    where brand_id = p_brand and team_lead_id = v_lead)
      into v_lead_existing;
    insert into public.team_lead_brands (team_lead_id, brand_id)
      values (v_lead, p_brand) on conflict do nothing;
  end if;

  -- One brand → one APC.
  delete from public.apc_brands
   where brand_id = p_brand and (p_apc is null or apc_id <> p_apc);
  if p_apc is not null then
    select exists (select 1 from public.apc_brands where brand_id = p_brand and apc_id = p_apc)
      into v_apc_existing;
    insert into public.apc_brands (apc_id, brand_id)
      values (p_apc, p_brand) on conflict do nothing;
  end if;

  select name into v_bname from public.brands where id = p_brand;

  if p_apc is not null and not v_apc_existing then
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (p_apc, 'brand_assignment', 'New brand assigned to you',
            coalesce(v_bname, 'A brand'), '/brands',
            jsonb_build_object('brand_ids', to_jsonb(array[p_brand]), 'kind', 'brand_assigned'));
  end if;

  if v_lead is not null and not v_lead_existing then
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (v_lead, 'brand_assignment', 'New brand assigned to you',
            coalesce(v_bname, 'A brand'), '/brands',
            jsonb_build_object('brand_ids', to_jsonb(array[p_brand]), 'kind', 'brand_assigned'));
  end if;
end;
$$;
revoke all on function public.set_brand_assignment(uuid, uuid, uuid) from public;
grant execute on function public.set_brand_assignment(uuid, uuid, uuid) to authenticated;

-- ---------- 8.7 Bob: set an Ads Manager's brands ----------
-- Kept for compatibility. NOT the source of truth — reconcile_ads_manager_brands()
-- overrides any manual set on the next brand/profile change.

create or replace function public.set_ads_manager_brands(p_manager uuid, p_brand_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[] := coalesce(p_brand_ids, '{}'::uuid[]);
  v_added uuid[];
  v_names text;
begin
  if not public.is_bob() then
    raise exception 'Only Bob can set an Ads Manager''s brands';
  end if;
  if (select role from public.profiles where id = p_manager) <> 'ads_manager' then
    raise exception 'Target is not an Ads Manager';
  end if;

  select array_agg(b) into v_added
  from unnest(v_ids) b
  where not exists (select 1 from public.ads_manager_brands
                     where ads_manager_id = p_manager and brand_id = b);

  delete from public.ads_manager_brands where ads_manager_id = p_manager;
  if array_length(v_ids, 1) > 0 then
    insert into public.ads_manager_brands (ads_manager_id, brand_id)
      select p_manager, unnest(v_ids);
  end if;

  if v_added is not null and array_length(v_added, 1) > 0 then
    select string_agg(name, ', ' order by name) into v_names
      from public.brands where id = any(v_added);
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (p_manager, 'brand_assignment',
            'New brand' || case when array_length(v_added,1) > 1 then 's' else '' end
              || ' assigned to you',
            coalesce(v_names, 'A brand'), '/brands',
            jsonb_build_object('brand_ids', to_jsonb(v_added), 'kind', 'brand_assigned'));
  end if;
end;
$$;
revoke all on function public.set_ads_manager_brands(uuid, uuid[]) from public;
grant execute on function public.set_ads_manager_brands(uuid, uuid[]) to authenticated;

-- ---------- 8.8 Bob: change any non-Bob role ----------
-- Data-safe: reports, comments and notifications keyed by the user's id are
-- untouched; only role / flags / brand bookkeeping change. APC↔Team Lead
-- delegate to promote/demote so brand carry-over is identical.

create or replace function public.change_user_role(p_user uuid, p_new_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_superbob boolean;
begin
  if not public.is_bob() then raise exception 'Only Bob can change roles'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;

  select role, coalesce(is_superbob, false) into v_old, v_superbob
    from public.profiles where id = p_user;
  if v_old is null then raise exception 'User not found'; end if;
  if v_old = 'bob' or v_superbob then
    raise exception 'Bob accounts are managed from the Bobs page';
  end if;

  if p_new_role not in ('apc', 'team_lead', 'ads_manager') then
    raise exception 'Unsupported role: %', p_new_role;
  end if;

  if v_old = p_new_role then return; end if;

  if v_old = 'apc' and p_new_role = 'team_lead' then
    perform public.promote_apc_to_team_lead(p_user);
    return;
  end if;
  if v_old = 'team_lead' and p_new_role = 'apc' then
    perform public.demote_team_lead_to_apc(p_user);
    return;
  end if;

  -- Clean up the OLD role's bookkeeping. Leaving 'ads_manager' or 'pending'
  -- needs nothing manual — profiles_reconcile_ads rebuilds the derived set.
  if v_old = 'apc' then
    delete from public.apc_brands where apc_id = p_user;
  elsif v_old = 'team_lead' then
    update public.profiles set team_lead_id = null
     where role = 'apc' and team_lead_id = p_user;
    delete from public.team_lead_brands where team_lead_id = p_user;
  end if;

  update public.profiles
     set role = p_new_role,
         team_lead_id = null,
         can_edit_brands    = case when p_new_role = 'team_lead' then true else can_edit_brands end,
         can_manage_gmv_max = case when p_new_role = 'team_lead' then true else can_manage_gmv_max end
   where id = p_user;

  insert into public.notifications (user_id, type, title, body, link)
  values (p_user, 'role_change', 'Your account role was changed',
          case p_new_role
            when 'apc'         then 'You are now an APC (account manager).'
            when 'team_lead'   then 'You are now a Team Lead.'
            when 'ads_manager' then 'You are now an Ads Manager.'
          end,
          '/');
end;
$$;
revoke all on function public.change_user_role(uuid, text) from public;
grant execute on function public.change_user_role(uuid, text) to authenticated;

-- ---------- 8.9 Report review: APC submits, Team Lead decides ----------

create or replace function public.submit_report_for_review(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_brand uuid; v_name text; v_label text; v_link text;
begin
  if p_kind not in ('weekly','monthly') then raise exception 'invalid report kind'; end if;

  if p_kind = 'weekly' then
    select brand_id into v_brand from public.weekly_reports where id = p_id;
  else
    select brand_id into v_brand from public.monthly_reports where id = p_id;
  end if;
  if v_brand is null then raise exception 'report not found'; end if;

  if not public.is_bob()
     and not exists (select 1 from public.apc_brands
                      where brand_id = v_brand and apc_id = auth.uid()) then
    raise exception 'not allowed';
  end if;

  if not exists (select 1 from public.team_lead_brands where brand_id = v_brand) then
    raise exception 'No Team Lead is assigned to review this brand''s reports';
  end if;

  if p_kind = 'weekly' then
    update public.weekly_reports
       set review_status = 'submitted', reviewed_by = null,
           reviewed_at = null, review_note = null
     where id = p_id;
    v_link := '/reporting/weekly/' || p_id::text;
  else
    update public.monthly_reports
       set review_status = 'submitted', reviewed_by = null,
           reviewed_at = null, review_note = null
     where id = p_id;
    v_link := '/reporting/monthly/' || p_id::text;
  end if;

  select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = auth.uid();
  select name into v_label from public.brands where id = v_brand;

  insert into public.notifications (user_id, type, title, body, link, payload)
  select tlb.team_lead_id, 'report_review',
         coalesce(v_name,'An APC') || ' submitted a report for review',
         coalesce(v_label,'A brand') || ' — ' || p_kind || ' report',
         v_link,
         jsonb_build_object('report_id', p_id, 'report_type', p_kind,
                            'brand_id', v_brand, 'kind', 'submitted')
  from public.team_lead_brands tlb
  where tlb.brand_id = v_brand;
end;
$$;
revoke all on function public.submit_report_for_review(text, uuid) from public;
grant execute on function public.submit_report_for_review(text, uuid) to authenticated;

create or replace function public.decide_report_review(
  p_kind text, p_id uuid, p_decision text, p_note text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_brand uuid; v_creator uuid; v_name text; v_label text; v_link text; v_clean text;
begin
  if p_kind not in ('weekly','monthly') then raise exception 'invalid report kind'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision'; end if;
  v_clean := nullif(btrim(coalesce(p_note,'')), '');

  if p_kind = 'weekly' then
    select brand_id, created_by into v_brand, v_creator from public.weekly_reports where id = p_id;
  else
    select brand_id, created_by into v_brand, v_creator from public.monthly_reports where id = p_id;
  end if;
  if v_brand is null then raise exception 'report not found'; end if;

  if not public.is_bob()
     and not exists (select 1 from public.team_lead_brands
                      where brand_id = v_brand and team_lead_id = auth.uid()) then
    raise exception 'not allowed';
  end if;

  if p_kind = 'weekly' then
    update public.weekly_reports
       set review_status = p_decision, reviewed_by = auth.uid(),
           reviewed_at = now(), review_note = v_clean
     where id = p_id;
    v_link := '/reporting/weekly/' || p_id::text;
  else
    update public.monthly_reports
       set review_status = p_decision, reviewed_by = auth.uid(),
           reviewed_at = now(), review_note = v_clean
     where id = p_id;
    v_link := '/reporting/monthly/' || p_id::text;
  end if;

  select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = auth.uid();
  select name into v_label from public.brands where id = v_brand;

  if v_creator is not null and v_creator <> auth.uid() then
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (v_creator, 'report_review',
            coalesce(v_name,'Your Team Lead') || ' '
              || case when p_decision = 'approved' then 'approved' else 'requested changes on' end
              || ' your report',
            coalesce(v_label,'A brand') || ' — ' || p_kind || ' report'
              || case when v_clean is not null then ': ' || v_clean else '' end,
            v_link,
            jsonb_build_object('report_id', p_id, 'report_type', p_kind,
                               'brand_id', v_brand, 'kind', p_decision));
  end if;

  -- On approval, tell the other Bob(s) too.
  if p_decision = 'approved' then
    insert into public.notifications (user_id, type, title, body, link, payload)
    select pr.id, 'report_review', 'Report reviewed & approved',
           coalesce(v_label,'A brand') || ' — ' || p_kind || ' report approved by '
             || coalesce(v_name,'a Team Lead'),
           v_link,
           jsonb_build_object('report_id', p_id, 'report_type', p_kind,
                              'brand_id', v_brand, 'kind', 'approved')
      from public.profiles pr
     where pr.role = 'bob' and pr.id <> auth.uid();
  end if;
end;
$$;
revoke all on function public.decide_report_review(text, uuid, text, text) from public;
grant execute on function public.decide_report_review(text, uuid, text, text) to authenticated;

-- ---------- 8.10 Notification housekeeping ----------
-- NOTE the `where id` on the throttle UPDATE: API connections run under the
-- safeupdate guard, which rejects a WHERE-less UPDATE — and because this fires
-- from a trigger, that error would abort the caller's INSERT too.

create or replace function public.purge_old_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare purged int;
begin
  delete from public.notifications where created_at < now() - interval '14 days';
  get diagnostics purged = row_count;
  update public.notifications_purge_state set last_purged_at = now() where id;
  return purged;
end $$;
grant execute on function public.purge_old_notifications() to authenticated;

create or replace function public.notifications_purge_tick()
returns trigger language plpgsql security definer set search_path = public as $$
declare due boolean;
begin
  select last_purged_at < now() - interval '1 hour' into due
    from public.notifications_purge_state
    where id for update skip locked;
  if due then perform public.purge_old_notifications(); end if;
  return null;
end $$;

drop trigger if exists notifications_auto_purge on public.notifications;
create trigger notifications_auto_purge
  after insert on public.notifications
  for each statement execute function public.notifications_purge_tick();

-- Currently PAUSED (user call: keep every notification). Re-enable with:
--   alter table public.notifications enable trigger notifications_auto_purge;
alter table public.notifications disable trigger notifications_auto_purge;

-- =========================================================
-- 9. Storage
-- =========================================================

-- Inline report images (public bucket).
insert into storage.buckets (id, name, public)
values ('report-images', 'report-images', true)
on conflict (id) do update set public = true;

drop policy if exists "report-images read" on storage.objects;
create policy "report-images read" on storage.objects
  for select using (bucket_id = 'report-images');

drop policy if exists "report-images authed insert" on storage.objects;
create policy "report-images authed insert" on storage.objects
  for insert with check (bucket_id = 'report-images' and auth.uid() is not null);

drop policy if exists "report-images authed update" on storage.objects;
create policy "report-images authed update" on storage.objects
  for update using (bucket_id = 'report-images' and auth.uid() is not null);

drop policy if exists "report-images authed delete" on storage.objects;
create policy "report-images authed delete" on storage.objects
  for delete using (bucket_id = 'report-images' and auth.uid() is not null);

-- Profile photos. Each user may only write inside their own uid-prefixed folder.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- storage.objects.owner references auth.users with no delete rule on older
-- Supabase stacks, which makes deleting any user who ever uploaded a file fail.
-- Re-create it as ON DELETE SET NULL (uploaded files are kept).
do $$
declare cname text;
begin
  select con.conname into cname
    from pg_constraint con
    join pg_class rel     on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'storage'
     and rel.relname = 'objects'
     and con.contype = 'f'
     and con.confdeltype in ('a', 'r')
     and exists (
       select 1 from unnest(con.conkey) k
       join pg_attribute a on a.attrelid = rel.oid and a.attnum = k
       where a.attname = 'owner')
   limit 1;

  if cname is null then
    raise notice 'storage.objects.owner already has a delete rule — nothing to do';
  else
    begin
      execute format('alter table storage.objects drop constraint %I', cname);
      execute format(
        'alter table storage.objects add constraint %I
           foreign key (owner) references auth.users(id) on delete set null', cname);
      raise notice 'FIXED: storage.objects.% re-created with ON DELETE SET NULL', cname;
    exception when insufficient_privilege then
      raise notice 'NO PRIVILEGE to alter storage.objects — FK left unchanged';
    end;
  end if;
end $$;

-- =========================================================
-- 10. Realtime
-- =========================================================

do $$
declare t text;
begin
  foreach t in array array['notifications', 'resource_comments'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =========================================================
-- 11. Seed data
-- =========================================================

insert into public.expense_categories (name, icon, color, sort_order, is_default) values
  ('Salaries',  'bi-people',     '#1d4ed8', 10, true),
  ('Bills',     'bi-receipt',    '#b45309', 20, true),
  ('Office',    'bi-building',   '#0e7490', 30, true),
  ('Marketing', 'bi-megaphone',  '#a21caf', 40, true),
  ('Software',  'bi-cpu',        '#15803d', 50, true),
  ('Misc',      'bi-three-dots', '#475569', 90, true)
on conflict (name) do nothing;

-- =========================================================
-- 12. Grants
--
-- REQUIRED — do not skip. PostgREST connects as `anon` (signed out) or
-- `authenticated` (signed in), and table-level GRANTs are checked BEFORE RLS.
-- Without these every request fails with:
--     42501 permission denied for table <x>
-- ...and RLS is never even consulted.
--
-- Supabase normally hands these out through ALTER DEFAULT PRIVILEGES, but that
-- only fires for tables created by the role those defaults were declared for.
-- Running this file through the Management API / SQL editor can create the
-- tables under a different login role, so the defaults silently miss and the
-- whole API returns 401. Granting explicitly makes the file self-sufficient
-- however it is run.
--
-- Broad GRANTs + RLS is the standard Supabase model: the GRANT opens the table
-- to the API role, and the RLS policies above are the real security boundary.
-- =========================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- Anything created later inherits the same grants.
alter default privileges in schema public
  grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- `notifications_purge_state` is internal bookkeeping: RLS is on with NO
-- policies, so the blanket grant above still exposes nothing to the API roles
-- (the SECURITY DEFINER purge function is the only accessor). Revoked anyway
-- so the intent is explicit rather than incidental.
revoke all on public.notifications_purge_state from anon, authenticated;

-- =========================================================
-- DONE.
--
-- Next: sign up through the app (the row lands as role='pending'), then
-- promote yourself from this SQL editor:
--
--   update public.profiles
--      set role = 'bob', is_superbob = true
--    where lower(email) = '<your-email>';
-- =========================================================
