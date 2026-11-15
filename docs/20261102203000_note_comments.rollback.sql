begin;
-- 20261102203000_note_comments의 짝 되돌리기. 새 표 1개(색인·정책 포함)와 이번 기록 1행만 지운다. 적어 둔 댓글도 함께 사라진다.
-- 노트(app_notes)는 건드리지 않는다(해시태그는 노트 본문 글자라 그대로 남는다).
-- 지우기 전에 화면을 이 표를 쓰지 않는 이전 판으로 되돌린다(새 화면은 표가 없으면 댓글 칸만 '준비 중'으로 보이고 노트는 그대로 보인다).
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261102203000' and name = 'note_comments') <> 1 then
    raise exception 'NOTE_COMMENTS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_note_comments;

delete from supabase_migrations.schema_migrations
  where version = '20261102203000' and name = 'note_comments';
commit;
