-- Local synthetic fixture only. Check effective caller identity, not function text.
begin;
set local role anon;
do $check$ begin
  if private.app_can_view_space('90000000-0000-4000-8000-000000000020')
    or private.app_can_edit_space('90000000-0000-4000-8000-000000000020')
    or private.app_can_manage_space('90000000-0000-4000-8000-000000000020')
    or private.app_can_view_event('90000000-0000-4000-8000-000000000040')
    or private.app_can_edit_suborganization('90000000-0000-4000-8000-000000000099') then
    raise exception 'anon gained a SECURITY DEFINER permission';
  end if;
end $check$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000003',true);
do $check$ begin
  if private.app_can_view_space('90000000-0000-4000-8000-000000000020')
    or private.app_can_edit_space('90000000-0000-4000-8000-000000000020')
    or private.app_can_manage_space('90000000-0000-4000-8000-000000000020')
    or private.app_can_view_event('90000000-0000-4000-8000-000000000040') then
    raise exception 'foreign caller gained a SECURITY DEFINER permission';
  end if;
end $check$;

select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
do $check$ begin
  if not private.app_can_view_space('90000000-0000-4000-8000-000000000020')
    or not private.app_can_edit_space('90000000-0000-4000-8000-000000000020')
    or not private.app_can_manage_space('90000000-0000-4000-8000-000000000020')
    or not private.app_can_view_event('90000000-0000-4000-8000-000000000040') then
    raise exception 'authorized caller lost a SECURITY DEFINER permission';
  end if;
end $check$;
reset role;
rollback;
