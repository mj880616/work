-- 초안(DRAFT) — 적용·실행 금지. 20261020090100_press_posts.sql의 짝 되돌리기.
-- 직접 입력·AI 올리기 글이 있으면 멈춘다(옛 Web1에서 가져온 글은 Web1 원본·git 이력이 남아 있어 다시 가져올 수 있다).
-- Web1 press/를 지운 뒤(PRESS-Web1삭제)에는 이 되돌리기를 쓰지 않는다. 그때 원본은 이 표뿐이다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_press_posts in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261020090100' and name = 'press_posts') <> 1 then
    raise exception 'PRESS_POSTS rollback blocked: migration record differs';
  end if;
  if exists (select 1 from public.app_press_posts where origin <> 'legacy_web1') then
    raise exception 'PRESS_POSTS rollback blocked: manual/ai rows exist; preserve and plan recovery';
  end if;
end
$$;

drop table public.app_press_posts;

delete from supabase_migrations.schema_migrations
  where version = '20261020090100' and name = 'press_posts';
commit;
