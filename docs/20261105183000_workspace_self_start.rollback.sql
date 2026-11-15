begin;
-- 20261105183000_workspace_self_start의 짝 되돌리기. 새 함수 둘·스위치 표·기록 1행만 지운다. 기존 표·정책·권한·트리거는 이 migration이 바꾸지 않았으므로 그대로다.
-- SQL Editor(폰 경로 C) 전용(승인형 workflow rollback 모드는 drop table을 받지 않을 수 있음).
-- 먼저 화면을 이전 Pages 판으로 되돌리지 않아도 된다: 함수가 없으면 로그인 화면은 지금처럼 접근 거부만 보인다(상태 확인 실패 = 버튼 없음).
-- 스위치를 켠 뒤 누가 이미 작업공간을 만들었다면 그 작업공간·owner 행·프로필은 남는다(자료 보존). 지울지는 따로 결정한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261105183000' and name = 'workspace_self_start') <> 1 then
    raise exception 'WORKSPACE_START_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_workspace_start();
drop function public.app_workspace_start_status();
drop table public.app_workspace_signup;

delete from supabase_migrations.schema_migrations
  where version = '20261105183000' and name = 'workspace_self_start';
commit;
