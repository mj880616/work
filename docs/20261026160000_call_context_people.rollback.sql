begin;
-- 20261026160000_call_context_people의 짝 되돌리기(SQL Editor 경로 전용: 함수 삭제는 승인형 workflow rollback 모드가 받지 않는다). 새 함수 하나와 기록 1행만 걷어 낸다. 어떤 표의 줄·권한·정책도 건드리지 않는다.
-- 이 함수를 쓰는 서버 입구(collector-feed)는 함수가 없으면 사람 목록을 비우고 조직·프로젝트 이름만 돌려주므로(404 처리) 먼저 되돌려도 안전하다.
-- 순서: 함수 삭제 → 기록 1행 삭제.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function public.app_call_context_people(uuid, integer);

delete from supabase_migrations.schema_migrations
  where version = '20261026160000' and name = 'call_context_people';
commit;
