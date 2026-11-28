begin;
-- HOME-읽을거리평가(사용자 2026-11-28 07:04): 읽을 거리 줄 왼쪽 밀기 👍(좋아요)·👎(별로예요) 평가를 담는 새 표 1개(app_read_ratings).
-- 바꾸는 것: 새 표 1개뿐. 기존 표·정책·권한·자료는 한 줄도 바꾸지 않는다.
--  - 한 줄 = 작업공간 하나가 공용 글 하나(뉴스 기사 news_article_id 또는 사회운동 글 outside_article_id, 둘 중 정확히 하나)에 준 평가 하나(rating 1 = 좋아요, -1 = 별로예요)와 그 시각.
--  - 글 제목·본문·매체는 다시 저장하지 않는다(매체 키·묶음은 서버 ai-assist가 공용 글 표에서 읽어 정한다).
--  - 사람·글 하나에 한 줄(작업공간+글 고유). 다시 누르면 취소 = 줄 지우기, 바꾸기 = 지우고 새로 넣기(시각은 서버가 정함).
--  - 작업공간·글이 지워지면 평가도 함께 지워진다(on delete cascade).
-- 권한: owner만(private.app_is_workspace_owner). authenticated: 읽기·지우기, 넣기는 작업공간·글 칸·평가만(id·시각은 서버가 정함), 고치기 없음.
--   anon·PUBLIC·service_role 권한 없음. 함수·트리거 없음. 공유(COLLAB) 함수는 이 표를 읽지 않는다(넓히지 않음).
-- 짝: docs/20261128071000_read_ratings.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261128071000')
     or to_regclass('public.app_read_ratings') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_news_articles') is null
     or to_regclass('public.app_outside_articles') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_workspaces') and attname = 'id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_news_articles') and attname = 'id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_outside_articles') and attname = 'id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'READ_RATINGS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_read_ratings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  news_article_id uuid references public.app_news_articles(id) on delete cascade,
  outside_article_id uuid references public.app_outside_articles(id) on delete cascade,
  rating smallint not null,
  rated_at timestamptz not null default now(),
  constraint app_read_ratings_rating_check check (rating in (-1, 1)),
  constraint app_read_ratings_one_article_check check (num_nonnulls(news_article_id, outside_article_id) = 1),
  constraint app_read_ratings_news_key unique (workspace_id, news_article_id),
  constraint app_read_ratings_outside_key unique (workspace_id, outside_article_id)
);
create index app_read_ratings_recent_idx on public.app_read_ratings(workspace_id, rated_at desc);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기는 필요한 칸만, 고치기 없음.
alter table public.app_read_ratings enable row level security;
revoke all on table public.app_read_ratings from public, anon, authenticated, service_role;
grant select, delete on table public.app_read_ratings to authenticated;
grant insert (workspace_id, news_article_id, outside_article_id, rating) on table public.app_read_ratings to authenticated;

create policy read_ratings_owner_all on public.app_read_ratings for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), 트리거 없음, anon·PUBLIC·service_role 권한 없음,
-- id·시각 넣기 불가, 고치기 불가. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_read_ratings'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_read_ratings'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_read_ratings'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_read_ratings', 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', 'public.app_read_ratings', 'select,insert,update,references')
     or has_table_privilege('service_role', 'public.app_read_ratings', 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', 'public.app_read_ratings', 'select,insert,update,references')
     or has_table_privilege('authenticated', 'public.app_read_ratings', 'insert,update,truncate,references,trigger')
     or has_any_column_privilege('authenticated', 'public.app_read_ratings', 'update')
     or has_column_privilege('authenticated', 'public.app_read_ratings', 'id', 'insert')
     or has_column_privilege('authenticated', 'public.app_read_ratings', 'rated_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_read_ratings', 'workspace_id', 'insert')
     or not has_column_privilege('authenticated', 'public.app_read_ratings', 'news_article_id', 'insert')
     or not has_column_privilege('authenticated', 'public.app_read_ratings', 'outside_article_id', 'insert')
     or not has_column_privilege('authenticated', 'public.app_read_ratings', 'rating', 'insert')
     or not has_table_privilege('authenticated', 'public.app_read_ratings', 'select,delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_read_ratings'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_read_ratings'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_read_ratings'::regclass and not tgisinternal) <> 0
     or (select count(*) from public.app_read_ratings) <> 0 then
    raise exception 'READ_RATINGS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261128071000', 'read_ratings', array['HOME read ratings: app_read_ratings (owner RLS, one rating -1/1 per workspace and news or outside article, select/delete, insert named columns, no update)']);
commit;
