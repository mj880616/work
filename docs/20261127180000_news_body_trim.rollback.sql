begin;
-- 20261127180000_news_body_trim의 짝 되돌리기(SQL Editor 전용 — 짝 migration이 확장 규칙(DEFINER·service_role 실행권)이라 승인형 workflow rollback 모드 대상 아님). 새 쿼리 창(+)에서 실행한다.
-- 먼저 매일 정리를 이전 본문으로 되돌린다(docs/ops/news-body-trim-daily.rollback.sql — 이 함수를 부르지 않게). 그다음 이 파일.
-- 되돌리는 것: 새 함수와 기록 1행. 이미 비운 본문은 되살리지 않는다(표시 줄 trim@1은 남고, 화면은 그 글을 '원래 사이트 ↗'로 그대로 보인다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
drop function public.app_news_trim_bodies(timestamptz, integer);
delete from supabase_migrations.schema_migrations where version = '20261127180000' and name = 'news_body_trim';
commit;
