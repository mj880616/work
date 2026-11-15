-- Authorization regression: page visibility matrix and direct-ID reads.
-- Requires at least three auth.users rows. All fixtures are rolled back.

begin;
create temp table authz_page_matrix(actor text primary key, slugs text[]);
grant select, insert on authz_page_matrix to anon, authenticated;

select set_config('app.authz_u1',(select id::text from auth.users order by created_at,id limit 1),true);
select set_config('app.authz_u2',(select id::text from auth.users where id::text<>current_setting('app.authz_u1') order by created_at,id limit 1),true);
select set_config('app.authz_u3',(select id::text from auth.users where id::text not in (current_setting('app.authz_u1'),current_setting('app.authz_u2')) order by created_at,id limit 1),true);

do $$
declare
  u1 uuid:=current_setting('app.authz_u1')::uuid;
  u2 uuid:=current_setting('app.authz_u2')::uuid;
  u3 uuid:=current_setting('app.authz_u3')::uuid;
begin
  if u3 is null then raise exception 'page visibility matrix requires three auth users'; end if;

  insert into public.app_workspaces(id,slug,name)
  values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','authz-page-matrix','AUTHZ PAGE MATRIX');

  insert into public.app_workspace_members(workspace_id,user_id,role) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',u1,'owner'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',u2,'viewer'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',u3,'viewer');

  insert into public.app_groups(id,workspace_id,slug,name)
  values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','authz-group','AUTHZ GROUP');
  insert into public.app_group_members(group_id,user_id)
  values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',u2);

  insert into public.app_pages(id,workspace_id,slug,title,visibility,status,owner_id,published_at) values
    ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','authz-public','PUBLIC','public','published',u1,now()),
    ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','authz-unlisted','UNLISTED','unlisted','published',u1,now()),
    ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','authz-workspace','WORKSPACE','workspace','published',u1,now()),
    ('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','authz-groups','GROUPS','groups','published',u1,now()),
    ('55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','authz-private','PRIVATE','private','published',u1,now());

  insert into public.app_page_permissions(page_id,group_id,permission)
  values('44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','view');
end $$;

set local role anon;
insert into authz_page_matrix
select 'anon',coalesce(array_agg(slug order by slug),'{}'::text[])
from public.app_pages where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
reset role;

select set_config('request.jwt.claim.sub',current_setting('app.authz_u2'),true);
set local role authenticated;
insert into authz_page_matrix
select 'group_member',coalesce(array_agg(slug order by slug),'{}'::text[])
from public.app_pages where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
reset role;

select set_config('request.jwt.claim.sub',current_setting('app.authz_u3'),true);
set local role authenticated;
insert into authz_page_matrix
select 'workspace_non_group',coalesce(array_agg(slug order by slug),'{}'::text[])
from public.app_pages where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
reset role;

insert into public.app_page_permissions(page_id,user_id,permission) values
  ('44444444-4444-4444-8444-444444444444',current_setting('app.authz_u3')::uuid,'edit'),
  ('55555555-5555-4555-8555-555555555555',current_setting('app.authz_u3')::uuid,'edit');
select set_config('request.jwt.claim.sub',current_setting('app.authz_u3'),true);
set local role authenticated;
insert into authz_page_matrix
select 'explicit_editor',coalesce(array_agg(slug order by slug),'{}'::text[])
from public.app_pages where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
reset role;

delete from public.app_page_permissions
where user_id=current_setting('app.authz_u3')::uuid
  and page_id in ('44444444-4444-4444-8444-444444444444'::uuid,'55555555-5555-4555-8555-555555555555'::uuid);
delete from public.app_workspace_members
where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid
  and user_id=current_setting('app.authz_u3')::uuid;
select set_config('request.jwt.claim.sub',current_setting('app.authz_u3'),true);
set local role authenticated;
insert into authz_page_matrix
select 'authenticated_non_member',coalesce(array_agg(slug order by slug),'{}'::text[])
from public.app_pages where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
reset role;

select set_config('request.jwt.claim.sub',current_setting('app.authz_u1'),true);
set local role authenticated;
insert into authz_page_matrix
select 'owner',coalesce(array_agg(slug order by slug),'{}'::text[])
from public.app_pages where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
reset role;

do $$
declare
  got text[];
begin
  select slugs into got from authz_page_matrix where actor='anon';
  if got is distinct from array['authz-public','authz-unlisted']::text[] then raise exception 'anon page visibility mismatch: %',got; end if;
  select slugs into got from authz_page_matrix where actor='group_member';
  if got is distinct from array['authz-groups','authz-public','authz-unlisted','authz-workspace']::text[] then raise exception 'group member page visibility mismatch: %',got; end if;
  select slugs into got from authz_page_matrix where actor='workspace_non_group';
  if got is distinct from array['authz-public','authz-unlisted','authz-workspace']::text[] then raise exception 'workspace member page visibility mismatch: %',got; end if;
  select slugs into got from authz_page_matrix where actor='explicit_editor';
  if got is distinct from array['authz-groups','authz-public','authz-unlisted','authz-workspace']::text[] then raise exception 'explicit editor page visibility mismatch: %',got; end if;
  select slugs into got from authz_page_matrix where actor='authenticated_non_member';
  if got is distinct from array['authz-public','authz-unlisted']::text[] then raise exception 'non-member page visibility mismatch: %',got; end if;
  select slugs into got from authz_page_matrix where actor='owner';
  if got is distinct from array['authz-groups','authz-private','authz-public','authz-unlisted','authz-workspace']::text[] then raise exception 'owner page visibility mismatch: %',got; end if;
end $$;

rollback;
