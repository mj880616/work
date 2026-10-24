-- SELECT only. Aggregates and hashes; no organization name, stage name or history text. Run before apply (SQL Editor, phone path C) and keep the capture.
-- 읽기 전용 역할에서 돈다: pg_catalog만 읽는다.
-- 적용 전 기대: 앞선 기록 20261024100000 있음, 이번 기록 없음, 끝 날짜 칸·검사 없음, 이력 표 RLS 켜짐·anon/PUBLIC/service_role 권한 없음,
--   정책 정확히 둘(소유자 for all, 넣기 좁히기), authenticated 고치기 권한 없음. 하나라도 다르면 적용하지 않고 멈춘다.
--   그 밖의 행 수·해시는 사후 확인의 같은 이름 항목과 같은 값이어야 한다(해시는 새 칸·새 검사·새 정책을 빼고 계산한다).
-- expect: end date column count = 0
-- expect: end date check count = 0
-- expect: history update privilege = 아니오
-- expect: history rows = 기록
-- expect: stage rows = 기록
-- expect: history other columns hash = 기록
-- expect: history other constraints hash = 기록
-- expect: history other policies hash = 기록
-- expect: history table privileges hash = 기록
-- expect: history other column grants hash = 기록
-- expect: history triggers hash = 기록
-- expect: history indexes hash = 기록
-- expect: recent migrations = 기록
with t as (select to_regclass('public.app_suborganization_dispute_stages') as rel)
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261024100000' and name='org_dispute_stage_db')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024180000') then '예' else '아니오' end
union all select 'history and stage tables exist',case when (select rel from t) is not null and to_regclass('public.app_dispute_stages') is not null then '예' else '아니오' end
union all select 'end date column count',(select count(*) from pg_attribute where attrelid=(select rel from t) and attname='end_date' and not attisdropped)::text
union all select 'end date check count',(select count(*) from pg_constraint where conrelid=(select rel from t) and conname='app_suborganization_dispute_stages_end_date_check')::text
union all select 'RLS enabled on history',case when exists(select 1 from pg_class where oid=(select rel from t) and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public or service_role privilege on history',case when not exists(select 1 from pg_class where oid=(select rel from t) and relacl::text ~ '(^|[{,])(anon|service_role)?=')
  and not exists(select 1 from pg_attribute where attrelid=(select rel from t) and attacl::text ~ '(^|[{,])(anon|service_role)?=')
  and not has_table_privilege('anon',(select rel from t),'select,insert,update,delete')
  and not has_any_column_privilege('anon',(select rel from t),'select,insert,update,references') then '예' else '아니오' end
union all select 'two history policies in the current shape',case when (select count(*) from pg_policy where polrelid=(select rel from t))=2
  and exists(select 1 from pg_policy where polrelid=(select rel from t) and polname='dispute_stage_history_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[] and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_owner_organizationorganization_id')
  and exists(select 1 from pg_policy where polrelid=(select rel from t) and polname='dispute_stage_history_stage_ws' and not polpermissive and polcmd='a'
    and polroles=array['authenticated'::regrole]::oid[]) then '예' else '아니오' end
union all select 'history update privilege',case when has_any_column_privilege('authenticated',(select rel from t),'update') then '예' else '아니오' end
union all select 'history rows',count(*)::text from public.app_suborganization_dispute_stages
union all select 'stage rows',count(*)::text from public.app_dispute_stages
union all select 'history other columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped and a.attname<>'end_date'),''))
union all select 'history other constraints hash',md5(coalesce((select string_agg(c.conname||':'||pg_get_constraintdef(c.oid),',' order by c.conname) from pg_constraint c where c.conrelid=(select rel from t) and c.conname<>'app_suborganization_dispute_stages_end_date_check'),''))
union all select 'history other policies hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=(select rel from t) and p.polname<>'dispute_stage_history_stage_ws_update'),''))
union all select 'history table privileges hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=(select rel from t)),''))
union all select 'history other column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped and a.attname not in ('end_date','stage_id','stage_name','stage_date')),''))
union all select 'history triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal),''))
union all select 'history indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=(select rel from t)),''))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
