begin;
-- 20261126190000_photo_content_feature의 짝 되돌리기. photo_content 허용 행·검사 원래 모양(키 열)·이번 기록 1행만 되돌린다. 다른 허용 행은 그대로.
-- 되돌리면 사진 찾기는 다시 파일 이름만 본다(Edge content-find가 403, 화면은 키가 없으면 부르지 않음). 운영자 드라이브의 '사진 색인' 시트는 그대로 남는다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261126190000' and name = 'photo_content_feature') <> 1 then
    raise exception 'PHOTO_CONTENT_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

delete from public.app_operator_features where feature = 'photo_content';
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog'));

delete from supabase_migrations.schema_migrations
  where version = '20261126190000' and name = 'photo_content_feature';
commit;
