begin;
-- 20261124130000_account_delete의 짝 되돌리기. 새 트리거·함수 3개·실행 표와 이번 기록 1행만 지운다. 기존 표·자료는 건드리지 않는다.
-- 되돌리기 전에 화면을 [계정 삭제] 버튼이 없는 이전 판으로 되돌리거나 Edge 함수 account-delete를 부르지 않게 둔다(부르면 '준비 중' 오류만).
-- 이미 계정을 삭제한 사람의 기록은 되돌아오지 않는다(복구용 사본 없음 — 되돌리기는 기능을 없애는 것뿐).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 함수·표 지우기를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261124130000' and name = 'account_delete') <> 1
     or (select count(*) from public.app_account_delete_runs) <> 0 then
    raise exception 'ACCOUNT_DELETE_ROLLBACK_BLOCKED: migration record or run rows differ';
  end if;
end
$$;

drop trigger app_account_delete_runs_run on public.app_account_delete_runs;
drop function public.app_account_delete(text);
drop function public.app_account_delete_check();
drop function private.app_account_delete_run();
drop table public.app_account_delete_runs;

delete from supabase_migrations.schema_migrations
  where version = '20261124130000' and name = 'account_delete';
commit;
