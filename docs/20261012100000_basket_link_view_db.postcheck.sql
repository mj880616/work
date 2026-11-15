-- Read-only after apply. Compare row/grant/policy/source hashes with snapshot too.
with state as (select exists(select 1 from supabase_migrations.schema_migrations where version='20261012100000' and name='basket_link_view_db') applied), f as (select * from pg_proc where oid in(to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'),to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)')))
select * from (
select 'both exact RPCs exist' as item,case when (select count(*) from f)=2 then '예' else '아니오' end as ok
union all select 'both invoker fixed path',case when (select count(*) from f where not prosecdef and proconfig=array['search_path=""'] and prolang=(select oid from pg_language where lanname='plpgsql'))=2 then '예' else '아니오' end
union all select 'authenticated only client execute',case when (select count(*) from f where has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))=2 then '예' else '아니오' end
union all select 'nullable text summary',case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='app_record_links' and column_name='summary' and data_type='text' and is_nullable='YES' and column_default is null) then '예' else '아니오' end
union all select 'summary constraint validated',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_summary_check' and convalidated) then '예' else '아니오' end
union all select 'owner RLS remains',case when (select count(*) from pg_class c join pg_policy p on p.polrelid=c.oid where c.relrowsecurity and ((c.oid=to_regclass('public.app_record_links') and p.polname='record_links_owner_all') or (c.oid=to_regclass('public.app_notes') and p.polname='notes_owner_all')))=2 then '예' else '아니오' end
union all select 'migration recorded once',case when (select count(*) from supabase_migrations.schema_migrations where version='20261012100000' and name='basket_link_view_db')=1 then '예' else '아니오' end
) applied_checks where (select applied from state)
union all select 'dry-run prior state preserved',case when
 not exists(select 1 from information_schema.columns where table_schema='public' and table_name='app_record_links' and column_name='summary')
 and to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)') is null
 and exists(select 1 from pg_proc where oid=to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)') and md5(prosrc)='975aff0e6331e41c0dfe7616b87ef252' and not prosecdef and proconfig=array['search_path=""'])
 then '예' else '아니오' end where not (select applied from state);
