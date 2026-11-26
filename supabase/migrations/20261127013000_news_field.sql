begin;
-- S71-70 ② NEWS-분야칸(DB). 사용자 결정(2026-11-26): 언론 글은 "정치 경제 사회 노동" + "칼럼 사설"만 모으고, 글마다 분야를 보이고 분야로 걸러 본다.
-- 앞 PR(S71-70 ①)이 수집 때 분야를 정하는 규칙(supabase/functions/_shared/news-rank.ts newsPick — 거르기·등급·분야 한 곳)을 넣었다.
-- 이 파일은 그 분야를 담을 빈 칸 하나와 검사만 더한다. 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다.
--
-- 무엇: 공용 기사 app_news_articles에 빈 칸 하나.
--   news_field text null — politics(정치) · economy(경제) · society(사회) · labor(노동) · opinion(칼럼·사설). 수집기(Edge news-feed, service_role)만 쓴다.
--                          null = 분야 없음(채널 기사·손으로 넣은 기사·옛 줄). 화면 글자는 앱이 키를 이름으로 바꾼다(키만 저장).
--   검사 app_news_articles_news_field_check — 빈 값 또는 다섯 키만.
-- 색인은 만들지 않는다: 화면은 지금 정렬 색인(app_news_articles_day_rank_idx)으로 읽고 분야는 그 안에서 거른다(하루 받는 줄 수가 작다).
-- 옛 줄(최근 30일) 채우기는 Edge news-feed 'prune' 단계(등급 채우기와 같은 자리)가 한다(AI 없음, 지우기 없음). 이 파일은 행 값을 바꾸지 않는다.
-- 권한: 표 grant·정책·RLS 변경 없음, 새 함수·트리거 없음. 읽기는 지금 기사 읽기 정책 두 개 그대로(authenticated 표 SELECT),
--   쓰기는 지금처럼 service_role 표 권한(수집기)뿐 — authenticated는 이 표에 넣기·고치기 권한이 없고 이번에도 주지 않는다.
-- 순서: 이 DB 적용 → Edge news-feed 배포(넣을 때 news_field를 씀) → 화면(분야 글자·걸러 보기). Edge가 먼저 나가면 없는 칸에 쓰려다 수집이 실패하므로 반드시 이 순서.
-- 되돌리기: Edge·화면을 앞 커밋으로 되돌린 뒤 짝 rollback(칸·검사·기록 1행만 지움). 칸 값은 서버가 다시 계산할 수 있는 값이라 지워도 기사·표시는 그대로.
-- 짝: docs/20261127013000_news_field.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_news_articles in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261127013000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261116130000' and name = 'news_rank_order') <> 1
     or to_regclass('public.app_news_articles') is null
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_news_articles'::regclass and not attisdropped and attname = 'news_field')
     or exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_news_articles_news_field_check')
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
    raise exception 'NEWS_FIELD_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_news_articles
  add column news_field text;
alter table public.app_news_articles
  add constraint app_news_articles_news_field_check
  check (news_field is null or news_field in ('politics', 'economy', 'society', 'labor', 'opinion'));

-- 사후 확인: 권한 경계 그대로, 기존 줄은 모두 빈 값. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_news_articles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_news_articles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_news_articles', 'insert,update,delete')
     or has_any_column_privilege('authenticated', 'public.app_news_articles', 'insert,update')
     or (select count(*) from pg_policy where polrelid = 'public.app_news_articles'::regclass) <> 2
     or exists (select 1 from public.app_news_articles where news_field is not null) then
    raise exception 'NEWS_FIELD_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261127013000', 'news_field', array['S71-70 NEWS-field: app_news_articles adds news_field text null (CHECK null or politics/economy/society/labor/opinion), existing rows stay null; no index, grants, policies, RLS, functions, triggers or row values changed']);
commit;
