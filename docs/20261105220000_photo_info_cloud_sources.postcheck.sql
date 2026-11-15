-- SELECT only. Run after apply. 예/아니오 항목은 모두 예, 해시는 precheck의 같은 이름 항목과 같은 값이어야 한다(권한·정책 그대로).
-- expect: history row present = 예
-- expect: source check with cloud sources = 예
-- expect: photo info edits grants policies hash = 기록
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261105220000' and name='photo_info_cloud_sources')=1 then '예' else '아니오' end as value
union all select 'source check with cloud sources',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_photo_info_edits') and conname='app_photo_info_edits_source_check' and convalidated and pg_get_constraintdef(oid) ~ '''phone''' and pg_get_constraintdef(oid) ~ '''onedrive''' and pg_get_constraintdef(oid) ~ '''gdrive''')=1 then '예' else '아니오' end
union all select 'photo info edits grants policies hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_photo_info_edits')),'')
  ||coalesce((select string_agg(a.attname::text||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_photo_info_edits') and a.attnum>0 and not a.attisdropped),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_photo_info_edits')),''));
