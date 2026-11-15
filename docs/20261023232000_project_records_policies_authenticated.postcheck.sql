-- SELECT only. Works after apply (record 1행 + 정책 4개 모두 authenticated) and after rollback (기록 없음 + 정책 4개 모두 PUBLIC).
-- 해시 항목은 precheck의 같은 이름 항목과 같아야 한다: 정책 이름·명령·permissive·조건식, 표·열 권한, 칸, 제약, 트리거, 인덱스, 행 수가 그대로다.
with t(rel) as (values (to_regclass('public.app_project_progress_updates'))),
history as (
  select count(*) as n,count(*) filter(where name='project_records_policies_authenticated') as named
  from supabase_migrations.schema_migrations where version='20261023232000'
), pol as (
  select count(*) as n,
    count(*) filter(where p.polroles=array['authenticated'::regrole::oid]) as auth_only,
    count(*) filter(where p.polroles=array[0::oid]) as public_only
  from t join pg_policy p on p.polrelid=t.rel
)
select 'policy roles and history agree' as item,case when
  (history.n=1 and history.named=1 and pol.n=4 and pol.auth_only=4)
  or (history.n=0 and pol.n=4 and pol.public_only=4) then '예' else '아니오' end as value
  from history,pol
union all select 'no anon policy',case when not exists(select 1 from t join pg_policy p on p.polrelid=t.rel where 'anon'::regrole::oid=any(p.polroles)) then '예' else '아니오' end
union all select 'RLS enabled and not forced',case when exists(select 1 from t join pg_class c on c.oid=t.rel and c.relrowsecurity and not c.relforcerowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not exists(select 1 from t join pg_class c on c.oid=t.rel where c.relacl::text ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from t where has_table_privilege('anon',t.rel,'select') or has_table_privilege('anon',t.rel,'insert') or has_table_privilege('anon',t.rel,'update') or has_table_privilege('anon',t.rel,'delete')) then '예' else '아니오' end
union all select 'rows',(select count(*) from public.app_project_progress_updates)::text
union all select 'policy conditions hash',md5(coalesce((select string_agg(p.polname::text||':'||p.polcmd::text||':'||p.polpermissive::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from t join pg_policy p on p.polrelid=t.rel),''))
union all select 'policy names hash',md5(coalesce((select string_agg(p.polname::text,',' order by p.polname) from t join pg_policy p on p.polrelid=t.rel),''))
union all select 'owner RLS grants hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from t join pg_class c on c.oid=t.rel),''))
union all select 'column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from t join pg_attribute a on a.attrelid=t.rel and a.attnum>0 and not a.attisdropped),''))
union all select 'columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attname) from t join pg_attribute a on a.attrelid=t.rel and a.attnum>0 and not a.attisdropped),''))
union all select 'constraints hash',md5(coalesce((select string_agg(c.conname||':'||pg_get_constraintdef(c.oid),',' order by c.conname) from t join pg_constraint c on c.conrelid=t.rel),''))
union all select 'triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from t join pg_trigger g on g.tgrelid=t.rel and not g.tgisinternal),''))
union all select 'indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from t join pg_index x on x.indrelid=t.rel join pg_class ic on ic.oid=x.indexrelid),''));
