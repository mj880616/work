-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 바뀌는 함수 둘(app_auto_ledger_source·app_auto_ledger_record)의 보안·설정·권한·본문 해시, 함께 쓰는 원장 함수들의 같은 값, 원장 표와 프로필 표의 RLS·권한·정책, 처리 표 종류 CHECK, 기록.
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')
    and (p.proname like 'app\_auto\_ledger\_%' or p.proname in('app_apply_ledger_fix','app_undo_ledger_fix','app_is_workspace_owner'))
union all select 'ledger table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none')
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'app\_ledger\_%'
union all select 'ledger policies',c.relname::text,md5(coalesce(string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname),''))
  from pg_class c join pg_policy p on p.polrelid=c.oid where c.relnamespace='public'::regnamespace and c.relname like 'app\_ledger\_%' group by c.relname
union all select 'profiles table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none')
  from pg_class c where c.oid='public.app_profiles'::regclass
union all select 'profiles policies',c.relname::text,md5(coalesce(string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname),''))
  from pg_class c join pg_policy p on p.polrelid=c.oid where c.oid='public.app_profiles'::regclass group by c.relname
union all select 'profiles columns','app_profiles',md5(coalesce(string_agg(a.attname::text||':'||a.atttypid::text||':'||a.attnotnull::text,',' order by a.attnum),''))
  from pg_attribute a where a.attrelid='public.app_profiles'::regclass and a.attnum>0 and not a.attisdropped
union all select 'kind check',conname::text,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.app_ledger_auto_sources'::regclass and conname='app_ledger_auto_sources_kind_check'
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261024120000','20261025110000')
order by 1,2;
