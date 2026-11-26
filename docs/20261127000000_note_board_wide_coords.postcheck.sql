-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록이 없으면 옛 범위, 있으면 새 범위).
with history as (select count(*) filter(where name='note_board_wide_coords') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261127000000'),
place as (select count(*) as n from pg_constraint where conrelid=to_regclass('public.app_note_board_texts') and conname='app_note_board_texts_place_check' and pg_get_constraintdef(oid) like '%-1000000%'),
point as (select count(*) as n from pg_constraint where conrelid=to_regclass('public.app_note_board_links') and conname='app_note_board_links_point_check' and pg_get_constraintdef(oid) like '%-1000000%')
select 'checks and history agree' as item,case when (history.n=0 and place.n=0 and point.n=0) or (history.n=1 and history.named=1 and place.n=1 and point.n=1) then '예' else '아니오' end as ok
  from history,place,point
union all select 'both tables keep their checks',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_note_board_texts') and conname='app_note_board_texts_place_check')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_note_board_links') and conname='app_note_board_links_point_check') then '예' else '아니오' end
union all select 'RLS on, no triggers, anon nothing',case when (select bool_and(relrowsecurity) from pg_class where oid in (to_regclass('public.app_note_board_texts'),to_regclass('public.app_note_board_links')))
  and not exists(select 1 from pg_trigger where tgrelid in (to_regclass('public.app_note_board_texts'),to_regclass('public.app_note_board_links')) and not tgisinternal)
  and not has_table_privilege('anon',to_regclass('public.app_note_board_texts'),'select,insert,update,delete')
  and not has_table_privilege('anon',to_regclass('public.app_note_board_links'),'select,insert,update,delete') then '예' else '아니오' end;
