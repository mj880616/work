-- Authorization regression: project invitation workspace and recipient boundaries.
-- Uses one existing workspace owner plus synthetic users/workspaces. All test data rolls back.

begin;

select set_config(
  'app.authz_owner',
  (select user_id::text from public.app_workspace_members where role='owner' order by created_at, user_id limit 1),
  true
);

do $$
begin
  if nullif(current_setting('app.authz_owner', true),'') is null then
    raise exception 'project invitation regression requires an existing owner';
  end if;
end $$;

insert into auth.users(id) values
('20000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000002');

insert into public.app_workspaces(id,slug,name) values
('21000000-0000-4000-8000-000000000001','authz-project-invite-a','AUTHZ PROJECT INVITE A'),
('21000000-0000-4000-8000-000000000002','authz-project-invite-b','AUTHZ PROJECT INVITE B');

-- The inviter is a workspace member so membership checks inside invitation RLS can see recipients.
-- Project management authority still comes from owner_id on each project.
insert into public.app_workspace_members(workspace_id,user_id,role) values
('21000000-0000-4000-8000-000000000001',current_setting('app.authz_owner')::uuid,'viewer'),
('21000000-0000-4000-8000-000000000002',current_setting('app.authz_owner')::uuid,'viewer'),
('21000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','viewer'),
('21000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','viewer');

insert into public.app_spaces(id,workspace_id,slug,name,created_by,owner_id,visibility) values
('22000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','project-a','Project A',current_setting('app.authz_owner')::uuid,current_setting('app.authz_owner')::uuid,'private'),
('22000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','project-b','Project B',current_setting('app.authz_owner')::uuid,current_setting('app.authz_owner')::uuid,'private');

select set_config('request.jwt.claim.sub',current_setting('app.authz_owner'),true);
set local role authenticated;

-- workspace A + project B mismatch must fail.
do $$
declare rejected boolean := false;
begin
  begin
    insert into public.app_project_invitations(workspace_id,project_id,user_id,role,invited_by)
    values('21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','view',auth.uid());
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'cross-workspace project invitation was allowed'; end if;
end $$;

-- User who is not a member of invitation workspace must fail.
do $$
declare rejected boolean := false;
begin
  begin
    insert into public.app_project_invitations(workspace_id,project_id,user_id,role,invited_by)
    values('21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','view',auth.uid());
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'non-member project invitation was allowed'; end if;
end $$;

create temporary table authz_project_invite(id uuid) on commit drop;
with ins as (
  insert into public.app_project_invitations(workspace_id,project_id,user_id,role,invited_by)
  values('21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','edit',auth.uid())
  returning id
)
insert into authz_project_invite select id from ins;
reset role;

-- A different authenticated user cannot respond to this invitation.
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.app_respond_project_invitation((select id from authz_project_invite),true);
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'other user responded to project invitation'; end if;
end $$;
reset role;

-- Intended recipient can accept and receives exactly the invited project role.
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare response text;
begin
  response := public.app_respond_project_invitation((select id from authz_project_invite),true);
  if response <> 'accepted' then raise exception 'legitimate project invitation did not accept'; end if;
  if not exists (
    select 1 from public.app_space_members
    where project_id='22000000-0000-4000-8000-000000000001'
      and user_id='20000000-0000-4000-8000-000000000001' and role='edit'
  ) then raise exception 'accepted invitation did not create expected project membership'; end if;
end $$;
reset role;

rollback;
