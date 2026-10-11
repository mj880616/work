# 📱 폰 가능 — BASKET-4a 검토 기록 (파일·PR만)

Codex 웹. [PR #488](https://github.com/mj880616/work/pull/488), branch `codex/basket-4a`. 새로 fetch한 `origin/main` 시작 SHA는 `a9fb21ecc1dbddd0b0e78191e57f3474b9311ee0`(#487 merge)다. checkout은 깨끗했고 로컬·원격에 `codex/basket-4a`가 없어 이 SHA에서 새 브랜치를 만들었다. 기존 브랜치의 독자 커밋이나 미커밋 변경을 덮어쓰지 않았다.

바구니의 **분류안 붙여넣기 → 현재값 미리보기 → 체크한 조직·프로젝트만 확정**을 추가한다. 제안은 화면 메모리에만 두고 입력 변경 때 선택을 무효화한다. owner/workspace 변경 때 원문·제안·선택을 지우며 늦게 도착한 응답을 버린다. 자료실·Google 할 일·쓰기요청 후보는 **다음 단계에서 지원(4b)**으로 표시하고 선택할 수 없다. 요약 채택·진행기록 쓰기·조직 기록 이관·suggested 저장·자동 확정은 하지 않는다.

## 형식과 검증 경계

사본의 실제 `schema_version=1`, `copied_at`, `items[note_id,note_updated_at,destinations[kind,target_id,reason]]`를 사용한다. 단일 JSON 코드블록 포장을 허용하며 설명 글은 원문 행·열 위치로 거절한다. UTF-8 1 MiB(포장 포함), 메모 100건, 메모당 목적지 20개, 중첩 6단계, 문자열 2,000자(이유 1~2,000자)를 적용한다. 알 수 없는 키·kind, 중복 JSON 키(Unicode escape로 같은 키를 쓴 경우 포함), 중복 메모 ID, 잘못된 UUID·달력 날짜·시간대, NUL·잘못된 Unicode를 거절한다. 시각은 시간대가 있는 RFC3339, 소수초 0~6자리이며 같은 순간을 마이크로초까지 비교한다. UUID는 표준 하이픈 형식만 받아 소문자로 정규화한다. 4b 후보에는 `target_id` 생략/null을 허용하며, 있다면 최대 255자의 ID만 표시한다. 원장 후보에 가짜 UUID를 요구하지 않는다.

**정확한 경계:** RPC의 고정 인자는 `uuid`, `timestamptz`, `jsonb`다. PostgreSQL/PostgREST는 함수 호출 전에 JSONB 중복 키를 제거하고 날짜·UUID를 typed 값으로 변환한다. 따라서 함수 안에서 원래의 중복 키·날짜 문자열 표기·전체 붙여넣기 envelope를 다시 검사할 수는 없다. 브라우저가 이 원문 형식을 엄격히 검사하고, DB 함수는 별도로 전달된 대상 배열의 타입·키·UUID·크기·개수·이유 길이와 현재 원문/권한/목적지 조건을 검사한다. RPC는 브라우저 검사를 권한 근거로 삼지 않는다. malformed typed UUID/date/JSON은 DB 함수에 들어오기 전 REST/DB에서 거절된다. 직접 RPC에서의 중복 JSON 키 탐지까지 요구하면 별도의 raw text 인자가 필요하며 이번 지정 서명에는 추가하지 않았다.

미리보기는 RLS로 읽을 수 있는 현재 DB 원문·이름을 사용한다. 없는/접근 불가 메모, 다른 업무 공간, 보관, AI 제외, 원문 시각 불일치, 없는/다른 공간/선택 불가 목적지, 같은 확정 연결을 각각 표시하고 선택을 막는다. HTML·URL이 들어간 이유는 일반 글로만 표시한다. 프로젝트는 기존 카탈로그의 사용자 소유·같은 workspace·v2/하위 프로젝트·보관 상위 제외 규칙을 따른다. 카탈로그에서 제외되는 일반 작업공간이나 다른 사용자 소유 부모는 독립 v2 프로젝트를 숨기지 않는다.

## DB 파일과 정지 지점

Migration version **`20261011180000`**, name **`basket4a_confirm_links`**.

무엇이 바뀌나: 체크한 바구니 메모를 조직·프로젝트에 연결하는 확정 기능을 추가합니다. 원문은 바꾸지 않습니다.
잘못되면: 연결 확정이 거절되거나 잘못된 연결이 생길 수 있습니다. 기존 글과 첨부는 유지됩니다.
되돌리는 법: 이번 확정 함수만 삭제합니다. 이미 확정한 연결은 남으며 필요하면 사용자가 따로 검토합니다.

함수 `public.app_basket_confirm_links(uuid,timestamptz,jsonb)`는 **명시적 SECURITY INVOKER · plpgsql · SET search_path = ''**다. 같은 파일에서 정확한 서명에 PUBLIC·anon REVOKE ALL 후 authenticated에만 GRANT EXECUTE한다. 기존 표·RLS·표 권한은 변경하지 않는다. 메모를 FOR UPDATE로 잠근 뒤 수정 시각·보관·AI 제외를 확인한다. 모든 목적지와 카탈로그 상위를 FOR SHARE로 잠그고 같은 workspace·사용자 소유·선택 가능 여부를 검사한 뒤 confirmed 연결만 삽입한다. 조직은 report_kind=organization, 프로젝트는 business. workspace/status/owner를 클라이언트에서 받지 않으며 이유·원문 사본도 저장하지 않는다.

잘못된 대상 하나라도 있으면 해당 메모 전체를 거절한다. 기존 confirmed는 건너뛰고 재누름·동시 확정은 unique 제약으로 중복되지 않는다. 예전 suggested 연결과 충돌하면 이를 승격하거나 덮어쓰지 않고 `SUGGESTED_EXISTS`로 거절한다. 중간 INSERT가 기존 invoker RLS에 거절되면 같은 메모의 앞선 INSERT도 모두 되돌리고 사유를 반환한다. 메모별 성공/이미 있음/거부 사유를 화면에 표시하며 네트워크 결과 불명은 자동 재시도하지 않는다.

함수가 미적용 상태(404·함수 없음)면 **확정 기능 준비 중**을 표시한다. 기존 메모 읽기·편집·첨부·보관은 계속 작동한다. 성공한 RPC는 기존 `kptu:api-saved` 알림으로 drive-summary 갱신을 요청한다. 요청에는 새 범위/본문을 보내지 않고 서버의 기존 범위 결정을 유지한다. 확정한 연결을 목록에 표시하며 미분류에서 제거하고 현재 목록을 다시 읽는다.

승인용 파일:

- [migration 원문](../supabase/migrations/20261011180000_basket4a_confirm_links.sql)
- [일상어 3줄](20261011180000_basket4a_confirm_links.summary.md)
- [precheck — item/value](20261011180000_basket4a_confirm_links.precheck.sql)
- [snapshot — 행 수·RLS/권한·함수](20261011180000_basket4a_confirm_links.snapshot.sql)
- [postcheck — 함수·invoker·search_path·PUBLIC/anon/authenticated·기록, 예/아니오](20261011180000_basket4a_confirm_links.postcheck.sql)
- [rollback — 정확한 짝 함수 DROP와 migration 1행 delete](20261011180000_basket4a_confirm_links.rollback.sql)

운영 접속·DB 적용·Edge 배포·workflow 실행·environment 승인·merge 없음. 추후 커맨드센터 검토 → 사용자 사전 확인/snapshot → 사용자 승인 버튼 dry-run → 결과 확인 → apply → postcheck 순서이며 **운영 적용 직전 정지**한다. rollback은 이번 함수만 삭제하고 확정 연결·원문을 유지한다. 함수 전용 plan은 “대상 public 표 없음”이며 기존 링크의 자동 복구나 삭제를 뜻하지 않는다.

## 검증

- Node 전체: `node --test tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs` — 494/494.
- 로컬 임시 PostgreSQL 전체: `cd tests/auth-handoff && npm test` — 59/59. BASKET-4a 14개 포함. 실제 note row lock 대기 뒤 오래된 시각 거절, restrictive RLS에서 두 번째 INSERT 거절 시 첫 연결 rollback, 타인/다른 workspace 거부, 반복/동시 확정, 원문 전체 행 동일, 정확한 DROP·재적용을 확인했다.
- 기존 `db-migration-phase2`·`db-function-allow` 유지. 실제 파일로 승인 버튼 `prepareMigration` apply/dry-run/rollback plan 모두 통과. 로컬 dry-run으로 함수·migration 기록이 남지 않는 것과 적용 후 사후 검사 전부 “예”를 확인했다.
- 기존 plan 검사가 SELECT FOR UPDATE를 수정문으로 오인했다. 바로 앞 FOR가 있는 UPDATE만 행 잠금으로 구별하는 최소 수정과 회귀 테스트를 추가했다. 뒤에 실제 UPDATE/DELETE가 오면 각각 자신의 WHERE를 요구하는 기존 검사는 유지한다.
- 설치된 `/usr/bin/chromium`, Playwright 1.55.0, 390/1280px. 바구니/첨부/Drive 사본과 버전 기대값을 포함한 관련 회귀 136/136. 마지막 화면 수정·추가 지연응답/터치 테스트 7/7도 별도 통과했다.
- 정상/성공 흐름의 콘솔 오류·pageerror 0. 함수 없음 테스트는 404를 명시적으로 주입하므로 Chromium 자체 네트워크 콘솔 메시지 1개가 생긴다. 이를 숨기지 않고 정확히 예상한 404 한 개인지 검증한다. 앱 예외나 다른 콘솔 오류는 없다.
- app JS 구문·`git diff --check`·actionlint·저장소 감사·재귀 캐시 검사 통과. 자동 CI 감사가 새 테스트의 직접 저장소 조회를 잡아 기존 바구니 테스트의 CDP 읽기 방식으로 바꿨고, 감사 허용 목록은 넓히지 않았다. 캐시: basket.js 6, basket.css 4, 새 분류 모듈 1, drive-summary.js 5 → view-loader.js 118 → loader-v2.js 351 → app.js 239/index.html. 고정 버전 기대 테스트와 app-smoke-check.yml도 같은 PR에서 변경한다.
- 독립 리뷰 후 소유 프로젝트 필터·보관된 일반 부모·metadata 버전 문자열을 수정했다. 재리뷰 중요 지적 없음. 기존 테스트 삭제·약화 없음.

CI 결과·최종 SHA·PR 번호는 PR과 채팅 완료 보고에서 기록한다. 원장 BASKET-4를 4a 진행중/4b 대기로 분리하고 OPS-DB함수허용은 #487 merge 완료로 정리한다.

## 화면 캡처

합성 데이터·로컬 모의 API로 촬영했다. 운영 화면·실제 폰 확인은 하지 않았다.

| 화면 | 390px | 1280px |
| --- | --- | --- |
| 붙여넣기 | [캡처](review/basket-4a/paste-390.png) | [캡처](review/basket-4a/paste-1280.png) |
| 원문 바뀜 오류·선택 불가 | [캡처](review/basket-4a/preview-error-390.png) | [캡처](review/basket-4a/preview-error-1280.png) |
| 확정 후 목록 | [캡처](review/basket-4a/confirmed-390.png) | [캡처](review/basket-4a/confirmed-1280.png) |
