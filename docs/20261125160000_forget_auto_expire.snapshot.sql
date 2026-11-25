-- SELECT only. Save before apply. System catalogs, cron 예약(이름·시각·켜짐·명령 해시만) and the migration history only (no app table rows).
select 'column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_todo_candidates') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conname::text,md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid=to_regclass('public.app_todo_candidates')
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid=to_regclass('public.app_todo_candidates')
union all select 'policy',p.polname::text,md5(p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) from pg_policy p where p.polrelid=to_regclass('public.app_todo_candidates')
union all select 'trigger',t.tgname::text,md5(pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid=to_regclass('public.app_todo_candidates') and not t.tgisinternal
union all select 'function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('app_todo_candidate_from_telegram','app_todo_candidate_from_telegram_at','app_todo_candidate_from_telegram_ask','app_todo_tg_open_asks_peer','app_todo_tg_auto_done','app_forget_auto_expire')
union all select 'cron job',jobname,schedule||':active='||active::text||':cmd_md5='||md5(command)||':user='||username from cron.job
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261125120000','20261125160000')
order by 1,2;
