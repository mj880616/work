-- SELECT only. pg_catalog·migration 기록·개수만 읽는다(작업공간·클라이언트 ID 값은 내지 않음). Run before dry-run/apply.
-- 적용 전 기대: 앞 단계 기록 예 / 이번 기록 없음 예 / 설정 행 없음 예 / 운영자 작업공간 1 / 조건 맞는 Claude 클라이언트 1 / redirect_uris text 예.
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: settings rows absent = 예
-- expect: redirect_uris column is text = 예
-- expect: operator workspaces = 1
-- expect: claude public clients = 1
-- expect: settings policies hash = 기록
-- expect: settings grants hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261120090000' and name='mcp_claude_read')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125180000') then '예' else '아니오' end
union all select 'settings rows absent',case when not exists(select 1 from public.app_mcp_settings) then '예' else '아니오' end
union all select 'redirect_uris column is text',case when (select format_type(a.atttypid,a.atttypmod) from pg_attribute a where a.attrelid=to_regclass('auth.oauth_clients') and a.attname='redirect_uris' and a.attnum>0 and not a.attisdropped)='text' then '예' else '아니오' end
union all select 'operator workspaces',(select count(distinct f.workspace_id) from public.app_operator_features f where f.feature = 'calls')::text
union all select 'claude public clients',(select count(*) from auth.oauth_clients c where c.client_name='Claude' and c.deleted_at is null and c.client_type::text='public' and c.redirect_uris='https://claude.ai/api/mcp/auth_callback')::text
union all select 'settings policies hash',md5(coalesce(string_agg(polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_mcp_settings')
union all select 'settings grants hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_mcp_settings')),'')
  ||'|'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_mcp_settings') and a.attacl is not null),''));
