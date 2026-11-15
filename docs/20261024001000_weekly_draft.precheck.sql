-- SELECT only. Aggregates and hashes; no request rows, no draft text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / requests table 예 / draft 칸·검사 0 / RLS 켜짐 예 / anon·PUBLIC·service_role 표·칸 권한 아니오 /
--   authenticated 지우기 권한 아니오 / 소유자 정책 하나(weekly_exec_requests_owner_all) 예 / authenticated는 주·작업공간 칸을 못 바꿈 예.
--   그 밖의 개수·해시는 사후 확인과 같은 값이어야 한다(기록만). 해시는 새 칸(draft·draft_saved_at)과 새 검사를 빼고 계산한다.
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: draft column count = 0
-- expect: draft check count = 0
-- expect: anon or public or service_role table privilege = 아니오
-- expect: anon or public or service_role column privilege = 아니오
-- expect: authenticated delete privilege = 아니오
-- expect: recent migrations = 기록
-- expect: requests rows = 기록
-- expect: other columns hash = 기록
-- expect: other constraints hash = 기록
-- expect: policies count = 기록
-- expect: policies hash = 기록
-- expect: table privileges hash = 기록
-- expect: other column grants hash = 기록
-- expect: triggers count = 기록
-- expect: triggers hash = 기록
-- expect: indexes hash = 기록
with t as (select to_regclass('public.app_weekly_exec_requests') as rel)
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261023140000' and name='weekly_exec_requests')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024001000') then '예' else '아니오' end
union all select 'requests table exists',case when (select rel from t) is not null then '예' else '아니오' end
union all select 'draft column count',(select count(*) from pg_attribute where attrelid=(select rel from t) and attname in ('draft','draft_saved_at') and not attisdropped)::text
union all select 'draft check count',(select count(*) from pg_constraint where connamespace='public'::regnamespace and conname='app_weekly_exec_requests_draft_check')::text
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=(select rel from t) and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public or service_role table privilege',case when exists(select 1 from pg_class where oid=(select rel from t) and relacl::text ~ '(^|[{,])(anon|service_role)?=')
  or has_table_privilege('anon',(select rel from t),'select,insert,update,delete') then '예' else '아니오' end
union all select 'anon or public or service_role column privilege',case when exists(select 1 from pg_attribute where attrelid=(select rel from t) and attacl::text ~ '(^|[{,])(anon|service_role)?=')
  or has_any_column_privilege('anon',(select rel from t),'select,insert,update,references') then '예' else '아니오' end
union all select 'authenticated delete privilege',case when has_table_privilege('authenticated',(select rel from t),'delete') then '예' else '아니오' end
union all select 'one owner policy (current shape)',case when (select count(*) from pg_policy where polrelid=(select rel from t))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_weekly_exec_requests' and policyname='weekly_exec_requests_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'authenticated cannot move a week',case when not has_column_privilege('authenticated',(select rel from t),'week_start','update')
  and not has_column_privilege('authenticated',(select rel from t),'workspace_id','update')
  and has_column_privilege('authenticated',(select rel from t),'items','update') then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r)
union all select 'requests rows',count(*)::text from public.app_weekly_exec_requests
union all select 'other columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped and a.attname not in ('draft','draft_saved_at')),''))
union all select 'other constraints hash',md5(coalesce((select string_agg(c.conname||':'||pg_get_constraintdef(c.oid),',' order by c.conname) from pg_constraint c where c.conrelid=(select rel from t) and c.conname<>'app_weekly_exec_requests_draft_check'),''))
union all select 'policies count',(select count(*) from pg_policy where polrelid=(select rel from t))::text
union all select 'policies hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=(select rel from t)),''))
union all select 'table privileges hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=(select rel from t)),''))
union all select 'other column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped and a.attname not in ('draft','draft_saved_at')),''))
union all select 'triggers count',(select count(*) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal)::text
union all select 'triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal),''))
union all select 'indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=(select rel from t)),''));
