# basket-files — 바구니 첨부 서버

배포 대기. `verify_jwt=false`이며 Supabase Auth `getUser(JWT)`로 로그인 검증 후
서버에서 조회한 `app_workspace_members.role=owner`의 workspace만 사용한다.
운영 DB/Edge 적용 전에는 화면에서 호출하지 않는다.

`POST multipart/form-data`:

| 필드 | 규칙 |
| --- | --- |
| `file` | 같은 키로 1~20개 파일. 빈 파일 거절, 파일당 104857600 bytes까지. |
| `raw_text` | 새 메모에만 선택 입력, 20,000자까지, 수신된 공백·개행 보존. 파일만 저장 가능. |
| `note_id` | 기존 메모에 추가할 때 UUID. 서버 owner workspace에 속한 메모만 조회·갱신. 기존 글·AI 설정은 보존. |

클라이언트의 workspace·폴더 ID·Drive 파일 ID·AI 설정은 저장에 사용하지 않는다.
메모당 합계 20개, 같은 Drive ID 중복 거절. 서버가 원래 파일명·MIME·크기와 Drive가
반환한 ID로 `{drive_file_id,file_name,mime_type,size_bytes}`를 만든다.
`app_documents`, AI 제목 추정·분류·프로젝트 연결은 수행하지 않는다.
응답은 `{ok:true,note_id,attachments}`이며 폴더 ID·토큰은 포함하지 않는다.
새 메모의 `ai_export_allowed`는 DB 기본 `true`, 기존 메모의 값은 보존한다.

Drive 폴더는 내 Drive 최상위 이름이 정확히 **Web2 바구니**인 소유 폴더를
찾거나 생성한다. `drive.file` 범위에서 root 메타데이터 조회는 404가 될 수 있으므로
`GET /drive/v3/files/root`를 호출하지 않는다. 최상위 위치는 아래 검색으로 확인한다.

```text
name = 'Web2 바구니' and mimeType = 'application/vnd.google-apps.folder'
and 'root' in parents and 'me' in owners and trashed = false
```

저장된 `basket_folder_id`가 없으면 검색 결과의 첫 폴더를 검증해 사용한다.
결과가 없으면 `parents:['root']`로 생성하고, 생성 응답에 포함된 ID의 메타데이터를
조회해 검증한다. 검색 결과에 포함되거나 root 부모로 생성한 응답에 포함된 ID라는
근거로 최상위를 판정하며, `parents` 값을 root ID와 비교하지 않는다.
저장된 ID가 있으면 그 ID를 직접 조회해 검증하고, 위 검색 결과에 같은 ID가 있어야
한다. 검색은 `nextPageToken`을 따라 끝까지 확인하므로 뒤 페이지의 폴더도 인정한다.

이름·폴더 종류·내 소유(`ownedByMe=true`)·휴지통 아님·부모 정확히 1개·권한
정확히 1개(`type=user`, `role=owner`)를 매번 검증한다. 검색과 메타데이터 조회의
`fields`에 `permissions(type,role)`을 명시 요청하며, 실제 응답에서 빠지면 통과시키지
않는다. 공유 권한을 생성하거나 기존 공유를 해제하지 않는다. 실제 폴더 ID는 DB
설정에만 저장한다.

| 상황 | HTTP / 오류 코드 |
| --- | --- |
| 공유·이동·이름/종류/소유/휴지통/부모 수/권한 검증 실패 또는 저장 ID가 최상위 검색에 없음 | 409 `drive_folder_not_private_root` |
| 명시 요청한 권한 필드가 실제 응답에 없음 | 409 `drive_folder_permissions_unavailable` |
| 저장 ID의 메타데이터 GET이 404 | 409 `drive_folder_missing` |
| ID 형식이 잘못됨 | 409 `drive_folder_invalid` |
| 검색 실패(404 포함)·불완전 검색·그 밖의 Drive 폴더 조회/생성 장애 | 503 `drive_folder_failed` (기존 unavailable) |

