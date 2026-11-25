begin;
-- 20261125143000_document_brief_edit의 짝 되돌리기. 새 함수 1개, 새 칸 둘(검사 포함), 이번 기록 1행만 지운다.
-- 사람이 고친 브리핑 글(edited)은 함께 사라지고 AI 원문(brief)은 처음부터 그대로다. 표 권한·정책은 처음부터 바꾸지 않았다.
-- 지우기 전에 화면을 이전 판으로 되돌린다(브리핑 룸 [고치기]·[원래 AI 글로 되돌리기]만 사라진다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 DEFINER 함수·칸 삭제 되돌리기를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125143000' and name = 'document_brief_edit') <> 1 then
    raise exception 'DOCUMENT_BRIEF_EDIT_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_document_brief_edit(uuid, jsonb);
alter table public.app_document_briefs drop constraint app_document_briefs_edited_check;
alter table public.app_document_briefs drop column edited, drop column edited_at;

delete from supabase_migrations.schema_migrations
  where version = '20261125143000' and name = 'document_brief_edit';
commit;
