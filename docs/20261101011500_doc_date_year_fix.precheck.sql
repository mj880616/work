-- SELECT only. Counts and hashes; no title, file name, text or id. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite recorded 예 / new migration absent 예 / fix table absent 예 / RLS enabled 예 / anon or public table privilege 아니오.
-- 'dates to fix'는 고칠 자료 수(0~50만 진행, 넘으면 멈춤). 'needs check …'는 고치지 않고 세기만 하는 확인 필요 수(기록만).
--   needs check other year: 이름·본문 첫머리에 자료 날짜와 다른 해가 있으나 확실하지 않음(연도 둘 이상, 같은 월·일 날짜 없음, 반대 근거 있음 등)
--   needs check ai date without year: AI가 넣은 올린 해 날짜인데 이름·본문 첫머리 어디에도 그 해가 적혀 있지 않음(연도 없는 날짜를 올해로 짐작했을 수 있음)
--   needs check date not set by ai: 규칙은 맞지만 날짜를 AI가 넣지 않음(기록 없음 — 옛 수동 입력일 수 있어 고치지 않음)
--   needs check date long after upload: 자료 날짜가 올린 날보다 60일 넘게 뒤
--   needs check total: 위 넷 중 하나 이상인 자료 수(겹침 없이)
-- 해시·행 수는 사후 확인과 같은 값이어야 한다(권한·정책·트리거·제약 변경 없음, 행 추가·삭제 없음, 날짜를 비우지 않음).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: fix table absent = 예
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: dates to fix = 0~50
-- expect: needs check other year = 기록
-- expect: needs check ai date without year = 기록
-- expect: needs check date not set by ai = 기록
-- expect: needs check date long after upload = 기록
-- expect: needs check total = 기록
-- expect: documents rows = 기록
-- expect: documents with date = 기록
-- expect: constraints hash = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
with k as (select k.*
  from (select c.*,
      case when c.new_date is not null and c.new_date <= c.upload_day + 60 and c.origin = 'ai' then true else false end as fix
    from (select b.id, b.workspace_id, b.old_date, b.origin, b.dy, b.uy, b.upload_day, b.name, b.head, a.ys,
        case when cardinality(a.ys) = 1 and a.ys[1] <> b.dy and not (b.dm = 2 and b.dd = 29)
          and a.src !~ ('(^|[^0-9])' || b.dy::text || '([^0-9]|$)')
          then make_date(a.ys[1], b.dm, b.dd) end as new_date
      from (select d.id, d.workspace_id, d.document_date as old_date,
          coalesce(d.field_origin ->> 'document_date', '') as origin,
          extract(year from d.document_date)::int as dy, extract(month from d.document_date)::int as dm,
          extract(day from d.document_date)::int as dd,
          (d.created_at at time zone 'Asia/Seoul')::date as upload_day,
          extract(year from (d.created_at at time zone 'Asia/Seoul'))::int as uy,
          coalesce(d.title, '') || ' ' || coalesce(d.file_name, '') as name,
          case when d.extraction_status = 'ready' then left(coalesce(d.extracted_text, ''), 1000) else '' end as head
        from public.app_documents d
        where d.document_date is not null and coalesce(d.field_origin ->> 'document_date', '') <> 'user') b
      cross join lateral (
        select case when n.ny is not null then n.ny else n.hy end as ys,
          case when n.ny is not null then b.name else b.head end as src
        from (select array_agg(distinct f.y order by f.y) filter (where f.src = 'name') as ny,
            array_agg(distinct f.y order by f.y) filter (where f.src = 'head') as hy
          from (select s.src, x.y, x.mo, x.da
            from (values ('name', b.name), ('head', b.head)) s(src, txt)
            cross join lateral (
              select m[2]::int as y, m[3]::int as mo, m[4]::int as da from regexp_matches(s.txt, '(^|[^0-9])((?:19|20)[0-9]{2})\s*(?:[./-]|년)\s*([0-9]{1,2})\s*(?:[./-]|월)\s*([0-9]{1,2})(?=[^0-9]|$)', 'g') m
              union all select m[2]::int, m[3]::int, m[4]::int from regexp_matches(s.txt, '(^|[^0-9])((?:19|20)[0-9]{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])(?=[^0-9]|$)', 'g') m
              union all select 2000 + m[2]::int, m[3]::int, m[4]::int from regexp_matches(s.txt, '(^|[^0-9])([0-9]{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])(?=[^0-9]|$)', 'g') m
              union all select 2000 + m[2]::int, m[3]::int, m[4]::int from regexp_matches(s.txt, '(^|[^0-9.])([0-9]{2})\.\s*([0-9]{1,2})\.\s*([0-9]{1,2})(?=[^0-9]|$)', 'g') m) x) f
          where f.mo = b.dm and f.da = b.dd and f.y between 2000 and b.uy + 1) n) a) c) k),
c as (select k.fix,
    (not k.fix and (exists (select 1 from unnest(coalesce(k.ys, '{}'::int[])) y where y <> k.dy)
      or (k.name ~ '(^|[^0-9])(19|20)[0-9]{2}([^0-9]|$)' and k.name !~ ('(^|[^0-9])' || k.dy::text || '([^0-9]|$)')))) as other_year,
    (not k.fix and k.origin = 'ai' and k.dy = k.uy and k.ys is null
      and k.name !~ ('(^|[^0-9])' || k.dy::text || '([^0-9]|$)') and k.head !~ ('(^|[^0-9])' || k.dy::text || '([^0-9]|$)')) as ai_no_year,
    (not k.fix and k.origin <> 'ai' and k.new_date is not null) as not_ai,
    (not k.fix and k.old_date > k.upload_day + 60) as far
  from k)
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261022100000' and name='library_ai_fill')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261101011500') then '예' else '아니오' end
union all select 'fix table absent',case when to_regclass('public.app_document_date_fixes') is null then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_documents','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'dates to fix',(select count(*) from c where c.fix)::text
union all select 'needs check other year',(select count(*) from c where c.other_year)::text
union all select 'needs check ai date without year',(select count(*) from c where c.ai_no_year)::text
union all select 'needs check date not set by ai',(select count(*) from c where c.not_ai)::text
union all select 'needs check date long after upload',(select count(*) from c where c.far)::text
union all select 'needs check total',(select count(*) from c where c.other_year or c.ai_no_year or c.not_ai or c.far)::text
union all select 'documents rows',(select count(*) from public.app_documents)::text
union all select 'documents with date',(select count(*) from public.app_documents where document_date is not null)::text
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_documents')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_documents')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_documents') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal;
