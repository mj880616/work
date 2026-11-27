-- SELECT only. 20261127120000_mcp_claude_read_areas 적용 뒤. 카탈로그·migration 기록만 읽는다(행 값 없음).
-- 예/아니오 항목은 모두 예, 해시는 precheck의 같은 이름 항목과 같은 값이어야 한다.
-- expect: history row present = 예
-- expect: five area columns with defaults family off = 예
-- expect: settings update columns only switches = 예
-- expect: log tool check seventeen names = 예
-- expect: gate definer empty path authenticated only with area check = 예
-- expect: locked areas helper definer no execute grants = 예
-- expect: six invoker helpers authenticated only = 예
-- expect: seventeen public read functions invoker empty path authenticated only = 예
-- expect: existing boundary hash = 기록
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261127120000' and name='mcp_claude_read_areas')=1 then '예' else '아니오' end as ok
union all select 'five area columns with defaults family off',case when (select count(*) from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=to_regclass('public.app_mcp_settings') and not a.attisdropped and a.attnotnull and a.atttypid='boolean'::regtype
      and ((a.attname in ('area_diary','area_calls','area_recordings','area_basket') and pg_get_expr(d.adbin,d.adrelid)='true')
        or (a.attname='area_family' and pg_get_expr(d.adbin,d.adrelid)='false')))=5 then '예' else '아니오' end
union all select 'settings update columns only switches',case when (select count(*) from pg_attribute a where a.attrelid=to_regclass('public.app_mcp_settings') and a.attnum>0 and not a.attisdropped
      and has_column_privilege('authenticated',a.attrelid,a.attnum,'update'))=8
  and (select count(*) from pg_attribute a where a.attrelid=to_regclass('public.app_mcp_settings') and a.attnum>0 and not a.attisdropped
      and has_column_privilege('authenticated',a.attrelid,a.attnum,'update')
      and a.attname in ('enabled','revoked_before','updated_at','area_diary','area_calls','area_recordings','area_basket','area_family'))=8
  and not has_any_column_privilege('anon','public.app_mcp_settings','select,insert,update,references')
  and not has_any_column_privilege('service_role','public.app_mcp_settings','select,insert,update,references')
  and not has_any_column_privilege('authenticated','public.app_mcp_settings','insert') then '예' else '아니오' end
union all select 'log tool check seventeen names',case when (select count(*) from pg_constraint c where c.conrelid=to_regclass('public.app_mcp_read_log') and c.conname='app_mcp_read_log_tool_check'
    and pg_get_constraintdef(c.oid) like '%web2_family_get%' and pg_get_constraintdef(c.oid) like '%google_where%'
    and (length(pg_get_constraintdef(c.oid))-length(replace(pg_get_constraintdef(c.oid),'::text','')))/6=17)=1 then '예' else '아니오' end
union all select 'gate definer empty path authenticated only with area check',case when exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.app_mcp_gate(text)') and p.prosecdef
    and p.proconfig=array['search_path=""'] and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')
    and not has_function_privilege('service_role',p.oid,'execute') and not exists(select 1 from aclexplode(p.proacl) x where x.grantee=0)
    and pg_get_functiondef(p.oid) like '%AREA_OFF%' and pg_get_functiondef(p.oid) like '%RATE_LIMITED%' and pg_get_functiondef(p.oid) like '%DISCONNECTED%') then '예' else '아니오' end
union all select 'locked areas helper definer no execute grants',case when exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.app_mcp_locked_areas()') and p.prosecdef
    and p.proconfig=array['search_path=""'] and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')
    and not has_function_privilege('service_role',p.oid,'execute') and not exists(select 1 from aclexplode(p.proacl) x where x.grantee=0)) then '예' else '아니오' end
union all select 'six invoker helpers authenticated only',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
    and p.proname in ('app_mcp_text','app_mcp_page','app_mcp_words','app_mcp_hit','app_mcp_uuid','app_mcp_period') and not p.prosecdef and p.proconfig=array['search_path=""']
    and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
    and not exists(select 1 from aclexplode(p.proacl) x where x.grantee=0))=6 then '예' else '아니오' end
union all select 'seventeen public read functions invoker empty path authenticated only',case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'app\_mcp\_%' and p.proname<>'app_mcp_pre_request')=17
  and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'app\_mcp\_%' and p.proname<>'app_mcp_pre_request'
    and not p.prosecdef and p.proconfig=array['search_path=""'] and has_function_privilege('authenticated',p.oid,'execute')
    and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
    and not exists(select 1 from aclexplode(p.proacl) x where x.grantee=0))=17 then '예' else '아니오' end
union all select 'existing boundary hash',md5(coalesce((select string_agg(p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,''),',' order by p.oid::regprocedure::text) from pg_proc p where p.oid in (to_regprocedure('public.app_mcp_org_status(text)'),to_regprocedure('public.app_mcp_business_reports(date,date,text)'),to_regprocedure('public.app_mcp_project_status(text)'),to_regprocedure('public.app_mcp_ledger_search(text,text,text,date,date,integer)'),to_regprocedure('public.app_mcp_ledger_get(text)'),to_regprocedure('public.app_mcp_notes_search(text,text,integer)'),to_regprocedure('public.app_mcp_google_where()'),to_regprocedure('private.app_mcp_gate_done(text,integer,integer)'),to_regprocedure('private.app_mcp_note_locks()'),to_regprocedure('private.app_mcp_clip(text,integer)'),to_regprocedure('private.app_mcp_arg(text,integer)'),to_regprocedure('private.app_workspace_has_feature(uuid,text)'),to_regprocedure('private.app_is_workspace_owner(uuid)'))),'')||coalesce((select string_agg(c.relname::text||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in (to_regclass('public.app_notes'),to_regclass('public.app_feed_items'),to_regclass('public.app_call_personal'),to_regclass('public.app_call_edits'),to_regclass('public.app_meetings'),to_regclass('public.app_family_notes'),to_regclass('public.app_feature_locks'),to_regclass('public.app_mcp_settings'),to_regclass('public.app_mcp_read_log'),to_regclass('public.app_workspace_members'))),'')||coalesce((select string_agg(p.polrelid::regclass::text||p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polrelid::regclass::text,p.polname) from pg_policy p where p.polrelid in (to_regclass('public.app_notes'),to_regclass('public.app_feed_items'),to_regclass('public.app_call_personal'),to_regclass('public.app_call_edits'),to_regclass('public.app_meetings'),to_regclass('public.app_family_notes'),to_regclass('public.app_feature_locks'),to_regclass('public.app_mcp_settings'),to_regclass('public.app_mcp_read_log'),to_regclass('public.app_workspace_members'))),''));
