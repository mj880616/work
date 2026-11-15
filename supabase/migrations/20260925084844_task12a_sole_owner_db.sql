begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.app_is_workspace_owner(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.app_workspace_members wm
    where wm.workspace_id = p_workspace
      and wm.user_id = (select auth.uid())
      and wm.role = 'owner'
  )
$$;

create or replace function private.app_is_owner_document(p_document uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select private.app_is_workspace_owner(d.workspace_id)
    from public.app_documents d where d.id = p_document
  ), false)
$$;

create or replace function private.app_is_owner_event(p_event uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select private.app_is_workspace_owner(e.workspace_id)
    from public.app_events e where e.id = p_event
  ), false)
$$;

create or replace function private.app_is_owner_organization(p_organization uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select private.app_is_workspace_owner(o.workspace_id)
    from public.app_suborganizations o where o.id = p_organization
  ), false)
$$;

create or replace function private.app_is_owner_profile(p_user uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.app_workspace_members subject
    join public.app_workspace_members owner
      on owner.workspace_id = subject.workspace_id
     and owner.role = 'owner'
     and owner.user_id = (select auth.uid())
    where subject.user_id = p_user
  )
$$;

create or replace function private.app_is_owner_workplace(p_workplace uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select private.app_is_owner_profile(w.user_id)
    from public.app_profile_workplaces w where w.id = p_workplace
  ), false)
$$;

create or replace function private.app_is_owner_conversation(p_conversation uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select private.app_is_workspace_owner(c.workspace_id)
    from public.app_ai_conversations c where c.id = p_conversation
  ), false)
$$;

