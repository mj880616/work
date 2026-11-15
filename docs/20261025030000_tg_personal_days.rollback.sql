begin;
-- 20261025030000_tg_personal_days의 짝 되돌리기. 새 표 1개(정책·색인 포함)와 이번 기록 1행만 지운다.
-- 요약 줄이 한 줄이라도 있으면 멈춘다. 들어온 기록을 지워서 통과시키지 않는다(Drive 원본은 어느 경우에도 그대로).
-- 그런 경우 먼저 collector-feed 비밀값을 지워 입구를 닫고, 보관 여부를 정한 뒤 다시 계획한다.
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_tg_personal_days in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261025030000' and name = 'tg_personal_days') <> 1 then
    raise exception 'TG_PERSONAL_DAYS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_tg_personal_days) then
    raise exception 'TG_PERSONAL_DAYS_ROLLBACK_BLOCKED: personal summary rows exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_tg_personal_days;

delete from supabase_migrations.schema_migrations
  where version = '20261025030000' and name = 'tg_personal_days';
commit;
