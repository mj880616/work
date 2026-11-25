begin;
-- 20261125113100_blog_tables의 짝 되돌리기. 새 표 3개·blog 허용 행·검사 원래 모양(키 열하나)·이번 기록 1행만 되돌린다. 다른 허용 행은 그대로.
-- 블로그·게시판·글이 하나라도 있으면 멈춘다(밖 주소에 쌓인 글이 몰래 사라지지 않게). 그런 경우 먼저 화면(BLOG ③)을 되돌리고,
-- 그 글을 어떻게 할지 명진이 정한 뒤 다시 계획한다. 공유 페이지·노트 표의 칸·권한·정책·자료에는 손대지 않는다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow rollback 모드는 표 지우기·자료 행 delete를 받지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125113100' and name = 'blog_tables') <> 1 then
    raise exception 'BLOG_TABLES_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_blogs) or exists (select 1 from public.app_blog_boards) or exists (select 1 from public.app_blog_posts) then
    raise exception 'BLOG_TABLES_ROLLBACK_BLOCKED: blog rows exist; decide them first';
  end if;
end
$$;

drop table public.app_blog_posts;
drop table public.app_blog_boards;
drop table public.app_blogs;
delete from public.app_operator_features where feature = 'blog';
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words'));

delete from supabase_migrations.schema_migrations
  where version = '20261125113100' and name = 'blog_tables';
commit;
