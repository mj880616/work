-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- Schema snapshot of the five existing ledger tables this migration relies on (policies, triggers, owner·RLS·grants, column grants — unchanged except the audit
-- target CHECK value list), the new object names (absent before apply) and the migration history.
select 'policy' as kind,c.relname||'.'||p.polname as name,p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') as definition
  from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit'))
union all select 'trigger',c.relname||'.'||t.tgname,t.tgenabled::text||':'||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid
  where t.tgrelid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit')) and not t.tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none')
  from pg_class where oid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit'))
union all select 'column grants',c.relname||'.'||a.attname,a.attacl::text from pg_attribute a join pg_class c on c.oid=a.attrelid
  where a.attrelid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit')) and a.attacl is not null and not a.attisdropped
union all select 'audit target check',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_ledger_audit') and conname='app_ledger_audit_target_check'
union all select 'table',n,coalesce(to_regclass(n)::text,'absent') from unnest(array['public.app_ledger_auto_runs','public.app_ledger_auto_sources','public.app_ledger_fix_requests','public.app_ledger_record_changes']) n
union all select 'function',n,coalesce(to_regprocedure(n)::text,'absent') from unnest(array['public.app_auto_ledger_begin(uuid)','public.app_auto_ledger_record(uuid,jsonb)','public.app_auto_ledger_undo(uuid)','public.app_apply_ledger_fix(uuid,jsonb,boolean)','public.app_undo_ledger_fix(uuid)','private.app_auto_ledger_personal(text)','private.app_auto_ledger_source(uuid,jsonb)','private.app_auto_ledger_insert(uuid,text,text,text,jsonb)','private.app_auto_ledger_log(uuid,uuid,text,text,uuid,uuid,text,uuid,text,jsonb,text)']) n
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261024120000','20261021190000','20261021082000')
order by 1,2;
