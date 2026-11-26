begin;
-- 20261127030000_memos_record_link의 짝 되돌리기. 종류 검사를 앞 단계(20261125060000) 모양(아홉 종류)으로, 넣기 정책을 20261125060000 정의로 되돌리고,
-- 이번 기록 1행을 지운다. record_link(연결 기록)에 남긴 메모가 있으면 검사를 되돌릴 수 없어 그 메모 행만 지운다(다른 메모·연결 기록은 그대로).
-- 되돌리기 전에 이 화면 PR이 운영에 있으면 그것을 먼저 되돌린다(아니면 연결 기록 [메모] 저장이 '저장하지 못했어요'로 보임).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261127030000' and name = 'memos_record_link') <> 1 then
    raise exception 'MEMOS_RECORD_LINK_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from public.app_memos where target_type = 'record_link';
alter table public.app_memos drop constraint app_memos_target_type_check;
alter table public.app_memos add constraint app_memos_target_type_check
  check (target_type in ('note', 'news', 'outside', 'reading', 'brief', 'document', 'meeting', 'org_record', 'telegram'));

drop policy memos_owner_insert on public.app_memos;
create policy memos_owner_insert on public.app_memos for insert to authenticated
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (target_type <> 'note' or exists (
      select 1 from public.app_notes n
      where n.id = target_id and n.workspace_id = app_memos.workspace_id and n.kind = 'note'))
    and (target_type <> 'document' or exists (
      select 1 from public.app_documents d
      where d.id = target_id and d.workspace_id = app_memos.workspace_id))
    and (target_type <> 'meeting' or exists (
      select 1 from public.app_meetings m
      where m.id = target_id and m.workspace_id = app_memos.workspace_id))
    and (target_type <> 'org_record' or exists (
      select 1 from public.app_suborganization_updates u
      join public.app_suborganizations o on o.id = u.organization_id
      where u.id = target_id and o.workspace_id = app_memos.workspace_id))
    and (target_type <> 'telegram' or (
      private.app_workspace_has_feature(workspace_id, 'telegram')
      and exists (
        select 1 from public.app_feed_items f
        where f.id = target_id and f.workspace_id = app_memos.workspace_id and f.source = 'telegram'))));

delete from supabase_migrations.schema_migrations
  where version = '20261127030000' and name = 'memos_record_link';
commit;
