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
  select
    t.signature,
    case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
    a.privilege_type,
    a.is_grantable
  from target_functions t
  join pg_proc p on p.oid=t.signature::regprocedure
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
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
), fingerprints as (
  select
    'function:' || signature as component,
    md5(jsonb_agg(to_jsonb(f) - 'signature' order by grantee,privilege_type,is_grantable)::text) as fingerprint
  from function_state f
  group by signature
  union all
  select 'triggers', md5(coalesce((select jsonb_agg(to_jsonb(t) order by nspname,relname,tgname)::text from trigger_state t),'[]'))
  union all
  select 'helper', md5(coalesce((select jsonb_agg(to_jsonb(h) order by signature)::text from helper_state h),'[]'))
)
-- Compare effective EXECUTE semantics per function. GRANT after a schema-only
-- restore can legitimately record a different grantor while preserving the
-- same non-grantable privilege set; grantor identity does not change who can
-- call these functions and is therefore not part of the rollback contract.
select component || '=' || fingerprint
from fingerprints
order by component;
