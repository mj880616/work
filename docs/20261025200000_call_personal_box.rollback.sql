begin;
-- 20261025200000_call_personal_box의 짝 되돌리기(SQL Editor 경로 전용: 함수·표·칸·트리거 삭제는 workflow rollback 허용 목록 밖).
-- 개인 통화 표에 줄이 하나라도 있거나(개인·애매 통화 내용), 업무 통화에 옮긴 흔적(moved_at·refilled_at 값)이 있으면 멈춘다(자료를 잃지 않으려고). 그때는 순서:
--   1) 개인 통화함 줄을 Web2에서 업무로 옮기거나, 남길 줄이면 이 되돌리기를 하지 않는다. 지우는 일은 이 파일이 하지 않는다.
--   2) 옮긴 흔적만 남은 업무 줄은 명진 확인 뒤 별도 승인으로 두 칸을 비우고 나서 실행한다.
-- 순서: 트리거 둘(업무 표 1, 개인 표는 표와 함께) 삭제 → 새 함수 둘 삭제 → 개인 통화 표 삭제 → 트리거 함수 둘 삭제 → 새 칸 둘 삭제 → 기록 1행 삭제.
-- 업무 통화 표의 기존 줄·권한·정책·기존 트리거와 함수 본문은 건드리지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261025200000' and name = 'call_personal_box') <> 1 then
    raise exception 'CALL_PERSONAL_BOX_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_call_personal)
     or exists (select 1 from public.app_feed_items where moved_at is not null or refilled_at is not null) then
    raise exception 'CALL_PERSONAL_BOX_ROLLBACK_BLOCKED: personal box rows or move marks exist; move them to work and clear the marks first with separate approval';
  end if;
end
$$;

drop trigger app_feed_items_call_ref_guard on public.app_feed_items;
drop function public.app_call_move(uuid, text);
drop function public.app_call_work_info(uuid, text, text, uuid);
drop table public.app_call_personal;
drop function private.app_call_ref_guard();
drop function private.app_call_personal_guard();

alter table public.app_feed_items
  drop column moved_at,
  drop column refilled_at;

delete from supabase_migrations.schema_migrations
  where version = '20261025200000' and name = 'call_personal_box';
commit;
