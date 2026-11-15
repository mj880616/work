begin;
-- FEAT-1029묶음 ① Web2에 물어보기 1단계 DB (docs/design/ask-web2.md 4절·5절 1단계, 명진 결정 10/29 07:27 '모두 추천대로').
-- 바꾸는 것 두 가지:
--  1) 검색 함수 public.app_search_records(20261023013000, 운영 적용됨)를 같은 서명·같은 권한 모양으로 다시 정의해
--     종류 두 개를 더한다: call(업무 통화, app_feed_items source='call')·telegram(텔레그램 소식, source='telegram').
--     두 종류는 p_kinds·p_kind로 이름을 불렀을 때만 찾는다. 종류를 비우면(p_kinds null) 지금처럼 8종류만 — 전체 검색 화면 결과는 그대로다.
--     개인 통화함 표·개인 텔레그램 요약 표·일기·원문(raw_text)은 읽지 않는다(결정 1).
--     바뀌지 않는 것: SECURITY INVOKER·search_path 빈칸(기존 owner RLS 그대로), 실행은 authenticated만, 입력 규칙·오류 코드·반환 모양.
--  2) 새 표 public.app_ask_answers: 물어본 질문·답 줄·근거 목록(앞뒤 한 줄은 저장 안 함)을 30일 남긴다(결정 4).
--     owner만(private.app_is_workspace_owner). authenticated: 읽기·지우기, 넣기는 칸 5개(created_at은 서버 시각). 고치기 없음.
--     넣기는 ai-assist kind=ask_web2가 명진 로그인 토큰으로 하고, 넣을 때 그 작업공간의 30일 지난 행을 지운다(새 예약 장치 없음).
--     anon·PUBLIC·service_role 권한 없음. 기존 표 권한·정책은 바꾸지 않는다.
-- 되돌리기: docs/20261029061500_ask_web2.rollback.sql(SQL Editor 전용, 함수를 이전 판으로 되돌리고 새 표를 지움).
-- 짝: docs/20261029061500_ask_web2.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
-- 검색 함수가 20261023013000 원문 판(길이·해시 같음)이어야 한다(되돌리기가 그 판으로 돌아가므로).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029061500')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261023013000' and name = 'search_attachment_text') <> 1
     or (select count(*) from pg_proc where proname = 'app_search_records' and pronamespace = 'public'::regnamespace) <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_search_records(text,text[],integer,integer,text)')
         and not prosecdef and provolatile = 's' and proconfig = array['search_path=""']
         and length(prosrc) = 11868 and md5(prosrc) = 'a7e51ce33f40e8e022a6a88a5bc7bd89')
     or to_regclass('public.app_ask_answers') is not null
     or to_regclass('public.app_feed_items') is null
     or to_regclass('public.app_call_edits') is null
     or to_regclass('public.app_feed_summary_edits') is null
     or to_regclass('public.app_feed_room_days') is null
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_feed_items') and relrowsecurity)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'ASK_WEB2_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 전체 검색. 반환 jsonb 계약은 docs/design/global-search.md "S-1 결과 계약" 절·8절, 종류 call·telegram은 docs/design/ask-web2.md 5절.
create or replace function public.app_search_records(p_query text, p_kinds text[], p_per_kind integer, p_offset integer, p_kind text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_all text[] := array['update', 'note', 'work', 'document', 'meeting', 'project', 'organization', 'milestone'];
  -- 물어보기 재료(ASK-Web2): 업무 통화·텔레그램 소식. 이름으로 부를 때만 찾는다(빈 종류 = 위 8종류 그대로).
  v_known text[] := array['update', 'note', 'work', 'document', 'meeting', 'project', 'organization', 'milestone', 'call', 'telegram'];
  v_query text;
  v_words text[];
  v_pats text[];
  v_kinds text[];
  v_note_kinds text[];
  v_limit integer;
  v_offset integer;
  v_groups jsonb;
begin
  v_query := pg_catalog.btrim(coalesce(p_query, ''), ' ');
  if pg_catalog.char_length(coalesce(p_query, '')) > 200 or coalesce(p_query, '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'SEARCH_BAD_QUERY';
  end if;
  select coalesce(pg_catalog.array_agg(w order by o), '{}') into v_words
  from (select w, pg_catalog.min(o) as o
        from pg_catalog.unnest(pg_catalog.regexp_split_to_array(v_query, ' +')) with ordinality as x(w, o)
        where w <> '' group by w) d;
  if pg_catalog.cardinality(v_words) = 0
     or exists (select 1 from pg_catalog.unnest(v_words) w where pg_catalog.char_length(w) < 2) then
    raise exception using errcode = '22023', message = 'SEARCH_QUERY_TOO_SHORT';
  end if;
  if pg_catalog.cardinality(v_words) > 6 or exists (select 1 from pg_catalog.unnest(v_words) w where pg_catalog.char_length(w) > 100) then
    raise exception using errcode = '22023', message = 'SEARCH_TOO_MANY_WORDS';
  end if;
  if p_kind is not null then
    if p_kinds is not null or not p_kind = any (v_known) then
      raise exception using errcode = '22023', message = 'SEARCH_BAD_KIND';
    end if;
    v_kinds := array[p_kind];
  elsif p_kinds is null then
    v_kinds := v_all;
  else
    if pg_catalog.cardinality(p_kinds) = 0 or not p_kinds <@ v_known then
      raise exception using errcode = '22023', message = 'SEARCH_BAD_KIND';
    end if;
    v_kinds := p_kinds;
  end if;
  v_limit := coalesce(p_per_kind, 3);
  v_offset := coalesce(p_offset, 0);
  if v_limit < 1 or v_limit > 50 or v_offset < 0 or v_offset > 199 or (p_kind is null and v_offset <> 0) then
    raise exception using errcode = '22023', message = 'SEARCH_BAD_PAGE';
  end if;
  -- 일기는 이 목록에 없다. 메모 표의 다른 종류도 허용 목록 밖이면 나오지 않는다.
  select coalesce(pg_catalog.array_agg(case k when 'update' then 'basket' else k end), '{}') into v_note_kinds
  from pg_catalog.unnest(v_kinds) k where k in ('update', 'note', 'work');
  -- ILIKE 특수문자(\ % _)는 글자 그대로 찾는다.
  select pg_catalog.array_agg('%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
           order by o)
    into v_pats
  from pg_catalog.unnest(v_words) with ordinality as x(w, o);

  with
  notes as (
    select case n.kind when 'basket' then 'update' else n.kind end as kind, 'note'::text as source, n.id,
      case when n.kind = 'note' then n.title else pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(n.raw_text), pg_catalog.chr(10), 1), 80) end as title,
      n.raw_text as body, n.attachments as attach,
      case when n.kind = 'work' then n.journal_day::timestamptz else n.occurred_at end as occurred_at,
      case when n.kind = 'work' then n.journal_day end as day,
      case when n.kind = 'basket' and n.archived_at is not null then 'held' end as state,
      null::uuid as project_id, null::uuid as organization_id, n.id as note_id, null::text as file_text
    from public.app_notes n
    where n.kind in ('basket', 'note', 'work') and n.kind = any (v_note_kinds)
      -- 사진 글자는 읽기가 끝난(state done) 것만 찾는다.
      and (coalesce(n.title, '') || ' ' || n.raw_text || ' ' || coalesce(pg_catalog.jsonb_path_query_array(n.attachments, '$[*].ocr ? (@.state == "done").text')::text, '')) ilike all (v_pats)
  ),
  docs as (
    select 'document'::text, 'document'::text, d.id, coalesce(d.title, d.file_name),
      pg_catalog.concat_ws(' ', d.description, d.source, d.category, d.tags::text, d.file_name), null::jsonb,
      coalesce(d.document_date::timestamptz, d.created_at::timestamptz), null::date, null::text, d.project_id, d.organization_id, null::uuid,
      -- ② 파일 안 글자: 읽기가 끝난(ready) 글자만 찾는다.
      case when d.extraction_status = 'ready' then d.extracted_text end
    from public.app_documents d
    where 'document' = any (v_kinds)
      and pg_catalog.concat_ws(' ', d.title, d.file_name, d.source, d.category, d.tags::text, d.description,
        case when d.extraction_status = 'ready' then d.extracted_text end) ilike all (v_pats)
  ),
  meetings as (
    select 'meeting'::text, 'meeting'::text, m.id, coalesce(m.title, m.series_name),
      pg_catalog.concat_ws(' ', m.transcript_text, m.decisions::text), null::jsonb,
      coalesce(m.meeting_at::timestamptz, m.created_at::timestamptz), null::date, null::text, m.project_id, null::uuid, null::uuid, null::text
    from public.app_meetings m
    where 'meeting' = any (v_kinds)
      and pg_catalog.concat_ws(' ', m.title, m.series_name, m.transcript_text, m.decisions::text) ilike all (v_pats)
  ),
  projects as (
    select 'project'::text, 'project'::text, s.id, s.name, null::text, null::jsonb, s.updated_at::timestamptz, null::date,
      case when s.status in ('done', 'completed') then 'done' end, s.id, null::uuid, null::uuid, null::text
    from public.app_spaces s
    where 'project' = any (v_kinds) and s.status is distinct from 'archived'
      and (s.metadata ->> 'project_system' = 'v2' or s.metadata ->> 'management_version' = '2')
      and coalesce(s.name, '') ilike all (v_pats)
  ),
  progress as (
    select 'project'::text, 'progress'::text, p.id, s.name, pg_catalog.concat_ws(' ', p.status_label, p.summary, p.next_step), null::jsonb,
      p.effective_on::timestamptz, null::date, case when s.status in ('done', 'completed') then 'done' end, p.project_id, null::uuid, null::uuid, null::text
    from public.app_project_progress_updates p
    join public.app_spaces s on s.id = p.project_id and s.status is distinct from 'archived'
    where 'project' = any (v_kinds)
      and pg_catalog.concat_ws(' ', p.status_label, p.summary, p.next_step) ilike all (v_pats)
  ),
  milestones as (
    select 'milestone'::text, 'milestone'::text, ms.id, ms.title, null::text, null::jsonb, ms.start_at::timestamptz, null::date,
      case when ms.status in ('done', 'completed') then 'done' when ms.status in ('cancelled', 'canceled') then 'cancelled' end,
      ms.project_id, null::uuid, null::uuid, null::text
    from public.app_project_milestones ms
    join public.app_spaces s on s.id = ms.project_id and s.status is distinct from 'archived'
    where 'milestone' = any (v_kinds) and coalesce(ms.title, '') ilike all (v_pats)
  ),
  orgs as (
    select 'organization'::text, 'organization'::text, o.id, o.name, pg_catalog.concat_ws(' ', o.aliases::text, o.description), null::jsonb,
      o.updated_at::timestamptz, null::date, null::text, null::uuid, o.id, null::uuid, null::text
    from public.app_suborganizations o
    where 'organization' = any (v_kinds)
      and pg_catalog.concat_ws(' ', o.name, o.aliases::text, o.description) ilike all (v_pats)
  ),
  org_updates as (
    select 'organization'::text, 'org_update'::text, u.id, o.name, pg_catalog.concat_ws(' ', u.raw_text, u.detail_text), null::jsonb,
      u.occurred_at::timestamptz, null::date, null::text, null::uuid, u.organization_id, null::uuid, null::text
    from public.app_suborganization_updates u
    left join public.app_suborganizations o on o.id = u.organization_id
    where 'organization' = any (v_kinds)
      and pg_catalog.concat_ws(' ', u.raw_text, u.detail_text) ilike all (v_pats)
  ),
  org_timeline as (
    select 'organization'::text, 'org_timeline'::text, t.id, t.title, t.summary, null::jsonb,
      coalesce(t.event_date::timestamptz,
        case when t.event_year::integer between 1 and 9999 then pg_catalog.make_date(t.event_year::integer, 1, 1)::timestamptz end),
      null::date, null::text,
      null::uuid, t.organization_id, null::uuid, null::text
    from public.app_suborganization_timeline t
    where 'organization' = any (v_kinds)
      and pg_catalog.concat_ws(' ', t.title, t.summary) ilike all (v_pats)
  ),
  -- 업무 통화(app_feed_items source call)만. 개인 통화함 표는 읽지 않는다. 지운 통화 제외.
  -- 손으로 고친 값(app_call_edits)이 있으면 그 값(제목·상대·조직·핵심 줄). 원문(raw_text)은 찾지도 돌려주지도 않는다.
  calls as (
    select 'call'::text, 'call'::text, c.id, c.title, c.body, null::jsonb, c.occurred_at, c.day, null::text,
      c.project_id, c.org_id, null::uuid, null::text
    from (
      select f.id, f.occurred_at, f.day, f.project_id,
        coalesce(e.vals ->> 'title', f.title) as title,
        case when e.vals ? 'counterpart' then e.vals ->> 'counterpart' else f.counterpart end as counterpart,
        pg_catalog.concat_ws(' ', f.summary, (select pg_catalog.string_agg(x #>> '{}', ' ')
          from pg_catalog.jsonb_path_query(coalesce(e.vals -> 'points', f.points), '$[*] ? (@.type() == "string")') x)) as body,
        case when e.vals ? 'organization_id' then (e.vals ->> 'organization_id')::uuid else f.organization_id end as org_id
      from public.app_feed_items f
      left join public.app_call_edits e on e.call_id = f.id
      where 'call' = any (v_kinds) and f.source = 'call' and f.hidden_at is null
    ) c
    left join public.app_suborganizations o on o.id = c.org_id
    where pg_catalog.concat_ws(' ', c.title, c.counterpart, c.body, o.name) ilike all (v_pats)
  ),
  -- 텔레그램 소식: 방 이름·제목·요약(손으로 고친 요약 우선)·핵심 줄. 원문·보낸 사람 표는 읽지 않는다.
  -- 지운 소식, 그날 그 방 줄을 지운 날(app_feed_room_days.hidden_at)은 뺀다. 개인 텔레그램 표는 읽지 않는다.
  tgs as (
    select 'telegram'::text, 'telegram'::text, g.id, g.title, g.body, pg_catalog.jsonb_build_object('room', g.room_key), g.occurred_at, g.day, null::text,
      g.project_id, g.organization_id, null::uuid, null::text
    from (
      select f.id, f.occurred_at, f.day, f.project_id, f.organization_id, f.room_key,
        pg_catalog.concat_ws(' · ', f.room_label, f.title) as title,
        pg_catalog.concat_ws(' ', coalesce(se.vals ->> 'summary', f.summary), (select pg_catalog.string_agg(x #>> '{}', ' ')
          from pg_catalog.jsonb_path_query(f.points, '$[*] ? (@.type() == "string")') x)) as body
      from public.app_feed_items f
      left join public.app_feed_summary_edits se on se.workspace_id = f.workspace_id and se.target = 'item:' || f.id::text
      where 'telegram' = any (v_kinds) and f.source = 'telegram' and f.hidden_at is null
        and not exists (select 1 from public.app_feed_room_days rd
          where rd.workspace_id = f.workspace_id and rd.room_key = f.room_key and rd.day = f.day and rd.hidden_at is not null)
    ) g
    left join public.app_suborganizations o on o.id = g.organization_id
    where pg_catalog.concat_ws(' ', g.title, g.body, o.name) ilike all (v_pats)
  ),
  matched as (
    select * from notes union all select * from docs union all select * from meetings union all select * from projects
    union all select * from progress union all select * from milestones union all select * from orgs
    union all select * from org_updates union all select * from org_timeline
    union all select * from calls union all select * from tgs
  ),
  ranked as (
    select m.*, pg_catalog.row_number() over (partition by m.kind order by m.occurred_at desc nulls last, m.id) as rn,
      pg_catalog.count(*) over (partition by m.kind) as total
    from matched m
  ),
  page as (
    select r.*,
      -- 메모 연결(확정)은 이름순 첫 프로젝트·첫 조직만 보여 준다.
      coalesce(r.project_id, (select l.project_id from public.app_record_links l join public.app_spaces s on s.id = l.project_id
         where r.note_id is not null and l.note_id = r.note_id and l.status = 'confirmed' order by s.name, s.id limit 1)) as link_project,
      coalesce(r.organization_id, (select l.organization_id from public.app_record_links l join public.app_suborganizations o on o.id = l.organization_id
         where r.note_id is not null and l.note_id = r.note_id and l.status = 'confirmed' order by o.name, o.id limit 1)) as link_org,
      -- 첨부 안 글자: 메모는 사진 글자, 자료는 파일 안 글자.
      coalesce((select pg_catalog.string_agg(x #>> '{}', ' ') from pg_catalog.jsonb_path_query(coalesce(r.attach, '[]'::jsonb), '$[*].ocr ? (@.state == "done").text') x),
        r.file_text) as ocr_text
    from ranked r
    where r.rn > v_offset and r.rn <= v_offset + v_limit
  ),
  hit as (
    -- 본문에서 처음 찾은 낱말(입력 순서) 앞뒤 약 40자. 본문에 없고 첨부 안 글자(사진 글자·파일 안 글자)에 있으면 그 글자에서.
    select pg.*,
      (select pg_catalog.jsonb_build_array(f.place, f.pos, f.len) from (
         select 1 as rank, 'body' as place, pg_catalog.strpos(pg_catalog.lower(pg.body), pg_catalog.lower(w)) as pos, pg_catalog.char_length(w) as len, o
           from pg_catalog.unnest(v_words) with ordinality as x(w, o) where pg_catalog.strpos(pg_catalog.lower(pg.body), pg_catalog.lower(w)) > 0
         union all
         select 2, 'attachment', pg_catalog.strpos(pg_catalog.lower(pg.ocr_text), pg_catalog.lower(w)), pg_catalog.char_length(w), o
           from pg_catalog.unnest(v_words) with ordinality as x(w, o) where pg_catalog.strpos(pg_catalog.lower(pg.ocr_text), pg_catalog.lower(w)) > 0
         order by 1, 5 limit 1) f) as found
    from page pg
  ),
  items as (
    select h.kind, h.rn, pg_catalog.jsonb_build_object(
      'kind', h.kind, 'source', h.source, 'id', h.id, 'title', h.title,
      'matched_in', coalesce(h.found ->> 0, 'title'),
      'snippet', case when h.found is null then null else pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.substr(
          case h.found ->> 0 when 'body' then h.body else h.ocr_text end,
          greatest((h.found ->> 1)::integer - 40, 1),
          (h.found ->> 2)::integer + 80 + least((h.found ->> 1)::integer - 41, 0)), '\s+', ' ', 'g')) end,
      'occurred_at', h.occurred_at, 'day', h.day, 'state', h.state,
      'project_id', h.link_project, 'project_name', (select s.name from public.app_spaces s where s.id = h.link_project),
      'organization_id', h.link_org, 'organization_name', (select o.name from public.app_suborganizations o where o.id = h.link_org))
      -- 통화·텔레그램 줄에만: 요약·핵심 줄 앞 200자(물어보기 재료), 텔레그램은 방 번호(그 방·그날 소식을 여는 데 씀). 다른 종류의 줄 모양은 그대로다.
      || case when h.source in ('call', 'telegram') then pg_catalog.jsonb_build_object('summary', pg_catalog.left(h.body, 200)) else '{}'::jsonb end
      || case when h.source = 'telegram' then pg_catalog.jsonb_build_object('room_key', h.attach ->> 'room') else '{}'::jsonb end
      as item
    from hit h
  ),
  counts as (
    select r.kind, pg_catalog.max(r.total) as total from ranked r group by r.kind
  )
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'kind', k.kind,
      'total', least(coalesce(c.total, 0), 200),
      'capped', coalesce(c.total, 0) > 200,
      'offset', v_offset,
      'items', coalesce((select pg_catalog.jsonb_agg(i.item order by i.rn) from items i where i.kind = k.kind), '[]'::jsonb))
    order by k.o)
    into v_groups
  from pg_catalog.unnest(v_kinds) with ordinality as k(kind, o)
  left join counts c on c.kind = k.kind;

  return pg_catalog.jsonb_build_object('words', pg_catalog.to_jsonb(v_words), 'groups', coalesce(v_groups, '[]'::jsonb));
