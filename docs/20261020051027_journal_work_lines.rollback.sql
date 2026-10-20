begin;
-- 20261020051027_journal_work_lines의 짝 되돌리기. 업무일지 검사 조건만 예전 "하루 한 줄" 규칙(20261017052234 원문)으로 되돌린다.
-- 두 줄 이상인 업무일지 날이 한 건이라도 있으면 멈춘다. 데이터를 지우거나 고쳐서 통과시키지 않는다.
-- 그런 날이 있으면 먼저 내용을 캡처·보관하고(화면에서 줄을 지워 하루 한 줄로 만들지 여부는 사용자 결정), 화면 PR도 함께 되돌린다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_notes in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261020051027' and name = 'journal_work_lines') <> 1 then
    raise exception 'JOURNAL_WORK_LINES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_notes
      where kind = 'work' and (raw_text ~ '[\r\n]' or length(btrim(raw_text)) not between 1 and 300)) then
    raise exception 'JOURNAL_WORK_LINES_ROLLBACK_BLOCKED: multi-line work days exist; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_notes
  drop constraint app_notes_work_line_check,
  -- 20261017052234_journal_memo_notes_kind의 업무일지 규칙 원문.
  add constraint app_notes_work_line_check check (
    kind <> 'work' or (length(btrim(raw_text)) between 1 and 300 and raw_text !~ '[\r\n]' and attachments = '[]'::jsonb)
  );

delete from supabase_migrations.schema_migrations
  where version = '20261020051027' and name = 'journal_work_lines';
commit;
