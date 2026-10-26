-- =========================================================
-- Paid Collab — align the database with the ported reference workspace UI
-- (src/pages/handler-collab, taken from the AfflixCore handler workspace).
--
--   * Internal / external handlers are GONE: one kind of Paid Collab Handler.
--     profiles.is_internal_handler, is_internal_handler() and the notes
--     "circle" are dropped; the protect trigger and change_user_role revert.
--   * Stock Check is GONE: brand_stock_checks, stock_check_disabled and the
--     stock_* functions are dropped.
--   * Contracts work the reference way: the browser writes the signing link
--     (token, revise = void the signature), the creator signs through the
--     public edge functions get-creator-contract / sign-creator-contract.
--     NEW: handler_contract_settings.template — the user's editable DEFAULT
--     contract wording ({sectionEdits, extraSections}).
--   * Notes match the reference board: role-tinted shared notes, share targets
--     with kinds (all / role / team), list_visible_notes() with owner metadata.
--   * Columns the UI reads: brands.logo_url, creator_directory.tags,
--     creator_reacher_stats (empty here — no Reacher job), budget NOT NULL.
--   * Handlers read their brands' report WEEKS (never the reports) and brand
--     resources, for the Performance tab and the drilldown's Resources menu.
--   * Notification links use the deep-link format the workspace parses.
--
-- Idempotent. Mirrored in schema_baseline.sql (§11b + the in-place pieces).
-- =========================================================

-- ---------- 1. One kind of handler ----------

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

-- Both are recreated in section 5 without the circle.
drop policy if exists "hns owner all" on public.handler_note_shares;
drop policy if exists "hn shared read" on public.handler_notes;
drop function if exists public.note_shared_with_caller(uuid);
drop function if exists public.note_handler_circle(uuid);
drop function if exists public.is_internal_handler();
alter table public.profiles drop column if exists is_internal_handler;

-- ---------- 2. No Stock Check ----------

drop function if exists public.stock_check_board(date, uuid[]);
drop function if exists public.stock_brand_products(uuid, text);
drop table if exists public.brand_stock_checks;
drop table if exists public.stock_check_disabled;
drop function if exists public.brand_stock_checks_fill();
drop function if exists public.stock_check_disabled_fill();
drop function if exists public.stock_product_key(text, text);

-- ---------- 3. Columns the workspace reads ----------

alter table public.brands add column if not exists logo_url text;

update public.handler_collab_brand_months set budget = 0 where budget is null;
alter table public.handler_collab_brand_months alter column budget set default 0;
alter table public.handler_collab_brand_months alter column budget set not null;

alter table public.creator_directory add column if not exists tags text[] not null default '{}'::text[];

alter table public.paid_collab_comments drop constraint if exists pcc_author_type_check;
alter table public.paid_collab_comments add constraint pcc_author_type_check
  check (author_type in ('client', 'handler', 'bob', 'apc'));
alter table public.paid_collab_comments drop constraint if exists pcc_target_type_check;
alter table public.paid_collab_comments add constraint pcc_target_type_check
  check (target_type in ('brand', 'program', 'week', 'creator', 'insights', 'kpi'));

-- Reacher creator stats (level / TT GMV / avg views). There is no Reacher job
-- in ApexGMVOS, so this stays empty and those columns read "—".
create table if not exists public.creator_reacher_stats (
  handle     text primary key,
  found      boolean not null default false,
  tt_gmv     numeric,
  level      text,
  followers  bigint,
  avg_views  bigint,
  error      text,
  fetched_at timestamptz not null default now(),
  constraint creator_reacher_stats_handle_check check (handle = lower(handle) and handle !~ '^@' and length(handle) > 0),
  constraint creator_reacher_stats_level_check check (level is null or level ~ '^L[0-7]$')
);
alter table public.creator_reacher_stats enable row level security;
drop policy if exists "crs read" on public.creator_reacher_stats;
create policy "crs read" on public.creator_reacher_stats for select to authenticated
  using (public.can_use_handler_library());
grant all on public.creator_reacher_stats to authenticated, service_role;

-- ---------- 4. Contracts the reference way + an editable default ----------

alter table public.handler_contract_settings drop column if exists company_name;
alter table public.handler_contract_settings drop column if exists terms;
-- The user's DEFAULT contract wording: {"sectionEdits": {...}, "extraSections": [...]}.
-- Seeds every new contract they issue; may carry {placeholders}.
alter table public.handler_contract_settings
  add column if not exists template jsonb not null default '{}'::jsonb;

