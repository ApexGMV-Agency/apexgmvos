-- =========================================================
-- Paid Collab — a deal's PROGRAM MONTH is its own column.
--
-- Before: the program (brand-month) a deal belonged to was the month of
-- onboarded_on, so editing the onboarding date (1 Oct → 1 Nov) moved the
-- creator into another program. Now handler_collab_creators.program_month
-- ('YYYY-MM') decides the program and onboarded_on is informational only.
--
--   * add + backfill program_month from coalesce(onboarded_on, created_at)
--     — no existing deal changes program
--   * fill trigger defaults it when a caller sends none (never re-derives it
--     on update)
--   * activity log, set_handler_creator_video_invalid and creator_db_shared
--     read program_month
--
-- Idempotent. Mirrored in schema_baseline.sql (§11b / §11c).
-- =========================================================

alter table public.handler_collab_creators add column if not exists program_month text;
update public.handler_collab_creators
   set program_month = to_char(coalesce(onboarded_on, created_at::date), 'YYYY-MM')
 where program_month is null;
alter table public.handler_collab_creators alter column program_month set not null;
do $$ begin
  alter table public.handler_collab_creators
    add constraint hcc_program_month_chk check (program_month ~ '^\d{4}-\d{2}$');
exception when duplicate_object then null; end $$;
create index if not exists hcc_program_month_idx on public.handler_collab_creators(brand_id, program_month);

-- created_by is the caller, never the payload. program_month defaults to the
-- onboarding month only when the caller sends none — it never follows a later
-- change of onboarded_on.
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
  if coalesce(new.program_month, '') = '' then
    new.program_month := case when tg_op = 'UPDATE' and coalesce(old.program_month, '') <> ''
                              then old.program_month
                              else to_char(coalesce(new.onboarded_on, new.created_at::date, current_date), 'YYYY-MM') end;
  end if;
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
    v_month := old.program_month;
  else
    v_brand := new.brand_id; v_creator := new.id; v_name := new.name;
    v_month := new.program_month;
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
  select brand_id, video_codes, name, program_month
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
           'monthly', c.monthly, 'onboarded_on', c.onboarded_on, 'program_month', c.program_month, 'created_at', c.created_at,
           'phone',  case when r.include_contact then c.phone  else '' end,
           'email',  case when r.include_contact then c.email  else '' end,
           'paypal', case when r.include_contact then c.paypal else '' end,
           'zelle',  case when r.include_contact then c.zelle  else '' end
         ) order by c.program_month desc, c.onboarded_on desc nulls last, c.created_at desc), '[]'::jsonb)
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
