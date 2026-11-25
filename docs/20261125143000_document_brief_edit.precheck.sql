-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). Aggregates only; no row values. pg_catalog만 읽는다.
-- 적용 전 기대: 모두 예. recent migrations는 기록만.
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125143000') then '예' else '아니오' end as value
union all select 'briefs migration present',case when (select count(*) from supabase_migrations.schema_migrations where version='20261113220000' and name='document_briefs')=1 then '예' else '아니오' end
union all select 'briefs table',case when to_regclass('public.app_document_briefs') is not null then '예' else '아니오' end
union all select 'new columns absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_document_briefs') and attname in ('edited','edited_at') and not attisdropped) then '예' else '아니오' end
union all select 'owner function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'new function absent',case when to_regprocedure('public.app_document_brief_edit(uuid,jsonb)') is null then '예' else '아니오' end
union all select 'authenticated cannot update briefs',case when not has_table_privilege('authenticated','public.app_document_briefs','update') then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
