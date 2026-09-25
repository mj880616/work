-- Task 12A rollback-only actor matrix for the Web2 sole-owner boundary.
-- Run only on a disposable production-like database. Every fixture is rolled back.

begin;

create or replace function pg_temp.authz_probe_count(p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_count bigint;
begin
  begin
    execute p_sql into v_count;
    return coalesce(v_count, 0);
  exception
    when insufficient_privilege then return 0;
  end;
end
$$;

create or replace function pg_temp.authz_expect_no_write(p_label text, p_sql text)
returns void
language plpgsql
as $$
declare
  v_rows bigint;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
      raise exception '% unexpectedly affected % row(s)', p_label, v_rows;
    end if;
  exception
    when insufficient_privilege or check_violation then return;
  end;
end
$$;

create temp table authz_sole_owner_results(
  actor text not null,
  surface text not null,
  visible_rows bigint not null,
  primary key(actor, surface)
);
grant select, insert on authz_sole_owner_results to anon, authenticated;

insert into auth.users(id) values
  ('12000000-0000-4000-8000-000000000001'),
  ('12000000-0000-4000-8000-000000000002'),
  ('12000000-0000-4000-8000-000000000003');

select set_config('app.authz_owner', '12000000-0000-4000-8000-000000000001', true);
select set_config('app.authz_admin', '12000000-0000-4000-8000-000000000002', true);
select set_config('app.authz_non_member', '12000000-0000-4000-8000-000000000003', true);
select set_config('app.authz_workspace', '12a00000-0000-4000-8000-000000000001', true);

insert into public.app_workspaces(id, slug, name)
values (current_setting('app.authz_workspace')::uuid, 'kptu-work', 'TASK 12A MATRIX');

insert into public.app_workspace_members(workspace_id, user_id, role) values
  (current_setting('app.authz_workspace')::uuid, current_setting('app.authz_owner')::uuid, 'owner'),
  (current_setting('app.authz_workspace')::uuid, current_setting('app.authz_admin')::uuid, 'admin');

insert into public.app_profiles(user_id, display_name, job_title) values
  (current_setting('app.authz_owner')::uuid, 'TASK 12A OWNER', 'owner'),
  (current_setting('app.authz_admin')::uuid, 'TASK 12A ADMIN', 'admin')
on conflict (user_id) do update
set display_name=excluded.display_name, job_title=excluded.job_title;

insert into public.app_meetings(id, workspace_id, title, created_by) values
  ('12a10000-0000-4000-8000-000000000001', current_setting('app.authz_workspace')::uuid, 'OWNER PROJECTLESS MEETING', current_setting('app.authz_owner')::uuid);

insert into public.app_documents(id, workspace_id, title, visibility, uploaded_by, description) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', current_setting('app.authz_workspace')::uuid, 'OWNER PUBLIC DOCUMENT', 'public', current_setting('app.authz_owner')::uuid, 'public projection'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', current_setting('app.authz_workspace')::uuid, 'OWNER WORKSPACE DOCUMENT', 'workspace', current_setting('app.authz_owner')::uuid, 'private base row'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', current_setting('app.authz_workspace')::uuid, 'OWNER PRIVATE DOCUMENT', 'private', current_setting('app.authz_owner')::uuid, 'private base row');

insert into public.app_document_chunks(id, document_id, workspace_id, chunk_index, content) values
  ('12a20000-0000-4000-8000-000000000001', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', current_setting('app.authz_workspace')::uuid, 0, 'OWNER CHUNK');
insert into public.app_document_ai_index(document_id, workspace_id, content_hash, summary) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', current_setting('app.authz_workspace')::uuid, 'task12a', 'OWNER SUMMARY');

insert into public.app_events(id, workspace_id, title, start_at, created_by, calendar_scope) values
  ('12a30000-0000-4000-8000-000000000001', current_setting('app.authz_workspace')::uuid, 'OWNER TEAM EVENT', now(), current_setting('app.authz_owner')::uuid, 'team'),
  ('12a30000-0000-4000-8000-000000000002', current_setting('app.authz_workspace')::uuid, 'OWNER PERSONAL EVENT', now(), current_setting('app.authz_owner')::uuid, 'personal');
insert into public.app_event_comments(id, event_id, author_id, body) values
  ('12a31000-0000-4000-8000-000000000001', '12a30000-0000-4000-8000-000000000001', current_setting('app.authz_owner')::uuid, 'OWNER COMMENT');
insert into public.app_event_photos(id, event_id, uploaded_by, storage_path, thumb_path) values
  ('12a32000-0000-4000-8000-000000000001', '12a30000-0000-4000-8000-000000000001', current_setting('app.authz_owner')::uuid, 'task12a/photo', 'task12a/thumb');
insert into public.app_event_attendees(event_id, user_id, status) values
  ('12a30000-0000-4000-8000-000000000001', current_setting('app.authz_owner')::uuid, 'accepted')
on conflict do nothing;

insert into public.app_suborganizations(id, workspace_id, name, created_by) values
  ('12a40000-0000-4000-8000-000000000001', current_setting('app.authz_workspace')::uuid, 'OWNER ORGANIZATION', current_setting('app.authz_owner')::uuid);
insert into public.app_event_suborganizations(event_id, organization_id, created_by) values
  ('12a30000-0000-4000-8000-000000000001', '12a40000-0000-4000-8000-000000000001', current_setting('app.authz_owner')::uuid);
insert into public.app_org_affiliation_tags(id, workspace_id, name, kind, created_by) values
  ('12a41000-0000-4000-8000-000000000001', current_setting('app.authz_workspace')::uuid, 'OWNER TAG', 'council', current_setting('app.authz_owner')::uuid);
insert into public.app_suborganization_updates(id, organization_id, raw_text, created_by) values
  ('12a42000-0000-4000-8000-000000000001', '12a40000-0000-4000-8000-000000000001', 'OWNER UPDATE', current_setting('app.authz_owner')::uuid);
insert into public.app_suborganization_weekly_reports(id, organization_id, week_of, created_by) values
  ('12a43000-0000-4000-8000-000000000001', '12a40000-0000-4000-8000-000000000001', current_date, current_setting('app.authz_owner')::uuid);

insert into public.app_profile_workplaces(id, user_id, full_name, organization_id) values
  ('12a50000-0000-4000-8000-000000000001', current_setting('app.authz_owner')::uuid, 'OWNER WORKPLACE', '12a40000-0000-4000-8000-000000000001');
insert into public.app_profile_workplace_statuses(id, workplace_id, user_id, raw_status) values
  ('12a51000-0000-4000-8000-000000000001', '12a50000-0000-4000-8000-000000000001', current_setting('app.authz_owner')::uuid, 'OWNER STATUS');
insert into public.app_profile_weekly_reports(id, user_id, week_of, ai_summary) values
  ('12a52000-0000-4000-8000-000000000001', current_setting('app.authz_owner')::uuid, current_date, 'OWNER REPORT');
insert into public.app_profile_report_projects(id, user_id, name) values
  ('12a53000-0000-4000-8000-000000000001', current_setting('app.authz_owner')::uuid, 'OWNER REPORT PROJECT');

insert into public.app_ai_workspace_settings(workspace_id)
values (current_setting('app.authz_workspace')::uuid);
insert into public.app_ai_conversations(id, workspace_id, owner_id, title) values
  ('12a60000-0000-4000-8000-000000000001', current_setting('app.authz_workspace')::uuid, current_setting('app.authz_owner')::uuid, 'OWNER AI');
insert into public.app_ai_messages(id, conversation_id, owner_id, role, content) values
  ('12a61000-0000-4000-8000-000000000001', '12a60000-0000-4000-8000-000000000001', current_setting('app.authz_owner')::uuid, 'user', 'OWNER PROMPT');
insert into public.app_ai_daily_usage(workspace_id, user_id, day, requests) values
  (current_setting('app.authz_workspace')::uuid, current_setting('app.authz_owner')::uuid, current_date, 1);

insert into public.app_tasks(id, workspace_id, title, created_by, source_type, source_id) values
  ('12a70000-0000-4000-8000-000000000001', current_setting('app.authz_workspace')::uuid, 'OWNER PROJECTLESS TASK', current_setting('app.authz_owner')::uuid, 'meeting', '12a10000-0000-4000-8000-000000000001');
insert into public.app_direct_messages(id, workspace_id, sender_id, recipient_id, body) values
  ('12a71000-0000-4000-8000-000000000001', current_setting('app.authz_workspace')::uuid, current_setting('app.authz_owner')::uuid, current_setting('app.authz_admin')::uuid, 'OWNER PRIVATE MESSAGE');

insert into public.app_pages(id, workspace_id, slug, title, body, visibility, status, owner_id, published_at) values
  ('12a80000-0000-4000-8000-000000000001', current_setting('app.authz_workspace')::uuid, 'task12a-public', 'OWNER PUBLIC PAGE', 'PUBLIC BODY', 'public', 'published', current_setting('app.authz_owner')::uuid, now()),
  ('12a80000-0000-4000-8000-000000000002', current_setting('app.authz_workspace')::uuid, 'gimpo-publicization', 'OWNER UNLISTED PAGE', 'UNLISTED BODY', 'unlisted', 'published', current_setting('app.authz_owner')::uuid, now()),
  ('12a80000-0000-4000-8000-000000000003', current_setting('app.authz_workspace')::uuid, 'task12a-workspace', 'OWNER WORKSPACE PAGE', 'WORKSPACE BODY', 'workspace', 'published', current_setting('app.authz_owner')::uuid, now()),
  ('12a80000-0000-4000-8000-000000000004', current_setting('app.authz_workspace')::uuid, 'task12a-private', 'OWNER PRIVATE PAGE', 'PRIVATE BODY', 'private', 'published', current_setting('app.authz_owner')::uuid, now());
insert into public.app_share_links(id,page_id,token_hash,expires_at,created_by) values
  ('12a81000-0000-4000-8000-000000000001','12a80000-0000-4000-8000-000000000004',encode(extensions.digest('task12a-share'::bytea,'sha256'),'hex'),now()+interval '1 day',current_setting('app.authz_owner')::uuid);

-- Anonymous: no direct base-table access, but the narrow public projection remains.
set local role anon;
insert into authz_sole_owner_results values
  ('anon', 'pages', pg_temp.authz_probe_count('select count(*) from public.app_pages where slug like ''task12a-%'' or slug=''gimpo-publicization''')),
  ('anon', 'documents', pg_temp.authz_probe_count('select count(*) from public.app_documents where id::text like ''eeeeeeee-%'''));
select pg_temp.authz_expect_no_write('anon page insert', $$insert into public.app_pages(workspace_id,slug,title,owner_id) values ('12a00000-0000-4000-8000-000000000001','task12a-anon-write','DENIED','12000000-0000-4000-8000-000000000003')$$);
do $$
begin
  if (select count(*) from public.app_public_post('task12a-public')) <> 1 then raise exception 'public page projection missing'; end if;
  if (select count(*) from public.app_public_post('gimpo-publicization')) <> 1 then raise exception 'allowed unlisted projection missing'; end if;
  if (select count(*) from public.app_public_post('public-doc-eeeeeeeeeeee')) <> 1 then raise exception 'public document projection missing'; end if;
  if (select count(*) from public.app_public_post('task12a-private')) <> 0 then raise exception 'private page leaked through projection'; end if;
end $$;
reset role;

-- Authenticated non-member: zero owner-private reads and writes.
select set_config('request.jwt.claim.sub', current_setting('app.authz_non_member'), true);
set local role authenticated;
insert into authz_sole_owner_results values
  ('non_member', 'meetings', pg_temp.authz_probe_count('select count(*) from public.app_meetings where id=''12a10000-0000-4000-8000-000000000001''')),
  ('non_member', 'documents', pg_temp.authz_probe_count('select count(*) from public.app_documents where id::text like ''eeeeeeee-%''')),
  ('non_member', 'events', pg_temp.authz_probe_count('select count(*) from public.app_events where id::text like ''12a3%''')),
  ('non_member', 'organizations', pg_temp.authz_probe_count('select count(*) from public.app_suborganizations where id=''12a40000-0000-4000-8000-000000000001''')),
  ('non_member', 'profiles', pg_temp.authz_probe_count('select count(*) from public.app_profiles where user_id=''12000000-0000-4000-8000-000000000001''')),
  ('non_member', 'ai', pg_temp.authz_probe_count('select count(*) from public.app_ai_workspace_settings where workspace_id=''12a00000-0000-4000-8000-000000000001''')),
  ('non_member', 'tasks', pg_temp.authz_probe_count('select count(*) from public.app_tasks where id=''12a70000-0000-4000-8000-000000000001'''));
select pg_temp.authz_expect_no_write('non-member meeting insert', $$insert into public.app_meetings(workspace_id,title,created_by) values ('12a00000-0000-4000-8000-000000000001','DENIED','12000000-0000-4000-8000-000000000003')$$);
reset role;

-- Existing non-owner admin: self bootstrap only, no owner rows or mutations.
select set_config('request.jwt.claim.sub', current_setting('app.authz_admin'), true);
set local role authenticated;
insert into authz_sole_owner_results values
  ('admin', 'meetings', pg_temp.authz_probe_count('select count(*) from public.app_meetings where id=''12a10000-0000-4000-8000-000000000001''')),
  ('admin', 'documents', pg_temp.authz_probe_count('select count(*) from public.app_documents where id::text like ''eeeeeeee-%''')),
  ('admin', 'events', pg_temp.authz_probe_count('select count(*) from public.app_events where id::text like ''12a3%''')),
  ('admin', 'event_children', pg_temp.authz_probe_count('select (select count(*) from public.app_event_comments where event_id=''12a30000-0000-4000-8000-000000000001'') + (select count(*) from public.app_event_photos where event_id=''12a30000-0000-4000-8000-000000000001'')')),
  ('admin', 'organizations', pg_temp.authz_probe_count('select count(*) from public.app_suborganizations where id=''12a40000-0000-4000-8000-000000000001''')),
  ('admin', 'profiles', pg_temp.authz_probe_count('select count(*) from public.app_profiles where user_id=''12000000-0000-4000-8000-000000000001''')),
  ('admin', 'ai', pg_temp.authz_probe_count('select count(*) from public.app_ai_workspace_settings where workspace_id=''12a00000-0000-4000-8000-000000000001''')),
  ('admin', 'tasks', pg_temp.authz_probe_count('select count(*) from public.app_tasks where id=''12a70000-0000-4000-8000-000000000001''')),
  ('admin', 'direct_messages', pg_temp.authz_probe_count('select count(*) from public.app_direct_messages where id=''12a71000-0000-4000-8000-000000000001''')),
  ('admin', 'self_membership', pg_temp.authz_probe_count('select count(*) from public.app_workspace_members where workspace_id=''12a00000-0000-4000-8000-000000000001''')),
  ('admin', 'self_profile', pg_temp.authz_probe_count('select count(*) from public.app_profiles where user_id=auth.uid()'));
select pg_temp.authz_expect_no_write('admin meeting update', $$update public.app_meetings set title='DENIED' where id='12a10000-0000-4000-8000-000000000001'$$);
select pg_temp.authz_expect_no_write('admin document delete', $$delete from public.app_documents where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'$$);
select pg_temp.authz_expect_no_write('admin team event insert', $$insert into public.app_events(workspace_id,title,start_at,created_by,calendar_scope) values ('12a00000-0000-4000-8000-000000000001','DENIED',now(),'12000000-0000-4000-8000-000000000002','team')$$);
select pg_temp.authz_expect_no_write('admin AI settings update', $$update public.app_ai_workspace_settings set daily_request_limit=999 where workspace_id='12a00000-0000-4000-8000-000000000001'$$);
select pg_temp.authz_expect_no_write('admin owner profile update', $$update public.app_profiles set job_title='DENIED' where user_id='12000000-0000-4000-8000-000000000001'$$);
select pg_temp.authz_expect_no_write('admin task delete', $$delete from public.app_tasks where id='12a70000-0000-4000-8000-000000000001'$$);
select pg_temp.authz_expect_no_write('admin create invite', $$select public.app_create_invite('viewer',null,now()+interval '1 day')$$);
select pg_temp.authz_expect_no_write('admin member role RPC', $$select public.app_set_workspace_member_role('12000000-0000-4000-8000-000000000003','viewer')$$);
select pg_temp.authz_expect_no_write('admin save page RPC', $$select public.app_save_page_v2(null,'12a00000-0000-4000-8000-000000000001',null,'DENIED','task12a-admin-write','','','draft','private')$$);
select pg_temp.authz_expect_no_write('admin event RPC', $$select public.app_update_event_body('12a30000-0000-4000-8000-000000000001','DENIED')$$);
select pg_temp.authz_expect_no_write('admin delete pages RPC', $$select public.app_delete_pages(array['12a80000-0000-4000-8000-000000000004'::uuid])$$);
do $$
begin
  if public.app_can_edit_page_rpc('12a80000-0000-4000-8000-000000000004') then raise exception 'admin page edit RPC bypass'; end if;
  if (select count(*) from public.app_open_share('task12a-share')) <> 0 then raise exception 'admin share RPC bypass'; end if;
end $$;
reset role;

-- Sole owner: all representative direct paths stay readable and writable.
select set_config('request.jwt.claim.sub', current_setting('app.authz_owner'), true);
set local role authenticated;
insert into authz_sole_owner_results values
  ('owner', 'meetings', pg_temp.authz_probe_count('select count(*) from public.app_meetings where id=''12a10000-0000-4000-8000-000000000001''')),
  ('owner', 'documents', pg_temp.authz_probe_count('select count(*) from public.app_documents where id::text like ''eeeeeeee-%''')),
  ('owner', 'events', pg_temp.authz_probe_count('select count(*) from public.app_events where id::text like ''12a3%''')),
  ('owner', 'organizations', pg_temp.authz_probe_count('select count(*) from public.app_suborganizations where id=''12a40000-0000-4000-8000-000000000001''')),
  ('owner', 'profiles', pg_temp.authz_probe_count('select count(*) from public.app_profiles where user_id=''12000000-0000-4000-8000-000000000001''')),
  ('owner', 'ai', pg_temp.authz_probe_count('select count(*) from public.app_ai_workspace_settings where workspace_id=''12a00000-0000-4000-8000-000000000001''')),
  ('owner', 'tasks', pg_temp.authz_probe_count('select count(*) from public.app_tasks where id=''12a70000-0000-4000-8000-000000000001'''));
do $$
declare
  v_id uuid := '12afffff-0000-4000-8000-000000000001';
  v_page public.app_pages;
begin
  insert into public.app_meetings(id,workspace_id,title,created_by)
  values(v_id,current_setting('app.authz_workspace')::uuid,'OWNER CRUD',auth.uid());
  update public.app_meetings set title='OWNER CRUD UPDATED' where id=v_id;
  if not found then raise exception 'owner meeting update failed'; end if;
  delete from public.app_meetings where id=v_id;
  if not found then raise exception 'owner meeting delete failed'; end if;
  if not public.app_can_edit_page_rpc('12a80000-0000-4000-8000-000000000004') then raise exception 'owner page edit RPC failed'; end if;
  if (select count(*) from public.app_open_share('task12a-share')) <> 1 then raise exception 'owner share RPC failed'; end if;
  if not public.app_update_event_body('12a30000-0000-4000-8000-000000000001','OWNER RPC UPDATED') then raise exception 'owner event RPC failed'; end if;
  v_page := public.app_save_page_v2(null,current_setting('app.authz_workspace')::uuid,null,'OWNER RPC PAGE','task12a-owner-rpc','','','draft','private');
  if v_page.id is null then raise exception 'owner page save RPC failed'; end if;
  if public.app_delete_pages(array[v_page.id]) <> 1 then raise exception 'owner page delete RPC failed'; end if;
  perform public.app_set_workspace_member_role(current_setting('app.authz_admin')::uuid,'viewer');
  perform public.app_set_workspace_member_role(current_setting('app.authz_admin')::uuid,'admin');
end $$;
reset role;

do $$
begin
  if has_function_privilege('authenticated','public.app_accept_invite(text)','EXECUTE')
     or has_function_privilege('authenticated','public.app_claim_owner(text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.app_request_workspace_access(text)','EXECUTE')
     or has_function_privilege('authenticated','public.app_respond_project_invitation(uuid,boolean)','EXECUTE')
     or has_function_privilege('authenticated','public.app_public_workspace_snapshot()','EXECUTE') then
    raise exception 'retired collaboration RPC remains executable by authenticated';
  end if;
  if not has_function_privilege('anon','public.app_public_post(text)','EXECUTE')
     or not has_function_privilege('anon','public.app_public_workspace_index()','EXECUTE') then
    raise exception 'Web1 public projection execute grant changed';
  end if;
  if has_function_privilege('anon','private.app_is_workspace_admin(uuid)','EXECUTE') then
    raise exception 'private owner helper remains executable by anon';
  end if;
end $$;

do $$
declare
  v_actor text;
  v_surface text;
  v_rows bigint;
begin
  for v_actor, v_surface, v_rows in select actor, surface, visible_rows from authz_sole_owner_results loop
    if v_actor in ('anon','non_member') and v_rows <> 0 then
      raise exception '% unexpectedly sees % row(s) on %', v_actor, v_rows, v_surface;
    end if;
    if v_actor='admin' and v_surface not in ('self_membership','self_profile') and v_rows <> 0 then
      raise exception 'non-owner admin unexpectedly sees % row(s) on %', v_rows, v_surface;
    end if;
    if v_actor='admin' and v_surface in ('self_membership','self_profile') and v_rows <> 1 then
      raise exception 'admin bootstrap % expected one self row, got %', v_surface, v_rows;
    end if;
    if v_actor='owner' and v_rows < 1 then
      raise exception 'owner lost % access', v_surface;
    end if;
  end loop;
end $$;

rollback;
