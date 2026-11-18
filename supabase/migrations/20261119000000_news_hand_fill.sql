begin;
-- S67-02 NEWS-직접넣기 ①(DB). 명진 11/19 07:36: "뉴스 기사를 공유하기로 뉴스 보관함에 넣었는데 아무것도 가져오지 못하였어요.
--   이런 경우에 수동으로 수정할 수 있도록 해 주세요 / 제목과 매체 기자 이름 가져온 시간 본문 등을 제가 입력할 수 있도록요."
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 공용 기사 app_news_articles에 빈 칸 둘.
--   author    text null        — 기자 이름(사람이 손으로 넣은 값만). 1~80자, 앞뒤 공백 없음, 제어 문자 없음.
--   manual_at timestamptz null — 사람이 손으로 제목·매체·기자·시각·본문을 넣은 마지막 시각(화면 '직접 넣음' 표시). null = 수집기가 읽은 그대로.
--   기존 줄은 모두 빈 값으로 시작한다(기본값 없음, 표 다시 쓰기·행 값 변경 없음).
-- 쓰기: 지금처럼 service_role 표 권한(Edge news-feed — 새 'hand_fill' 입구가 운영자 기능 키 확인 뒤 씀)뿐.
--   authenticated는 이 표에 넣기·고치기 권한이 없고 이번에도 주지 않는다(화면은 읽기만). 표 grant·정책·RLS·함수·트리거 변경 없음.
-- 순서: 이 DB 적용 → Edge news-feed 배포(hand_fill이 새 칸에 씀) → 화면(새 칸을 읽음). 화면이 먼저 나가면 없는 칸을 읽어 목록이 비므로 반드시 이 순서.
-- 되돌리기: 화면 → Edge 순서로 앞 커밋으로 되돌린 뒤 짝 rollback(검사·칸 둘·기록 1행만 지움). 지우면 손으로 넣은 기자 이름·'직접 넣음' 표시만 사라지고
--   손으로 넣은 제목·매체·시각·본문(기존 칸)은 그대로 남는다.
-- 짝: docs/20261119000000_news_hand_fill.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_news_articles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261119000000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115100000' and name = 'news_for_all') <> 1
     or to_regclass('public.app_news_articles') is null
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_news_articles'::regclass and not attisdropped and attname in ('author', 'manual_at'))
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_news_articles_author_check')
     -- RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated는 읽기만(넣기·고치기·지우기 없음, 칸 권한도 없음).
     or exists (select 1 from pg_class where oid = 'public.app_news_articles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_news_articles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_news_articles', 'insert,update,delete')
     or has_any_column_privilege('authenticated', 'public.app_news_articles', 'insert,update')
     or not has_table_privilege('authenticated', 'public.app_news_articles', 'select')
     or not has_table_privilege('service_role', 'public.app_news_articles', 'insert,update')
     -- 읽기 정책은 지금 두 개 그대로.
     or (select count(*) from pg_policy where polrelid = 'public.app_news_articles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'app_news_articles'
         and policyname in ('news_articles_reader_select', 'news_articles_scrap_operator_select')
         and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = array['authenticated']::name[]) <> 2 then
    raise exception 'NEWS_HAND_FILL_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_news_articles
  add column author text,
  add column manual_at timestamptz;
alter table public.app_news_articles
  add constraint app_news_articles_author_check check (
    author is null or (char_length(author) between 1 and 80 and author = btrim(author) and author !~ '[[:cntrl:]]'));

-- 사후 확인: 권한 경계 그대로, 기존 줄은 모두 빈 값. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_news_articles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_news_articles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_news_articles', 'insert,update,delete')
     or has_any_column_privilege('authenticated', 'public.app_news_articles', 'insert,update')
     or (select count(*) from pg_policy where polrelid = 'public.app_news_articles'::regclass) <> 2
     or exists (select 1 from public.app_news_articles where author is not null or manual_at is not null) then
    raise exception 'NEWS_HAND_FILL_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261119000000', 'news_hand_fill', array['S67-02 NEWS-hand-fill: app_news_articles adds author text null (CHECK null or 1-80 chars, trimmed, no control characters) and manual_at timestamptz null, no defaults so existing rows stay null; written only by service_role (Edge news-feed hand_fill after the operator feature check); no grants, policies, RLS, functions, triggers or row values changed']);
commit;
