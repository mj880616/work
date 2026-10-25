begin;
-- 20261025190000_call_personal의 짝 되돌리기(SQL Editor 경로 전용: 함수·index·칸·CHECK 삭제와 함수 본문 복원은 workflow rollback 허용 목록 밖).
-- 개인·애매 통화 줄(source가 call_personal·call_unsure)이나 옮긴 흔적(moved_at·refilled_at 값)이 하나라도 있으면 멈춘다(자료를 잃지 않으려고). 그때는 순서:
--   1) 개인·애매 줄을 Web2에서 업무로 옮기거나, 남길 줄이면 이 되돌리기를 하지 않는다. 지우는 일은 이 파일이 하지 않는다.
--   2) 옮긴 흔적(moved_at·refilled_at)만 남은 업무 줄은 명진 확인 뒤 별도 승인으로 두 칸을 비우고 나서 실행한다.
-- 순서: 트리거 함수를 앞 단계(20261024210000) 본문 그대로 복원 → 새 함수 둘 삭제 → index 삭제 → CHECK를 옛 두 개로(새 class CHECK 삭제) → 새 칸 삭제 → 기록 1행 삭제.
-- 기존 줄·권한·정책에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261025190000' and name = 'call_personal') <> 1 then
    raise exception 'CALL_PERSONAL_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_feed_items where source in ('call_personal', 'call_unsure') or moved_at is not null or refilled_at is not null) then
    raise exception 'CALL_PERSONAL_ROLLBACK_BLOCKED: personal/unsure rows or move marks exist; move them to work and clear the marks first with separate approval';
  end if;
end
$$;

-- 앞 단계(20261024210000) 본문 그대로.
create or replace function private.app_feed_item_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  if tg_op = 'UPDATE' and new.raw_text is distinct from old.raw_text and new.raw_text is not null then
    raise exception using errcode = '23514', message = 'FEED_RAW_TEXT_CLEAR_ONLY: the stored copy can only be cleared';
  end if;
  if (new.project_id is not null and not exists (
       select 1 from public.app_spaces s
       where s.id = new.project_id and s.workspace_id = new.workspace_id))
     or (new.suggested_project_id is not null and not exists (
       select 1 from public.app_spaces s
       where s.id = new.suggested_project_id and s.workspace_id = new.workspace_id))
     or (new.organization_id is not null and not exists (
       select 1 from public.app_suborganizations o
       where o.id = new.organization_id and o.workspace_id = new.workspace_id)) then
    raise exception using errcode = '23514', message = 'FEED_LINK_SCOPE: linked organization or project must be in the same workspace';
  end if;
  return new;
end
$guard$;
revoke all on function private.app_feed_item_guard() from public, anon, authenticated, service_role;

drop function public.app_feed_call_move(uuid, text);
drop function public.app_feed_call_work_info(uuid, text, text, uuid);
drop index public.app_feed_items_call_ref_key;

alter table public.app_feed_items
  drop constraint app_feed_items_call_class_check,
  drop constraint app_feed_items_source_check,
  drop constraint app_feed_items_shape_check,
  add constraint app_feed_items_source_check check (source in ('call', 'telegram')),
  add constraint app_feed_items_shape_check check (
    (source = 'call' and room_key is null and room_label is null and title is not null and raw_count = 0)
    or (source = 'telegram' and room_key is not null and room_label is not null and counterpart is null and not speaker_split));

alter table public.app_feed_items
  drop column moved_at,
  drop column refilled_at;

delete from supabase_migrations.schema_migrations
  where version = '20261025190000' and name = 'call_personal';
commit;
