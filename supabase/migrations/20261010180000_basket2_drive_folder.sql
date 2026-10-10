begin;
-- Schema only. Existing settings definition is not in repository: inspect precheck/snapshot first.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_drive_settings in access exclusive mode;
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version='20261010120000' and name='basket1_notes_links') <> 1 then
    raise exception 'BASKET-2 prerequisite record differs; stop';
  end if;
  if not exists (select 1 from pg_attribute a
      where a.attrelid=to_regclass('public.app_drive_settings') and a.attname='workspace_id'
        and a.atttypid='uuid'::regtype and a.attnotnull and not a.attisdropped)
     or not exists (select 1 from pg_index i join pg_attribute a
        on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
        where i.indrelid=to_regclass('public.app_drive_settings') and a.attname='workspace_id'
          and i.indisunique and i.indimmediate and i.indisvalid and i.indnkeyatts=1 and i.indpred is null)
     or exists (select 1 from pg_attribute a
        where a.attrelid=to_regclass('public.app_drive_settings') and a.attnum>0 and not a.attisdropped
          and a.attname<>'workspace_id' and a.attnotnull and a.attidentity=''
          and not exists (select 1 from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum)) then
    raise exception 'BASKET-2 settings shape unsupported; inspect precheck and snapshot';
  end if;
end
$$;
alter table public.app_drive_settings add column basket_folder_id text;
insert into supabase_migrations.schema_migrations (version,name,statements)
values ('20261010180000','basket2_drive_folder',array['BASKET-2: nullable basket Drive folder setting only']);
commit;
