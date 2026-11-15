begin;
-- 20261026120000_call_user_edit의 짝 되돌리기(SQL Editor 경로 전용: 자료 보호 확인(DO 블록)이 있어 승인형 workflow rollback 모드는 받지 않는다).
-- 사용자가 고친 값(app_call_edits)이나 고친 이력(app_call_edit_history)이 한 줄이라도 있으면 멈춘다(고친 값을 잃지 않으려고). 그때 순서:
--   1) 필요하면 고친 값을 화면에서 확인해 따로 적어 둔다(이 되돌리기는 두 표를 지우므로 고친 값도 함께 사라진다).
--   2) 명진이 "고친 값을 버려도 된다"고 결정했을 때만 두 표를 비운 뒤(SQL Editor에서 별도 승인) 이 되돌리기를 실행한다. 이 파일은 줄을 지우지 않는다.
-- 순서: 함수 삭제 → 새 표 둘 삭제(정책·색인 함께) → 기록 1행 삭제. 통화 두 표의 기존 줄·권한·정책·트리거는 건드리지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261026120000' and name = 'call_user_edit') <> 1 then
    raise exception 'CALL_USER_EDIT_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_call_edits) or exists (select 1 from public.app_call_edit_history) then
    raise exception 'CALL_USER_EDIT_ROLLBACK_BLOCKED: user edits exist; decide to discard them first';
  end if;
end
$$;

drop function public.app_call_edit(uuid, jsonb);
drop table public.app_call_edit_history;
drop table public.app_call_edits;

delete from supabase_migrations.schema_migrations
  where version = '20261026120000' and name = 'call_user_edit';
commit;