revoke all on function private.app_is_workspace_owner(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_document(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_event(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_organization(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_profile(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_workplace(uuid) from PUBLIC, anon, authenticated;
revoke all on function private.app_is_owner_conversation(uuid) from PUBLIC, anon, authenticated;
grant execute on function private.app_is_workspace_owner(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_document(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_event(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_organization(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_profile(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_workplace(uuid) to authenticated, service_role;
grant execute on function private.app_is_owner_conversation(uuid) to authenticated, service_role;

do $policy_reset$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'app_ai_conversations','app_ai_daily_usage','app_ai_messages','app_ai_workspace_settings',
        'app_direct_messages','app_document_ai_index','app_document_chunks','app_documents',
        'app_event_attendees','app_event_comments','app_event_photos','app_event_suborganizations','app_events',
        'app_meetings','app_org_affiliation_tags','app_pages','app_profile_report_projects',
        'app_profile_weekly_reports','app_profile_workplace_statuses','app_profile_workplaces','app_profiles',
        'app_invites','app_suborganization_affiliations','app_suborganization_assignees',
        'app_suborganization_status_items','app_suborganization_timeline','app_suborganization_updates',
        'app_suborganization_weekly_reports','app_suborganizations','app_tasks','app_workspace_members','app_workspaces'
      ]::text[])
  loop
    execute format('drop policy %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end
$policy_reset$;

create policy task12a_owner_all on public.app_ai_conversations for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_ai_daily_usage for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_ai_messages for all to authenticated
using (private.app_is_owner_conversation(conversation_id)) with check (private.app_is_owner_conversation(conversation_id));
create policy task12a_owner_all on public.app_ai_workspace_settings for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_direct_messages for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_document_ai_index for all to authenticated
using (private.app_is_owner_document(document_id)) with check (private.app_is_owner_document(document_id));
create policy task12a_owner_all on public.app_document_chunks for all to authenticated
using (private.app_is_owner_document(document_id)) with check (private.app_is_owner_document(document_id));
create policy task12a_owner_all on public.app_documents for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_event_attendees for all to authenticated
using (private.app_is_owner_event(event_id)) with check (private.app_is_owner_event(event_id));
create policy task12a_owner_all on public.app_event_comments for all to authenticated
using (private.app_is_owner_event(event_id)) with check (private.app_is_owner_event(event_id));
create policy task12a_owner_all on public.app_event_photos for all to authenticated
using (private.app_is_owner_event(event_id)) with check (private.app_is_owner_event(event_id));
create policy task12a_owner_all on public.app_event_suborganizations for all to authenticated
using (private.app_is_owner_event(event_id)) with check (private.app_is_owner_event(event_id));
create policy task12a_owner_all on public.app_events for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_meetings for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_org_affiliation_tags for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_pages for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_profile_report_projects for all to authenticated
using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
create policy task12a_owner_all on public.app_profile_weekly_reports for all to authenticated
using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
create policy task12a_owner_all on public.app_profile_workplace_statuses for all to authenticated
using (private.app_is_owner_workplace(workplace_id)) with check (private.app_is_owner_workplace(workplace_id));
create policy task12a_owner_all on public.app_profile_workplaces for all to authenticated
using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
create policy task12a_owner_all on public.app_profiles for all to authenticated
using (private.app_is_owner_profile(user_id)) with check (private.app_is_owner_profile(user_id));
create policy task12a_profile_self_select on public.app_profiles for select to authenticated
using (user_id = (select auth.uid()));
create policy task12a_owner_all on public.app_invites for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_suborganization_affiliations for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganization_assignees for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganization_status_items for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganization_timeline for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganization_updates for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganization_weekly_reports for all to authenticated
using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
create policy task12a_owner_all on public.app_suborganizations for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_owner_all on public.app_tasks for all to authenticated
using (private.app_is_workspace_owner(workspace_id))
with check (
  private.app_is_workspace_owner(workspace_id)
  and private.app_space_in_workspace(project_id, workspace_id)
  and private.app_workstream_in_context(workstream_id, project_id, workspace_id)
  and private.app_user_in_workspace(assignee_id, workspace_id)
  and (
    coalesce(source_type, 'manual') = 'manual'
    or (source_type = 'meeting' and source_id is not null and private.app_meeting_in_workspace(source_id, workspace_id))
    or (source_type = 'project' and project_id is not null and private.app_can_edit_space(project_id))
  )
);
create policy task12a_owner_all on public.app_workspace_members for all to authenticated
using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
create policy task12a_member_self_select on public.app_workspace_members for select to authenticated
using (user_id = (select auth.uid()));
create policy task12a_owner_all on public.app_workspaces for all to authenticated
using (private.app_is_workspace_owner(id)) with check (private.app_is_workspace_owner(id));

create or replace function private.app_is_workspace_admin(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.app_is_workspace_owner(p_workspace)
$$;

revoke all on function private.app_is_workspace_admin(uuid) from PUBLIC, anon, authenticated;
grant execute on function private.app_is_workspace_admin(uuid) to authenticated;

create or replace function public.app_can_edit_page_rpc(p_page uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select coalesce((
    select private.app_is_workspace_owner(p.workspace_id)
    from public.app_pages p
    where p.id = p_page
  ), false)
$$;

create or replace function public.app_create_invite(
  p_role text default 'viewer'::text,
  p_group uuid default null::uuid,
  p_expires_at timestamptz default (now() + interval '7 days')
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_workspace uuid;
  v_token text;
begin
  select m.workspace_id into v_workspace
  from public.app_workspace_members m
  where m.user_id = auth.uid() and m.role = 'owner'
  order by m.created_at limit 1;
  if v_workspace is null then
    raise exception 'owner permission required' using errcode='42501';
  end if;
  if p_role not in ('editor','author','viewer') then raise exception 'invalid role'; end if;
  if p_group is not null and not exists (
    select 1 from public.app_groups g where g.id=p_group and g.workspace_id=v_workspace
  ) then raise exception 'invalid group'; end if;
  v_token := encode(extensions.gen_random_bytes(24),'hex');
  insert into public.app_invites(workspace_id,group_id,token_hash,role,expires_at,created_by)
  values(v_workspace,p_group,encode(extensions.digest(v_token::bytea,'sha256'),'hex'),p_role,p_expires_at,auth.uid());
  return v_token;
end
$$;

create or replace function public.app_delete_pages(p_page_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  requested_count integer;
  existing_count integer;
  deleted_count integer;
begin
  if p_page_ids is null or cardinality(p_page_ids)=0 then return 0; end if;
  select count(distinct x) into requested_count from unnest(p_page_ids) x;
  select count(*) into existing_count from public.app_pages p where p.id=any(p_page_ids);
  if existing_count <> requested_count then raise exception '삭제할 페이지를 찾을 수 없습니다.'; end if;
  if exists (
    select 1 from public.app_pages p
    where p.id=any(p_page_ids)
      and not private.app_is_workspace_owner(p.workspace_id)
  ) then
    raise exception '삭제 권한이 없는 페이지가 포함되어 있습니다.' using errcode='42501';
  end if;
  delete from public.app_pages p where p.id=any(p_page_ids);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;

create or replace function public.app_open_share(p_token text)
returns table(id uuid, slug text, title text, summary text, body text, content_format text, updated_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, private
as $$
  select p.id,p.slug,p.title,p.summary,p.body,p.content_format,p.updated_at
  from public.app_share_links s join public.app_pages p on p.id=s.page_id
  where s.token_hash=encode(extensions.digest(p_token::bytea,'sha256'),'hex')
    and s.revoked_at is null and (s.expires_at is null or s.expires_at>now())
    and private.app_is_workspace_owner(p.workspace_id)
  limit 1
$$;

create or replace function public.app_save_page_v2(
  p_id uuid, p_workspace uuid, p_space uuid, p_title text, p_slug text,
  p_summary text, p_body text, p_status text, p_visibility text
)
returns app_pages
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_page public.app_pages;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  if not private.app_is_workspace_owner(p_workspace) then
    raise exception '페이지 작성 권한이 없습니다.' using errcode='42501';
  end if;
  if p_title is null or btrim(p_title)='' then raise exception '제목을 입력해 주세요.'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]*$' then raise exception '공유 URL 이름은 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.'; end if;
  if p_status not in ('draft','review','published','archived') then raise exception '게시 상태가 올바르지 않습니다.'; end if;
  if p_visibility not in ('public','unlisted','workspace','groups','private') then raise exception '공개 범위가 올바르지 않습니다.'; end if;
  if p_space is not null then
    if not exists(select 1 from public.app_spaces s where s.id=p_space and s.workspace_id=p_workspace) then raise exception '프로젝트가 올바르지 않습니다.'; end if;
    if not private.app_can_edit_space(p_space) then raise exception '해당 프로젝트에 페이지를 작성할 권한이 없습니다.'; end if;
  end if;
  if p_id is null then
    insert into public.app_pages(workspace_id,space_id,slug,title,summary,body,content_format,visibility,status,owner_id,published_at)
    values(p_workspace,p_space,p_slug,btrim(p_title),nullif(btrim(coalesce(p_summary,'')),''),coalesce(p_body,''),'markdown',p_visibility,p_status,v_uid,case when p_status='published' then now() else null end)
    returning * into v_page;
  else
    if not exists (
      select 1 from public.app_pages p
      where p.id=p_id and p.workspace_id=p_workspace
        and private.app_is_workspace_owner(p.workspace_id)
    ) then raise exception '페이지 수정 권한이 없습니다.' using errcode='42501'; end if;
    update public.app_pages
       set space_id=p_space, slug=p_slug, title=btrim(p_title), summary=nullif(btrim(coalesce(p_summary,'')),''), body=coalesce(p_body,''), content_format='markdown', visibility=p_visibility, status=p_status,
           published_at=case when p_status='published' then coalesce(published_at,now()) else published_at end
     where id=p_id and workspace_id=p_workspace
     returning * into v_page;
    if v_page.id is null then raise exception '페이지를 찾을 수 없습니다.'; end if;
  end if;
  return v_page;
exception when unique_violation then
  raise exception '같은 공유 URL 이름이 이미 사용 중입니다. 다른 이름을 입력해 주세요.';
end
$$;

create or replace function public.app_set_workspace_member_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_target_role text;
begin
  select workspace_id into v_workspace
  from public.app_workspace_members
  where user_id=v_actor and role='owner'
  order by created_at asc limit 1;
  if v_workspace is null then
    raise exception '구성원 관리 권한이 없습니다.' using errcode='42501';
  end if;
  select role into v_target_role
  from public.app_workspace_members
  where workspace_id=v_workspace and user_id=p_user;
  if v_target_role is null then raise exception '해당 구성원을 찾을 수 없습니다.'; end if;
  if p_user=v_actor then raise exception '본인 권한은 변경할 수 없습니다.'; end if;
  if v_target_role='owner' then raise exception '소유자 권한은 변경할 수 없습니다.'; end if;
  if p_role not in ('admin','editor','author','viewer') then raise exception '변경할 수 없는 권한입니다.'; end if;
  update public.app_workspace_members set role=p_role
  where workspace_id=v_workspace and user_id=p_user;
  return jsonb_build_object('ok',true,'role',p_role);
end
$$;

create or replace function public.app_update_event_body(p_event uuid, p_body text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_workspace uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select e.workspace_id into v_workspace from public.app_events e where e.id=p_event;
  if v_workspace is null or not private.app_is_workspace_owner(v_workspace) then
    raise exception 'not allowed' using errcode='42501';
  end if;
  update public.app_events set body=coalesce(p_body,''), updated_at=now() where id=p_event;
  return true;
end
$$;

revoke execute on function public.app_accept_invite(text) from authenticated;
revoke execute on function public.app_claim_owner(text,text) from authenticated;
revoke execute on function public.app_request_workspace_access(text) from authenticated;
revoke execute on function public.app_respond_project_invitation(uuid,boolean) from authenticated;
revoke execute on function public.app_public_workspace_snapshot() from authenticated;

-- Reassert the already-deployed project-publication boundary explicitly.
-- A schema-only restore can otherwise inherit PostgreSQL's default PUBLIC
-- function EXECUTE before the production object ACL is reconstructed.
revoke execute on function public.app_public_project(text) from PUBLIC, anon, authenticated;
revoke execute on function public.app_public_projects_snapshot() from PUBLIC, anon, authenticated;
revoke execute on function public.app_project_publication_state(uuid) from PUBLIC, anon, authenticated;

commit;