실패 로그에는 해당 코드만 남기며 검증 실패 후 파일 업로드는 시작하지 않는다.
`tests/security/basket-files.test.mjs`의 `driveFile` 모드는 root GET 404, 검색·생성,
앱이 만든 파일만 GET 허용을 재현한다. 첫 JPG 업로드(163KiB) 생성·저장, 두 번째 업로드
재사용, 이동·공유·휴지통·저장 ID 404·권한 생략·검색 장애를 실제 handler로 검증한다.

설정 행 생성은 `ignoreDuplicates`, 칸 저장은 NULL 조건 갱신으로 기존 root/library
칸을 보존한다. 동시 생성 시 최종 설정의 폴더도 직접 조회와 최상위 검색으로 검증해
사용한다. Drive 폴더 생성과
DB 저장은 별개이므로 장애·동시 생성 때 빈 폴더가 남을 수 있다. 자동 폴더 삭제는 하지 않는다.

기존 메모 갱신은 workspace·ID·기존 `updated_at`·기존 JSON 첨부가 모두 같은 행만
갱신한다. 다른 요청이 먼저 바꾸면 409 `note_changed`, 이번 요청의 새 파일만 정리한다.
글 수정 경로가 `updated_at`을 갱신하는 기존 계약을 유지해야 한다.

