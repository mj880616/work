# 📱 폰 가능 — BASKET-2a-2 서버 적용·배포 순서

이 PR은 파일·PR 준비만 한다. 화면(`app/**`)·기존 `library-files`는 변경하지 않는다.
운영 접속·DB 적용·Edge 배포·workflow 실행·merge는 하지 않았다.

Migration: `20261010180000_basket2_drive_folder`.

무엇이 바뀌나: 바구니 첨부를 둘 내 Drive 폴더를 기억할 칸을 추가합니다. 화면은 그대로입니다.
잘못되면: 첨부 저장이 실패할 수 있습니다. 기존 메모와 자료실 폴더 칸은 바꾸지 않습니다.
되돌리는 법: 새 칸을 사용하기 전 짝 rollback으로 제거합니다. 사용한 뒤에는 멈추고 백업과 Drive 파일을 확인합니다.

1. 커맨드센터에서 SQL·서버·CI를 검토하고 merge한다. 이 PR merge만으로 화면은 바뀌지 않는다.
2. 기존 표 생성 정의는 저장소 migration·docs에 없다. 사용자가 짝
   [precheck](20261010180000_basket2_drive_folder.precheck.sql)와
   [snapshot](20261010180000_basket2_drive_folder.snapshot.sql)을 읽기 전용으로 실행·보관한다.
   workspace_id UUID/NOT NULL·단일 즉시 검사 unique 키=예, unsupported required columns=0,
   basket column/history=0, BASKET-1 prerequisite=1을 확인한다. 불일치는 중단한다.
   현재 나머지 열·owner·RLS·grant는 snapshot으로 확인하며 코드가 이를 새로 만들거나 바꾸지 않는다.
3. [DB 승인 workflow](ops-db-workflow.md)에서 사용자 **dry-run**, version
   `20261010180000`. plan의 main SHA·파일 해시·summary 3줄·끝 `rollback;`을 확인하고
   `production-edge` 승인. 사후 history 없음과 postcheck 모두 예, 사전 집계·snapshot 대조.
4. 같은 main 파일·해시의 **apply**를 별도 승인한다(실제 DB 변경의 승인 버튼 첫 사용).
   백업 대상 `app_drive_settings`, SQL 끝 `commit;` 확인. 적용 뒤 history 1행,
   `basket_folder_id text NULL`·기본값/개별 grant 없음, postcheck 모두 예.
   precheck 재실행으로 row count·owner/RLS/grant/policy 해시를 이전 값과 대조한다.
   postcheck는 baseline NULL 없이 예/아니오만 출력하지만 기존 row/권한 보존까지 자동 증명하지는 않는다.
5. DB 사후 확인이 끝나면 [신규 Edge 절차](ops-edge-new-function.md)로 사용자가
   `function=basket-files`, `ref=승인한 서버 소스 SHA`, `first_deploy=true`,
   `verify_jwt=false`, `expect_unauth_401=true`를 지정한다. 함수 폴더·5절 정책 표
   일치와 직전 운영 동명 함수 0개 검사를 거쳐 `production-edge` 승인·최초 배포.
   이 세션은 실제 운영 함수 유무를 조회하지 않았다. 로컬 가짜 metadata로 사전 검사만 검증한다.
6. 배포 Summary의 version·JWT 정책·POST 401·OPTIONS 200/204를 커맨드센터에서
   확인한 뒤 **후속 화면 PR**: 첨부 UI, 공통 `copyUploadFile`, AI 제외 표시 숨김.
   DB `ai_export_allowed`는 유지하며 새 메모 기본 `true`를 바꾸지 않는다.

복구: 파일을 올리기 전에는 짝 [rollback](20261010180000_basket2_drive_folder.rollback.sql)을
별도 승인하여 칸·해당 history만 제거한다. 폴더 ID가 사용됐으면 guard가 중단하므로 값을 지워
통과시키지 않는다. Drive 파일을 자동 삭제하는 DB rollback은 없다. 사용 뒤에는 요청을 멈추고
DB 백업·메모 참조·Drive를 따로 확인한다. Edge 최초 배포에는 이전 version이 없으므로 화면이
호출하지 않는 상태를 유지하고, 삭제 판단은 사용자 대시보드 절차로만 한다.

테스트는 [가짜 Drive 서버](../tests/security/basket-files.test.mjs),
[승인·신규 배포 사전 검사](../tests/security/basket2-migration.test.mjs),
[임시 Postgres](../tests/auth-handoff/basket2.test.mjs)로 수행한다.
