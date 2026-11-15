begin;
-- 20261108020000_outside_post_body_ko의 짝 되돌리기. 검사·body_ko 칸을 지우고 기록 1행을 지운다.
-- SQL Editor 경로 전용(이 migration은 확장 규칙이라 workflow rollback 모드 밖). 사회운동 소식 [번역] 저장본만 사라진다.
-- 먼저 이 칸을 쓰는 outside-feed(translate)·화면을 되돌리거나, 되돌린 뒤 사회운동 영어 소식 [번역]이 '번역하지 못함'만 내는 것을 알고 진행한다.
-- 번역해 둔 글이 있으면 그 번역이 버려진다. 멈추지 않는다(원문은 그대로이고 [번역]을 다시 누르면 다시 만든다). 개수는 먼저 볼 수 있다.
--   select count(*) from public.app_outside_posts where body_ko is not null;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261108020000' and name = 'outside_post_body_ko') <> 1 then
    raise exception 'OUTSIDE_POST_BODY_KO_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

alter table public.app_outside_posts drop constraint app_outside_posts_body_ko_check;
alter table public.app_outside_posts drop column body_ko;

delete from supabase_migrations.schema_migrations
  where version = '20261108020000' and name = 'outside_post_body_ko';
commit;
