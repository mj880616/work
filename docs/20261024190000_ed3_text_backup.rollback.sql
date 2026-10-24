begin;
-- 20261024190000_ed3_text_backup의 짝 되돌리기. 새 백업 표 1개(정책 포함)와 이번 기록 1행만 지운다. 원래 노트·기록 표는 건드리지 않는다.
-- 세 표 어디에든 새 형식(doc)으로 저장된 행이 하나라도 있으면 멈춘다: 마크다운 노트를 바꾼 뒤에는 원래 글자가 이 표에만 있으므로 지우지 않는다.
-- 그 경우에는 먼저 행 단위 되돌리기(설계 4.1-4: doc=null, raw_text=백업 raw_text)를 끝내고 다시 계획한다.
-- SQL Editor(폰 경로 C) 전용이다(승인형 DB workflow는 표 삭제를 막는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_ed3_text_backups in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024190000' and name = 'ed3_text_backup') <> 1 then
    raise exception 'ED3_TEXT_BACKUP_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_notes where doc is not null)
     or exists (select 1 from public.app_suborganization_updates where doc is not null)
     or exists (select 1 from public.app_project_progress_updates where doc is not null) then
    raise exception 'ED3_TEXT_BACKUP_ROLLBACK_BLOCKED: formatted rows exist; restore them from the backup first';
  end if;
end
$$;

drop table public.app_ed3_text_backups;

delete from supabase_migrations.schema_migrations
  where version = '20261024190000' and name = 'ed3_text_backup';
commit;
