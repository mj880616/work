begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_drive_settings in access exclusive mode;
do $$
begin
  if exists (select 1 from public.app_drive_settings where basket_folder_id is not null) then
    raise exception 'BASKET-2 rollback blocked: folder setting already used; stop';
  end if;
end
$$;
alter table public.app_drive_settings drop column basket_folder_id;
delete from supabase_migrations.schema_migrations where version='20261010180000' and name='basket2_drive_folder';
commit;
