-- 초안(DRAFT) — 읽기 전용 확인 SQL(select만). 폰 경로 C에서 적용 전·후에 SQL Editor로 실행해 캡처한다.

-- 1. 적용 전: 선행 기록·열·정책·트리거·권한 상태 (적용 전 기대: 1 / 0 / true / 1 / 0 / false)
select
  (select count(*) from supabase_migrations.schema_migrations
    where version = '20261013034836' and name = 'basket_photo_ocr_db') as prereq_row,
  (select count(*) from pg_attribute where attrelid = 'public.app_notes'::regclass and not attisdropped
    and attname in ('kind', 'title', 'journal_day')) as new_cols,
  (select relrowsecurity from pg_class where oid = 'public.app_notes'::regclass) as rls_on,
  (select count(*) from pg_policy where polrelid = 'public.app_notes'::regclass) as policies,
  (select count(*) from pg_trigger where tgrelid = 'public.app_notes'::regclass and not tgisinternal) as triggers,
  has_table_privilege('anon', 'public.app_notes', 'select') as anon_select;

-- 2. 종류별 행 수 (적용 후 기대: basket만. 되돌리기 전에는 basket 외 0인지 확인)
select kind, count(*) from public.app_notes group by kind order by kind;

-- 3. 적용 후: 새 검사 조건·색인·기록 행 (기대: 7 / 2 / 1)
select
  (select count(*) from pg_constraint where conrelid = 'public.app_notes'::regclass
    and conname in ('app_notes_kind_check', 'app_notes_title_check', 'app_notes_journal_day_check',
                    'app_notes_work_line_check', 'app_notes_diary_private_check',
                    'app_notes_raw_text_check', 'app_notes_attachments_check')) as constraints,
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'app_notes'
    and indexname in ('app_notes_journal_day_unique', 'app_notes_kind_occurred_idx')) as indexes,
  (select count(*) from supabase_migrations.schema_migrations
    where version = '20261020090000' and name = 'journal_memo_notes_kind') as migration_row;
