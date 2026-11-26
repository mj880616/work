-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 두 표의 검사(제약) 정의와 이번 기록이 없음을 남긴다(되돌린 뒤 같은지 대조).
select 'constraint' as kind,c.conrelid::regclass::text||'.'||c.conname as name,pg_get_constraintdef(c.oid) as definition
  from pg_constraint c where c.conrelid in (to_regclass('public.app_note_board_texts'),to_regclass('public.app_note_board_links')) and c.contype='c'
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261127000000'
order by 1,2;
