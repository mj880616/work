-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.oid=to_regprocedure('public.app_todo_candidate_from_telegram(uuid,text,text,text,date)')
union all select 'constraint',c.conname::text,pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid=to_regclass('public.app_todo_candidates')
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid=to_regclass('public.app_todo_candidates')
union all select 'policy',p.polname::text,p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') from pg_policy p where p.polrelid=to_regclass('public.app_todo_candidates')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261021075034','20261029120000')
order by 1,2;
