begin;
-- 20261125120000_todo_tg_auto_done의 짝 되돌리기. 함수 3개, 새 검사 2개, 새 칸 4개, 기록 1행을 걷어 낸다.
-- 후보 줄은 지우지 않는다. 저절로 '이미 함'으로 옮긴 줄은 status='done' 그대로 남는다(옮긴 까닭 칸만 사라짐 — 화면은 '이미 함'으로 보임).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 엄격 규칙만이라 drop function·drop column을 받지 않는다).
-- collector-feed는 새 함수가 없으면(404) 옛 함수로 넣고 앞 요청 옮기기를 건너뛰며, 화면은 새 칸이 없으면 옛 칸으로 읽으므로 먼저 되돌리지 않아도 된다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261125120000' and name = 'todo_tg_auto_done') <> 1 then
    raise exception 'TODO_TG_AUTO_DONE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_todo_tg_auto_done(uuid, uuid[]);
drop function public.app_todo_tg_open_asks(uuid, text);
drop function public.app_todo_candidate_from_telegram_at(uuid, text, text, text, date, timestamptz, text, text);
alter table public.app_todo_candidates drop constraint app_todo_candidates_auto_done_check;
alter table public.app_todo_candidates drop constraint app_todo_candidates_ask_ref_check;
alter table public.app_todo_candidates drop column auto_done_at;
alter table public.app_todo_candidates drop column auto_done;
alter table public.app_todo_candidates drop column ask_ref;
alter table public.app_todo_candidates drop column ask_at;

delete from supabase_migrations.schema_migrations
  where version = '20261125120000' and name = 'todo_tg_auto_done';
commit;
