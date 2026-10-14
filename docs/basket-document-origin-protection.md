# 📱 폰 가능 — 바구니 원본 삭제 보호 서버 준비

2026-10-13, BASKET-4b-1 A 범위, 준비 Draft [#523](https://github.com/mj880616/work/pull/523). 시작 main `a9ba4a1de1799b18908dde00500e3b4f6df977df`, `codex/basket-document-origin-protection`.

## 바뀌는 동작

기존 `document-actions`의 자료 삭제는 Drive 파일을 먼저 휴지통으로 옮겼다. 서버가 확인한 사용자의 모든 owner 업무공간에서 바구니 첨부 참조를 확인하고, 참조가 있거나 실제 비공개 루트 바구니 폴더에 있는 원본이면 Drive를 건드리지 않고 자료 등록/download token만 기존 순서로 제거한다. 보관·AI 제외·연결 없음은 참조 조회에서 제외하지 않는다. 첨부 원문·다른 메모를 수정하지 않는다.

참조가 없으면 실제 Drive 파일의 parent와 own My Drive root의 `Web2 바구니` 폴더를 읽는다. 폴더는 소유·folder MIME·미삭제·parent1개·user owner permission1개를 확인하고, 저장된 basket setting이 있으면 GET 결과와 root 조회를 대조한다. setting이 없어도 검증된 루트 바구니 원본을 보존한다. 생성/setting 저장이 있는 `ensurePrivateRootFolder`는 호출하지 않으며 `drive-upload.ts`도 변경하지 않았다. 수정 가능한 classification_note는 판정에 쓰지 않는다.

owner 업무공간·메모·setting은 명시 Range와 `Prefer: count=exact`, 응답 Content-Range의 시작/끝/전체 수·배열 길이·중복 key를 검증한다. 서버가 작은 페이지로 제한해도 확인된 다음 위치부터 계속 읽는다. Drive 검색도 모든 page token을 읽으며 incompleteSearch/반복 token/누락 permission/조회 오류는 삭제 전 거절한다. 권한·자료 ID/workspace/file source는 클라이언트 override 대신 Auth와 서버 row로 고정하고 Drive 쓰기 전 및 metadata 삭제 전 다시 확인한다. 마지막 document DELETE는 고정 source 조건 및 return=representation 결과를 대조한다.

일반 자료는 기존 Drive trash 계약을 유지한다. 이미 휴지통에 있거나 Drive가 404인 경우 metadata만 제거하고, Drive 실패 때 metadata는 남긴다. Drive physical DELETE/copy/move/upload/folder 생성/권한 생성은 없다.

## 결과와 한계

- 성공은 기존 `ok:true`를 유지하며 `drive_preserved`, `reason`(`note_reference`/`private_basket_original`/`ordinary_library`), `drive_result`를 추가한다.
- 불완전 출처 검사는 `BASKET_ORIGIN_UNKNOWN`, source 변경은 `DOCUMENT_CHANGED`로 거절한다. Drive/DB 쓰기 응답이 불명하면 `RESULT_UNKNOWN`을 반환한다. 확인된 Drive 처리 및 token/document 삭제 단계를 구분하며 같은 요청을 내부에서 자동 재전송하지 않는다.
- 기존 token→document REST DELETE는 하나의 DB transaction이 아니다. token 제거만 성공하거나 Drive trash 뒤 source가 바뀔 수 있다. 실패를 전체 성공으로 표시하지 않으며 자료/원본 상태를 다시 확인해야 한다.
- 검사 뒤 새 참조가 생기거나 Drive 폴더/파일이 외부에서 이동하는 경쟁까지 DB 원자성으로 보장하지 않는다. 완전한 조회를 확인하지 못하면 삭제가 차단되므로 오래된 잘못된 setting/첨부 상태는 운영 확인이 필요할 수 있다. 메모 전체 첨부 조회는 owner 범위의 서버 내부 읽기이며 원문을 응답/로그로 내보내지 않는다. 메모는 page 단위로 확인해 전체 첨부/OCR payload를 누적 보관하지 않는다. 향후 OCR text를 포함한 큰 단일 page의 읽기 비용은 해당 source 통합 때 대조한다.
- 실제 app_documents 전체 schema/default/FK cascade, notes 전체 운영 schema, document-actions의 직전 운영 source SHA/JWT 정책은 미확인이다. 확인된 저장소 계약 밖의 삭제 범위를 확대하거나 migration/RLS/권한을 변경하지 않았다.
- **서버 준비만**이다. app UI/삭제 문구/cache는 변경하지 않아 기존 UI의 Drive trash 안내가 아직 남아 있다. 후속 직렬 UI 작업과 실제 보호 배포가 완료되기 전 자료실 등록을 활성화하지 않는다. library 등록·새 RPC·AI 종류 활성화·library-files 공유 전환은 이번 범위가 아니다.

## 검증 기록

실제 handler와 production helper를 주입해 실행하는 mock Auth/REST/OAuth/Drive tests를 사용한다. 전 네트워크는 mock이며 실제 계정/운영 Drive/DB 접근은 없다.

- 첫 RED: 새 실제 handler 검증26개 모두 실패(기존 source는 첨부 참조·불완전 출처에도 trash 진행). GREEN26/26.
- source 변경·다른 owner 업무공간/두 종류 pagination·partial DB 단계·conditional delete·null-file 경계를 추가한 서버37개와 기존 trash9개, 삭제 UI helper7개: `node --test tests/security/document-actions-trash.test.mjs tests/security/basket-document-origin.test.mjs tests/document-delete.test.mjs` **53/53**.
- 최초 security+Edge isolation 실행: PATH에 Deno가 없어5개 환경 실패. 기록을 보존하고 Deno2.9.6의 기존 설치 경로와 OS CA trust를 적용했다. `node --test tests/security/*.test.mjs tests/edge-isolation/*.test.mjs tests/document-delete.test.mjs` **434/434** (보안/격리427+삭제 helper7). source 타입·메모 page streaming·malformed source 차단 보강 뒤 관련53/53 및 Deno check/helper lint 통과. malformed server source 두 사례도 먼저 RED2/2 실패 뒤 차단을 확인했다. final source 전체 검사 결과·head는 구현 보고와 PR CI를 기준으로 한다.
- `DENO_TLS_CA_STORE=system deno check --no-config supabase/functions/document-actions/index.ts`, 새 helper `deno lint`: 통과. 인증서 검증을 끄지 않았다. 전체 브라우저/DB PG 검사는 이번 Edge-only 변경의 확인 범위가 아니다.

## 적용 전 준비·복구

일상어3줄: “자료 등록을 지울 때 바구니 원본을 함께 지우지 않게 합니다.” / “출처 확인이 안 되면 삭제를 멈추고, 결과가 불명하면 목록과 원본을 다시 확인합니다.” / “새 삭제 실행을 끄고 자료·원본을 보존하며 확인된 직전 소스로 복구합니다.”

1. CC가 별도 diff/spec/quality 검토·정확한 final SHA CI를 확인한다. UI 후속은 별도 직렬 slot으로 진행한다.
2. 사용자가 나중에 묶음으로 주는 SELECT로 app_documents 전체 schema/FK와 기존 삭제 경계를 확인한다. 실제 직전 document-actions source SHA 및 version/verify_jwt를 배포 직전에 확인한다. 저장소 main을 운영 rollback SHA라고 추정하지 않는다.
3. 사용자 승인형 Edge workflow에서 기존 함수 `document-actions`, 검토된 전체 ref, first_deploy=false, verify_jwt=keep, expect_unauth_401=true. 실제 현재 JWT 정책·unauth POST 상태는 운영 gate다(기존 handler의 자체 Auth 오류400을 이번 변경에서 재작성하지 않았다). version증가/JWT유지/POST401/OPTIONS200 또는204를 확인한다. 검증 실패는 이미 실행된 배포를 자동 취소하지 않는다.
4. 보호/일반 trash 실사용 확인과 UI 완료 뒤에만 B 등록 활성화. 임의 원본/task를 검증용으로 자동 삭제하지 않는다. 기존 폰3개 확인을 다시 요구하지 않는다.
5. 운영 문제 때 먼저 새 등록/삭제 실행을 비활성·자료 보존한다. B 등록이 아직 미사용이면 확인된 직전 Edge source로 사용자 승인 배포를 준비한다. B가 활성화되어 원본이 공유되기 시작한 뒤 보호를 제거하는 rollback은 하지 않고 forward fix한다. DB 자료/Drive 원본을 삭제해서 되돌리지 않는다.

## B 등록 서버(2026-10-14 야간, BASKET-4b-1 후속)

📱 Claude Code 웹. 시작 main `a128799`. 원본 보호(A)는 이미 `document-actions` 삭제 경로에 연결되어 있고, 자료실의 두 삭제 화면(자료실 목록 `library-upload.js`, 회의 상세 `meeting-round-detail.js`)은 공통 `document-delete.js`로 이 서버만 호출한다(#533). 이번에 같은 함수에 등록 동작을 추가했다. 같은 함수에 있으므로 등록만 먼저 운영에 올라가는 경우는 없다.

- 요청: `POST document-actions` `{action:"register-basket-attachment", note_id, drive_file_id}`. 함수 JWT 정책(verify_jwt=true)·기존 `getUser`·owner 확인 그대로.
- 서버가 메모를 읽어 업무공간·첨부(같은 `drive_file_id`)·파일 이름·종류·크기를 정한다. 클라이언트가 보낸 업무공간·제목·공개 범위는 쓰지 않는다. `visibility='private'`, `uploaded_by`=로그인 사용자, 분류 메모 "바구니 메모 첨부에서 등록(같은 Drive 원본)".
- Drive는 메타데이터 GET만 한다(내 소유·휴지통 아님·ID 일치). 복사·이동·업로드·휴지통·권한 변경 없음. 자료 행은 같은 Drive 파일 ID를 가리킨다.
- 중복: 같은 업무공간·같은 `file_id` 자료가 있으면 `{ok:true,result:"exists",document}`. Drive 확인 뒤 쓰기 직전에 한 번 더 확인한다. DB에 `file_id` 고유 제약이 없어 두 요청이 정확히 동시에 오면 두 행이 생길 수 있다(화면은 첨부마다 요청 1개만 보낸다). 고유 제약은 DB 변경이라 이번 범위가 아니다(제안만).
- 결과 불명(연결 끊김·5xx·응답 행 불일치): HTTP 503 `RESULT_UNKNOWN`, 서버가 다시 보내지 않는다. 쓰기 전 거절은 모두 HTTP 400(화면은 400이면 "바뀐 것 없음", 그 밖의 실패는 "결과 불명"으로 본다). 명확한 거절(4xx): `REGISTER_REJECTED`. 그 밖: `INVALID_REQUEST`·`NOTE_NOT_FOUND`·`ATTACHMENT_NOT_FOUND`·`DRIVE_FILE_MISSING`·`DRIVE_FILE_TRASHED`·`DRIVE_FILE_INVALID`·`DRIVE_UNAVAILABLE`.
- 삭제 쪽: 등록한 자료를 자료실에서 지우면 메모 참조(`note_reference`)로 Drive를 건드리지 않는다. 메모를 지우면 basket-files `note-delete`가 `app_documents.file_id` 참조를 보고 원본을 휴지통으로 옮기지 않는다. 둘 다 지운 뒤에는 바구니 폴더 원본 판정(`private_basket_original`)으로 원본이 보존된다(자동 정리 없음).
- 검사: `tests/security/document-actions-register.test.mjs` 8개(등록 본문·이미 있음·확인 중 생긴 중복·결과 불명 4종 1회만·클라이언트 값 무시·Drive 이상 6종·등록 뒤 삭제 시 원본 보존·기존 delete 계약). 보안·Edge 격리 전체 595/595(Deno 2.5.6), `deno check` 통과.
