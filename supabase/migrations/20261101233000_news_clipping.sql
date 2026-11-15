begin;
-- S47-44 NEWS-클리핑 A) DB (명진 요구 11/01 22:34 + 정정 22:25~22:39). 설계: docs/design/news-clipping.md(본문 저장·번역·별표 폴더·메모는 이 PR 본문 표가 우선).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  1) app_news_items: 하나의 스크랩(구독 채널 기사 'channel' + 서버가 찾은 기사 'keyword'·'media')을 한 표에.
--     같은 기사(정리한 원문 주소 url_key)는 작업공간마다 한 줄. 공개로 읽을 수 있는 기사는 서버가 뽑은 본문(body, body_kind='full'),
--     유료·로그인 기사는 공개 리드·메타 설명만(body_kind='lead'). 한 줄 요약(summary)은 원어로.
--     번역(title_ko·body_ko·translated_at)은 [번역] 버튼으로 서버만 채운다(화면은 쓸 수 없음). 넣기·고치기는 수집기(service_role).
--     화면(authenticated)은 읽기 + 별표(starred_at)·폴더(folder_id)·숨기기(hidden_at) 세 칸만 고친다.
--  2) app_news_folders: 별표 기사를 담는 폴더 트리(폴더 안 폴더, 100단). 노트 폴더(20261028170000)와 같은 모양·같은 규칙.
--     폴더를 지우면 안의 폴더와 기사는 한 단 위로 올라간다(기사는 지우지 않음).
--  3) app_news_keywords: 작업공간마다 관심 키워드(1~30자). 화면이 넣고·켜고 끄고·지운다. 서버는 읽기만.
--  4) app_news_days: 작업공간 하루 사용량(AI 요청·토큰, 번역·지금 채우기 횟수, 읽은 쪽 수). 서버만 쓰고 화면은 읽기만.
--     하루 한도(번역·지금 채우기)를 인스턴스 메모리가 아니라 이 표로 센다.
--  5) public.app_news_prune(timestamptz, integer): 정리. 매체 새 글 30일·키워드 기사 180일 지난 줄만 지운다.
--     채널 기사·별표 기사·노트 메모가 붙은 기사(app_notes.metadata.news_item_id)는 지우지 않는다. service_role만 실행.
--     SECURITY DEFINER인 까닭: 수집기(service_role)는 노트 표를 읽을 권한이 없어야 하므로, 이 함수 안의 '메모 있음' 확인만 허용한다.
-- 메모: 기존 노트(app_notes, kind='note')에 metadata.news_item_id(기사 id)를 적는다. 노트 표·정책·권한은 바꾸지 않는다
--       (노트 폴더 metadata.folder_id와 같은 방식). 그래서 [노트] 목록에 그대로 보인다.
-- 매체 켜고 끄기는 기존 app_outside_sources를 키 앞머리 'news-'로 다시 쓴다(이 파일은 그 표를 바꾸지 않음).
-- 권한: 네 표 모두 RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책(authenticated만). anon·PUBLIC 권한 없음.
-- 안 하는 것: 기존 표·열·정책·권한·함수 변경, 확장 추가, 읽생기 표.
-- 짝: docs/20261101233000_news_clipping.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261101233000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_notes') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_notes') and attname = 'metadata'
         and atttypid = 'jsonb'::regtype and not attisdropped)
     or to_regclass('public.app_news_items') is not null
     or to_regclass('public.app_news_folders') is not null
     or to_regclass('public.app_news_keywords') is not null
     or to_regclass('public.app_news_days') is not null
     or to_regprocedure('private.app_news_folder_tree_guard()') is not null
     or to_regprocedure('private.app_news_folder_lift()') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'app_news_prune')
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'NEWS_CLIPPING_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 별표 기사 폴더(노트 폴더와 같은 모양). (id, workspace_id) 유일: 기사가 같은 작업공간 폴더에만 들어가게 하는 외래 키용.
create table public.app_news_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  parent_id uuid references public.app_news_folders(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint app_news_folders_ws_unique unique (id, workspace_id),
  constraint app_news_folders_name_check check (
    char_length(name) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint app_news_folders_parent_check check (parent_id is null or parent_id <> id)
);
create index app_news_folders_scope_idx on public.app_news_folders(workspace_id, parent_id, sort_order);
create index app_news_folders_parent_idx on public.app_news_folders(parent_id) where parent_id is not null;

create table public.app_news_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  lane text not null,
  url text not null,
  url_key text not null,
  title text,
  title_key text,
  lang text not null default 'ko',
  publisher text,
  source_key text,
  keywords text[] not null default '{}'::text[],
  published_at timestamptz,
  scrapped_at timestamptz,
  fetched_at timestamptz,
  state text not null default 'pending',
  summary text,
  body text,
  body_kind text,
  title_ko text,
  body_ko text,
  translated_at timestamptz,
  starred_at timestamptz,
  folder_id uuid,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_news_items_url_unique unique (workspace_id, url_key),
  -- 폴더는 같은 작업공간 폴더만. 폴더 행이 지워지면 folder_id만 비운다(작업공간 칸은 그대로).
  constraint app_news_items_folder_fk foreign key (folder_id, workspace_id)
    references public.app_news_folders(id, workspace_id) on delete set null (folder_id),
  constraint app_news_items_lane_check check (lane in ('channel', 'keyword', 'media')),
  constraint app_news_items_url_check check (
    url ~ '^https?://[^[:space:]]+$' and char_length(url) <= 2000 and char_length(url_key) between 1 and 2000),
  constraint app_news_items_state_check check (
    state in ('pending', 'ok', 'robots', 'bot_check', 'paywall', 'failed', 'too_big', 'blocked')),
  constraint app_news_items_lang_check check (lang ~ '^[a-z]{2,3}$'),
  constraint app_news_items_text_check check (
    (title is null or (char_length(title) between 1 and 500 and title !~ '[[:cntrl:]]'))
    and (title_key is null or char_length(title_key) between 1 and 500)
    and (title_ko is null or (char_length(title_ko) between 1 and 500 and title_ko !~ '[[:cntrl:]]'))
    and (publisher is null or (char_length(publisher) between 1 and 120 and publisher !~ '[[:cntrl:]]'))
    and (source_key is null or source_key ~ '^[a-z0-9][a-z0-9-]{1,39}$')
    and (summary is null or char_length(summary) between 1 and 600)),
  constraint app_news_items_keywords_check check (
    cardinality(keywords) <= 10 and array_position(keywords, null) is null),
  -- 본문: 'full'(공개 기사 본문) 또는 'lead'(유료·로그인 기사의 공개 리드·메타 설명)일 때만, 10만 자 안쪽.
  constraint app_news_items_body_check check (
    (body is null) = (body_kind is null)
    and (body_kind is null or body_kind in ('full', 'lead'))
    and (body is null or char_length(body) between 1 and 100000)
    and (body_ko is null or char_length(body_ko) between 1 and 100000)
    and ((translated_at is null) = (title_ko is null and body_ko is null))),
  -- 폴더는 별표한 기사만.
  constraint app_news_items_folder_star_check check (folder_id is null or starred_at is not null)
);
create index app_news_items_list_idx on public.app_news_items(workspace_id, coalesce(published_at, scrapped_at, created_at) desc);
create index app_news_items_pending_idx on public.app_news_items(workspace_id, created_at) where state = 'pending';
create index app_news_items_star_idx on public.app_news_items(workspace_id, starred_at desc) where starred_at is not null;
create index app_news_items_folder_idx on public.app_news_items(folder_id) where folder_id is not null;
create index app_news_items_title_idx on public.app_news_items(workspace_id, title_key) where title_key is not null;

