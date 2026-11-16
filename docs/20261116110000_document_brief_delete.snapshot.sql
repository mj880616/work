-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 새 함수가 아직 없음, 표 권한·정책(이름·명령·역할), 이번 기록 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'function' as kind,'public.app_document_brief_delete(uuid)' as name,coalesce(to_regprocedure('public.app_document_brief_delete(uuid)')::text,'absent') as definition
union all select 'table acl','public.app_document_briefs',coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_document_briefs')),'absent')
union all select 'policy',p.polname,p.polcmd::text||' '||array_to_string(array(select rolname from pg_roles where oid=any(p.polroles) order by 1),',')
  from pg_policy p where p.polrelid=to_regclass('public.app_document_briefs')
union all select 'owner function',p.oid::regprocedure::text,p.prosecdef::text
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261116110000'
order by 1,2;
