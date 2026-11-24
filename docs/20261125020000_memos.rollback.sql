begin;
-- 20261125020000_memos의 짝 되돌리기. 새 표(app_memos)를 지우고 이번 기록 1행만 지운다.
-- 옛 노트 댓글 표(app_note_comments)는 적용 때 한 줄도 바꾸지 않았으므로 그대로 남아 있고, 화면은 새 표가 없으면 옛 표를 읽는다(노트 메모만, 고치기 없음).
-- 적용 뒤 새로 남긴 메모(옛 댓글에서 옮긴 것이 아닌 줄)가 하나라도 있으면 멈춘다 — 지우면 그 메모가 사라지므로, 먼저 그 메모를 어떻게 할지 명진이 정한 뒤 다시 계획한다.
-- 노트·노트 댓글 표의 칸·권한·정책·자료에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125020000' and name = 'memos') <> 1 then
    raise exception 'MEMOS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_memos m
      where not exists (select 1 from public.app_note_comments c where c.id = m.id and m.target_type = 'note' and m.target_id = c.note_id and m.body = c.body)) then
    raise exception 'MEMOS_ROLLBACK_BLOCKED: memos written after apply exist; decide them first';
  end if;
end
$$;

drop table public.app_memos;

delete from supabase_migrations.schema_migrations
  where version = '20261125020000' and name = 'memos';
commit;
