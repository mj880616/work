begin;
-- 20261022003000_task_attachments의 짝 되돌리기. 새 표 1개(정책·색인 포함)와 이번 기록 1행만 지운다.
-- 첨부 연결이 한 줄이라도 있으면 멈춘다. 연결을 지워서 통과시키지 않는다(Drive 파일과 할 일 메모의 링크 줄은 그대로 남는다).
-- 그런 경우 먼저 화면 사용을 멈추고(google-tasks Edge를 이전 운영 소스로 되돌리면 새 첨부가 생기지 않음), 보관 여부를 정한 뒤 다시 계획한다.
-- 기존 표·정책·함수에는 손대지 않는다. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_task_attachments in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261022003000' and name = 'task_attachments') <> 1 then
    raise exception 'TASK_ATTACHMENTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_task_attachments) then
    raise exception 'TASK_ATTACHMENTS_ROLLBACK_BLOCKED: attachments exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_task_attachments;

delete from supabase_migrations.schema_migrations
  where version = '20261022003000' and name = 'task_attachments';
commit;
