-- Read-only; compare snapshot separately. No source text or identifiers returned.
select 'function absent' as item,case when to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)') is null then '예' else '아니오' end as value
union all select 'BASKET-1 prerequisite (=1)',count(*)::text from supabase_migrations.schema_migrations where version='20261010120000' and name='basket1_notes_links'
union all select 'migration absent (=0)',count(*)::text from supabase_migrations.schema_migrations where version='20261011180000'
union all select 'notes owner RLS',case when exists(select 1 from pg_class c join pg_policy p on p.polrelid=c.oid where c.oid=to_regclass('public.app_notes') and c.relrowsecurity and p.polname='notes_owner_all') then '예' else '아니오' end
union all select 'links owner RLS',case when exists(select 1 from pg_class c join pg_policy p on p.polrelid=c.oid where c.oid=to_regclass('public.app_record_links') and c.relrowsecurity and p.polname='record_links_owner_all') then '예' else '아니오' end
union all select 'notes rows',count(*)::text from public.app_notes
union all select 'links rows',count(*)::text from public.app_record_links;
