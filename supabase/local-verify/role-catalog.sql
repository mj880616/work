-- Read only role metadata. Output is held only in runner temporary storage.
select json_build_object(
  'currentUser', current_user,
  'sessionUser', session_user,
  'roles', (select coalesce(json_agg(json_build_object('name',rolname,'superuser',rolsuper,
                                                     'canLogin',rolcanlogin,'createRole',rolcreaterole)), '[]'::json) from pg_roles),
  'memberships', (select coalesce(json_agg(json_build_object('member',member.rolname,'role',parent.rolname)), '[]'::json)
                  from pg_auth_members edge
                  join pg_roles member on member.oid=edge.member
                  join pg_roles parent on parent.oid=edge.roleid),
  'schemaOwners', (select coalesce(json_agg(json_build_object('schema',nspname,'owner',pg_get_userbyid(nspowner))), '[]'::json)
                   from pg_namespace where nspname in ('public','private'))
);
