-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows, no auth rows).
-- 설정 표의 칸·검사·권한·정책·트리거와 앞 단계·이번 기록을 남긴다(되돌린 뒤 같은지 대조).
select 'column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_mcp_settings') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conname::text,md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid=to_regclass('public.app_mcp_settings')
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid=to_regclass('public.app_mcp_settings')
union all select 'policy',p.polname::text,md5(p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) from pg_policy p where p.polrelid=to_regclass('public.app_mcp_settings')
union all select 'trigger',t.tgname::text,md5(pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid=to_regclass('public.app_mcp_settings') and not t.tgisinternal
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261120090000','20261125180000')
order by 1,2;
