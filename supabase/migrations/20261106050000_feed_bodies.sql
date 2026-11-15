begin;
-- S51-3 NEWS-전면개편 P2a — DB: 글마다 본문 문단·사진 주소·캡션을 담는 새 표 public.app_feed_bodies 하나.
-- 설계: docs/design/news-overhaul.md 4.1절(명진 결정 D1 '수집 때 본문·사진을 Web2에 저장, 작업공간 소유자 비공개 안에서만'), 4.5절(사진은 주소 + 캡션만, 파일 저장 없음).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
-- Edge(수집 함수가 줄을 넣는 일)·화면 변경은 이 migration에 없다(P2b 이후). 그 전까지 이 표는 비어 있다.
--
-- 무엇:
--   1) 새 표 public.app_feed_bodies: 사회운동 글(app_outside_posts) 또는 뉴스 기사(app_news_items) 하나에 한 줄.
--      blocks: 차례대로 {t:'p'|'h'|'quote', text} 또는 {t:'img', src, cap, alt}. HTML은 저장하지 않는다(글자·주소만).
--      state: ok(본문 있음)·lead(앞부분만)·image_only(그림·첨부뿐)·failed. reason: 못 읽은 까닭 코드. rule: 쓴 추출 규칙 이름@판.
--      chars·images: 글자 수·사진 수(사진 수는 블록과 같아야 함). 글이 지워지면 함께 지워진다(외래 키 cascade).
--      DB 검사: 블록 400개·본문 글자 10만 자(chars, 블록 글자 JSON 길이 11만 자)·사진 20개·사진 주소 https:// 2000자(빈칸·따옴표·꺾쇠 없음)·캡션·대체 글 300자·제어 문자 없음.
--   2) 같은 작업공간 글만: private.app_feed_bodies_scope_guard()(SECURITY INVOKER, 빈 search_path, 실행권 전부 회수) 트리거가
--      줄이 가리키는 글의 작업공간과 줄의 작업공간이 같은지 본다(20261102140000_now_detail의 같은 모양 검사와 같은 방식, 새 함수).
-- 권한: RLS 켬. 정책은 소유자 읽기 하나(authenticated만, private.app_is_workspace_owner). authenticated는 읽기만.
--   service_role(수집 Edge)은 읽기·칸별 넣기·칸별 고치기만(지우기 없음 — 글이 지워질 때 cascade로만 지워짐). anon·PUBLIC 권한 없음.
-- 안 하는 것: 기존 표·칸·정책·권한·함수 변경(app_outside_posts·app_news_items·app_outside_sentences 포함), 기존 줄 변경, 사진 파일 저장,
--   전문 번역 저장, 공개·공유 경로, 운영자 기능 키 추가, rtw_* 객체, 앞 단계 P1a(20261106040000) 의존.
-- 짝: docs/20261106050000_feed_bodies.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261106050000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261031230000' and name = 'outside_statements') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261101233000' and name = 'news_clipping') <> 1
     or to_regclass('public.app_feed_bodies') is not null
     or to_regprocedure('private.app_feed_bodies_scope_guard()') is not null
     or to_regclass('public.app_workspaces') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_outside_posts') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_news_items') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'FEED_BODIES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_feed_bodies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  outside_post_id uuid references public.app_outside_posts(id) on delete cascade,
  news_item_id uuid references public.app_news_items(id) on delete cascade,
  blocks jsonb not null default '[]'::jsonb,
  state text not null,
  reason text,
  rule text,
  chars integer not null default 0,
  images integer not null default 0,
  extracted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_feed_bodies_post_unique unique (outside_post_id),
  constraint app_feed_bodies_news_unique unique (news_item_id),
  constraint app_feed_bodies_one_item check ((outside_post_id is null) <> (news_item_id is null)),
  constraint app_feed_bodies_state_check check (state in ('ok', 'lead', 'image_only', 'failed')),
  constraint app_feed_bodies_reason_check check (reason is null or reason in
    ('robots', 'bot_check', 'paywall', 'too_big', 'timeout', 'http_4xx', 'http_5xx', 'no_body', 'off_host', 'relay')),
  -- 규칙 이름(출처 키 모양) @ 판 번호. 못 읽어 규칙을 쓰지 않은 글은 비워 둔다.
  constraint app_feed_bodies_rule_check check (rule is null or rule ~ '^[a-z0-9][a-z0-9_-]{1,39}@[0-9]{1,4}$'),
  -- 블록: 배열, 400개까지. 종류는 p·h·quote(글자 하나)와 img(주소·캡션·대체 글)뿐, 그 밖의 칸 없음.
  constraint app_feed_bodies_blocks_check check (
    jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 400
    and not jsonb_path_exists(blocks,
      '$[*] ? (@.type() != "object" || !(@.t == "p" || @.t == "h" || @.t == "quote" || @.t == "img"))')
    and not jsonb_path_exists(blocks,
      '$[*].keyvalue() ? (!(@.key == "t" || @.key == "text" || @.key == "src" || @.key == "cap" || @.key == "alt"))')
    and not jsonb_path_exists(blocks,
      '$[*] ? (@.t != "img" && (!(@.text.type() == "string") || !(@.text like_regex "^[^[:cntrl:]]+$")
              || exists(@.src) || exists(@.cap) || exists(@.alt)))')
    and not jsonb_path_exists(blocks,
      '$[*] ? (@.t == "img" && (exists(@.text) || !(@.src.type() == "string")
              || !(@.src like_regex "^https://[^[:space:][:cntrl:]\"<>]{1,242}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}$")
              || (exists(@.cap) && !(@.cap.type() == "null") && !(@.cap.type() == "string" && @.cap like_regex "^[^[:cntrl:]]{1,150}[^[:cntrl:]]{0,150}$"))
              || (exists(@.alt) && !(@.alt.type() == "null") && !(@.alt.type() == "string" && @.alt like_regex "^[^[:cntrl:]]{1,150}[^[:cntrl:]]{0,150}$"))))')),
  -- 본문 글자 합 상한: 블록 글자들을 JSON 배열로 늘어놓은 길이(따옴표·쉼표 여유 포함) 11만 자, chars 10만 자.
  constraint app_feed_bodies_text_total_check check (
    char_length(jsonb_path_query_array(blocks, '$[*].text')::text) <= 110000),
  constraint app_feed_bodies_chars_check check (
    chars between 0 and 100000
    and (chars > 0) = jsonb_path_exists(blocks, '$[*] ? (@.t != "img")')),
  -- 사진 수는 사진 블록 수와 같고 20개까지.
  constraint app_feed_bodies_images_check check (
    images between 0 and 20
    and images = jsonb_array_length(jsonb_path_query_array(blocks, '$[*] ? (@.t == "img")'))),
  -- 상태와 까닭: ok는 까닭 없음·글자 있음, lead는 글자 있음, image_only는 사진 있음, failed는 까닭 있음·블록 없음.
  constraint app_feed_bodies_state_shape_check check (
    case state
      when 'ok' then reason is null and chars > 0
      when 'lead' then chars > 0
      when 'image_only' then images > 0
      when 'failed' then reason is not null and jsonb_array_length(blocks) = 0
    end)
);
create index app_feed_bodies_rule_idx on public.app_feed_bodies (workspace_id, rule);
alter table public.app_feed_bodies enable row level security;
revoke all on table public.app_feed_bodies from public, anon, authenticated, service_role;
create policy feed_bodies_owner_select on public.app_feed_bodies
  for select to authenticated using (private.app_is_workspace_owner(workspace_id));
