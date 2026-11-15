-- SELECT only. Save before apply. 8천 자를 넘는 검사 정의(app_profiles 화면 기억 등)는 해시·길이로, 정책 식은 해시로 기록한다(snapshot 한 값 상한 8192자). 카탈로그와 migration 기록만 읽는다(표 줄 값 없음).
select 'constraint' as kind,c.conname::text as name,case when length(pg_get_constraintdef(c.oid))>2000 then 'md5:'||md5(pg_get_constraintdef(c.oid))||':length='||length(pg_get_constraintdef(c.oid)) else pg_get_constraintdef(c.oid) end as definition
  from pg_constraint c where c.conrelid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles')) and c.contype='c'
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles'))
union all select 'policy',p.polname::text,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||md5(coalesce(pg_get_expr(p.polqual,p.polrelid),'')) from pg_policy p where p.polrelid in(to_regclass('public.app_push_log'),to_regclass('public.app_profiles'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261101010000','20261101210000','20261105100000','20261105120000')
order by 1,2;
