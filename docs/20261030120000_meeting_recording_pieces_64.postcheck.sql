-- SELECT only. Works after apply (record + limit 64) and after rollback/dry-run (neither: limit 16).
-- The hash/count items must equal the precheck values of the same name (no grant, column, other constraint, policy, trigger or index change; no row added or removed).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다(#978).
with history as (
  select count(*) as n,count(*) filter(where name='meeting_recording_pieces_64') as named from supabase_migrations.schema_migrations where version='20261030120000'
), lim as (
  select count(*) as n,max(substring(pg_get_constraintdef(oid) from 'cardinality\(piece_ids\) <= ([0-9]+)')) as v
  from pg_constraint where conrelid=to_regclass('public.app_meeting_recordings') and conname='app_meeting_recordings_pieces_check' and contype='c' and convalidated
)
select 'limit and history agree' as item,case when lim.n=1 and ((history.n=0 and lim.v='16') or (history.n=1 and history.named=1 and lim.v='64')) then '예' else '아니오' end as value
  from history,lim
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
