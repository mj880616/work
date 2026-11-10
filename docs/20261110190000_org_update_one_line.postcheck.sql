-- SELECT only. Run after apply. pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 예/아니오 항목은 모두 예. 해시 4개는 precheck의 같은 이름 값과 같아야 한다(정책·표 권한·기존 칸 권한·기존 검사 그대로).
with u as (select to_regclass('public.app_suborganization_updates') as p)
select 'new migration recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261110190000' and name='org_update_one_line')=1 then '예' else '아니오' end as value
union all select 'org records one_line text null',case when exists(select 1 from pg_attribute a,u where a.attrelid=u.p and a.attname='one_line' and a.atttypid='text'::regtype and not a.attnotnull and not a.attisdropped and not a.atthasdef) then '예' else '아니오' end
union all select 'org records one_line check',case when exists(select 1 from pg_constraint where conrelid=(select p from u) and conname='app_suborganization_updates_one_line_check' and contype='c' and convalidated) then '예' else '아니오' end
union all select 'org records one_line no own column grant',case when exists(select 1 from pg_attribute,u where attrelid=u.p and attname='one_line' and attacl is null) then '예' else '아니오' end
union all select 'one_line reset trigger and invoker function without grants',case when exists(select 1 from pg_trigger where tgrelid=(select p from u) and tgname='app_suborganization_updates_one_line_reset' and not tgisinternal and tgenabled='O')
  and exists(select 1 from pg_proc where oid=to_regprocedure('private.app_suborganization_updates_one_line_reset()') and not prosecdef and proconfig @> array['search_path=""'])
  and not has_function_privilege('anon','private.app_suborganization_updates_one_line_reset()','execute')
  and not has_function_privilege('authenticated','private.app_suborganization_updates_one_line_reset()','execute') then '예' else '아니오' end
union all select 'org records RLS on and no anon or PUBLIC',case when (select relrowsecurity from pg_class where oid=(select p from u))
  and not exists(select 1 from pg_class where oid=(select p from u) and relacl::text ~ '(^|[{,])(anon)?=')
  and not has_any_column_privilege('anon',(select p from u),'select,insert,update,references')
  and not exists(select 1 from pg_policy where polrelid=(select p from u) and (polroles @> array[0::oid] or polroles @> array[to_regrole('anon')::oid])) then '예' else '아니오' end
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
