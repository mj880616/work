-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 해시 4개는 기록만 하고 사후 확인에서 같아야 한다.
-- 'org records table grants for authenticated'가 예여야 새 칸에 따로 권한을 주지 않아도 된다(칸 단위 권한이면 멈춤).
-- expect: org records policies hash = 기록
-- expect: org records table grants hash = 기록
-- expect: org records old column grants hash = 기록
-- expect: org records old constraints hash = 기록
-- expect: org records triggers hash = 기록
with u as (select to_regclass('public.app_suborganization_updates') as p)
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261110190000') then '예' else '아니오' end as value
union all select 'org records raw_text',case when exists(select 1 from pg_attribute,u where attrelid=u.p and attname='raw_text' and not attisdropped) then '예' else '아니오' end
union all select 'private schema',case when exists(select 1 from pg_namespace where nspname='private') then '예' else '아니오' end
union all select 'org records one_line absent',case when not exists(select 1 from pg_attribute,u where attrelid=u.p and attname='one_line' and not attisdropped)
  and not exists(select 1 from pg_constraint where conrelid=(select p from u) and conname='app_suborganization_updates_one_line_check')
  and to_regprocedure('private.app_suborganization_updates_one_line_reset()') is null
  and not exists(select 1 from pg_trigger where tgrelid=(select p from u) and tgname='app_suborganization_updates_one_line_reset') then '예' else '아니오' end
union all select 'org records RLS on and no anon or PUBLIC',case when (select relrowsecurity from pg_class where oid=(select p from u))
  and not exists(select 1 from pg_class where oid=(select p from u) and relacl::text ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from pg_policy where polrelid=(select p from u) and (polroles @> array[0::oid] or polroles @> array[to_regrole('anon')::oid]))
  and (select count(*) from pg_policy where polrelid=(select p from u))>=1 then '예' else '아니오' end
union all select 'org records table grants for authenticated',case when exists(select 1 from pg_class where oid=(select p from u)
  and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*r' and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*a' and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w') then '예' else '아니오' end
union all select 'org records policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select p from u)
union all select 'org records table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select p from u)
union all select 'org records old column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=(select p from u) and attnum>0 and not attisdropped and attname<>'one_line'
union all select 'org records old constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=(select p from u) and conname<>'app_suborganization_updates_one_line_check'
union all select 'org records triggers hash',md5(coalesce(string_agg(tgname||':'||pg_get_triggerdef(oid)||':'||tgenabled::text,',' order by tgname),''))
  from pg_trigger where tgrelid=(select p from u) and not tgisinternal and tgname<>'app_suborganization_updates_one_line_reset';
