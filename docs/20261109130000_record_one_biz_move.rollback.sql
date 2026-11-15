begin;
-- S54-29 B-2 되돌리기. 승인형 DB workflow의 rollback 모드는 자료 DELETE를 받지 않으므로(docs/ops-db-workflow.md
-- "rollback 짝 파일의 허용 범위") 커맨드센터 승인 뒤 SQL Editor 새 쿼리 창(+)에서 실행한다(폰 경로 C).
-- 순서: ① 짝 precheck를 실행해 캡처 → ② 이 파일 붙여 넣고 첫 줄 begin;·마지막 줄 commit;·대상 프로젝트 확인 → 실행 → Success 캡처
--  → ③ 짝 precheck를 다시 실행: 'already moved' = 0, 'new migration absent' = 예, 'progress rows to move'가 적용 전 값과 같으면 원래대로다.
-- 지우는 것: 옮긴 표시(source_kind 'progress')가 있는 사업 기록 줄과 이번 기록 1행뿐.
--  원래 사업 진행 기록과 직접 쓴 사업 기록(user·update·feed·memorable)은 지우지 않는다.
--  progress 종류는 B-1 검사 트리거가 로그인 사용자·서버 키의 넣기를 막아 이 옮기기 SQL만 만들 수 있으므로, 지우는 줄은 옮긴 줄뿐이다.
-- 주의: 옮긴 줄을 화면에서 고쳤다면 그 고친 글도 함께 지워진다(원래 진행 기록의 글은 그대로 남음).
-- B-1(record_one_biz)을 되돌리려면 이 파일을 먼저 실행한다(B-1 rollback은 옮긴 줄이 남아 있으면 멈춘다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_business_records in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261109130000' and name = 'record_one_biz_move') <> 1 then
    raise exception 'RECORD_ONE_BIZ_MOVE_ROLLBACK_NOT_APPLIED; stop';
  end if;
end
$$;

delete from public.app_business_records where source_kind = 'progress';

delete from supabase_migrations.schema_migrations where version = '20261109130000' and name = 'record_one_biz_move';
commit;
