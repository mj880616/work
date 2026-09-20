-- Security-preserving rollback for the narrow public workspace repair.
revoke execute on function public.app_public_workspace_index() from anon;
revoke execute on function public.app_public_project(text) from anon;
revoke execute on function public.app_public_projects_snapshot() from anon;
revoke execute on function public.app_public_workspace_snapshot() from anon;
drop function if exists public.app_public_workspace_index();
