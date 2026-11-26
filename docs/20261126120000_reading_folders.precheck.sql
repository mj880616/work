-- SELECT only. Aggregates and hashes; no title, address or id. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite recorded 예 / new migration absent 예 / new table absent 예 / folder column absent 예 / workspace column present 예 /
--   RLS on reading items 예 / owner check function 예. 그 밖의 해시는 사후 확인과 같은 값이어야 한다(기록만: 저장한 글 표의 기존 칸·제약·정책·표 권한·트리거는 바뀌지 않는다).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: new table absent = 예
-- expect: folder column absent = 예
-- expect: workspace column present = 예
-- expect: RLS on reading items = 예
-- expect: owner check function = 예
-- expect: reading columns hash = 기록
-- expect: reading constraints hash = 기록
-- expect: reading policies hash = 기록
-- expect: reading table grants hash = 기록
-- expect: reading triggers hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261122100000' and name='reading_items')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261126120000') then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_reading_folders') is null then '예' else '아니오' end
union all select 'folder column absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_reading_items') and attname='folder_id' and not attisdropped) then '예' else '아니오' end
union all select 'workspace column present',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_reading_items') and attname='workspace_id' and atttypid='uuid'::regtype and attnotnull and not attisdropped) then '예' else '아니오' end
union all select 'RLS on reading items',case when exists(select 1 from pg_class where oid=to_regclass('public.app_reading_items') and relrowsecurity) then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'reading columns hash',md5(coalesce(string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=to_regclass('public.app_reading_items') and attnum>0 and not attisdropped and attname<>'folder_id'
union all select 'reading constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_reading_items') and conname<>'app_reading_items_folder_fkey'
union all select 'reading policies hash',md5(coalesce(string_agg(polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_reading_items')
union all select 'reading table grants hash',md5(coalesce((select relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_reading_items')),''))
union all select 'reading triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_reading_items') and not tgisinternal;
