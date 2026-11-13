begin;
-- 20261113230000_arsenal_outside_features의 짝 되돌리기. arsenal·outside 허용 행·검사 원래 모양(키 일곱)·이번 기록 1행만 되돌린다. 다른 허용 행은 그대로.
-- 되돌리기 전에 메뉴 화면 PR(④)이 운영에 있으면 명진 메뉴에서도 아스날·News가 빠진다 — 그 화면 PR을 먼저 되돌리고 이 SQL을 실행한다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261113230000' and name = 'arsenal_outside_features') <> 1 then
    raise exception 'ARSENAL_OUTSIDE_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from public.app_operator_features where feature in ('arsenal', 'outside');
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap'));

delete from supabase_migrations.schema_migrations
  where version = '20261113230000' and name = 'arsenal_outside_features';
commit;
