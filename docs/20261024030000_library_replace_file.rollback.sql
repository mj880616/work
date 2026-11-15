begin;
-- 20261024030000_library_replace_file의 짝 되돌리기. 모양 검사와 두 칸, 이번 기록 1행만 지운다.
-- 옛 파일 기록(previous_files)이 하나라도 있거나 AI 다시 분류 표시(reclassify_needed)가 켜진 자료가 있으면 멈춘다.
-- 칸을 지우면 "이전 파일 ▾"의 위치 정보가 사라지므로 값을 지워서 통과시키지 않는다(Drive 파일 자체는 남아 있다).
-- 그런 경우 먼저 화면·Edge를 되돌리고 옛 파일 목록을 캡처해 보관한 뒤 복구 계획을 따로 세운다.
-- 기존 표·정책·권한·다른 칸에는 손대지 않는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_documents in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024030000' and name = 'library_replace_file') <> 1 then
    raise exception 'LIBRARY_REPLACE_FILE_ROLLBACK_BLOCKED: migration record differs';
  end if;
  if exists (select 1 from public.app_documents where previous_files <> '[]'::jsonb or reclassify_needed) then
    raise exception 'LIBRARY_REPLACE_FILE_ROLLBACK_BLOCKED: replaced files exist; preserve and plan recovery';
  end if;
end
$$;

alter table public.app_documents
  drop constraint app_documents_previous_files_check,
  drop column previous_files,
  drop column reclassify_needed;

delete from supabase_migrations.schema_migrations
  where version = '20261024030000' and name = 'library_replace_file';
commit;
