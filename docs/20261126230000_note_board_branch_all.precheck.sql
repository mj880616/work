-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: 모두 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261126230000') then '예' else '아니오' end as value
union all select 'decor migration recorded',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261125040000' and name='note_board_decor') then '예' else '아니오' end
union all select 'texts table has decor but no parent_note column',case when to_regclass('public.app_note_board_texts') is not null
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_note_board_texts') and attname='ink' and not attisdropped)
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_note_board_texts') and attname='parent_note' and not attisdropped) then '예' else '아니오' end
union all select 'decor check present, parent one check absent',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_note_board_texts') and conname='app_note_board_texts_decor_check' and contype='c')
  and not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_note_board_texts') and conname='app_note_board_texts_parent_one_check') then '예' else '아니오' end
union all select 'notes table present',case when to_regclass('public.app_notes') is not null then '예' else '아니오' end
union all select 'texts policy is the one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_note_board_texts'))=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_note_board_texts') and polname='note_board_texts_owner_all' and polcmd='*' and polroles=array[to_regrole('authenticated')::oid]) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
