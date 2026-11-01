begin;
-- 20261101210000_push_log_notices의 짝 되돌리기. app_push_log의 새 칸 둘·검사·색인과 이번 기록 1행만 되돌린다.
-- 지워지는 것: 알림 줄에만 뜬 기록('shown' 행)과 '열었음'·'알림 줄에 뜸' 시각. 폰으로 보낸 기록·기기·알림 설정은 그대로다.
-- 먼저 phone-push를 이 변경 전 ref로 되돌리고 화면이 notices·recent·opened를 부르지 않게 되돌린 뒤 실행한다.
-- SQL Editor(폰 경로 C) 또는 승인형 DB workflow rollback 모드. 권한·정책·함수는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261101210000' and name = 'push_log_notices') <> 1 then
    raise exception 'PUSH_LOG_NOTICES_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from public.app_push_log where status = 'shown';
drop index public.app_push_log_ws_sent_idx;
alter table public.app_push_log drop constraint app_push_log_shown_check;
alter table public.app_push_log drop constraint app_push_log_status_check;
alter table public.app_push_log
  add constraint app_push_log_status_check check (status in ('sent', 'held_quiet', 'failed', 'skipped_off'));
alter table public.app_push_log drop column opened_at;
alter table public.app_push_log drop column shown_at;

delete from supabase_migrations.schema_migrations
  where version = '20261101210000' and name = 'push_log_notices';
commit;
