# DRV-요약 PR 1 · drive-summary

코드·테스트만. 배포·DB 쓰기·migration 없음. `app/**`, `.github/**`, 기존 함수 변경 없음. 새 앱 연결은 PR 2, 하루 1번 GitHub 예약 실행은 PR 3이다. Drive 장기기억 원장에 쓰지 않는다.

## 호출과 인증

- `POST /functions/v1/drive-summary`, 요청 본문·클라이언트 workspace/Drive ID는 사용하지 않는다.
- 사용자: `Authorization: Bearer <사용자 JWT>`를 `/auth/v1/user`로 검증한 뒤 서버가 slug `kptu-work`를 찾고 해당 작업공간의 `app_workspace_members.role = owner`만 허용한다. admin 등 다른 역할은 403, 비로그인은 401이다.
- 예약: `x-drive-summary-cron-secret` 헤더를 `DRIVE_SUMMARY_CRON_SECRET`과 SHA-256 고정 길이 버퍼 전체 XOR 비교한다. 미설정·빈값·틀린 값은 401이다. 헤더를 보내면 예약 경로만 검증하므로 잘못된 비밀값에서 JWT 경로로 fallback하지 않는다.
- `verify_jwt=false`: Supabase gateway가 JWT 없는 예약 요청을 함수 도달 전에 차단하지 않도록 한다. 함수 자체의 두 인증 경로는 항상 적용한다. OPTIONS는 데이터 접근 없는 CORS preflight이며 GET 등은 405다.
- 응답은 `ok`, `updated_at`(두 문서 상단과 같은 UTC ISO 시각), `documents.org/project` 링크만 제공한다. 실패는 안전한 단계 코드, `attempted_at`, `failure_recorded`, 이미 갱신한 문서 링크를 제공한다. 본문·외부 오류 원문·토큰은 반환하거나 기록하지 않는다.

## 읽기·문서 규칙

- 기간은 호출 시점 한국 날짜의 자정에서 28일을 뺀 시점부터 호출 시점까지다. 조직 `occurred_at`, 회의 `meeting_at`은 양 끝 포함, 진행 기록의 날짜 `effective_on`은 시작 날짜부터 오늘까지다. 주요 일정은 시작 경계 이후의 지난 일정과 모든 다가오는 일정이며 날짜 미정 일정은 제외한다. D-day는 한국 날짜 차이다.
- DB는 GET만 사용하고 `kptu-work`를 기준으로 범위를 제한한다. 작업공간 열이 없는 조직 기록·프로젝트 세부 표는 FK 명시 `!inner` 관계와 연결된 작업공간 조건으로 제한한다. 페이지별 안정된 정렬로 전체 행을 읽고 상한 초과는 실패한다.
- 조직은 앱의 13개 정의 및 미등록 이름 가나다순과 일치하는 테스트를 둔다. 현재 요약은 `recent_month_summary`다. `year_summary`·연혁·메모는 읽지 않는다.
- 프로젝트는 `app/project-catalog.js`와 같은 v2/management_version=2 및 하위 프로젝트 규칙으로 분류한다. 메타데이터는 분류용 두 scalar 키만 조회한다. 진행 기록은 summary/status_label/next_step, 단계는 workstream의 phase다. 미완료 할 일 수는 Google에 재조회하지 않은 `app_record_links`의 confirmed/미완료 상태 사본 기준이다. 자료는 개수만 제공한다.
- 회의는 이름·일시·회차·연결 프로젝트 이름만 포함한다. transcript_text·notes·decisions는 조회하지 않는다. 할 일 본문·자료 원문·메모·연혁도 조회하지 않는다.
- 기존 `public_policy_drive_config`의 Google 갱신 토큰을 쓴다. 새 OAuth 권한·scope 요청·토큰 저장을 추가하지 않는다. 기존 연결의 `drive.file`로 이 앱이 만든 파일만 다룬다.
- 내 Drive 최상위의 “Web2 읽기용 사본” 폴더와 Google 문서 2개는 `appProperties.kptu_summary=folder/org/project`, `kptu_workspace=kptu-work`로 찾는다. 문서는 그 폴더 안으로 제한한다. 중복 표시는 자동 선택하지 않고 실패한다. ID는 DB에 저장하지 않는다. HTML multipart를 Google 문서 MIME으로 생성하거나 같은 ID에 PATCH해 전체 내용을 교체한다.
- `permissions.create` 등 공유 생성·변경 호출은 없다. 폴더·기존 문서의 permissions를 읽고 anyone/domain이 있으면 내용 갱신을 거절한다. 업로드 직후와 완료 전에도 검사한다. 사용자의 개별 직접 공유를 변경하지 않는다. Drive UI의 “공유 → 일반 액세스: 제한됨”으로 폴더·두 문서를 확인하고, 로컬 사후 확인 시 permissions 목록에 anyone/domain이 없는지 재확인한다.
- 폴더 appProperties의 `last_success_at`은 두 문서 갱신·공유 검사 후에만 기록한다. 실패는 `last_failure_at`, `last_failure_summary`(안전한 단계 코드)에 기록하며 이전 성공/실패와 다른 속성은 보존한다. Drive 인증·발견 실패나 Drive 장애로 폴더 기록도 불가능하면 `failure_recorded=false`다. 두 문서 교체는 원자적이지 않아 부분 성공이 가능하지만 Web2 원본에는 영향이 없다.

