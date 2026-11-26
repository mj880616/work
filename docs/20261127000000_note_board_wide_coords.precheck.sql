-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음 — 범위 밖 행 개수만).
-- 적용 전 기대: 모두 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261127000000') then '예' else '아니오' end as value
union all select 'free lines migration recorded',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261125040100' and name='note_board_free_lines') then '예' else '아니오' end
union all select 'texts place check is the old 0..100000',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_note_board_texts') and conname='app_note_board_texts_place_check' and contype='c'
  and pg_get_constraintdef(oid) like '%100000%' and pg_get_constraintdef(oid) not like '%-1000000%') then '예' else '아니오' end
union all select 'links point check present',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_note_board_links') and conname='app_note_board_links_point_check' and contype='c') then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
