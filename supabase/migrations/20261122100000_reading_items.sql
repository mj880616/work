begin;
-- S68-09 READ-읽을거리함 PR-1 DB(명진 11/22 13:28 "Raindrop 가져올 것 ㄱ", 13:42 위치 "B: 메뉴에 새 칸"). 1~3번: 읽을 거리함·원문 사본 보관·밑줄·메모, 4번 검색.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(확장 규칙에서 거절되면 AGENTS.md 7절 SQL Editor 경로)으로만 한다. 이 브랜치는 적용 직전 정지.
-- 순서: 이 DB 적용 → 화면·폰 공유 창(PR-3). 원문 받아 오기는 기존 Edge note-import(노트 '주소로 가져오기', 읽기 전용·로그인 owner만·
--   내부 주소 차단·크기·시간·리다이렉트·robots 검사)를 그대로 부르므로 새 Edge 함수·배포가 없다(지시서 PR-2는 재사용으로 없어짐).
--
-- 같은 목적 표 재사용 검토(PR 본문에 같은 내용):
--  · 밑줄·메모 = 기존 app_news_highlights 재사용(새 표 없음). 노트 밑줄(S62-17, 20261115194000)과 같은 방식으로 종류 칸 검사에 'reading'만 더한다.
--    그래서 노트 [밑줄] 모음·[노트로]·메모 수정·삭제를 같은 부품(app/text-highlights.js)으로 쓴다.
--  · 읽을 거리 한 줄 = 새 표 app_reading_items. News 공용 기사(app_news_articles·app_news_marks·app_news_reads, 'WORK ON+ News 보관')는
--    운영자 기능 키 'outside'로만 서버가 받는다(S63-03, 명진 11/16 "완성도 높아지면 그 때 열자"). 모든 사람의 읽을 거리를 그 표에 넣으면
--    News 서버 문을 모두에게 다시 여는 것이 되므로 쓰지 않는다. 공용 한 벌이 아니라 작업공간마다 자기 사본(owner만)이다.
--  · 사업 연결 = 사업 보고 꼬리표와 같은 방식(app_meetings.business_area_id, 20261028191500): app_spaces 한 행을 가리키는 칸 + 같은 작업공간 검사
--    (private.app_space_in_workspace). 메모 연결 표(app_record_links)는 출처가 할 일·노트 둘로 묶여 있어(검사 one_source) 바꾸지 않는다.
--
--  1) public.app_reading_items(새): 작업공간마다 저장한 글 한 줄. 주소(같은 작업공간에 같은 주소 한 줄)·제목·사이트·저장 시각·읽은 시각·
--     원문 사본(본문 글자 body, 상태 body_state, 받은 시각 body_at)·사업영역(business_area_id → app_spaces, 지워지면 비움).
--     화면(authenticated): 자기 줄 읽기·넣기(주소·제목·사이트·사업영역)·고치기(제목·사이트·읽음·사업영역·원문 사본)·지우기. 작업공간·주소 칸은 못 고친다.
--     원문 사본은 화면이 note-import 답(글자 블록)을 글자로만 넣는다(HTML 없음, 제어 문자 거절). service_role 권한 없음.
--  2) app_news_highlights_type_check에 'reading'(읽을 거리 = app_reading_items.id)을 더한다. 지우고 같은 이름으로 다시(다른 칸·권한·정책 그대로).
--  3) public.app_search_records를 같은 서명·같은 권한 모양(SECURITY INVOKER·search_path 빈칸·authenticated만)으로 다시 정의해 종류 'reading'을 더한다.
--     통화·텔레그램처럼 이름으로 부를 때만 찾는다(빈 종류 = 지금 8종류 그대로). 물어보기(ai-assist)·지금 자세히는 종류를 이름으로 정해 부르므로 읽을 거리가 섞이지 않는다.
--
-- 권한: 새 표 RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책 1개(authenticated만). anon·PUBLIC·service_role 권한 없음. 공유(app_collab_*) 대상 아님.
-- 안 하는 것: 기존 표의 칸·권한·정책·트리거 변경, 기존 줄 변경, News 표, 함수 추가, 확장 추가, rtw_* 객체.
-- 되돌리기: docs/20261122100000_reading_items.rollback.sql(SQL Editor 전용: 검색 함수를 이전 판으로, 검사를 이전 넷으로, 새 표 삭제).
-- 짝: docs/20261122100000_reading_items.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다. 검색 함수는 20261029061500 원문 판(길이·해시 같음)이어야 한다(되돌리기가 그 판으로 돌아가므로).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261122100000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029061500' and name = 'ask_web2') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115194000' and name = 'news_highlights_note') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_spaces') is null
     or to_regclass('public.app_reading_items') is not null
     or to_regclass('public.app_news_highlights') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_news_highlights'::regclass
         and conname = 'app_news_highlights_type_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''note''' and pg_get_constraintdef(oid) !~ '''reading''') <> 1
     or (select count(*) from pg_proc where proname = 'app_search_records' and pronamespace = 'public'::regnamespace) <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_search_records(text,text[],integer,integer,text)')
         and not prosecdef and provolatile = 's' and proconfig = array['search_path=""']
         and length(prosrc) = 15146 and md5(prosrc) = '10498473a70dbfbe5e22d0361ae29745')
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or to_regprocedure('private.app_space_in_workspace(uuid,uuid)') is null then
    raise exception 'READING_ITEMS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 읽을 거리.
