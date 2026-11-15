begin;
-- 20261017052234_journal_memo_notes_kind의 짝 되돌리기. 열·검사 조건·색인만 지우고 바구니 본문 규칙 원문으로 되돌린다.
-- 노트·업무일지·일기 행이 한 건이라도 있으면 멈춘다. 데이터를 지워서 통과시키지 않는다.
-- 그런 행이 있으면 먼저 내용을 캡처·보관하고 복구 계획을 따로 세운다(화면 PR 2·3도 함께 되돌려야 한다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_notes in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261017052234' and name = 'journal_memo_notes_kind') <> 1 then
    raise exception 'JOURNAL_MEMO_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_notes
      where kind <> 'basket' or title is not null or journal_day is not null) then
    raise exception 'JOURNAL_MEMO_ROLLBACK_BLOCKED: note/work/diary rows exist; preserve and plan recovery';
  end if;
end
$$;

drop index public.app_notes_kind_occurred_idx;
drop index public.app_notes_journal_day_unique;
alter table public.app_notes
  drop constraint app_notes_raw_text_check,
  drop constraint app_notes_diary_private_check,
  drop constraint app_notes_work_line_check,
  drop constraint app_notes_journal_day_check,
  drop constraint app_notes_title_check,
  drop constraint app_notes_kind_check,
  drop column journal_day,
  drop column title,
  drop column kind,
  -- 20261010120000_basket1_notes_links의 바구니 규칙 원문으로 되돌린다.
  add constraint app_notes_raw_text_check check (
    length(raw_text) <= 20000
    and (length(raw_text) >= 1 or jsonb_array_length(attachments) >= 1)
  );

delete from supabase_migrations.schema_migrations
  where version = '20261017052234' and name = 'journal_memo_notes_kind';
commit;
