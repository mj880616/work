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
