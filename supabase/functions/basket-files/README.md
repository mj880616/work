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
찾거나 생성한다. 저장된 폴더도 이름·최상위 위치·소유자·휴지통·owner 단독 권한을
매번 검증한다. 공유 권한을 생성하거나 기존 공유를 해제하지 않는다. 공유·이동·이름
변경을 발견하면 409로 중단한다. 실제 폴더 ID는 DB 설정에만 저장한다.
설정 행 생성은 `ignoreDuplicates`, 칸 저장은 NULL 조건 갱신으로 기존 root/library
칸을 보존한다. 동시 생성 시 최종 설정의 폴더를 검증해 사용한다. Drive 폴더 생성과
DB 저장은 별개이므로 장애·동시 생성 때 빈 폴더가 남을 수 있다. 자동 폴더 삭제는 하지 않는다.

기존 메모 갱신은 workspace·ID·기존 `updated_at`·기존 JSON 첨부가 모두 같은 행만
갱신한다. 다른 요청이 먼저 바꾸면 409 `note_changed`, 이번 요청의 새 파일만 정리한다.
글 수정 경로가 `updated_at`을 갱신하는 기존 계약을 유지해야 한다.

실패는 고정 오류 코드·단계·`retryable:false`로 반환하며 로그에는 코드만 남긴다.
DB 저장 오류는 먼저 메모를 다시 읽는다. 저장 확인 시 성공 응답, 저장되지 않았다고
확인되면 새 Drive 파일 DELETE, 확인 실패/부분 반영은 503 `note_save_result_unknown`과
`note_id`로 결과 불명을 알리며 파일을 유지한다. 결과 불명은 자동 재업로드하지 않는다.
Drive PUT 성공 응답 자체 유실·정리 실패·강제 종료는 파일이 남을 수 있으므로 수동 확인한다.
클라이언트는 후속 화면 PR에서 공통 `copyUploadFile`을 사용한다(#467).

공통 모듈 `_shared/drive-upload.ts`는 library-files의 토큰·폴더 POST·resumable
업로드·orphan 정리 흐름을 추출했다. 이번 PR은 library-files 소스를 변경하지 않는다.
기존 업로드 경로 재배포를 피하기 위한 사용자 지정 예외이며 `_shared` 전환은 후속 원장 행으로 추적한다.
