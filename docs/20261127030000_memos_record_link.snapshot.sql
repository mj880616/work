-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다(앱 표를 읽지 않음, 종류별 개수는 precheck가 본다).
-- 메모 표의 검사 정의·권한·정책을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_memos']) n
union all select 'constraint',c.conname::text,md5(pg_get_constraintdef(c.oid))
  from pg_constraint c where c.conrelid=to_regclass('public.app_memos')
union all select 'table ACL',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none')
  from pg_class c where c.oid=to_regclass('public.app_memos')
union all select 'column ACL',a.attname::text,coalesce(a.attacl::text,'none')
  from pg_attribute a where a.attrelid=to_regclass('public.app_memos') and a.attnum>0 and not a.attisdropped
union all select 'policy',p.polname::text,md5(coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')||'|'||p.polroles::text||'|'||p.polcmd::text||'|'||p.polpermissive::text)
  from pg_policy p where p.polrelid=to_regclass('public.app_memos')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261127030000'
order by 1,2;
