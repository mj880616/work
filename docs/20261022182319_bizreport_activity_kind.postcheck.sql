-- SELECT only. Works after apply (record + column + CHECK) and after rollback/dry-run (none of them).
-- The hash/count items must equal the precheck values of the same name (no grant, policy, trigger, index or other column change; no row added or removed).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다(#978).
-- 검사 조건 글자는 PostgreSQL 판에 따라 바깥 괄호가 다를 수 있어 16·17 두 모양만 받는다(#980, 운영은 17).
with history as (
  select count(*) as n,count(*) filter(where name='bizreport_activity_kind') as named from supabase_migrations.schema_migrations where version='20261022182319'
), cols as (
  select count(*) filter(where a.atttypid='text'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='''meeting''::text') as good,count(*) as n
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attname='activity_kind' and not a.attisdropped
), checks as (
  select count(*) as n,count(*) filter(where convalidated and btrim(regexp_replace(pg_get_constraintdef(oid),'\s+',' ','g')) in (
    'CHECK ((activity_kind = ANY (ARRAY[''meeting''::text, ''policy''::text, ''negotiation''::text, ''press''::text, ''assembly''::text, ''struggle''::text, ''education''::text, ''other''::text])))',
    'CHECK (((activity_kind = ANY (ARRAY[''meeting''::text, ''policy''::text, ''negotiation''::text, ''press''::text, ''assembly''::text, ''struggle''::text, ''education''::text, ''other''::text]))))')) as good
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname='app_meetings_activity_kind_check'
)
select 'column check and history agree' as item,case when
  (history.n=0 and cols.n=0 and checks.n=0)
  or (history.n=1 and history.named=1 and cols.n=1 and cols.good=1 and checks.n=1 and checks.good=1) then '예' else '아니오' end as value
  from history,cols,checks
union all select 'every meeting is the meeting kind (or no column)',case when not exists(select 1 from public.app_meetings m
  where to_jsonb(m) ? 'activity_kind' and to_jsonb(m)->>'activity_kind' is distinct from 'meeting') then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relrowsecurity) then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_meetings'))=1 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_meetings','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'meetings rows',count(*)::text from public.app_meetings
union all select 'other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped and a.attname<>'activity_kind'
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname<>'app_meetings_activity_kind_check'
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_meetings'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_meetings')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meetings')
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal;
