-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 새 칸·함수가 아직 없음, 표 권한·칸 권한·정책(이름·명령·역할)·검사 이름, 이번 기록 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'function' as kind,'public.app_document_brief_edit(uuid,jsonb)' as name,coalesce(to_regprocedure('public.app_document_brief_edit(uuid,jsonb)')::text,'absent') as definition
union all select 'table acl','public.app_document_briefs',coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_document_briefs')),'absent')
union all select 'column',a.attname,format_type(a.atttypid,a.atttypmod)||' '||coalesce(a.attacl::text,'-')
  from pg_attribute a where a.attrelid=to_regclass('public.app_document_briefs') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conname,c.contype::text
  from pg_constraint c where c.conrelid=to_regclass('public.app_document_briefs')
union all select 'policy',p.polname,p.polcmd::text||' '||array_to_string(array(select rolname from pg_roles where oid=any(p.polroles) order by 1),',')
  from pg_policy p where p.polrelid=to_regclass('public.app_document_briefs')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261125143000'
order by 1,2;
