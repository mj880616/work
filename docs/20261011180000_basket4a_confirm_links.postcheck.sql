-- After apply; no injected baseline or NULL placeholders.
with f as (select * from pg_proc where oid=to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'))
select 'function exists' as item,case when exists(select 1 from f) then '예' else '아니오' end as ok
union all select 'SECURITY INVOKER',case when exists(select 1 from f where not prosecdef and prolang=(select oid from pg_language where lanname='plpgsql')) then '예' else '아니오' end
union all select 'empty search_path',case when exists(select 1 from f where proconfig=array['search_path=""']) then '예' else '아니오' end
union all select 'anon cannot execute',case when exists(select 1 from f where not has_function_privilege('anon',oid,'EXECUTE')) then '예' else '아니오' end
union all select 'PUBLIC cannot execute',case when exists(select 1 from f where not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')) then '예' else '아니오' end
union all select 'authenticated can execute',case when exists(select 1 from f where has_function_privilege('authenticated',oid,'EXECUTE')) then '예' else '아니오' end
union all select 'migration recorded',case when (select count(*) from supabase_migrations.schema_migrations where version='20261011180000' and name='basket4a_confirm_links')=1 then '예' else '아니오' end;
