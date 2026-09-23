-- Regression checks for 20260923074619_web2_project_owner_only.sql.
do $test$
declare
  v_read text;
  v_view text;
  v_edit text;
  v_manage text;
  v_index text;
begin
  select qual into v_read
  from pg_policies
  where schemaname='public' and tablename='app_spaces'
    and policyname='app_spaces_scoped_read';

  if v_read is null or position('owner_id' in v_read)=0 or position('auth.uid' in v_read)=0 then
    raise exception 'app_spaces read policy is not owner-scoped: %',v_read;
  end if;
  if position('visibility' in v_read)>0 or position('app_space_members' in v_read)>0 then
    raise exception 'legacy visibility/member read path remains: %',v_read;
  end if;

  select pg_get_functiondef(p.oid) into v_view
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='app_can_view_space';
  select pg_get_functiondef(p.oid) into v_edit
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='app_can_edit_space';
  select pg_get_functiondef(p.oid) into v_manage
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='app_can_manage_space';

  if position('owner_id' in v_view)=0 or position('owner_id' in v_edit)=0 or position('owner_id' in v_manage)=0 then
    raise exception 'project trusted-layer helper is not owner-only';
  end if;

  if has_function_privilege('anon','public.app_public_project(text)','EXECUTE')
     or has_function_privilege('authenticated','public.app_public_project(text)','EXECUTE') then
    raise exception 'legacy public project RPC remains executable';
  end if;
  if has_function_privilege('authenticated','public.app_project_publication_state(uuid)','EXECUTE') then
    raise exception 'project publication management remains executable';
  end if;

  select pg_get_functiondef(p.oid) into v_index
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='app_public_workspace_index';
  if position('''projects'',''[]''::jsonb' in v_index)=0 then
    raise exception 'public workspace index still contains project discovery';
  end if;
end
$test$;