create table public.app_news_keywords (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  word text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, word),
  constraint app_news_keywords_word_check check (
    char_length(word) between 1 and 30 and word = btrim(word) and word !~ '[[:cntrl:]]')
);

create table public.app_news_days (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  day date not null,
  ai_requests integer not null default 0,
  ai_input_tokens bigint not null default 0,
  ai_output_tokens bigint not null default 0,
  translate_n integer not null default 0,
  fill_n integer not null default 0,
  fetch_n integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, day),
  constraint app_news_days_counts_check check (
    ai_requests >= 0 and ai_input_tokens >= 0 and ai_output_tokens >= 0
    and translate_n >= 0 and fill_n >= 0 and fetch_n >= 0)
);

alter table public.app_news_folders enable row level security;
alter table public.app_news_items enable row level security;
alter table public.app_news_keywords enable row level security;
alter table public.app_news_days enable row level security;
revoke all on table public.app_news_folders from public, anon, authenticated, service_role;
revoke all on table public.app_news_items from public, anon, authenticated, service_role;
revoke all on table public.app_news_keywords from public, anon, authenticated, service_role;
revoke all on table public.app_news_days from public, anon, authenticated, service_role;

-- 폴더: 노트 폴더와 같은 칸 권한. 넣기 칸에 id가 있는 까닭도 같다(지우기 [되돌리기]가 같은 id로 다시 만듦).
grant select, delete on table public.app_news_folders to authenticated;
grant insert (id, workspace_id, parent_id, name, sort_order) on table public.app_news_folders to authenticated;
grant update (parent_id, name, sort_order) on table public.app_news_folders to authenticated;
-- 기사: 화면은 읽기 + 별표·폴더·숨기기만. 본문·요약·번역은 서버만.
grant select on table public.app_news_items to authenticated;
grant update (starred_at, folder_id, hidden_at, updated_at) on table public.app_news_items to authenticated;
grant select, delete on table public.app_news_keywords to authenticated;
grant insert (workspace_id, word, enabled) on table public.app_news_keywords to authenticated;
grant update (enabled, updated_at) on table public.app_news_keywords to authenticated;
grant select on table public.app_news_days to authenticated;

