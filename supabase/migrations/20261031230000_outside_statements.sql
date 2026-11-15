begin;
-- S46-32 바깥 성명 ① DB (요청함 10/31 12:45, 명진 답 10/31 22:35). 설계: docs/design/outside-statements.md 3.1절·7절 ②.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  1) app_outside_sources: 작업공간마다 켠 단체(카탈로그 키)와 켜짐 여부, 마지막으로 읽은 시각·실패 코드.
--     화면은 자기 작업공간 줄을 넣고·켜고 끄고·지운다. 읽은 시각·실패 코드는 수집기(service_role)만 쓴다.
--     읽을 주소는 저장하지 않는다(서버 코드 카탈로그만 읽음 — 화면이 넣은 주소를 서버가 읽는 길 없음).
--  2) app_outside_posts: 들어온 글 한 건(제목·단체·종류·언어·원문 주소·게시 시각·한국어 요약, 외국 글은 핵심 문장 3개까지).
--     작업공간마다 원문 주소는 한 번만. 넣기·고치기는 수집기(service_role)만, 화면은 읽기만.
--  3) app_outside_sentences: 국내 글 본문을 문장 단위로(문장마다 500자 안쪽). 외국 글(lang='en')은 행을 만들 수 없다
--     (글 표의 (id, workspace_id, lang)에 대한 외래 키 + 이 표 lang='ko' 검사 — 외국 전문 저장 금지를 DB가 막음).
--  4) app_outside_seen: 작업공간마다 1행, 화면 [새로 온 것]을 마지막으로 본 시각(저녁 '새 성명 n건' 기준).
--     설계 3.1은 app_profiles 칸을 추천했으나, 기존 표에 열·권한을 더하지 않으려고 작은 새 표로 바꿨다.
--  5) public.app_outside_search(...): 문장 찾기. SECURITY INVOKER(위 RLS 그대로), authenticated만 실행, search_path 고정.
--     원래 말 + 비슷한 말(최대 6개)을 ILIKE로 찾아, 일치한 문장과 앞뒤 한 문장·글 정보·어느 말로 찾았는지를 돌려준다.
--     '내 성명 함께'는 이미 있는 app_search_records(자료실)를 화면이 함께 부른다(같은 목적 함수를 새로 만들지 않음).
--
-- 권한: 네 표 모두 RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책(authenticated만). anon·PUBLIC 권한 없음.
--   authenticated: sources 읽기·지우기·넣기(workspace_id, source_key, enabled)·고치기(enabled, updated_at),
--                  posts·sentences 읽기만, seen 읽기·넣기(workspace_id, seen_at)·고치기(seen_at, updated_at).
--   service_role(Edge outside-feed): 네 표 select·insert·update·delete 넷만.
-- 안 하는 것: 기존 표·열·정책·권한·함수 변경, 확장 추가, 읽생기 표.
-- 짝: docs/20261031230000_outside_statements.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261031230000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_outside_sources') is not null
     or to_regclass('public.app_outside_posts') is not null
     or to_regclass('public.app_outside_sentences') is not null
     or to_regclass('public.app_outside_seen') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'app_outside_search')
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'OUTSIDE_STATEMENTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_outside_sources (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source_key text not null,
  enabled boolean not null default true,
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, source_key),
  constraint app_outside_sources_key_check check (source_key ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  constraint app_outside_sources_error_check check (last_error is null or last_error ~ '^[a-z0-9_-]{1,40}$')
);

