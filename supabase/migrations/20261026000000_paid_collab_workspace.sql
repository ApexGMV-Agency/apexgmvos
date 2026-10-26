-- =========================================================
-- Paid Collab Handler Workspace
--
-- Adds the `paid_collab_handler` role and the workspace it runs: monthly
-- budgets per brand (one program = one brand + one month), the creators signed
-- into each program (one row per DEAL), their videos / ad codes / drafts,
-- payment status, GMV, contracts + e-sign links, discussions, an activity log,
-- a shared Creators Database, message templates, best videos, a stock check
-- and a Keep-style notes board.
--
-- Adapted from the reference implementation's schema. Differences:
--   * No paid_collab_client role / client portal yet. The client-facing columns
--     (pending_visible_to_client, client_paid_confirmed_*) are kept so the
--     portal can be added without a data migration.
--   * Workspace access is Bob + the brand's assigned handler only. Other staff
--     roles have no read arms (there is no staff UI for this module).
--     reads_paid_collab_brand() is the single place to widen that later.
--   * user_has_brand_access() is deliberately NOT touched: it backs `for all`
--     policies on brand_products, so a handler arm there would grant writes.
--   * Dropped: Reacher creator stats, ad-code request logs, brand daily health,
--     trainee roles, the notes "timeline" stream, client video ratings.
--   * A brand is "paid-collab enabled" when brands.scope contains 'paid_creator'.
--   * Kill switch: app_feature_flags('paid_collab'). Off = handlers lose access.
--
-- Part A (role plumbing) is mirrored in place in schema_baseline.sql; part B
-- is folded into the baseline as section 11b. Idempotent, safe to re-run.
-- After applying: notify pgrst, 'reload schema' (last line below).
-- =========================================================

-- =========================================================
-- PART A — role plumbing
-- =========================================================

-- Internal (staff) vs external (contractor) handler. Both get the full
-- workspace; the flag only decides who they can share notes with.
alter table public.profiles
  add column if not exists is_internal_handler boolean not null default false;

-- Role + privilege flags may only be changed by the right people. Adds
-- is_internal_handler (Bob-only) to the existing rules.
create or replace function public.profiles_protect_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if new.is_superbob is distinct from old.is_superbob and not public.is_superbob() then
    raise exception 'Only a Super Bob can change Super Bob status';
  end if;

  if new.is_internal_handler is distinct from old.is_internal_handler and not public.is_bob() then
    raise exception 'Only Bob can change a handler''s internal/external status';
  end if;

  if new.role is distinct from old.role then
    if not public.is_bob() then
      raise exception 'Not allowed to change roles';
    end if;
    if (old.role = 'bob' or new.role = 'bob' or old.is_superbob) and not public.is_superbob() then
      raise exception 'Only a Super Bob can make someone a Bob or change a Bob''s role';
    end if;
  end if;

  return new;
end;
$$;

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

  if p_new_role not in ('apc', 'team_lead', 'ads_manager', 'paid_collab_handler', 'bob', 'superbob') then
    raise exception 'Unsupported role: %', p_new_role;
  end if;

  if v_superbob then
    raise exception 'A Super Boss''s role cannot be changed';
  end if;
  if (v_old = 'bob' or p_new_role in ('bob', 'superbob')) and not public.is_superbob() then
    raise exception 'Only the Super Boss can make someone a Bob or change a Bob''s role';
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

  -- Clean up the OLD role's bookkeeping. Leaving 'ads_manager', 'pending' or
  -- 'bob' needs nothing manual — profiles_reconcile_ads rebuilds the derived set.
  if v_old = 'apc' then
    delete from public.apc_brands where apc_id = p_user;
  elsif v_old = 'team_lead' then
    update public.profiles set team_lead_id = null
     where role = 'apc' and team_lead_id = p_user;
    delete from public.team_lead_brands where team_lead_id = p_user;
  elsif v_old = 'paid_collab_handler' then
    -- The deals they ran stay on the brand; only their seat goes.
    delete from public.paid_collab_handler_brands where handler_id = p_user;
    delete from public.handler_collab_brand_order where handler_id = p_user;
  end if;

  update public.profiles
     set role = case when p_new_role = 'superbob' then 'bob' else p_new_role end,
         is_superbob = (p_new_role = 'superbob'),
         is_internal_handler = case when p_new_role = 'paid_collab_handler' then is_internal_handler else false end,
         team_lead_id = null,
         can_edit_brands    = case when p_new_role = 'team_lead' then true else can_edit_brands end,
         can_manage_gmv_max = case when p_new_role = 'team_lead' then true else can_manage_gmv_max end
   where id = p_user;

  insert into public.notifications (user_id, type, title, body, link)
  values (p_user, 'role_change', 'Your account role was changed',
          case p_new_role
            when 'apc'                 then 'You are now an APC (account manager).'
            when 'team_lead'           then 'You are now a Team Lead.'
            when 'ads_manager'         then 'You are now an Ads Manager.'
            when 'paid_collab_handler' then 'You are now a Paid Collab Handler.'
            when 'bob'                 then 'You are now a Bob (admin).'
            when 'superbob'            then 'You are now a Super Boss.'
          end,
          '/');
end;
$$;
revoke all on function public.change_user_role(uuid, text) from public;
grant execute on function public.change_user_role(uuid, text) to authenticated;

-- =========================================================
-- PART B — the workspace (baseline section 11b)
-- =========================================================

-- ---------- B.1 Kill switch ----------

create table if not exists public.app_feature_flags (
  key        text primary key,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.app_feature_flags (key, enabled) values ('paid_collab', true)
  on conflict (key) do nothing;

create or replace function public.paid_collab_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from public.app_feature_flags where key = 'paid_collab'), true);
$$;

create or replace function public.is_paid_collab_handler()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'paid_collab_handler');
$$;

create or replace function public.is_internal_handler()
returns boolean language sql stable security definer set search_path = public as $$
  select public.paid_collab_enabled() and exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'paid_collab_handler' and is_internal_handler
  );
$$;

-- ---------- B.2 Tables ----------

create table if not exists public.paid_collab_handler_brands (
  handler_id  uuid not null references public.profiles(id) on delete cascade,
  brand_id    uuid not null references public.brands(id)   on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (handler_id, brand_id)
);
create index if not exists pchb_brand_idx   on public.paid_collab_handler_brands(brand_id);
create index if not exists pchb_handler_idx on public.paid_collab_handler_brands(handler_id);

-- The program: one brand + one month ('YYYY-MM').
create table if not exists public.handler_collab_brand_months (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brands(id) on delete cascade,
  month               text not null,
  -- NULL = not set yet (prints "—"), which is different from a 0 budget.
  budget              numeric,
  content_guide_url   text not null default '',
  -- JSON array stored as text: [{"name","url","paused"?}]. Older rows may hold
  -- newline-separated bare URLs; every reader handles both.
  focus_product_url   text not null default '',
  notes               text not null default '',
  -- Percentages; NULL means "not stated", which is different from 0.
  standard_commission numeric,
  shop_ads_commission numeric,
  approval_required   boolean not null default false,
  onboarded_on        date,
  updated_at          timestamptz not null default now(),
  unique (brand_id, month),
  constraint hcbm_month_chk check (month ~ '^\d{4}-\d{2}$'),
  constraint hcbm_commission_pct_chk check (
    (standard_commission is null or standard_commission between 0 and 100)
    and (shop_ads_commission is null or shop_ads_commission between 0 and 100))
);

-- One row per DEAL: a creator in one brand-month. The month is
-- to_char(coalesce(onboarded_on, created_at), 'YYYY-MM').
create table if not exists public.handler_collab_creators (
  id                         uuid primary key default gen_random_uuid(),
  brand_id                   uuid not null references public.brands(id) on delete cascade,
  name                       text not null,
  -- may hold several handles, one per line
  tiktok_handle              text not null default '',
  amount                     numeric not null default 0,
  videos_count               integer not null default 0,
  zelle                      text not null default '',
  paypal                     text not null default '',
  phone                      text not null default '',
  email                      text not null default '',
  category                   text not null default '',
  payment_status             text not null default 'awaiting_confirmation',
  onboarded_on               date,
  completed_on               date,
  -- [{video, adCode, videoAt, auth, invalid, invalidAt, invalidBy, best, bestAt,
  --   bestBy, extra, drafts:[{n,url,status,reason,at,reviewedAt,reviewedBy}]}]
  video_codes                jsonb not null default '[]'::jsonb,
  products                   jsonb not null default '[]'::jsonb,
  -- {"YYYY-MM": {gmv, adSpent}, "weeks": {"YYYY-MM-DD": {gmv, adSpent}}}
  monthly                    jsonb not null default '{}'::jsonb,
  -- [{label, value}] — paypal / zelle columns are trigger-maintained mirrors
  payouts                    jsonb not null default '[]'::jsonb,
  notes                      text not null default '',
  contract_url               text,
  deliverable_days           integer,
  pending_visible_to_client  boolean not null default false,
  client_paid_confirmed_at   timestamptz,
  client_paid_confirmed_name text,
  video_count_updated_at     timestamptz not null default now(),
  created_by                 uuid references public.profiles(id) on delete set null,
  created_at                 timestamptz not null default now(),
  constraint handler_collab_creators_payment_status_check check (payment_status in (
    'awaiting_confirmation', 'videos_in_progress', 'follow_up', 'pending', 'paid', 'terminated'))
);
create index if not exists hcc_brand_idx     on public.handler_collab_creators(brand_id);
create index if not exists hcc_onboarded_idx on public.handler_collab_creators(onboarded_on);

create table if not exists public.handler_collab_brand_order (
  handler_id uuid not null references public.profiles(id) on delete cascade,
  brand_id   uuid not null references public.brands(id)   on delete cascade,
  position   integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (handler_id, brand_id)
);

