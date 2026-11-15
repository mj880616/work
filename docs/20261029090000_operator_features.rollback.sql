begin;
-- 20261029090000_operator_features의 짝 되돌리기(SQL Editor 경로 전용: 트리거·정책·표 삭제가 들어 있어 승인형 workflow rollback 모드는 받지 않는다).
-- 순서: 트리거 12개 삭제 → 읽기 정책 12개 삭제 → 함수 넷 삭제 → 허용 표 삭제(허용 행 2개 함께) → 기록 1행 삭제.
-- 통화·텔레그램 표 12개의 줄·칸·기존 정책·권한·기존 트리거는 건드리지 않는다. 되돌린 뒤에는 이 migration 전처럼 작업공간 owner면 통화·텔레그램을 읽는다.
-- 이미 단계 ① Edge(PR 3)가 배포돼 public.app_my_features·public.app_operator_feature_workspace를 부르고 있으면, 그 Edge를 이전 운영 소스로 먼저 되돌린 뒤 이 파일을 실행한다(안 그러면 수집·통화 화면이 오류).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1 then
    raise exception 'OPERATOR_FEATURES_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop trigger trg_op_feature_guard on public.app_feed_items;
drop trigger trg_op_feature_guard on public.app_feed_days;
drop trigger trg_op_feature_guard on public.app_call_personal;
drop trigger trg_op_feature_guard on public.app_call_edits;
drop trigger trg_op_feature_guard on public.app_call_edit_history;
drop trigger trg_op_feature_guard on public.app_tg_senders;
drop trigger trg_op_feature_guard on public.app_tg_day_senders;
drop trigger trg_op_feature_guard on public.app_feed_folders;
drop trigger trg_op_feature_guard on public.app_feed_rooms;
drop trigger trg_op_feature_guard on public.app_feed_room_days;
drop trigger trg_op_feature_guard on public.app_feed_summary_edits;
drop trigger trg_op_feature_guard on public.app_feed_summary_edit_history;
drop policy op_feature_read on public.app_feed_items;
drop policy op_feature_read on public.app_feed_days;
drop policy op_feature_read on public.app_call_personal;
drop policy op_feature_read on public.app_call_edits;
drop policy op_feature_read on public.app_call_edit_history;
drop policy op_feature_read on public.app_tg_senders;
drop policy op_feature_read on public.app_tg_day_senders;
drop policy op_feature_read on public.app_feed_folders;
drop policy op_feature_read on public.app_feed_rooms;
drop policy op_feature_read on public.app_feed_room_days;
drop policy op_feature_read on public.app_feed_summary_edits;
drop policy op_feature_read on public.app_feed_summary_edit_history;
drop function private.app_operator_feature_guard();
drop function public.app_operator_feature_workspace(text);
drop function public.app_my_features();
drop function private.app_workspace_has_feature(uuid, text);
drop table public.app_operator_features;

delete from supabase_migrations.schema_migrations
  where version = '20261029090000' and name = 'operator_features';
commit;
