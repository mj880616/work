-- ORG-쟁의단계 DB (20261024100000) authorization regression. All fixtures are rolled back.
-- Run after the ORG-쟁의단계 migration on a disposable rehearsal database.

begin;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_dispute_stages'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.app_suborganization_dispute_stages'::regclass) then
    raise exception 'RLS disabled on a dispute stage table';
  end if;
  if has_table_privilege('anon', 'public.app_dispute_stages', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_table_privilege('anon', 'public.app_suborganization_dispute_stages', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_table_privilege('authenticated', 'public.app_dispute_stages', 'TRUNCATE,REFERENCES,TRIGGER')
     or has_table_privilege('authenticated', 'public.app_suborganization_dispute_stages', 'UPDATE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'unexpected privilege on a dispute stage table';
  end if;
  if exists (select 1 from pg_policy where polrelid in ('public.app_dispute_stages'::regclass, 'public.app_suborganization_dispute_stages'::regclass)
      and polroles <> array['authenticated'::regrole]::oid[]) then
    raise exception 'dispute stage policy is not authenticated-only';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.app_dispute_stages'::regclass and polname = 'dispute_stages_owner_all' and polpermissive
      and pg_get_expr(polqual, polrelid) like '%app_is_workspace_owner(workspace_id)%'
      and pg_get_expr(polwithcheck, polrelid) like '%app_is_workspace_owner(workspace_id)%') <> 1 then
    raise exception 'stage owner policy missing';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.app_suborganization_dispute_stages'::regclass and polname = 'dispute_stage_history_owner_all' and polpermissive
      and pg_get_expr(polqual, polrelid) like '%app_is_owner_organization(organization_id)%') <> 1 then
    raise exception 'history owner policy missing';
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'public.app_suborganization_dispute_stages'::regclass and polname = 'dispute_stage_history_stage_ws'
      and not polpermissive and polcmd = 'a') or not exists (select 1 from pg_policy where polrelid = 'public.app_dispute_stages'::regclass
      and polname = 'dispute_stages_keep_default_and_used' and not polpermissive and polcmd = 'd') then
    raise exception 'restrictive dispute stage policy missing';
  end if;
  if has_column_privilege('authenticated', 'public.app_dispute_stages', 'is_default', 'UPDATE') then
    raise exception 'default flag must not be editable';
  end if;
  if exists (select 1 from pg_proc where oid = to_regprocedure('public.app_dispute_stage_delete(uuid,boolean)')
      and (prosecdef or proacl is null or proacl::text ~ '(^|[{,])(anon)?=')) then
    raise exception 'delete function must stay invoker with no anon or public execute';
  end if;
  if has_function_privilege('anon', 'public.app_dispute_stage_delete(uuid,boolean)', 'execute') then
    raise exception 'anon can execute the delete function';
  end if;
end
$$;

-- A non-owner JWT sees no stages or history and cannot write.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000dead', true);

do $$
begin
  if exists (select 1 from public.app_dispute_stages) or exists (select 1 from public.app_suborganization_dispute_stages) then
    raise exception 'non-owner can read dispute stages';
  end if;
  begin
    insert into public.app_dispute_stages(workspace_id, name)
    select id, 'probe' from public.app_workspaces limit 1;
    if found then raise exception 'non-owner inserted a stage'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.app_dispute_stages;
    if found then raise exception 'non-owner deleted a stage'; end if;
  end;
end
$$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.app_dispute_stages;
    raise exception 'anon read stages';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.app_suborganization_dispute_stages;
    raise exception 'anon read history';
  exception when insufficient_privilege then null;
  end;
end
$$;

rollback;