-- The browser mints the token and may revise a signed link (voiding the
-- signature); signing itself only happens through sign-creator-contract.
drop trigger if exists handler_contract_signatures_fill on public.handler_contract_signatures;
drop function if exists public.handler_contract_signatures_fill();
drop trigger if exists hcs_set_updated_at on public.handler_contract_signatures;
create trigger hcs_set_updated_at before update on public.handler_contract_signatures
  for each row execute function public.set_updated_at();
drop function if exists public.contract_sign_get(text);
drop function if exists public.contract_sign_submit(text, text, text, text);

-- ---------- 5. Notes: the reference board's sharing model ----------

alter table public.handler_notes add column if not exists shared_with_ads boolean not null default false;
alter table public.handler_notes add column if not exists stream text not null default 'private';
alter table public.handler_notes add column if not exists hidden_at timestamptz;
alter table public.handler_notes add column if not exists hidden_by_name text;
alter table public.handler_notes drop constraint if exists handler_notes_stream_check;
alter table public.handler_notes add constraint handler_notes_stream_check check (stream in ('private', 'update'));

alter table public.handler_note_shares add column if not exists target_kind text not null default 'role';
alter table public.handler_note_shares add column if not exists target_team uuid references public.profiles(id) on delete cascade;
alter table public.handler_note_shares alter column target_role drop not null;
alter table public.handler_note_shares drop constraint if exists handler_note_shares_note_id_target_role_key;
alter table public.handler_note_shares drop constraint if exists hns_target_role_check;
alter table public.handler_note_shares drop constraint if exists hns_target_kind_check;
alter table public.handler_note_shares add constraint hns_target_kind_check check (target_kind in ('all', 'role', 'team'));
alter table public.handler_note_shares add constraint hns_target_role_check check (
  target_role is null or target_role in ('super_boss', 'bob', 'team_lead', 'apc', 'ads_manager', 'paid_collab_handler'));
create unique index if not exists handler_note_shares_uniq on public.handler_note_shares
  (note_id, target_kind, coalesce(target_role, ''), coalesce(target_team, '00000000-0000-0000-0000-000000000000'::uuid));