create table public.app_reading_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  url text not null,
  title text,
  site text,
  saved_at timestamptz not null default now(),
  read_at timestamptz,
  body text,
  body_state text not null default 'pending',
  body_at timestamptz,
  business_area_id uuid
    constraint app_reading_items_business_area_id_fkey references public.app_spaces(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_reading_items_url_unique unique (workspace_id, url),
  constraint app_reading_items_url_check check (
    url ~ '^https?://[^[:space:][:cntrl:]]+$' and char_length(url) <= 2000),
  constraint app_reading_items_text_check check (
    (title is null or (char_length(title) between 1 and 500 and title !~ '[[:cntrl:]]'))
    and (site is null or (char_length(site) between 1 and 120 and site !~ '[[:cntrl:]]'))),
  -- 원문 사본 상태: pending(아직) · ok(본문) · paywall(공개 리드만) · bot_check · robots · too_big · blocked(주소 규칙 밖) · failed.
  constraint app_reading_items_body_state_check check (
    body_state in ('pending', 'ok', 'paywall', 'bot_check', 'robots', 'too_big', 'blocked', 'failed')),
  -- 본문은 ok·paywall일 때만, 20만 자 안쪽(줄바꿈·탭만 허용하는 글자). 받은 시각은 pending이 아닐 때만.
  constraint app_reading_items_body_check check (
    (body is null or (body_state in ('ok', 'paywall') and char_length(body) between 1 and 200000
      and body !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'))
    and ((body_at is null) = (body_state = 'pending')))
);
create index app_reading_items_list_idx on public.app_reading_items(workspace_id, saved_at desc);
create index app_reading_items_unread_idx on public.app_reading_items(workspace_id, saved_at desc) where read_at is null;
create index app_reading_items_area_idx on public.app_reading_items(business_area_id) where business_area_id is not null;

alter table public.app_reading_items enable row level security;
revoke all on table public.app_reading_items from public, anon, authenticated, service_role;
-- 화면: 자기 줄 읽기·지우기, 넣기는 주소·제목·사이트·사업영역(작업공간 칸 포함), 고치기는 제목·사이트·읽음·사업영역·원문 사본. 작업공간·주소·저장 시각은 못 고친다.
grant select, delete on table public.app_reading_items to authenticated;
grant insert (workspace_id, url, title, site, business_area_id) on table public.app_reading_items to authenticated;
grant update (title, site, read_at, business_area_id, body, body_state, body_at, updated_at) on table public.app_reading_items to authenticated;

create policy reading_items_owner_all on public.app_reading_items for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (business_area_id is null or private.app_space_in_workspace(business_area_id, workspace_id)));

-- 2) 밑줄 종류에 읽을 거리.
alter table public.app_news_highlights drop constraint app_news_highlights_type_check;
alter table public.app_news_highlights add constraint app_news_highlights_type_check
  check (source_type in ('news', 'outside', 'telegram', 'note', 'reading'));

