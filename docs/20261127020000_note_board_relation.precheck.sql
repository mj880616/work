-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: 모두 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261127020000') then '예' else '아니오' end as value
union all select 'free lines migration recorded',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261125040100' and name='note_board_free_lines') then '예' else '아니오' end
union all select 'links table has point ends but no kind',case when to_regclass('public.app_note_board_links') is not null
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_note_board_links') and attname='from_x' and not attisdropped)
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_note_board_links') and attname='kind' and not attisdropped) then '예' else '아니오' end
union all select 'kind check absent',case when not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_note_board_links') and conname='app_note_board_links_kind_check') then '예' else '아니오' end
union all select 'links policy is the one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_note_board_links'))=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_note_board_links') and polname='note_board_links_owner_all' and polcmd='*' and polroles=array[to_regrole('authenticated')::oid]) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