-- 수집기(service_role): 기사 넣기·고치기·지우기, 키워드 읽기, 하루 사용량 넣기·고치기. 폴더는 손대지 않는다.
grant select, insert, update, delete on table public.app_news_items to service_role;
grant select on table public.app_news_keywords to service_role;
grant select, insert, update on table public.app_news_days to service_role;

create policy news_folders_owner_all on public.app_news_folders for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy news_items_owner_all on public.app_news_items for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy news_keywords_owner_all on public.app_news_keywords for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy news_days_owner_select on public.app_news_days for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 폴더 상위 검사: 같은 작업공간, 자기 아래로 옮기기 금지, 100단까지(노트 폴더 20261028170000과 같은 규칙·같은 숫자).
-- 거절 오류(고정): SQLSTATE 23514, 문구 앞머리 'NEWS_FOLDER_SCOPE:' / 'NEWS_FOLDER_CYCLE:' / 'NEWS_FOLDER_DEPTH:'.
create function private.app_news_folder_tree_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
declare
  v_cursor uuid := new.parent_id;
  v_above integer := 0;
  v_height integer;
begin
  if new.parent_id is null or (tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id) then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_news_folders_tree:' || new.workspace_id::text, 0));
  if not exists (
    select 1 from public.app_news_folders f
    where f.id = new.parent_id and f.workspace_id = new.workspace_id
  ) then
    raise exception using errcode = '23514',
      message = 'NEWS_FOLDER_SCOPE: a folder must stay in the same workspace as its parent';
  end if;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception using errcode = '23514',
        message = 'NEWS_FOLDER_CYCLE: a folder cannot be placed under itself or a folder below it';
    end if;
    v_above := v_above + 1;
    if v_above >= 100 then
      raise exception using errcode = '23514', message = 'NEWS_FOLDER_DEPTH: folders are limited to 100 levels';
    end if;
    select f.parent_id into v_cursor from public.app_news_folders f where f.id = v_cursor;
  end loop;
  with recursive d(id, lvl, path) as (
    select new.id, 1, array[new.id]
    union all
    select f.id, d.lvl + 1, d.path || f.id
    from public.app_news_folders f join d on f.parent_id = d.id
    where f.id <> all(d.path) and d.lvl < 101
  )
  select max(d.lvl) into v_height from d;
  if v_above + v_height > 100 then
    raise exception using errcode = '23514', message = 'NEWS_FOLDER_DEPTH: folders are limited to 100 levels';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_news_folder_tree_guard() from public, anon, authenticated, service_role;

-- 폴더를 지우면 안의 폴더와 기사는 한 단 위로(맨 위 폴더였으면 맨 위 = 폴더 없음). 기사는 지우지 않는다.
-- 다른 삭제(작업공간 삭제 등)에 딸려 지워질 때는 아무것도 하지 않는다.
create function private.app_news_folder_lift()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $lift$
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  update public.app_news_folders set parent_id = old.parent_id
    where parent_id = old.id;
  update public.app_news_items set folder_id = old.parent_id, updated_at = pg_catalog.now()
    where folder_id = old.id and workspace_id = old.workspace_id;
  return old;
end
$lift$;
revoke all on function private.app_news_folder_lift() from public, anon, authenticated, service_role;

create trigger app_news_folders_tree_guard
before insert or update of parent_id on public.app_news_folders
for each row execute function private.app_news_folder_tree_guard();

create trigger app_news_folders_lift_on_delete
before delete on public.app_news_folders
for each row execute function private.app_news_folder_lift();