-- 3) 전체 검색. 반환 jsonb 계약은 docs/design/global-search.md "S-1 결과 계약" 절·8절, 종류 call·telegram은 docs/design/ask-web2.md 5절, reading은 이 파일 머리.
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
  -- 읽을 거리(S68-09 READ-읽을거리함): 저장한 글의 제목·사이트·주소·원문 사본. 이름으로 부를 때만 찾는다(물어보기·지금 자세히 재료에 섞이지 않게).
  v_known text[] := array['update', 'note', 'work', 'document', 'meeting', 'project', 'organization', 'milestone', 'call', 'telegram', 'reading'];
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
  -- 읽을 거리: 제목(없으면 주소)·사이트·주소·받아 둔 원문 사본(ok·paywall만). 사업영역 꼬리표는 프로젝트 칸으로 보인다.
  readings as (
    select 'reading'::text, 'reading'::text, r.id, coalesce(r.title, r.url),
      case when r.body_state in ('ok', 'paywall') then r.body end, null::jsonb,
      r.saved_at, null::date, null::text, r.business_area_id, null::uuid, null::uuid, null::text
    from public.app_reading_items r
    where 'reading' = any (v_kinds)
      and pg_catalog.concat_ws(' ', r.title, r.site, r.url, case when r.body_state in ('ok', 'paywall') then r.body end) ilike all (v_pats)
  ),
  matched as (
    select * from notes union all select * from docs union all select * from meetings union all select * from projects
    union all select * from progress union all select * from milestones union all select * from orgs
    union all select * from org_updates union all select * from org_timeline
    union all select * from calls union all select * from tgs union all select * from readings
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

-- 사후 확인: 새 표 RLS 켜짐·정책 1개(authenticated만)·anon·PUBLIC 권한 없음, 밑줄 검사 1개(다섯), 검색 함수 하나(INVOKER·authenticated만). 다르면 전체 취소.
do $$
declare t regclass := 'public.app_reading_items'::regclass; h regclass := 'public.app_news_highlights'::regclass;
  f regprocedure := to_regprocedure('public.app_search_records(text,text[],integer,integer,text)');
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
     or has_column_privilege('authenticated', t, 'body', 'insert') or not has_column_privilege('authenticated', t, 'body', 'update')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update') or has_column_privilege('authenticated', t, 'url', 'update')
     or has_column_privilege('authenticated', t, 'saved_at', 'update') or has_column_privilege('authenticated', t, 'id', 'insert')
     or not has_table_privilege('authenticated', t, 'select') or not has_table_privilege('authenticated', t, 'delete')
     or has_table_privilege('service_role', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', t, 'select,insert,update,references')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or exists (select 1 from pg_trigger where tgrelid = t and not tgisinternal)
     or (select count(*) from pg_constraint where conrelid = h and conname = 'app_news_highlights_type_check' and contype = 'c'
        and pg_get_constraintdef(oid) ~ '''reading''' and pg_get_constraintdef(oid) ~ '''note''' and pg_get_constraintdef(oid) ~ '''telegram''') <> 1
     or not (select relrowsecurity from pg_class where oid = h)
     or (select count(*) from pg_policy where polrelid = h) <> 1
     or f is null
     or (select count(*) from pg_proc where proname = 'app_search_records' and pronamespace = 'public'::regnamespace) <> 1
     or exists (select 1 from pg_proc where oid = f and (prosecdef or provolatile <> 's' or proconfig is distinct from array['search_path=""']))
     or has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')
     or not has_function_privilege('authenticated', f, 'execute') then
    raise exception 'READING_ITEMS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261122100000', 'reading_items', array['S68-09 READ-읽을거리함: new owner-only table app_reading_items (RLS, authenticated read/delete and limited insert/update columns, no anon/PUBLIC/service_role), app_news_highlights_type_check adds reading, app_search_records adds named-only kind reading (same signature, SECURITY INVOKER, authenticated only)']);
commit;
