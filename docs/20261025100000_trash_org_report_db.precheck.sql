-- SELECT only. Run before apply (SQL Editor, phone path C, or approved DB workflow). Aggregates only; no organization names, report titles, ids or row values.
-- 적용 전 기대: 아래 예/아니오 항목은 모두 예. 숫자·해시·목록 항목은 사후 확인과 비교용으로 캡처만 한다(기록).
-- read_only 요청은 실행 역할이 postgres가 아닐 수 있으므로 current_user 대신 postgres 역할을 명시해 확인한다.
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: org row count = 기록
-- expect: org foreign keys in by action = 기록
-- expect: org triggers = 기록
-- expect: org constraints hash = 기록
-- expect: org columns hash = 기록
-- expect: org owner RLS grants hash = 기록
-- expect: org policies hash = 기록
-- expect: org rows hash (ids only) = 기록
-- expect: org service_role select (table level) = 기록
-- expect: report row count = 기록
-- expect: report foreign keys in by action = 기록
-- expect: report triggers = 기록
-- expect: report constraints hash = 기록
-- expect: report columns hash = 기록
-- expect: report owner RLS grants hash = 기록
-- expect: report policies hash = 기록
-- expect: report rows hash (ids only) = 기록
-- expect: report service_role select (table level) = 기록
-- expect: before delete trigger names = 기록
-- expect: unique indexes on trash tables = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261025100000') then '예' else '아니오' end as value
union all select 'previous trash_projects_db recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261024193000' and name='trash_projects_db')=1 then '예' else '아니오' end
union all select 'trash RPCs are project-only',case when (select count(*) from pg_proc where oid in (to_regprocedure('public.app_trash_list(text)'),to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('public.app_trash_purge(text,uuid)'))
  and prosecdef and proconfig=array['search_path=""'] and prosrc like '%public.app_spaces%' and prosrc not like '%app_suborganizations%' and prosrc not like '%app_meetings%')=3 then '예' else '아니오' end
union all select 'new functions absent',case when to_regprocedure('private.app_trash_org_before_delete()') is null and to_regprocedure('private.app_trash_report_before_delete()') is null then '예' else '아니오' end
union all select 'owner check function present',case when to_regprocedure('private.app_is_workspace_owner(uuid)') is not null then '예' else '아니오' end
union all select 'org deleted_at absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_suborganizations') and attname='deleted_at' and not attisdropped) then '예' else '아니오' end
union all select 'org trash trigger policy index absent',case when not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_suborganizations') and tgname='app_suborganizations_a_trash_before_delete') and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_suborganizations') and polname='app_suborganizations_trash_hidden') and to_regclass('public.app_suborganizations_trash_idx') is null then '예' else '아니오' end
union all select 'report deleted_at absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname='deleted_at' and not attisdropped) then '예' else '아니오' end
union all select 'report trash trigger policy index absent',case when not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_meetings') and tgname='app_meetings_a_trash_before_delete') and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_meetings') and polname='app_meetings_trash_hidden') and to_regclass('public.app_meetings_trash_idx') is null then '예' else '아니오' end
union all select 'organization columns present',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_suborganizations') and not attisdropped and ((attname in ('id','workspace_id') and atttypid='uuid'::regtype) or (attname='name' and atttypid='text'::regtype)))=3 then '예' else '아니오' end
union all select 'report columns present',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_meetings') and not attisdropped and ((attname in ('id','workspace_id') and atttypid='uuid'::regtype) or (attname in ('title','series_name','activity_kind') and atttypid='text'::regtype) or attname in ('round_no','meeting_at')))=7 then '예' else '아니오' end
union all select 'RLS enabled and not forced on both',case when (select count(*) from pg_class where oid in (to_regclass('public.app_suborganizations'),to_regclass('public.app_meetings')) and relrowsecurity and not relforcerowsecurity)=2 then '예' else '아니오' end
union all select 'postgres owns or bypasses RLS on both',case when (select count(*) from pg_class c join pg_roles r on r.rolname='postgres' and (r.rolbypassrls or r.oid=c.relowner) where c.oid in (to_regclass('public.app_suborganizations'),to_regclass('public.app_meetings')))=2 then '예' else '아니오' end
union all select 'org no earlier before delete trigger',case when not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.app_suborganizations') and not t.tgisinternal and (t.tgtype & 1)=1 and (t.tgtype & 2)=2 and (t.tgtype & 8)=8 and t.tgname collate "C" < 'app_suborganizations_a_trash_before_delete') then '예' else '아니오' end
union all select 'report no earlier before delete trigger',case when not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.app_meetings') and not t.tgisinternal and (t.tgtype & 1)=1 and (t.tgtype & 2)=2 and (t.tgtype & 8)=8 and t.tgname collate "C" < 'app_meetings_a_trash_before_delete') then '예' else '아니오' end
union all select 'org row count',count(*)::text from public.app_suborganizations
union all select 'org foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_suborganizations') group by confdeltype) f),'')
union all select 'org triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_suborganizations') and not tgisinternal),'')
union all select 'org constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_suborganizations')),''))
union all select 'org columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_suborganizations') and attnum>0 and not attisdropped and attname<>'deleted_at'),''))
union all select 'org owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_suborganizations')),''))
union all select 'org policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_suborganizations') and polname<>'app_suborganizations_trash_hidden'),''))
union all select 'org rows hash (ids only)',md5(coalesce((select string_agg(id::text,',' order by id) from public.app_suborganizations),''))
union all select 'org service_role select (table level)',has_table_privilege('service_role','public.app_suborganizations','select')::text
union all select 'report row count',count(*)::text from public.app_meetings
union all select 'report foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_meetings') group by confdeltype) f),'')
union all select 'report triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal),'')
union all select 'report constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_meetings')),''))
union all select 'report columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_meetings') and attnum>0 and not attisdropped and attname<>'deleted_at'),''))
union all select 'report owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_meetings')),''))
union all select 'report policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_meetings') and polname<>'app_meetings_trash_hidden'),''))
union all select 'report rows hash (ids only)',md5(coalesce((select string_agg(id::text,',' order by id) from public.app_meetings),''))
union all select 'report service_role select (table level)',has_table_privilege('service_role','public.app_meetings','select')::text
union all select 'before delete trigger names',coalesce((select string_agg(c.relname||'.'||t.tgname,', ' order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in (to_regclass('public.app_suborganizations'),to_regclass('public.app_meetings')) and not t.tgisinternal and (t.tgtype & 1)=1 and (t.tgtype & 2)=2 and (t.tgtype & 8)=8),'')
union all select 'unique indexes on trash tables',coalesce((select string_agg(c.relname||'.'||i.indexrelid::regclass::text,', ' order by c.relname,i.indexrelid::regclass::text) from pg_index i join pg_class c on c.oid=i.indrelid where i.indrelid in (to_regclass('public.app_suborganizations'),to_regclass('public.app_meetings')) and i.indisunique and not i.indisprimary),'')
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
