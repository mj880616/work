begin;
-- 20261023233000_ed_format_columns의 짝 되돌리기. 세 표의 모양 검사와 doc 칸, 이번 기록 1행만 지운다.
-- 세 표 중 어느 한 곳이라도 doc이 있는 행이 하나라도 있으면(새 편집기로 서식을 저장한 뒤) 멈춘다. 서식이 사라지므로 값을 지워서 통과시키지 않는다.
-- 그런 경우 먼저 doc을 캡처해 보관하고 복구 계획을 따로 세운다(글자 칸 raw_text·summary에는 글자가 남아 있어 내용 자체는 유지된다).
-- 기존 표·정책·권한·글자 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_notes in access exclusive mode;
lock table public.app_project_progress_updates in access exclusive mode;
lock table public.app_suborganization_updates in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261023233000' and name = 'ed_format_columns') <> 1 then
    raise exception 'ED_FORMAT_COLUMNS_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_notes where doc is not null)
     or exists (select 1 from public.app_suborganization_updates where doc is not null)
     or exists (select 1 from public.app_project_progress_updates where doc is not null) then
    raise exception 'ED_FORMAT_COLUMNS_ROLLBACK_BLOCKED: formatted rows exist; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_notes
  drop constraint app_notes_doc_check,
  drop column doc;
alter table public.app_suborganization_updates
  drop constraint app_suborganization_updates_doc_check,
  drop column doc;
alter table public.app_project_progress_updates
  drop constraint app_project_progress_updates_doc_check,
  drop column doc;

delete from supabase_migrations.schema_migrations
  where version = '20261023233000' and name = 'ed_format_columns';
commit;
