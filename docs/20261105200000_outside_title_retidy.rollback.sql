begin;
-- 20261105200000_outside_title_retidy의 짝 되돌리기. SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow의 rollback 모드는 자료 UPDATE·표 삭제를 막는다).
-- 1) 비공개 표 app_outside_title_fixes에 남긴 옛 제목으로 되돌린다(지금 제목이 이번에 바꾼 새 제목인 글만).
-- 2) 그 표와 이번 기록 1행을 지운다. 다른 칸·표·권한·정책·함수는 건드리지 않는다.
-- 적용 뒤 제목이 또 바뀐 글(수집기가 다시 맞춤)이 있거나 글이 지워졌으면 멈춘다(그 글의 옛 제목이 이 표에만 있으므로 표를 지우지 않는다). 그때는 명진이 볼지 정한 뒤 다시 계획한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_outside_posts in share row exclusive mode;
lock table public.app_outside_title_fixes in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261105200000' and name = 'outside_title_retidy') <> 1 then
    raise exception 'OUTSIDE_TITLE_RETIDY_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_outside_title_fixes f left join public.app_outside_posts p on p.id = f.post_id
             where p.id is null or p.title <> f.new_title) then
    raise exception 'OUTSIDE_TITLE_RETIDY_ROLLBACK_BLOCKED: some posts changed after the retidy';
  end if;
end
$$;

update public.app_outside_posts p
  set title = f.old_title
  from public.app_outside_title_fixes f
  where f.post_id = p.id
    and p.title = f.new_title;

drop table public.app_outside_title_fixes;

delete from supabase_migrations.schema_migrations
  where version = '20261105200000' and name = 'outside_title_retidy';
commit;
