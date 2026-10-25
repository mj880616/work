-- SELECT only. Run before apply. Counts and yes/no only; no note, record or organization text.
-- 적용 전 기대: new migration absent 예 / backup migration recorded 예 / backup table present 예 / one owner read policy 예 /
--   no foreign key to the table 예 / no view on the table 예 / no function mentions the table 예 / original tables present 예.
-- 백업 행 수는 기록만(지우는 행 수. 되돌릴 수 없음). 원래 표 행 수도 기록하고 사후 확인에서 같아야 한다.
-- expect: recent migrations = 기록
-- expect: backup rows = 기록
-- expect: note rows = 기록
-- expect: basket rows = 기록
-- expect: diary rows = 기록
-- expect: org update rows = 기록
-- expect: project record rows = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261025190000') then '예' else '아니오' end as value
union all select 'backup migration recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261024190000' and name='ed3_text_backup')=1 then '예' else '아니오' end
union all select 'backup table present',case when to_regclass('public.app_ed3_text_backups') is not null then '예' else '아니오' end
union all select 'one owner read policy',case when to_regclass('public.app_ed3_text_backups') is not null
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_ed3_text_backups'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_ed3_text_backups') and polname='ed3_text_backups_owner_read')=1 then '예' else '아니오' end
union all select 'no foreign key to the table',case when not exists(select 1 from pg_constraint where confrelid=to_regclass('public.app_ed3_text_backups')) then '예' else '아니오' end
union all select 'no view on the table',case when not exists(select 1 from pg_depend d join pg_rewrite r on r.oid=d.objid and d.classid='pg_rewrite'::regclass
  where d.refobjid=to_regclass('public.app_ed3_text_backups') and r.ev_class<>d.refobjid) then '예' else '아니오' end
union all select 'no function mentions the table',case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prosrc like '%app_ed3_text_backups%') then '예' else '아니오' end
union all select 'original tables present',case when to_regclass('public.app_notes') is not null and to_regclass('public.app_suborganization_updates') is not null
  and to_regclass('public.app_project_progress_updates') is not null then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r)
union all select 'backup rows',coalesce((select count(*)::text from public.app_ed3_text_backups),'table absent')
union all select 'note rows',count(*)::text from public.app_notes where kind='note'
union all select 'basket rows',count(*)::text from public.app_notes where kind='basket'
union all select 'diary rows',count(*)::text from public.app_notes where kind='diary'
union all select 'org update rows',count(*)::text from public.app_suborganization_updates
union all select 'project record rows',count(*)::text from public.app_project_progress_updates;
