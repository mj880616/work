-- Task 13 authorization regression. All fixtures are rolled back.

begin;

do $$
declare
  target regprocedure;
begin
  foreach target in array array[
    'public.app_public_workspace_index()'::regprocedure,
    'public.app_public_workspace_snapshot()'::regprocedure,
    'public.app_public_projects_snapshot()'::regprocedure,
    'public.app_public_project(text)'::regprocedure,
    'public.app_public_suborganization_facets()'::regprocedure,
    'public.app_project_publication_state(uuid)'::regprocedure,
    'public.app_set_project_publication(uuid,boolean,boolean,text)'::regprocedure,
    'public.app_set_project_block_publication(uuid,boolean,boolean,integer)'::regprocedure,
    'public.app_move_project_public_block(uuid,integer)'::regprocedure,
    'public.app_create_share_link(uuid,timestamptz)'::regprocedure,
    'public.app_open_share(text)'::regprocedure,
    'public.app_save_page_v2(uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure
  ] loop
    if has_function_privilege('anon', target, 'EXECUTE')
       or has_function_privilege('authenticated', target, 'EXECUTE')
       or has_function_privilege('service_role', target, 'EXECUTE') then
      raise exception 'retired Web2 RPC remains executable: %', target;
    end if;
  end loop;

  if not has_function_privilege('anon','public.app_public_post(text)','EXECUTE') then
    raise exception 'Web1 app_public_post grant regressed';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.app_pages'::regclass
      and tgname='task13_pages_private_visibility' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid='public.app_documents'::regclass
      and tgname='task13_documents_private_visibility' and not tgisinternal
  ) then
    raise exception 'Task 13 private visibility trigger is missing';
  end if;
end
$$;

-- A production schema-only rehearsal has no rows. Add a rollback-only owner
-- fixture when needed so the actor checks exercise the same RLS and FK graph.
do $$
begin
  if not exists (select 1 from public.app_workspace_members where role='owner') then
    insert into auth.users(
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '13000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated',
      'task13-local@example.invalid', '{}'::jsonb,
      '{"display_name":"Task 13 local owner"}'::jsonb, now(), now()
    );
    insert into public.app_workspaces(id,slug,name)
    values ('13000000-0000-4000-8000-000000000011','task13-local','Task 13 local');
    insert into public.app_workspace_members(workspace_id,user_id,role)
    values (
      '13000000-0000-4000-8000-000000000011',
      '13000000-0000-4000-8000-000000000010',
      'owner'
    );
  end if;
end
$$;

select set_config(
  'app.task13_user',
  (select user_id::text from public.app_workspace_members where role='owner' order by created_at, user_id limit 1),
  true
);
select set_config(
  'app.task13_workspace',
  (select workspace_id::text from public.app_workspace_members where user_id=current_setting('app.task13_user')::uuid and role='owner' order by created_at limit 1),
  true
);

do $$
begin
  if nullif(current_setting('app.task13_user', true),'') is null
     or nullif(current_setting('app.task13_workspace', true),'') is null then
    raise exception 'Task 13 regression requires the sole-owner fixture';
  end if;
end
$$;

-- Retained legacy rows are fixtures only; the transaction rolls them back.
insert into public.app_pages(id,workspace_id,slug,title,visibility,status,owner_id,published_at)
values (
  '13000000-0000-4000-8000-000000000005', current_setting('app.task13_workspace')::uuid,
  'task13-retained-public', 'TASK13 RETAINED PUBLIC', 'public', 'published',
  current_setting('app.task13_user')::uuid, now()
);

insert into public.app_documents(id,workspace_id,title,visibility,uploaded_by)
values (
  '13000000-0000-4000-8000-000000000006', current_setting('app.task13_workspace')::uuid,
  'TASK13 RETAINED WORKSPACE', 'workspace', current_setting('app.task13_user')::uuid
);

select set_config('request.jwt.claim.sub', current_setting('app.task13_user'), true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('app.task13_user'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

create or replace function pg_temp.task13_expect_denied(p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected write denial: %', p_sql;
exception
  when insufficient_privilege then null;
end
$$;

select pg_temp.task13_expect_denied(format(
  'insert into public.app_pages(id,workspace_id,slug,title,visibility,status,owner_id) values (%L,%L,%L,%L,%L,%L,%L)',
  '13000000-0000-4000-8000-000000000001', current_setting('app.task13_workspace'),
  'task13-public-denied', 'TASK13 PUBLIC DENIED', 'public', 'draft', current_setting('app.task13_user')
));

select pg_temp.task13_expect_denied(format(
  'insert into public.app_documents(id,workspace_id,title,visibility,uploaded_by) values (%L,%L,%L,%L,%L)',
  '13000000-0000-4000-8000-000000000002', current_setting('app.task13_workspace'),
  'TASK13 PUBLIC DENIED', 'public', current_setting('app.task13_user')
));

insert into public.app_pages(id,workspace_id,slug,title,visibility,status,owner_id)
values (
  '13000000-0000-4000-8000-000000000003', current_setting('app.task13_workspace')::uuid,
  'task13-private-allowed', 'TASK13 PRIVATE ALLOWED', 'private', 'draft', current_setting('app.task13_user')::uuid
);

insert into public.app_documents(id,workspace_id,title,visibility,uploaded_by)
values (
  '13000000-0000-4000-8000-000000000004', current_setting('app.task13_workspace')::uuid,
  'TASK13 PRIVATE ALLOWED', 'private', current_setting('app.task13_user')::uuid
);

update public.app_pages
set title='TASK13 RETAINED PUBLIC UPDATED', visibility='public'
where id='13000000-0000-4000-8000-000000000005';
update public.app_documents
set title='TASK13 RETAINED WORKSPACE UPDATED', visibility='workspace'
where id='13000000-0000-4000-8000-000000000006';

do $$
begin
  if not exists (
    select 1 from public.app_pages
    where id='13000000-0000-4000-8000-000000000005'
      and title='TASK13 RETAINED PUBLIC UPDATED' and visibility='public'
  ) or not exists (
    select 1 from public.app_documents
    where id='13000000-0000-4000-8000-000000000006'
      and title='TASK13 RETAINED WORKSPACE UPDATED' and visibility='workspace'
  ) then
    raise exception 'metadata-only update of retained legacy visibility failed';
  end if;
end
$$;

select pg_temp.task13_expect_denied(
  $$update public.app_pages set visibility='unlisted' where id='13000000-0000-4000-8000-000000000003'$$
);
select pg_temp.task13_expect_denied(
  $$update public.app_documents set visibility='workspace' where id='13000000-0000-4000-8000-000000000004'$$
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into public.app_pages(id,workspace_id,slug,title,visibility,status,owner_id,published_at)
values (
  '13000000-0000-4000-8000-000000000007', current_setting('app.task13_workspace')::uuid,
  'task13-service-public', 'TASK13 SERVICE PUBLIC', 'public', 'published',
  current_setting('app.task13_user')::uuid, now()
);

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
begin
  if (select count(*) from public.app_public_post('task13-retained-public')) <> 1 then
    raise exception 'Web1 public post projection regressed';
  end if;
end
$$;

reset role;
rollback;
