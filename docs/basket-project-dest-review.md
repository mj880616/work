# BASKET-목적지복구 검토 기록

📱 폰 가능 (Codex 웹). 파일·PR 준비. 운영 접속·DB/RLS 변경·Edge 배포·workflow 수동 실행·merge 없음.

## 복구 기준과 합성 데이터

`d85e334`(#491)의 제거 diff에서 시작해 프로젝트 목록·안내·카탈로그 로드를 복구했다. #500의 담당조직 필터와 “담당조직이 지정되지 않아 전체 조직을 싣습니다” 문구를 유지했다. #495 이후 붙여넣기 파서와 #498 이후 한국시간 코드는 그대로다.

기존 `app/project-catalog.js`의 프로젝트 분류·active/archived·tops/kids/tree 함수를 `app/project-catalog-model.mjs`로 추출했다. 화면 카탈로그는 이 기준 모듈을 import하고 서버는 `supabase/functions/drive-summary/project-catalog-model.mjs`의 배포 내부 사본을 import한다. 사본 주석에 화면 파일이 기준임을 적고 본문 전체의 바이트 동일성을 회귀에서 확인한다. 운영 배포는 `supabase/functions`만 격리 복사하므로 Edge의 `app/` 상대 import는 제거했다. 별도 분류 구현이나 상태 저장소를 만들지 않았다. 서버 조회 select·workspace 범위, 화면 카탈로그의 workspace/owner 조건과 소유자 RLS를 유지한다.

프로젝트 분류는 `metadata.project_system=v2` 또는 `Number(metadata.management_version)=2` 및 그 후손이다. 화면 tree에서 보관·보관 상위의 후손·루트 없는 순환 계층을 숨기는 기존 기준을 재사용한다. 바구니 안내만 `done`/`completed` 목적지를 추가 제외한다. 완료 상위 아래 진행 중인 하위는 화면에 보이므로 유지하며 “완료 상위 › 진행 하위”로 구분한다. 비프로젝트 상위 아래 독립 v2 프로젝트는 화면과 같이 루트로 취급한다. 기존 프로젝트 화면은 완료 프로젝트도 표시하므로 그 화면 동작은 변경하지 않았다.

[합성 fixture](../tests/fixtures/basket-project-destinations.json): 공간 **14개 → canonical 프로젝트 13개 → 화면 tree 9개 → 안내 목적지 6개**. 정상 담당조직 **2개**, 담당 0개 대체본은 활성 조직 **3개**. 비활성 조직 제외. 실제 운영 개수는 조회하지 않았다. 부모·자식·손자, management_version 문자열 2, 완료 하위, 완료 상위의 진행 하위, 보관 상위의 숨긴 후손, 독립 v2, 순환 계층을 검증한다. 두 경로의 기준·ID·경로 이름이 같다. 목록 순서는 각 경로의 기존 카탈로그 조회/보고 정렬을 따른다.

합성 전문(개인정보·실제 조직/프로젝트명 없음):

- [Drive 바구니 절](basket-org-only-drive-example.txt)
- [AI에게 맡기기 복사 글](basket-ai-handoff-prompt-example.txt)
- [담당 0개 Drive 대체본](basket-org-mine-drive-fallback.txt)
- [담당 0개 복사 글 대체본](basket-org-mine-handoff-fallback.txt)

담당조직 목록 바로 아래 프로젝트 목록을 제공하며 organization·project 두 kind와 project 예시를 안내한다. 자료실·쓰기요청 후보·Google 할 일은 이번 안내에 포함하지 않고 4b-1~3에서 확정 경로와 함께 준비한다. 기존 파서는 이 kind들을 계속 허용한다.

## 초기 안내 복구 검증

- 시작 clean main: `node --test tests/*.test.mjs tests/security/*.test.mjs` **472/472**.
- 안내 복구 RED: 관련 **57개 중 6개 실패**(프로젝트 목록/안내 제거 재현) → GREEN 및 합성 양경로 검증 **58/58**.
- 전체 Node: `node --test $(rg --files tests scripts -g '*.test.mjs' -g '!tests/auth-handoff/**')` **537/537**.
- 로컬 임시 PostgreSQL: `npm test --prefix tests/auth-handoff` **59/59**. 그중 `basket4.test.mjs` **14/14**: project 확정·중복/동시 확정·소유자 RLS·원문 변경·대상 workspace·invoker 거절의 원자성 확인. 운영 DB 연결 없음.
- 초기 Deno check·lint·bundle **4모듈** 검증은 저장소 전체에서만 실행해 배포 격리와 차이가 있었다. 아래 후속에서 functions-only 실제 구조로 재현·수정·검증했다.
- 상한: 프로젝트 목록을 넣은 메모 100건·UTF-8 정확히 **1048576 bytes**는 허용, 다음 **1 byte**·101건은 `BASKET_OUTPUT_LIMIT`; 경고·last_success 보존 유지. 첨부 링크/원문 보존·개인정보 필드 제외·담당조직 JWT/cron 필터 테스트 유지.
- 캐시 검사 **운영 참조 425개**, index.html까지 갱신. 공백 검사·전체 정적 smoke 블록 통과. 버전 기대 테스트·smoke 문자열 동기화.
- Chromium 151: 390/1280px 신규 복사→project 붙여넣기→확인→연결 **2/2**, 정상 콘솔 오류 **0**, 실제 native clipboard·기존 분류/붙여넣기 회귀 포함 관련 회귀 **48/48**. [390px 연결 캡처](review/basket-project-dest/project-restored-390.png)·[1280px 연결 캡처](review/basket-project-dest/project-restored-1280.png). 전체 결과는 최종 PR 댓글에 기록한다. 지정 Playwright Chromium 다운로드는 환경 네트워크 정책으로 막혀 설치 Chromium을 사용했다. 자동 CI는 지정 Playwright 버전으로 전체 회귀한다.
- 최종 SHA 자동 CI·전체 브라우저 회귀 판정: 최종 PR 댓글에 SHA와 결과를 기록한다. 기존 테스트 삭제·약화 없음.

캐시: model v1 → catalog v3 → home-read v18 / view-loader v127 → loader-v2 v360 → app v248 → index. 바구니는 classification v5 → classification-ui v6 / handoff v5 → basket v12 → 같은 상위 로더. 카탈로그를 ES module로 읽도록 기존 단독 자료실 fixture 2곳과 fixture MIME을 맞췄다. security workflow는 공용 model만 변경해도 회귀하도록 경로 필터를 추가했다.

## AGENTS.md §10 완료보고(12항목)

1. **세션:** Codex 웹.
2. **SHA·branch·PR:** 새 fetch 시작 `7dc60988796e722f326cd3212f88df8629bc3ae3`. branch `codex/basket-project-dest`. [PR #502](https://github.com/mj880616/work/pull/502). 구현 SHA `22dffc416968def2115afa81952d823a58a15505`, 최종 SHA(원장 PR 번호 반영 포함)는 최종 PR 댓글에 기록.
3. **원인:** 사실: #491(`d85e334`)에서 프로젝트 목록·카탈로그 로드·project 안내를 제거. 사용자 정정: “담당조직만”은 다른 조직 제외라는 뜻. 추정 원인 없음.
4. **변경 파일:** 두 안내, 공용 카탈로그 추출·서버 분류 재사용, 캐시 로더·버전 기대/smoke, 회귀·합성 fixture/전문, README·원장·검토 기록. 파서·RPC·4a 동작 변경 없음.
5. **테스트:** 위 검증 결과. 기존 실패/전체 브라우저 결과와 clean main 재현 여부는 최종 PR 댓글에 기록. 회귀 삭제·약화 없음.
6. **CI:** 최종 head의 자동 CI 결과를 확인한 뒤 최종 댓글에 기록. workflow 수동 실행 없음.
7. **DB·production·권한:** DB/RLS 변경·운영 접속·배포 없음. 소유자 RLS·화면 owner/workspace 필터·서버 고정 workspace와 JWT/cron 인증 유지. 아래 배포 순서·되돌리기 참고.
8. **사용자 확인:** merge·재배포 후 복사 글과 Drive 사본에 내 담당조직 + 프로젝트 목록이 함께 나오는지, AI가 프로젝트로 나눈 결과가 붙여넣기→확인→연결되는지 확인.
9. **남은 위험:** 운영은 v5(source `8b91b60`)로 유지된다. merge 후 화면 안내와 재배포된 서버 안내가 함께 반영되어야 한다. 실제 목록/연결은 사용자 확인 대기. 목록 추가로 전체 문서 1 MiB를 넘으면 기존 경고/실패 경로로 처리한다.
10. **범위 밖:** 프로젝트 화면은 완료 항목을 유지하는 현재 구조. 변경하지 않았다. 후속 4b-1~3은 안내 kind와 실제 확정 경로를 함께 준비.
11. **roadmap:** 목적지복구 진행중 행 추가·PR 번호 갱신. 조직만 행 끝에 2026-10-12 사용자 정정. 4b를 4b-1 자료실 / 4b-2 쓰기요청 후보 / 4b-3 Google 할 일(대기)로 분리, 4b-2·3에 안내 kind 추가 포함 명시.
12. **merge:** 미실행. 파일·PR 준비만.

## 2026-10-12 후속: Edge 배포 경로

후속 시작 PR head `ec0aef4da2c0694ce1f20c9cc50eb33de54b200e`, 새 fetch main `7dc60988796e722f326cd3212f88df8629bc3ae3`. 같은 branch·PR #502에서 수정했다. 초기 보고의 “저장소 전체 checkout에서 bundle 성공 = 배포 경로 검증” 판단을 정정한다. 실제 `edge-function-deploy.yml`의 Prepare isolated deployment config는 functions만 복사한다. 기존 코드의 격리 check는 누락된 `app/project-catalog-model.mjs` 때문에 **TS2307 / 종료 1**로 실패했다.

수정은 Edge 내부 사본과 두 import 경로뿐이다. 화면 `app/` 파일·기능·출력·합성 전문 4개·배포 workflow·격리 복사 범위·캐시 버전은 변경하지 않았다. 사본의 기준 주석을 제외한 전체 본문을 화면 기준 파일과 정확히 비교한다. 합성 전문 4개의 생성 결과도 기존 파일과 바이트 단위로 비교한다.

자동 보안 CI에 Deno 2.9.6 설치·격리 테스트·check/bundle 단계와 검사 스크립트/테스트 경로 트리거를 추가했다. 화면 model 트리거는 사본 일치 검증 때문에 유지한다. Deno 의존 테스트는 `tests/edge-isolation/`에 두고 명시 실행한다. 기존 `tests/security/*.test.mjs`를 사용하는 DB 검증 workflow는 수정하지 않았으며 Deno 설치 없이도 사본/전문 비교가 실행된다.

검사 스크립트는 임시 폴더에 functions만 복사(`verbatimSymlinks:true`, 배포 cp -R과 동일한 링크 보존), Deno info 그래프의 로컬 경로·실제 경로가 functions 내부인지 확인한 후 그 안에서 check·bundle한다. Edge handler 실행·운영 요청·배포는 하지 않는다. 외부 static/dynamic 상대 import와 외부 링크는 거절하고 내부 상대 링크는 허용한다.

검증 증거:

- 초기 사본/격리 회귀 **2개 실패** → 신규 회귀 **7/7**. 내부 링크 복사 옵션 차이도 **1개 RED → GREEN**으로 확인했다.
- 실제 `core.mjs`에 `../../../app/project-catalog-model.mjs` import를 의도적으로 다시 넣음 → **종료 1**, `Import outside supabase/functions` → 즉시 원복 → functions-only **check·bundle 성공(4모듈 / 33433 bytes)**. 이 변이 코드는 커밋하지 않는다.
- 사본 본문·합성 전문 4개 동일, 화면 파일·배포 workflow diff 0. 캐시 재증가 없음.
- 후속 전체 Node **544/544**(DENO_BIN 지정), Deno check/lint·functions-only check/bundle 통과. Deno 없이 공통 보안 wildcard **367/367**로 기존 소비자 호환 확인. 관련 Chromium151 **93/93**(390/1280px 정상 콘솔0), 캐시 **425참조**·공백 검사 통과. 최종 SHA 자동 CI/전체 브라우저 결과는 후속 12항목 PR 댓글에 기록한다. 기존 테스트 삭제·약화 없음.

실행: `DENO_BIN=<설치된 deno 경로> node scripts/check-drive-summary-isolation.mjs`. Deno가 PATH에 있으면 환경 변수 없이 실행한다. 전체 Node 실행에도 Deno가 필요하며 CI는 명시 설치한다. 최종 SHA와 배포 입력은 후속 PR 댓글에 기록하고, 배포/merge는 사용자 실행 대기다. 되돌리기 ref는 그대로 `8b91b60`이다.

## 사용자 배포 안내(실행 안 함)

커맨드센터 검토 → 사용자 merge → merge 후 SHA로 사용자 `edge-function-deploy` 수동 실행 → 사용자 `production-edge` 승인 → workflow 검증 → 위 사용자 확인. Edge 배포 직전이 정지 지점이다.

```text
function=drive-summary
ref=<merge 후 SHA>
first_deploy=false
verify_jwt=keep
expect_unauth_401=true
```

운영 기준은 v5, source **8b91b60**(#500). 되돌리기는 같은 함수·같은 옵션으로 **ref=8b91b60**을 사용한다. workflow가 배포 전후 버전 증가·JWT 유지·비로그인 POST401·OPTIONS200/204를 확인한다. AI는 운영 접속·workflow 실행·승인·배포·merge를 하지 않았다.
