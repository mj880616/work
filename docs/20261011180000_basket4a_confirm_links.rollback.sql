begin;
drop function public.app_basket_confirm_links(uuid,timestamptz,jsonb);
delete from supabase_migrations.schema_migrations where version='20261011180000' and name='basket4a_confirm_links';
commit;
