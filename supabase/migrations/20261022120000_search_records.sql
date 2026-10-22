begin;
-- SEARCH-전체검색 S-1a(docs/design/global-search.md 2.3, 결정 8개 추천안 승인 2026-10-22).
-- 검색 함수 public.app_search_records 하나만 만든다. 표·정책·권한·기존 함수·자료 변경 없음.
-- SECURITY INVOKER: 기존 owner RLS가 그대로 걸린다(원장 검색 app_ledger_search와 같은 모양).
-- 일기(app_notes.kind='diary')는 함수 안에서 허용 목록(basket·note·work)으로 막는다. 종류 인자에도 diary가 없다.
-- 실행 권한: authenticated만(PUBLIC·anon·service_role 회수).
-- pg_trgm 색인은 넣지 않는다: 이 함수는 INVOKER라 authenticated에 RLS가 걸리고, ILIKE는 leakproof가 아니라서
-- PostgreSQL이 RLS 조건보다 먼저 색인 조건으로 쓰지 못한다(로컬 PostgreSQL 17에서 확인, 순차 훑기). 1인 사용 표 크기에서는 순차 훑기로 충분하다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(칸이 없으면 검색 중 오류가 나므로 적용 전에 멈춤).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022120000')
     or exists (select 1 from pg_proc where proname = 'app_search_records' and pronamespace = 'public'::regnamespace)
     or not exists (select 1 from pg_proc where proname = 'app_is_workspace_owner' and pronamespace = 'private'::regnamespace)
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_notes') and not attisdropped
         and attname in ('id', 'kind', 'title', 'raw_text', 'attachments', 'archived_at', 'occurred_at', 'journal_day')) <> 8
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_record_links') and not attisdropped
         and attname in ('note_id', 'project_id', 'organization_id', 'status')) <> 4
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_documents') and not attisdropped
         and attname in ('id', 'title', 'file_name', 'source', 'category', 'tags', 'description', 'document_date', 'created_at',
                         'project_id', 'organization_id')) <> 11
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_meetings') and not attisdropped
         and attname in ('id', 'title', 'series_name', 'meeting_at', 'transcript_text', 'decisions', 'created_at', 'project_id')) <> 8
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_spaces') and not attisdropped
         and attname in ('id', 'name', 'status', 'metadata', 'updated_at')) <> 5
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_project_progress_updates') and not attisdropped
         and attname in ('id', 'project_id', 'summary', 'next_step', 'status_label', 'effective_on')) <> 6
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_project_milestones') and not attisdropped
         and attname in ('id', 'project_id', 'title', 'status', 'start_at')) <> 5
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_suborganizations') and not attisdropped
         and attname in ('id', 'name', 'aliases', 'description', 'updated_at')) <> 5
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_suborganization_updates') and not attisdropped
         and attname in ('id', 'organization_id', 'raw_text', 'detail_text', 'occurred_at')) <> 5
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_suborganization_timeline') and not attisdropped
         and attname in ('id', 'organization_id', 'title', 'summary', 'event_date', 'event_year')) <> 6
     -- 결과 id는 모두 uuid여야 한다.
     or exists (select 1 from pg_attribute where not attisdropped and attname = 'id' and atttypid <> 'uuid'::regtype
         and attrelid in (to_regclass('public.app_notes'), to_regclass('public.app_documents'), to_regclass('public.app_meetings'),
                          to_regclass('public.app_spaces'), to_regclass('public.app_project_progress_updates'),
                          to_regclass('public.app_project_milestones'), to_regclass('public.app_suborganizations'),
                          to_regclass('public.app_suborganization_updates'), to_regclass('public.app_suborganization_timeline')))
     -- 날짜 칸은 date·timestamp·timestamptz여야 한다(글자 칸이면 검색 중 변환 오류가 날 수 있어 멈춤).
     or exists (select 1 from pg_attribute where not attisdropped
         and atttypid not in ('date'::regtype, 'timestamp'::regtype, 'timestamptz'::regtype)
         and (attrelid, attname) in ((to_regclass('public.app_notes'), 'occurred_at'), (to_regclass('public.app_notes'), 'journal_day'),
           (to_regclass('public.app_documents'), 'document_date'), (to_regclass('public.app_documents'), 'created_at'),
           (to_regclass('public.app_meetings'), 'meeting_at'), (to_regclass('public.app_meetings'), 'created_at'),
           (to_regclass('public.app_spaces'), 'updated_at'), (to_regclass('public.app_project_progress_updates'), 'effective_on'),
           (to_regclass('public.app_project_milestones'), 'start_at'), (to_regclass('public.app_suborganizations'), 'updated_at'),
           (to_regclass('public.app_suborganization_updates'), 'occurred_at'), (to_regclass('public.app_suborganization_timeline'), 'event_date')))
     -- 검색 대상 표는 모두 RLS가 켜져 있어야 한다(INVOKER 함수가 기존 경계를 그대로 쓰는 전제).
     or (select count(*) from pg_class where relrowsecurity
         and oid in (to_regclass('public.app_notes'), to_regclass('public.app_record_links'), to_regclass('public.app_documents'),
                     to_regclass('public.app_meetings'), to_regclass('public.app_spaces'), to_regclass('public.app_project_progress_updates'),
                     to_regclass('public.app_project_milestones'), to_regclass('public.app_suborganizations'),
                     to_regclass('public.app_suborganization_updates'), to_regclass('public.app_suborganization_timeline'))) <> 10 then
    raise exception 'SEARCH_RECORDS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 전체 검색. 반환 jsonb 계약은 docs/design/global-search.md "S-1 결과 계약" 절.
