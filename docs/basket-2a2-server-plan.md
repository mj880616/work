# 📱 폰 가능 — BASKET-2a-2 서버 구현 계획

기준: 사용자 2026-10-10 지시, `basket-design.md` 3.1·3.2·9·11절.
시작 SHA: `c9eac2584e29ac849815824ae6ab52a5121001fc` (원격 fetch).

목표는 분류 없는 첨부 저장 서버와 승인 버튼용 DB 파일·배포 준비다.
`app/**`, `library-files`, 운영 접속·적용·배포·workflow 실행·merge는 제외한다.
사용자가 지정한 브랜치에서 이 세션이 직접 구현한다.

1. migration `20261010180000_basket2_drive_folder`: nullable text 칸 하나,
   history 기록, 3줄 summary, 집계 precheck, 모드별 history와 열 존재가
   일치하는 예/아니오 postcheck, 사용 중 거부 rollback, SELECT snapshot.
   기존 표 정의가 없으므로 workspace_id UUID/단일 unique 키와 새 행 생성에
   필요한 열을 catalog로 확인한다. 기존 권한/RLS는 snapshot으로 별도 대조한다.
   테스트를 먼저 작성하고 phase2 검사 및 임시 Postgres dry-run/apply/rollback/reapply로 검증한다.
2. `_shared/drive-upload.ts`: 기존 library-files의 토큰 갱신·폴더 생성·resumable
   업로드·orphan 정리 흐름 추출. 내용·토큰·ID 대신 단계 코드만 로그한다.
   바구니는 최상위 비공개 소유 폴더를 찾거나 만들며 공유 설정을 생성하지 않는다.
   설정 저장은 조건부 갱신과 ignoreDuplicates로 기존 칸을 보존한다.
3. `basket-files/index.ts` + `handler.ts`: Auth getUser JWT 검증, owner workspace
   서버 조회, multipart file(복수) + 선택 raw_text/note_id. 첨부 20개/파일
   104857600 bytes, DB JSON과 같은 검증. 기존 메모 갱신은 attachments·updated_at
   비교 조건으로 충돌을 거부하여 덮어쓰지 않는다. 이번 요청이 만든 파일만 실패 때 정리.
   실제 handler·Drive 모듈을 가짜 HTTP 서버로 검증한다.
4. 5절 JWT 표에 배포 대기 행, 원장 서버/화면 분리 및 library-files 후속 행,
   DB dry-run → apply → first_deploy Edge → 화면 순서 문서.
   기존 workflow shell을 가짜 metadata로 실행해 신규 사전 검사를 검증한다.
   Node 회귀·Postgres·가능하면 Deno 타입 검사 뒤 커밋/push/연결 GitHub PR·CI 확인.

검토 초점: 동시 메모 추가, 동시 폴더 생성, 설정 저장 실패, JWT 검증 장애,
공유되거나 이동된 폴더·업로드 결과 불명. 결과 불명은 자동 재시도하지 않는다.
library-files의 공유 모듈 전환은 요청한 예외에 따라 후속 PR로 남긴다.

검증 기록: 보안 Node 324/324, 인접 Node 118/118, 임시 Postgres 최종 36/36,
Deno 2.9.6 타입 검사 통과. 신규 사전 검사와 phase2/Edge 회귀 32/32는 보안
검사에 포함된다. Postgres 전체 중 기존 record-links 테스트가 종료 시 연결 오류로
실패했고 재실행은 통과했다. clean main 별도 사본 첫 실행은 35/35였지만 추가 확인에서
기존 task29 테스트가 같은 오류로 실패(34/35). pg-pool 종료 후 소켓 종료 전에 cluster를
중지하는 경합을 기존 postgres.test.mjs의 client end 대기 패턴과 대조했다.
검증 안정화를 위해 record-links/task29 두 기존 fixture의 종료 대기만 보완하고
검증 항목·제품 코드는 변경하지 않았다. `app/**`·`library-files` diff 없음 확인.
DB 저장 응답 유실은 메모 readback으로 성공을 확인하거나 파일 유지·결과 불명으로
보고하도록 추가했다. 확인되지 않은 저장을 실패로 단정해 파일을 삭제하지 않는다.
최종 별도 검토의 중요 지적: 응답 유실 뒤 부정적인 재조회만으로는 늦은 commit을
배제할 수 없다. 지연 commit 회귀를 RED→GREEN으로 검증하고 명확한 DB 거절/0행 충돌만
정리 가능하게 제한했다. 결과 불명은 파일 유지·수동 확인이며 자동 재시도하지 않는다.
추가 검토: settings 신규 행의 ON CONFLICT에는 즉시 검사하는 unique 키가 필요하다.
deferrable 키를 거부하는 Postgres 회귀를 RED→GREEN으로 확인하고 precheck/guard에
`indimmediate`를 추가했다(이 검사는 지원 가능한 기존 표인지 판단하는 필수 경계로 분류).
남은 제한: multipart 전체 메모리 사용으로 대용량 묶음 요청은 운영 보장하지 않음;
다음 화면은 설계대로 한 파일씩 순차 업로드. 동시 폴더 생성 때 빈 폴더가 남을 수 있고
경쟁하는 설정 초기화의 별도 회귀는 후속 검증 항목이다. 자동 삭제로 정리하지 않는다.