-- Who a shared note reaches. The board lives only in the Paid Collab workspace,
-- so 'Everyone' means everyone who can open it (Bobs + handlers).
create or replace function public.note_shared_with_caller(p_note uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_role  text;
  v_super boolean;
  v_lead  uuid;
  v_handler boolean;
begin
  select role, coalesce(is_superbob, false), team_lead_id into v_role, v_super, v_lead
    from public.profiles where id = auth.uid();
  if v_role is null then return false; end if;
  v_handler := v_role = 'paid_collab_handler' and public.paid_collab_enabled();

  return exists (
    select 1 from public.handler_note_shares s
     where s.note_id = p_note
       and (
         (s.target_kind = 'all' and (v_role = 'bob' or v_handler))
         or (s.target_kind = 'role' and (
               (s.target_role = 'super_boss' and v_super)
            or (s.target_role = 'bob' and v_role = 'bob')
            or (s.target_role = 'team_lead' and v_role = 'team_lead')
            or (s.target_role = 'apc' and v_role = 'apc')
            or (s.target_role = 'ads_manager' and v_role = 'ads_manager')
            or (s.target_role = 'paid_collab_handler' and v_handler)))
         or (s.target_kind = 'team' and (
               (v_role = 'team_lead' and auth.uid() = s.target_team)
            or (v_role = 'apc' and v_lead = s.target_team)))
       )
  );
end $$;

drop policy if exists "hn shared read" on public.handler_notes;
create policy "hn shared read" on public.handler_notes for select to authenticated
  using (public.note_shared_with_caller(id));

-- Owners share their own notes. Role targets: the workspace audience; 'all'
-- and 'team' stay Super-Boss-only, as in the reference.
drop policy if exists "hns owner all" on public.handler_note_shares;
create policy "hns owner all" on public.handler_note_shares for all to authenticated
  using (exists (select 1 from public.handler_notes n where n.id = note_id and n.owner_id = auth.uid()))
  with check (
    exists (select 1 from public.handler_notes n where n.id = note_id and n.owner_id = auth.uid())
    and case
      when target_kind = 'role' then target_role in ('super_boss', 'bob', 'paid_collab_handler')
      else public.is_superbob()
    end);

create or replace function public.list_visible_notes()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(hn)
       || jsonb_build_object(
            'owner_role', p.role,
            'owner_is_superbob', coalesce(p.is_superbob, false),
            'owner_name', coalesce(nullif(btrim(p.full_name), ''), p.email, ''),
            'is_owner', hn.owner_id = auth.uid(),
            'shares', case when hn.owner_id = auth.uid() then (
                select coalesce(jsonb_agg(jsonb_build_object(
                         'kind', s.target_kind, 'role', s.target_role, 'team', s.target_team,
                         'team_name', coalesce(nullif(btrim(tlp.full_name), ''), tlp.email))
                       order by s.target_kind, s.target_role), '[]'::jsonb)
                  from public.handler_note_shares s
                  left join public.profiles tlp on tlp.id = s.target_team
                 where s.note_id = hn.id
              ) else '[]'::jsonb end)
    from public.handler_notes hn
    join public.profiles p on p.id = hn.owner_id
   where auth.uid() is not null
     and (hn.owner_id = auth.uid() or public.note_shared_with_caller(hn.id))
     and (hn.hidden_at is null or public.is_superbob())
   order by hn.pinned desc, hn.updated_at desc;
$$;

-- Reminder notifications open the note on the workspace (?note=<id>).
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
           left(nullif(btrim(regexp_replace(coalesce(body, ''), '<[^>]*>', ' ', 'g')), ''), 160),
           '/paid-collab/notes?note=' || id::text,
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

-- ---------- 6. RPCs the workspace calls ----------

-- GMV / ad-spend figures (Performance tab).
create or replace function public.set_handler_creator_monthly(p_creator uuid, p_monthly jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare b_id uuid;
begin
  select brand_id into b_id from public.handler_collab_creators where id = p_creator;
  if b_id is null then raise exception 'creator not found'; end if;
  if not public.writes_paid_collab_brand(b_id) then raise exception 'not allowed'; end if;
  if p_monthly is null or jsonb_typeof(p_monthly) <> 'object' then
    raise exception 'monthly must be a json object';
  end if;
  update public.handler_collab_creators set monthly = p_monthly where id = p_creator;
end $$;

-- "Tested" ad codes. In the reference this is the Ads Manager's; Ads Managers
-- have no paid-collab access here, so only Bob may set it.
create or replace function public.set_handler_creator_videos_tested(p_creator uuid, p_indexes integer[], p_tested boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b_id uuid;
  codes jsonb;
  row_j jsonb;
  i int;
  n int;
  v_flag boolean := coalesce(p_tested, false);
  v_name text := public.display_name_of(auth.uid());
  v_stamp text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  select brand_id, video_codes into b_id, codes
    from public.handler_collab_creators where id = p_creator for update;
  if b_id is null then raise exception 'creator not found'; end if;
  if not public.is_bob() then raise exception 'Only Bob can mark videos as tested'; end if;
  if codes is null or jsonb_typeof(codes) <> 'array' then raise exception 'no videos'; end if;
  n := jsonb_array_length(codes);
  foreach i in array coalesce(p_indexes, '{}'::int[]) loop
    if i is null or i < 0 or i >= n then raise exception 'bad video index'; end if;
    row_j := codes -> i;
    if v_flag then
      continue when btrim(coalesce(row_j ->> 'adCode', '')) = '';
      row_j := row_j || jsonb_build_object('tested', true, 'testedAt', v_stamp, 'testedBy', v_name);
    else
      row_j := ((row_j - 'tested') - 'testedAt') - 'testedBy';
    end if;
    codes := jsonb_set(codes, array[i::text], row_j, true);
  end loop;
  update public.handler_collab_creators set video_codes = codes where id = p_creator
    returning video_codes into codes;
  return codes;
end $$;

-- Weekly Performance columns are the brand's weekly-report WEEKS. A handler
-- gets the dates only — never the reports.
create or replace function public.paid_collab_report_weeks(p_brands uuid[])
returns table(brand_id uuid, week_start date, week_end date)
language sql stable security definer set search_path = public as $$
  select w.brand_id, w.week_start, w.week_end
    from public.weekly_reports w
   where w.brand_id = any(coalesce(p_brands, '{}'::uuid[]))
     and public.reads_paid_collab_brand(w.brand_id)
   order by w.week_start;
$$;

create or replace function public.paid_collab_report_anchors(p_brands uuid[])
returns table(brand_id uuid, weekly_anchor date)
language sql stable security definer set search_path = public as $$
  select s.brand_id, s.weekly_anchor
    from public.brand_report_settings s
   where s.brand_id = any(coalesce(p_brands, '{}'::uuid[]))
     and public.reads_paid_collab_brand(s.brand_id);
$$;

-- The shared Creators Database, with the reference page's full shape.
create or replace function public.creator_db_shared(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_directory jsonb;
  v_deals jsonb;
  v_reacher jsonb;
begin
  if p_code is null or btrim(p_code) = '' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into r from public.creator_db_share_links where share_token = btrim(p_code);
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not r.enabled then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'identity_key', d.identity_key, 'name', d.name, 'tiktok_handle', d.tiktok_handle,
           'categories', d.categories, 'category', d.category, 'region', d.region,
           'followers', d.followers, 'rate', d.rate, 'tags', d.tags, 'created_at', d.created_at,
           'phone',  case when r.include_contact then d.phone  else '' end,
           'email',  case when r.include_contact then d.email  else '' end,
           'paypal', case when r.include_contact then d.paypal else '' end,
           'zelle',  case when r.include_contact then d.zelle  else '' end,
           'notes',  case when r.include_contact then d.notes  else '' end
         ) order by d.name), '[]'::jsonb)
    into v_directory
    from public.creator_directory d;

  -- `videos_delivered` is a COUNT: video_codes carries our ad codes.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'brand_id', c.brand_id,
           'brand_name', coalesce(b.name, '—'), 'brand_currency', coalesce(b.currency, 'USD'),
           'name', c.name, 'tiktok_handle', c.tiktok_handle, 'category', c.category,
           'payment_status', c.payment_status, 'amount', c.amount, 'videos_count', c.videos_count,
           'videos_delivered', (
             select count(*) from jsonb_array_elements(
               case when jsonb_typeof(c.video_codes) = 'array' then c.video_codes else '[]'::jsonb end
             ) v where btrim(coalesce(v ->> 'video', '')) <> ''),
           'monthly', c.monthly, 'onboarded_on', c.onboarded_on, 'created_at', c.created_at,
           'phone',  case when r.include_contact then c.phone  else '' end,
           'email',  case when r.include_contact then c.email  else '' end,
           'paypal', case when r.include_contact then c.paypal else '' end,
           'zelle',  case when r.include_contact then c.zelle  else '' end
         ) order by c.onboarded_on desc nulls last, c.created_at desc), '[]'::jsonb)
    into v_deals
    from public.handler_collab_creators c
    left join public.brands b on b.id = c.brand_id;

  select coalesce(jsonb_object_agg(s.handle, jsonb_build_object(
           'found', true, 'tt_gmv', s.tt_gmv, 'level', s.level, 'followers', s.followers,
           'avg_views', s.avg_views, 'fetched_at', s.fetched_at)), '{}'::jsonb)
    into v_reacher
    from public.creator_reacher_stats s
   where s.found;

  return jsonb_build_object('ok', true, 'label', r.label, 'include_contact', r.include_contact,
                            'generated_at', now(), 'directory', v_directory, 'deals', v_deals,
                            'reacher', v_reacher);
