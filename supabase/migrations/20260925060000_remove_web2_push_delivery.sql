-- Remove Web2 notification and push infrastructure.
-- Preserve access-request and project-invitation RPC behavior while removing notification side effects.

drop trigger if exists trg_app_push_task_assignment on public.app_notifications;
drop trigger if exists trg_app_push_direct_message on public.app_direct_messages;
drop trigger if exists trg_app_notify_event_invite on public.app_event_attendees;
drop trigger if exists trg_app_notify_project_check_assignment on public.app_project_checkitems;
drop trigger if exists trg_app_notify_project_invitation on public.app_project_invitations;
drop trigger if exists trg_app_notify_task_assignment on public.app_tasks;

drop function if exists private.app_dispatch_push();
drop function if exists public.app_notify_event_invite();
drop function if exists public.app_notify_project_check_assignment();
drop function if exists public.app_notify_project_invitation();
drop function if exists public.app_notify_task_assignment();
drop function if exists public.app_notify_member(uuid,uuid,text,text,text,uuid);

create or replace function public.app_approve_access_request(p_request uuid, p_role text default null::text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_req public.app_access_requests%rowtype;
  v_role text;
begin
  select * into v_req from public.app_access_requests where id=p_request for update;
  if v_req.id is null then raise exception 'request not found'; end if;
  if not private.app_is_workspace_admin(v_req.workspace_id) then raise exception 'admin required'; end if;
  if v_req.status <> 'pending' then raise exception 'request already reviewed'; end if;
  if exists (
    select 1 from public.app_workspace_members wm
    where wm.workspace_id=v_req.workspace_id and wm.user_id=v_req.user_id
  ) then raise exception 'user is already a workspace member'; end if;
  v_role := coalesce(nullif(p_role,''),v_req.requested_role);
  if v_role not in ('viewer','author','editor') then raise exception 'invalid role'; end if;

  insert into public.app_workspace_members(workspace_id,user_id,role)
  values(v_req.workspace_id,v_req.user_id,v_role);

  if v_req.group_id is not null then
    insert into public.app_group_members(group_id,user_id)
    values(v_req.group_id,v_req.user_id) on conflict do nothing;
  end if;

  if v_req.invite_id is not null then
    update public.app_invites set uses=least(uses+1,max_uses)
    where id=v_req.invite_id;
  end if;

  update public.app_access_requests
  set status='approved',reviewed_at=now(),reviewed_by=auth.uid()
  where id=v_req.id;

  update public.app_profiles set updated_at=now() where user_id=v_req.user_id;
  return true;
end;
$function$;

create or replace function public.app_reject_access_request(p_request uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare v_req public.app_access_requests%rowtype;
begin
  select * into v_req from public.app_access_requests where id=p_request for update;
  if v_req.id is null then raise exception 'request not found'; end if;
  if not private.app_is_workspace_admin(v_req.workspace_id) then raise exception 'admin required'; end if;
  if v_req.status <> 'pending' then raise exception 'request already reviewed'; end if;
  update public.app_access_requests
  set status='rejected',reviewed_at=now(),reviewed_by=auth.uid()
  where id=v_req.id;
  return true;
end;
$function$;

create or replace function public.app_request_workspace_access(p_token text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'extensions'
as $function$
declare
  v_uid uuid := auth.uid();
  v_workspace uuid;
  v_inv public.app_invites%rowtype;
  v_role text := 'author';
  v_group uuid;
  v_invite_id uuid;
  v_request uuid;
  v_name text;
  v_email text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;

  if p_token is not null and btrim(p_token) <> '' then
    select * into v_inv
    from public.app_invites
    where token_hash = encode(extensions.digest(p_token::bytea,'sha256'),'hex')
      and revoked_at is null and expires_at > now() and uses < max_uses;
    if v_inv.id is null then raise exception 'invalid or expired invite'; end if;
    v_workspace := v_inv.workspace_id;
    v_role := case when v_inv.role in ('viewer','author','editor','admin') then v_inv.role else 'author' end;
    v_group := v_inv.group_id;
    v_invite_id := v_inv.id;
  else
    select id into v_workspace from public.app_workspaces where slug='kptu-work' limit 1;
  end if;

  if v_workspace is null then raise exception 'workspace not found'; end if;
  if exists(select 1 from public.app_workspace_members where workspace_id=v_workspace and user_id=v_uid) then
    select id into v_request from public.app_access_requests where workspace_id=v_workspace and user_id=v_uid;
    return v_request;
  end if;

  select nullif(btrim(coalesce(raw_user_meta_data->>'display_name','')),''), email
    into v_name,v_email from auth.users where id=v_uid;
  insert into public.app_profiles(user_id,display_name)
  values(v_uid,v_name)
  on conflict(user_id) do update
    set display_name=coalesce(public.app_profiles.display_name,excluded.display_name), updated_at=now();

  insert into public.app_access_requests(workspace_id,user_id,invite_id,requested_role,group_id,status,requested_at,reviewed_at,reviewed_by,display_name,email)
  values(v_workspace,v_uid,v_invite_id,v_role,v_group,'pending',now(),null,null,v_name,v_email)
  on conflict(workspace_id,user_id) do update
    set invite_id=coalesce(excluded.invite_id,public.app_access_requests.invite_id),
        requested_role=excluded.requested_role,
        group_id=coalesce(excluded.group_id,public.app_access_requests.group_id),
        status='pending', requested_at=now(), reviewed_at=null, reviewed_by=null,
        display_name=coalesce(excluded.display_name,public.app_access_requests.display_name),
        email=coalesce(excluded.email,public.app_access_requests.email)
  returning id into v_request;

  return v_request;
end;
$function$;

create or replace function public.app_respond_project_invitation(p_invitation uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v public.app_project_invitations%rowtype; v_status text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v from public.app_project_invitations where id=p_invitation for update;
  if not found or v.user_id<>auth.uid() then raise exception 'invitation not found'; end if;
  if v.status<>'pending' then return v.status; end if;
  if p_accept then
    insert into public.app_space_members(project_id,user_id,role,added_by)
    values(v.project_id,v.user_id,v.role,v.invited_by)
    on conflict(project_id,user_id) do update set role=excluded.role,added_by=excluded.added_by;
    v_status:='accepted';
  else
    v_status:='declined';
  end if;
  update public.app_project_invitations
  set status=v_status,responded_at=now(),updated_at=now()
  where id=v.id;
  return v_status;
end;
$function$;

drop table if exists public.app_notifications;
drop table if exists public.app_push_native_tokens;
drop table if exists public.app_push_subscriptions;
drop table if exists public.app_push_config;
