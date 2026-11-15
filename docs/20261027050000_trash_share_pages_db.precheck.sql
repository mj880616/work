-- SELECT only. Run before apply (SQL Editor, phone path C, or approved DB workflow). Aggregates only; no page titles, ids or row values.
-- 적용 전 기대: 아래 예/아니오 항목은 모두 예. 숫자·해시·목록 항목은 사후 확인과 비교용으로 캡처만 한다(기록).
-- read_only 요청은 실행 역할이 postgres가 아닐 수 있으므로 current_user 대신 postgres 역할을 명시해 확인한다.
-- read_only 요청은 표 소유자가 아닌 역할로 돈다. information_schema.check_constraints는 소유자 기준으로 행을 숨기므로(0행 → 아니오)
-- 상태 검사는 pg_constraint·pg_get_constraintdef로 읽는다(2026-10-27 run #89 사전 확인 멈춤 보정, docs/ops-db-workflow.md 사전·사후 확인 절).
-- expect: page row count = 기록
-- expect: page foreign keys in by action = 기록
-- expect: page triggers = 기록
-- expect: page constraints hash = 기록
-- expect: page columns hash = 기록
-- expect: page owner RLS grants hash = 기록
-- expect: page column grants hash = 기록
-- expect: page policies hash = 기록
-- expect: page rows hash (ids only) = 기록
-- expect: link row count = 기록
-- expect: link policies hash = 기록
-- expect: media row count = 기록
-- expect: media policies hash = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261027050000') then '예' else '아니오' end as value
union all select 'previous trash_notes_db recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261026100000' and name='trash_notes_db')=1 then '예' else '아니오' end
union all select 'share pages archived status recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261023160000' and name='share_pages_archived_status')=1 then '예' else '아니오' end
union all select 'trash RPCs know notes but not share pages',case when (select count(*) from pg_proc where oid in (to_regprocedure('public.app_trash_list(text)'),to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('public.app_trash_purge(text,uuid)'))
  and prosecdef and proconfig=array['search_path=""'] and prosrc like '%public.app_spaces%' and prosrc like '%app_suborganizations%' and prosrc like '%app_meetings%' and prosrc like '%app_library_folders%' and prosrc like '%app_notes%' and prosrc not like '%app_share_pages%')=3 then '예' else '아니오' end
union all select 'new function absent',case when to_regprocedure('private.app_trash_share_page_before_delete()') is null then '예' else '아니오' end
union all select 'owner check function present',case when to_regprocedure('private.app_is_workspace_owner(uuid)') is not null then '예' else '아니오' end
union all select 'page deleted columns absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_share_pages') and attname in ('deleted_at','deleted_status') and not attisdropped) then '예' else '아니오' end
union all select 'page trash trigger policy index constraint absent',case when not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_share_pages') and tgname='app_share_pages_a_trash_before_delete')
  and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_share_pages') and polname='app_share_pages_trash_hidden')
  and not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_share_pages') and conname='app_share_pages_trash_check')
  and to_regclass('public.app_share_pages_trash_idx') is null then '예' else '아니오' end
union all select 'page columns present',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_share_pages') and not attisdropped and ((attname in ('id','workspace_id') and atttypid='uuid'::regtype) or (attname in ('title','status') and atttypid='text'::regtype) or (attname='updated_at' and atttypid='timestamptz'::regtype)))=5 then '예' else '아니오' end
union all select 'links and media cascade from pages',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_share_page_links') and contype='f' and confrelid=to_regclass('public.app_share_pages') and confdeltype='c')=1
  and (select count(*) from pg_constraint where conrelid=to_regclass('public.app_share_page_media') and contype='f' and confrelid=to_regclass('public.app_share_pages') and confdeltype='c')=1 then '예' else '아니오' end
union all select 'no user triggers and one owner policy on pages',case when not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_share_pages') and not tgisinternal) and (select count(*) from pg_policy where polrelid=to_regclass('public.app_share_pages'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_share_pages') and polname='share_pages_owner_all' and polpermissive)=1 then '예' else '아니오' end
union all select 'status check allows draft published archived',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_share_pages') and conname='app_share_pages_status_check' and contype='c' and convalidated and pg_get_constraintdef(oid) ~ 'draft' and pg_get_constraintdef(oid) ~ 'published' and pg_get_constraintdef(oid) ~ 'archived')=1 then '예' else '아니오' end
union all select 'RLS enabled and not forced on pages',case when (select count(*) from pg_class where oid=to_regclass('public.app_share_pages') and relrowsecurity and not relforcerowsecurity)=1 then '예' else '아니오' end
union all select 'postgres owns or bypasses RLS on pages',case when (select count(*) from pg_class c join pg_roles r on r.rolname='postgres' and (r.rolbypassrls or r.oid=c.relowner) where c.oid=to_regclass('public.app_share_pages'))=1 then '예' else '아니오' end
union all select 'page row count',count(*)::text from public.app_share_pages
union all select 'page foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_share_pages') group by confdeltype) f),'')
union all select 'page triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_share_pages') and not tgisinternal),'')
union all select 'page constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_share_pages')),''))
union all select 'page columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_share_pages') and attnum>0 and not attisdropped),''))
union all select 'page owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_share_pages')),''))
union all select 'page column grants hash',md5(coalesce((select string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname) from pg_attribute where attrelid=to_regclass('public.app_share_pages') and attnum>0 and not attisdropped and attname not in ('deleted_at','deleted_status')),''))
union all select 'page policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_share_pages')),''))
union all select 'page rows hash (ids only)',md5(coalesce((select string_agg(id::text,',' order by id) from public.app_share_pages),''))
union all select 'link row count',count(*)::text from public.app_share_page_links
union all select 'link policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_share_page_links')),''))
union all select 'media row count',count(*)::text from public.app_share_page_media
union all select 'media policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_share_page_media')),''))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
