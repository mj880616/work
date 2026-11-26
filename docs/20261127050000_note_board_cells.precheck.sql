-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: 모두 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261127050000') then '예' else '아니오' end as value
union all select 'branch-all migration recorded',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261126230000' and name='note_board_branch_all') then '예' else '아니오' end
union all select 'texts table has parent_note but no cell columns',case when to_regclass('public.app_note_board_texts') is not null
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_note_board_texts') and attname='parent_note' and not attisdropped)
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_note_board_texts') and attname in ('cells','file_doc','file_note','file_drive') and not attisdropped) then '예' else '아니오' end
union all select 'documents table and notes attachments present',case when to_regclass('public.app_documents') is not null
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_notes') and attname='attachments' and atttypid='jsonb'::regtype and not attisdropped) then '예' else '아니오' end
union all select 'mindmap and body checks present, cell checks absent',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_note_board_texts') and conname='app_note_board_texts_mindmap_check' and contype='c')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_note_board_texts') and conname='app_note_board_texts_body_check' and contype='c')
  and not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_note_board_texts') and conname in ('app_note_board_texts_cells_check','app_note_board_texts_file_check')) then '예' else '아니오' end
union all select 'texts policies are the owner policy and the parent-note narrowing policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_note_board_texts'))=2
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_note_board_texts') and polname='note_board_texts_owner_all' and polcmd='*' and polpermissive and polroles=array[to_regrole('authenticated')::oid])
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_note_board_texts') and polname='note_board_texts_parent_note_own' and polcmd='*' and not polpermissive and polroles=array[to_regrole('authenticated')::oid]) then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