create table public.app_outside_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source_key text not null,
  kind text not null,
  lang text not null,
  title text not null,
  title_ko text,
  author text,
  url text not null,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  summary_ko text,
  key_sentences jsonb not null default '[]'::jsonb,
  has_body boolean not null default false,
  constraint app_outside_posts_url_unique unique (workspace_id, url),
  constraint app_outside_posts_lang_ref unique (id, workspace_id, lang),
  constraint app_outside_posts_key_check check (source_key ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  constraint app_outside_posts_kind_check check (kind in ('statement', 'comment', 'press', 'article')),
  constraint app_outside_posts_lang_check check (lang in ('ko', 'en')),
  constraint app_outside_posts_title_check check (
    char_length(title) between 1 and 500 and title !~ '[[:cntrl:]]'
    and (title_ko is null or (char_length(title_ko) between 1 and 500 and title_ko !~ '[[:cntrl:]]'))
    and (author is null or (char_length(author) between 1 and 200 and author !~ '[[:cntrl:]]'))),
  constraint app_outside_posts_url_check check (url ~ '^https?://[^[:space:]]+$' and char_length(url) <= 2000),
  constraint app_outside_posts_summary_check check (summary_ko is null or char_length(summary_ko) between 1 and 2000),
  -- 핵심 문장: 외국 글만, 3개까지, 각각 {"orig": 원문, "ko": 번역} 글자 1~300자. 국내 글과 has_body는 함께 쓰지 않는다.
  constraint app_outside_posts_key_sentences_check check (
    jsonb_typeof(key_sentences) = 'array' and jsonb_array_length(key_sentences) <= 3
    and (lang = 'en' or jsonb_array_length(key_sentences) = 0)
    and not jsonb_path_exists(key_sentences,
      '$[*] ? (@.type() != "object" || !(@.orig.type() == "string") || !(@.ko.type() == "string")
              || !(@.orig like_regex "^.{1,150}.{0,150}$" flag "s") || !(@.ko like_regex "^.{1,150}.{0,150}$" flag "s"))')),
  constraint app_outside_posts_body_check check (lang = 'ko' or not has_body)
);
create index app_outside_posts_list_idx on public.app_outside_posts(workspace_id, fetched_at desc);
create index app_outside_posts_source_idx on public.app_outside_posts(workspace_id, source_key, published_at desc);

create table public.app_outside_sentences (
  post_id uuid not null,
  workspace_id uuid not null,
  lang text not null default 'ko',
  idx integer not null,
  text text not null,
  primary key (post_id, idx),
  constraint app_outside_sentences_post_fk foreign key (post_id, workspace_id, lang)
    references public.app_outside_posts(id, workspace_id, lang) on delete cascade,
  constraint app_outside_sentences_lang_check check (lang = 'ko'),
  constraint app_outside_sentences_idx_check check (idx between 0 and 3000),
  constraint app_outside_sentences_text_check check (char_length(text) between 1 and 500)
);
create index app_outside_sentences_ws_idx on public.app_outside_sentences(workspace_id);

create table public.app_outside_seen (
  workspace_id uuid primary key references public.app_workspaces(id) on delete cascade,
  seen_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.app_outside_sources enable row level security;
alter table public.app_outside_posts enable row level security;
alter table public.app_outside_sentences enable row level security;
alter table public.app_outside_seen enable row level security;
revoke all on table public.app_outside_sources from public, anon, authenticated, service_role;
revoke all on table public.app_outside_posts from public, anon, authenticated, service_role;
revoke all on table public.app_outside_sentences from public, anon, authenticated, service_role;
revoke all on table public.app_outside_seen from public, anon, authenticated, service_role;

grant select, delete on table public.app_outside_sources to authenticated;
grant insert (workspace_id, source_key, enabled) on table public.app_outside_sources to authenticated;
grant update (enabled, updated_at) on table public.app_outside_sources to authenticated;
grant select on table public.app_outside_posts to authenticated;
grant select on table public.app_outside_sentences to authenticated;
grant select on table public.app_outside_seen to authenticated;
grant insert (workspace_id, seen_at) on table public.app_outside_seen to authenticated;
grant update (seen_at, updated_at) on table public.app_outside_seen to authenticated;

grant select, insert, update, delete on table public.app_outside_sources to service_role;
grant select, insert, update, delete on table public.app_outside_posts to service_role;
grant select, insert, update, delete on table public.app_outside_sentences to service_role;
grant select, insert, update, delete on table public.app_outside_seen to service_role;

create policy outside_sources_owner_all on public.app_outside_sources for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy outside_posts_owner_select on public.app_outside_posts for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy outside_sentences_owner_select on public.app_outside_sentences for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy outside_seen_owner_all on public.app_outside_seen for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 문장 찾기. 낱말(원래 말)과 비슷한 말을 함께 받아 ILIKE로 찾는다(%·_·\ 는 글자 그대로).
-- 말은 앞뒤 빈칸을 걷고 1~100자만, 모두 합쳐 7개까지(원래 말 + 비슷한 말 6개). 원래 말이 비면 빈 결과.
-- 거르기: 단체 키 목록(없으면 전체), 기간(게시 시각, 없으면 받은 시각 기준, 서울 날짜). 한 번에 1~100건, 건너뛰기 0~2000.
-- 결과 matched: 그 문장을 찾은 말(원래 말이 먼저), is_similar: 원래 말이 아닌 비슷한 말로만 찾았는지.
create function public.app_outside_search(
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

-- 사후 확인: 네 표 RLS 켜짐·anon·PUBLIC 권한 없음·authenticated 정해진 권한만·service_role 넷만,
-- 정책은 표마다 1개(authenticated만), 찾기 함수는 INVOKER·authenticated만 실행. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_outside_sources'::regclass, 'public.app_outside_posts'::regclass,
                           'public.app_outside_sentences'::regclass, 'public.app_outside_seen'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|service_role)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
       or not has_table_privilege('authenticated', t, 'select')
       or not has_table_privilege('service_role', t, 'select,insert,update,delete')
       or has_table_privilege('service_role', t, 'truncate,references,trigger')
       or (select count(*) from pg_policy where polrelid = t) <> 1
       or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
      raise exception 'OUTSIDE_STATEMENTS_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.app_outside_posts', 'delete')
     or has_table_privilege('authenticated', 'public.app_outside_sentences', 'delete')
     or has_table_privilege('authenticated', 'public.app_outside_seen', 'delete')
     or not has_table_privilege('authenticated', 'public.app_outside_sources', 'delete')
     or has_any_column_privilege('authenticated', 'public.app_outside_posts', 'insert,update')
     or has_any_column_privilege('authenticated', 'public.app_outside_sentences', 'insert,update')
     or has_column_privilege('authenticated', 'public.app_outside_sources', 'last_ok_at', 'insert,update')
     or has_column_privilege('authenticated', 'public.app_outside_sources', 'last_error', 'insert,update')
     or has_column_privilege('authenticated', 'public.app_outside_sources', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_outside_sources', 'source_key', 'update')
     or has_column_privilege('authenticated', 'public.app_outside_seen', 'workspace_id', 'update')
     or not has_column_privilege('authenticated', 'public.app_outside_sources', 'enabled', 'update')
     or not has_column_privilege('authenticated', 'public.app_outside_seen', 'seen_at', 'update')
     or (select prosecdef from pg_proc where oid = 'public.app_outside_search(text, text[], text[], date, date, integer, integer)'::regprocedure)
     or not has_function_privilege('authenticated', 'public.app_outside_search(text, text[], text[], date, date, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.app_outside_search(text, text[], text[], date, date, integer, integer)', 'execute')
     or exists (select 1 from pg_proc where oid = 'public.app_outside_search(text, text[], text[], date, date, integer, integer)'::regprocedure
         and proacl::text ~ '(^|[{,])(anon)?=') then
    raise exception 'OUTSIDE_STATEMENTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261031230000', 'outside_statements', array['S46-32 바깥 성명: app_outside_sources + app_outside_posts + app_outside_sentences (ko only) + app_outside_seen (owner RLS, authenticated limited, service_role writes) + app_outside_search (SECURITY INVOKER, authenticated only)']);
commit;
