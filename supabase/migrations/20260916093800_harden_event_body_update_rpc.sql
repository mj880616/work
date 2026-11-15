create or replace function public.app_update_event_body(p_event uuid, p_body text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_uid uuid := auth.uid();
  v_workspace uuid;
  v_project uuid;
  v_scope text;
  v_created_by uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  select e.workspace_id, e.project_id, e.calendar_scope, e.created_by
    into v_workspace, v_project, v_scope, v_created_by
  from public.app_events e
  where e.id = p_event;

  if v_workspace is null then
    raise exception 'not allowed';
  end if;

  if not (
    (v_scope = 'personal' and v_created_by = v_uid)
    or
    (v_scope = 'team' and (
      (v_project is null and (
        v_created_by = v_uid
        or private.app_role_rank(private.app_workspace_role(v_workspace)) >= 30
      ))
      or
      (v_project is not null and (
        v_created_by = v_uid
        or private.app_can_edit_space(v_project)
      ))
    ))
  ) then
    raise exception 'not allowed';
  end if;

  update public.app_events
  set body = coalesce(p_body,''), updated_at = now()
  where id = p_event;

  return true;
end
$function$;