-- p_query: 공백으로 나눈 낱말 1~6개(모두 포함 = AND), 낱말마다 2글자 이상, 전체 200자 이하, 제어문자 불가.
-- p_kinds: null이면 전체 종류. p_kind: 한 종류만 p_offset부터 더 보기(이때 p_kinds는 null).
-- p_per_kind: 1~50(null이면 3). p_offset: 0~199(null이면 0, p_kind 없이 0만). 종류별 건수는 200에서 멈춘다(capped).
create function public.app_search_records(p_query text, p_kinds text[], p_per_kind integer, p_offset integer, p_kind text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_all text[] := array['update', 'note', 'work', 'document', 'meeting', 'project', 'organization', 'milestone'];
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
    if p_kinds is not null or not p_kind = any (v_all) then
      raise exception using errcode = '22023', message = 'SEARCH_BAD_KIND';
    end if;
    v_kinds := array[p_kind];
  elsif p_kinds is null then
    v_kinds := v_all;
  else
    if pg_catalog.cardinality(p_kinds) = 0 or not p_kinds <@ v_all then
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
      null::uuid as project_id, null::uuid as organization_id, n.id as note_id
    from public.app_notes n
    where n.kind in ('basket', 'note', 'work') and n.kind = any (v_note_kinds)
      -- 사진 글자는 읽기가 끝난(state done) 것만 찾는다.
      and (coalesce(n.title, '') || ' ' || n.raw_text || ' ' || coalesce(pg_catalog.jsonb_path_query_array(n.attachments, '$[*].ocr ? (@.state == "done").text')::text, '')) ilike all (v_pats)
  ),
  docs as (
    select 'document'::text, 'document'::text, d.id, coalesce(d.title, d.file_name),
      pg_catalog.concat_ws(' ', d.description, d.source, d.category, d.tags::text, d.file_name), null::jsonb,
      coalesce(d.document_date::timestamptz, d.created_at::timestamptz), null::date, null::text, d.project_id, d.organization_id, null::uuid
    from public.app_documents d
    where 'document' = any (v_kinds)
      and pg_catalog.concat_ws(' ', d.title, d.file_name, d.source, d.category, d.tags::text, d.description) ilike all (v_pats)
  ),
  meetings as (
    select 'meeting'::text, 'meeting'::text, m.id, coalesce(m.title, m.series_name),
      pg_catalog.concat_ws(' ', m.transcript_text, m.decisions::text), null::jsonb,
      coalesce(m.meeting_at::timestamptz, m.created_at::timestamptz), null::date, null::text, m.project_id, null::uuid, null::uuid
    from public.app_meetings m
    where 'meeting' = any (v_kinds)
      and pg_catalog.concat_ws(' ', m.title, m.series_name, m.transcript_text, m.decisions::text) ilike all (v_pats)
  ),
  projects as (
    select 'project'::text, 'project'::text, s.id, s.name, null::text, null::jsonb, s.updated_at::timestamptz, null::date,
      case when s.status in ('done', 'completed') then 'done' end, s.id, null::uuid, null::uuid
    from public.app_spaces s
    where 'project' = any (v_kinds) and s.status is distinct from 'archived'
      and (s.metadata ->> 'project_system' = 'v2' or s.metadata ->> 'management_version' = '2')
      and coalesce(s.name, '') ilike all (v_pats)
  ),
  progress as (
    select 'project'::text, 'progress'::text, p.id, s.name, pg_catalog.concat_ws(' ', p.status_label, p.summary, p.next_step), null::jsonb,
      p.effective_on::timestamptz, null::date, case when s.status in ('done', 'completed') then 'done' end, p.project_id, null::uuid, null::uuid
    from public.app_project_progress_updates p
    join public.app_spaces s on s.id = p.project_id and s.status is distinct from 'archived'
    where 'project' = any (v_kinds)
      and pg_catalog.concat_ws(' ', p.status_label, p.summary, p.next_step) ilike all (v_pats)
  ),
  milestones as (
    select 'milestone'::text, 'milestone'::text, ms.id, ms.title, null::text, null::jsonb, ms.start_at::timestamptz, null::date,
      case when ms.status in ('done', 'completed') then 'done' when ms.status in ('cancelled', 'canceled') then 'cancelled' end,
      ms.project_id, null::uuid, null::uuid
    from public.app_project_milestones ms
    join public.app_spaces s on s.id = ms.project_id and s.status is distinct from 'archived'
    where 'milestone' = any (v_kinds) and coalesce(ms.title, '') ilike all (v_pats)
  ),
  orgs as (
    select 'organization'::text, 'organization'::text, o.id, o.name, pg_catalog.concat_ws(' ', o.aliases::text, o.description), null::jsonb,
      o.updated_at::timestamptz, null::date, null::text, null::uuid, o.id, null::uuid
    from public.app_suborganizations o
    where 'organization' = any (v_kinds)
      and pg_catalog.concat_ws(' ', o.name, o.aliases::text, o.description) ilike all (v_pats)
  ),
  org_updates as (
    select 'organization'::text, 'org_update'::text, u.id, o.name, pg_catalog.concat_ws(' ', u.raw_text, u.detail_text), null::jsonb,
      u.occurred_at::timestamptz, null::date, null::text, null::uuid, u.organization_id, null::uuid
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
      null::uuid, t.organization_id, null::uuid
    from public.app_suborganization_timeline t
    where 'organization' = any (v_kinds)
      and pg_catalog.concat_ws(' ', t.title, t.summary) ilike all (v_pats)
  ),
  matched as (
    select * from notes union all select * from docs union all select * from meetings union all select * from projects
    union all select * from progress union all select * from milestones union all select * from orgs
    union all select * from org_updates union all select * from org_timeline
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
      (select pg_catalog.string_agg(x #>> '{}', ' ') from pg_catalog.jsonb_path_query(coalesce(r.attach, '[]'::jsonb), '$[*].ocr ? (@.state == "done").text') x) as ocr_text
    from ranked r
    where r.rn > v_offset and r.rn <= v_offset + v_limit
  ),
  hit as (
    -- 본문에서 처음 찾은 낱말(입력 순서) 앞뒤 약 40자. 본문에 없고 사진 글자에 있으면 그 글자에서.
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
      'organization_id', h.link_org, 'organization_name', (select o.name from public.app_suborganizations o where o.id = h.link_org)) as item
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

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022120000', 'search_records', array['SEARCH S-1a: public.app_search_records (SECURITY INVOKER, search_path empty, authenticated only; diary excluded inside; no table, policy or grant change)']);
commit;
