-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- MCP 함수 정의·권한, 설정 표 칸(이름·형식·기본값·칸 권한), 설정·기록·운영자 기능 표의 검사, 쓰는 표의 권한·정책·트리거, 이번 기록 유무를 남긴다(되돌린 뒤 같은지 대조).
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'') as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname like 'app\_mcp\_%'
union all select 'function',p.oid::regprocedure::text,p.prosecdef::text||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'')
  from pg_proc p where p.oid in (to_regprocedure('private.app_workspace_has_feature(uuid,text)'),to_regprocedure('private.app_is_workspace_owner(uuid)'),to_regprocedure('public.app_trash_restore(text,uuid)'))
union all select 'settings column',a.attname::text,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||':'||coalesce(a.attacl::text,'')
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.app_mcp_settings') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conrelid::regclass::text||'.'||c.conname::text,md5(pg_get_constraintdef(c.oid))
  from pg_constraint c where c.conrelid in (to_regclass('public.app_mcp_settings'),to_regclass('public.app_mcp_read_log'),to_regclass('public.app_operator_features'))
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid in (to_regclass('public.app_notes'),to_regclass('public.app_note_folders'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_spaces'),to_regclass('public.app_business_records'),to_regclass('public.app_operator_features'),to_regclass('public.app_mcp_settings'),to_regclass('public.app_mcp_read_log'),to_regclass('public.app_mcp_write_log'),to_regclass('public.app_mcp_write_before'),to_regclass('public.app_workspace_members'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||md5(coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p where p.polrelid in (to_regclass('public.app_notes'),to_regclass('public.app_note_folders'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_spaces'),to_regclass('public.app_business_records'),to_regclass('public.app_operator_features'),to_regclass('public.app_mcp_settings'),to_regclass('public.app_mcp_read_log'),to_regclass('public.app_workspace_members'))
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname::text,t.tgenabled::text||':'||t.tgfoid::regprocedure::text
  from pg_trigger t where not t.tgisinternal and t.tgrelid in (to_regclass('public.app_notes'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_business_records'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261128100000'
order by 1,2;
