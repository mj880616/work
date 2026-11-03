begin;
-- 20261103100000_dev_inbox_feature의 짝 되돌리기. dev_inbox 허용 행·검사 원래 모양(키 넷)·이번 기록 1행만 되돌린다. 다른 허용 행은 그대로.
-- 되돌리면 Edge document-actions dev-inbox는 운영자 기능 없음(403)으로 거절하고 화면은 '만들기로 보냄'만 남긴다(요청함에 이미 더한 덩어리는 그대로).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261103100000' and name = 'dev_inbox_feature') <> 1 then
    raise exception 'DEV_INBOX_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from public.app_operator_features where feature = 'dev_inbox';
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files'));

delete from supabase_migrations.schema_migrations
  where version = '20261103100000' and name = 'dev_inbox_feature';
commit;
