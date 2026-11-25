begin;
-- 20261125131000_note_templates의 짝 되돌리기. 새 표 1개(검사·정책 포함)와 이번 기록 1행만 지운다.
-- 주의: 저장해 둔 노트 서식도 함께 사라진다(되살릴 수 없음). 서식으로 이미 만든 노트(app_notes)는 그대로 남는다.
-- 지우기 전에 화면을 이 표를 쓰지 않는 이전 판으로 되돌린다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261125131000' and name = 'note_templates') <> 1 then
    raise exception 'NOTE_TEMPLATES_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

drop table public.app_note_templates;

delete from supabase_migrations.schema_migrations
  where version = '20261125131000' and name = 'note_templates';
commit;