end;
$$;
revoke all on function public.app_search_records(text, text[], integer, integer, text) from public, anon, service_role;
grant execute on function public.app_search_records(text, text[], integer, integer, text) to authenticated;

-- 물어보기 답 저장(30일). 줄·근거 모양은 ai-assist가 만들고, 여기서는 크기·형식만 막는다.
create table public.app_ask_answers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  question text not null,
  lines jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  ai_status text not null,
  created_at timestamptz not null default now(),
  constraint app_ask_answers_question_check check (
    char_length(question) between 2 and 200 and question = btrim(question) and question !~ '[[:cntrl:]]'),
  constraint app_ask_answers_lines_check check (
    jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 6 and octet_length(lines::text) <= 8000),
  constraint app_ask_answers_sources_check check (
    jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 30 and octet_length(sources::text) <= 16000),
  constraint app_ask_answers_status_check check (ai_status in ('ok', 'empty', 'limit', 'failed'))
);
create index app_ask_answers_recent_idx on public.app_ask_answers(workspace_id, created_at desc);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기는 필요한 칸만.
alter table public.app_ask_answers enable row level security;
revoke all on table public.app_ask_answers from public, anon, authenticated, service_role;
grant select, delete on table public.app_ask_answers to authenticated;
grant insert (workspace_id, question, lines, sources, ai_status) on table public.app_ask_answers to authenticated;

