begin;
-- WEEKLY-자료날짜 남은 일 (명진 11/01 01:04 "주간보고 자료 날짜 일괄 고치기 ㄱ"): 자료실 자료의 자료 날짜(app_documents.document_date) 중
-- AI 정리가 해를 잘못 붙인 것이 확실한 것만 해를 바로잡는다(월·일은 그대로). 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다.
--
-- 확실한 것(모두 만족할 때만 고침):
--   1) 자료 날짜를 AI가 넣었다(field_origin ->> 'document_date' = 'ai'). 사람이 넣은 날짜('user')와 기록 없는 날짜는 고치지 않는다.
--   2) 제목·파일 이름(없으면 파일 본문 첫 1000자)에 자료 날짜와 같은 월·일의 '연도가 적힌 날짜'가 있고(2025.10.26 · 2025-10-26 · 2025년 10월 26일 ·
--      20251026 · 251026 · 25.10.26), 그 연도가 한 가지뿐이며 자료 날짜의 해와 다르다. 제목·파일 이름에 그런 날짜가 있으면 본문은 보지 않는다.
--   3) 그 글(제목·파일 이름 또는 본문 첫머리)에 자료 날짜의 해(네 자리)가 따로 적혀 있지 않다(반대 근거가 있으면 고치지 않음).
--   4) 바로잡은 날짜가 올린 날(서울)보다 60일 넘게 뒤가 아니다. 2월 29일은 고치지 않는다.
-- 애매한 것(연도가 둘 이상, 다른 해가 이름에만 있고 같은 월·일 날짜는 없음, 연도 표시가 아예 없음, AI가 넣지 않은 날짜 등)은 고치지 않고
--   사전 확인 SQL이 '확인 필요' 건수로만 센다.
-- 무엇: 새 비공개 표 app_document_date_fixes에 바꿀 자료의 id·작업공간·옛 날짜·새 날짜를 남긴 뒤, 그 자료의 document_date 한 칸만 바꾼다.
--   다른 칸(field_origin 포함)·행 수·기존 표의 권한·정책·함수·트리거는 바꾸지 않는다. 고칠 자료가 50건을 넘으면 아무것도 바꾸지 않고 멈춘다.
-- 권한: 새 표는 RLS 켜고 정책 없음, PUBLIC·anon·authenticated·service_role 권한 모두 회수(화면·API 누구도 읽지 못함, SQL로만).
-- 출력: 제목·파일 이름·본문은 어디에도 내보내지 않는다(건수는 사전 확인 SQL에서 숫자로만).
-- 되돌리기: 짝 rollback(SQL Editor 전용) — 이 표의 옛 날짜로 되돌리고(그 뒤 사람이 고친 자료는 건너뜀) 표와 기록 1행을 지운다.
set local lock_timeout = '5s';
set local statement_timeout = '120s';
lock table public.app_documents in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261101011500')
     or to_regclass('public.app_document_date_fixes') is not null
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261022100000' and name = 'library_ai_fill') <> 1
     or (select count(*) from pg_attribute where attrelid = 'public.app_documents'::regclass and not attisdropped
         and ((attname = 'document_date' and atttypid = 'date'::regtype)
           or (attname = 'field_origin' and atttypid = 'jsonb'::regtype)
           or (attname = 'created_at' and atttypid = 'timestamptz'::regtype)
           or (attname in ('title', 'file_name', 'extracted_text', 'extraction_status') and atttypid = 'text'::regtype)
           or (attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype))) <> 9
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and not relrowsecurity) then
    raise exception 'DOC_DATE_YEAR_FIX_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_document_date_fixes (
  document_id uuid primary key,
  workspace_id uuid not null,
  old_document_date date not null,
  new_document_date date not null,
  fixed_at timestamptz not null default now(),
  constraint app_document_date_fixes_changed_check check (old_document_date <> new_document_date)
);

alter table public.app_document_date_fixes enable row level security;
revoke all on table public.app_document_date_fixes from public, anon, authenticated, service_role;

insert into public.app_document_date_fixes (document_id, workspace_id, old_document_date, new_document_date)
  select k.id, k.workspace_id, k.old_date, k.new_date
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
          where f.mo = b.dm and f.da = b.dd and f.y between 2000 and b.uy + 1) n) a) c) k
  where k.fix;

do $$
begin
  if (select count(*) from public.app_document_date_fixes) > 50 then
    raise exception 'DOC_DATE_YEAR_FIX_TOO_MANY; stop';
  end if;
end
$$;

update public.app_documents d
  set document_date = f.new_document_date
  from public.app_document_date_fixes f
  where f.document_id = d.id
    and d.document_date = f.old_document_date;

-- 사후 확인: 남긴 행마다 자료 날짜가 새 날짜이고, 같은 규칙으로 다시 세면 고칠 자료가 0, 새 표는 RLS 켜짐·정책 없음·API 역할 권한 없음.
-- 다르면 전체 취소.
do $$
begin
  if exists (select 1 from public.app_document_date_fixes f join public.app_documents d on d.id = f.document_id
             where d.document_date is distinct from f.new_document_date)
     or (select count(*) from public.app_document_date_fixes f join public.app_documents d on d.id = f.document_id)
        <> (select count(*) from public.app_document_date_fixes)
     or exists (select 1
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
                where f.mo = b.dm and f.da = b.dd and f.y between 2000 and b.uy + 1) n) a) c) k
        where k.fix)
     or not exists (select 1 from pg_class where oid = 'public.app_document_date_fixes'::regclass and relrowsecurity)
     or exists (select 1 from pg_policy where polrelid = 'public.app_document_date_fixes'::regclass)
     or has_table_privilege('anon', 'public.app_document_date_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_document_date_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_document_date_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or exists (select 1 from pg_class where oid = 'public.app_document_date_fixes'::regclass and relacl::text ~ '(^|[{,])=')
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relrowsecurity) then
    raise exception 'DOC_DATE_YEAR_FIX_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261101011500', 'doc_date_year_fix', array['WEEKLY doc date fix: private table app_document_date_fixes (RLS, no policy, all API privileges revoked) keeps id/old/new date; document_date year corrected only where an AI-set date conflicts with the one year written with the same month/day in the title, file name or text head (max 50 rows)']);
commit;
