begin;
-- 20261113160000_ai_user_cap의 짝 되돌리기. 함수 셋·한도 표·ai_no_cap 허용 행·검사 원래 모양(키 여섯)·이번 기록 1행만 되돌린다. 다른 허용 행은 그대로.
-- 되돌리기 전에 Edge(ai-assist 등)를 이 기능 이전 커밋으로 먼저 되돌린다(새 Edge는 함수가 없으면 AI 사용 기록을 확인하지 못했다고 멈춘다).
-- 한도 표에 SQL로 넣은 줄이 있으면 표와 함께 사라진다(되돌린 뒤 다시 적용하면 기본 3,000원).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261113160000' and name = 'ai_user_cap') <> 1 then
    raise exception 'AI_USER_CAP_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop function public.app_workspace_ai_month(uuid);
drop function public.app_my_ai_month(uuid);
drop function private.app_ai_month_usage(uuid);
drop table public.app_workspace_ai_caps;
delete from public.app_operator_features where feature = 'ai_no_cap';
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family'));

delete from supabase_migrations.schema_migrations
  where version = '20261113160000' and name = 'ai_user_cap';
commit;
