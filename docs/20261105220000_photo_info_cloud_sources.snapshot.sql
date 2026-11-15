-- SELECT only. Save before apply. 카탈로그와 migration 기록만 읽는다(표 줄 값 없음). 정책 식은 해시로 기록한다(snapshot 한 값 상한 8192자).
select 'constraint' as kind,c.conname::text as name,pg_get_constraintdef(c.oid) as definition
  from pg_constraint c where c.conrelid=to_regclass('public.app_photo_info_edits') and c.contype='c'
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid=to_regclass('public.app_photo_info_edits')
union all select 'policy',p.polname::text,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||md5(coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) from pg_policy p where p.polrelid=to_regclass('public.app_photo_info_edits')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261103140000','20261105220000')
order by 1,2;
