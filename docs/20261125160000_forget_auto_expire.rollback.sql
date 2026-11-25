begin;
-- 20261125160000_forget_auto_expire의 짝 되돌리기. SQL Editor(폰 경로 C) 전용(cron 문·drop function·drop column이 있어 rollback 모드 엄격 규칙이 받지 않음).
-- 하는 것: 예약 'web2_forget_auto_expire' 끄고 지움 → 함수 셋 지움 → 검사를 20261125120000 모양으로 되돌림 → 칸 ask_direct·ask_from 지움 → 기록 1행 지움.
-- 저절로 '이미 함(지남)'으로 옮긴 줄이 있으면 검사를 좁힐 수 없으므로, 그 줄의 까닭 칸(auto_done·auto_done_at)만 비운다(status='done'은 그대로 —
--   화면에는 '이미 함'으로 남는다. 처리 전으로 되살리지 않는다).
-- collector-feed는 새 넣기 함수가 없으면(404) 20261125120000의 함수로 물러나므로 먼저 되돌리지 않아도 된다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261125160000' and name = 'forget_auto_expire') <> 1 then
    raise exception 'FORGET_AUTO_EXPIRE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from cron.job where jobname = 'web2_forget_auto_expire') then
    perform cron.unschedule('web2_forget_auto_expire');
  end if;
end
$$;

drop function public.app_forget_auto_expire();
drop function public.app_todo_candidate_from_telegram_ask(uuid, text, text, text, date, timestamptz, text, text, boolean, text);
drop function public.app_todo_tg_open_asks_peer(uuid, text);
update public.app_todo_candidates set auto_done = null, auto_done_at = null where auto_done = 'expired';
alter table public.app_todo_candidates drop constraint app_todo_candidates_auto_done_check;
alter table public.app_todo_candidates add constraint app_todo_candidates_auto_done_check
  check ((auto_done is null and auto_done_at is null) or (auto_done = 'replied' and auto_done_at is not null and source_kind = 'telegram'));
alter table public.app_todo_candidates drop constraint app_todo_candidates_ask_from_check;
alter table public.app_todo_candidates drop constraint app_todo_candidates_ask_direct_check;
alter table public.app_todo_candidates drop column ask_from;
alter table public.app_todo_candidates drop column ask_direct;

delete from supabase_migrations.schema_migrations
  where version = '20261125160000' and name = 'forget_auto_expire';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125160000')
     or exists (select 1 from cron.job where jobname = 'web2_forget_auto_expire') then
    raise exception 'FORGET_AUTO_EXPIRE_ROLLBACK_INCOMPLETE; stop';
  end if;
end
$$;
commit;
