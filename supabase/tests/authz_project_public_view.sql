-- Run inside a transaction after the project public-view migration; rollback fixtures.
begin;

create temp table project_public_result(phase text, payload jsonb);
grant select,insert on project_public_result to anon;

do $fixture$
declare w uuid; u uuid; p uuid; child uuid; s uuid; b uuid; internal_block uuid;
begin
  select id into w from public.app_workspaces where slug='kptu-work' limit 1;
  select user_id into u from public.app_workspace_members where workspace_id=w order by created_at limit 1;
  if w is null or u is null then raise exception 'workspace and owner fixture required'; end if;
  insert into public.app_spaces(workspace_id,slug,name,description,created_by,owner_id,status,visibility,metadata)
    values(w,'authz-project-view-fixture','PROJECT PUBLIC','source description',u,u,'active','team','{"project_system":"v2"}') returning id into p;
  insert into public.app_spaces(workspace_id,parent_id,slug,name,description,created_by,owner_id,status,visibility,metadata)
    values(w,p,'authz-child-view-fixture','CHILD PRIVATE','child description',u,u,'active','team','{"project_system":"v2"}') returning id into child;
  insert into public.app_project_sections(project_id,title,sort_order,created_by) values(p,'PUBLIC SECTION',10,u) returning id into s;
  insert into public.app_project_blocks(project_id,section_id,block_type,title,content,sort_order,created_by)
    values(p,s,'text','SAFE BLOCK','{"text":"original","private_key":"never send"}',10,u) returning id into b;
  insert into public.app_project_blocks(project_id,section_id,block_type,title,content,sort_order,created_by)
    values(p,s,'text','SECRET BLOCK','{"text":"internal"}',20,u) returning id into internal_block;
  create temp table project_public_ids(project_id uuid,child_id uuid,block_id uuid,internal_id uuid);
  insert into project_public_ids values(p,child,b,internal_block);
end
$fixture$;
grant select on project_public_ids to anon;

-- Anonymous cannot inspect the canonical project or any publication mapping.
set local role anon;
insert into project_public_result select 'before',public.app_public_project('project-'||replace(project_id::text,'-','')) from project_public_ids;
reset role;

do $check$
declare p uuid; b uuid; u uuid;
begin
  select project_id,block_id into p,b from project_public_ids;
  if exists(select 1 from project_public_result where phase='before' and payload is not null) then raise exception 'unpublished project exposed'; end if;
  if has_table_privilege('anon','public.app_project_publications','SELECT') or has_table_privilege('anon','public.app_project_public_blocks','SELECT') then raise exception 'publication mapping table exposed'; end if;
  select owner_id into u from public.app_spaces where id=p;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  if public.app_set_project_publication(p,true,false,null) then raise exception 'unconfirmed project publication accepted'; end if;
  if public.app_set_project_block_publication(b,true,false,10) then raise exception 'unconfirmed block publication accepted'; end if;
  if not public.app_set_project_block_publication(b,true,true,10) then raise exception 'block publication failed'; end if;
  if not public.app_set_project_publication(p,true,true,null) then raise exception 'project publication failed'; end if;
end
$check$;

set local role anon;
insert into project_public_result select 'published',public.app_public_project('project-'||replace(project_id::text,'-','')) from project_public_ids;
insert into project_public_result select 'child',public.app_public_project('project-'||replace(child_id::text,'-','')) from project_public_ids;
reset role;

do $check$
declare p uuid; b uuid; u uuid;
begin
  if (select payload #>> '{blocks,0,content,text}' from project_public_result where phase='published') <> 'original'
    or exists(select 1 from project_public_result where phase='child' and payload is not null)
    or exists(select 1 from project_public_result where payload::text like '%never send%' or payload::text like '%SECRET BLOCK%')
    then raise exception 'public response filtering failed'; end if;
  select project_id,block_id into p,b from project_public_ids;
  update public.app_project_blocks set content='{"text":"changed","private_key":"never send"}' where id=b;
  if (public.app_public_project('project-'||replace(p::text,'-','')) #>> '{blocks,0,content,text}') <> 'changed' then
    raise exception 'canonical block edit did not reach public reader';
  end if;
  select owner_id into u from public.app_spaces where id=p;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  if not public.app_set_project_publication(p,false,false,null) then raise exception 'revocation failed'; end if;
  if not public.app_set_project_publication((select child_id from project_public_ids),true,true,null) then
    raise exception 'independent child publication failed';
  end if;
end
$check$;

set local role anon;
insert into project_public_result select 'revoked',public.app_public_project('project-'||replace(project_id::text,'-','')) from project_public_ids;
insert into project_public_result select 'child_only',public.app_public_project('project-'||replace(child_id::text,'-','')) from project_public_ids;
reset role;
do $check$ begin
  if exists(select 1 from project_public_result where phase='revoked' and payload is not null)
    or (select payload->>'title' from project_public_result where phase='child_only') <> 'CHILD PRIVATE'
    then raise exception 'revocation or independent child URL failed'; end if;
end $check$;
rollback;
