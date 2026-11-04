-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수·권한·정책·트리거 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous step applied = 예
-- expect: new table, color and sort_order columns, functions absent = 예
-- expect: owner check function present = 예
-- expect: photo tags RLS on and no anon privilege = 예
-- expect: photo tags rows = 기록
-- expect: photo tags grants policies triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261104223000') then '예' else '아니오' end as value
union all select 'previous step applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261029150000' and name='photo_tags')=1 and to_regclass('public.app_photo_tags') is not null then '예' else '아니오' end
union all select 'new table, color and sort_order columns, functions absent',case when to_regclass('public.app_folder_prefs') is null and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_photo_tags') and attname in('color','sort_order') and not attisdropped) and to_regprocedure('public.app_folder_prefs_apply(uuid,text,jsonb)') is null and to_regprocedure('public.app_photo_tag_look_apply(uuid,jsonb)') is null then '예' else '아니오' end
union all select 'owner check function present',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'photo tags RLS on and no anon privilege',case when exists(select 1 from pg_class where oid=to_regclass('public.app_photo_tags') and relrowsecurity) and not has_any_column_privilege('anon','public.app_photo_tags','select,insert,update,references') then '예' else '아니오' end
union all select 'photo tags rows',(select count(*)::text from public.app_photo_tags)
union all select 'photo tags grants policies triggers hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid=to_regclass('public.app_photo_tags')),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_photo_tags')),'')
  ||coalesce((select string_agg(t.tgname::text||':'||t.tgenabled::text||':'||t.tgfoid::regproc::text,',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_photo_tags') and not t.tgisinternal),''));
