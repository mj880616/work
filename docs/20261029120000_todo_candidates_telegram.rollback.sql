begin;
-- 20261029120000_todo_candidates_telegram의 짝 되돌리기. 함수 1개를 지우고 출처 종류 검사식을 앞 단계 6개로 되돌린 뒤 기록 1행을 지운다.
-- 텔레그램 후보 줄은 지우지 않는다. 아직 열린(open) 텔레그램 후보는 '무시함'으로 바꿔 화면에서 내린다(할 일로 넣은 줄은 그대로).
-- 텔레그램 줄이 남아 있을 수 있으므로 되돌린 검사식은 NOT VALID로 둔다(남은 줄은 두고, 새로 넣는 줄만 6개 출처로 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_todo_candidates in share row exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261029120000' and name = 'todo_candidates_telegram') <> 1 then
    raise exception 'TODO_TG_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_todo_candidate_from_telegram(uuid, uuid, text, text, date);

update public.app_todo_candidates set status = 'dismissed', decided_at = now()
  where source_kind = 'telegram' and status = 'open';

alter table public.app_todo_candidates drop constraint app_todo_candidates_source_kind_check;
alter table public.app_todo_candidates add constraint app_todo_candidates_source_kind_check check (
  source_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update')) not valid;

delete from supabase_migrations.schema_migrations
  where version = '20261029120000' and name = 'todo_candidates_telegram';
commit;
