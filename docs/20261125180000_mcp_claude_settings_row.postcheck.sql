-- SELECT only. 설정 표·운영자 기능 표·Claude 클라이언트 개수와 일치 여부만 읽는다(ID 값은 내지 않음). 적용 뒤 모두 예(해시는 precheck와 같음).
-- expect: history recorded = 예
-- expect: one settings row = 예
-- expect: row on operator workspace, off, not revoked = 예
-- expect: client matches claude client = 예
-- expect: settings policies hash = 기록
-- expect: settings grants hash = 기록
with claude as (select o.id::text as id from auth.oauth_clients o where o.client_name='Claude' and o.deleted_at is null and o.client_type::text='public' and o.redirect_uris='https://claude.ai/api/mcp/auth_callback')
select 'history recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261125180000' and name='mcp_claude_settings_row')=1 then '예' else '아니오' end as value
union all select 'one settings row',case when (select count(*) from public.app_mcp_settings)=1 then '예' else '아니오' end
union all select 'row on operator workspace, off, not revoked',case when (select count(distinct f.workspace_id) from public.app_operator_features f where f.feature = 'calls')=1
  and (select count(*) from public.app_mcp_settings s where not s.enabled and s.revoked_before is null and s.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'calls'))=1 then '예' else '아니오' end
union all select 'client matches claude client',case when (select count(*) from claude)=1
  and (select count(*) from public.app_mcp_settings s where s.allowed_client_id=(select id from claude))=1 then '예' else '아니오' end
union all select 'settings policies hash',md5(coalesce(string_agg(polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_mcp_settings')
union all select 'settings grants hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_mcp_settings')),'')
  ||'|'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_mcp_settings') and a.attacl is not null),''));
