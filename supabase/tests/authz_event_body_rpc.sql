-- Authorization regression: SECURITY DEFINER event-body RPC must match app_events UPDATE policy.
-- All fixtures are synthetic and rolled back.

begin;

insert into auth.users(id) values
('30000000-0000-4000-8000-000000000001'),
('30000000-0000-4000-8000-000000000002');

insert into public.app_workspaces(id,slug,name)
values('31000000-0000-4000-8000-000000000001','authz-event-body','AUTHZ EVENT BODY');

insert into public.app_workspace_members(workspace_id,user_id,role) values
('31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','author'),
('31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','viewer');

insert into public.app_events(id,workspace_id,title,start_at,created_by,calendar_scope,body)
values(
  '32000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  'AUTHZ EVENT',now(),'30000000-0000-4000-8000-000000000001','team','original'
);

-- A workspace viewer who did not create the event must not mutate it through the RPC.
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.app_update_event_body('32000000-0000-4000-8000-000000000001','tampered');
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'viewer changed another user event body through RPC'; end if;
end $$;
reset role;

-- The creator remains allowed to update the same event.
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.app_update_event_body('32000000-0000-4000-8000-000000000001','creator update');
reset role;

do $$
begin
  if (select body from public.app_events where id='32000000-0000-4000-8000-000000000001') <> 'creator update' then
    raise exception 'legitimate creator event-body update failed';
  end if;
end $$;

rollback;
