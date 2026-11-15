begin;
-- 20261023013000_search_attachment_text의 짝 되돌리기(SQL Editor 전용: 함수를 이전 판으로 다시 정의하므로 승인형 workflow rollback 모드 대상 아님).
-- 검색 함수를 20261022150000_search_records 원문 판(파일 안 글자를 찾지 않음)으로 되돌리고 이번 기록 1행만 지운다.
-- 표·자료·정책·권한·글자 칸(extracted_text)은 그대로다. 화면의 '파일 안 글자에서 찾음' 표시는 결과가 없어 나오지 않을 뿐이다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261023013000' and name = 'search_attachment_text') <> 1
     or (select count(*) from pg_proc where proname = 'app_search_records' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'SEARCH_ATTACHMENT_TEXT_ROLLBACK_BLOCKED: migration record or function differs';
  end if;
end
$$;

create or replace function public.app_search_records(p_query text, p_kinds text[], p_per_kind integer, p_offset integer, p_kind text)
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

delete from supabase_migrations.schema_migrations where version = '20261023013000' and name = 'search_attachment_text';
commit;
