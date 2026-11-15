-- Authorization regression: direct-ID mutation attempts for documents and pages.
-- Requires at least two auth.users rows. All fixtures are rolled back.

begin;
create temp table authz_write_results(test text primary key, affected int);
grant select,insert on authz_write_results to authenticated;

select set_config('app.authz_u1',(select id::text from auth.users order by created_at,id limit 1),true);
select set_config('app.authz_u2',(select id::text from auth.users where id::text<>current_setting('app.authz_u1') order by created_at,id limit 1),true);

do $$
declare
  u1 uuid:=current_setting('app.authz_u1')::uuid;
  u2 uuid:=current_setting('app.authz_u2')::uuid;
begin
  if u1 is null or u2 is null then raise exception 'direct-ID regression requires two auth users'; end if;
  insert into public.app_workspaces(id,slug,name)
  values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','authz-write-test','AUTHZ WRITE TEST');
  insert into public.app_workspace_members(workspace_id,user_id,role) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',u1,'owner'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',u2,'viewer');
  insert into public.app_documents(id,workspace_id,title,visibility,uploaded_by)
  values('ffffffff-ffff-4fff-8fff-fffffffffff1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','DOC','workspace',u1);
  insert into public.app_pages(id,workspace_id,slug,title,visibility,status,owner_id) values
    ('55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','authz-private-write','PRIVATE','private','draft',u1),
    ('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','authz-groups-write','GROUPS','groups','published',u1);
  insert into public.app_page_permissions(page_id,user_id,permission) values
    ('44444444-4444-4444-8444-444444444444',u2,'view'),
    ('55555555-5555-4555-8555-555555555555',u2,'edit');
end $$;

select set_config('request.jwt.claim.sub',current_setting('app.authz_u2'),true);
set local role authenticated;
with x as (
  update public.app_documents set title='HACKED'
  where id='ffffffff-ffff-4fff-8fff-fffffffffff1' returning 1
) insert into authz_write_results select 'viewer_document_update',count(*)::int from x;
with x as (
  delete from public.app_documents
  where id='ffffffff-ffff-4fff-8fff-fffffffffff1' returning 1
) insert into authz_write_results select 'viewer_document_delete',count(*)::int from x;
with x as (
  update public.app_pages set title='HACKED'
  where id='44444444-4444-4444-8444-444444444444' returning 1
) insert into authz_write_results select 'view_permission_page_update',count(*)::int from x;
with x as (
  delete from public.app_pages
  where id='44444444-4444-4444-8444-444444444444' returning 1
) insert into authz_write_results select 'view_permission_page_delete',count(*)::int from x;
with x as (
  update public.app_pages set title='HACKED PRIVATE'
  where id='55555555-5555-4555-8555-555555555555' returning 1
) insert into authz_write_results select 'private_explicit_edit_update',count(*)::int from x;
reset role;

do $$
declare bad int;
begin
  select count(*) into bad from authz_write_results where affected <> 0;
  if bad <> 0 then
    raise exception 'unauthorized direct-ID write unexpectedly affected rows: %', (select jsonb_agg(to_jsonb(r)) from authz_write_results r where affected<>0);
  end if;
end $$;

rollback;
