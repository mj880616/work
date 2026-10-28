begin;
-- 20261029010000_journal_ai_drafts의 짝 되돌리기. 새 표 1개(정책 포함)와 이번 기록 1행만 지운다.
-- 업무일지 줄(app_notes kind=work)은 건드리지 않는다. 지워지는 것은 아직 확정하지 않은 AI 초안뿐이다(확정한 줄은 업무일지 행에 있음).
-- 지우기 전에 ai-assist를 journal_draft 이전 판으로 되돌린다(화면은 표가 없으면 초안 없이 지금처럼 동작).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029010000' and name = 'journal_ai_drafts') <> 1 then
    raise exception 'JOURNAL_AI_DRAFTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_journal_drafts;

delete from supabase_migrations.schema_migrations
  where version = '20261029010000' and name = 'journal_ai_drafts';
commit;
