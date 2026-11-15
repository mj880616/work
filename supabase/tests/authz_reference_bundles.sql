-- REF-참고묶음 DB (20261023231500) authorization regression. All fixtures are rolled back.
-- Run after the REF-참고묶음 migration on a disposable rehearsal database.

begin;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_reference_bundles'::regclass) then
    raise exception 'RLS disabled on app_reference_bundles';
  end if;
  if has_table_privilege('anon', 'public.app_reference_bundles', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_table_privilege('authenticated', 'public.app_reference_bundles', 'TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'unexpected privilege on app_reference_bundles';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.app_reference_bundles'::regclass
      and (polroles <> array['authenticated'::regrole]::oid[] or not polpermissive)) then
    raise exception 'bundle policy is not an authenticated permissive policy';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.app_reference_bundles'::regclass
      and polname = 'reference_bundles_owner_all'
      and pg_get_expr(polqual, polrelid) like '%app_is_workspace_owner(workspace_id)%'
      and pg_get_expr(polwithcheck, polrelid) like '%app_is_workspace_owner(workspace_id)%') <> 1 then
    raise exception 'bundle owner policy missing';
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'public.app_record_links'::regclass
      and polname = 'record_links_bundle_ws' and not polpermissive
      and pg_get_expr(polwithcheck, polrelid) like '%app_reference_bundles%') then
    raise exception 'restrictive bundle workspace policy missing';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.app_record_links'::regclass and polname = 'record_links_owner_all'
      and pg_get_expr(polqual, polrelid) not like '%app_is_workspace_owner(workspace_id)%') then
    raise exception 'record links owner policy weakened';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.app_record_links'::regclass
      and conname = 'app_record_links_bundle_id_fkey' and confdeltype = 'r') then
    raise exception 'bundle FK must be on delete restrict';
  end if;
  if exists (select 1 from pg_proc where oid in (to_regprocedure('public.app_basket_confirm_links(uuid,timestamptz,jsonb)'),
        to_regprocedure('public.app_basket_update_link_summary(uuid,text,text)'))
      and (prosecdef or proacl is null or proacl::text ~ '(^|[{,])(anon)?=')) then
    raise exception 'widened functions must stay invoker with no anon or public execute';
  end if;
  if has_function_privilege('anon', 'public.app_basket_confirm_links(uuid,timestamptz,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.app_basket_update_link_summary(uuid,text,text)', 'execute') then
    raise exception 'anon can execute a widened function';
  end if;
end
$$;

-- A non-owner JWT sees no bundles and cannot write.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000dead', true);

do $$
begin
  if exists (select 1 from public.app_reference_bundles) then
    raise exception 'non-owner can read bundles';
  end if;
  begin
    insert into public.app_reference_bundles(workspace_id, name)
    select id, 'probe' from public.app_workspaces limit 1;
    if found then raise exception 'non-owner inserted a bundle'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.app_reference_bundles;
    if found then raise exception 'non-owner deleted a bundle'; end if;
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.app_reference_bundles;
    raise exception 'anon read bundles';
  exception when insufficient_privilege then null;
  end;
end
$$;

rollback;
