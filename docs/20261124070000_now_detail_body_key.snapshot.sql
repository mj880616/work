-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 두 표의 칸·제약·정책·권한과 이번 기록이 없음을 남긴다(되돌린 뒤 같은지 대조).
select 'column' as kind,c.relname||'.'||a.attname as name,format_type(a.atttypid,a.atttypmod)||' notnull='||a.attnotnull||' acl='||coalesce(a.attacl::text,'') as definition
  from pg_attribute a join pg_class c on c.oid=a.attrelid
  where a.attrelid in (to_regclass('public.app_news_now_details'),to_regclass('public.app_outside_now_details')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.relname||'.'||k.conname,pg_get_constraintdef(k.oid) from pg_constraint k join pg_class c on c.oid=k.conrelid
  where k.conrelid in (to_regclass('public.app_news_now_details'),to_regclass('public.app_outside_now_details'))
union all select 'policy',c.relname||'.'||p.polname,p.polcmd::text||' '||p.polroles::text||' '||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||' | '||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
  from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in (to_regclass('public.app_news_now_details'),to_regclass('public.app_outside_now_details'))
union all select 'table acl',c.relname,coalesce(c.relacl::text,'')||' rls='||c.relrowsecurity from pg_class c where c.oid in (to_regclass('public.app_news_now_details'),to_regclass('public.app_outside_now_details'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261124070000'
order by 1,2;
