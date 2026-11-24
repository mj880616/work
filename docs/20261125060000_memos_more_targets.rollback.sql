begin;
-- 20261125060000_memos_more_targets의 짝 되돌리기. 종류 검사를 원래 모양(note·news·outside·reading·brief)으로, 넣기 정책을 20261125030000 원래 정의로,
-- 이번 기록 1행을 지운다. 새 네 종류(자료실·사업 보고·담당조직 기록·텔레그램)에 남긴 메모가 있으면 검사를 되돌릴 수 없어 그 메모 행만 지운다
-- (원문 자료·보고·기록·소식과 노트·기사·저장한 글 메모는 그대로). 되돌리기 전에 이 화면 PR이 운영에 있으면 그것을 먼저 되돌린다
-- (아니면 네 화면의 [메모 남기기]가 '저장하지 못했어요'로 보임). SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125060000' and name = 'memos_more_targets') <> 1 then
    raise exception 'MEMOS_MORE_TARGETS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from public.app_memos where target_type in ('document', 'meeting', 'org_record', 'telegram');
alter table public.app_memos drop constraint app_memos_target_type_check;
alter table public.app_memos add constraint app_memos_target_type_check
  check (target_type in ('note', 'news', 'outside', 'reading', 'brief'));

drop policy memos_owner_insert on public.app_memos;
create policy memos_owner_insert on public.app_memos for insert to authenticated
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (target_type <> 'note' or exists (
      select 1 from public.app_notes n
      where n.id = target_id and n.workspace_id = app_memos.workspace_id and n.kind = 'note')));

delete from supabase_migrations.schema_migrations
  where version = '20261125060000' and name = 'memos_more_targets';
commit;
