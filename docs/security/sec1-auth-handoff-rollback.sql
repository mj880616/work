-- DRAFT ONLY. Not a production rollback instruction until an applied migration
-- exists. Do not remove the ledger while any function still accepts its tokens.
-- First stop v2 issuance/consumption, wait >= 5 minutes + 1 minute clock margin,
-- and obtain explicit approval. Dropping early would erase replay protection.
begin;
drop function public.app_consume_auth_handoff(uuid, uuid, timestamptz);
drop table public.app_auth_handoff_consumptions;
-- No CASCADE, no changes to existing tables, roles, policies or migration history.
-- Final rollback bookkeeping must refer to the actual approved migration.
rollback;
