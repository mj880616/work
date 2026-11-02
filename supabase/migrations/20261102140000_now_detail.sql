begin;
-- S48-14 OUTSIDE-글상세·관심환류 + Now 메뉴 합치기 — DB (요청함 11/01 23:12, 명진 결정 23:14·23:16).
-- 설계: docs/design/outside-statements.md 12절, docs/design/news-clipping.md 13절.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  1) app_now_details: 글 상세(사회운동 글 또는 뉴스 기사 하나)의 AI 결과 저장. 처음 열 때 서버가 한 번 만들어 둔다.
--     핵심 요약·주요 문장(원문 + 외국어면 번역, 3개까지)·나와의 연관(관심 주제 + 한 줄 이유)·시사점(공공운수노조 운동·한국 노동운동)·
--     함께 볼 것(같은 작업공간 기록 id + 제목, 8개까지). level='basic'은 한도를 넘어 요약·문장까지만 만든 것.
--     interests_key는 만들 때 쓴 확정 관심사 묶음의 지문(관심사가 바뀌면 서버가 '연관·시사점'만 다시 만든다).
--     넣기·고치기는 서버(service_role)만, 화면(authenticated)은 읽기만.
--  2) app_outside_marks: 사회운동 글의 별표·보관·관심 없음(글마다 한 줄). 화면이 넣고 고치고 지운다.
--     뉴스 기사는 이미 app_news_items의 starred_at(별표)·folder_id(별표 폴더 = 보관)·hidden_at(관심 없음)을 쓰므로 여기 두지 않는다(같은 것을 두 곳에 두지 않기).
--  3) app_now_signals: 관심사 환류 기록(별표·보관·메모·관심 없음·원문 열기). 화면은 더하기·읽기만(고치기·지우기 없음).
--     서버는 읽기(관심 주제 후보 만들기)와 오래된 줄 지우기만.
--  4) app_now_interests: 요즘 관심 주제. AI가 '후보'로 넣고 명진이 확정·고치기·지우기·더하기(주간보고 규칙과 같은 후보 → 확정).
-- 글 id는 outside_post_id(app_outside_posts) 또는 news_item_id(app_news_items) 중 정확히 하나. 글이 지워지면 딸린 줄도 지워진다.
-- 같은 작업공간 글만: private.app_now_item_scope_guard()(INVOKER) 트리거가 글의 작업공간과 줄의 작업공간이 같은지 본다.
--   화면(authenticated)은 RLS 때문에 남의 글을 볼 수 없으므로 남의 글 id를 넣으면 거절된다.
-- 메모: 기존 노트(app_notes)에 metadata.outside_post_id(또는 이미 쓰는 news_item_id)를 적는다. 노트 표·정책·권한은 바꾸지 않는다.
-- 권한: 네 표 모두 RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책(authenticated만). anon·PUBLIC 권한 없음.
-- 안 하는 것: 기존 표·열·정책·권한·함수 변경(app_outside_posts·app_news_items·app_notes 포함), 확장 추가, 읽생기 표.
-- 짝: docs/20261102140000_now_detail.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261102140000')
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_outside_posts') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_news_items') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or to_regclass('public.app_now_details') is not null
     or to_regclass('public.app_outside_marks') is not null
     or to_regclass('public.app_now_signals') is not null
     or to_regclass('public.app_now_interests') is not null
     or to_regprocedure('private.app_now_item_scope_guard()') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'NOW_DETAIL_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_now_details (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  outside_post_id uuid references public.app_outside_posts(id) on delete cascade,
  news_item_id uuid references public.app_news_items(id) on delete cascade,
  level text not null default 'full',
  summary text,
  key_sentences jsonb not null default '[]'::jsonb,
  relevance jsonb,
  implications jsonb,
  related jsonb not null default '[]'::jsonb,
  interests_key text,
  generated_at timestamptz not null default now(),
  context_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_now_details_post_unique unique (outside_post_id),
  constraint app_now_details_news_unique unique (news_item_id),
  constraint app_now_details_one_item check ((outside_post_id is null) <> (news_item_id is null)),
  constraint app_now_details_level_check check (level in ('full', 'basic')),
  constraint app_now_details_summary_check check (summary is null or char_length(summary) between 1 and 1500),
  -- 주요 문장: 3개까지, {"orig": 원문 1~300자, "ko": 번역 1~300자 또는 없음}. 전문 번역은 두지 않는다(설계 2절 경계).
  constraint app_now_details_sentences_check check (
    jsonb_typeof(key_sentences) = 'array' and jsonb_array_length(key_sentences) <= 3
    and not jsonb_path_exists(key_sentences,
      '$[*] ? (@.type() != "object" || !(@.orig.type() == "string") || !(@.orig like_regex "^.{1,150}.{0,150}$" flag "s")
              || (exists(@.ko) && !(@.ko.type() == "null") && !(@.ko.type() == "string" && @.ko like_regex "^.{1,150}.{0,150}$" flag "s")))')),
  -- 나와의 연관: {"topics": [주제 1~30자, 5개까지], "reason": 한 줄 1~200자}. 관심사와 무관하면 null(level='basic'도 null).
  constraint app_now_details_relevance_check check (
    relevance is null or (
      jsonb_typeof(relevance) = 'object'
      and not jsonb_path_exists(relevance, 'strict $.keyvalue() ? (!(@.key == "topics" || @.key == "reason"))')
      and jsonb_typeof(relevance -> 'topics') = 'array' and jsonb_array_length(relevance -> 'topics') <= 5
      and not jsonb_path_exists(relevance, '$.topics[*] ? (@.type() != "string" || !(@ like_regex "^[^\\n\\r]{1,30}$"))')
      and jsonb_typeof(relevance -> 'reason') = 'string'
      and jsonb_path_exists(relevance, '$.reason ? (@ like_regex "^[^\\n\\r]{1,200}$")'))),
  -- 시사점: {"kptu": 공공운수노조 운동에의 시사점, "labor": 한국 노동운동에의 시사점} 각각 1~300자(둘 중 하나는 있어야 함).
  constraint app_now_details_implications_check check (
    implications is null or (
      jsonb_typeof(implications) = 'object'
      and not jsonb_path_exists(implications, 'strict $.keyvalue() ? (!(@.key == "kptu" || @.key == "labor"))')
      and (implications ? 'kptu' or implications ? 'labor')
      and not jsonb_path_exists(implications, 'strict $.* ? (@.type() != "string" || !(@ like_regex "^.{1,150}.{0,150}$" flag "s"))'))),
  -- 함께 볼 것: 8개까지, {"kind": 어느 표, "id": 그 줄 id(글자 1~64), "title": 1~200자}. 화면은 id로 그 자리를 연다.
  constraint app_now_details_related_check check (
    jsonb_typeof(related) = 'array' and jsonb_array_length(related) <= 8
    and not jsonb_path_exists(related,
      '$[*] ? (@.type() != "object"
              || !(@.kind == "outside" || @.kind == "news" || @.kind == "update" || @.kind == "ledger" || @.kind == "library")
              || !(@.id.type() == "string" && @.id like_regex "^[A-Za-z0-9_-]{1,64}$")
              || !(@.title.type() == "string" && @.title like_regex "^[^\\n\\r]{1,200}$"))')),
  constraint app_now_details_key_check check (interests_key is null or interests_key ~ '^[a-z0-9]{1,64}$'),
  -- 연관·시사점은 'full'일 때만.
  constraint app_now_details_basic_check check (level = 'full' or (relevance is null and implications is null))
);
create index app_now_details_ws_idx on public.app_now_details(workspace_id, generated_at desc);

create table public.app_outside_marks (
  post_id uuid primary key references public.app_outside_posts(id) on delete cascade,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  starred_at timestamptz,
  archived_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index app_outside_marks_saved_idx on public.app_outside_marks(workspace_id, coalesce(starred_at, archived_at) desc)
  where starred_at is not null or archived_at is not null;

create table public.app_now_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  outside_post_id uuid references public.app_outside_posts(id) on delete cascade,
  news_item_id uuid references public.app_news_items(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now(),
  constraint app_now_signals_one_item check ((outside_post_id is null) <> (news_item_id is null)),
  constraint app_now_signals_action_check check (
    action in ('star', 'unstar', 'archive', 'unarchive', 'memo', 'dismiss', 'undismiss', 'open'))
);
create index app_now_signals_ws_idx on public.app_now_signals(workspace_id, created_at desc);
create index app_now_signals_post_idx on public.app_now_signals(outside_post_id) where outside_post_id is not null;
create index app_now_signals_news_idx on public.app_now_signals(news_item_id) where news_item_id is not null;

create table public.app_now_interests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  topic text not null,
  state text not null default 'candidate',
  origin text not null default 'user',
  reason text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_now_interests_topic_unique unique (workspace_id, topic),
  constraint app_now_interests_topic_check check (
    char_length(topic) between 1 and 30 and topic = btrim(topic) and topic !~ '[[:cntrl:]]'),
  constraint app_now_interests_state_check check (state in ('candidate', 'confirmed', 'dropped')),
  constraint app_now_interests_origin_check check (origin in ('ai', 'user')),
  constraint app_now_interests_reason_check check (
    reason is null or (char_length(reason) between 1 and 200 and reason !~ '[[:cntrl:]]'))
);
create index app_now_interests_ws_idx on public.app_now_interests(workspace_id, state);

alter table public.app_now_details enable row level security;
alter table public.app_outside_marks enable row level security;
alter table public.app_now_signals enable row level security;
alter table public.app_now_interests enable row level security;
revoke all on table public.app_now_details from public, anon, authenticated, service_role;
revoke all on table public.app_outside_marks from public, anon, authenticated, service_role;
revoke all on table public.app_now_signals from public, anon, authenticated, service_role;
revoke all on table public.app_now_interests from public, anon, authenticated, service_role;

-- 상세: 화면은 읽기만. 서버가 넣고 고치고 지운다.
grant select on table public.app_now_details to authenticated;
-- 사회운동 글 표시: 화면이 넣고(별표·보관·관심 없음) 고치고 지운다. 글 id·작업공간은 고치지 못한다.
grant select, delete on table public.app_outside_marks to authenticated;
grant insert (post_id, workspace_id, starred_at, archived_at, dismissed_at) on table public.app_outside_marks to authenticated;
grant update (starred_at, archived_at, dismissed_at, updated_at) on table public.app_outside_marks to authenticated;
-- 환류 기록: 화면은 더하기·읽기만(시각은 서버 시계 기본값 — 넣기 칸에 없음).
grant select on table public.app_now_signals to authenticated;
grant insert (workspace_id, outside_post_id, news_item_id, action) on table public.app_now_signals to authenticated;
-- 관심 주제: 화면이 확정·고치기·지우기·더하기. origin은 기본값 'user'(화면은 'ai'로 넣지 못함).
grant select, delete on table public.app_now_interests to authenticated;
grant insert (workspace_id, topic, state, decided_at) on table public.app_now_interests to authenticated;
grant update (topic, state, decided_at, updated_at) on table public.app_now_interests to authenticated;

-- 서버(service_role): 상세 넣기·고치기·지우기, 표시 읽기, 환류 기록 읽기·오래된 줄 지우기, 관심 후보 넣기·고치기·지우기.
grant select, insert, update, delete on table public.app_now_details to service_role;
grant select on table public.app_outside_marks to service_role;
grant select, delete on table public.app_now_signals to service_role;
grant select, insert, update, delete on table public.app_now_interests to service_role;

create policy now_details_owner_select on public.app_now_details for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy outside_marks_owner_all on public.app_outside_marks for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy now_signals_owner_all on public.app_now_signals for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy now_interests_owner_all on public.app_now_interests for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 같은 작업공간 글만: 줄이 가리키는 글(사회운동 글 또는 뉴스 기사)의 작업공간이 줄의 작업공간과 같아야 한다.
-- INVOKER라 화면(authenticated)은 RLS로 보이는 자기 글만 찾는다. 거절 오류(고정): SQLSTATE 23514, 'NOW_ITEM_SCOPE:'.
-- 세 표(상세·표시·환류 기록)가 함께 쓴다. 칸 이름이 다른 표시 표는 post_id를 사회운동 글 id로 읽는다.
create function private.app_now_item_scope_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
declare
  v_row jsonb := pg_catalog.to_jsonb(new);
  v_post uuid := coalesce(v_row ->> 'outside_post_id', v_row ->> 'post_id')::uuid;
  v_news uuid := (v_row ->> 'news_item_id')::uuid;
  v_ws uuid;
begin
  if v_post is not null then
    select p.workspace_id into v_ws from public.app_outside_posts p where p.id = v_post;
  elsif v_news is not null then
    select i.workspace_id into v_ws from public.app_news_items i where i.id = v_news;
  end if;
  if v_ws is null or v_ws <> new.workspace_id then
    raise exception using errcode = '23514',
      message = 'NOW_ITEM_SCOPE: the item must belong to the same workspace';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_now_item_scope_guard() from public, anon, authenticated, service_role;

create trigger app_now_details_scope_guard
before insert or update of workspace_id, outside_post_id, news_item_id on public.app_now_details
for each row execute function private.app_now_item_scope_guard();
create trigger app_outside_marks_scope_guard
before insert or update of workspace_id, post_id on public.app_outside_marks
for each row execute function private.app_now_item_scope_guard();
create trigger app_now_signals_scope_guard
before insert or update of workspace_id, outside_post_id, news_item_id on public.app_now_signals
for each row execute function private.app_now_item_scope_guard();

-- 사후 확인: 네 표 RLS 켜짐·anon·PUBLIC 권한 없음, 정책은 표마다 1개(authenticated만), 칸 권한 정해진 대로,
-- 트리거 셋(INVOKER·search_path 고정). 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_now_details'::regclass, 'public.app_outside_marks'::regclass,
                           'public.app_now_signals'::regclass, 'public.app_now_interests'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|service_role)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
       or not has_table_privilege('authenticated', t, 'select')
       or has_table_privilege('service_role', t, 'truncate,references,trigger')
       or (select count(*) from pg_policy where polrelid = t) <> 1
       or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
      raise exception 'NOW_DETAIL_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.app_now_details', 'delete')
     or has_any_column_privilege('authenticated', 'public.app_now_details', 'insert,update')
     or has_table_privilege('authenticated', 'public.app_now_signals', 'delete')
     or has_any_column_privilege('authenticated', 'public.app_now_signals', 'update')
     or has_column_privilege('authenticated', 'public.app_now_signals', 'created_at', 'insert')
     or has_column_privilege('authenticated', 'public.app_outside_marks', 'post_id', 'update')
     or has_column_privilege('authenticated', 'public.app_outside_marks', 'workspace_id', 'update')
     or not has_column_privilege('authenticated', 'public.app_outside_marks', 'starred_at', 'update')
     or has_column_privilege('authenticated', 'public.app_now_interests', 'origin', 'insert')
     or has_column_privilege('authenticated', 'public.app_now_interests', 'origin', 'update')
     or has_column_privilege('authenticated', 'public.app_now_interests', 'reason', 'update')
     or has_column_privilege('authenticated', 'public.app_now_interests', 'workspace_id', 'update')
     or not has_table_privilege('authenticated', 'public.app_outside_marks', 'delete')
     or not has_table_privilege('authenticated', 'public.app_now_interests', 'delete')
     or not has_table_privilege('service_role', 'public.app_now_details', 'select,insert,update,delete')
     or has_table_privilege('service_role', 'public.app_outside_marks', 'insert,update,delete')
     or not has_table_privilege('service_role', 'public.app_outside_marks', 'select')
     or has_table_privilege('service_role', 'public.app_now_signals', 'insert,update')
     or not has_table_privilege('service_role', 'public.app_now_signals', 'select,delete')
     or not has_table_privilege('service_role', 'public.app_now_interests', 'select,insert,update,delete')
     or (select count(*) from pg_trigger where tgrelid in ('public.app_now_details'::regclass, 'public.app_outside_marks'::regclass,
         'public.app_now_signals'::regclass) and not tgisinternal) <> 3
     or (select prosecdef from pg_proc where oid = 'private.app_now_item_scope_guard()'::regprocedure)
     or (select proconfig from pg_proc where oid = 'private.app_now_item_scope_guard()'::regprocedure) <> array['search_path=""'] then
    raise exception 'NOW_DETAIL_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261102140000', 'now_detail', array['S48-14 OUTSIDE-글상세·관심환류: app_now_details (server-written detail cache, owner read) + app_outside_marks (owner star/archive/dismiss) + app_now_signals (owner append-only feedback) + app_now_interests (AI candidate -> owner confirm) + same-workspace scope guard (INVOKER)']);
commit;
