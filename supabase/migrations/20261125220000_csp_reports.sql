begin;
-- SEC-Web2CSP I-5 보고 받는 곳(2026-11-25 명진 결정 "추천대로"): 화면 보안 규칙(CSP)을 막는 단계로 가기 전에, 보고 전용 규칙에 걸리는 것을
-- 2주 모아 숫자로 본다. 위반 하나하나가 아니라 '날짜·지시어·막힌 주소 출처' 한 줄에 개수만 더한다.
--  1) 새 표 public.app_csp_reports(day, directive, blocked, hits): 지시어는 정해진 목록, blocked는 출처(https?://호스트[:포트])나 정해진 낱말만.
--     쿼리·경로·토큰·사용자 id·작업공간 id·문서 주소·코드 조각 칸은 없다. RLS 켬·정책 없음·API 역할 권한 없음 → 아래 함수로만 쓴다.
--  2) public.app_csp_report_add(p_items jsonb): service_role만(Edge csp-report가 모양·크기·출처를 거른 뒤 부름). 다시 검사한다:
--     배열 1~20개, 각 {directive, blocked, hits 1~20}, 날짜는 서울 날짜로 DB가 붙임, 한 날 300줄 넘으면 그 지시어의 'other'로 합침, 개수 상한 1000000.
-- 읽기는 CC가 읽기 전용 SQL로 숫자만 본다(화면·읽기 함수 없음). 안 하는 것: 기존 표·함수·정책·권한 변경, rtw_* 객체, 막는 단계.
-- 짝: docs/20261125220000_csp_reports.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125220000')
     or to_regclass('public.app_csp_reports') is not null
     or to_regprocedure('public.app_csp_report_add(jsonb)') is not null then
    raise exception 'CSP_REPORTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_csp_reports (
  day date not null,
  directive text not null,
  blocked text not null,
  hits integer not null,
  constraint app_csp_reports_pkey primary key (day, directive, blocked),
  constraint app_csp_reports_directive check (directive in ('default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem',
    'style-src-attr', 'img-src', 'media-src', 'font-src', 'connect-src', 'worker-src', 'frame-src', 'child-src', 'manifest-src', 'object-src', 'base-uri',
    'form-action', 'frame-ancestors', 'trusted-types', 'require-trusted-types-for')),
  constraint app_csp_reports_blocked check (pg_catalog.length(blocked) <= 100 and (blocked ~ '^https?://[a-z0-9.-]{1,80}(:[0-9]{1,5})?$'
    or blocked in ('inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink', 'data', 'blob', 'extension', 'other'))),
  constraint app_csp_reports_hits check (hits between 1 and 1000000)
);
alter table public.app_csp_reports enable row level security;
revoke all on table public.app_csp_reports from public, anon, authenticated, service_role;

create function public.app_csp_report_add(p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day date := (pg_catalog.now() at time zone 'Asia/Seoul')::date;
  v_item jsonb;
  v_directive text;
  v_blocked text;
  v_hits integer;
  v_count integer := 0;
begin
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' or pg_catalog.jsonb_array_length(p_items) not between 1 and 20
     or pg_catalog.octet_length(p_items::text) > 4000 then
    raise exception using errcode = '22023', message = 'CSP_REPORT_SHAPE';
  end if;
  for v_item in select e from pg_catalog.jsonb_array_elements(p_items) e loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' or pg_catalog.jsonb_typeof(v_item -> 'directive') <> 'string'
       or pg_catalog.jsonb_typeof(v_item -> 'blocked') <> 'string' or pg_catalog.jsonb_typeof(v_item -> 'hits') <> 'number'
       or (v_item ->> 'hits') !~ '^[0-9]{1,2}$' or (v_item ->> 'hits')::integer not between 1 and 20 then
      raise exception using errcode = '22023', message = 'CSP_REPORT_SHAPE';
    end if;
    v_directive := v_item ->> 'directive';
    v_blocked := v_item ->> 'blocked';
    v_hits := (v_item ->> 'hits')::integer;
    if v_directive not in ('default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr', 'img-src',
         'media-src', 'font-src', 'connect-src', 'worker-src', 'frame-src', 'child-src', 'manifest-src', 'object-src', 'base-uri', 'form-action',
         'frame-ancestors', 'trusted-types', 'require-trusted-types-for')
       or pg_catalog.length(v_blocked) > 100
       or not (v_blocked ~ '^https?://[a-z0-9.-]{1,80}(:[0-9]{1,5})?$'
         or v_blocked in ('inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink', 'data', 'blob', 'extension', 'other')) then
      raise exception using errcode = '22023', message = 'CSP_REPORT_VALUE';
    end if;
    -- 한 날 줄 수 상한: 처음 보는 출처가 300줄을 넘기면 그 지시어의 'other' 한 줄로 합친다(지시어 목록이 정해져 있어 줄 수가 묶인다).
    if not exists (select 1 from public.app_csp_reports r where r.day = v_day and r.directive = v_directive and r.blocked = v_blocked)
       and (select pg_catalog.count(*) from public.app_csp_reports r where r.day = v_day) >= 300 then
      v_blocked := 'other';
    end if;
    insert into public.app_csp_reports as r (day, directive, blocked, hits)
    values (v_day, v_directive, v_blocked, v_hits)
    on conflict (day, directive, blocked) do update set hits = least(r.hits + excluded.hits, 1000000)
      where r.hits < 1000000;
    v_count := v_count + v_hits;
  end loop;
  return pg_catalog.jsonb_build_object('ok', true, 'count', v_count);
end
$$;

revoke all on function public.app_csp_report_add(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.app_csp_report_add(jsonb) to service_role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_csp_reports'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_csp_reports'::regclass)
     or has_table_privilege('anon', 'public.app_csp_reports', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_csp_reports', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_csp_reports', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_csp_report_add(jsonb)') and prosecdef and proconfig = array['search_path=""']) <> 1
     or has_function_privilege('anon', 'public.app_csp_report_add(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.app_csp_report_add(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.app_csp_report_add(jsonb)', 'execute') then
    raise exception 'CSP_REPORTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125220000', 'csp_reports', array['SEC-Web2CSP I-5: new table app_csp_reports (day, directive, blocked origin or keyword, hits; RLS on, no policies, no API privileges); app_csp_report_add(jsonb) for service_role only (Edge csp-report), validates directive list, origin shape, 1-20 items, adds hits per Seoul day, caps 300 rows per day by folding into other']);
commit;
