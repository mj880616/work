begin;
-- 20261023140000_weekly_exec_requests의 짝 되돌리기. 새 표 1개(정책 포함)와 이번 기록 1행만 지운다.
-- 저장한 요청 줄이 한 줄이라도 있으면 멈춘다. 명진이 넣은 요청 줄을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 화면에서 각 주 요청 표를 캡처·보관(또는 [복사])한 뒤 다시 계획한다.
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_weekly_exec_requests in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261023140000' and name = 'weekly_exec_requests') <> 1 then
    raise exception 'WEEKLY_EXEC_REQUESTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_weekly_exec_requests where jsonb_array_length(items) > 0) then
    raise exception 'WEEKLY_EXEC_REQUESTS_ROLLBACK_BLOCKED: saved request rows exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_weekly_exec_requests;

delete from supabase_migrations.schema_migrations
  where version = '20261023140000' and name = 'weekly_exec_requests';
commit;
