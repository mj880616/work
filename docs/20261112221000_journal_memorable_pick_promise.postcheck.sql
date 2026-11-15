-- SELECT only. Run after apply. pg_catalog·migration 기록·줄 수만 읽는다(줄 내용 없음).
-- 예/아니오 항목은 모두 예. 줄 수·해시 2개는 precheck의 같은 이름 값과 같아야 한다(줄·정책·권한·다른 검사 그대로).
with u as (select to_regclass('public.app_journal_memorable_picks') as p)
select 'new migration recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261112221000' and name='journal_memorable_pick_promise')=1 then '예' else '아니오' end as value
union all select 'picks kind check six kinds',case when (select count(*) from pg_constraint where conrelid=(select p from u) and conname='app_journal_memorable_picks_kind_check' and contype='c' and convalidated
  and pg_get_constraintdef(oid) like '%''promise''%' and pg_get_constraintdef(oid) like '%''task''%' and pg_get_constraintdef(oid) like '%''area''%')=1 then '예' else '아니오' end
union all select 'picks RLS on and no anon or PUBLIC',case when (select relrowsecurity from pg_class where oid=(select p from u))
  and not exists(select 1 from pg_class where oid=(select p from u) and relacl::text ~ '(^|[{,])(anon)?=')
  and not has_any_column_privilege('anon',(select p from u),'select,insert,update,references')
  and not exists(select 1 from pg_policy where polrelid=(select p from u) and (polroles @> array[0::oid] or polroles @> array[to_regrole('anon')::oid])) then '예' else '아니오' end
union all select 'picks rows',(select count(*)::text from public.app_journal_memorable_picks)
union all select 'picks policies grants hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=(select p from u)),'')
  ||coalesce((select relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=(select p from u)),'')
  ||coalesce((select string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname) from pg_attribute where attrelid=(select p from u) and attnum>0 and not attisdropped),''))
union all select 'picks other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=(select p from u) and conname<>'app_journal_memorable_picks_kind_check';
