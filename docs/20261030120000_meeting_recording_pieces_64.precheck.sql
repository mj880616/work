-- SELECT only. Aggregates and hashes; no recording rows or Drive ids. Run before dry-run/apply (also the dry-run before/after comparison).
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema는 쓰지 않고 pg_catalog만 읽는다(#978).
-- 적용 전 기대: 앞 기록(녹음 구간 표) 있음, 이번 기록 없음, 조각 검사 상한 16, 16개 넘는 행 0, RLS 켜짐, anon 권한 없음, 정책은 소유자 읽기 하나.
--   그 밖의 개수·해시는 기록만 하고 사후 확인에서 같은 값이어야 한다(권한·칸·다른 검사·색인·정책·트리거·행 수 변화 없음).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: pieces check limit = 16
-- expect: rows over 16 pieces = 0
-- expect: RLS enabled = 예
-- expect: anon or public privilege = 아니오
-- expect: one owner read policy = 예
-- expect: recording rows = 기록
-- expect: columns hash = 기록
-- expect: other constraints hash = 기록
-- expect: indexes hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: policies hash = 기록
-- expect: triggers count = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261029200000' and name='meeting_recordings')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261030120000') then '예' else '아니오' end
union all select 'pieces check limit',coalesce((select substring(pg_get_constraintdef(oid) from 'cardinality\(piece_ids\) <= ([0-9]+)') from pg_constraint where conrelid=to_regclass('public.app_meeting_recordings') and conname='app_meeting_recordings_pieces_check' and contype='c' and convalidated),'없음')
union all select 'rows over 16 pieces',count(*)::text from public.app_meeting_recordings where cardinality(piece_ids)>16
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_meeting_recordings') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public privilege',case when exists(select 1 from pg_class where oid=to_regclass('public.app_meeting_recordings') and relacl::text ~ '(^|[{,])(anon)?=')
  or exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_meeting_recordings') and attacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'one owner read policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_meeting_recordings'))=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_meeting_recordings') and polname='meeting_recordings_owner_read' and polcmd='r' and polpermissive
    and polroles=array['authenticated'::regrole]::oid[]) then '예' else '아니오' end
union all select 'recording rows',count(*)::text from public.app_meeting_recordings
union all select 'columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':'||coalesce(a.attacl::text,'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meeting_recordings') and a.attnum>0 and not a.attisdropped
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meeting_recordings') and conname<>'app_meeting_recordings_pieces_check'
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_meeting_recordings'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_meeting_recordings')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meeting_recordings')
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_meeting_recordings') and not tgisinternal;
