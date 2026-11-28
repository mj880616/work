begin;
-- 20261128130000_brief_plus_feature의 짝 되돌리기. brief_plus 허용 행·검사 원래 모양(mcp_write 판 키 열)·이번 기록 1행만 되돌린다. 다른 허용 행은 그대로.
-- 되돌리면 브리핑은 모든 작업공간에서 지금 방식(기본 모델·자료 순서 요약)으로 만든다. 이미 만든 브리핑(새 칸 포함)은 지우지 않는다(화면은 칸이 있으면 그대로 보인다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261128130000' and name = 'brief_plus_feature') <> 1 then
    raise exception 'BRIEF_PLUS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from public.app_operator_features where feature = 'brief_plus';
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog', 'photo_content', 'mcp_write'));

delete from supabase_migrations.schema_migrations
  where version = '20261128130000' and name = 'brief_plus_feature';
commit;
