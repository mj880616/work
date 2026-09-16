-- Authorization regression: workspace/project relationship integrity.
-- Run against a production-like database with at least two auth.users rows.
-- The script is self-contained and always rolls back test data.

begin;

select set_config(
  'app.authz_test_user1',
  (select id::text from auth.users order by created_at, id limit 1),
  true
);

select set_config(
  'app.authz_test_user2',
  (
    select id::text
    from auth.users
    where id::text <> current_setting('app.authz_test_user1')
    order by created_at, id
    limit 1
  ),
  true
);

do $$
declare
  u1 uuid := current_setting('app.authz_test_user1')::uuid;
  u2 uuid := current_setting('app.authz_test_user2')::uuid;
begin
  if u1 is null or u2 is null then
    raise exception 'authz regression requires two auth users';
  end if;

  insert into public.app_workspaces(id, slug, name) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authz-regression-a', 'AUTHZ REGRESSION A'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'authz-regression-b', 'AUTHZ REGRESSION B');

  insert into public.app_workspace_members(workspace_id, user_id, role) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', u1, 'owner'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', u1, 'owner'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', u2, 'owner');

  insert into public.app_spaces(id, workspace_id, slug, name, created_by, owner_id, visibility) values
    ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authz-project-a', 'AUTHZ PROJECT A', u1, u1, 'team'),
    ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'authz-project-b', 'AUTHZ PROJECT B', u1, u1, 'team');
end $$;

select set_config('request.jwt.claim.sub', current_setting('app.authz_test_user1'), true);
set local role authenticated;

do $$
declare
  u1 uuid := current_setting('app.authz_test_user1')::uuid;
  rejected boolean;
begin
  rejected := false;
  begin
    insert into public.app_documents(workspace_id, project_id, title, uploaded_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'cross doc', u1);
  exception when sqlstate '23514' or sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then raise exception 'cross-workspace document insert was allowed'; end if;

  rejected := false;
  begin
    insert into public.app_events(workspace_id, project_id, title, start_at, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'cross event', now(), u1);
  exception when sqlstate '23514' or sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then raise exception 'cross-workspace event insert was allowed'; end if;

  rejected := false;
  begin
    insert into public.app_meetings(workspace_id, project_id, title, created_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'cross meeting', u1);
  exception when sqlstate '23514' or sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then raise exception 'cross-workspace meeting insert was allowed'; end if;

  rejected := false;
  begin
    update public.app_spaces
    set workspace_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
    where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  exception when sqlstate '23514' or sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then raise exception 'project workspace mutation was allowed'; end if;

  rejected := false;
  begin
    update public.app_spaces
    set parent_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
    where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  exception when sqlstate '23514' or sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then raise exception 'cross-workspace parent link was allowed'; end if;

  insert into public.app_documents(workspace_id, project_id, title, uploaded_by)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'same workspace document', u1);
end $$;

reset role;
rollback;