-- 정리: 매체 새 글(lane='media') 30일, 키워드 기사(lane='keyword') 180일 지난 줄만, 한 번에 p_limit(1~5000)줄까지.
-- 채널 기사·별표 기사·노트 메모(휴지통 안 노트 포함)가 붙은 기사는 지우지 않는다. 지운 줄 수를 돌려준다.
create function public.app_news_prune(p_now timestamptz, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $prune$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_n integer;
begin
  with doomed as (
    select i.id from public.app_news_items i
    where i.starred_at is null
      and ((i.lane = 'media' and coalesce(i.published_at, i.created_at) < v_now - interval '30 days')
        or (i.lane = 'keyword' and coalesce(i.published_at, i.created_at) < v_now - interval '180 days'))
      and not exists (
        select 1 from public.app_notes n
        where n.workspace_id = i.workspace_id and n.metadata ->> 'news_item_id' = i.id::text)
    order by coalesce(i.published_at, i.created_at)
    limit v_limit
  )
  delete from public.app_news_items i using doomed where i.id = doomed.id;
  get diagnostics v_n = row_count;
  return v_n;
end
$prune$;
revoke all on function public.app_news_prune(timestamptz, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_news_prune(timestamptz, integer) to service_role;

-- 사후 확인: 네 표 RLS 켜짐·anon·PUBLIC 권한 없음, 정책은 표마다 1개(authenticated만), 칸 권한 정해진 대로,
-- 정리 함수는 DEFINER·search_path 고정·service_role만 실행. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_news_folders'::regclass, 'public.app_news_items'::regclass,
                           'public.app_news_keywords'::regclass, 'public.app_news_days'::regclass] loop
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
      raise exception 'NEWS_CLIPPING_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.app_news_items', 'delete')
     or has_table_privilege('authenticated', 'public.app_news_days', 'delete')
     or has_any_column_privilege('authenticated', 'public.app_news_items', 'insert')
     or has_any_column_privilege('authenticated', 'public.app_news_days', 'insert,update')
     or not has_column_privilege('authenticated', 'public.app_news_items', 'starred_at', 'update')
     or not has_column_privilege('authenticated', 'public.app_news_items', 'folder_id', 'update')
     or has_column_privilege('authenticated', 'public.app_news_items', 'body', 'update')
     or has_column_privilege('authenticated', 'public.app_news_items', 'body_ko', 'update')
     or has_column_privilege('authenticated', 'public.app_news_items', 'title_ko', 'update')
     or has_column_privilege('authenticated', 'public.app_news_items', 'summary', 'update')
     or has_column_privilege('authenticated', 'public.app_news_items', 'url', 'update')
     or has_column_privilege('authenticated', 'public.app_news_items', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_news_folders', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_news_keywords', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_news_keywords', 'word', 'update')
     or not has_table_privilege('authenticated', 'public.app_news_folders', 'delete')
     or not has_table_privilege('authenticated', 'public.app_news_keywords', 'delete')
     or not has_table_privilege('service_role', 'public.app_news_items', 'select,insert,update,delete')
     or has_table_privilege('service_role', 'public.app_news_folders', 'select,insert,update,delete')
     or has_table_privilege('service_role', 'public.app_news_keywords', 'insert,update,delete')
     or has_table_privilege('service_role', 'public.app_news_days', 'delete')
     or not has_table_privilege('service_role', 'public.app_news_days', 'select,insert,update')
     or (select count(*) from pg_trigger where tgrelid = 'public.app_news_folders'::regclass and not tgisinternal) <> 2
     or not (select prosecdef from pg_proc where oid = 'public.app_news_prune(timestamptz, integer)'::regprocedure)
     or (select proconfig from pg_proc where oid = 'public.app_news_prune(timestamptz, integer)'::regprocedure) <> array['search_path=""']
     or not has_function_privilege('service_role', 'public.app_news_prune(timestamptz, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.app_news_prune(timestamptz, integer)', 'execute')
     or has_function_privilege('anon', 'public.app_news_prune(timestamptz, integer)', 'execute')
     or exists (select 1 from pg_proc where oid = 'public.app_news_prune(timestamptz, integer)'::regprocedure
         and proacl::text ~ '(^|[{,])(anon|authenticated)?=') then
    raise exception 'NEWS_CLIPPING_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261101233000', 'news_clipping', array['S47-44 NEWS-클리핑: app_news_items (one scrap list, body/translation server-only, star/folder/hide by owner) + app_news_folders (tree guard 100, lift) + app_news_keywords + app_news_days (owner RLS) + app_news_prune (DEFINER, service_role only, keeps channel/starred/memo items)']);
commit;
