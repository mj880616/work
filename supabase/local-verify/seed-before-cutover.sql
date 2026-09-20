-- LOCAL TEST DATA ONLY. Never apply this file to the hosted Web2 project.
-- Load after a schema-only Web2 baseline and already-applied migrations, but
-- before 20260920120000/121000/122000. The cutover preflight needs these rows.
-- Do not configure this as Supabase's automatic seed.sql; that runs too late.
-- All titles, bodies, users, and files below are synthetic. The seven page slugs
-- intentionally match existing URLs so local compatibility checks can use them.
-- Create the four fixed user IDs through LOCAL Auth Admin before loading this file.
begin;
do $local_only$
begin
  if current_setting('app.local_verification',true) is distinct from 'on' then
    raise exception 'Local verification seed requires app.local_verification=on';
  end if;
end
$local_only$;

insert into public.app_workspaces(id,slug,name)
values ('90000000-0000-4000-8000-000000000010','kptu-work','LOCAL TEST WORKSPACE');

insert into public.app_workspace_members(workspace_id,user_id,role) values
  ('90000000-0000-4000-8000-000000000010','90000000-0000-4000-8000-000000000001','owner'),
  ('90000000-0000-4000-8000-000000000010','90000000-0000-4000-8000-000000000002','viewer'),
  ('90000000-0000-4000-8000-000000000010','90000000-0000-4000-8000-000000000004','admin');

insert into public.app_pages(workspace_id,slug,title,summary,body,content_format,visibility,status,owner_id)
select '90000000-0000-4000-8000-000000000010',slug,'LOCAL '||slug,
       'Synthetic public URL compatibility fixture','Synthetic body only',
       'markdown',visibility,'published','90000000-0000-4000-8000-000000000001'
from (values
  ('bus-strike-publicness-internal-archive-202609','unlisted'),
  ('gimpo-publicization','unlisted'),
  ('gimpo-publicization-audit','unlisted'),
  ('gimpo-publicization-press-1008','unlisted'),
  ('line9-publicization','unlisted'),
  ('line9-publicization-audit','unlisted'),
  ('private-rail-forum-0929-prep','public')
) as legacy(slug,visibility);

insert into public.app_pages(workspace_id,slug,title,summary,body,content_format,visibility,status,owner_id)
values ('90000000-0000-4000-8000-000000000010','local-private-post',
        'LOCAL PRIVATE POST','Synthetic private summary','Synthetic private body',
        'markdown','private','published','90000000-0000-4000-8000-000000000001');

-- The cutover preflight expects 14 public legacy document URLs.
insert into public.app_documents(id,workspace_id,title,description,visibility,uploaded_by)
select ('90000000-'||lpad(n::text,4,'0')||'-4000-8000-000000000000')::uuid,
       '90000000-0000-4000-8000-000000000010',
       'LOCAL PUBLIC DOCUMENT '||n,'Synthetic file metadata only','public',
       '90000000-0000-4000-8000-000000000001'
from generate_series(100,113) as n;

insert into public.app_spaces(id,workspace_id,slug,name,description,created_by,owner_id,status,visibility,metadata)
values
  ('90000000-0000-4000-8000-000000000020','90000000-0000-4000-8000-000000000010',
   'local-private-project','LOCAL PRIVATE PROJECT','Synthetic internal project',
   '90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',
   'active','team','{"project_system":"v2"}');
insert into public.app_spaces(id,workspace_id,parent_id,slug,name,description,created_by,owner_id,status,visibility,metadata)
values
  ('90000000-0000-4000-8000-000000000021','90000000-0000-4000-8000-000000000010',
   '90000000-0000-4000-8000-000000000020','local-private-subpage','LOCAL PRIVATE SUBPAGE',
   'Synthetic internal subpage','90000000-0000-4000-8000-000000000001',
   '90000000-0000-4000-8000-000000000001','active','team','{"project_system":"v2"}');

insert into public.app_project_sections(id,project_id,title,sort_order,created_by)
values ('90000000-0000-4000-8000-000000000030','90000000-0000-4000-8000-000000000020',
        'LOCAL SECTION',10,'90000000-0000-4000-8000-000000000001');
insert into public.app_project_blocks(id,project_id,section_id,block_type,title,content,sort_order,created_by)
values ('90000000-0000-4000-8000-000000000031','90000000-0000-4000-8000-000000000020',
        '90000000-0000-4000-8000-000000000030','text','LOCAL BLOCK',
        '{"text":"Synthetic public candidate","private_key":"never disclose"}',10,
        '90000000-0000-4000-8000-000000000001');

insert into public.app_events(id,workspace_id,title,description,event_type,start_at,created_by,body,calendar_scope)
values ('90000000-0000-4000-8000-000000000040','90000000-0000-4000-8000-000000000010',
        'LOCAL MEETING','Synthetic internal meeting','meeting',now()+interval '1 day',
        '90000000-0000-4000-8000-000000000001','Synthetic private meeting body','team');
insert into public.app_meetings(id,workspace_id,project_id,title,meeting_at,transcript_text,created_by)
values ('90000000-0000-4000-8000-000000000041','90000000-0000-4000-8000-000000000010',
        '90000000-0000-4000-8000-000000000020','LOCAL PRIVATE MEETING',now(),
        '','90000000-0000-4000-8000-000000000001');
insert into public.app_tasks(id,workspace_id,project_id,title,note,assignee_id,created_by,source_type)
values ('90000000-0000-4000-8000-000000000042','90000000-0000-4000-8000-000000000010',
        '90000000-0000-4000-8000-000000000020','LOCAL INTERNAL TASK',
        'Synthetic internal task note','90000000-0000-4000-8000-000000000001',
        '90000000-0000-4000-8000-000000000001','manual');
insert into public.app_project_updates(project_id,author_id,kind,body)
values ('90000000-0000-4000-8000-000000000020',
        '90000000-0000-4000-8000-000000000001','note','Synthetic internal memo');
insert into public.app_documents(id,workspace_id,project_id,meeting_id,title,description,visibility,uploaded_by,extraction_status,extracted_text)
values ('90000000-0000-4000-8000-000000000050','90000000-0000-4000-8000-000000000010',
        '90000000-0000-4000-8000-000000000020','90000000-0000-4000-8000-000000000041',
        'LOCAL PRIVATE FILE','Synthetic internal file metadata only','private',
        '90000000-0000-4000-8000-000000000001','ready','Synthetic internal file text');
commit;
