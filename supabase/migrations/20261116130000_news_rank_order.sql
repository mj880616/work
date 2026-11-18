begin;
-- S63-12 NEWS-언론등급정렬 ①(DB). 명진 결정(11/16 12:22): "주식 연예 스포츠 날씨 제외 노동 우선 / 사회 그 다음 정치 경제는 관련도 높은 것 위주로".
-- 앞 작업 #2713(S63-10)이 수집 때 거르기·등급 규칙(supabase/functions/_shared/news-rank.ts, 1 노동 > 2 사회 > 3 정치·경제)을 넣었지만
-- 등급을 담을 칸이 없어 화면 정렬이 빠졌다. 이 파일은 그 칸만 더한다. 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다.
--
-- 무엇: 공용 기사 app_news_articles에 빈 칸 둘과 정렬용 색인 하나.
--   news_rank smallint null — 1 노동 · 2 사회 · 3 정치·경제(관련 있는 것). 수집기(Edge news-feed, service_role)만 쓴다. null = 등급 없음(채널 기사·옛 줄).
--   kst_day   date null     — 받은 날(서울). 새 줄은 기본값이 넣은 순간의 서울 날짜를 채운다(created_at 기본값 now()와 같은 순간).
--                              기존 줄은 빈 값으로 시작한다(칸을 먼저 만들고 기본값은 따로 걸어 표를 다시 쓰지 않음, 기존 행 값 변경 없음).
--   색인 app_news_articles_day_rank_idx (kst_day desc nulls last, news_rank asc nulls last, created_at desc, id desc) — 화면 정렬 순서 그대로.
-- 옛 줄(최근 30일) 채우기는 Edge news-feed 'prune' 단계가 한다(AI 없음, 지우기 없음). 이 파일은 행 값을 바꾸지 않는다.
-- 권한: 표 grant·정책·RLS 변경 없음, 새 함수·트리거 없음. 읽기는 지금 기사 읽기 정책 두 개 그대로(authenticated 표 SELECT),
--   쓰기는 지금처럼 service_role 표 권한(수집기)뿐 — authenticated는 이 표에 넣기·고치기 권한이 없고 이번에도 주지 않는다.
-- 순서: 이 DB 적용 → Edge news-feed 배포(넣을 때 news_rank를 씀) → 화면. Edge가 먼저 나가면 없는 칸에 쓰려다 수집이 실패하므로 반드시 이 순서.
-- 되돌리기: Edge를 앞 커밋으로 되돌린 뒤 짝 rollback(칸 둘·검사·색인·기록 1행만 지움). 칸 값은 서버가 다시 계산할 수 있는 값이라 지워도 기사·표시는 그대로.
-- 짝: docs/20261116130000_news_rank_order.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_news_articles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261116130000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115230000' and name = 'news_user_save') <> 1
     or to_regclass('public.app_news_articles') is null
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_news_articles'::regclass and not attisdropped and attname in ('news_rank', 'kst_day'))
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_news_articles_news_rank_check')
     or to_regclass('public.app_news_articles_day_rank_idx') is not null
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
    raise exception 'NEWS_RANK_ORDER_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_news_articles
  add column news_rank smallint,
  add column kst_day date;
alter table public.app_news_articles
  add constraint app_news_articles_news_rank_check check (news_rank is null or news_rank between 1 and 3);
-- 기본값은 칸을 만든 뒤 따로: 기존 줄은 빈 값 그대로, 이 뒤로 넣는 줄만 넣은 순간의 서울 날짜.
alter table public.app_news_articles
  alter column kst_day set default ((pg_catalog.now() at time zone 'Asia/Seoul')::date);
create index app_news_articles_day_rank_idx on public.app_news_articles
  (kst_day desc nulls last, news_rank asc nulls last, created_at desc, id desc);

-- 사후 확인: 권한 경계 그대로, 기존 줄은 모두 빈 값. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_news_articles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_news_articles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_news_articles', 'insert,update,delete')
     or has_any_column_privilege('authenticated', 'public.app_news_articles', 'insert,update')
     or (select count(*) from pg_policy where polrelid = 'public.app_news_articles'::regclass) <> 2
     or exists (select 1 from public.app_news_articles where news_rank is not null or kst_day is not null) then
    raise exception 'NEWS_RANK_ORDER_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261116130000', 'news_rank_order', array['S63-12 NEWS-rank-order: app_news_articles adds news_rank smallint null (CHECK null or 1-3) and kst_day date null (default Seoul date of now() set after the column so existing rows stay null) plus index app_news_articles_day_rank_idx (kst_day desc nulls last, news_rank asc nulls last, created_at desc, id desc); no grants, policies, RLS, functions, triggers or row values changed']);
commit;
