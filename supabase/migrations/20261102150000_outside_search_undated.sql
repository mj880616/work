begin;
-- S48-18 바깥 성명 문장 찾기: 기간 거르기에서 '날짜 모름' 글을 받은 날짜로 거르던 것을 고친다(#1729 범위 밖 발견, 설계 docs/design/outside-statements.md 11절 끝).
-- 바꾸는 것: public.app_outside_search 하나의 본문 두 군데만(서명·반환 모양·SECURITY INVOKER·search_path·실행권 그대로).
--  1) 기간(p_from·p_to)은 게시 시각(published_at, 서울 날짜)만 본다. 게시 시각을 모르는 글은 기간을 고르면 빠지고, 기간이 없으면(전체) 나온다.
--     지금까지는 coalesce(published_at, fetched_at)이라 예전 글이 '받은 날'로 최근 기간에 섞여 나왔다.
--  2) 순서도 목록 화면과 같게: 게시 시각 최신 → 날짜 모름은 맨 아래(nulls last) → 받은 시각 최신.
-- 나머지 본문(원래 말 + 비슷한 말 6개, 퍼센트·밑줄·역빗금은 글자 그대로, 앞뒤 문장, 1~100건·건너뛰기 2000)은 20261031230000_outside_statements 원문 그대로.
-- 표·칸·정책·권한·자료는 한 줄도 바꾸지 않는다. 권한 확대 없음(anon·PUBLIC·service_role 실행권 없음, authenticated만 그대로).
-- 짝: docs/20261102150000_outside_search_undated.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261102150000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261031230000' and name = 'outside_statements') <> 1
     or to_regclass('public.app_outside_posts') is null
     or to_regclass('public.app_outside_sentences') is null
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'app_outside_search') <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_outside_search(text, text[], text[], date, date, integer, integer)')
         and not prosecdef and proconfig = array['search_path=""'] and prosrc like '%coalesce(p.published_at, p.fetched_at) at time zone%') <> 1 then
    raise exception 'OUTSIDE_SEARCH_UNDATED_PREREQUISITE_CHANGED; stop';
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
    and (p_from is null or (p.published_at is not null and (p.published_at at time zone 'Asia/Seoul')::date >= p_from))
    and (p_to is null or (p.published_at is not null and (p.published_at at time zone 'Asia/Seoul')::date <= p_to))
  order by p.published_at desc nulls last, p.fetched_at desc, s.post_id, s.idx
  limit v_limit offset v_offset;
end
$search$;
revoke all on function public.app_outside_search(text, text[], text[], date, date, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_outside_search(text, text[], text[], date, date, integer, integer) to authenticated;

-- 사후 확인: 새 모양·INVOKER·search_path 고정·authenticated만 실행. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('public.app_outside_search(text, text[], text[], date, date, integer, integer)')
      and not prosecdef and proconfig = array['search_path=""'] and prosrc like '%p.published_at is not null and (p.published_at at time zone%' and prosrc like '%order by p.published_at desc nulls last%' and prosrc not like '%coalesce(p.published_at, p.fetched_at)%') <> 1
     or not has_function_privilege('authenticated', 'public.app_outside_search(text, text[], text[], date, date, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.app_outside_search(text, text[], text[], date, date, integer, integer)', 'execute')
     or exists (select 1 from pg_proc where oid = to_regprocedure('public.app_outside_search(text, text[], text[], date, date, integer, integer)')
         and proacl::text ~ '(^|[{,])(anon|service_role)?=') then
    raise exception 'OUTSIDE_SEARCH_UNDATED_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261102150000', 'outside_search_undated', array['S48-18 바깥 성명 문장 찾기: app_outside_search 기간 거르기는 게시 시각만(날짜 모름 글은 기간을 고르면 빠짐), 순서 게시 시각 최신·날짜 모름 맨 아래 (INVOKER·authenticated만 그대로)']);
commit;
