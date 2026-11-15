-- SELECT only. Run before apply (SQL Editor, phone path C, or approved DB workflow). Aggregates only; no folder names, ids or row values.
-- 적용 전 기대: 아래 예/아니오 항목은 모두 예. 숫자·해시·목록 항목은 사후 확인과 비교용으로 캡처만 한다(기록).
-- read_only 요청은 실행 역할이 postgres가 아닐 수 있으므로 current_user 대신 postgres 역할을 명시해 확인한다.
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: folder row count = 기록
-- expect: folder item row count = 기록
-- expect: folder foreign keys in by action = 기록
-- expect: folder item foreign keys in by action = 기록
-- expect: folder triggers = 기록
-- expect: folder constraints hash = 기록
-- expect: folder columns hash = 기록
-- expect: folder owner RLS grants hash = 기록
-- expect: folder policies hash = 기록
-- expect: folder rows hash (ids only) = 기록
-- expect: folder service_role select (table level) = 기록
-- expect: folder item constraints hash = 기록
-- expect: folder item columns hash = 기록
-- expect: folder item owner RLS grants hash = 기록
-- expect: folder item policies hash = 기록
-- expect: folder item rows hash (ids only) = 기록
-- expect: before delete trigger names = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261025180000') then '예' else '아니오' end as value
union all select 'previous trash_org_report_db recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261025100000' and name='trash_org_report_db')=1 then '예' else '아니오' end
union all select 'trash RPCs are project-organization-report only',case when (select count(*) from pg_proc where oid in (to_regprocedure('public.app_trash_list(text)'),to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('public.app_trash_purge(text,uuid)'))
  and prosecdef and proconfig=array['search_path=""'] and prosrc like '%public.app_spaces%' and prosrc like '%app_suborganizations%' and prosrc like '%app_meetings%' and prosrc not like '%app_library_folders%')=3 then '예' else '아니오' end
union all select 'new function absent',case when to_regprocedure('private.app_trash_library_folder_before_delete()') is null then '예' else '아니오' end
union all select 'owner check function present',case when to_regprocedure('private.app_is_workspace_owner(uuid)') is not null then '예' else '아니오' end
union all select 'folder deleted columns absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_library_folders') and attname in ('deleted_at','deleted_root_id') and not attisdropped) then '예' else '아니오' end
union all select 'folder trash constraint trigger policy index absent',case when not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_library_folders') and conname='app_library_folders_trash_pair_check')
  and not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and tgname='app_library_folders_a_trash_before_delete')
  and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_library_folders') and polname='app_library_folders_trash_hidden')
  and to_regclass('public.app_library_folders_trash_idx') is null then '예' else '아니오' end
union all select 'folder columns present',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_library_folders') and not attisdropped and ((attname in ('id','workspace_id','project_id','parent_id') and atttypid='uuid'::regtype) or (attname='name' and atttypid='text'::regtype)))=5 then '예' else '아니오' end
union all select 'folder item columns present',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_library_folder_items') and not attisdropped and attname in ('document_id','folder_id','workspace_id') and atttypid='uuid'::regtype)=3 then '예' else '아니오' end
union all select 'existing folder guard and lift triggers present',case when (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and not tgisinternal and tgenabled='O' and tgname in ('app_library_folders_tree_guard','app_library_folders_lift_on_delete'))=2 then '예' else '아니오' end
union all select 'RLS enabled and not forced on folders',case when (select count(*) from pg_class where oid=to_regclass('public.app_library_folders') and relrowsecurity and not relforcerowsecurity)=1 then '예' else '아니오' end
union all select 'postgres owns or bypasses RLS on folders',case when (select count(*) from pg_class c join pg_roles r on r.rolname='postgres' and (r.rolbypassrls or r.oid=c.relowner) where c.oid=to_regclass('public.app_library_folders'))=1 then '예' else '아니오' end
union all select 'no earlier before delete trigger',case when not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.app_library_folders') and not t.tgisinternal and (t.tgtype & 1)=1 and (t.tgtype & 2)=2 and (t.tgtype & 8)=8 and convert_to(t.tgname::text,'UTF8') < convert_to('app_library_folders_a_trash_before_delete','UTF8')) then '예' else '아니오' end
union all select 'folder row count',count(*)::text from public.app_library_folders
union all select 'folder item row count',count(*)::text from public.app_library_folder_items
union all select 'folder foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_library_folders') group by confdeltype) f),'')
union all select 'folder item foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_library_folder_items') group by confdeltype) f),'')
union all select 'folder triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and not tgisinternal),'')
union all select 'folder constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_library_folders')),''))
union all select 'folder columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_library_folders') and attnum>0 and not attisdropped and attname not in ('deleted_at','deleted_root_id')),''))
union all select 'folder owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_library_folders')),''))
union all select 'folder policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_library_folders') and polname<>'app_library_folders_trash_hidden'),''))
union all select 'folder rows hash (ids only)',md5(coalesce((select string_agg(id::text,',' order by id) from public.app_library_folders),''))
union all select 'folder service_role select (table level)',has_table_privilege('service_role','public.app_library_folders','select')::text
union all select 'folder item constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_library_folder_items')),''))
union all select 'folder item columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_library_folder_items') and attnum>0 and not attisdropped),''))
union all select 'folder item owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_library_folder_items')),''))
union all select 'folder item policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_library_folder_items')),''))
union all select 'folder item rows hash (ids only)',md5(coalesce((select string_agg(document_id::text,',' order by document_id) from public.app_library_folder_items),''))
union all select 'before delete trigger names',coalesce((select string_agg(c.relname||'.'||t.tgname,', ' order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_library_folder_items')) and not t.tgisinternal and (t.tgtype & 1)=1 and (t.tgtype & 2)=2 and (t.tgtype & 8)=8),'')
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
