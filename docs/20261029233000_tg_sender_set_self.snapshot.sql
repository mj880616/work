-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 이번 함수가 아직 없음과, 이름표 표·기존 이름표 함수의 정의·권한을 기록한다(적용·되돌리기 뒤 대조).
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.oid in(to_regprocedure('public.app_tg_senders_upsert(uuid,text,date,jsonb)'),to_regprocedure('public.app_tg_sender_set_name(text,date,text,text)'),to_regprocedure('public.app_tg_sender_merge(uuid,uuid)'),to_regprocedure('public.app_tg_sender_forget(uuid)'),to_regprocedure('public.app_tg_sender_names_for_day(uuid,text,date)'))
union all select 'new function','public.app_tg_sender_set_self(uuid,boolean)',coalesce(to_regprocedure('public.app_tg_sender_set_self(uuid,boolean)')::text,'absent')
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid in(to_regclass('public.app_tg_senders'),to_regclass('public.app_tg_day_senders'))
union all select 'policy',p.polname::text,p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') from pg_policy p where p.polrelid in(to_regclass('public.app_tg_senders'),to_regclass('public.app_tg_day_senders'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261026190000','20261029233000')
order by 1,2;
