-- Applied to Supabase project xmlkxfjeagycwttklxjw on 2026-09-16.
-- The current onboarding flow requires app_request_workspace_access + administrator approval.
-- Keep the legacy function for server-only compatibility, but remove all client execution paths.

revoke execute on function public.app_join_default_team() from public;
revoke execute on function public.app_join_default_team() from anon;
revoke execute on function public.app_join_default_team() from authenticated;
grant execute on function public.app_join_default_team() to service_role;
