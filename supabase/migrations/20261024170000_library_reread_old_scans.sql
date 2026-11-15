begin;
-- LIB-옛자료다시읽기 (명진 결정 2026-10-24 11:12): #1101(LIB-스캔글자읽기, Edge run #54·#55 배포 완료 2026-10-24 01:35Z)로
-- 자료실 글자 읽기(_shared/document-text.ts)가 스캔 PDF(한국어 OCR)와 사진(JPEG·PNG)을 읽게 됐다. 그 전에 올려 '글자 없음'으로
-- 끝난 사진·PDF를 밤 글자 채우기(drive-summary ?action=text_backfill, LIB-글자채우기야간 #1028)가 다시 고르게 상태 칸만 되돌린다.
-- 대상(모두 만족하는 행만):
--   - 업무공간 kptu-work(밤 채우기와 같은 업무공간), Drive 파일 있음(file_id)
--   - 파일 형식: 확장자 jpg·jpeg·png·pdf, 또는 확장자가 없고 형식이 image/jpeg·image/png·application/pdf
--     (_shared/document-text.ts textKindOf와 같은 판단: 확장자를 먼저 보고, 없을 때만 형식을 본다)
--   - 글자 없음(extracted_text가 비었거나 공백뿐), 상태 error
--   - 이유가 '지원 안 함·글자 없음' 류: unsupported·empty(document-text.ts), 옛 회의자료·참고자료 경로의
--     '현재 AI 본문 읽기를 지원하지 않는 파일 형식입니다.'·'추출된 본문이 비어 있습니다.'
--     (too_large·read_failed·gave_up·no_file은 새 읽기로도 결과가 같거나 원인이 달라 넣지 않는다)
--   - 새 읽기 배포 전에 읽은 것(extracted_at이 비었거나 2026-10-24 01:36Z 전). 배포 뒤 새 방식으로 이미 실패한 자료는 다시 고르지 않는다.
-- 바꾸는 칸: extraction_status 하나만 error → null(밤 채우기·자료실 화면 채우기가 고르는 "아직 안 읽음").
--   extracted_text·extraction_error·extracted_at·updated_at·원본 파일·다른 칸은 그대로. 남겨 둔 이유 값이 "이번에 되돌린 행" 표시가 되어
--   rollback이 백업 표 없이 같은 행만 error로 되돌린다(status null + 위 이유는 다른 어떤 경로도 만들지 않는 조합).
-- 권한·정책·RLS·스키마·함수·트리거 변경 없음. 대상 0행이면 아무 자료도 바뀌지 않고 기록 1행만 남는다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- 짝: docs/20261024170000_library_reread_old_scans.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_documents in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024170000')
     or to_regclass('public.app_documents') is null
     or (select count(*) from public.app_workspaces where slug = 'kptu-work') <> 1
     or (select count(*) from pg_attribute where attrelid = 'public.app_documents'::regclass and not attisdropped
         and ((attname in ('file_id', 'file_name', 'mime_type', 'extracted_text', 'extraction_status', 'extraction_error') and atttypid = 'text'::regtype)
           or (attname = 'extracted_at' and atttypid = 'timestamptz'::regtype))) <> 7
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relrowsecurity) then
    raise exception 'LIBRARY_REREAD_OLD_SCANS_PREREQUISITE_CHANGED; stop';
  end if;
  -- 이미 되돌린 표시 행(status null + 대상 이유)이 있으면 같은 표시를 두 번 쓰지 않도록 멈춘다.
  if exists (select 1 from public.app_documents d
      where d.extraction_status is null
        and d.extraction_error in ('unsupported', 'empty', '현재 AI 본문 읽기를 지원하지 않는 파일 형식입니다.', '추출된 본문이 비어 있습니다.')) then
    raise exception 'LIBRARY_REREAD_OLD_SCANS_PREREQUISITE_CHANGED; marker rows exist';
  end if;
end
$$;

update public.app_documents d
  set extraction_status = null
  where d.workspace_id in (select w.id from public.app_workspaces w where w.slug = 'kptu-work')
    and d.file_id is not null
    and d.extraction_status = 'error'
    and (d.extracted_text is null or btrim(d.extracted_text) = '')
    and d.extraction_error in ('unsupported', 'empty', '현재 AI 본문 읽기를 지원하지 않는 파일 형식입니다.', '추출된 본문이 비어 있습니다.')
    and (d.extracted_at is null or d.extracted_at < '2026-10-24 01:36:00+00'::timestamptz)
    and (lower(d.file_name) ~ '\.(jpe?g|png|pdf)$'
      or (coalesce(lower(d.file_name), '') !~ '\.[a-z0-9]{1,8}$'
        and lower(d.mime_type) in ('image/jpeg', 'image/png', 'application/pdf')));

-- 사후 확인: 대상 조건의 error 행이 남지 않았다. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from public.app_documents d
      where d.workspace_id in (select w.id from public.app_workspaces w where w.slug = 'kptu-work')
        and d.file_id is not null
        and d.extraction_status = 'error'
        and (d.extracted_text is null or btrim(d.extracted_text) = '')
        and d.extraction_error in ('unsupported', 'empty', '현재 AI 본문 읽기를 지원하지 않는 파일 형식입니다.', '추출된 본문이 비어 있습니다.')
        and (d.extracted_at is null or d.extracted_at < '2026-10-24 01:36:00+00'::timestamptz)
        and (lower(d.file_name) ~ '\.(jpe?g|png|pdf)$'
          or (coalesce(lower(d.file_name), '') !~ '\.[a-z0-9]{1,8}$'
            and lower(d.mime_type) in ('image/jpeg', 'image/png', 'application/pdf')))) then
    raise exception 'LIBRARY_REREAD_OLD_SCANS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024170000', 'library_reread_old_scans', array['LIB-옛자료다시읽기: app_documents.extraction_status error -> null only for kptu-work jpg/jpeg/png/pdf rows with empty text, reason unsupported/empty, read before 2026-10-24 01:36Z; no schema/grant/policy/function/trigger change']);
commit;
