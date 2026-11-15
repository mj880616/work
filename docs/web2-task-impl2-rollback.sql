-- TASK-구현 PR 2 되돌리기: supabase/migrations/20260927103344_task_impl2_notes_record_links.sql
-- 이 migration이 만든 두 표와 migration 기록 1행만 지운다. 다른 표·정책·함수는 건드리지 않는다.
-- 적용 직후(빈 표)에는 잃는 데이터가 없다. 앱·Edge가 연결을 쓰기 시작한 뒤 실행하면
-- 연결 정보와 메모가 함께 사라진다(Google 할 일 자체는 Google에 남는다).
-- PR 3(Edge)이 배포된 뒤라면 먼저 Edge를 이전 버전으로 되돌린 다음 실행한다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
drop table public.app_record_links;
drop table public.app_notes;
delete from supabase_migrations.schema_migrations
where version = '20260927103344' and name = 'task_impl2_notes_record_links';
commit;
