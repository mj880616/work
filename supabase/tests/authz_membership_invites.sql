-- Authorization regression: workspace membership and invite boundaries.
-- Requires a production-like database with one workspace containing owner + admin.
-- A synthetic target auth user is created inside the transaction. All test data rolls back.

begin;

select set_config(
  'app.authz_workspace',
  (
    select o.workspace_id::text
    from public.app_workspace_members o
    join public.app_workspace_members a on a.workspace_id=o.workspace_id and a.role='admin'
    where o.role='owner'
    order by o.created_at, a.created_at
    limit 1
  ),
  true
);
select set_config(
  'app.authz_owner',
  (select user_id::text from public.app_workspace_members where workspace_id=current_setting('app.authz_workspace')::uuid and role='owner' order by created_at limit 1),
  true
);
select set_config(
  'app.authz_admin',
  (select user_id::text from public.app_workspace_members where workspace_id=current_setting('app.authz_workspace')::uuid and role='admin' order by created_at limit 1),
  true
);

do $$
begin
  if nullif(current_setting('app.authz_workspace', true),'') is null
     or nullif(current_setting('app.authz_owner', true),'') is null
     or nullif(current_setting('app.authz_admin', true),'') is null then
    raise exception 'membership/invite regression requires owner + admin in one workspace';
  end if;
end $$;

insert into auth.users(id) values ('10000000-0000-4000-8000-000000000003');
insert into public.app_workspace_members(workspace_id,user_id,role)
values (current_setting('app.authz_workspace')::uuid,'10000000-0000-4000-8000-000000000003','viewer');

-- Legacy one-click join must not be executable by signed-in users.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.app_join_default_team();
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception 'legacy default-team join remained executable'; end if;
end $$;
reset role;

-- Viewer cannot self-escalate.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.app_set_workspace_member_role('10000000-0000-4000-8000-000000000003','admin');
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'viewer self escalation was allowed'; end if;
end $$;
reset role;

-- Admin cannot promote another member to admin.
select set_config('request.jwt.claim.sub',current_setting('app.authz_admin'),true);
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.app_set_workspace_member_role('10000000-0000-4000-8000-000000000003','admin');
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'admin-to-admin promotion was allowed'; end if;
end $$;
reset role;

-- Owner cannot change own role, but can legitimately change another member.
select set_config('request.jwt.claim.sub',current_setting('app.authz_owner'),true);
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.app_set_workspace_member_role(current_setting('app.authz_owner')::uuid,'viewer');
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'owner self-demotion was allowed'; end if;

  perform public.app_set_workspace_member_role('10000000-0000-4000-8000-000000000003','editor');
  if not exists (
    select 1 from public.app_workspace_members
    where workspace_id=current_setting('app.authz_workspace')::uuid
      and user_id='10000000-0000-4000-8000-000000000003' and role='editor'
  ) then raise exception 'owner legitimate role change failed'; end if;
end $$;
reset role;

-- Cross-workspace group cannot be smuggled into a workspace invite.
insert into public.app_workspaces(id,slug,name)
values ('11000000-0000-4000-8000-000000000002','authz-invite-other','AUTHZ INVITE OTHER');
insert into public.app_groups(id,workspace_id,slug,name)
values ('12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','other-group','Other Group');

select set_config('request.jwt.claim.sub',current_setting('app.authz_owner'),true);
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.app_create_invite('author','12000000-0000-4000-8000-000000000001',now()+interval '1 day');
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'cross-workspace invite group was allowed'; end if;
end $$;

create temporary table authz_invite_token(token text) on commit drop;
insert into authz_invite_token select public.app_create_invite('author',null,now()+interval '1 day');
reset role;

-- Remove test target so the invite request exercises the approval gate.
delete from public.app_workspace_members
where workspace_id=current_setting('app.authz_workspace')::uuid
  and user_id='10000000-0000-4000-8000-000000000003';

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
set local role authenticated;
create temporary table authz_access_request(id uuid) on commit drop;
insert into authz_access_request select public.app_request_workspace_access((select token from authz_invite_token));
do $$
begin
  if exists (
    select 1 from public.app_workspace_members
    where workspace_id=current_setting('app.authz_workspace')::uuid
      and user_id='10000000-0000-4000-8000-000000000003'
  ) then raise exception 'invite request created membership before approval'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('app.authz_owner'),true);
set local role authenticated;
select public.app_approve_access_request((select id from authz_access_request),null);
do $$
begin
  if not exists (
    select 1 from public.app_workspace_members
    where workspace_id=current_setting('app.authz_workspace')::uuid
      and user_id='10000000-0000-4000-8000-000000000003' and role='author'
  ) then raise exception 'approved invite did not create requested membership'; end if;
end $$;
reset role;

-- max_uses=1 token must fail after approval consumed it.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  begin
    perform public.app_request_workspace_access((select token from authz_invite_token));
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'consumed invite token was reusable'; end if;
end $$;
reset role;

rollback;
