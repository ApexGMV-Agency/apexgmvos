-- Only the Super Boss may make someone a Bob / Super Boss, or move a Bob to
-- another role. Re-defines the privilege trigger fn and change_user_role
-- (mirrored in schema_baseline.sql).

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

-- ---------- 8.8 Bob: change roles ----------
-- Data-safe: reports, comments and notifications keyed by the user's id are
-- untouched; only role / flags / brand bookkeeping change. APC↔Team Lead
-- delegate to promote/demote so brand carry-over is identical.
-- Any Bob may move people between apc / team_lead / ads_manager. Only a Super
-- Boss may make someone a Bob ('bob') or Super Boss ('superbob'), or move a
-- regular Bob to another role. A Super Boss's own role is never changed here.

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

  if p_new_role not in ('apc', 'team_lead', 'ads_manager', 'bob', 'superbob') then
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
            when 'apc'         then 'You are now an APC (account manager).'
            when 'team_lead'   then 'You are now a Team Lead.'
            when 'ads_manager' then 'You are now an Ads Manager.'
            when 'bob'         then 'You are now a Bob (admin).'
            when 'superbob'    then 'You are now a Super Boss.'
          end,
          '/');
end;
$$;
revoke all on function public.change_user_role(uuid, text) from public;
grant execute on function public.change_user_role(uuid, text) to authenticated;