## 검증

`node --test tests/security/drive-summary.test.mjs`

환경에서 파일 단위로만 출력되면 `node --test --test-isolation=none tests/security/drive-summary.test.mjs`로 개별 결과를 확인한다. HTTP는 전부 모의 응답이며 실제 Supabase·Google·production에 접근하지 않는다. 기존 Authorization security check의 `tests/security/*.test.mjs`에 자동 포함된다.

## 배포 계획 (실행 금지, Claude Code 로컬에서 별도 승인 후)

- 함수: `drive-summary`, `verify_jwt=false`.
- 기존 런타임 이름: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Google 연결 설정은 기존 DB 설정만 쓴다.
- 신규 비밀값 이름: `DRIVE_SUMMARY_CRON_SECRET` (PR 3 예약 호출 전에 필요). 미설정 상태에서도 소유자 JWT 경로는 가능하다. 값은 이 PR이나 웹 환경에 넣지 않는다.
- 사전 확인: 최신 main과 이 PR의 문서 충돌, 현재 함수 목록, 기존 Google `drive.file` 연결, FK/열/권한을 Claude Code 로컬의 읽기 전용 절차로 확인한다. 실제 API의 HTML→Google Docs 생성·같은 ID 전체 교체는 웹 모의 테스트로 입증하지 못한다.
- 명령안: `npx.cmd supabase functions deploy drive-summary --project-ref <ref> --no-verify-jwt --use-api`. 이 웹 작업에서 실행하지 않는다.
- 사후 확인: 비로그인 POST 401, 비소유자/틀린 비밀값 거절, 소유자 호출 1회로 폴더·문서 2개 및 상단 시각 확인, 재호출 시 같은 문서 ID와 전체 교체 확인, 폴더·두 문서의 공개 공유 없음 확인. 예약 비밀값 설정 뒤 올바른 예약 경로도 확인한다.
- 복구: Claude Code 로컬 별도 승인 후 대상 함수만 비활성화/삭제한다. 삭제 명령안은 `npx.cmd supabase functions delete drive-summary --project-ref <ref>`이다. 만들어진 읽기용 문서는 사용자가 Drive에서 삭제한다. DB 복구는 필요 없다.
- 남은 위험: 여러 호출이 동시에 최초 생성/교체하면 중복 파일 또는 오래된 사본으로 덮어쓰기가 가능하다. DB lock/write는 이 PR에서 금지되어 추가하지 않았다. PR 2 호출 몰아주기와 PR 3 실행 겹침 방지로 줄이고, 표시 중복은 이 함수가 실패로 보고한다. Drive 공유 변경과 읽기 검사 사이에도 외부 변경 경합은 가능하다.
