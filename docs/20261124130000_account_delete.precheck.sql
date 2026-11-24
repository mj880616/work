-- SELECT only. 20261124130000_account_delete 적용 전(시험 적용 전후 비교에도 씀). 카탈로그·migration 기록·줄 수만 읽는다(행 값 없음).
-- 지우기 목록(listed)은 migration의 트리거 함수가 지우는 표·칸과 같다(tests/security/account-delete-migration.test.mjs가 대조).
-- covered = 목록 표 + 그 표에서 on delete cascade로 이어지는 표. 남는 표(작업공간·user_id 칸이 있는데 covered가 아닌 app_ 표)와
--   covered 표를 가리키는데 cascade가 아닌 연결(지우면 막히거나 고아 줄이 남음)이 0이어야 적용한다. 이름 목록은 SQL Editor에서 이 파일을 실행해 본다.
-- expect: new migration absent = 예
-- expect: collab groups applied = 예
-- expect: new names free = 예
-- expect: listed key columns exist = 예
-- expect: tables left behind = 0
-- expect: left table names = 기록
-- expect: links that keep rows = 0
-- expect: link names = 기록
-- expect: restrict links inside = 기록
-- expect: deleted tables not forced = 예
-- expect: workspace rows = 기록
-- expect: member rows = 기록
-- expect: existing boundary hash = 기록
with recursive listed(tbl,col) as (values
    ('app_feedback','user_id'),('app_feedback','workspace_id'),('app_feature_locks','user_id'),('app_note_folder_locks','user_id'),
    ('app_update_news_reads','user_id'),('app_google_calendar_connections','user_id'),('app_google_oauth_states','user_id'),('app_drive_download_tokens','user_id'),
    ('app_private_feature_access','user_id'),('app_record_links','workspace_id'),('app_document_date_fixes','workspace_id'),('app_feed_entity_fixes','workspace_id'),
    ('app_outside_sentences','workspace_id'),('app_outside_summary_fixes','workspace_id'),('app_outside_title_fixes','workspace_id'),('app_tg_day_senders','workspace_id'),
    ('app_onedrive_photos','workspace_id'),('app_onedrive_folders','workspace_id'),('app_tasks','workspace_id'),('app_events','workspace_id'),
    ('app_ai_conversations','workspace_id'),('app_ai_daily_usage','workspace_id'),('app_ai_workspace_settings','workspace_id'),('app_direct_messages','workspace_id'),
    ('app_org_affiliation_tags','workspace_id'),('app_invites','workspace_id'),('app_access_requests','workspace_id'),('app_groups','workspace_id'),
    ('app_drive_settings','workspace_id'),('app_pages','workspace_id'),('app_documents','workspace_id'),('app_meetings','workspace_id'),
    ('app_suborganizations','workspace_id'),('app_spaces','workspace_id'),('app_profiles','user_id'),('app_workspace_members','workspace_id'),
    ('app_workspaces','id'),('app_collab_groups','id'),('app_collab_members','user_id'),('app_collab_join_requests','requester_user_id'),
    ('app_collab_invites','created_by'),('app_collab_join_attempts','user_id')),
  tabs as (select c.oid,c.relname::text as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
  covered(oid) as (select t.oid from tabs t where t.name in (select tbl from listed)
    union select con.conrelid from pg_constraint con join covered cv on cv.oid=con.confrelid where con.contype='f' and con.confdeltype='c'),
  keyed as (select distinct t.oid,t.name from tabs t join pg_attribute a on a.attrelid=t.oid and not a.attisdropped and a.attnum>0
    where t.name like 'app\_%' and a.attname in ('workspace_id','user_id') and a.atttypid='uuid'::regtype),
  left_tables as (select k.name from keyed k where k.oid not in (select oid from covered)),
  leaking as (select con.conname::text,con.conrelid from pg_constraint con where con.contype='f' and con.confrelid in (select oid from covered) and con.conrelid not in (select oid from covered)),
  restrict_links as (select con.conname::text from pg_constraint con where con.contype='f' and con.confdeltype in ('r','a') and con.confrelid in (select oid from covered) and con.conrelid in (select oid from covered) and con.conrelid<>con.confrelid)
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261124130000') then '예' else '아니오' end as value
union all select 'collab groups applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261118110000' and name='collab_groups')=1 then '예' else '아니오' end
union all select 'new names free',case when to_regclass('public.app_account_delete_runs') is null and to_regprocedure('public.app_account_delete_check()') is null and to_regprocedure('public.app_account_delete(text)') is null and to_regprocedure('private.app_account_delete_run()') is null then '예' else '아니오' end
union all select 'listed key columns exist',case when not exists(select 1 from listed l join tabs t on t.name=l.tbl where not exists(select 1 from pg_attribute a where a.attrelid=t.oid and a.attname=l.col and a.atttypid='uuid'::regtype and not a.attisdropped)) then '예' else '아니오' end
union all select 'tables left behind',(select count(*)::text from left_tables)
union all select 'left table names',coalesce((select string_agg(name,', ' order by name) from left_tables),'없음')
union all select 'links that keep rows',(select count(*)::text from leaking)
union all select 'link names',coalesce((select string_agg(conname,', ' order by conname) from leaking),'없음')
union all select 'restrict links inside',coalesce((select count(*)::text||': '||string_agg(conname,', ' order by conname) from restrict_links),'0')
union all select 'deleted tables not forced',case when not exists(select 1 from pg_class c where c.oid in (select oid from covered) and c.relforcerowsecurity) then '예' else '아니오' end
union all select 'workspace rows',(select count(*)::text from public.app_workspaces)
union all select 'member rows',(select count(*)::text from public.app_workspace_members)
union all select 'existing boundary hash',md5(coalesce((select string_agg(c.relname::text||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in (to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'),to_regclass('public.app_collab_members'),to_regclass('public.app_collab_groups'))),'')||coalesce((select string_agg(p.polrelid::regclass::text||p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),''),',' order by p.polrelid::regclass::text,p.polname) from pg_policy p where p.polrelid in (to_regclass('public.app_workspaces'),to_regclass('public.app_workspace_members'))),'')||coalesce((select md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,'') from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')),''));
