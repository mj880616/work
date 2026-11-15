begin;
-- 20261025190000_record_overlap_db의 짝 되돌리기. 새 표 1개(정책·트리거 포함), 새 함수 2개, 이번 기록 1행만 지운다.
-- 사용자 판정(decided_by='user')이 한 줄이라도 있으면 멈춘다. 명진이 [같은 일 아님] 등으로 남긴 판정을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 그 판정을 보관(행 복사)하고 다시 계획한다. AI 판정·연결 판정만 있으면 지운다(다시 판정하면 다시 생기는 값).
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_record_overlaps in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261025190000' and name = 'record_overlap_db') <> 1 then
    raise exception 'RECORD_OVERLAP_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_record_overlaps where decided_by = 'user') then
    raise exception 'RECORD_OVERLAP_ROLLBACK_BLOCKED: user verdict rows exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_record_overlaps;
drop function public.app_record_overlap_set(uuid, jsonb);
drop function private.app_record_overlap_guard();

delete from supabase_migrations.schema_migrations
  where version = '20261025190000' and name = 'record_overlap_db';
commit;
