begin;
-- 20261024170000_library_reread_old_scans의 짝 되돌리기. SQL Editor(폰 경로 C) 전용:
--   승인형 workflow rollback 모드는 자료 UPDATE를 허용하지 않는다(docs/ops-db-workflow.md "rollback 짝 파일의 허용 범위").
-- 되돌리는 행: migration이 남긴 표시(상태 비어 있음 + 남겨 둔 이유 unsupported·empty·옛 경로 문구)이면서 migration과 같은 대상 조건인 행만
--   상태를 다시 error로. 그 사이 밤 채우기·자료실 화면이 이미 다시 읽은 행(ready 또는 새 error)은 표시가 사라져 건드리지 않는다
--   (새로 읽은 글자를 지우지 않는다). 지금 읽는 중인 행(pending·nightly_try)도 건드리지 않는다. 글자·이유·시각·다른 칸은 그대로.
-- 순서: 화면·Edge 변경 없음(이 migration은 자료 상태만 바꿈). 필요하면 밤 예약 실행(library-text-nightly)을 먼저 끄고 이 파일을 실행한다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_documents in access exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261024170000' and name = 'library_reread_old_scans') <> 1 then
    raise exception 'LIBRARY_REREAD_OLD_SCANS_ROLLBACK_BLOCKED: migration record differs';
  end if;
end
$$;

update public.app_documents d
  set extraction_status = 'error'
  where d.extraction_status is null
    and d.workspace_id in (select w.id from public.app_workspaces w where w.slug = 'kptu-work')
    and d.file_id is not null
    and (d.extracted_text is null or btrim(d.extracted_text) = '')
    and d.extraction_error in ('unsupported', 'empty', '현재 AI 본문 읽기를 지원하지 않는 파일 형식입니다.', '추출된 본문이 비어 있습니다.')
    and (d.extracted_at is null or d.extracted_at < '2026-10-24 01:36:00+00'::timestamptz)
    and (lower(d.file_name) ~ '\.(jpe?g|png|pdf)$'
      or (coalesce(lower(d.file_name), '') !~ '\.[a-z0-9]{1,8}$'
        and lower(d.mime_type) in ('image/jpeg', 'image/png', 'application/pdf')));

delete from supabase_migrations.schema_migrations
  where version = '20261024170000' and name = 'library_reread_old_scans';
commit;
