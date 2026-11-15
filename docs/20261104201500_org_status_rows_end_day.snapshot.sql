-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 현황 줄 표의 칸 이름 목록과 검사 이름, 이번 기록 유무를 기록한다(되돌린 뒤 같은지 대조).
select 'column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod) as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_org_status_rows') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conname::text,c.contype::text
  from pg_constraint c where c.conrelid=to_regclass('public.app_org_status_rows')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261104201500'
order by 1,2;
