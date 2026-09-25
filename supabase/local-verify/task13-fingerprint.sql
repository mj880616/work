with target_functions(signature) as (
  values
    ('public.app_public_workspace_index()'),
    ('public.app_public_workspace_snapshot()'),
    ('public.app_public_projects_snapshot()'),
    ('public.app_public_project(text)'),
    ('public.app_public_suborganization_facets()'),
    ('public.app_project_publication_state(uuid)'),
    ('public.app_set_project_publication(uuid,boolean,boolean,text)'),
    ('public.app_set_project_block_publication(uuid,boolean,boolean,integer)'),
    ('public.app_move_project_public_block(uuid,integer)'),
    ('public.app_create_share_link(uuid,timestamp with time zone)'),
    ('public.app_open_share(text)'),
    ('public.app_save_page_v2(uuid,uuid,uuid,text,text,text,text,text,text)')
), function_state as (
  select t.signature, p.proacl
  from target_functions t
  join pg_proc p on p.oid=t.signature::regprocedure
), trigger_state as (
  select n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid) as definition
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and t.tgname in (
    'task13_pages_private_visibility','task13_documents_private_visibility'
  )
), helper_state as (
  select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='app_enforce_web2_private_visibility'
)
select 'functions=' || md5(coalesce((select jsonb_agg(to_jsonb(f) order by signature)::text from function_state f),'[]'))
union all
select 'triggers=' || md5(coalesce((select jsonb_agg(to_jsonb(t) order by nspname,relname,tgname)::text from trigger_state t),'[]'))
union all
select 'helper=' || md5(coalesce((select jsonb_agg(to_jsonb(h) order by signature)::text from helper_state h),'[]'));
