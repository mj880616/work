-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- app_push_log의 칸·검사 제약·색인·정책 정의를 기록한다(되돌린 뒤 같은지 대조).
select 'column' as kind,attname::text as name,format_type(atttypid,atttypmod) as definition
  from pg_attribute where attrelid='public.app_push_log'::regclass and attnum>0 and not attisdropped
union all select 'constraint',conname::text,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.app_push_log'::regclass
union all select 'index',indexrelid::regclass::text,pg_get_indexdef(indexrelid) from pg_index where indrelid='public.app_push_log'::regclass
union all select 'policy',polname::text,polcmd::text||' '||pg_get_expr(polqual,polrelid) from pg_policy where polrelid='public.app_push_log'::regclass
union all select 'acl','public.app_push_log',coalesce((select relacl::text from pg_class where oid='public.app_push_log'::regclass),'')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261101210000'
order by 1,2;
