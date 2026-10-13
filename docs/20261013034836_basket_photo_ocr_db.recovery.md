# 📱 폰 가능 — 사진글자 DB 준비·사용 후 복구

이 PR은 DB 파일·검사 준비다. 운영 DB·trigger·함수 default ACL·실제 Google OCR은 미확인이다. 사진 읽기 화면·Edge 코드·Drive 사본은 켜지지 않는다. 새 원문 version은 기존 app_notes.updated_at이다.

무엇이 바뀌나: 기존 사진 첨부에 인식 글과 처리·정리 상태를 보관할 준비를 한다.
잘못되면: 첨부 저장·상태 갱신이 거절될 수 있다. 인식 글이 달라지면 이전 AI 검토를 다시 확인해야 한다.
되돌리는 법: 사용 전에는 정확한 새 함수·제약만 되돌린다. 사용 후에는 글·정리 기록을 보존하고 화면을 끈 뒤 forward fix한다.

## 계약

첨부 base 네 필드·20개 상한·100MiB 상한·raw_text/metadata/owner RLS·기존 confirm/summary RPC는 유지한다. JPEG/PNG에만 선택적 ocr 정보를 붙인다. OCR 없는 기존 파일은 모든 기존 mime 종류를 그대로 허용한다. 보관·AI 제외 메모를 수동으로 읽어도 그 상태를 해제하지 않는다.

새 함수 정확한 서명은 `app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)`다. authenticated 사용자 JWT로 호출하며 SECURITY INVOKER, 빈 search_path, PUBLIC/anon/service_role revoke 뒤 authenticated EXECUTE만. 기존 service-role 첨부 업로드는 새 함수 대신 기존 REST 경로를 유지한다. CHECK에 custom helper를 넣지 않아 helper ACL이 업로드를 막지 않는다.

OCR 필드는 state(unread/reading/done/empty/failed), attempt_id, original_file_id, cleanup_state(none/create_pending/create_unknown/created/delete_pending/deleted/delete_failed), 선택적 text/temp_document_id/error_code/cleanup_error_code다. original_file_id는 첨부의 원본 ID와 일치하고 임시 문서 ID는 원본 ID와 다르다. 알려진 임시 ID는 같은 attempt에서 바꾸거나 지울 수 없다. deleted로 정리가 확인된 뒤 명시적으로 새 시도를 시작하면 이전의 해결된 시도 기록을 새 attempt로 바꿀 수 있다.

text는 16,384 Unicode 문자 및 65,536 UTF8byte 이하다. 초과는 거절하며 자르지 않는다. AI가 읽는 글의 투영은 `COALESCE(ocr.text,'')`이고 처리 상태에 독립적이다. 재인식 reading/failed에서도 이전 확정 글을 유지한다. 그 투영이 실제 바뀔 때만 DB timestamp를 최소1microsecond 이상 진행한다. 상태·오류·정리만 바뀌면 timestamp를 보존한다. 클라이언트는 timestamp 문자열을 그대로 왕복하고 JS Date로 microsecond를 버리지 않는다.

원문 timestamp와 정확한 첨부 JSON 전체를 CAS로 확인하므로 같은 version의 정리 상태·attempt 경쟁도 덮어쓰지 않는다. 원격 생성 POST 전에 reading/create_pending과 attempt를 영구 기록한다. 생성/삭제 불명 또는 미정리 상태에서 새 UUID로 자동 재생성하지 않는다. direct authenticated 소유자 DML/RPC가 원격 Google 검증을 증명하는 것은 아니다. 원본 GET·변환·ID 확인·정리 검증과 불명 결과 재확인은 후속 Edge가 담당한다.

원문이 변하면 이전 결과 저장은 NOTE_CHANGED다. 후속 Edge는 최신 원문·동일 attachment/attempt를 다시 읽어 알려진 임시 문서의 정리 정보만 현재 version CAS로 보존할 수 있다. 인식 글의 저장은 최신 version에 맞춘 별도 확인으로 처리한다. 메모/첨부가 아예 삭제되면 그 행에 외부 정리 정보를 저장할 수 없다는 제한을 숨기지 않는다.

## 운영 전 자료·중단 조건