end $$;

-- ---------- 7. Notification links the workspace can open ----------

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
    select hb.handler_id, 'paid_collab_invalid_code', 'Invalid Ad Code', v_body,
           '/paid-collab?brand=' || b_id::text || '&code=1'
             || case when v_month is not null then '&month=' || v_month else '' end,
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

-- A comment pings the brand's other handlers; the link opens that thread.
create or replace function public.paid_collab_comments_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_brand text;
  v_label text;
begin
  select name into v_brand from public.brands where id = new.brand_id;
  v_label := case new.target_type when 'brand' then 'Brand' when 'program' then 'Program'
             when 'week' then 'Week' when 'creator' then 'Creator'
             when 'insights' then 'Insights' else 'KPI' end;
  insert into public.notifications (user_id, type, title, body, link, payload)
  select hb.handler_id, 'paid_collab_comment',
         'New comment on ' || coalesce(v_brand, 'a brand') || ' (Paid Collab)',
         new.author_name || ' commented on ' || v_label || ': "'
           || left(new.body, 140) || case when length(new.body) > 140 then '…' else '' end || '"',
         '/paid-collab?brand=' || new.brand_id::text || '&tt=' || new.target_type
           || '&tk=' || new.target_key || '&pcc=' || new.id::text,
         jsonb_build_object('brand_id', new.brand_id, 'target_type', new.target_type,
                            'target_key', new.target_key, 'comment_id', new.id)
    from public.paid_collab_handler_brands hb
   where hb.brand_id = new.brand_id and hb.handler_id is distinct from new.author_id;
  return new;
exception when others then
  return new;  -- a notification never blocks the comment
end $$;

-- ---------- 8. Brand resources for handlers (drilldown Resources menu) ----------

drop policy if exists "resources handler read" on public.resources;
create policy "resources handler read" on public.resources
  for select using (scope = 'brand' and public.paid_collab_handler_has_brand(brand_id));

drop policy if exists "resource_folders handler read" on public.resource_folders;
create policy "resource_folders handler read" on public.resource_folders
  for select using (scope = 'brand' and public.paid_collab_handler_has_brand(brand_id));

notify pgrst, 'reload schema';