실패는 고정 오류 코드·단계·`retryable:false`로 반환하며 로그에는 코드만 남긴다.
DB 저장 오류는 먼저 메모를 다시 읽는다. 저장 확인 시 성공 응답, 명확한 DB 거절(SQLSTATE,
4xx PGRST 오류) 또는 정상 응답의 0행 충돌이고 참조가 없으면 새 Drive 파일 DELETE.
응답 유실은 부정적인 재조회 뒤에도 늦게 commit될 수 있으므로 파일을 유지한다.
확인 실패/부분 반영/저장 결과 불명은 503 `note_save_result_unknown`과
`note_id`로 결과 불명을 알리며 파일을 유지한다. 결과 불명은 자동 재업로드하지 않는다.
Drive PUT 성공 응답 자체 유실·정리 실패·강제 종료는 파일이 남을 수 있으므로 수동 확인한다.
클라이언트는 후속 화면 PR에서 공통 `copyUploadFile`을 사용한다(#467).
`req.formData()`는 요청 전체를 메모리에 읽는다. 20개 대용량 파일을 한 요청에
담으면 Edge 메모리 한도를 넘을 수 있으며 이 PR은 큰 묶음의 운영 성공을 보장하지 않는다.
확정 설계의 순차 업로드대로 화면은 파일 하나씩 보내고, 첫 성공의 `note_id`에 이어 붙인다.
여러 작은 파일 요청은 지원하며 서버의 파일별 100MiB·메모당 20개 제약은 그대로다.

공통 모듈 `_shared/drive-upload.ts`는 library-files의 토큰·폴더 POST·resumable
업로드·orphan 정리 흐름을 추출했다. 이번 PR은 library-files 소스를 변경하지 않는다.
기존 업로드 경로 재배포를 피하기 위한 사용자 지정 예외이며 `_shared` 전환은 후속 원장 행으로 추적한다.

## 메모 삭제(note-delete) — 배포 대기

`POST ?action=note-delete`, JSON `{action:"note-delete",note_id,note_updated_at}`(정확히 이 3개 키, 4096 bytes까지).
위와 같은 JWT `getUser`·owner workspace 확인 뒤 기존 `SUPABASE_ANON_KEY`와 caller JWT client로만 메모를
조회·삭제한다(owner RLS 그대로, service_role은 `app_notes`를 읽거나 지우지 않음). ANON 설정이 없으면 503
`note_delete_unavailable`로 아무것도 바꾸지 않는다.

1. 메모 조회: 없음 404 `note_not_found`, 첨부 형식 이상·중복 409 `note_state_invalid`,
   `updated_at` 불일치 409 `note_changed`. 이때 Drive·DB 쓰기 없음.
2. 첨부마다 Drive 휴지통 이동: 저장·검증된 바구니 폴더만 사용(`existingOnly`, 폴더 생성 없음).
   다른 메모나 `app_documents.file_id`가 같은 파일을 쓰면 건너뜀. 메타데이터 GET이 앱 접근 가능·내 소유·
   폴더 아님·부모가 정확히 바구니 폴더 1개일 때만 `PATCH {trashed:true}`. 영구 `DELETE`는 하지 않는다.
   건너뜀·4xx는 `failed`, 응답 유실·5xx·확인 불가는 `unknown`(재시도 없음), 이미 휴지통이면 `trashed`.
   토큰·폴더 확인 실패면 전부 `failed`. 사진 글자 읽기 임시 문서는 기존 정리 규칙을 따르며 여기서 지우지 않는다.
3. 휴지통 결과와 무관하게(사용자 결정) caller JWT로 `id`·`workspace_id`·`updated_at` 조건 삭제.
   0행이면 다시 읽어 남아 있으면 409 `note_changed`, 없으면 404 `note_not_found`(동시 요청).
   오류면 다시 읽어 없으면 성공, 있으면 500 `note_delete_failed`, 읽기 실패면 503 `note_delete_result_unknown`.

응답은 항상 `{action:"note-delete",note_id,attachments_total,trashed,failed,unknown,ok,note_deleted,code?}`이며
폴더 ID·토큰·Google 오류 본문은 넣지 않는다. 이 동작을 모르는 이전 배포는 JSON POST를 OCR로 보내
`400 OCR_REQUEST_INVALID`(`action` 필드 없음)로 DB·Drive 접근 전에 거절한다. 화면은 이 응답만 구버전으로 보고
기존 REST 삭제로 메모만 지운다. 검사: `tests/security/basket-note-delete.test.mjs`.

## 사진글자 준비 — 아직 운영 미적용

기존 multipart 업로드와 별개인 OCR 경로를 준비한다. Google Drive의 기존
`drive.file` 인증을 재사용하며 JPEG/PNG 원본을 GET으로 읽어 임시 Google 문서로
import한다. 원본의 이동·수정·삭제, 공개 이미지 URL, 새 저장소·인증은 추가하지 않는다.
원본 업로드가 성공한 뒤 OCR가 실패해도 업로드 성공을 취소하지 않는다.

| 요청 | 의미 |
| --- | --- |
| owner GET `?action=ocr-capabilities` | protocol1, caller RPC 지원, 실제 Drive import/export map, 두 글자 상한. DB 행·Drive 파일 쓰기 없음 |
| owner GET `?action=ocr-status&note_id=UUID` | 현재 owner 업무공간의 첨부·정확한 원문 버전 조회. 쓰기 없음 |
| POST JSON `ocr-read` | 정확한 note 버전·전체 예상 첨부로 신규 시도 확정 후 한 번만 import |
| POST JSON `ocr-reconcile` | 같은 attempt만 검증·회수. 검색 결과 없음/복수/불명은 새 import하지 않음 |
| POST JSON `ocr-cleanup` | 같은 attempt의 검증된 임시 문서만 정리. 임의 file ID 삭제 없음 |

모든 JSON 요청은 `action`, `note_id`, `note_updated_at`, `expected_attachment`를
사용한다. reconcile/cleanup은 `attempt_id`도 필요하다. reconcile에서 초기 원문과
현재 원문이 달라졌으면 평소 재확인으로 저장하지 않는다. 같은 임시 문서의 인식 글을
현재 원문에 명시적으로 확인할 때만 `confirm_current_note_version`에 현재 버전
문자열을 그대로 넣는다. source Drive version이 바뀌었으면 이 확인으로도 저장하지 않는다.

기존 admin은 JWT 검증·owner 조회·OAuth 설정·기존 업로드에만 사용한다. OCR 행
조회와 `app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)`는 기존
`SUPABASE_ANON_KEY`와 검증된 caller JWT client로 실행한다. service_role RPC
fallback은 없다. RPC/ANON/provider 지원이 없거나 불명이면 새 OCR 실행이 거절된다.
기능 가능 probe는 null input의 정확한 INVALID_INPUT/no-row-write 응답을 확인하며,
실제 DB source/ACL/role 상속을 증명하는 검사는 아니다.

OCR는 이미 등록·검증된 비공개 최상위 바구니 폴더만 사용한다. 폴더 설정이 조회 중
사라져도 폴더를 생성하거나 설정을 쓰지 않는다. 임시 문서는 원본과 다른 ID, 실제
GoogleDocs MIME, owner-only 권한, 해당 폴더, app-private note/workspace/attempt/
source hash/Drive version/초기 note timestamp 표식을 모두 검증한다. 임시 문서의
생성 결과 불명은 기존 attempt를 보존하며 자동 생성·새 UUID로 재전송하지 않는다.

인식 글은 16,384 Unicode code points와 65,536 UTF-8 bytes를 모두 만족해야 한다.
상한 초과·malformed UTF8·NUL은 prefix를 저장하지 않는다. 원문·승인 요약과 분리된
`attachments[].ocr.text`만 좁은 INVOKER RPC의 버전/전체 첨부/시도 CAS로 갱신한다.
저장된 text는 reading/failed에서도 보존하며 상태·정리 변경만으로 원문 버전을
늘리지 않는다. 보관·AI 제외 메모의 명시 수동 읽기도 그 설정을 바꾸지 않는다.

응답의 `ocr_saved`, `text_changed`, `cleanup_state`, `result_unknown`을 각각 판정해야
한다. OCR 저장 성공과 임시 문서 삭제 성공은 별개다. 삭제 실패·불명은 인식 글과
known temp ID를 보존한다. DELETE204 뒤 DB 갱신 충돌은 같은 attempt에 대해서만
현재 버전으로 정리 상태를 기록하며, 인식 글을 새 원문에 자동 확정하지 않는다.
API/로그는 고정 코드만 사용하고 Google 오류본문·원문·인식 글·토큰은 로그에 쓰지 않는다.

서버/사본/UI 준비 PR → 실제 DB dry-run/apply → basket-files와 drive-summary 배포
→ 정상 owner 세션 실사용 확인 → 별도 활성화 PR 순서다. 준비 화면은 기본 비활성이다.
폰 실사용 확인의 정상 인증 경로는 마지막 운영 묶음에서 확정해야 하며 읽기 전용
진단 북마크에 쓰기·삭제를 숨기지 않는다. 운영 직전 실제 Edge source/version/JWT를
다시 확인한다. 알려진 되돌리기 기준은 basket-files v2
`4bd2f719e55aebd813c95b014ee5c0725ccb3753`, drive-summary v7
`39f1dfec9cd978f9ea5e7c94bca120fb16a0a84e`이다.
인식 글을 사용한 뒤에는 DB rollback으로 자료를 삭제하지 않고 새 실행 비활성·자료
보존·forward fix로 복구한다. 서버 준비와 실제 운영 확인을 동일시하지 않는다.
이 Drive 검증은 지원 Edge 경로의 검증이다. 직접 호출 가능한 INVOKER RPC가 원격
Drive 검증이나 정확히 한 번의 외부 문서 생성을 증명하는 것은 아니다.

정상 owner가 실제 인식·임시삭제를 확인할 구체 경로/필요한 규칙 예외 또는 순서결정은 마지막 묶음에서 CC 확인한다. 운영·인증 우회 경로를 임의로 만들지 않는다.

별도 검토 보완: 재시작한 persisted create_pending/create_unknown 시도는 정리·검색·소유/출처 검증의 거절 응답으로 failed/none으로 풀지 않는다. 이번 요청에서 새 시도 CAS가 확인되고 provider의 외부 CREATE가 아직 발송되지 않았다는 요청별 근거가 함께 있을 때만 known pre-POST 실패를 failed/none으로 기록한다. 기존 pending/unknown은 결과 불명과 같은 attempt를 보존하며 새 UUID/import로 우회하지 않는다.
