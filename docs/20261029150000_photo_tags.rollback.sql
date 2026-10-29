begin;
-- 20261029150000_photo_tags의 짝 되돌리기. 새 표 2개(색인·정책 포함)와 이번 기록 1행만 지운다.
-- 지우면 앨범 이름과 앨범에 넣은 기록이 사라진다. 사진 파일은 원드라이브에 그대로 남는다(지우지 않음). 별표(app_diary_stars)는 그대로다.
-- 지우기 전에 화면(사진 메뉴 앨범)을 이전 판으로 되돌린다(화면은 표가 없으면 앨범 칩에 '읽지 못했어요'만 보인다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261029150000' and name = 'photo_tags') <> 1 then
    raise exception 'PHOTO_TAGS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_photo_tag_items;
drop table public.app_photo_tags;

delete from supabase_migrations.schema_migrations
  where version = '20261029150000' and name = 'photo_tags';
commit;
