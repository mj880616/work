-- Works after apply (one record + correct column), dry-run/rollback (neither).
-- No injected baseline. Compare precheck hashes/snapshot separately for ACL/RLS/row preservation.
with history as (
  select count(*) as n,count(*) filter(where name='basket2_drive_folder') as named
  from supabase_migrations.schema_migrations where version='20261010180000'
), col as (
  select count(*) as n,count(*) filter(where a.atttypid='text'::regtype and not a.attnotnull and d.adbin is null and a.attacl is null) as valid
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_drive_settings') and a.attname='basket_folder_id' and not a.attisdropped
)
select 'column and history agree' as item,case when (history.n=0 and col.n=0) or
  (history.n=1 and history.named=1 and col.n=1 and col.valid=1) then '예' else '아니오' end as ok from history,col
union all select 'settings table retained',case when to_regclass('public.app_drive_settings') is not null then '예' else '아니오' end;
