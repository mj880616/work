-- Authorization regression: app_tasks project and assignee workspace boundaries.
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
    ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authz-parent-a', 'AUTHZ PARENT A', u1, u1, 'team'),
    ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'authz-parent-b', 'AUTHZ PARENT B', u1, u1, 'team');

  insert into public.app_spaces(id, workspace_id, slug, name, parent_id, created_by, owner_id, visibility) values
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authz-child-a', 'AUTHZ CHILD A', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', u1, u1, 'team'),
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'authz-child-b', 'AUTHZ CHILD B', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', u1, u1, 'team');
end $$;

select set_config('request.jwt.claim.sub', current_setting('app.authz_test_user1'), true);
set local role authenticated;

do $$
declare
  u1 uuid := current_setting('app.authz_test_user1')::uuid;
  u2 uuid := current_setting('app.authz_test_user2')::uuid;
  rejected boolean;
begin
  insert into public.app_tasks(id, workspace_id, project_id, title, assignee_id, created_by, source_type)
  values (
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    'same workspace task',
    u1,
    u1,
    'manual'
  );

  rejected := false;
  begin
    insert into public.app_tasks(workspace_id, project_id, title, assignee_id, created_by, source_type)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
      'cross workspace project task',
      u1,
      u1,
      'manual'
    );
  exception when sqlstate '23514' or sqlstate '42501' or sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then raise exception 'cross-workspace task project was allowed'; end if;

  rejected := false;
  begin
    insert into public.app_tasks(workspace_id, project_id, title, assignee_id, created_by, source_type)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      'cross workspace assignee insert',
      u2,
      u1,
      'manual'
    );
  exception when sqlstate '23514' or sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then raise exception 'cross-workspace assignee insert was allowed'; end if;

  rejected := false;
  begin
    update public.app_tasks
    set assignee_id = u2
    where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  exception when sqlstate '23514' or sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then raise exception 'cross-workspace assignee update was allowed'; end if;
end $$;

reset role;
rollback;
