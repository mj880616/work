-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(앱 표의 행 값은 읽지 않는다).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 해시 항목은 기록만 하고 사후 확인에서 같은 이름의 값과 같아야 한다(권한·정책·기존 칸·기존 트리거 그대로).
-- 'folder items insert update by column only'가 예여야 새 칸에 권한이 저절로 생기지 않는다(표 단위 INSERT·UPDATE면 멈춤).
-- expect: folder items policies hash = 기록
-- expect: folder items table grants hash = 기록
-- expect: folder items old column grants hash = 기록
-- expect: folder items old triggers hash = 기록
with i as (select to_regclass('public.app_library_folder_items') as r)
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261126150000') then '예' else '아니오' end as value
union all select 'folder items shape',case when (select r from i) is not null
  and (select count(*) from pg_attribute where attrelid=(select r from i) and attnum>0 and not attisdropped and attname in ('document_id','folder_id','workspace_id') and atttypid='uuid'::regtype)=3 then '예' else '아니오' end
union all select 'moved_at column function trigger absent',case when not exists(select 1 from pg_attribute where attrelid=(select r from i) and not attisdropped and attname='moved_at')
  and to_regprocedure('private.app_library_folder_items_moved_at()') is null
  and not exists(select 1 from pg_trigger where tgrelid=(select r from i) and tgname='app_library_folder_items_moved_at') then '예' else '아니오' end
union all select 'folder items RLS on and no anon or PUBLIC',case when (select relrowsecurity from pg_class where oid=(select r from i))
  and not exists(select 1 from pg_class where oid=(select r from i) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'folder items insert update by column only',case when not has_table_privilege('authenticated','public.app_library_folder_items','insert')
  and not has_table_privilege('authenticated','public.app_library_folder_items','update') then '예' else '아니오' end
union all select 'one policy',case when (select count(*) from pg_policy where polrelid=(select r from i))=1 then '예' else '아니오' end
union all select 'folder items policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select r from i)
union all select 'folder items table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select r from i)
union all select 'folder items old column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=(select r from i) and attnum>0 and not attisdropped and attname<>'moved_at'
union all select 'folder items old triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=(select r from i) and not tgisinternal and tgname<>'app_library_folder_items_moved_at';
