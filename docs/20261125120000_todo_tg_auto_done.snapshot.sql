-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 후보 표의 칸·검사·권한·정책·트리거와 텔레그램 후보 관련 함수 정의를 기록한다(되돌린 뒤 같은지 대조).
select 'column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_todo_candidates') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conname::text,md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid=to_regclass('public.app_todo_candidates')
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid=to_regclass('public.app_todo_candidates')
union all select 'policy',p.polname::text,md5(p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) from pg_policy p where p.polrelid=to_regclass('public.app_todo_candidates')
union all select 'trigger',t.tgname::text,md5(pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid=to_regclass('public.app_todo_candidates') and not t.tgisinternal
union all select 'function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('app_todo_candidate_from_telegram','app_todo_candidate_from_telegram_at','app_todo_tg_open_asks','app_todo_tg_auto_done')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261029120000','20261101180000','20261125120000')
order by 1,2;
