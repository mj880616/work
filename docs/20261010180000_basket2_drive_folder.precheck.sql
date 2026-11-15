-- Aggregates only; no folder IDs, account data or token values.
with attrs as (
  select a.*,d.adbin from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_drive_settings') and a.attnum>0 and not a.attisdropped
)
select 'settings table exists' as item, case when to_regclass('public.app_drive_settings') is not null then '예' else '아니오' end as value
union all select 'workspace_id uuid required',case when exists(select 1 from attrs where attname='workspace_id' and atttypid='uuid'::regtype and attnotnull) then '예' else '아니오' end
union all select 'workspace_id unique key',case when exists(select 1 from pg_index i join attrs a on a.attnum=i.indkey[0]
  where i.indrelid=to_regclass('public.app_drive_settings') and a.attname='workspace_id' and i.indisunique and i.indimmediate and i.indisvalid and i.indnkeyatts=1 and i.indpred is null) then '예' else '아니오' end
union all select 'unsupported required columns (=0)',count(*)::text from attrs where attname<>'workspace_id' and attnotnull and attidentity='' and adbin is null
union all select 'basket column count',count(*)::text from attrs where attname='basket_folder_id'
union all select 'settings column count',count(*)::text from attrs
union all select 'settings row count',count(*)::text from public.app_drive_settings
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_drive_settings')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_drive_settings')
union all select 'column grants hash',md5(coalesce(string_agg(attname||coalesce(attacl::text,''),',' order by attname),'')) from attrs where attacl is not null
union all select 'BASKET-1 prerequisite (=1)',count(*)::text from supabase_migrations.schema_migrations where version='20261010120000' and name='basket1_notes_links'
union all select 'BASKET-2 history count',count(*)::text from supabase_migrations.schema_migrations where version='20261010180000';