create table if not exists public.handler_collab_activity_log (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.brands(id) on delete cascade,
  creator_id   uuid,
  creator_name text not null default '',
  month        text,
  action       text not null,
  old_status   text,
  new_status   text,
  auto         boolean not null default false,
  actor_id     uuid,
  actor_name   text not null default '',
  created_at   timestamptz not null default now(),
  constraint hcal_action_check check (action in (
    'creator_added', 'creator_removed', 'status_change',
    'client_paid_marked', 'client_paid_unmarked',
    'video_code_invalid', 'video_code_valid', 'contract_signed'))
);
create index if not exists hcal_brand_created_idx on public.handler_collab_activity_log(brand_id, created_at desc);

-- Threaded discussion per brand / program (target_key = month) / creator
-- (target_key = creator id). Author fields are always set server-side.
create table if not exists public.paid_collab_comments (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  target_type text not null,
  target_key  text not null default '',
  author_type text not null,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text not null default '',
  body        text not null,
  parent_id   uuid references public.paid_collab_comments(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint pcc_author_type_check check (author_type in ('handler', 'bob', 'client')),
  constraint pcc_target_type_check check (target_type in ('brand', 'program', 'creator'))
);
create index if not exists pcc_target_idx on public.paid_collab_comments(brand_id, target_type, target_key);

-- Per-handler contract defaults: representative name + signature image
-- (a data: URL drawn or uploaded in the workspace).
create table if not exists public.handler_contract_settings (
  owner_id      uuid primary key references public.profiles(id) on delete cascade,
  rep_name      text not null default '',
  company_name  text not null default '',
  terms         text not null default '',
  signature_url text not null default '',
  updated_at    timestamptz not null default now()
);

-- One e-sign link per deal. `payload` is the contract as issued (a snapshot,
-- so later edits to the deal never change what the creator signed).
create table if not exists public.handler_contract_signatures (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null unique references public.handler_collab_creators(id) on delete cascade,
  brand_id          uuid not null references public.brands(id) on delete cascade,
  token             text not null unique default replace(gen_random_uuid()::text, '-', ''),
  active            boolean not null default true,
  payload           jsonb not null default '{}'::jsonb,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  signed_at         timestamptz,
  signer_name       text,
  signer_signature  text,
  signer_user_agent text
);
create index if not exists hcs_brand_idx on public.handler_contract_signatures(brand_id);

create table if not exists public.creator_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists creator_categories_name_uniq on public.creator_categories(lower(btrim(name)));

-- The banked half of the Creators Database: ONE row per PERSON, keyed by
-- creator_identity_key() (first TikTok handle, otherwise the name).
create table if not exists public.creator_directory (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  tiktok_handle   text not null default '',
  identity_key    text not null default '',
  phone           text not null default '',
  email           text not null default '',
  category        text not null default '',
  categories      text[] not null default '{}'::text[],
  paypal          text not null default '',
  zelle           text not null default '',
  region          text not null default '',
  followers       bigint,
  rate            numeric,
  notes           text not null default '',
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists creator_directory_identity_idx on public.creator_directory(identity_key);
create index if not exists creator_directory_name_idx on public.creator_directory(lower(name));

create table if not exists public.creator_db_share_links (
  id              uuid primary key default gen_random_uuid(),
  label           text not null default '',
  share_token     text not null unique default replace(gen_random_uuid()::text, '-', ''),
  enabled         boolean not null default true,
  include_contact boolean not null default false,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.handler_message_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  audience        text not null default 'creator',
  category        text not null default '',
  body            text not null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_by_name text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint hmt_audience_check check (audience in ('creator', 'brand'))
);
create unique index if not exists hmt_name_uniq on public.handler_message_templates(audience, lower(btrim(name)));

create table if not exists public.handler_notes (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brand_id         uuid references public.brands(id) on delete set null,
  month            text,
  creator_id       uuid references public.handler_collab_creators(id) on delete set null,
  title            text not null default '',
  body             text not null default '',
  color            text not null default 'default',
  labels           text[] not null default '{}'::text[],
  pinned           boolean not null default false,
  archived         boolean not null default false,
  reminder_at      timestamptz,
  reminder_done    boolean not null default false,
  reminder_sent_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists handler_notes_owner_idx on public.handler_notes(owner_id, archived, pinned, updated_at desc);
create index if not exists handler_notes_reminder_idx on public.handler_notes(reminder_at)
  where reminder_at is not null and reminder_sent_at is null and not archived and not reminder_done;

-- Sharing: a role audience. Handlers share only with handlers of their own
-- circle (internal ↔ internal, external ↔ external); Bobs share with Bobs or
-- the Super Boss. Enforced at write (policy) and read (note_shared_with_caller).
create table if not exists public.handler_note_shares (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.handler_notes(id) on delete cascade,
  target_role text not null,
  created_at  timestamptz not null default now(),
  unique (note_id, target_role),
  constraint hns_target_role_check check (target_role in ('super_boss', 'bob', 'paid_collab_handler'))
);

create table if not exists public.note_labels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists note_labels_owner_name_uniq on public.note_labels(owner_id, lower(name));

-- Hand-added showcase videos; brand optional.
create table if not exists public.best_videos_manual (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid references public.brands(id) on delete cascade,
  video           text not null,
  creator_name    text not null default '',
  tiktok_handle   text not null default '',
  ad_code         text not null default '',
  month           text not null default '',
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text not null default '',
  created_at      timestamptz not null default now()
);
create index if not exists bvm_brand_idx on public.best_videos_manual(brand_id);

create table if not exists public.brand_stock_checks (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  brand_name       text not null default '',
  check_date       date not null,
  month            text not null,
  product_key      text not null,
  product_name     text not null,
  product_url      text not null default '',
  in_stock         boolean not null,
  answered_by      uuid references auth.users(id) on delete set null,
  answered_by_name text not null default '',
  answered_at      timestamptz not null default now(),
  unique (brand_id, check_date, product_key),
  constraint bsc_month_check check (month ~ '^\d{4}-\d{2}$')
);
create index if not exists bsc_date_idx on public.brand_stock_checks(check_date desc, brand_id);

create table if not exists public.stock_check_disabled (
  brand_id         uuid not null references public.brands(id) on delete cascade,
  product_key      text not null,
  product_name     text not null default '',
  disabled_by      uuid references auth.users(id) on delete set null,
  disabled_by_name text not null default '',
  disabled_at      timestamptz not null default now(),
  primary key (brand_id, product_key)
);

-- ---------- B.3 Access helpers ----------
-- Two helpers decide almost everything; keep them the single source of truth.

-- Calling handler holds this brand (and the module is switched on).
create or replace function public.paid_collab_handler_has_brand(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.paid_collab_enabled()
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'paid_collab_handler')
     and exists (select 1 from public.paid_collab_handler_brands hb
                  where hb.handler_id = auth.uid() and hb.brand_id = b_id);
$$;

-- May WRITE this brand's paid-collab data: Bob, or the assigned handler.
create or replace function public.writes_paid_collab_brand(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select b_id is not null and (public.is_bob() or public.paid_collab_handler_has_brand(b_id));
$$;

-- May READ it. Today identical to the write set; widen THIS (not the policies)
-- when a client portal or a staff view arrives.
create or replace function public.reads_paid_collab_brand(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.writes_paid_collab_brand(b_id);
$$;

-- The shared libraries (Creators Database, templates, categories).
create or replace function public.can_use_handler_library()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_bob() or (public.is_paid_collab_handler() and public.paid_collab_enabled());
$$;

create or replace function public.display_name_of(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(btrim(full_name), ''), email, '')
                     from public.profiles where id = p_user), '');
$$;

-- Handlers read their assigned brands (+ the brand's product catalogue).
drop policy if exists "brands handler read" on public.brands;
create policy "brands handler read" on public.brands
  for select using (public.paid_collab_handler_has_brand(id));

drop policy if exists "bp handler read" on public.brand_products;
create policy "bp handler read" on public.brand_products
  for select using (public.paid_collab_handler_has_brand(brand_id));

-- ---------- B.4 Pure helpers ----------

create or replace function public.handler_collab_deal_rows(codes jsonb)
returns integer language sql immutable set search_path = public as $$
  select count(*)::int
  from jsonb_array_elements(case when jsonb_typeof(codes) = 'array' then codes else '[]'::jsonb end) v
  where coalesce(v->>'extra', 'false') <> 'true';
$$;

create or replace function public.handler_collab_posted_videos(codes jsonb)
returns integer language sql immutable set search_path = public as $$
  select count(*)::int
  from jsonb_array_elements(case when jsonb_typeof(codes) = 'array' then codes else '[]'::jsonb end) v
  where btrim(coalesce(v->>'video', '')) <> ''
    and coalesce(v->>'extra', 'false') <> 'true';
$$;

create or replace function public.handler_collab_draft_count(codes jsonb)
returns integer language sql immutable set search_path = public as $$
  select coalesce(sum(jsonb_array_length(v->'drafts')), 0)::int
  from jsonb_array_elements(case when jsonb_typeof(codes) = 'array' then codes else '[]'::jsonb end) v
  where jsonb_typeof(v->'drafts') = 'array'
    and coalesce(v->>'extra', 'false') <> 'true';
$$;

create or replace function public.creator_identity_key(p_name text, p_handle text)
returns text language plpgsql immutable set search_path = public as $$
declare
  first_handle text;
  h text;
begin
  -- handles are stored one per line (or comma-separated) — take the first
  first_handle := btrim(split_part(regexp_replace(coalesce(p_handle, ''), E'[\\n,]+', ',', 'g'), ',', 1));
  if first_handle <> '' then
    h := first_handle;
    if h ~* '^https?://' then
      h := regexp_replace(h, '/+$', '');
      h := regexp_replace(h, '^.*/', '');
    end if;
    h := lower(btrim(regexp_replace(h, '^@+', '')));
    if h <> '' then return 'h:' || h; end if;
  end if;
  return 'n:' || lower(btrim(coalesce(p_name, '')));
end;
$$;

create or replace function public.split_creator_categories(p_text text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(v order by ord), '{}'::text[])
  from (
    select btrim(x) as v, ord
    from unnest(string_to_array(coalesce(p_text, ''), ',')) with ordinality as t(x, ord)
  ) s
  where s.v <> '';
$$;

-- Replace (or with p_new NULL, remove) one category in a list, de-duped
-- case-insensitively, keeping first-seen spelling and order.
create or replace function public.creator_category_replace(p_cats text[], p_old text, p_new text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(c order by ord), '{}'::text[])
    from (
      select distinct on (lower(c)) c, ord
        from (
          select case when lower(btrim(x)) = lower(btrim(p_old)) then nullif(btrim(p_new), '')
                      else btrim(x) end as c,
                 ord
            from unnest(coalesce(p_cats, '{}'::text[])) with ordinality as t(x, ord)
        ) a
       where c is not null and c <> ''
       order by lower(c), ord
    ) d;
$$;

create or replace function public.payout_label_kind(p_label text)
returns text language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p_label, '')))
    when 'paypal' then 'paypal' when 'pay pal' then 'paypal' when 'pp' then 'paypal'
    when 'zelle'  then 'zelle'  when 'z'       then 'zelle'
    else 'other'
  end
$$;

create or replace function public.normalize_creator_payouts(p jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', lbl, 'value', val) order by ord), '[]'::jsonb)
  from (
    select coalesce(nullif(btrim(coalesce(e->>'label', '')), ''), 'Other') as lbl,
           btrim(coalesce(e->>'value', '')) as val,
           ord
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)
         with ordinality as t(e, ord)
  ) d
  where val <> ''
$$;

create or replace function public.stock_product_key(p_name text, p_url text)
returns text language sql immutable set search_path = public as $$
  select lower(btrim(coalesce(nullif(btrim(p_name), ''), btrim(p_url), '')));
$$;

-- ---------- B.5 Creator (deal) triggers ----------

-- created_by is the caller, never the payload.
create or replace function public.handler_collab_creators_fill()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- A newly posted video, or a new draft, restarts the 7-day window. The first
-- video pulls a follow_up creator back to videos_in_progress. An explicit
-- status change in the same update always wins.
create or replace function public.handler_collab_creators_auto_status()
returns trigger language plpgsql set search_path = public as $$
declare
  new_cnt int := public.handler_collab_posted_videos(new.video_codes);
  old_cnt int;
begin
  if tg_op = 'INSERT' then
    new.video_count_updated_at := now();
    return new;
  end if;

  old_cnt := public.handler_collab_posted_videos(old.video_codes);
  if new_cnt > old_cnt then
    new.video_count_updated_at := now();
    if old_cnt = 0 and new.payment_status = 'follow_up' and old.payment_status = 'follow_up' then
      new.payment_status := 'videos_in_progress';
    end if;
  elsif new.payment_status = 'videos_in_progress'
    and old.payment_status is distinct from 'videos_in_progress' then
    -- manual switch back to "Videos in Progress" restarts the stall timer
    new.video_count_updated_at := now();
  end if;

  if public.handler_collab_draft_count(new.video_codes) > public.handler_collab_draft_count(old.video_codes) then
    new.video_count_updated_at := now();
    if new.payment_status = 'follow_up' and old.payment_status = 'follow_up' then
      new.payment_status := 'videos_in_progress';
    end if;
  end if;

  return new;
end $$;

-- Stamps videoAt only on links that are NEW in this write, matched by link
-- (not array position). Any client-sent date is ignored.
create or replace function public.handler_collab_stamp_video_added()
returns trigger language plpgsql set search_path = public as $$
declare
  v_old   jsonb := case when tg_op = 'UPDATE' and jsonb_typeof(old.video_codes) = 'array'
                        then old.video_codes else '[]'::jsonb end;
  v_out   jsonb := '[]'::jsonb;
  v_elem  jsonb;
  v_link  text;
  v_prev  text;
  v_had   boolean;
  v_stamp text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if jsonb_typeof(new.video_codes) <> 'array' then return new; end if;
  if tg_op = 'UPDATE' and new.video_codes is not distinct from old.video_codes then return new; end if;

  for v_elem in select * from jsonb_array_elements(new.video_codes) loop
    v_link := btrim(coalesce(v_elem ->> 'video', ''));
    if v_link = '' then
      v_elem := v_elem - 'videoAt';
    else
      v_had := null; v_prev := null;
      select true, oe ->> 'videoAt' into v_had, v_prev
        from jsonb_array_elements(v_old) oe
       where btrim(coalesce(oe ->> 'video', '')) = v_link
       limit 1;
      if coalesce(v_had, false) then
        if btrim(coalesce(v_prev, '')) = '' then
          v_elem := v_elem - 'videoAt';
        else
          v_elem := v_elem || jsonb_build_object('videoAt', v_prev);
        end if;
      else
        v_elem := v_elem || jsonb_build_object('videoAt', v_stamp);
      end if;
    end if;
    v_out := v_out || jsonb_build_array(v_elem);
  end loop;

  new.video_codes := v_out;
  return new;
end $$;

-- Keeps `payouts` and the paypal/zelle mirrors in step. A write that touches
-- the array wins; a write that touches only the legacy columns rebuilds the
-- list and keeps any custom entries.
create or replace function public.handler_collab_creators_sync_payouts()
returns trigger language plpgsql set search_path = public as $$
declare
  v_payouts        jsonb;
  v_array_changed  boolean := false;
  v_legacy_changed boolean := false;
begin
  v_payouts := public.normalize_creator_payouts(new.payouts);

  if tg_op = 'UPDATE' then
    v_array_changed  := v_payouts is distinct from public.normalize_creator_payouts(old.payouts);
    v_legacy_changed := btrim(coalesce(new.paypal, '')) is distinct from btrim(coalesce(old.paypal, ''))
                     or btrim(coalesce(new.zelle,  '')) is distinct from btrim(coalesce(old.zelle,  ''));
  end if;

  if (tg_op = 'UPDATE' and not v_array_changed and v_legacy_changed)
     or (tg_op = 'INSERT' and jsonb_array_length(v_payouts) = 0) then
    select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_payouts
    from (
      select jsonb_build_object('label', 'PayPal', 'value', btrim(new.paypal)) as x, 1 as ord
       where btrim(coalesce(new.paypal, '')) <> ''
      union all
      select jsonb_build_object('label', 'Zelle', 'value', btrim(new.zelle)), 2
       where btrim(coalesce(new.zelle, '')) <> ''
      union all
      select e, 2 + ord2
        from jsonb_array_elements(
               case when tg_op = 'UPDATE' then public.normalize_creator_payouts(old.payouts)
                    else '[]'::jsonb end
             ) with ordinality as t(e, ord2)
       where public.payout_label_kind(e->>'label') = 'other'
    ) s;
  end if;

  new.payouts := v_payouts;
  new.paypal := coalesce((select e->>'value' from jsonb_array_elements(v_payouts) e
                           where public.payout_label_kind(e->>'label') = 'paypal' limit 1), '');
  new.zelle  := coalesce((select e->>'value' from jsonb_array_elements(v_payouts) e
                           where public.payout_label_kind(e->>'label') = 'zelle' limit 1), '');
  return new;
end $$;

create or replace function public.handler_collab_log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_name text := public.display_name_of(auth.uid());
  v_auto       boolean := coalesce(current_setting('apex.pc_auto_sweep', true), '') = '1';
  v_brand      uuid;
  v_creator    uuid;
  v_name       text;
  v_month      text;
begin
  if tg_op = 'DELETE' then
    v_brand := old.brand_id; v_creator := old.id; v_name := old.name;
    v_month := to_char(coalesce(old.onboarded_on, old.created_at::date), 'YYYY-MM');
  else
    v_brand := new.brand_id; v_creator := new.id; v_name := new.name;
    v_month := to_char(coalesce(new.onboarded_on, new.created_at::date), 'YYYY-MM');
  end if;

  if tg_op = 'INSERT' then
    insert into public.handler_collab_activity_log
      (brand_id, creator_id, creator_name, month, action, new_status, actor_id, actor_name)
    values (v_brand, v_creator, v_name, v_month, 'creator_added', new.payment_status, v_actor, v_actor_name);
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Brand cascade-delete: the brand is already gone, and so are its log rows.
    if not exists (select 1 from public.brands where id = v_brand) then return old; end if;
    insert into public.handler_collab_activity_log
      (brand_id, creator_id, creator_name, month, action, old_status, actor_id, actor_name)
    values (v_brand, v_creator, v_name, v_month, 'creator_removed', old.payment_status, v_actor, v_actor_name);
    return old;
  end if;

  if new.payment_status is distinct from old.payment_status then
    insert into public.handler_collab_activity_log
      (brand_id, creator_id, creator_name, month, action, old_status, new_status, auto, actor_id, actor_name)
    values (v_brand, v_creator, v_name, v_month, 'status_change',
            old.payment_status, new.payment_status, v_auto,
            case when v_auto then null else v_actor end,
            case when v_auto then '' else v_actor_name end);
  end if;

  if (new.client_paid_confirmed_at is not null) <> (old.client_paid_confirmed_at is not null) then
    insert into public.handler_collab_activity_log
      (brand_id, creator_id, creator_name, month, action, actor_id, actor_name)
    values (v_brand, v_creator, v_name, v_month,
            case when new.client_paid_confirmed_at is not null then 'client_paid_marked' else 'client_paid_unmarked' end,
            v_actor,
            coalesce(nullif(btrim(new.client_paid_confirmed_name), ''), nullif(v_actor_name, ''), 'Client'));
  end if;

  return new;
end $$;

-- ---------- B.6 Creators Database banking ----------

create or replace function public.creator_directory_fill()
returns trigger language plpgsql set search_path = public as $$
declare
  v_cats text[];
begin
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' then raise exception 'Creator name is required'; end if;
  new.identity_key := public.creator_identity_key(new.name, new.tiktok_handle);

  v_cats := coalesce(new.categories, '{}'::text[]);
  if tg_op = 'UPDATE'
     and new.categories is not distinct from old.categories
     and btrim(coalesce(new.category, '')) is distinct from btrim(coalesce(old.category, '')) then
    -- the legacy string was written on purpose: it is the intent
    v_cats := public.split_creator_categories(new.category);
  elsif array_length(v_cats, 1) is null and btrim(coalesce(new.category, '')) <> '' then
    v_cats := public.split_creator_categories(new.category);
  end if;

  select coalesce(array_agg(c order by ord), '{}'::text[]) into v_cats
    from (
      select distinct on (lower(c)) c, ord
      from unnest(v_cats) with ordinality as t(c, ord)
      where btrim(c) <> ''
      order by lower(c), ord
    ) d;
  new.categories := v_cats;
  new.category := array_to_string(v_cats, ', ');

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if auth.uid() is not null then
      new.created_by_name := public.display_name_of(auth.uid());
    end if;
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.creator_directory_bank(
  p_name text, p_handle text, p_phone text, p_email text,
  p_category text, p_paypal text, p_zelle text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if btrim(coalesce(p_name, '')) = '' or not public.can_use_handler_library() then return; end if;
  insert into public.creator_directory (name, tiktok_handle, phone, email, category, paypal, zelle)
  values (btrim(p_name), coalesce(p_handle, ''), coalesce(p_phone, ''), coalesce(p_email, ''),
          coalesce(p_category, ''), coalesce(p_paypal, ''), coalesce(p_zelle, ''))
  on conflict (identity_key) do nothing;
exception when others then
  null;  -- bookkeeping never aborts the caller's write
end $$;

-- Every deal banks its creator into the Creators Database. Later edits carry
-- over ONLY where the database row still holds what the deal used to say (or
-- nothing): a value edited in the database is deliberate and stays put.
create or replace function public.creator_directory_sync_deal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_key     text;
  v_old_key text;
begin
  if tg_op = 'INSERT' then
    perform public.creator_directory_bank(
      new.name, new.tiktok_handle, new.phone, new.email, new.category, new.paypal, new.zelle);
    return new;
  end if;

  if (btrim(coalesce(new.name, '')), coalesce(new.tiktok_handle, ''), coalesce(new.phone, ''),
      coalesce(new.email, ''), coalesce(new.category, ''), coalesce(new.paypal, ''), coalesce(new.zelle, ''))
     is not distinct from
     (btrim(coalesce(old.name, '')), coalesce(old.tiktok_handle, ''), coalesce(old.phone, ''),
      coalesce(old.email, ''), coalesce(old.category, ''), coalesce(old.paypal, ''), coalesce(old.zelle, '')) then
    return new;
  end if;

  v_key     := public.creator_identity_key(new.name, new.tiktok_handle);
  v_old_key := public.creator_identity_key(old.name, old.tiktok_handle);
  if v_key is distinct from v_old_key then
    perform public.creator_directory_bank(
      new.name, new.tiktok_handle, new.phone, new.email, new.category, new.paypal, new.zelle);
  end if;

  begin
    update public.creator_directory d set
      name     = case when d.name = btrim(coalesce(old.name, '')) and btrim(coalesce(new.name, '')) <> ''
                      then btrim(new.name) else d.name end,
      phone    = case when (d.phone = '' or d.phone = coalesce(old.phone, '')) and coalesce(new.phone, '') <> ''
                      then new.phone else d.phone end,
      email    = case when (d.email = '' or d.email = coalesce(old.email, '')) and coalesce(new.email, '') <> ''
                      then new.email else d.email end,
      category = case when (d.category = '' or d.category = coalesce(old.category, '')) and coalesce(new.category, '') <> ''
                      then new.category else d.category end,
      paypal   = case when (d.paypal = '' or d.paypal = coalesce(old.paypal, '')) and coalesce(new.paypal, '') <> ''
                      then new.paypal else d.paypal end,
      zelle    = case when (d.zelle = '' or d.zelle = coalesce(old.zelle, '')) and coalesce(new.zelle, '') <> ''
                      then new.zelle else d.zelle end
    where d.identity_key = v_key;
  exception when others then
    null;
  end;
  return new;
end $$;

-- Deleting a creator's LAST deal archives them in the database instead of
-- losing them.
create or replace function public.creator_directory_archive_deal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  if btrim(coalesce(old.name, '')) = '' then return old; end if;
  v_key := public.creator_identity_key(old.name, old.tiktok_handle);
  if exists (select 1 from public.handler_collab_creators c
              where c.id <> old.id and public.creator_identity_key(c.name, c.tiktok_handle) = v_key) then
    return old;
  end if;
  begin
    insert into public.creator_directory (name, tiktok_handle, phone, email, category, paypal, zelle)
    values (btrim(old.name), coalesce(old.tiktok_handle, ''), coalesce(old.phone, ''), coalesce(old.email, ''),
            coalesce(old.category, ''), coalesce(old.paypal, ''), coalesce(old.zelle, ''))
    on conflict (identity_key) do nothing;
  exception when others then
    null;
  end;
  return old;
end $$;

-- ---------- B.7 Category RPCs ----------

create or replace function public.creator_category_rewrite(p_old text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_use_handler_library() then
    raise exception 'You do not have access to creator categories' using errcode = '42501';
  end if;
  -- Both columns, explicitly: creator_directory_fill() re-splits `category`
  -- when the array comes out EMPTY, which would resurrect a deleted last word.
  update public.creator_directory
     set categories = public.creator_category_replace(categories, p_old, p_new),
         category   = array_to_string(public.creator_category_replace(categories, p_old, p_new), ', ')
   where exists (select 1 from unnest(categories) c where lower(btrim(c)) = lower(btrim(p_old)));

  update public.handler_collab_creators
     set category = array_to_string(
           public.creator_category_replace(public.split_creator_categories(category), p_old, p_new), ', ')
   where exists (select 1 from unnest(public.split_creator_categories(category)) c
                  where lower(btrim(c)) = lower(btrim(p_old)));
end $$;

create or replace function public.rename_creator_category(p_old text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text := btrim(coalesce(p_old, ''));
  v_new text := btrim(coalesce(p_new, ''));
  v_old_id uuid;
  v_new_id uuid;
begin
  if not public.can_use_handler_library() then
    raise exception 'You do not have access to creator categories' using errcode = '42501';
  end if;
  if v_old = '' or v_new = '' then raise exception 'A category needs a name'; end if;
  if position(',' in v_new) > 0 then raise exception 'A category name cannot contain a comma'; end if;
  if v_old = v_new then return; end if;

  select id into v_old_id from public.creator_categories where lower(btrim(name)) = lower(v_old) limit 1;
  select id into v_new_id from public.creator_categories where lower(btrim(name)) = lower(v_new) limit 1;

  -- merging into an existing category keeps ITS spelling
  if v_new_id is not null and v_new_id is distinct from v_old_id then
    select btrim(name) into v_new from public.creator_categories where id = v_new_id;
  end if;

  if v_new_id is not null and v_old_id is not null and v_new_id <> v_old_id then
    delete from public.creator_categories where id = v_old_id;
  elsif v_old_id is not null then
    update public.creator_categories set name = v_new where id = v_old_id;
  elsif v_new_id is null then
    insert into public.creator_categories (name, created_by) values (v_new, auth.uid());
  end if;

  perform public.creator_category_rewrite(v_old, v_new);
end $$;

create or replace function public.delete_creator_category(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.can_use_handler_library() then
    raise exception 'You do not have access to creator categories' using errcode = '42501';
  end if;
  if v_name = '' then return; end if;
  delete from public.creator_categories where lower(btrim(name)) = lower(v_name);
  perform public.creator_category_rewrite(v_name, null);
end $$;

create or replace function public.set_creator_category_color(p_name text, p_color text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_color text := nullif(btrim(coalesce(p_color, '')), '');
begin
  if not public.can_use_handler_library() then
    raise exception 'You do not have access to creator categories' using errcode = '42501';
  end if;
  if v_name = '' then return; end if;
  if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Colour must be a #rrggbb value';
  end if;
  update public.creator_categories set color = v_color where lower(btrim(name)) = lower(v_name);
  if not found then
    insert into public.creator_categories (name, color, created_by) values (v_name, v_color, auth.uid());
  end if;
end $$;

-- ---------- B.8 Workspace RPCs ----------

-- Bob sets a handler's brand list (diff-based). Only paid-collab brands
-- (scope contains 'paid_creator') can be assigned. Notifies new brands.
create or replace function public.set_paid_collab_handler_brands(p_handler uuid, p_brands uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_added int;
begin
  if not public.is_bob() then raise exception 'Only Bob can assign handler brands'; end if;
  if not exists (select 1 from public.profiles where id = p_handler and role = 'paid_collab_handler') then
    raise exception 'That user is not a Paid Collab Handler';
  end if;
  if exists (select 1 from unnest(coalesce(p_brands, '{}'::uuid[])) b(id)
              join public.brands br on br.id = b.id
             where not ('paid_creator' = any(br.scope))) then
    raise exception 'Only brands with the Paid Collab scope can be assigned to a handler';
  end if;

  delete from public.paid_collab_handler_brands
   where handler_id = p_handler and not (brand_id = any(coalesce(p_brands, '{}'::uuid[])));

  with ins as (
    insert into public.paid_collab_handler_brands (handler_id, brand_id)
    select p_handler, b.id from unnest(coalesce(p_brands, '{}'::uuid[])) b(id)
      join public.brands br on br.id = b.id
    on conflict do nothing
    returning brand_id
  )
  select count(*) into v_added from ins;

  if v_added > 0 then
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (p_handler, 'brand_assignment',
            'New paid-collab brand' || case when v_added > 1 then 's' else '' end || ' assigned',
            v_added || ' brand' || case when v_added > 1 then 's were' else ' was' end || ' added to your workspace.',
            '/paid-collab', jsonb_build_object('kind', 'paid_collab_brand_assigned'));
  end if;
end $$;

-- The stall sweep. Call on workspace load (the UI throttles to every 5 min).
--   all DEAL videos posted → pending (+ completed_on)
--   videos_in_progress with no new video for 7 days → follow_up
create or replace function public.handler_collab_apply_follow_ups()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n1 int;
  n2 int;
begin
  if not public.can_use_handler_library() then return 0; end if;
  perform set_config('apex.pc_auto_sweep', '1', true);

  update public.handler_collab_creators
     set payment_status = 'pending',
         completed_on = coalesce(completed_on, current_date)
   where payment_status in ('videos_in_progress', 'follow_up')
     and public.handler_collab_deal_rows(video_codes) > 0
     and public.handler_collab_posted_videos(video_codes) = public.handler_collab_deal_rows(video_codes)
     and public.handler_collab_posted_videos(video_codes) >= greatest(videos_count, 1);
  get diagnostics n1 = row_count;

  update public.handler_collab_creators
     set payment_status = 'follow_up'
   where payment_status = 'videos_in_progress'
     and coalesce(video_count_updated_at, created_at) < now() - interval '7 days';
  get diagnostics n2 = row_count;

  perform set_config('apex.pc_auto_sweep', '', true);
  return n1 + n2;
end $$;

-- Authorised toggle on one video row.
create or replace function public.set_handler_creator_video_auth(p_creator uuid, p_index integer, p_auth boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  b_id uuid;
  codes jsonb;
begin
  select brand_id, video_codes into b_id, codes from public.handler_collab_creators where id = p_creator;
  if b_id is null then raise exception 'creator not found'; end if;
  if not public.writes_paid_collab_brand(b_id) then raise exception 'not allowed'; end if;
  if codes is null or jsonb_typeof(codes) <> 'array' then raise exception 'no videos'; end if;
  if p_index < 0 or p_index >= jsonb_array_length(codes) then raise exception 'bad video index'; end if;

  codes := jsonb_set(codes, array[p_index::text, 'auth'], to_jsonb(coalesce(p_auth, false)), true);
  update public.handler_collab_creators set video_codes = codes where id = p_creator;
end $$;

-- Report an ad code as not working (stamps who + when, clears Authorised)
-- and notify the brand's other handlers with a ready-to-forward message.
-- Kept in sync with invalidCodeMessage() in src/pages/paidcollab/store.ts.
create or replace function public.set_handler_creator_video_invalid(p_creator uuid, p_index integer, p_invalid boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  b_id         uuid;
  codes        jsonb;
  row_j        jsonb;
  v_name       text;
  v_first      text;
  v_video      text;
  v_month      text;
  v_brand      text;
  v_actor      uuid := auth.uid();
  v_actor_name text := public.display_name_of(auth.uid());
  v_body       text;
  v_flag       boolean := coalesce(p_invalid, false);
begin
  select brand_id, video_codes, name, to_char(coalesce(onboarded_on, created_at::date), 'YYYY-MM')
    into b_id, codes, v_name, v_month
    from public.handler_collab_creators where id = p_creator;
  if b_id is null then raise exception 'creator not found'; end if;
  if not public.writes_paid_collab_brand(b_id) then raise exception 'not allowed'; end if;
  if codes is null or jsonb_typeof(codes) <> 'array' then raise exception 'no videos'; end if;
  if p_index < 0 or p_index >= jsonb_array_length(codes) then raise exception 'bad video index'; end if;

  row_j   := codes -> p_index;
  v_video := coalesce(row_j ->> 'video', '');

  if v_flag then
    row_j := row_j || jsonb_build_object(
      'invalid', true, 'auth', false,
      'invalidAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'invalidBy', v_actor_name);
  else
    row_j := ((row_j - 'invalid') - 'invalidAt') - 'invalidBy';
  end if;

  codes := jsonb_set(codes, array[p_index::text], row_j, true);
  update public.handler_collab_creators set video_codes = codes where id = p_creator;

  if v_flag then
    v_first := split_part(btrim(coalesce(v_name, '')), ' ', 1);
    select name into v_brand from public.brands where id = b_id;
    v_body := 'Hi ' || coalesce(nullif(v_first, ''), 'there')
      || '! It looks like the ad code for one of your videos isn''t working. '
      || 'Could you please generate a new ad code for the video below and send it over?'
      || E'\n\n' || coalesce(nullif(btrim(v_video), ''), '(video link not added yet)');

    insert into public.notifications (user_id, type, title, body, link, payload)
    select hb.handler_id, 'paid_collab_invalid_code', 'Invalid Ad Code · ' || coalesce(v_brand, 'a brand'), v_body,
           '/paid-collab?brand=' || b_id::text || '&month=' || coalesce(v_month, ''),
           jsonb_build_object('kind', 'invalid_ad_code', 'brand_id', b_id, 'brand_name', v_brand,
                              'creator_id', p_creator, 'creator_name', v_name,
                              'video_index', p_index, 'video', v_video,
                              'ad_code', row_j ->> 'adCode', 'reported_by', v_actor_name)
      from public.paid_collab_handler_brands hb
     where hb.brand_id = b_id and hb.handler_id is distinct from v_actor;
  end if;

  insert into public.handler_collab_activity_log
    (brand_id, creator_id, creator_name, month, action, actor_id, actor_name)
  values (b_id, p_creator, coalesce(v_name, ''), v_month,
          case when v_flag then 'video_code_invalid' else 'video_code_valid' end, v_actor, v_actor_name);
end $$;

-- Star (or un-star) a best video. Stamps who + when.
create or replace function public.set_handler_creator_video_best(p_creator uuid, p_index integer, p_best boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  b_id   uuid;
  codes  jsonb;
  row_j  jsonb;
  v_flag boolean := coalesce(p_best, false);
begin
  select brand_id, video_codes into b_id, codes from public.handler_collab_creators where id = p_creator;
  if b_id is null then raise exception 'creator not found'; end if;
  if not public.writes_paid_collab_brand(b_id) then raise exception 'not allowed'; end if;
  if codes is null or jsonb_typeof(codes) <> 'array' then raise exception 'no videos'; end if;
  if p_index < 0 or p_index >= jsonb_array_length(codes) then raise exception 'bad video index'; end if;

  row_j := codes -> p_index;
  if v_flag and btrim(coalesce(row_j ->> 'video', '')) = '' then
    raise exception 'this row has no video link yet';
  end if;
  if v_flag then
    row_j := row_j || jsonb_build_object(
      'best', true,
      'bestAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'bestBy', public.display_name_of(auth.uid()));
  else
    row_j := ((row_j - 'best') - 'bestAt') - 'bestBy';
  end if;

  codes := jsonb_set(codes, array[p_index::text], row_j, true);
  update public.handler_collab_creators set video_codes = codes where id = p_creator;
end $$;

-- ---------- B.9 Authorship fill triggers ----------

create or replace function public.paid_collab_comments_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.author_id   := auth.uid();
  new.author_name := public.display_name_of(auth.uid());
  new.author_type := case when public.is_bob() then 'bob' else 'handler' end;
  new.body        := btrim(coalesce(new.body, ''));
  new.created_at  := now();
  if new.body = '' then raise exception 'A comment needs some text'; end if;
  return new;
end $$;

-- Ping the brand's other handlers when someone comments.
create or replace function public.paid_collab_comments_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_brand text;
  v_label text;
begin
  select name into v_brand from public.brands where id = new.brand_id;
  v_label := case new.target_type when 'brand' then 'the brand' when 'program' then 'the ' || new.target_key || ' program'
             else 'a creator' end;
  insert into public.notifications (user_id, type, title, body, link, payload)
  select hb.handler_id, 'paid_collab_comment',
         new.author_name || ' commented on ' || coalesce(v_brand, 'a brand'),
         'On ' || v_label || ': "' || left(new.body, 140) || case when length(new.body) > 140 then '…' else '' end || '"',
         '/paid-collab?tab=discussions&brand=' || new.brand_id::text,
         jsonb_build_object('brand_id', new.brand_id, 'target_type', new.target_type,
                            'target_key', new.target_key, 'comment_id', new.id)
    from public.paid_collab_handler_brands hb
   where hb.brand_id = new.brand_id and hb.handler_id is distinct from new.author_id;
  return new;
exception when others then
  return new;  -- a notification never blocks the comment
end $$;

create or replace function public.handler_message_templates_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text := public.display_name_of(auth.uid());
begin
  new.name     := btrim(coalesce(new.name, ''));
  new.body     := btrim(coalesce(new.body, ''));
  new.category := btrim(coalesce(new.category, ''));
  if new.name = '' then raise exception 'A template needs a name'; end if;
  if new.body = '' then raise exception 'A template needs a message'; end if;

  if tg_op = 'INSERT' then
    new.created_by      := auth.uid();
    new.created_by_name := v_name;
    new.created_at      := now();
  else
    new.created_by      := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at      := old.created_at;
  end if;
  new.updated_by      := auth.uid();
  new.updated_by_name := v_name;
  new.updated_at      := now();
  return new;
end $$;

create or replace function public.best_videos_manual_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by      := auth.uid();
    new.created_by_name := public.display_name_of(auth.uid());
    new.created_at      := now();
  else
    new.created_by      := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at      := old.created_at;
  end if;
  new.video         := btrim(coalesce(new.video, ''));
  new.creator_name  := btrim(coalesce(new.creator_name, ''));
  new.tiktok_handle := btrim(coalesce(new.tiktok_handle, ''));
  new.ad_code       := btrim(coalesce(new.ad_code, ''));
  new.month         := coalesce(new.month, '');
  if new.video = '' then raise exception 'a best video needs a link'; end if;
  if new.month <> '' and new.month !~ '^\d{4}-\d{2}$' then new.month := left(new.month, 7); end if;
  return new;
end $$;

create or replace function public.creator_db_share_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.label := btrim(coalesce(new.label, ''));
  if tg_op = 'INSERT' then
    -- Mint the token here, never take the client's: a chosen token is a guessable one.
    new.share_token     := replace(gen_random_uuid()::text, '-', '');
    new.created_by      := auth.uid();
    new.created_by_name := public.display_name_of(auth.uid());
    new.created_at      := now();
  else
    new.created_by      := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at      := old.created_at;
    -- The token moves ONLY through the rotate RPC, which announces itself
    -- with a transaction-local flag.
    if coalesce(current_setting('apex.cdb_rotate', true), '') <> '1' then
      new.share_token := old.share_token;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- E-sign rows: token minted server-side; signer fields only move through
-- contract_sign_submit(); a signed contract's payload is frozen.
create or replace function public.handler_contract_signatures_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.token := replace(gen_random_uuid()::text, '-', '');
    new.created_by := auth.uid();
    new.created_at := now();
    new.signed_at := null; new.signer_name := null;
    new.signer_signature := null; new.signer_user_agent := null;
  elsif coalesce(current_setting('apex.contract_sign', true), '') <> '1' then
    new.token := old.token;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.signed_at := old.signed_at; new.signer_name := old.signer_name;
    new.signer_signature := old.signer_signature; new.signer_user_agent := old.signer_user_agent;
    if old.signed_at is not null then new.payload := old.payload; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.handler_notes_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.owner_id := old.owner_id;
  new.updated_at := now();
  -- re-arm the reminder if its time was changed/cleared
  if new.reminder_at is distinct from old.reminder_at then
    new.reminder_sent_at := null;
    new.reminder_done := false;
  end if;
  return new;
end $$;

create or replace function public.brand_stock_checks_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.product_name := btrim(coalesce(new.product_name, ''));
  new.product_url  := btrim(coalesce(new.product_url, ''));
  new.product_key  := public.stock_product_key(new.product_name, new.product_url);
  if new.product_key = '' then raise exception 'A stock answer needs a product name or link.'; end if;
  if new.product_name = '' then new.product_name := new.product_url; end if;
  new.month := to_char(new.check_date, 'YYYY-MM');
  new.brand_name := coalesce((select b.name from public.brands b where b.id = new.brand_id), '');
  new.answered_by := auth.uid();
  new.answered_by_name := public.display_name_of(auth.uid());
  new.answered_at := now();
  return new;
end $$;

create or replace function public.stock_check_disabled_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.product_key := lower(btrim(coalesce(new.product_key, '')));
  if new.product_key = '' then raise exception 'Which product?'; end if;
  new.disabled_at := now();
  new.disabled_by := auth.uid();
  new.disabled_by_name := public.display_name_of(auth.uid());
  return new;
end $$;

-- ---------- B.10 Notes: sharing, listing, reminders ----------

-- 'internal' / 'external' for a handler, NULL for anyone else.
create or replace function public.note_handler_circle(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when coalesce(is_internal_handler, false) then 'internal' else 'external' end
    from public.profiles where id = p_user and role = 'paid_collab_handler';
$$;

create or replace function public.note_shared_with_caller(p_note uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_role         text;
  v_super        boolean;
  v_circle       text;
  v_owner_circle text;
begin
  select role, coalesce(is_superbob, false) into v_role, v_super
    from public.profiles where id = auth.uid();
  if v_role is null then return false; end if;

  v_circle := public.note_handler_circle(auth.uid());
  select public.note_handler_circle(n.owner_id) into v_owner_circle
    from public.handler_notes n where n.id = p_note;

  return exists (
    select 1 from public.handler_note_shares s
     where s.note_id = p_note
       and ((s.target_role = 'super_boss' and v_super)
         or (s.target_role = 'bob' and v_role = 'bob')
         -- handler → handler, same side of the internal/external line only;
         -- the kill switch suspends sharing like every other surface
         or (s.target_role = 'paid_collab_handler'
             and public.paid_collab_enabled()
             and v_circle is not null
             and v_circle = v_owner_circle))
  );
end $$;

create or replace function public.list_visible_notes()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(hn)
       || jsonb_build_object(
            'owner_name', coalesce(nullif(btrim(p.full_name), ''), p.email, ''),
            'is_owner', hn.owner_id = auth.uid(),
            'shares', case when hn.owner_id = auth.uid() then (
                select coalesce(jsonb_agg(s.target_role order by s.target_role), '[]'::jsonb)
                  from public.handler_note_shares s where s.note_id = hn.id
              ) else '[]'::jsonb end)
    from public.handler_notes hn
    join public.profiles p on p.id = hn.owner_id
   where auth.uid() is not null
     and (hn.owner_id = auth.uid() or public.note_shared_with_caller(hn.id))
   order by hn.pinned desc, hn.updated_at desc;
$$;

-- Turns due reminders into notifications. The board calls it every 60s.
create or replace function public.fire_due_note_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  fired integer;
begin
  if auth.uid() is null then return 0; end if;
  with due as (
    select hn.id, hn.owner_id, hn.title, hn.body, hn.brand_id, hn.creator_id, hn.month
      from public.handler_notes hn
     where hn.reminder_at is not null
       and hn.reminder_at <= now()
       and hn.reminder_sent_at is null
       and not hn.archived
       and not hn.reminder_done
     for update of hn skip locked
  ), ins as (
    insert into public.notifications (user_id, type, title, body, link, payload)
    select owner_id, 'note_reminder',
           'Reminder: ' || coalesce(nullif(btrim(title), ''), 'Note'),
           left(nullif(btrim(body), ''), 160),
           '/paid-collab?tab=notes',
           jsonb_build_object('note_id', id, 'brand_id', brand_id, 'creator_id', creator_id, 'month', month)
      from due
    returning 1
  ), upd as (
    update public.handler_notes hn
       set reminder_sent_at = now()
      from due
     where hn.id = due.id
    returning 1
  )
  select count(*) into fired from upd;
  return fired;
end $$;

-- ---------- B.11 Stock check ----------

-- Products to ask about for a brand-month: the focus products, else the
-- brand's catalogue, else one "All products" line.
create or replace function public.stock_brand_products(p_brand uuid, p_month text)
returns table(product_key text, product_name text, product_url text, source text, paused boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  fp  text;
  arr jsonb;
  e   jsonb;
  nm  text;
  ur  text;
  ln  text;
  n   int := 0;
begin
  select coalesce(m.focus_product_url, '') into fp
    from public.handler_collab_brand_months m
   where m.brand_id = p_brand and m.month = p_month;
  fp := coalesce(fp, '');

  if btrim(fp) <> '' then
    arr := null;
    begin arr := fp::jsonb; exception when others then arr := null; end;
    if arr is not null and jsonb_typeof(arr) = 'array' then
      for e in select * from jsonb_array_elements(arr) loop
        if jsonb_typeof(e) = 'string' then nm := ''; ur := e #>> '{}'; paused := false;
        else nm := coalesce(e->>'name', ''); ur := coalesce(e->>'url', '');
             paused := coalesce((e->>'paused')::boolean, false); end if;
        if public.stock_product_key(nm, ur) = '' then continue; end if;
        product_key := public.stock_product_key(nm, ur);
        product_name := coalesce(nullif(btrim(nm), ''), btrim(ur));
        product_url := btrim(ur);
        source := 'focus';
        n := n + 1;
        return next;
      end loop;
    else
      for ln in select btrim(x) from regexp_split_to_table(fp, E'\\n+') x loop
        if ln = '' then continue; end if;
        product_key := public.stock_product_key('', ln);
        product_name := ln; product_url := ln; source := 'focus'; paused := false;
        n := n + 1;
        return next;
      end loop;
    end if;
  end if;
  if n > 0 then return; end if;

  for nm, ur in
    select bp.name, coalesce(bp.tiktok_link, '') from public.brand_products bp
     where bp.brand_id = p_brand and btrim(coalesce(bp.name, '')) <> ''
     order by bp.created_at
  loop
    product_key := public.stock_product_key(nm, ur);
    product_name := btrim(nm); product_url := btrim(ur); source := 'catalog'; paused := false;
    n := n + 1;
    return next;
  end loop;
  if n > 0 then return; end if;

  product_key := 'all products'; product_name := 'All products'; product_url := '';
  source := 'brand'; paused := false;
  return next;
end $$;

create or replace function public.stock_check_board(p_day date, p_brands uuid[])
returns table(brand_id uuid, product_key text, product_name text, product_url text, source text,
              paused boolean, in_stock boolean, answered_by_name text, answered_at timestamptz,
              disabled boolean, disabled_by_name text)
language sql stable security definer set search_path = public as $$
  select b.id, p.product_key, p.product_name, p.product_url, p.source, p.paused,
         c.in_stock, c.answered_by_name, c.answered_at,
         d.brand_id is not null, d.disabled_by_name
    from public.brands b
    cross join lateral public.stock_brand_products(b.id, to_char(p_day, 'YYYY-MM')) p
    left join public.brand_stock_checks c
      on c.brand_id = b.id and c.check_date = p_day and c.product_key = p.product_key
    left join public.stock_check_disabled d
      on d.brand_id = b.id and d.product_key = p.product_key
   where b.id = any(p_brands)
     and public.reads_paid_collab_brand(b.id);
$$;

-- ---------- B.12 Public (anon) RPCs: shared Creators Database + e-sign ----------

create or replace function public.creator_db_reset_share_token(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not public.is_bob() then
    raise exception 'Only a Boss can change this link.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.creator_db_share_links where id = p_id) then
    raise exception 'Link not found.' using errcode = 'no_data_found';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '');
  perform set_config('apex.cdb_rotate', '1', true);
  update public.creator_db_share_links set share_token = v_token where id = p_id;
  perform set_config('apex.cdb_rotate', '', true);
  return v_token;
end $$;

-- Read-only Creators Database for a share link. Contact + payout fields are
-- emitted as '' unless the link allows them; video links and ad codes never
-- travel (only a delivered COUNT does).
create or replace function public.creator_db_shared(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r           record;
  v_directory jsonb;
  v_deals     jsonb;
begin
  if p_code is null or length(btrim(p_code)) < 16 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into r from public.creator_db_share_links where share_token = btrim(p_code);
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not r.enabled then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'identity_key', d.identity_key, 'name', d.name, 'tiktok_handle', d.tiktok_handle,
           'categories', d.categories, 'region', d.region, 'followers', d.followers, 'rate', d.rate,
           'created_at', d.created_at,
           'phone',  case when r.include_contact then d.phone  else '' end,
           'email',  case when r.include_contact then d.email  else '' end,
           'paypal', case when r.include_contact then d.paypal else '' end,
           'zelle',  case when r.include_contact then d.zelle  else '' end,
           'notes',  case when r.include_contact then d.notes  else '' end
         ) order by d.name), '[]'::jsonb)
    into v_directory
    from public.creator_directory d;

  select coalesce(jsonb_agg(jsonb_build_object(
           'brand_name', coalesce(b.name, '—'), 'brand_currency', coalesce(b.currency, 'USD'),
           'name', c.name, 'tiktok_handle', c.tiktok_handle, 'category', c.category,
           'payment_status', c.payment_status, 'amount', c.amount, 'videos_count', c.videos_count,
           'videos_delivered', public.handler_collab_posted_videos(c.video_codes),
           'monthly', c.monthly, 'onboarded_on', c.onboarded_on, 'created_at', c.created_at,
           'phone',  case when r.include_contact then c.phone  else '' end,
           'email',  case when r.include_contact then c.email  else '' end
         ) order by c.onboarded_on desc nulls last, c.created_at desc), '[]'::jsonb)
    into v_deals
    from public.handler_collab_creators c
    left join public.brands b on b.id = c.brand_id
   where c.payment_status not in ('awaiting_confirmation', 'terminated');

  return jsonb_build_object('ok', true, 'label', r.label, 'include_contact', r.include_contact,
                            'generated_at', now(), 'directory', v_directory, 'deals', v_deals);
end $$;

create or replace function public.contract_sign_get(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
             'ok', true, 'payload', s.payload, 'signed_at', s.signed_at,
             'signer_name', s.signer_name, 'signer_signature', s.signer_signature)
      from public.handler_contract_signatures s
     where s.token = btrim(p_token) and s.active and length(btrim(coalesce(p_token, ''))) >= 16
  ), jsonb_build_object('ok', false, 'reason', 'not_found'));
$$;

create or replace function public.contract_sign_submit(p_token text, p_name text, p_signature text, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_creator text;
begin
  select * into s from public.handler_contract_signatures
   where token = btrim(coalesce(p_token, '')) and active and length(btrim(coalesce(p_token, ''))) >= 16
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.signed_at is not null then return jsonb_build_object('ok', false, 'reason', 'already_signed'); end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Please type your full name'; end if;
  if coalesce(p_signature, '') !~ '^data:image/png;base64,' or length(p_signature) > 400000 then
    raise exception 'Please draw your signature';
  end if;

  perform set_config('apex.contract_sign', '1', true);
  update public.handler_contract_signatures
     set signed_at = now(), signer_name = left(btrim(p_name), 200),
         signer_signature = p_signature, signer_user_agent = left(coalesce(p_user_agent, ''), 400)
   where id = s.id;
  perform set_config('apex.contract_sign', '', true);

  select name into v_creator from public.handler_collab_creators where id = s.creator_id;

  insert into public.handler_collab_activity_log (brand_id, creator_id, creator_name, action, actor_name)
  values (s.brand_id, s.creator_id, coalesce(v_creator, ''), 'contract_signed', left(btrim(p_name), 200));

  insert into public.notifications (user_id, type, title, body, link, payload)
  select hb.handler_id, 'paid_collab_contract_signed',
         coalesce(v_creator, 'A creator') || ' signed their contract',
         'Signed as "' || left(btrim(p_name), 200) || '".',
         '/paid-collab?brand=' || s.brand_id::text,
         jsonb_build_object('brand_id', s.brand_id, 'creator_id', s.creator_id)
    from public.paid_collab_handler_brands hb
   where hb.brand_id = s.brand_id;

  return jsonb_build_object('ok', true);
end $$;

-- ---------- B.13 Triggers ----------

drop trigger if exists hcbm_set_updated_at on public.handler_collab_brand_months;
create trigger hcbm_set_updated_at before update on public.handler_collab_brand_months
  for each row execute function public.set_updated_at();

drop trigger if exists handler_collab_creators_fill on public.handler_collab_creators;
create trigger handler_collab_creators_fill before insert or update on public.handler_collab_creators
  for each row execute function public.handler_collab_creators_fill();
drop trigger if exists handler_collab_creators_auto_status on public.handler_collab_creators;
create trigger handler_collab_creators_auto_status before insert or update on public.handler_collab_creators
  for each row execute function public.handler_collab_creators_auto_status();
drop trigger if exists handler_collab_creators_stamp_video on public.handler_collab_creators;
create trigger handler_collab_creators_stamp_video before insert or update of video_codes on public.handler_collab_creators
  for each row execute function public.handler_collab_stamp_video_added();
drop trigger if exists handler_collab_creators_sync_payouts on public.handler_collab_creators;
create trigger handler_collab_creators_sync_payouts before insert or update on public.handler_collab_creators
  for each row execute function public.handler_collab_creators_sync_payouts();
drop trigger if exists handler_collab_creators_log on public.handler_collab_creators;
create trigger handler_collab_creators_log after insert or update or delete on public.handler_collab_creators
  for each row execute function public.handler_collab_log_activity();
drop trigger if exists handler_collab_creators_bank on public.handler_collab_creators;
create trigger handler_collab_creators_bank after insert or update on public.handler_collab_creators
  for each row execute function public.creator_directory_sync_deal();
drop trigger if exists handler_collab_creators_archive on public.handler_collab_creators;
create trigger handler_collab_creators_archive after delete on public.handler_collab_creators
  for each row execute function public.creator_directory_archive_deal();

drop trigger if exists creator_directory_fill on public.creator_directory;
create trigger creator_directory_fill before insert or update on public.creator_directory
  for each row execute function public.creator_directory_fill();

drop trigger if exists paid_collab_comments_fill on public.paid_collab_comments;
create trigger paid_collab_comments_fill before insert on public.paid_collab_comments
  for each row execute function public.paid_collab_comments_fill();
drop trigger if exists paid_collab_comments_notify on public.paid_collab_comments;
create trigger paid_collab_comments_notify after insert on public.paid_collab_comments
  for each row execute function public.paid_collab_comments_notify();

drop trigger if exists handler_message_templates_fill on public.handler_message_templates;
create trigger handler_message_templates_fill before insert or update on public.handler_message_templates
  for each row execute function public.handler_message_templates_fill();
drop trigger if exists best_videos_manual_fill on public.best_videos_manual;
create trigger best_videos_manual_fill before insert or update on public.best_videos_manual
  for each row execute function public.best_videos_manual_fill();
drop trigger if exists creator_db_share_links_fill on public.creator_db_share_links;
create trigger creator_db_share_links_fill before insert or update on public.creator_db_share_links
  for each row execute function public.creator_db_share_fill();
drop trigger if exists handler_contract_signatures_fill on public.handler_contract_signatures;
create trigger handler_contract_signatures_fill before insert or update on public.handler_contract_signatures
  for each row execute function public.handler_contract_signatures_fill();
drop trigger if exists handler_notes_touch on public.handler_notes;
create trigger handler_notes_touch before update on public.handler_notes
  for each row execute function public.handler_notes_touch();
drop trigger if exists brand_stock_checks_fill on public.brand_stock_checks;
create trigger brand_stock_checks_fill before insert or update on public.brand_stock_checks
  for each row execute function public.brand_stock_checks_fill();
drop trigger if exists stock_check_disabled_fill on public.stock_check_disabled;
create trigger stock_check_disabled_fill before insert or update on public.stock_check_disabled
  for each row execute function public.stock_check_disabled_fill();

-- ---------- B.14 Row Level Security ----------

alter table public.app_feature_flags           enable row level security;
alter table public.paid_collab_handler_brands  enable row level security;
alter table public.handler_collab_brand_months enable row level security;
alter table public.handler_collab_creators     enable row level security;
alter table public.handler_collab_brand_order  enable row level security;
alter table public.handler_collab_activity_log enable row level security;
alter table public.paid_collab_comments        enable row level security;
alter table public.handler_contract_settings   enable row level security;
alter table public.handler_contract_signatures enable row level security;
alter table public.creator_categories          enable row level security;
alter table public.creator_directory           enable row level security;
alter table public.creator_db_share_links      enable row level security;
alter table public.handler_message_templates   enable row level security;
alter table public.handler_notes               enable row level security;
alter table public.handler_note_shares         enable row level security;
alter table public.note_labels                 enable row level security;
alter table public.best_videos_manual          enable row level security;
alter table public.brand_stock_checks          enable row level security;
alter table public.stock_check_disabled        enable row level security;

drop policy if exists "aff read" on public.app_feature_flags;
create policy "aff read" on public.app_feature_flags for select to authenticated using (true);
drop policy if exists "aff bob write" on public.app_feature_flags;
create policy "aff bob write" on public.app_feature_flags for all to authenticated
  using (public.is_bob()) with check (public.is_bob());

drop policy if exists "pchb bob all" on public.paid_collab_handler_brands;
create policy "pchb bob all" on public.paid_collab_handler_brands for all
  using (public.is_bob()) with check (public.is_bob());
drop policy if exists "pchb self read" on public.paid_collab_handler_brands;
create policy "pchb self read" on public.paid_collab_handler_brands for select
  using (handler_id = auth.uid() and public.paid_collab_enabled());

drop policy if exists "hcbm read" on public.handler_collab_brand_months;
create policy "hcbm read" on public.handler_collab_brand_months for select to authenticated
  using (public.reads_paid_collab_brand(brand_id));
drop policy if exists "hcbm write" on public.handler_collab_brand_months;
create policy "hcbm write" on public.handler_collab_brand_months for all to authenticated
  using (public.writes_paid_collab_brand(brand_id)) with check (public.writes_paid_collab_brand(brand_id));

drop policy if exists "hcc read" on public.handler_collab_creators;
create policy "hcc read" on public.handler_collab_creators for select to authenticated
  using (public.reads_paid_collab_brand(brand_id));
drop policy if exists "hcc write" on public.handler_collab_creators;
create policy "hcc write" on public.handler_collab_creators for all to authenticated
  using (public.writes_paid_collab_brand(brand_id)) with check (public.writes_paid_collab_brand(brand_id));

drop policy if exists "hcbo own" on public.handler_collab_brand_order;
create policy "hcbo own" on public.handler_collab_brand_order for all to authenticated
  using (handler_id = auth.uid()) with check (handler_id = auth.uid());

-- Read-only to everyone; rows come only from SECURITY DEFINER triggers / RPCs.
drop policy if exists "hcal read" on public.handler_collab_activity_log;
create policy "hcal read" on public.handler_collab_activity_log for select to authenticated
  using (public.reads_paid_collab_brand(brand_id));

drop policy if exists "pcc read" on public.paid_collab_comments;
create policy "pcc read" on public.paid_collab_comments for select to authenticated
  using (public.reads_paid_collab_brand(brand_id));
drop policy if exists "pcc insert" on public.paid_collab_comments;
create policy "pcc insert" on public.paid_collab_comments for insert to authenticated
  with check (public.writes_paid_collab_brand(brand_id));
drop policy if exists "pcc delete own" on public.paid_collab_comments;
create policy "pcc delete own" on public.paid_collab_comments for delete to authenticated
  using (author_id = auth.uid() or public.is_bob());

drop policy if exists "hcset owner all" on public.handler_contract_settings;
create policy "hcset owner all" on public.handler_contract_settings for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "hcset bob read" on public.handler_contract_settings;
create policy "hcset bob read" on public.handler_contract_settings for select to authenticated
  using (public.is_bob());

drop policy if exists "hcsig read" on public.handler_contract_signatures;
create policy "hcsig read" on public.handler_contract_signatures for select to authenticated
  using (public.reads_paid_collab_brand(brand_id));
drop policy if exists "hcsig write" on public.handler_contract_signatures;
create policy "hcsig write" on public.handler_contract_signatures for all to authenticated
  using (public.writes_paid_collab_brand(brand_id)) with check (public.writes_paid_collab_brand(brand_id));

drop policy if exists "cc read" on public.creator_categories;
create policy "cc read" on public.creator_categories for select to authenticated
  using (public.can_use_handler_library());
drop policy if exists "cc insert" on public.creator_categories;
create policy "cc insert" on public.creator_categories for insert to authenticated
  with check (public.can_use_handler_library());

drop policy if exists "cd read" on public.creator_directory;
create policy "cd read" on public.creator_directory for select to authenticated
  using (public.can_use_handler_library());
drop policy if exists "cd insert" on public.creator_directory;
create policy "cd insert" on public.creator_directory for insert to authenticated
  with check (public.can_use_handler_library());
drop policy if exists "cd update" on public.creator_directory;
create policy "cd update" on public.creator_directory for update to authenticated
  using (public.can_use_handler_library()) with check (public.can_use_handler_library());
drop policy if exists "cd delete" on public.creator_directory;
create policy "cd delete" on public.creator_directory for delete to authenticated
  using (public.is_bob() or (public.can_use_handler_library() and created_by = auth.uid()));

drop policy if exists "cdbshare read" on public.creator_db_share_links;
create policy "cdbshare read" on public.creator_db_share_links for select to authenticated
  using (public.can_use_handler_library());
drop policy if exists "cdbshare bob write" on public.creator_db_share_links;
create policy "cdbshare bob write" on public.creator_db_share_links for all to authenticated
  using (public.is_bob()) with check (public.is_bob());

drop policy if exists "hmt read" on public.handler_message_templates;
create policy "hmt read" on public.handler_message_templates for select to authenticated
  using (public.can_use_handler_library());
drop policy if exists "hmt insert" on public.handler_message_templates;
create policy "hmt insert" on public.handler_message_templates for insert to authenticated
  with check (public.can_use_handler_library());
drop policy if exists "hmt update" on public.handler_message_templates;
create policy "hmt update" on public.handler_message_templates for update to authenticated
  using (public.can_use_handler_library()) with check (public.can_use_handler_library());
drop policy if exists "hmt delete" on public.handler_message_templates;
create policy "hmt delete" on public.handler_message_templates for delete to authenticated
  using (public.is_bob() or (public.can_use_handler_library() and created_by = auth.uid()));

-- Notes are owner-only unless shared (read through list_visible_notes()).
drop policy if exists "hn owner all" on public.handler_notes;
create policy "hn owner all" on public.handler_notes for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "hn shared read" on public.handler_notes;
create policy "hn shared read" on public.handler_notes for select to authenticated
  using (public.note_shared_with_caller(id));

-- Handlers may only share with handlers (their circle); Bobs with Bobs /
-- the Super Boss.
drop policy if exists "hns owner all" on public.handler_note_shares;
create policy "hns owner all" on public.handler_note_shares for all to authenticated
  using (exists (select 1 from public.handler_notes n where n.id = note_id and n.owner_id = auth.uid()))
  with check (
    exists (select 1 from public.handler_notes n where n.id = note_id and n.owner_id = auth.uid())
    and case when target_role = 'paid_collab_handler' then public.note_handler_circle(auth.uid()) is not null
             else public.is_bob() end);

drop policy if exists "nl owner all" on public.note_labels;
create policy "nl owner all" on public.note_labels for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "bvm read" on public.best_videos_manual;
create policy "bvm read" on public.best_videos_manual for select to authenticated
  using (case when brand_id is null then public.can_use_handler_library()
              else public.reads_paid_collab_brand(brand_id) end);
drop policy if exists "bvm insert" on public.best_videos_manual;
create policy "bvm insert" on public.best_videos_manual for insert to authenticated
  with check (case when brand_id is null then public.can_use_handler_library()
                   else public.writes_paid_collab_brand(brand_id) end);
drop policy if exists "bvm update" on public.best_videos_manual;
create policy "bvm update" on public.best_videos_manual for update to authenticated
  using (created_by = auth.uid() or public.is_bob())
  with check (case when brand_id is null then public.can_use_handler_library()
                   else public.writes_paid_collab_brand(brand_id) end);
drop policy if exists "bvm delete" on public.best_videos_manual;
create policy "bvm delete" on public.best_videos_manual for delete to authenticated
  using (created_by = auth.uid() or public.is_bob());

drop policy if exists "bsc read" on public.brand_stock_checks;
create policy "bsc read" on public.brand_stock_checks for select to authenticated
  using (public.reads_paid_collab_brand(brand_id));
drop policy if exists "bsc write" on public.brand_stock_checks;
create policy "bsc write" on public.brand_stock_checks for all to authenticated
  using (public.writes_paid_collab_brand(brand_id)) with check (public.writes_paid_collab_brand(brand_id));

drop policy if exists "scd read" on public.stock_check_disabled;
create policy "scd read" on public.stock_check_disabled for select to authenticated
  using (public.reads_paid_collab_brand(brand_id));
drop policy if exists "scd write" on public.stock_check_disabled;
create policy "scd write" on public.stock_check_disabled for all to authenticated
  using (public.writes_paid_collab_brand(brand_id)) with check (public.writes_paid_collab_brand(brand_id));

-- ---------- B.15 Grants + Realtime ----------

grant all on
  public.app_feature_flags, public.paid_collab_handler_brands, public.handler_collab_brand_months,
  public.handler_collab_creators, public.handler_collab_brand_order, public.handler_collab_activity_log,
  public.paid_collab_comments, public.handler_contract_settings, public.handler_contract_signatures,
  public.creator_categories, public.creator_directory, public.creator_db_share_links,
  public.handler_message_templates, public.handler_notes, public.handler_note_shares,
  public.note_labels, public.best_videos_manual, public.brand_stock_checks, public.stock_check_disabled
  to authenticated, service_role;

-- Public pages: the shared Creators Database and the contract e-sign page.
grant execute on function public.creator_db_shared(text) to anon, authenticated;
grant execute on function public.contract_sign_get(text) to anon, authenticated;
grant execute on function public.contract_sign_submit(text, text, text, text) to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['handler_collab_creators', 'handler_collab_brand_months', 'paid_collab_comments'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then
  null;  -- no supabase_realtime publication (plain Postgres)
end $$;

notify pgrst, 'reload schema';
