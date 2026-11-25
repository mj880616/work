-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- app_reading_items의 칸·제약·정책·권한과 이번 기록이 없음을 남긴다(되돌린 뒤 같은지 대조).
select 'column' as kind,a.attname as name,format_type(a.atttypid,a.atttypmod)||' notnull='||a.attnotnull||' acl='||coalesce(a.attacl::text,'') as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_reading_items') and a.attnum>0 and not a.attisdropped
union all select 'constraint',k.conname,pg_get_constraintdef(k.oid) from pg_constraint k where k.conrelid=to_regclass('public.app_reading_items')
union all select 'policy',p.polname,p.polcmd::text||' '||p.polroles::text||' '||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||' | '||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
  from pg_policy p where p.polrelid=to_regclass('public.app_reading_items')
union all select 'table acl','app_reading_items',coalesce(c.relacl::text,'')||' rls='||c.relrowsecurity from pg_class c where c.oid=to_regclass('public.app_reading_items')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261125170000'
order by 1,2;
