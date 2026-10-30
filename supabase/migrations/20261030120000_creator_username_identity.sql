-- =========================================================
-- Paid Collab — the TikTok username is a creator's identity.
--
-- Two different people can share a name, so a name never identifies anyone.
-- Every deal (handler_collab_creators) and every Creators Database entry
-- (creator_directory) must carry at least one TikTok username, and:
--   * a deal may not reuse a username already on another deal of the SAME
--     brand + program month (the same creator on another brand/month is fine);
--   * a database entry may not reuse a username any other entry lists.
-- ANY of the handles a row lists counts, not just the first, so a creator
-- written with their accounts in another order is still the same person.
--
-- The app checks all of this first with friendlier wording; these triggers
-- are the guarantee for every other write path. Both raise 23505 for a
-- duplicate (store.ts maps that code) and 23502 for a missing username.
-- Trigger names sort AFTER the existing *_fill triggers on purpose: BEFORE
-- triggers fire alphabetically, and program_month / name must be filled first.
-- Updates that do not touch the identity columns are never re-checked, so
-- bookkeeping writes (category rewrites, status sweeps) cannot start failing.
--
-- Idempotent — also folded into supabase/schema_baseline.sql (§11e).
-- =========================================================

-- Every handle a cell lists, normalised exactly like creator_identity_key():
-- one per line or comma-separated, profile URLs reduced to the last segment,
-- leading @ dropped, lower-cased. Distinct, in order.
create or replace function public.creator_handle_keys(p_handle text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(h order by ord), '{}'::text[])
    from (
      select distinct on (h) h, ord
        from (
          select lower(btrim(regexp_replace(
                   case when btrim(part) ~* '^https?://'
                        then regexp_replace(regexp_replace(btrim(part), '/+$', ''), '^.*/', '')
                        else btrim(part) end,
                   '^@+', ''))) as h,
                 ord
            from unnest(regexp_split_to_array(coalesce(p_handle, ''), E'[\\n,]+'))
                 with ordinality as t(part, ord)
        ) s
       where h <> ''
       order by h, ord
    ) d
$$;

-- SECURITY DEFINER: the duplicate check must see every deal on the program,
-- not just the rows the caller's RLS happens to expose.
create or replace function public.handler_collab_creators_unique_handle()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_keys  text[] := public.creator_handle_keys(new.tiktok_handle);
  v_name  text;
  v_key   text;
begin
  if tg_op = 'UPDATE'
     and new.tiktok_handle is not distinct from old.tiktok_handle
     and new.brand_id      is not distinct from old.brand_id
     and new.program_month is not distinct from old.program_month then
    return new;
  end if;
  if cardinality(v_keys) = 0 then
    raise exception 'TikTok username required' using errcode = '23502';
  end if;
  -- serialise concurrent writes to one program so two inserts cannot race past
  perform pg_advisory_xact_lock(hashtext('hcc_handle:' || new.brand_id::text || ':' || coalesce(new.program_month, '')));
  select c.name, k into v_name, v_key
    from public.handler_collab_creators c,
         unnest(public.creator_handle_keys(c.tiktok_handle)) as k
   where c.brand_id = new.brand_id
     and c.program_month is not distinct from new.program_month
     and c.id <> new.id
     and k = any(v_keys)
   limit 1;
  if found then
    raise exception '@% is already present in this brand''s % program (as %).',
      v_key,
      coalesce(to_char(to_date(new.program_month || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY'), new.program_month),
      v_name
      using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists handler_collab_creators_unique_handle on public.handler_collab_creators;
create trigger handler_collab_creators_unique_handle before insert or update on public.handler_collab_creators
  for each row execute function public.handler_collab_creators_unique_handle();

-- creator_directory_bank() / _archive_deal() insert here inside an
-- `exception when others` block, so a creator who is already banked is still
-- silently skipped there, exactly as their `on conflict do nothing` did.
create or replace function public.creator_directory_unique_handle()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_keys  text[] := public.creator_handle_keys(new.tiktok_handle);
  v_name  text;
  v_key   text;
begin
  if tg_op = 'UPDATE' and new.tiktok_handle is not distinct from old.tiktok_handle then
    return new;
  end if;
  if cardinality(v_keys) = 0 then
    raise exception 'TikTok username required' using errcode = '23502';
  end if;
  perform pg_advisory_xact_lock(hashtext('creator_directory_handle'));
  select d.name, k into v_name, v_key
    from public.creator_directory d,
         unnest(public.creator_handle_keys(d.tiktok_handle)) as k
   where d.id <> new.id
     and k = any(v_keys)
   limit 1;
  if found then
    raise exception '@% is already in the Creators Database (as %).', v_key, v_name
      using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists creator_directory_unique_handle on public.creator_directory;
create trigger creator_directory_unique_handle before insert or update on public.creator_directory
  for each row execute function public.creator_directory_unique_handle();
