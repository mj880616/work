-- SELECT only. Counts and hashes; no item names or ids. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite recorded 예 / new migration absent 예 / every connected index re-walked 예 / RLS 예 / anon 아니오 / one owner policy 예.
--   'stars off by a day'는 고칠 줄 수(기록만, 0이어도 적용 가능). 그 밖의 해시·개수는 사후 확인과 같은 값이어야 한다(기록만).
-- 'every connected index re-walked'가 아니오면 고친 onedrive-photos 배포 뒤 사진 화면을 한 번 열어 색인을 다 받은 다음 다시 확인한다.
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: every connected index re-walked = 예
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: one owner policy = 예
-- expect: stars off by a day = 기록
-- expect: stars rows = 기록
-- expect: onedrive stars rows = 기록
-- expect: constraints hash = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
-- expect: indexes hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261028010000' and name='onedrive_photo_index')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261029124500') then '예' else '아니오' end
union all select 'every connected index re-walked',case when not exists(select 1 from public.app_onedrive_connections
  where folder_id is not null and (index_done_at is null or index_done_at < timestamptz '2026-10-28 23:00:00+00')) then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_diary_stars') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_diary_stars','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_diary_stars') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_diary_stars'))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_diary_stars' and policyname='diary_stars_owner_all' and cmd='ALL' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'stars off by a day',count(*)::text from public.app_diary_stars s join public.app_onedrive_photos p on p.workspace_id=s.workspace_id and p.item_id=s.item_key
  where s.source='onedrive' and p.updated_at >= timestamptz '2026-10-28 23:00:00+00' and s.taken_day <> p.taken_day
union all select 'stars rows',count(*)::text from public.app_diary_stars
union all select 'onedrive stars rows',count(*)::text from public.app_diary_stars where source='onedrive'
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_diary_stars')
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_diary_stars'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_diary_stars')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_diary_stars') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_diary_stars')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_diary_stars') and not tgisinternal;
