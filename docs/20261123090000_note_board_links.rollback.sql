begin;
-- 20261123090000_note_board_links의 짝 되돌리기. 새 표 1개(색인·정책 포함)와 이번 기록 1행만 지운다. 그어 둔 연결선도 함께 사라진다.
-- 노트(app_notes)와 카드 자리(노트 metadata)·보드 목록(화면 기억)은 건드리지 않는다.
-- 지우기 전에 화면을 이 표를 쓰지 않는 이전 판으로 되돌린다(새 화면은 표가 없으면 선만 그리지 않고 '선은 준비 중'으로 알리며, 카드는 그대로 보인다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261123090000' and name = 'note_board_links') <> 1 then
    raise exception 'NOTE_BOARD_LINKS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_note_board_links;

delete from supabase_migrations.schema_migrations
  where version = '20261123090000' and name = 'note_board_links';
commit;
