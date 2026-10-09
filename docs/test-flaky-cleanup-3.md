# TEST-간헐실패정리 3차

📱 폰 가능 · Codex 클라우드 · 2026-10-09. 기준 origin/main `dae741ea54da871dbf52962e4721f5317bd54cae`(#454), branch `codex/test-flaky-cleanup-3`, [PR #455](https://github.com/mj880616/work/pull/455).

홈·Google 후보와 기존 대기 3개는 지정 main에서 재현되지 않아 수정하지 않았다. 실제 PostgreSQL 반복에서는 20연결 검사 이후 **테스트 정리 단계**의 실패를 재현했고, 연결 종료 완료를 기다린 뒤 임시 클러스터를 중지하도록 고쳤다. 앱 코드 변경 없음. #454에서 처리한 게시판 3개는 제외했다.

## 측정 조건과 결과

최신 원격 main을 fetch해 지정 SHA 일치를 확인했다. 초기 클라우드 checkout `db81bf58`은 사용하지 않고 지정 main에서 새 브랜치를 만들었다. 수정 전 측정을 모두 끝낼 때까지 app·tests·SQL·workflow는 main 원문과 동일했다.

저장소 고정 Playwright `1.55.0`, 설치 Chromium `151.0.7922.173`, Node `24.19.0`, 재시도 0. static server `127.0.0.1:8123`, 기존 fixture 응답만 사용했다. trace·video는 `retain-on-failure`, assertion 기본 5000ms·test 기본 30000ms 및 각 spec의 별도 timeout 원문을 유지했다. browser 배치와 DB 반복은 순서대로 실행했다. CI Chromium140의 실패율로 일반화하지 않는다.

표의 수치는 **실패/실행**이며 timeout도 실패에 포함한다. 홈·Google 7개를 한 배치로 각각 `--repeat-each=20 --workers=1`(140/140 통과, 362.2초)·`--workers=4`(140/140 통과, 196.2초) 실행했다. 대기 3개는 별도 W4 배치 각20회(60/60 통과, 106.5초)다. W1은 이번 요청 대상이 아니다.

DB는 고정 `embedded-postgres`·`@embedded-postgres/linux-x64` `17.6.0-beta.15`, `pg` `8.16.3`·lockfile의 `pg-pool` `3.14.0`으로 `postgres.test.mjs` 전체를 **새 Node 프로세스·새 로컬 임시 클러스터에서 회차마다** 실행했다. Playwright workers와 무관하다. 수정 전 20회(14.315초), 수정 후 같은 조건 50회(36.164초). 진단 복사본의 별도 1회씩은 이 분모에 포함하지 않는다.

| 테스트 이름(원문 main 행) | 수정 전 workers=1 | 수정 전 workers=4 | 원인: 사실 / 추정 | 처리 | 수정 후 같은 조건 50회 |
| --- | --- | --- | --- | --- | --- |
| `organization chips fit, preserve order and non-overlapping targets at 390` (`home-selection-sheet.spec.mjs:14`, 좌표 클릭 `:26`, 표시 검사 `:27`) | 0/20 (0%) | 0/20 (0%) | 사실: 클릭·선택·포커스 검사 모두 통과. 추정: #449의 등장 애니메이션/좌표 관측 경쟁은 이번에 미확정 | 재현 안 됨·미수정 | 미실행(미수정) |
| 같은 테스트 `at 1440` (`:14`) | 0/20 (0%) | 0/20 (0%) | 사실: 기존 순서·크기·비겹침·좌표 클릭 통과. 원인 미확정 | 재현 안 됨·미수정 | 미실행(미수정) |
| `home chips and update rows open the existing detail dialogs` (`home-read.spec.mjs:206`) | 0/20 (0%) | 0/20 (0%) | 사실: 프로젝트·조직 상세 표시 검사 통과. 원인 미확정 | 재현 안 됨·미수정 | 미실행(미수정) |
| `consecutive completions keep independent three second timers` (`google-tasks-toggle.spec.mjs:298`, 즉시 배열 비교 `:303`) | 0/20 (0%) | 0/20 (0%) | 사실: 요청 순서·각 완료 표시·독립 이동 검사 통과. 추정: #449의 비동기 요청 관측 경쟁은 이번에 미확정 | 재현 안 됨·미수정 | 미실행(미수정) |
| `repeated taps save in order and only the last wish` (`:95`) | 0/20 (0%) | 0/20 (0%) | 사실: 응답 gate·최종 저장 순서 검사 통과. 원인 미확정 | 재현 안 됨·미수정 | 미실행(미수정) |
| `three quick taps that end on complete send a single save` (`:118`) | 0/20 (0%) | 0/20 (0%) | 사실: 저장 1건·최종 완료 검사 통과. 원인 미확정 | 재현 안 됨·미수정 | 미실행(미수정) |
| `a list load that answers with the old state does not undo a tap made during it` (`:135`) | 0/20 (0%) | 0/20 (0%) | 사실: 오래된 조회와 저장 순서 검사 통과. 원인 미확정 | 재현 안 됨·미수정 | 미실행(미수정) |
| `20 simultaneous independent handlers/connections: one nonce claim and one Auth refresh` (`postgres.test.mjs:94`), 상위 테스트/정리 포함 | 단독 프로세스: 20연결 검사 0/20 (0%), **파일 전체 1/20 (5%)** | 해당 없음(Node 테스트) | 사실: 13회차의 6개 하위 검사 모두 통과 후 상위 테스트가 관리자 종료 오류로 실패. `pool.end()` 이후 실제 client 종료 전에 cluster stop 시작 | 실제 `end` 이벤트 대기 후 stop. 기존 검사 동일 | **파일 전체 0/50 (0%)**, 20연결 검사도 0/50 |
| `760px enables menu swipes and 761px touch width has no menu or month swipe` (`swipe-nav-follow.spec.mjs:273`) | 이번 요청 대상 아님 | 0/20 (0%) | 사실: 폭 경계·메뉴/월간 밀기 검사 통과. 원인 미확정 | 측정만·미수정 | 이번 요청 대상 아님 |
| `Design System 1.0 keeps 36px top-level actions and the 32px calendar toolbar` (`design-system.spec.mjs:52`) | 이번 요청 대상 아님 | 0/20 (0%) | 사실: 토큰·기존 높이/스타일 검사 통과. 원인 미확정 | 측정만·미수정 | 이번 요청 대상 아님 |
| `direct session owner switch reloads without retaining the previous private DOM` (`public-workspace-auth.spec.mjs:153`) | 이번 요청 대상 아님 | 0/20 (0%) | 사실: 새 소유자·이전 private DOM 제거 검사 통과. 원인 미확정 | 측정만·미수정 | 이번 요청 대상 아님 |

## DB 원인: 사실과 추정

수정 전 13회차에서 20연결 하위 검사는 `20 PostgreSQL backends: nonce successes=1; Auth refresh calls=1; denied=19`를 기록했다. 권한·만료·실패 후 재사용 거부·rollback/reapply를 포함한 6개 하위 검사 모두 통과했고, 마지막 상위 테스트가 `terminating connection due to administrator command`로 실패했다. 이를 20연결 assertion 실패라고 기록하지 않는다.

고정 `pg-pool/index.js:132`의 종료 경로는 idle client를 `_remove()`하고 내부 client 목록이 비면 `pool.end()`를 완료한다. `_remove()`(`:172`)는 목록에서 먼저 제거한 뒤 비동기 `client.end(callback)`을 시작한다. `embedded-postgres/dist/index.js:192`의 `stop()`은 서버에 SIGINT를 보내므로 실제 client 종료보다 stop이 앞설 수 있다.

원본의 외부 진단 복사본에 public `connect`/`end` 이벤트 계수와 “stop 전에 모든 client end 완료” assertion만 추가했다. 검사 6개 통과 뒤 `pool.end()` 직후 **connected=20, ended=0**으로 assertion이 실패했다. 같은 진단에 실제 종료 대기만 반영한 대조는 **connected=20, ended=20**이고 전체 통과했다. 진단은 `/tmp`에만 있으며 앱·SQL·실제 fixture·DB 요청 경로에는 주입하지 않았다.

사실: 이번 1/20 실패는 검사 이후 클러스터 정리와 살아 있는 연결 사이의 경쟁이다. 추정/한계: 과거 main `e22a794` CI의 DB job 실패와 직접 원인이 동일한지는 해당 최초 실패 로그를 대조하지 못해 확정하지 않는다. 연결된 GitHub 도구의 commit workflow 조회는 PR 이벤트만 반환해 main 실행을 제공하지 않았고, 클라우드 `gh api` 조회는 네트워크 정책에서 Forbidden이었다. 이번 재현과 수정 결과를 해당 발견사항의 처리 근거로 기록하며 과거 CI 원인 확정으로 쓰지 않는다.

| 2차 후보 | 이번 검증 | 판단 |
| --- | --- | --- |
| 20개 준비 barrier (`:100`~`:106`) | 수정 전20회·수정 후50회 모두 20개 독립 PID 및 준비 후 단일 소비 검사 통과 | 준비 단계 실패/정체 미재현·barrier 미수정 |
| reset role 실패 시 release 누락 (`:56`, `:110`) | reset role 실패·대여 연결 정체 미재현. 실제 실패는 모든 하위 검사 뒤 stop 시점 | 해당 실패 경로 미수정. 별도로 실제 socket 종료 의존성만 수정 |
| 포트 예약 해제→서버 시작 경쟁 (`:23`~`:29`) | 모든 회차에서 새 cluster 초기화·준비·연결 성공, 포트 충돌/서버 시작 실패 없음 | 포트 경쟁 증거 없음·미수정 |

## 변경 줄과 검사 보존

`tests/auth-handoff/postgres.test.mjs`만 수정했다(최종 파일 행):

- `:33`: 실제 client의 종료 Promise 배열.
- `:38`: pool의 public `connect` 이벤트에서 각 client의 public `end` 이벤트를 등록.
- `:160`~`:165`: `pool.end()` 뒤 모든 실제 `end` 이벤트를 기다리고, 그 다음 기존 `cluster.stop()` 실행.

원본 `assert.*` 전체, 하위 테스트 이름, 20개 PID·nonce 성공1·Auth refresh1·거부19·후속 재사용 거부, 권한/RLS·rollback/reapply, 20개 준비 barrier는 그대로다. 90초 상위 timeout·5000ms 연결 timeout·pool max24·새 임시 포트/cluster·fixture·API 지연값·재시도·검사/skip도 그대로다. 고정 sleep 추가나 오류 무시는 없다. 실제 연결 종료 완료라는 의존성에 맞춘 **테스트 정리** 변경이며 검사를 약화하지 않았다.

홈·Google·대기 spec 변경 줄 없음. 앱·캐시 버전·SQL·RLS·Edge·production 변경 없음. 수정한 테스트 파일은 앱 로더가 불러오지 않으므로 올릴 캐시 버전이 없다.

## 검증과 남은 위험

- 수정 후 DB 파일 전체 같은 조건 50회: 0/50 실패, 매회 20 backend·nonce 성공1·Auth refresh1·거부19 확인.
- 외부 종료 진단: 원본 0/20 종료로 실패 → 수정 20/20 종료로 통과. 반복 실패율 분모와 별도.
- `node --test tests/security/*.test.mjs tests/domain/*.test.mjs tests/*.test.mjs scripts/check-loader-cache.test.mjs`: 335/335 통과.
- `npm test --prefix tests/auth-handoff`: 29/29 통과(인접 로컬 DB 검사 포함).
- app smoke workflow의 정적·구조·HTTP 19단계 모두 통과. HTTP는 이미 실행 중인 로컬 서버를 재사용했다.
- 대상 6개 spec 파일 전체 W4: **68/69 통과·1/69 실패**(74.4초). 요청된 반복 대상은 모두 통과했다. 실패한 별도 `Android Calendar OAuth return is handed to the native app before auth gating`(`public-workspace-auth.spec.mjs:281`, 검사 `:284`)는 native scheme 자동 이동 후 `chrome-error://chromewebdata/`와 “This page is blocked / Your organization doesn’t allow you to view this site”를 표시했다. 기존 검사/앱 코드는 변경하지 않았다. 지정 clean main의 해당 검사 단독 W1 각3회 대조는 **0/3 실패**였다(3.8초). 따라서 지정 main에서 항상 실패한다고 쓰지 않는다. 사실: `calendar-return-bridge.js:17`은 native URI로 150ms 뒤 자동 이동한다. 추정: W4의 assertion 관측이 이 이동보다 늦어졌을 가능성이 있으며 OS/클라우드 protocol 처리와의 정확한 관계는 미확정이다. 같은 W4 조건으로 6개 파일 전체를 다시 실행해도 **68/69 통과·같은 검사 1/69 실패**였다(73.9초). 두 실행 모두 요청된 반복 대상은 통과했고 별도 Android 검사만 실패했다. 앱 결함으로 확정할 근거는 없고, 이번 대상 밖 검사이므로 수정하지 않았다. 파일 전체 무실패로 보고하지 않는다.

홈·Google의 CI 최초 실패 원인은 미확정이다. 이번 각40회 무실패는 향후 실패율 0을 보장하지 않는다. DB 준비 단계 연결 실패 때 barrier 정체/reset role 정리 문제와 포트 경쟁은 이번에 재현되지 않았다. 다른 DB 테스트 파일의 정리 코드는 이번 범위에서 고치지 않았다. 실기기·CI Chromium140에서의 동작을 설치 Chromium151 측정으로 대신하지 않는다.

작업 증거는 `/tmp/test-flaky-cleanup-3/`의 `main-w1.json`·`main-w4.json`·`pending-w4.json`, `db-main.json`·`db-main-13.log`, `db-fixed.json`, 종료 진단 원본/수정 로그, `target-specs.json`·`target-specs-confirm.json`·`native-main.json`, 정적·Node 로그에 있다. 임시 파일은 환경 종료 뒤 보존되지 않을 수 있어 핵심 수치·실패 상태·원인·명령을 이 문서에 남긴다. 전체 저장소 E2E·production 접근은 실행하지 않았다. merge 금지.

PR #455의 최초 head `1046997d653adbbae1b11ccf981293fdc3a4c2f2`에서 Authorization security(DB·정적 권한)·Browser storage audit·Loader cache·Web1 dropzone의 4개 자동 PR workflow가 모두 success였다. 마지막 PR 번호·원장 상태 반영 후 **최종 head CI는 PR 본문에서 별도로 확인**한다. 앱 E2E workflow는 이번 변경 경로(docs·auth-handoff test)에 해당하지 않아 실행 대상이 아니며, 위 로컬 파일 전체 실패를 PR CI 통과로 해소됐다고 쓰지 않는다.

## 재실행 명령

저장소 루트에서 고정 Playwright를 `npm install --no-save --package-lock=false @playwright/test@1.55.0`으로 설치하고, video용 ffmpeg 경로를 설치 `/usr/bin/ffmpeg`에 연결했다. 임시 설정은 checkout 밖에 둔다.

```js
// /tmp/test-flaky-cleanup-3/playwright.config.cjs
module.exports = {
  testDir: '/workspace/work/tests/app-e2e', retries: 0,
  use: {
    browserName: 'chromium', launchOptions: {executablePath: '/usr/bin/chromium'},
    trace: 'retain-on-failure', video: 'retain-on-failure',
  },
  reporter: [['line'], ['json', {outputFile: process.env.FLAKY_JSON}]],
};
```

```sh
FLAKY_JSON=/tmp/test-flaky-cleanup-3/main-w1.json npx playwright test \
  --config=/tmp/test-flaky-cleanup-3/playwright.config.cjs \
  home-selection-sheet.spec.mjs home-read.spec.mjs google-tasks-toggle.spec.mjs \
  --grep 'organization chips fit|home chips and update rows|repeated taps save in order|three quick taps that end|a list load that answers|consecutive completions keep' \
  --workers=1 --repeat-each=20 --output=/tmp/test-flaky-cleanup-3/main-w1
# W4는 --workers=4로, JSON/output은 main-w4로 변경한다.
FLAKY_JSON=/tmp/test-flaky-cleanup-3/pending-w4.json npx playwright test \
  --config=/tmp/test-flaky-cleanup-3/playwright.config.cjs \
  swipe-nav-follow.spec.mjs design-system.spec.mjs public-workspace-auth.spec.mjs \
  --grep '760px enables menu swipes|Design System 1.0 keeps|direct session owner switch reloads' \
  --workers=4 --repeat-each=20 --output=/tmp/test-flaky-cleanup-3/pending-w4
npm ci --prefix tests/auth-handoff --no-audit --no-fund
# 각 회차 별도 프로세스. main 원본20회, 수정본50회. 재시도 아님.
for n in $(seq 1 20); do
  node --test tests/auth-handoff/postgres.test.mjs > "/tmp/db-main-$n.log" 2>&1
  result=$?
  printf '%s %s\n' "$n" "$result"
done
```
