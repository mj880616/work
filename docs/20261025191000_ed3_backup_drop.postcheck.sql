-- SELECT only. After apply: all 예. After rollback: 'backup table absent' 아니오 (empty table is back) and 'migration recorded' 아니오.
-- No text is shown: only yes/no and counts. The backup table is only named through to_regclass.
select 'backup table absent' as item,case when to_regclass('public.app_ed3_text_backups') is null then '예' else '아니오' end as value
union all select 'migration recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261025191000' and name='ed3_backup_drop')=1 then '예' else '아니오' end
union all select 'backup migration record kept',case when (select count(*) from supabase_migrations.schema_migrations where version='20261024190000' and name='ed3_text_backup')=1 then '예' else '아니오' end
union all select 'owner read policy gone',case when not exists(select 1 from pg_policy p join pg_class c on c.oid=p.polrelid where p.polname='ed3_text_backups_owner_read' and c.relname='app_ed3_text_backups') then '예' else '아니오' end
union all select 'original tables present',case when to_regclass('public.app_notes') is not null and to_regclass('public.app_suborganization_updates') is not null
  and to_regclass('public.app_project_progress_updates') is not null then '예' else '아니오' end
-- 원래 표 행 수는 precheck의 같은 이름 값과 같아야 한다(지우기가 원본을 바꾸지 않음).
union all select 'note rows',count(*)::text from public.app_notes where kind='note'
union all select 'basket rows',count(*)::text from public.app_notes where kind='basket'
union all select 'diary rows',count(*)::text from public.app_notes where kind='diary'
union all select 'org update rows',count(*)::text from public.app_suborganization_updates
union all select 'project record rows',count(*)::text from public.app_project_progress_updates;
