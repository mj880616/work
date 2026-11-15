-- CANDIDATE ONLY. Never run while any Edge still issues or consumes v2.
-- Stop issuance/consumption, wait at least 6 minutes and drain in-flight calls.
-- Obtain separate production approval before executing this file.
begin;
drop function public.app_consume_auth_handoff(uuid, uuid, timestamptz);
drop table public.app_auth_handoff_consumptions;
-- Remove only this migration record so an approved reapply remains possible.
delete from supabase_migrations.schema_migrations
where version = '20260926154120' and name = 'sec1_auth_handoff_once';
commit;