-- TASK-구현 PR 2 authorization regression (app_notes, app_record_links). All fixtures are rolled back.
-- Run after 20260927103344_task_impl2_notes_record_links.sql on a rehearsal database.

begin;

do $$
declare
  target regclass;
begin
  foreach target in array array['public.app_notes'::regclass, 'public.app_record_links'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = target) then
      raise exception 'RLS disabled: %', target;
    end if;
    if has_table_privilege('anon', target, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'anon has a privilege on %', target;
    end if;
    if not has_table_privilege('authenticated', target, 'SELECT')
       or not has_table_privilege('authenticated', target, 'INSERT')
       or not has_table_privilege('authenticated', target, 'UPDATE')
       or not has_table_privilege('authenticated', target, 'DELETE') then
      raise exception 'authenticated CRUD grant missing on %', target;
    end if;
    if has_table_privilege('authenticated', target, 'TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'authenticated has an extra privilege on %', target;
    end if;
    if exists (select 1 from pg_policy where polrelid = target and polroles <> array['authenticated'::regrole]::oid[]) then
      raise exception 'policy on % is not limited to authenticated', target;
    end if;
  end loop;

  if not exists (select 1 from pg_policy where polrelid = 'public.app_notes'::regclass
      and polname = 'notes_owner_all' and pg_get_expr(polqual, polrelid) like '%app_is_workspace_owner(workspace_id)%') then
    raise exception 'app_notes owner policy missing';
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'public.app_record_links'::regclass
      and polname = 'record_links_owner_all'
      and pg_get_expr(polqual, polrelid) like '%app_is_workspace_owner(workspace_id)%'
      and pg_get_expr(polwithcheck, polrelid) like '%app_space_in_workspace(project_id, workspace_id)%') then
    raise exception 'app_record_links owner policy missing';
  end if;
end
$$;

-- A non-owner JWT sees nothing and cannot write.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000dead', true);

do $$
begin
  if exists (select 1 from public.app_record_links) or exists (select 1 from public.app_notes) then
    raise exception 'non-owner can read record links or notes';
  end if;
  begin
    insert into public.app_notes(workspace_id, raw_text)
    select id, 'probe' from public.app_workspaces limit 1;
    if found then raise exception 'non-owner inserted a note'; end if;
  exception when insufficient_privilege then null;
  end;
end
$$;

rollback;