grant select on table public.app_feed_bodies to authenticated;
-- 서버(수집 Edge): 읽기 + 칸별 넣기 + 칸별 고치기(다시 뽑기·upsert). id·created_at은 기본값만. 지우기는 없다.
grant select on table public.app_feed_bodies to service_role;
grant insert (workspace_id, outside_post_id, news_item_id, blocks, state, reason, rule, chars, images, extracted_at)
  on table public.app_feed_bodies to service_role;
grant update (workspace_id, outside_post_id, news_item_id, blocks, state, reason, rule, chars, images, extracted_at, updated_at)
  on table public.app_feed_bodies to service_role;

-- 같은 작업공간 글만: 줄이 가리키는 글(사회운동 글 또는 뉴스 기사)의 작업공간이 줄의 작업공간과 같아야 한다.
-- INVOKER: 서버(service_role)가 넣을 때 그 권한으로 글 표를 읽는다. 거절 오류(고정): SQLSTATE 23514, 'FEED_BODY_SCOPE:'.
create function private.app_feed_bodies_scope_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
declare
  v_ws uuid;
begin
  if new.outside_post_id is not null then
    select p.workspace_id into v_ws from public.app_outside_posts p where p.id = new.outside_post_id;
  elsif new.news_item_id is not null then
    select i.workspace_id into v_ws from public.app_news_items i where i.id = new.news_item_id;
  end if;
  if v_ws is null or v_ws <> new.workspace_id then
    raise exception using errcode = '23514',
      message = 'FEED_BODY_SCOPE: the item must belong to the same workspace';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_feed_bodies_scope_guard() from public, anon, authenticated, service_role;
create trigger app_feed_bodies_scope_guard
before insert or update of workspace_id, outside_post_id, news_item_id on public.app_feed_bodies
for each row execute function private.app_feed_bodies_scope_guard();

-- 마지막 확인: 어긋나면 전체 취소.
do $$
declare t regclass := 'public.app_feed_bodies'::regclass;
begin
  if not exists (select 1 from pg_class where oid = t and relrowsecurity and not relforcerowsecurity)
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polcmd = 'r' and polpermissive
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or exists (select 1 from pg_class where oid = t and coalesce(relacl::text, '') ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|authenticated)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select')
     or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', t, 'insert,update,references')
     or not has_table_privilege('service_role', t, 'select')
     or has_table_privilege('service_role', t, 'insert,update,delete,truncate,references,trigger')
     or not has_column_privilege('service_role', t, 'blocks', 'insert')
     or not has_column_privilege('service_role', t, 'blocks', 'update')
     or has_column_privilege('service_role', t, 'id', 'insert')
     or has_column_privilege('service_role', t, 'id', 'update')
     or has_column_privilege('service_role', t, 'created_at', 'update')
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_feed_bodies_scope_guard()') and not prosecdef
         and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=') <> 1
     or has_function_privilege('authenticated', to_regprocedure('private.app_feed_bodies_scope_guard()'), 'execute')
     or has_function_privilege('anon', to_regprocedure('private.app_feed_bodies_scope_guard()'), 'execute')
     or has_function_privilege('service_role', to_regprocedure('private.app_feed_bodies_scope_guard()'), 'execute')
     or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 1 then
    raise exception 'FEED_BODIES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261106050000', 'feed_bodies', array['S51-3 NEWS-전면개편 P2a: new table app_feed_bodies (one row per outside post or news item; text/heading/quote blocks and image https address + caption only, no HTML, no image files; DB checks on block count 400, text 100k, images 20, https address 2000, caption 300; state/reason/rule; cascade with the item); RLS on, one owner select policy for authenticated (private.app_is_workspace_owner); authenticated select only; service_role select + column insert/update, no delete; new SECURITY INVOKER trigger function private.app_feed_bodies_scope_guard (empty search_path, nobody executes) keeping the item in the same workspace; no anon/PUBLIC, no change to existing tables, policies, grants, functions or rows']);
commit;
