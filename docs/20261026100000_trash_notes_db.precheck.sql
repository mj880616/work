-- SELECT only. Run before apply (SQL Editor, phone path C, or approved DB workflow). Aggregates only; no note text, titles, ids or row values.
-- 적용 전 기대: 아래 예/아니오 항목은 모두 예. 숫자·해시·목록 항목은 사후 확인과 비교용으로 캡처만 한다(기록).
-- read_only 요청은 실행 역할이 postgres가 아닐 수 있으므로 current_user 대신 postgres 역할을 명시해 확인한다.
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: note row count = 기록
-- expect: note foreign keys in by action = 기록
-- expect: note triggers = 기록
-- expect: note constraints hash = 기록
-- expect: note columns hash = 기록
-- expect: note owner RLS grants hash = 기록
-- expect: note policies hash = 기록
-- expect: note rows hash (ids only) = 기록
-- expect: note service_role select (table level) = 기록
-- expect: link row count = 기록
-- expect: link constraints hash = 기록
-- expect: link policies hash = 기록
-- expect: link rows hash (ids only) = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261026100000') then '예' else '아니오' end as value
union all select 'previous trash_library_folder_db recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261025180000' and name='trash_library_folder_db')=1 then '예' else '아니오' end
union all select 'trash RPCs are project-organization-report-library_folder only',case when (select count(*) from pg_proc where oid in (to_regprocedure('public.app_trash_list(text)'),to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('public.app_trash_purge(text,uuid)'))
  and prosecdef and proconfig=array['search_path=""'] and prosrc like '%public.app_spaces%' and prosrc like '%app_suborganizations%' and prosrc like '%app_meetings%' and prosrc like '%app_library_folders%' and prosrc not like '%app_notes%')=3 then '예' else '아니오' end
union all select 'new function absent',case when to_regprocedure('private.app_trash_note_before_delete()') is null then '예' else '아니오' end
union all select 'owner check function present',case when to_regprocedure('private.app_is_workspace_owner(uuid)') is not null then '예' else '아니오' end
union all select 'note deleted column absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_notes') and attname='deleted_at' and not attisdropped) then '예' else '아니오' end
union all select 'note trash trigger policy index absent',case when not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_notes') and tgname='app_notes_a_trash_before_delete')
  and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_notes') and polname='app_notes_trash_hidden')
  and to_regclass('public.app_notes_trash_idx') is null then '예' else '아니오' end
union all select 'note columns present',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_notes') and not attisdropped and ((attname in ('id','workspace_id') and atttypid='uuid'::regtype) or (attname in ('kind','title','raw_text') and atttypid='text'::regtype) or (attname='attachments' and atttypid='jsonb'::regtype) or (attname='occurred_at' and atttypid='timestamptz'::regtype)))=7 then '예' else '아니오' end
union all select 'link note_id cascades from notes',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_record_links') and contype='f' and confrelid=to_regclass('public.app_notes') and confdeltype='c')=1 then '예' else '아니오' end
union all select 'no user triggers and one owner policy on notes',case when not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_notes') and not tgisinternal) and (select count(*) from pg_policy where polrelid=to_regclass('public.app_notes'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_notes') and polname='notes_owner_all' and polpermissive)=1 then '예' else '아니오' end
union all select 'RLS enabled and not forced on notes',case when (select count(*) from pg_class where oid=to_regclass('public.app_notes') and relrowsecurity and not relforcerowsecurity)=1 then '예' else '아니오' end
union all select 'postgres owns or bypasses RLS on notes',case when (select count(*) from pg_class c join pg_roles r on r.rolname='postgres' and (r.rolbypassrls or r.oid=c.relowner) where c.oid=to_regclass('public.app_notes'))=1 then '예' else '아니오' end
union all select 'note row count',count(*)::text from public.app_notes
union all select 'note foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_notes') group by confdeltype) f),'')
union all select 'note triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_notes') and not tgisinternal),'')
union all select 'note constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_notes')),''))
union all select 'note columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_notes') and attnum>0 and not attisdropped),''))
union all select 'note owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_notes')),''))
union all select 'note policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_notes')),''))
union all select 'note rows hash (ids only)',md5(coalesce((select string_agg(id::text,',' order by id) from public.app_notes),''))
union all select 'note service_role select (table level)',has_table_privilege('service_role','public.app_notes','select')::text
union all select 'link row count',count(*)::text from public.app_record_links
union all select 'link constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_record_links')),''))
union all select 'link policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_record_links')),''))
union all select 'link rows hash (ids only)',md5(coalesce((select string_agg(id::text,',' order by id) from public.app_record_links),''))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
