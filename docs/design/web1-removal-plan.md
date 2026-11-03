# Web1 삭제 준비 계획 (WEB1-페이지삭제, 실제 삭제 안 함)

- 원장 행: WEB1-페이지삭제(대기, 맨 마지막). 요청함 2026-10-28 01:08 "주소 이전 ④ — Web1 삭제". 겹치는 행: PRESS-Web1삭제, PRESS-자료실편입, Web1-3, SEC-공개연락처, OPS-자동머지설정.
- 바탕 설계: `docs/design/domain-move.md` 4절(E1→E2→D1→V1→C1). 이 문서는 그 4절을 **2026-11-03 main 기준으로 다시 전수 조사해 보탠 실행 목록**이다. 4절과 다른 점은 0절에 모았다.
- 이 PR에서는 파일·Worker·Edge·DB를 하나도 바꾸지 않는다. **지울 목록은 명진이 보고 정한다**(PR 질문 참고).
- 바뀌지 않는 것: DB 데이터(Web1 표·`app_public_post` 등)는 지우지 않는다. 저장소 지난 기록도 지우지 않는다(공개 저장소라 기록은 남음).

## 0. 설계(domain-move.md 4절)와 달라진 점

1. **E2는 끝났다**(#1545). 4.2절에 적힌 Web2 빌려 쓰기 파일(`app/web1-board.*`, `web1-page-capabilities.js`, `web1-admin-auth.js`, `public-page-editor.js`, `forum-flow-polish.*`, `legacy/editable-page.js`)은 이미 없고, `app-smoke-check.yml`·`tests/app-e2e/page-core-structure.spec.mjs`가 다시 생기지 않게 지킨다. 지금 Web2 화면 코드가 Web1 파일을 실행 중에 읽는 곳은 없다(`../`·`/work/` 중 `/work/app/` 밖·`work.bokdoong.com` 전수 확인).
2. 거꾸로 **Web1이 Web2 파일을 빌려 쓰는 곳**이 설계에 빠져 있었다(1-나). 이 가운데 `app/page-design-core.js`는 Web1(`p/`)만 쓰므로 Web1과 함께 지울 후보다.
3. 4.4절의 `wedding/`, 4.3절의 `analysis/`, 루트 `404.html`·`CNAME`·`robots.txt`·`sitemap.xml`은 저장소에 없다(D1에서 `404.html`은 새로 만든다).
4. 4.4절 "work에서 `/work/share/` 밖은 모두 안내 한 줄"은 그대로 하면 깨진다. **막으면 안 되는 경로**: `/work/share/**`, `/work/about/**`(구글 로그인 동의 화면·`app/login` 링크), `/work/favicon.svg`(share가 씀), `/work/app/**`(bokdoong.com 넘김), `/work/personal/**`(포털 아이콘·아스날, 각자 C1·DOMAIN-아스날주소 몫).
5. Worker 배포 확인(`cloudflare-worker-deploy.yml`)이 Web1 파일 두 곳을 직접 확인한다(3-가). 파일을 지우는 PR과 같은 PR에서 확인 목록을 고치지 않으면 다음 Worker 배포가 실패한다.

## 1. 빌려 쓰는 경로 (지우기 전 이전·정리 목록)

### 가. Web2(`app/`) → Web1: 실행 중 의존 없음

| 곳 | 무엇 | 할 일 |
| --- | --- | --- |
| `app/login/index.html` | `work.bokdoong.com/work/about/` 링크 | 없음(about는 남김) |
| `app/share-pages-model.mjs`, `app/share-html-model.mjs` | 공유 주소(`/work/share/`, `bokdoong.com/s/`) | 없음(share는 남김) |
| `app/origin-redirect.js` | github.io → bokdoong.com 넘김(주석에 Web1 언급) | 없음 |
| `app/project-system-v3.js` | `metadata.web1_trial_import` 거르기(데이터 흔적) | 없음(파일 의존 아님) |

→ **이전이 필요한 Web2 코드 변경은 없다.** 그래서 이 PR에는 코드 변경을 넣지 않았다.

### 나. Web1 → Web2 (지우면 고아·정리 대상)

| Web1 파일 | 빌려 쓰는 Web2 파일 | C1에서 |
| --- | --- | --- |
| `p/index.html`, `p/*/index.html` 6개 | `app/page-design-core.js` | Web2는 이 파일을 쓰지 않음 → `p/`와 함께 삭제 후보. 이 이름을 적은 시험 4곳 정리(`tests/img-slot.test.mjs`, `tests/hardcoded-colors.mjs`·`.test.mjs`, `tests/app-e2e/startup-performance.spec.mjs`) |
| `private-rail/forum-0929/index.html`(`state.js`) | `app/runtime-client.js` | 없음(Web2 핵심 파일, 남김) |
| `public-policy/index.html`, `workspace/index.html` | `app/` 링크 | 없음 |

### 다. share/ → app·루트 (남김, D1 안내 한 줄에서 빼야 함)

- `share/index.html` → `../favicon.svg`, `../app/theme-tokens.css`, `../app/sr-blocks.css`, `../app/ed-doc.css`, og 그림 `/work/app/icons/app-icon-512.png`.
- `share/share.js` → `../app/sr-render.mjs`.

### 라. Edge 함수·RPC

| 함수·RPC | 부르는 곳 | C1에서 |
| --- | --- | --- |
| `public-policy-drive` | **Web2**(`app/gdrive-photos.js`, `document-delete.js`, `library-upload.js`), Google 연결 돌아오는 주소(`google-tasks`, `google-calendar`) | **남김** |
| `public-page-edit` | 부르는 화면 없음(#1545) | 삭제 후보(대시보드 삭제는 명진). 소스를 읽는 시험 정리 |
| `pc0921-board` | `2in1/`, `sanbyeol/`, `private-rail/page.html`·`org.html`, `workforce/joint-struggle-0921/`·`press-conference-0914/policy-demand/`, `p/gimpo-publicization-press-1008/`, `assets/rich-copy.js`, `assets/private-rail-question-tools.js` | 페이지 삭제 뒤 함수 삭제 후보 |
| `pc0914-checklist` | `workforce/press-conference-0914/` | 같음 |
| 저장소에 소스 없는 함수: `joint-struggle-files`, `rail-declaration-content`, `rail-declaration-comments`, `rail-1007-plan`, `press-conference-files` | `workforce/joint-struggle-0921/`, `rail-council/*`, `assets/rail-1007-controls.js`, `assets/press-0914-tools.js` | 같음(되돌리기 원본이 없으므로 명진 결정 필요, 질문 Q4) |
| 부르는 곳 없는 함수: `wedding-mc-shared`, `kptu-board-probe`, `rail-1007-page`, `rail-1007-page-v2`, `pc0914-storage-test`, `pc-file-test` | 없음 | 삭제 후보 |
| `app_public_post` RPC | `p/public-post.js`, `p/*/index.html`, `public-policy/index.html`, `scripts/generate-public-pages.mjs` | 함수·데이터는 **남김**(DB 변경 없음). 실행 권한 회수는 따로 결정(Web1-3 행) |
| `main_project_archive_state`(REST 읽기) | 루트 `index.html` | 표는 남김 |
| `_shared/web-cors.ts` `WEB2_ORIGINS`의 `work.bokdoong.com`·github.io | Web2·share | C1 뒤 따로 판단(share가 `work.bokdoong.com`에서 `share-page-read`를 부름 → **줄이지 않음** 추천) |

## 2. 지울 파일·경로 목록 (명진 결정 대기)

### 2-1. 지우는 것 (추천)

| 경로 | 무엇 |
| --- | --- |
| 루트 `index.html` | Web1 첫 페이지 |
| `press/` | 성명·보도자료 47개 폴더 + `archive.json`·목록·`statement-checklist/` (**E1 대조 먼저**) |
| `2in1/` | 위험업무 2인1조 사업 현황·현장증언 모집 |
| `workforce/` | 공공기관 인력확충(기자회견·공동투쟁·제안서) |
| `rail-council/` | 궤도협의회(수련회 선언문·10/07 대의원) |
| `private-rail/` | 민자철도 사업 현황·질의·토론회 |
| `p/` | 공개 게시글 셸 + 글 6개 + 내린 글 1개 |
| `s/` | 옛 공유 넘김(이미 죽은 경로) |
| `public-policy/` | 옛 공개 자료실 목록 |
| `sanbyeol/` | 산별전환 업무 현황 |
| `review/` | 9.14 기자회견 기사 검토본 |
| `workspace/` | 옛 '공공기관사업팀 Workspace' 소개·처리방침 |
| `assets/` | Web1 전용 공용 파일(CSS·JS·로고·OG 그림, 시험용 찌꺼기 포함). Web2·share·about는 쓰지 않음 |
| `app/page-design-core.js` | Web1(`p/`)만 쓰던 Web2 폴더 안 파일 |

### 2-2. 남기는 것

`app/`, `share/`, 루트 `favicon.svg`, `about/`, `personal/`(포털 아이콘·아스날 — 각자 다른 행), `cloudflare/`, `supabase/`, `scripts/`·`tests/` 중 Web2용, `docs/`, `android-app/`, `windows-app/`, `basket-pc/`, `_config.yml`, `AGENTS.md`·`CLAUDE.md`·`README.md`.

## 3. 관문·CI 정리

### 가. 지우기 전에 먼저 (그대로 두면 실패)

| 곳 | 왜 | 고칠 것 |
| --- | --- | --- |
| GitHub ruleset `main-protect` 필수 검사 `publication-gate`·`dropzone` | workflow를 지우면 모든 PR이 영원히 대기 | **workflow 삭제 PR merge 전** 필수 검사에서 두 이름을 뺀다(GitHub 화면, `docs/sec-publication-auto-merge.md`). 명진 화면 일 또는 CC가 브라우저로 |
| `cloudflare-worker-deploy.yml` 328행 | `work.bokdoong.com/work/assets/web1-design-lite.css` 캐시 정책 확인 | 확인 주소를 share 쪽 파일(예: `/work/share/share.css`)로 바꿈 |
| `cloudflare-worker-deploy.yml` 349행 | `mj880616.github.io/work/` 200 확인 | D1 뒤에는 404.html 안내가 되므로 확인 기대값을 바꾸거나 `/work/app/`만 남김 |
| `app-smoke-check.yml` 758행 `test -f p/index.html`, 856행 `p/public-post.js` grep, paths의 `p/**` | 파일이 없으면 실패 | 해당 줄 삭제 |
| `app-e2e-check.yml` paths `p/**` | 무해 | 정리 |
| `tests/app-e2e/list-typography.spec.mjs` 65·94행 | `/press/` 화면 글자 크기와 비교 | 비교 대상을 Web2 화면끼리로 바꾸거나 해당 비교만 삭제(Web1 기준이 사라짐) |
| `tests/domain/bokdoong-router.test.mjs` | `assets/web1-design-lite.css`, `/work/p/`, `/work/press/` 경로를 예로 씀 | D1 Worker 변경과 같은 PR에서 기대값 갱신 |
| `tests/security/task13-web2-private-boundary.test.mjs`, `task12c-final-matrix.test.mjs`, `public-workspace-forward-repair.test.mjs` | `p/public-post.js`·`public-policy/index.html`을 읽어 검사 | 파일이 없을 때의 기대(“없음”)로 바꿈. 검사를 지워서 통과시키지 않음 |
| `tests/domain/supabase-origin.test.mjs`, `tests/security/edge-errors-cors.test.mjs` | Edge 소스(`public-page-edit`, `pc0921-board` 등) 읽음 | Edge 소스를 지울 때만 함께 |

### 나. 함께 지우는 것 (Web1 전용)

- workflow: `publication-gate.yml`, `publication-auto-merge.yml`, `sync-public-page-meta.yml`, `web1-editor-auth-check.yml`, `web1-file-dropzone.yml`, `private-rail-forum-state-e2e.yml`.
- 명령: `.claude/commands/게시반영.md`(그리고 이 명령을 소개하는 문서 줄).
- 스크립트: `scripts/publication-pr-policy.mjs`, `generate-public-pages.mjs`, `public-page-meta.mjs`·`.test.mjs`, `check-web1-file-dropzone.mjs`·`.test.mjs`, `publication-content.test.mjs`. `authz-security-check.yml`의 `publication-pr-policy` 줄도 함께.
- 시험: `tests/app-e2e/public-post.spec.mjs`, `private-rail-gimpo-page.spec.mjs`, `private-rail-forum-state.spec.mjs`, `tests/security/publication-pr-policy.test.mjs`, `press-import-check-sql.test.mjs`(+ `docs/ops/press-import-check.sql`은 E1 대조가 끝난 뒤), `web1-front-page-archive-readonly.test.mjs`, `web1-origin-required-writes.test.mjs`. 지운 시험은 `scripts/check-test-registration.mjs`가 보는 workflow 등록도 함께 뺀다.
- `scripts/personal-data-allowlist.json`의 Web1 경로 3줄.

### 다. 남기는 시험

- 지운 것이 되살아나지 않게 지키는 검사(`app-smoke-check.yml` 1054~1067행, `page-core-structure.spec.mjs`, `web1-email-login-removed.test.mjs`).
- DB 기록용 시험(`web1-4-drop-app-delete-pages.test.mjs`, `tests/auth-handoff/web1-upcoming-events-readonly.test.mjs`, `supabase/tests/authz_*.sql`) — migration 기록과 짝이라 남긴다.
- `scripts/build-pages.mjs`·`check-loader-cache.mjs`는 Web1 특례가 없다. 파일을 지운 뒤 남은 참조가 있으면 loader 검사가 실패하므로 C1 PR의 안전망이 된다.

## 4. 단계와 되돌리기

| 단계 | 할 일 | 바꾸는 것 | 되돌리기 |
| --- | --- | --- | --- |
| E1 | `press/` 47건과 자료실 '성명·보도자료' 대조(PRESS-자료실편입) | 없음(확인만) | 해당 없음 |
| D1 | 이름표 `web1-last-YYYYMMDD`(D1 merge 직전 main) → Worker: `work.bokdoong.com`의 Web1 경로에 '더 이상 운영하지 않는 페이지입니다' 한 줄(검색 제외), **0절 4번 경로는 제외** + 루트 `404.html` 한 줄 + 3-가의 Worker 배포 확인 갱신 + `bokdoong-router` 시험 갱신 | Cloudflare(정지 지점 — CC가 일상어 3줄 뒤 진행) | Worker 이전 버전 재배포 또는 D1 PR revert(파일은 아직 남아 있음) |
| V1 | 옛·새 공유 링크, about, Web2 전체, 바깥에 보낸 Web1 링크 몇 개(김포 공영화 보도자료·인력확충 제안서·궤도협의회 선언문·민자철도 토론회)가 한 줄 안내로 | 없음 | 해당 없음 |
| C1-a | 필수 검사에서 `publication-gate`·`dropzone` 빼기(GitHub 화면) | 저장소 설정 | 필수 검사 다시 추가 |
| C1-b | 2-1 파일 + 3-나 관문·스크립트·시험 삭제 + 3-가 시험 갱신 + 문서(AGENTS.md 5절 Web1 문단, `docs/bokdoong-domain.md`, `docs/web1-public-page-withdrawal.md`) 갱신 — **한 PR** | 저장소 파일 | **커밋 revert PR**(merge 커밋 하나를 되돌림) 또는 이름표 `web1-last-…`에서 필요한 폴더만 되살리는 PR. 되살려도 D1 안내가 앞에 있으므로 Worker까지 되돌려야 화면이 다시 보임 |
| C1-c | Edge 함수 삭제(1-라 후보) | 운영 함수(대시보드, 명진) | 저장소 원본이 있는 함수는 이름표 커밋으로 같은 이름·같은 verify_jwt 신규 배포. **원본 없는 함수는 되돌릴 수 없음**(Q4) |
| C1-d | Supabase Auth Redirect 목록의 Web1 편집 페이지 패턴 정리(`docs/bokdoong-domain.md`) | 운영 설정(명진 화면) | 같은 값 다시 추가 |

- 순서 원칙은 `docs/web2-expand-deploy-verify-contract.md`와 같다: 안내 한 줄 먼저(D1) → 확인(V1) → 마지막에 파일·함수 정리(C1).
- DB는 어느 단계에서도 바꾸지 않는다.

## 5. 다음 PR 제안 (CC용)

1. **E1 대조**(PRESS-자료실편입): 확인 SQL + 대조표. 문서 PR.
2. **D1 PR**: Worker 안내 한 줄(예외 경로 포함) + `404.html` + Worker 배포 확인 목록 + `bokdoong-router` 시험. Cloudflare 정지 지점.
3. **C1-b PR**: 위 목록 삭제·시험 갱신·문서 갱신. C1-a(필수 검사 빼기)를 merge 직전에.
4. **C1-c**: Edge 삭제는 명진 결정 뒤 대시보드.

## 6. 명진에게 묻는 것 (PR 댓글로도 올림)

- Q1. 2-1 "지우는 것" 목록 그대로 지워도 되는가? 남기고 싶은 페이지가 있으면 이름만.
- Q2. `app/page-design-core.js`(Web1 게시글만 쓰던 파일)도 함께 지울까? — 추천: 지움.
- Q3. `press/`는 E1 대조(자료실과 건수·제목 맞추기)가 끝난 뒤에 지우는 것으로 할까? — 추천: 예.
- Q4. 저장소에 원본이 없는 Web1 서버 함수 5개(`joint-struggle-files`, `rail-declaration-content`, `rail-declaration-comments`, `rail-1007-plan`, `press-conference-files`)는 지우면 되돌릴 수 없다. 지울까, 그냥 둘까? — 추천: 페이지 삭제 뒤 한 달 두고 지움.
- Q5. GitHub 필수 검사 두 개(`publication-gate`·`dropzone`) 빼기는 GitHub 화면 일이다. CC가 브라우저로 해도 되는가, 명진이 할까?
