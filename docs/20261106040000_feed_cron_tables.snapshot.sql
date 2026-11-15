-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다(앱 표를 읽지 않음).
-- 새 표 셋·함수 다섯의 유무와 확장 유무를 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_cron_keys','public.app_feed_runs','public.app_feed_jobs']) n
union all select 'function',f,coalesce(to_regprocedure(f)::text,'absent')
  from unnest(array['private.app_feed_enqueue(text)','private.app_feed_claim(text)','private.app_feed_sent(uuid,bigint)',
    'private.app_feed_settle(bigint,integer,text)','private.app_feed_tidy()']) f
union all select 'extension',e,case when exists(select 1 from pg_catalog.pg_extension x where x.extname=e) then 'present' else 'absent' end
  from unnest(array['pg_cron','pg_net','supabase_vault']) e
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261106040000'
order by 1,2;
