-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 새 표만 만드는 파일이라 "아직 없음"을 기록하고, 이 파일이 기대는 표·소유자 확인 함수의 정의 해시를 남긴다.
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_onedrive_connections','public.app_onedrive_photos','public.app_diary_photo_stars','public.app_workspaces','public.app_google_calendar_connections']) n
union all select 'owner check function',p.oid::regprocedure::text,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc)
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'default ACL',coalesce(d.defaclrole::regrole::text,'')||':'||d.defaclobjtype::text,coalesce(d.defaclacl::text,'none')
  from pg_default_acl d where d.defaclnamespace='public'::regnamespace
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261026090000'
order by 1,2;
