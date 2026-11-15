-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다. 긴 정의는 md5·length로만 남긴다.
-- 소식 종류 표의 칸·검사·정책·권한 모양과 이번 기록 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'picks column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'') as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_journal_memorable_picks') and a.attnum>0 and not a.attisdropped
union all select 'picks constraint',c.conname::text,md5(pg_get_constraintdef(c.oid))||':'||length(pg_get_constraintdef(c.oid))::text
  from pg_constraint c where c.conrelid=to_regclass('public.app_journal_memorable_picks')
union all select 'picks policy',p.polname::text,md5(p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p where p.polrelid=to_regclass('public.app_journal_memorable_picks')
union all select 'picks table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid=to_regclass('public.app_journal_memorable_picks')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261112221000'
order by 1,2;
