-- Authorization regression: document visibility and derived AI data.
-- Requires at least two auth.users rows. All fixtures are rolled back.

begin;

select set_config(
  'app.authz_test_user1',
  (select id::text from auth.users order by created_at, id limit 1),
  true
);
select set_config(
  'app.authz_test_user2',
  (
    select id::text from auth.users
    where id::text <> current_setting('app.authz_test_user1')
    order by created_at, id limit 1
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

  insert into public.app_workspaces(id, slug, name)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authz-document-visibility', 'AUTHZ DOCUMENT VISIBILITY');

  insert into public.app_workspace_members(workspace_id, user_id, role) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', u1, 'owner'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', u2, 'viewer');

  insert into public.app_documents(id, workspace_id, title, visibility, uploaded_by) values
    ('ffffffff-ffff-4fff-8fff-fffffffffff1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'PRIVATE DOC', 'private', u1),
    ('ffffffff-ffff-4fff-8fff-fffffffffff2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'WORKSPACE DOC', 'workspace', u1),
    ('ffffffff-ffff-4fff-8fff-fffffffffff3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'GROUPS DOC', 'groups', u1),
    ('ffffffff-ffff-4fff-8fff-fffffffffff4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'PUBLIC DOC', 'public', u1);

  insert into public.app_document_chunks(id, document_id, workspace_id, chunk_index, content) values
    ('11111111-1111-4111-8111-111111111111', 'ffffffff-ffff-4fff-8fff-fffffffffff1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 0, 'PRIVATE CHUNK'),
    ('22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-fffffffffff2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 0, 'WORKSPACE CHUNK');

  insert into public.app_document_ai_index(document_id, workspace_id, content_hash, summary) values
    ('ffffffff-ffff-4fff-8fff-fffffffffff1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'private-hash', 'PRIVATE SUMMARY'),
    ('ffffffff-ffff-4fff-8fff-fffffffffff2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'workspace-hash', 'WORKSPACE SUMMARY');
end $$;

select set_config('request.jwt.claim.sub', current_setting('app.authz_test_user2'), true);
set local role authenticated;

do $$
declare
  visible_ids uuid[];
  chunk_count int;
  ai_count int;
begin
  select array_agg(id order by id) into visible_ids
  from public.app_documents
  where id in (
    'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid,
    'ffffffff-ffff-4fff-8fff-fffffffffff2'::uuid,
    'ffffffff-ffff-4fff-8fff-fffffffffff3'::uuid,
    'ffffffff-ffff-4fff-8fff-fffffffffff4'::uuid
  );

  if visible_ids is distinct from array[
    'ffffffff-ffff-4fff-8fff-fffffffffff2'::uuid,
    'ffffffff-ffff-4fff-8fff-fffffffffff4'::uuid
  ] then
    raise exception 'viewer document visibility mismatch: %', visible_ids;
  end if;

  select count(*) into chunk_count
  from public.app_document_chunks
  where document_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid;
  if chunk_count <> 0 then
    raise exception 'private document chunks are visible';
  end if;

  select count(*) into ai_count
  from public.app_document_ai_index
  where document_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid;
  if ai_count <> 0 then
    raise exception 'private document AI index is visible';
  end if;
end $$;

reset role;
rollback;
