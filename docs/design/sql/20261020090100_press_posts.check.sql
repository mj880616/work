-- 초안(DRAFT) — 읽기 전용 확인 SQL(select만). 폰 경로 C·가져오기 대조용. SQL Editor에서 실행·캡처한다.

-- 1. 적용 전 (기대: prereq 1 / table null)
select
  (select count(*) from supabase_migrations.schema_migrations
    where version = '20261013034836' and name = 'basket_photo_ocr_db') as prereq_row,
  to_regclass('public.app_press_posts') as press_table;

-- 2. 적용 후 권한 경계 (기대: true / 1 / false / false / 1)
select
  (select relrowsecurity from pg_class where oid = 'public.app_press_posts'::regclass) as rls_on,
  (select count(*) from pg_policy where polrelid = 'public.app_press_posts'::regclass) as policies,
  has_table_privilege('anon', 'public.app_press_posts', 'select') as anon_select,
  has_table_privilege('anon', 'public.app_press_posts', 'insert') as anon_insert,
  (select count(*) from supabase_migrations.schema_migrations
    where version = '20261020090100' and name = 'press_posts') as migration_row;

-- 3. 가져오기 뒤 대조 (archive.json 기준 기대: 합계 42 = request 16 + release 13 + statement 13,
--    연도 2024 12 · 2025 22 · 2026 8, 첨부 4건. 목록 밖 2건을 넣기로 하면 합계 44)
select kind, count(*) from public.app_press_posts where origin = 'legacy_web1' group by kind order by kind;
select extract(year from published_on)::int as year, count(*) from public.app_press_posts
  where origin = 'legacy_web1' group by 1 order by 1;
select
  count(*) as posts,
  sum(jsonb_array_length(attachments)) as attachments,
  sum(length(body_html)) as html_chars,
  max(length(body_html)) as max_html_chars,
  count(*) filter (where body_html !~* '<h1') as without_h1
from public.app_press_posts where origin = 'legacy_web1';

-- 4. 겹침·빈 값 (기대: 0행)
select legacy_path, count(*) from public.app_press_posts group by legacy_path having count(*) > 1 and legacy_path is not null;
