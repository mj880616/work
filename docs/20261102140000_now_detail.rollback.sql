begin;
-- 20261102140000_now_detail의 짝 되돌리기. 새 표 넷·함수 하나·이번 기록 1행만 되돌린다.
-- 지워지는 것: 만들어 둔 글 상세(요약·주요 문장·연관·시사점)·사회운동 글 별표·보관·관심 없음·환류 기록·관심 주제.
-- 사회운동 글(app_outside_posts)·뉴스 기사(app_news_items)·노트(app_notes)는 건드리지 않는다. 글 메모 노트는 [노트]에 그대로 남는다.
-- 먼저 화면이 상세·표시·관심 표를 부르지 않게 되돌리고, Edge 상세 만들기를 이전 소스로 되돌린 뒤 실행한다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다). 기존 표·함수는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261102140000' and name = 'now_detail') <> 1 then
    raise exception 'NOW_DETAIL_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_now_details;
drop table public.app_outside_marks;
drop table public.app_now_signals;
drop table public.app_now_interests;
drop function private.app_now_item_scope_guard();

delete from supabase_migrations.schema_migrations
  where version = '20261102140000' and name = 'now_detail';
commit;
