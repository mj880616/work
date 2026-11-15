-- SELECT only. Run before dry-run/apply. 카탈로그·migration 기록만 읽는다(되돌리기 기록 줄 값·줄 수 없음 — 사람이 고칠 때마다 늘어나므로 넣지 않는다).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: photo info edits table applied = 예
-- expect: source check without cloud sources = 예
-- expect: photo info edits grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261105220000') then '예' else '아니오' end as value
union all select 'photo info edits table applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261103140000' and name='photo_info_edits')=1 and to_regclass('public.app_photo_info_edits') is not null then '예' else '아니오' end
union all select 'source check without cloud sources',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_photo_info_edits') and conname='app_photo_info_edits_source_check' and pg_get_constraintdef(oid) ~ '''phone''' and pg_get_constraintdef(oid) !~ '''onedrive''' and pg_get_constraintdef(oid) !~ '''gdrive''')=1 then '예' else '아니오' end
union all select 'photo info edits grants policies hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_photo_info_edits')),'')
  ||coalesce((select string_agg(a.attname::text||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_photo_info_edits') and a.attnum>0 and not a.attisdropped),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_photo_info_edits')),''));
