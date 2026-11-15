begin;
-- 20261102150000_outside_search_undated의 짝 되돌리기. SQL Editor(폰 경로 C) 전용: 새 쿼리 창(+)에 붙여 넣고 첫 줄 begin;·마지막 줄 commit;·대상 프로젝트를 확인한 뒤 실행한다.
-- 이전 함수를 OR REPLACE로 되살리는 되돌리기라 승인형 workflow rollback 버튼은 쓰지 않는다(docs/ops-db-workflow.md).
-- public.app_outside_search를 20261031230000_outside_statements 원문(받은 시각으로도 거르기)으로 되돌리고 이번 기록 1행만 지운다. 자료는 바꾸지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261102150000' and name = 'outside_search_undated') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_outside_search(text, text[], text[], date, date, integer, integer)') and prosrc like '%p.published_at is not null and (p.published_at at time zone%' and prosrc like '%order by p.published_at desc nulls last%' and prosrc not like '%coalesce(p.published_at, p.fetched_at)%') <> 1 then
    raise exception 'OUTSIDE_SEARCH_UNDATED_ROLLBACK_BLOCKED: migration record or function shape differs';
  end if;
end
$$;

create or replace function public.app_outside_search(
  p_query text, p_terms text[], p_sources text[], p_from date, p_to date, p_limit integer, p_offset integer)
returns table (
  post_id uuid, source_key text, kind text, lang text, title text, url text, published_at timestamptz,
  idx integer, sentence text, prev_sentence text, next_sentence text, matched text, is_similar boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $search$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_terms text[];
  v_pats text[];
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 2000);
begin
  if char_length(v_query) not between 1 and 100 then
    return;
  end if;
  select array_agg(t order by o) into v_terms from (
    select distinct on (lower(t)) t, o from (
      select v_query as t, 0::bigint as o
      union all
      select btrim(x), u.o from unnest(coalesce(p_terms, array[]::text[])) with ordinality u(x, o)
        where x is not null and char_length(btrim(x)) between 1 and 100
    ) a order by lower(t), o
  ) b where o <= 6 or o = 0;
  v_terms := v_terms[1:7];
  select array_agg('%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%' order by o)
    into v_pats from unnest(v_terms) with ordinality u(t, o);

  return query
  select s.post_id, p.source_key, p.kind, p.lang, p.title, p.url, p.published_at, s.idx, s.text,
    (select q.text from public.app_outside_sentences q where q.post_id = s.post_id and q.idx = s.idx - 1),
    (select q.text from public.app_outside_sentences q where q.post_id = s.post_id and q.idx = s.idx + 1),
    m.t, m.o > 1
  from public.app_outside_sentences s
  join public.app_outside_posts p on p.id = s.post_id and p.workspace_id = s.workspace_id
  cross join lateral (
    select v_terms[u.o] as t, u.o from unnest(v_pats) with ordinality u(pat, o)
      where s.text ilike u.pat order by u.o limit 1
  ) m
  where (p_sources is null or cardinality(p_sources) = 0 or p.source_key = any(p_sources))
    and (p_from is null or (coalesce(p.published_at, p.fetched_at) at time zone 'Asia/Seoul')::date >= p_from)
    and (p_to is null or (coalesce(p.published_at, p.fetched_at) at time zone 'Asia/Seoul')::date <= p_to)
  order by coalesce(p.published_at, p.fetched_at) desc, s.post_id, s.idx
  limit v_limit offset v_offset;
end
$search$;
revoke all on function public.app_outside_search(text, text[], text[], date, date, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_outside_search(text, text[], text[], date, date, integer, integer) to authenticated;

delete from supabase_migrations.schema_migrations where version = '20261102150000' and name = 'outside_search_undated';
commit;
