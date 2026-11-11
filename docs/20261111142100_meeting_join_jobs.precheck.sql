-- SELECT only. Run before dry-run/apply (승인형 DB workflow 또는 SQL Editor, 폰 경로 C). 집계·예/아니오·해시만, 행 값 없음. pg_catalog과 migration 기록만 읽는다.
-- 적용 전 기대: 아래 예/아니오 항목은 모두 예. 해시·recent migrations는 기록만 하고, 해시는 postcheck의 같은 이름 값과 같아야 한다(기존 표 정책·권한 그대로).
-- expect: recent migrations = 기록
-- expect: existing tables RLS policies grants hash = 기록
-- expect: existing tables column grants hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261111142100') then '예' else '아니오' end as value
union all select 'workspaces and members tables',case when to_regclass('public.app_workspaces') is not null and to_regclass('public.app_workspace_members') is not null then '예' else '아니오' end
union all select 'meetings table with deleted_at',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname='deleted_at' and not attisdropped) then '예' else '아니오' end
union all select 'meetings two text columns and kind',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname in('transcript_text','notes','activity_kind','updated_at','project_id') and not attisdropped)=5 then '예' else '아니오' end
union all select 'documents table',case when to_regclass('public.app_documents') is not null then '예' else '아니오' end
union all select 'documents columns for the recording file row',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_documents') and not attisdropped
  and attname in('workspace_id','project_id','meeting_id','title','category','source','document_date','description','tags','drive_url','file_id','file_name','mime_type','file_size','visibility','uploaded_by','auto_classified'))=17 then '예' else '아니오' end
union all select 'job tables and members columns',case when (select count(*) from pg_attribute where not attisdropped and (
  (attrelid=to_regclass('public.app_meeting_server_jobs') and attname in('workspace_id','status','meeting_id','opened_at'))
  or (attrelid=to_regclass('public.app_meeting_transcribe_jobs') and attname in('workspace_id','status','meeting_id','trashed_at','drive_file_id','file_name','mime_type','size_bytes'))
  or (attrelid=to_regclass('public.app_workspace_members') and attname in('workspace_id','user_id','role'))
  or (attrelid=to_regclass('public.app_record_links') and attname in('workspace_id','meeting_id','google_task_id'))))=18 then '예' else '아니오' end
union all select 'record links meeting_id column',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_record_links') and attname='meeting_id' and not attisdropped) then '예' else '아니오' end
union all select 'server jobs table',case when to_regclass('public.app_meeting_server_jobs') is not null then '예' else '아니오' end
union all select 'transcribe jobs table',case when to_regclass('public.app_meeting_transcribe_jobs') is not null then '예' else '아니오' end
union all select 'owner function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_meeting_join_jobs') is null then '예' else '아니오' end
union all select 'new functions absent',case when to_regprocedure('public.app_meeting_join_apply(uuid)') is null and to_regprocedure('public.app_meeting_join_undo(uuid,text)') is null then '예' else '아니오' end
union all select 'existing tables RLS policies grants hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=c.oid),''),';' order by c.relname)
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname in('app_meetings','app_documents','app_record_links','app_meeting_server_jobs','app_meeting_transcribe_jobs','app_workspace_members')),''))
union all select 'existing tables column grants hash',md5(coalesce((select string_agg(c.relname||'.'||a.attname||':'||a.attacl::text,',' order by c.relname,a.attname)
  from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attacl is not null and not a.attisdropped
    and c.relname in('app_meetings','app_documents','app_record_links','app_meeting_server_jobs','app_meeting_transcribe_jobs','app_workspace_members')),''))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
