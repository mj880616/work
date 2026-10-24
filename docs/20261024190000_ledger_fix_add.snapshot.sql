-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 바뀌는 함수 하나(app_apply_ledger_fix)의 보안·설정·권한·본문 해시, 함께 쓰는 원장 함수들의 같은 값, 원장 표의 RLS·권한, 기록.
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')
    and (p.proname like 'app\_auto\_ledger\_%' or p.proname in('app_apply_ledger_fix','app_undo_ledger_fix','app_is_workspace_owner'))
union all select 'ledger table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none')
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'app\_ledger\_%'
union all select 'ledger policies',c.relname::text,md5(coalesce(string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname),''))
  from pg_class c join pg_policy p on p.polrelid=c.oid where c.relnamespace='public'::regnamespace and c.relname like 'app\_ledger\_%' group by c.relname
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261024120000','20261024190000')
order by 1,2;
