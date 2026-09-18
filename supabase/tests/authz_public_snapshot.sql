-- Authorization regression: controlled public snapshot and direct-table denial.
-- Uses the existing kptu-work workspace, inserts temporary fixtures, and rolls everything back.

begin;

create temp table authz_public_snapshot(payload jsonb);
grant select, insert on authz_public_snapshot to anon;

select set_config(
  'app.authz_public_ws',
  (select id::text from public.app_workspaces where slug='kptu-work' limit 1),
  true
);
select set_config(
  'app.authz_public_user',
  (select id::text from auth.users order by created_at,id limit 1),
  true
);

do $$
declare
  wid uuid := current_setting('app.authz_public_ws')::uuid;
  uid uuid := current_setting('app.authz_public_user')::uuid;
begin
  if wid is null then raise exception 'kptu-work workspace is required'; end if;
  if uid is null then raise exception 'at least one auth user is required'; end if;

  insert into public.app_spaces(
    id,workspace_id,slug,name,description,created_by,owner_id,status,visibility,sort_order
  ) values
    ('11111111-aaaa-4111-8111-111111111111',wid,'authz-public-snapshot-public','AUTHZ PUBLIC SPACE','public fixture',uid,uid,'active','public',99990),
    ('22222222-aaaa-4222-8222-222222222222',wid,'authz-public-snapshot-private','AUTHZ PRIVATE SPACE','private fixture',uid,uid,'active','private',99991);

  insert into public.app_tasks(
    id,workspace_id,project_id,title,note,status,priority,created_by
  ) values
    ('33333333-aaaa-4333-8333-333333333333',wid,'11111111-aaaa-4111-8111-111111111111','AUTHZ PUBLIC TASK','SECRET_TASK_NOTE','todo','normal',uid),
    ('44444444-aaaa-4444-8444-444444444444',wid,'22222222-aaaa-4222-8222-222222222222','AUTHZ PRIVATE TASK','PRIVATE_TASK_NOTE','todo','normal',uid);

  insert into public.app_events(
    id,workspace_id,title,description,event_type,start_at,end_at,location,created_by,body,calendar_scope
  ) values
    ('55555555-aaaa-4555-8555-555555555555',wid,'AUTHZ TEAM EVENT','SECRET_EVENT_DESCRIPTION','meeting',now()+interval '1 day',null,'SECRET_EVENT_LOCATION',uid,'SECRET_EVENT_BODY','team'),
    ('66666666-aaaa-4666-8666-666666666666',wid,'AUTHZ PERSONAL EVENT','PERSONAL_DESCRIPTION','meeting',now()+interval '2 days',null,'PERSONAL_LOCATION',uid,'PERSONAL_BODY','personal');

  insert into public.app_documents(
    id,workspace_id,project_id,title,category,description,visibility,uploaded_by,extracted_text
  ) values
    ('77777777-aaaa-4777-8777-777777777777',wid,'11111111-aaaa-4111-8111-111111111111','AUTHZ PUBLIC DOCUMENT','테스트','public description','public',uid,'SECRET_EXTRACTED_TEXT'),
    ('88888888-aaaa-4888-8888-888888888888',wid,'11111111-aaaa-4111-8111-111111111111','AUTHZ WORKSPACE DOCUMENT','테스트','workspace description','workspace',uid,'WORKSPACE_EXTRACTED_TEXT');
end $$;

set local role anon;
insert into authz_public_snapshot(payload)
select public.app_public_projects_snapshot();
reset role;

do $$
declare
  j jsonb;
  default_visibility text;
begin
  select payload into j from authz_public_snapshot limit 1;

  if not (j->'spaces' @> '[{"id":"11111111-aaaa-4111-8111-111111111111"}]'::jsonb)
     or (j->'spaces' @> '[{"id":"22222222-aaaa-4222-8222-222222222222"}]'::jsonb) then
    raise exception 'public space filtering failed: %',j->'spaces';
  end if;

  if not (j->'tasks' @> '[{"id":"33333333-aaaa-4333-8333-333333333333"}]'::jsonb)
     or (j->'tasks' @> '[{"id":"44444444-aaaa-4444-8444-444444444444"}]'::jsonb)
     or j::text like '%SECRET_TASK_NOTE%' then
    raise exception 'public task projection failed: %',j->'tasks';
  end if;

  if not (j->'events' @> '[{"id":"55555555-aaaa-4555-8555-555555555555"}]'::jsonb)
     or (j->'events' @> '[{"id":"66666666-aaaa-4666-8666-666666666666"}]'::jsonb)
     or j::text like '%SECRET_EVENT_BODY%'
     or j::text like '%SECRET_EVENT_DESCRIPTION%'
     or j::text like '%SECRET_EVENT_LOCATION%' then
    raise exception 'public event projection failed: %',j->'events';
  end if;

  if not (j->'documents' @> '[{"id":"77777777-aaaa-4777-8777-777777777777"}]'::jsonb)
     or (j->'documents' @> '[{"id":"88888888-aaaa-4888-8888-888888888888"}]'::jsonb)
     or j::text like '%SECRET_EXTRACTED_TEXT%' then
    raise exception 'public document projection failed: %',j->'documents';
  end if;

  if has_table_privilege('anon','public.app_spaces','SELECT')
     or has_table_privilege('anon','public.app_tasks','SELECT')
     or has_table_privilege('anon','public.app_events','SELECT')
     or has_table_privilege('anon','public.app_documents','SELECT') then
    raise exception 'anon direct-table privilege remains on internal tables';
  end if;

  if not has_function_privilege('anon','public.app_public_projects_snapshot()','EXECUTE') then
    raise exception 'anon cannot execute controlled public snapshot';
  end if;

  select column_default into default_visibility
  from information_schema.columns
  where table_schema='public' and table_name='app_spaces' and column_name='visibility';

  if default_visibility is distinct from '''team''::text' then
    raise exception 'project visibility default is not team: %',default_visibility;
  end if;
end $$;

rollback;
