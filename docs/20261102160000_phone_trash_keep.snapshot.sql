-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 표의 칸·제약·인덱스·정책 정의를 기록한다(되돌린 뒤 같은지 대조).
select 'column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then ' not null' else '' end as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_phone_trash_log') and a.attnum>0 and not a.attisdropped
union all select 'constraint',conname::text,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_phone_trash_log')
union all select 'index',indexrelid::regclass::text,pg_get_indexdef(indexrelid) from pg_index where indrelid=to_regclass('public.app_phone_trash_log')
union all select 'policy',polname::text,pg_get_expr(polqual,polrelid) from pg_policy where polrelid=to_regclass('public.app_phone_trash_log')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261102160000'
order by 1,2;
