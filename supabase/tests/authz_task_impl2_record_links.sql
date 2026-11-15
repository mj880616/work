-- TASK-구현 PR 2 authorization regression (app_notes, app_record_links). All fixtures are rolled back.
-- Run after the TASK-meeting-followup record-links migration on a disposable rehearsal database.

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
      and pg_get_expr(polwithcheck, polrelid) like '%app_space_in_workspace(project_id, workspace_id)%'
      and pg_get_expr(polwithcheck, polrelid) like '%app_notes n%'
      and pg_get_expr(polwithcheck, polrelid) like '%app_is_workspace_owner(n.workspace_id)%'
      and pg_get_expr(polwithcheck, polrelid) like '%app_meeting_in_workspace(meeting_id, workspace_id)%') then
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

-- Two owners and two meetings are fixture-only; the enclosing transaction rolls back.
reset role;
insert into auth.users(id) values
  ('a1000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002');
insert into public.app_workspaces(id, slug, name) values
  ('a1100000-0000-4000-8000-000000000001', 'authz-meeting-link-a', 'AUTHZ MEETING LINK A'),
  ('a1100000-0000-4000-8000-000000000002', 'authz-meeting-link-b', 'AUTHZ MEETING LINK B');
insert into public.app_workspace_members(workspace_id, user_id, role) values
  ('a1100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner'),
  ('a1100000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'owner');
insert into public.app_meetings(id, workspace_id, title, created_by) values
  ('a1200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'AUTHZ MEETING A', 'a1000000-0000-4000-8000-000000000001'),
  ('a1200000-0000-4000-8000-000000000002', 'a1100000-0000-4000-8000-000000000002', 'AUTHZ MEETING B', 'a1000000-0000-4000-8000-000000000002');
insert into public.app_suborganizations(id, workspace_id, name, created_by) values
  ('a1300000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'AUTHZ ORG A', 'a1000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
insert into public.app_record_links(id, workspace_id, google_task_id, google_tasklist_id, task_completed, meeting_id)
values ('a1400000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001',
        'authz-meeting-task-a', '@default', false, 'a1200000-0000-4000-8000-000000000001');

do $$
declare
  rejected boolean;
begin
  if (select count(*) from public.app_record_links where id = 'a1400000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'owner cannot read own meeting link';
  end if;
  rejected := false;
  begin
    insert into public.app_record_links(workspace_id, google_task_id, google_tasklist_id, task_completed, meeting_id)
    values ('a1100000-0000-4000-8000-000000000001', 'authz-cross-meeting', '@default', false,
            'a1200000-0000-4000-8000-000000000002');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'cross-workspace meeting link was allowed'; end if;

  rejected := false;
  begin
    insert into public.app_record_links(workspace_id, google_task_id, google_tasklist_id, task_completed, meeting_id, organization_id)
    values ('a1100000-0000-4000-8000-000000000001', 'authz-two-targets', '@default', false,
            'a1200000-0000-4000-8000-000000000001', 'a1300000-0000-4000-8000-000000000001');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'two targets were allowed'; end if;
end
$$;

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
do $$
declare
  rejected boolean := false;
begin
  if exists (select 1 from public.app_record_links where id = 'a1400000-0000-4000-8000-000000000001') then
    raise exception 'other owner can read meeting link';
  end if;
  update public.app_record_links set task_completed = true
  where id = 'a1400000-0000-4000-8000-000000000001';
  if found then raise exception 'other owner updated meeting link'; end if;
  delete from public.app_record_links where id = 'a1400000-0000-4000-8000-000000000001';
  if found then raise exception 'other owner deleted meeting link'; end if;
  begin
    insert into public.app_record_links(workspace_id, google_task_id, google_tasklist_id, task_completed, meeting_id)
    values ('a1100000-0000-4000-8000-000000000001', 'authz-other-owner', '@default', false,
            'a1200000-0000-4000-8000-000000000001');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'other owner inserted meeting link'; end if;
end
$$;

rollback;