1. main 병합 뒤 실제 파일 `supabase/migrations/20261013034836_basket_photo_ocr_db.sql`과 version/name을 고정한다. AI는 DB apply/운영 workflow/환경 승인을 실행하지 않는다.
2. 전체 schema 조회 전에 별도 [version-check SELECT](20261013034836_basket_photo_ocr_db.version-check.sql)를 먼저 확인한다. `server_version_num >= 160000`인 PostgreSQL 16 이상이 membership catalog의 `inherit_option`/`set_option` 문법에 필요하다. 결과가 없거나 불명, 16 미만이면 snapshot/precheck/apply/rollback을 진행하지 않는다. 실제 격리 검증은 PostgreSQL 17.6이며 16 전체 호환성을 검증했다는 뜻은 아니다. 현재 운영 버전은 미확인이다. migration/rollback SQL도 새로운 catalog 열을 쓰기 전에 독립 version guard로 거절한다.
3. 사용자 SQL Editor의 SELECT 전용 [snapshot](20261013034836_basket_photo_ocr_db.snapshot.sql)·[precheck](20261013034836_basket_photo_ocr_db.precheck.sql) 결과를 CC가 대조한다. 원문/OCR 글은 출력하지 않는 집계와 schema 정의만 공유한다.
4. 모든 사전 예/아니오 항목이 예, OCR count0, 실제 원문 version finite, UTF8, public 스키마의 attachments CHECK 동명 제약이 정확히 하나이고 그 제약이 app_notes의 검증된 정확한 옛 CHECK, 새로운 동명 함수0, owner RLS 유지가 필요하다. noninternal notes trigger가 하나라도 있으면 호환 검증 전 중단한다. 특히 무조건 updated_at을 바꾸는 trigger는 상태-only version 보존을 깨뜨린다. 기존 trigger를 자동 제거하지 않는다.
5. main의 #518 service_role 명시 REVOKE 지원을 반영했다. 현재 생성 역할의 global/public 함수 default ACL은 확인된 anon·authenticated·service_role의 EXECUTE를 지원하고, RPC를 만든 뒤 PUBLIC/anon/service_role를 명시 회수한다. 알 수 없는 role, EXECUTE grant option, 예상 밖 실제 RPC ACL이면 transaction을 거절한다. [2026-09-27 운영 읽기 전용 기록](security/sec1-auth-handoff-snapshot.md)의 hosted3role 설정을 지원하지만 현재 운영 값은 SELECT로 다시 대조한다. authenticated 실행권한을 상속하거나 SET할 수 있는 알 수 없는 member도 중단한다. 기존 생성 역할과 NOINHERIT authenticator gateway의 의도된 인증 경로는 유지한다. 기존 role membership/default ACL을 고치거나 기존 서비스 업로드 권한을 회수하지 않는다.
6. 승인형 DB workflow는 main에서 dry-run→결과/원상태 대조→apply 순서다. [dry-run.postcheck](20261013034836_basket_photo_ocr_db.dry-run.postcheck.sql)는 원래 CHECK·새 함수 부재를 확인한다. workflow의 집계/structural 성공은 운영 전체 schema·자료 동일성 증명이 아니다. 저장한 snapshot의 행 hash·ACL·정책·기존 confirm/summary·trigger를 따로 대조한다.
7. apply 뒤 [postcheck](20261013034836_basket_photo_ocr_db.postcheck.sql)와 원본 snapshot을 대조한다. postcheck는 정확한 새 function source/ACL·새 CHECK와 기존 RPC 존재를 검사한다. 수동 snapshot 대조가 끝나기 전 준비 적용을 완료라고 하지 않는다. 실제 backup은 `ops_backup.20261013034836_app_notes_<실제 run_id>`이며 아직 존재를 확인하지 않았다.
8. 다음 단계는 서버·사본·기본 비활성 화면 준비→실제 DB/Edge 적용→원본 보존·실제 인식·임시 Google 문서 삭제 확인→별도 활성화 PR이다. drive-summary의 직전 운영 되돌리기 source는 현재 v7 `39f1dfec9cd978f9ea5e7c94bca120fb16a0a84e`이며 과거 v6를 사용하지 않는다.

## 사용 전 되돌리기

사용 전이란 ocr key가 어떤 첨부에도 없는 상태다. reading/unread/empty 정보만 있어도 사용한 것으로 본다. [rollback](20261013034836_basket_photo_ocr_db.rollback.sql)은 table lock 아래 하나라도 ocr key가 있으면 `OCR_DATA_PRESERVATION_REQUIRED`로 거절한다. notes table lock과 migration-history lock 아래 public 스키마에 동명 CHECK가 정확히 하나이고 app_notes에 결속된 현재 OCR CHECK의 정확한 canonical 정의·검증 상태, RPC 본문/서명/반환/설정/소유자/실행권한, 정확한 version/name/statements가 이 준비 migration과 같은지 먼저 확인한다. 다르면 `PHOTO_OCR_ROLLBACK_CHANGED`로 거절하며 후속 변경을 제거하지 않는다. 일치할 때만 정확한 새 함수 서명을 DROP하고 옛 attachments CHECK를 복원한다. 데이터 수정·CASCADE·기존 confirm/summary 제거는 없다. version/name 기록만 지운다.

## 사용 후 복구

사용 후에는 rollback 버튼/옛 네 필드 CHECK 복원/OCR key 삭제를 하지 않는다.

- 화면 활성화가 있었다면 새 실행을 비활성화하는 작은 PR을 먼저 마련한다. 이번 DB 준비 PR에는 활성화 화면이 없다.
- [recovery SELECT](20261013034836_basket_photo_ocr_db.recovery.sql)로 생성불명·정리대기·known temp·인식 글 집계를 확인한다. 원본 Google 파일을 삭제·이동·복제하지 않는다.
- [private preserve SELECT](20261013034836_basket_photo_ocr_db.preserve.sql)의 결과는 사용자 관리 비공개 파일로 저장한다. attachments에는 인식 글·원본·attempt·임시 ID·정리 상태가 포함된다. PR/Actions 로그/공개 문서/채팅에 결과를 붙이지 않는다. 이 SELECT는 복구를 위한 보존 자료이며 덮어쓰기 replay SQL이 아니다.
- 새 원문·첨부 변화와 알려진 temp ID를 유지하며 문제별 forward fix PR을 만든다. 임시 문서 생성 결과 불명은 자동 재생성하지 않는다. known ID만 서버에서 확인하고 삭제 결과 불명은 서버 조회로 대조한다. 실패 상태만 고쳐 글이나 원본을 잃는 처리를 하지 않는다.
- 정상화 후 동일한 인식 글·cleanup 상태·외부 결과를 확인한 뒤 별도 활성화 여부를 판단한다. exact-once 생성 또는 모든 직접 writer의 원격 검증 보장을 주장하지 않는다.
