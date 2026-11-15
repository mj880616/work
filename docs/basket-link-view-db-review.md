무엇이 바뀌나: 연결마다 승인한 요약을 저장하고 나중에 고칠 서버 기능을 준비합니다. 이번에는 화면이 그대로입니다.
잘못되면: 연결 확정이나 요약 수정이 거절될 수 있습니다. 적용 뒤 저장한 요약은 별도 보존 없이 칸을 제거하면 사라집니다.
되돌리는 방법: 요약을 비공개 파일로 보존·검증하고 잠금 뒤 현재 전체 행과 정확히 대조합니다. 일치할 때만 같은 transaction에서 요약 비우기·새 함수/칸 제거·기존 함수 복원을 실행합니다.

# 📱 폰 가능 · BASKET-연결보기 1차 DB 준비

[DB 준비 PR #506](https://github.com/mj880616/work/pull/506). 시작은 새 fetch한 origin/main `6accabd1eb1f520ef6c25a8fa9ce9f13be6d8a74`(#504 merge), branch `codex/basket-link-view-db`다. #505 문서 PR은 별도 승인 대기이며 이 PR이 승인·merge를 대신하지 않는다. #505가 main에 merge되면 이 branch에 main을 merge해 반영한다. rebase·force push하지 않는다.

## 범위와 호환

- migration version `20261012100000`, name `basket_link_view_db`: 14자리·저장소 중복 없음. 마지막 schema_migrations INSERT가 파일 이름과 일치한다. 운영 미조회·미적용.
- `app_record_links.summary text NULL`: 기존 행 및 생략/JSON null 호출은 SQL NULL. 공백만인 글 제외 1~2,000 PostgreSQL 문자(code point). ASCII 공백·탭·개행 및 Unicode 공백(NEL·NBSP·전각·BOM 등)을 검사하고 글과 양끝 공백은 그대로 저장한다. 표 CHECK와 RPC 모두 검사한다.
- `app_basket_confirm_links(uuid,timestamptz,jsonb) returns jsonb`, 인자명 `p_note_id/p_note_updated_at/p_targets` 유지. 목적지는 필수 kind/target_id/reason + 선택 summary만 받는다. reason을 요약으로 채택하지 않는다. 이미 confirmed면 기존 요약·행을 보존한다.
- 메모 버전·보관/AI 제외·현재 선택 가능한 프로젝트·같은 업무공간·전체 목적지 사전 검증·메모 단위 원자성 유지. 4a는 조직/프로젝트 확정만 처리한다. 5종 목적지의 기존 AI 답·파서·Google 할 일/회의/자료 연결은 유지한다. 4b 종류를 이 함수로 새로 확정하지 않는다.
- 새 업무 표·AI 제안 표 없음. 메모 원문·옛 조직 기록·현재 조직 요약·프로젝트 현재 상태를 수정하지 않는다. app_suborganization_updates 이중 쓰기 없음.
- app/·Edge·캐시 변경 없음. 이번 PR과 DB 적용만으로 조직/프로젝트/홈에 연결 기록이 새로 보이지 않는다. AI 안내의 날짜·시각·장소·주체·숫자, 목적지별 요약 편집, 이후 편집 UI, 보관 메모 표시 등은 별도 2차 지시 뒤 구현한다. 사진글자·텔레그램 연계 제외.

## 정확한 수정 RPC 계약

```sql
public.app_basket_update_link_summary(
  p_link_id uuid, p_expected_summary text, p_summary text
) returns jsonb
```

메모에서 조직/프로젝트로 confirmed인 링크만 대상이다. 서버가 링크로부터 메모·대상·업무공간·소유자를 읽는다. 클라이언트 owner/workspace/target 값은 받지 않는다. note → link → target 순서로 잠그고 관계를 다시 검사한다. Google 할 일 출처·suggested·회의/자료 대상은 수정하지 않는다. 프로젝트의 소유자·업무공간은 검사하지만 확정 후 보관된 프로젝트를 새로 선택하는 작업은 아니므로 카탈로그 상태를 강제하지 않는다. 보관·AI 제외 메모의 직접 요약 수정도 허용한다.

`p_expected_summary`는 읽었던 정확한 이전 문자열 또는 SQL NULL이다. IS DISTINCT FROM 비교 및 null-safe UPDATE 조건으로 동시 수정 충돌을 거절한다. 호출 둘이 같은 NULL을 읽어도 한 호출만 저장한다. 충돌은 재조회 후 사용자 선택으로 해결하며 자동 덮어쓰기하지 않는다. 새 요약 NULL·빈 글·공백뿐·2,001자 이상은 거절한다. 요약 삭제 RPC는 없다.

| 반환 | 의미 |
| --- | --- |
| `{"ok":true}` | 저장 성공 |
| `{"ok":false,"error":"NOT_FOUND"}` | 링크/메모/대상 없음 또는 invoker에게 안 보임, 이번 대상 출처·종류·확정 상태가 아님 |
| `{"ok":false,"error":"PERMISSION_DENIED"}` | JWT 주체 없음, 소유자/업무공간 불일치, SELECT 허용 행의 UPDATE 거절 |
| `{"ok":false,"error":"SUMMARY_CHANGED"}` | 읽었던 요약과 현재 요약이 다름(NULL 포함) |
| `{"ok":false,"error":"INVALID_INPUT"}` | 링크 ID 없음, 새/이전 요약의 형식·길이 오류 |

anon/PUBLIC은 함수 진입 전에 PostgreSQL 42501로 거절된다. 다른 소유자의 숨겨진 행은 없음과 같은 NOT_FOUND로 반환해 존재를 누설하지 않는다. 두 RPC는 SECURITY INVOKER·빈 고정 search_path·PUBLIC/anon 사전 revoke 뒤 authenticated 실행권한이다. 표 ACL·소유자 RLS·출처/목적지/중복 제약은 유지한다. 기존 authenticated 직접 표 UPDATE 권한은 유지하므로 향후 UI는 이 RPC를 사용해야 동시 수정 보호를 받는다.

## 자료와 승인형 workflow 코드 확인

같은 stem `20261012100000_basket_link_view_db`의 migration·snapshot·precheck·postcheck·rollback·summary를 짝으로 둔다.

- snapshot: 행 수·ACL/RLS/정책·기존 함수 전문·제약/출처/목적지/상태 hash. 메모/요약 글은 출력하지 않는다. 적용 전후 행 수·출처 hash·ACL/정책은 같아야 하며 제약 hash는 summary CHECK 추가로 달라진다.
- precheck: 4a 기록·정확한 이전 본문 hash·invoker/path, 새 version/칸/함수 없음·owner RLS. migration 내부에서도 이전 4a 본문·인자·invoker/path를 잠금 후 일치 검사한다. 전부 “예”이고 snapshot 함수가 rollback의 고정 4a 본문과 같은 경우만 진행한다. 다르면 중단한다.
- postcheck: apply 뒤 두 RPC·권한/path·nullable text·CHECK·RLS·version 1행. dry-run 뒤에는 기록이 없을 때 이전 함수·칸 없음 유지로 판정한다. 기존 workflow가 dry-run 뒤에도 postcheck를 실행하므로 자료 자체에서 단계에 맞춰 판정한다.
- apply의 백업은 `ops_backup.20261012100000_app_record_links_<run_id>`. 적용 **전** 백업에는 새 칸/이후 요약이 없다. 이후 요약 복구용으로 오해하지 않는다. 함수 전문은 snapshot으로 별도 보존한다.

`.github/workflows/db-migration-apply.yml`은 main만 checkout하고 plan SHA를 고정하여 production-edge 승인 뒤 실행한다. `scripts/ops/db-migration-plan.mjs`는 14자리 파일을 자동 발견하며 version 등록표가 없다. 이번 ALTER·CREATE OR REPLACE·새 함수·사전 revoke/grant는 허용된다. 실제 runMigrationPlan 경로를 격리 PostgreSQL로 실행해 **dry-run 사전 상태 유지 / apply 백업 및 사후 검사 성공**을 검증한다. 추가 등록·workflow 변경 없음.

**충돌:** validateSQL의 rollback 모드는 함수 생성/교체·권한 명령을 금지한다. 요구대로 기존 확정 함수를 복원하는 이번 rollback SQL은 prepareMigration rollback에서 거절된다. 이 사실도 테스트한다. 기존 연결 기능을 DROP하거나 함수명을 바꿔 우회하지 않는다. **현 정책에서 이번 rollback 버튼은 사용할 수 없다.** CC는 merge/apply 전 이 제한과 아래 사용자 SQL Editor 복구 대안을 검토해야 한다. 버튼 복구가 필수이면 함수 복원 허용 정책은 별도 승인 작업이 필요하며 이번 PR에서 바꾸지 않는다.

## 나중 적용 순서와 이번 정지 지점

1. CC가 DB 준비 PR·정확한 head SHA·rollback 제한/대안을 검토한다.
2. 사용자 “머지” 승인 뒤 CC가 검토 SHA를 고정해 squash merge한다.
3. 사용자만 main에서 version 20261012100000 **dry-run 실행 → production-edge 승인**. CC가 기록 0·이전 상태 유지 결과를 확인한다.
4. 사용자만 **apply를 별도로 실행 → 승인**. CC가 백업 이름·Success·사후검사·snapshot을 확인한다. precheck “아니오”·스키마/함수 정의 차이면 중단한다.
5. 그 뒤 별도 2차 지시로 화면·AI 안내 구현 → CC 검토·merge → 필요한 drive-summary 승인 배포 → 폰 확인.

미병합 PR DB를 버튼으로 먼저 적용하지 않는다. 이번 Codex 웹 세션은 파일·테스트·PR·자동 CI 확인까지만 한다. 운영 접속·DB 적용·Edge 배포·workflow 수동 실행/재실행·승인·merge 없음.

## 📱 폰 경로 C · 원자적 복구 / 사용자 SQL Editor 대안

무엇이 바뀌나: 검증한 비공개 파일과 잠금 뒤 현재 행 전체가 같을 때만 요약을 비우고 기존 4a 함수·스키마로 되돌린다.
잘못되면: 파일과 현재 값이 다르거나 함수 복원이 실패하면 transaction 전체가 취소된다. 새 요약·새 스키마를 그대로 둔다.
되돌리는 방법: 파일을 보존하고 원인을 확인한다. 정상 복구 뒤 요약이 다시 필요하면 별도 승인 재적용 후 조건부 복원 SQL을 쓴다.

**이번 세션은 준비·격리 검증만 한다. 아래 운영 실행은 나중에 CC 검토·사용자 승인을 받은 사용자가 한다. rollback 버튼 제한은 그대로이며 workflow 정책을 넓히지 않는다.**

1. 요약 편집·연결 확정 입력을 멈추고 CC가 읽기 전용 snapshot을 확보한다. 입력 중지는 보조 조치이며, 이미 진행 중인 수정은 아래 잠금 뒤 정확한 대조로 잡는다.
2. 사용자가 [preserve.sql](20261012100000_basket_link_view_db.preserve.sql) SELECT **전문**을 실행하고 결과 1행의 `preservation_json`·`preservation_hex` 두 값을 비공개 파일로 내보낸다. **NULL 요약 행을 포함한 app_record_links 전체 행·전체 칸**을 보존한다. 날짜 칸은 UTC로 정규화해 폰/SQL 세션 timezone 차이로 바뀌지 않는다. apply 사전 백업으로 대신하지 않는다.
3. 파일을 다시 열어 JSON의 모든 ID·연결·요약 전문(개행·Unicode·양끝 공백 포함)을 확인한다. 건수만 대조하지 않는다. 저장한 hex를 아래 **읽기 전용 SELECT**에 넣어 다시 읽고 JSON과 정확히 같은지 대조한다. 잘림·불일치·파일 재읽기 실패면 중단한다. hex는 암호화가 아니며 JSON·실제 ID·요약·hex·값을 넣은 SQL 모두 비공개다. 공개 문서·PR·채팅·Actions 로그/artifact에 넣지 않는다.

   ```sql
   select convert_from(decode('PASTE_VERIFIED_PRIVATE_HEX','hex'),'UTF8')::jsonb
     as private_preserved_rows;
   ```

4. 사용자 폰에서 새 쿼리 창(+)을 열고 [recovery.sql](20261012100000_basket_link_view_db.recovery.sql) **전문**을 붙인다. 딱 한 곳의 `PASTE_VERIFIED_PRIVATE_HEX`를 검증한 파일의 **hex 값만**으로 바꾼다(따옴표/JSON/CSV 포장 제외). CC와 대상 프로젝트·첫 줄 `begin isolation level read committed;`·마지막 줄 `commit;`·파일 완전성을 확인하고 사용자가 실행한다. 붙여넣기가 길어도 **이 복구는 여러 transaction으로 나누지 않는다.** 폰에서 전문을 넣을 수 없으면 중단한다.
5. SQL은 비공개 파일을 transaction 임시 표로 읽고 `ACCESS EXCLUSIVE` 잠금을 얻는다. **잠금 대기 중 늦은 수정이 commit해도 READ COMMITTED의 새 snapshot으로** 현재 전체 행·요약과 파일을 양방향 `EXCEPT`로 정확히 검사한다. 건수·hash만 비교하지 않는다. 추가/삭제/연결/상태/요약 어느 값이라도 다르면 `SUMMARY_PRESERVATION_CHANGED`로 중단하고 **어떤 요약도 비우지 않는다**. 파일을 새로 내보내 검증하고 CC가 재검토해야 하며, 오류를 무시해 강제 진행하지 않는다.
6. 일치할 때만 같은 잠금·같은 transaction 안에서 요약 비우기 → 새 수정 함수 정확한 서명 DROP → 고정 4a 함수 전문 복원 → 새 제약/칸·새 version/name 기록 제거 → commit한다. 기존 함수 ACL·기존 연결 행은 보존한다. **함수 복원/칸 제거/기록 정리 어느 단계든 실패하면 요약 비우기도 취소된다.** 오류 시 같은 창에서 `rollback;`으로 실패 transaction을 끝내고 별도 SELECT로 요약·함수·스키마 보존을 확인한다. 비우기를 별도 실행하거나 rollback.sql을 앞뒤에 덧붙이지 않는다(begin/commit 중첩 없음).
7. 정상 복구 후 CC가 summary/수정 RPC 없음·기존 4a 함수 전문과 ACL·연결 전체/RLS·기존 migration 기록 보존을 snapshot과 대조한다. 비공개 파일은 계속 보존한다. [rollback.sql](20261012100000_basket_link_view_db.rollback.sql)은 **요약이 하나도 없을 때의 독립 복구만** 허용하며, 요약이 있으면 guard로 거절한다. 사전에 값을 NULL로 만들어 이 guard를 우회하지 않는다.
8. 요약을 다시 서비스에 복원할 때는 CC 검토·별도 사용자 승인으로 migration을 재적용한다. 새 창에 [restore.sql](20261012100000_basket_link_view_db.restore.sql) 전문과 같은 비공개 hex를 넣고 첫 줄·끝 줄·대상을 확인해 사용자가 실행한다. **현재 summary NULL + 동일 ID/workspace/출처/목적지/status 및 summary 외 전체 칸 일치**인 행에만 요약을 복원한다. 삭제·변경된 행이나 이미 새 요약이 있는 행은 덮어쓰지 않는다. `restored_count`, `preserved_summary_count`, `exact_restored_summary_count`와 비공개 문자열 대조로 복원을 확인한 뒤 편집을 연다. 제외 행은 CC가 검토하며 강제 쓰기·전체 백업 표 덮어쓰기·자동 재시도는 하지 않는다.

snapshot이 고정 4a 정의와 다르면 이 복구를 실행하지 않고 CC가 실제 snapshot 복원 대안을 검토한다. 저장한 파일 자체를 잃으면 요약 복원이 불가능하다. 파일 검증과 사용자 SQL Editor 실행은 별도 승인 단계다.

## 검증 기록

RED: 기존 4a에 summary를 보냈을 때 실제 PostgreSQL INVALID_TARGETS로 원하는 저장 결과와 불일치함을 확인했다. 신규 tests/auth-handoff/basket-link-view.test.mjs는 NULL·공백/길이/Unicode·중복 보존·수정·두 실제 세션 충돌·보관/AI 제외·소유자/업무공간/RLS·출처/상태/대상·원자성·요약 보존 guard·잠금 대기 중 늦은 commit·같은 건수 내용 변경·전체 행 추가/삭제/연결 변경 거절·함수 복원 실패 원자성·비공개 파일 조건부 재적용 복원을 검사한다.

기존 basket4.test.mjs 단언을 모두 유지하며, 새 migration → rollback → 이전 함수 전문 일치 확인 **뒤에 기존 4a 동작 전체**를 실행한다. 기존 Google 할 일·회의·자료 행도 실제 PostgreSQL로 보존을 확인한다.

전체 Node·PostgreSQL·브라우저 결과와 **최종 SHA 자동 CI**는 PR의 AGENTS.md 12항목 댓글에 기록한다. App browser E2E workflow paths는 app/p/tests/app-e2e/workflow뿐이므로 이번 DB/문서/PostgreSQL 테스트 변경은 자동 전체 브라우저 대상이 아니다. 로컬 전체 브라우저와 자동 CI를 구분하며 수동 실행/재실행하지 않는다.