create policy ask_answers_owner_all on public.app_ask_answers for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: 새 표 RLS 켜짐·정책 1개(authenticated만)·anon·service_role 권한 없음·고치기 없음, 검색 함수 실행권 authenticated만. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_ask_answers'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_ask_answers'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_ask_answers'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_ask_answers', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_ask_answers', 'update,truncate,references,trigger')
     or has_any_column_privilege('authenticated', 'public.app_ask_answers', 'update')
     or has_column_privilege('authenticated', 'public.app_ask_answers', 'created_at', 'insert')
     or has_column_privilege('authenticated', 'public.app_ask_answers', 'id', 'insert')
     or not has_column_privilege('authenticated', 'public.app_ask_answers', 'question', 'insert')
     or not has_table_privilege('authenticated', 'public.app_ask_answers', 'select,delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_ask_answers'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_ask_answers'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_ask_answers'::regclass and not tgisinternal)
     or has_function_privilege('anon', 'public.app_search_records(text,text[],integer,integer,text)', 'execute')
     or has_function_privilege('service_role', 'public.app_search_records(text,text[],integer,integer,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_search_records(text,text[],integer,integer,text)', 'execute') then
    raise exception 'ASK_WEB2_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029061500', 'ask_web2', array['ASK-Web2: public.app_search_records adds kinds call and telegram (named only; default 8 kinds unchanged; work calls only, no personal box, no raw text); same signature, SECURITY INVOKER, authenticated only. New table app_ask_answers (owner RLS, 30 days, select/insert 5 columns/delete for authenticated, no update)']);
commit;
