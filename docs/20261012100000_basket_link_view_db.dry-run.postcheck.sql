-- Read-only after dry-run: preserve #506's stronger prior RPC/schema check.
-- precheck observations are compared separately; snapshot comparison remains required.
select 'dry-run prior state preserved' as item,case when
 not exists(select 1 from information_schema.columns where table_schema='public' and table_name='app_record_links' and column_name='summary')
 and to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)') is null
 and exists(select 1 from pg_proc where oid=to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)') and md5(prosrc)='975aff0e6331e41c0dfe7616b87ef252' and not prosecdef and proconfig=array['search_path=""'])
 and not exists(select 1 from supabase_migrations.schema_migrations where version='20261012100000')
 then '예' else '아니오' end as ok;
