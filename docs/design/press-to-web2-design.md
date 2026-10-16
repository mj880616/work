# 성명·보도자료 Web2 이전 설계 (PRESS-Web2자리 · PRESS-Web1삭제 · PRESS-자동올리기)

📱 폰 경로 C(DB 적용 단계) — 이 문서는 설계·조사만 한다. 앱 코드·DB·Edge·워크플로·`press/` 파일 변경 없음. SQL은 초안 파일만 있고 적용하지 않았다.

- 작성: 2026-10-16, Claude Code 웹. 기준 main `a96161e`.
- 원장 행: `docs/roadmap.md`의 PRESS-Web2자리 · PRESS-Web1삭제 · PRESS-자동올리기.
- SQL 초안: [`sql/20261020090100_press_posts.sql`](sql/20261020090100_press_posts.sql), 짝 되돌리기 [`.rollback.sql`](sql/20261020090100_press_posts.rollback.sql), 읽기 전용 확인 [`.check.sql`](sql/20261020090100_press_posts.check.sql).

## 1. 지금 구조 (코드 조사 결과)

### 1.1 `press/` 폴더 — "47건"의 실제 구성

| 항목 | 수 |
| --- | --- |
| `press/` 바로 아래 항목 | **47** = 글 폴더 44 + `archive.json` + `index.html` + `press-archive.css` |
| `archive.json` 목록 글 | **42** (취재요청 16 · 보도자료 13 · 성명 13 / 2024년 12 · 2025년 22 · 2026년 8) |
| 그중 `press/` 밖 글 | 1 (`workforce/press-conference-0914/press-release/`) |
| 목록에 없는 글 폴더 | 3 = 안내 페이지 `statement-checklist` 1 + 어디서도 링크되지 않은 `2024-09-04-…`, `2024-09-09-public-rail-policy-conference` 2 |
| 첨부 | 4 (HWP 2 · PDF 2, 약 1.4 MB), 각 글에서 `download` 링크 |
| 크기 | 폴더 2.0 MB, 글 HTML 합계 약 270 KB(가장 큰 글 46 KB), 글자만 약 7만 자 |
| 이미지 | `press/` 안에 없음(`assets/kptu-logo.svg`를 2건이 참조) |

- 원장의 "47건"은 폴더 항목 수다. 실제 옮길 글은 **목록 42건**(+ 목록 밖 2건 여부는 결정 P2).
- `archive.json` 항목 필드: `year, date, display_date, type, type_label, title, publisher, href`.
- 글 HTML(`press/<날짜-slug>/index.html`): 머리(제목·설명·canonical·og)·`press-archive.css`(뒤로가기 줄만)·글 안 `<style>` → `header.head`(종류 꼬리표·제목·날짜·발신) → `article.article`(출처·요지·본문·소제목) → `.attachment`. 옛 2024~2025 글은 더 단순하다. 스크립트는 2건만 `assets/rich-copy.js`를 쓴다.
- 목록 화면 `press/index.html`은 `archive.json`을 읽지 않는 손으로 쓴 목록(41줄)이다. `archive.json`과 이미 1건 어긋나고(`2026-09-22-…` 누락), 1건은 깨진 링크다(`docs/pages-development-excludes-review.md:37`).
- **5개 글에 개인 휴대전화 번호가 들어 있다**(연락처 줄). 공개 저장소·공개 Pages에 그대로 있다.

### 1.2 Web2가 읽는 방식 (`app/web1-press.js`, `?v=2`)

- 목록: `../press/archive.json`을 같은 사이트에서 받는다(`cache:'no-store'`). desk 호스트에서는 Worker가 `work.bokdoong.com`으로 302 보낸다(`cloudflare/bokdoong-router.mjs:50-52`).
- 글 보기: **GitHub raw 주소**(`raw.githubusercontent.com/mj880616/work/main/press/<dir>/index.html`)에서 HTML을 받아 `<base>`를 붙이고 iframe `srcdoc`에 넣는다. 정화는 없고 `sandbox="allow-scripts allow-popups allow-forms allow-downloads"`(allow-same-origin 없음)로 격리한다(`app/index.html:160`).
- 즉 **저장소가 공개라서 동작한다**. 저장소를 비공개로 돌리거나 `press/`를 지우면 이 화면은 바로 깨진다.
- 불러오는 사슬: `index.html`(`app.js?v=293`) → `app.js`(`loader-v2.js?v=405`) → `loader-v2.js`(`view-loader.js?v=171`) → `view-loader.js:122`(`web1-press.js?v=2`), CSS `web1-press.css?v=4`. 테스트: `tests/app-e2e/web1-press.spec.mjs`, `startup-performance.spec.mjs`, `scripts/check-app-smoke-contract.mjs`.

### 1.3 게시 경로 의존

| 대상 | 내용 |
| --- | --- |
| `/게시반영` (`.claude/commands/게시반영.md`) | 새 글 폴더 + `archive.json` 앞에 추가 + `press/index.html` 한 줄 → PR → 자동 merge → Pages 빌드 확인 |
| `scripts/publication-pr-policy.mjs` | 허용 경로(`press/archive.json`, `press/index.html`, `press/<날짜-slug>/index.html`, 그 폴더의 hwp·hwpx·pdf) 판정, main 규칙 검사 |
| `scripts/publication-content.test.mjs` | `archive.json` 형식·중복·페이지 존재·목록 반영 검사 |
| `.github/workflows/publication-gate.yml` | `pull_request_target`. **`publication-gate`는 main 규칙의 필수 검사**(`docs/main-pr-gate-ruleset.json:34`, `MAIN_REQUIRED_CHECKS`). 게시 PR이 아니어도 모든 PR에서 돈다 |
| `.github/workflows/publication-auto-merge.yml` | 게시 PR만 자동 merge 예약·Pages 빌드 |
| `docs/sec-publication-auto-merge.md` | 허용 목록 기준 문서. 2026-11-02부터 공개 저장소 `pull_request_target` 기본 차단 예정 메모 |
| `.github/workflows/authz-security-check.yml` | `publication-pr-policy.mjs` 변경 시 보안 테스트 |
| 기타 | `docs/ai-work-system-source-of-truth.md:18`("성명·보도자료 = GitHub press/"), `assets/rich-copy.js:12`(press 경로 특례), `analysis/kptu-corpus/*.md`(공개 press 주소 다수), `tests/app-e2e/list-typography.spec.mjs`(`/press/` 화면 사용), `tests/domain/bokdoong-router.test.mjs`(`/work/press` 주소 넘기기) |

### 1.4 재사용할 수 있는 서버 기능

- 칸막이 HTML 보기: `app/html-frame.js`(sandbox `allow-scripts`만 + 네트워크 전부 막는 CSP) + Edge `document-actions` `html-view`(Drive HTML 읽기, 2 MB까지). **지금은 바구니 첨부만 허용**(`_shared/hwp-edit.ts`의 `source(…, "html")`이 basket이 아니면 거절).
- 자료실 올리기: Edge `library-files`(Drive "자료실" 폴더 + `app_documents` 행, 제목 추정에 OpenAI).
- 자료 내려받기: Edge `workspace-drive` `download-token`(`app_documents` 전용, 5분 1회 토큰).
- HWP 글자 읽기: `@ssabrojs/hwpxjs`(`meeting-ai-ingest/hwp-parser.mjs`, `document-ai-index`, `library-files`). PDF는 OpenAI `input_file`(`document-ai-index`).
- OpenAI 호출: `https://api.openai.com/v1/responses`, `store:false`, 모델은 `app_ai_workspace_settings.default_model`(코드 기본값 `gpt-5.6-luna`). 운영 비밀값 `OPENAI_API_KEY`는 아직 등록 전으로 추정(원장 BASKET-AI자동정리).

## 2. 저장 위치 비교

### 안 A — Drive HTML 파일 + 자료실 표(`app_documents`) 목록

- 글 HTML 42개를 Drive "자료실"에 파일로 올리고, 목록은 `app_documents`(category=성명/보도자료/취재요청, `document_date`, `source`=발신)로 둔다.
- 좋은 점: DB 변경이 없다. 원본 파일이 Drive에 그대로 남는다. 첨부도 같은 자료실 행이다.
- 나쁜 점
  - 글을 보려면 `html-view`를 자료실 자료까지 열도록 **Edge 수정·배포**가 필요하다.
  - 매번 Drive에서 받아 오므로 목록 검색(본문)·속도가 나쁘고, Drive 연결이 끊기면 성명 전체가 안 보인다.
  - 자료실 목록에 성명 42건이 섞인다. 분류(category)는 사용자가 고칠 수 있는 글자라 가르는 기준으로 약하다. DRIVE-자료트리(별표 = 자료실)와도 겹친다.

### 안 B — Web2 DB 비공개 표에 본문 HTML 그대로 + 첨부만 자료실 (추천)

- 새 표 `app_press_posts`(owner 전용 RLS): 날짜·종류·제목·발신·**원본 HTML**·첨부(자료실 행 id)·출처(옛 Web1/직접/AI)·옛 경로.
- 좋은 점
  - 보기에 서버 배포가 필요 없다. 화면이 owner 권한으로 표를 읽어 기존 칸막이 iframe(`html-frame.js` 방식)에 넣는다.
  - 42건 270 KB라 DB 부담이 없다. 목록·검색이 빠르고 Drive 연결과 무관하다.
  - PRESS-자동올리기도 같은 표에 한 행 쓰면 된다.
  - 자료실과 섞이지 않는다. 첨부 4건만 자료실 자료로 두고 기존 내려받기를 쓴다.
- 나쁜 점: DB 변경 1건(새 표, §6 정지 지점). 원본 파일 형태는 Drive가 아니라 DB 글자로 남는다(백업은 Supabase 백업 + 가져오기 전 `press/` git 이력).

### 안 C — 저장소 안에서 비공개로 옮기기

- **불가**. 이 저장소는 공개이고 `main` 루트가 그대로 Pages로 나간다(`_config.yml`이 `press/`를 빼지 않음). 저장소 안 어디에 두어도 GitHub·raw 주소로 누구나 읽는다.
- 별도 비공개 저장소: Web2가 읽으려면 서버에 GitHub 토큰(새 비밀값)이 필요하고, 비공개 저장소 Pages는 유료 요금제가 필요하다. 이 작업 규모에 비해 무겁다.
- 참고: 파일을 지워도 **공개 git 이력에는 남는다**(개인 휴대전화 번호 5건 포함). 이력까지 지우려면 이력 다시 쓰기 + GitHub 캐시 정리 요청이 필요하다(결정 P4).

### 추천: 안 B

보기·검색이 Drive와 서버 배포에 묶이지 않고, 자료실과 섞이지 않으며, 자동올리기가 같은 표를 쓴다. 정지 지점은 DB 적용 1건이다.

## 3. 원본 HTML 양식 보존 방법

1. 가져올 때 `body_html`에 **원본 파일 글자를 그대로** 넣는다(줄바꿈·인라인 style 포함). 바꾸는 것은 아래 두 가지뿐이고, 둘 다 가져오기 기록에 남긴다.
   - 외부 CSS `press-archive.css`(뒤로가기 줄 꾸밈, 1.5 KB) 링크 → 같은 내용을 `<style>`로 넣는다. 칸막이 CSP가 외부 요청을 막기 때문이다.
   - 첨부 `download` 링크 → 화면이 칸막이 밖에 [첨부 내려받기] 단추로 따로 보여 준다(칸막이 안 링크는 CSP로 막힘). 원본 링크 줄은 그대로 둔다.
2. 보기: `html-frame.js`와 같은 방식(sandbox `allow-scripts`만, CSP `default-src 'none'`). 지금 Web1 보기(`allow-popups allow-forms allow-downloads`, 네트워크 허용)보다 좁다. 로고 이미지·`rich-copy.js` 복사 단추는 칸막이 안에서 안 뜬다 → 복사는 칸막이 밖 [본문 복사] 단추로 대신한다(결정 P3).
3. 대조: 가져온 뒤 무작위 5건 + 가장 큰 글·가장 옛 글·첨부 있는 4건을 Web1 원본과 나란히 캡처해 대조 표로 만든다(폰 경로 D).

## 4. 이전 절차 (PRESS-Web2자리)

| 단계 | 하는 일 | 누가 | 되돌리기 |
| --- | --- | --- | --- |
| 1 | DB: `app_press_posts` 만들기. `.check.sql` 1번 → 적용 → 2번 캡처 | 사용자(폰 경로 C) | 짝 rollback SQL(표가 비어 있거나 옛 글만 있을 때) |
| 2 | 화면 PR(Expand): 성명 화면이 **표에 글이 있으면 표를, 없으면 지금처럼 Web1을** 읽는다. 첨부 단추·칸막이 보기 | AI → PR | PR 되돌리기(revert) |
| 3 | 가져오기: Web2 성명 화면의 1회용 [Web1 글 가져오기](owner만, 로그인 권한으로만 씀). `archive.json` 42건과 각 글 HTML을 같은 사이트에서 받아 `origin='legacy_web1'`, `legacy_path`로 넣는다. 같은 경로가 있으면 건너뜀(두 번 눌러도 안전). 첨부 4건은 기존 자료실 올리기(`library-files`)로 올리고 id를 적는다 | 사용자가 단추 1번 | `delete from public.app_press_posts where origin='legacy_web1'` (SQL Editor, 사용자) + 자료실 첨부 4건 삭제 |
| 4 | 대조: `.check.sql` 3·4번(합계 42, 종류 16/13/13, 연도 12/22/8, 첨부 4, 겹침 0) + §3의 화면 대조 표 | 사용자 캡처 → 커맨드센터 판정 | — |
| 5 | 화면 PR(Contract): Web1 읽기 코드·GitHub raw 의존 삭제, 1회용 가져오기 단추 삭제(임시 코드 남기지 않음, AGENTS.md §3-6) | AI → PR | PR 되돌리기 |

- 가져오기를 SQL로 하지 않는 이유: 본문 270 KB를 SQL로 만들면 폰 붙여넣기로 수십 조각이 되어 잘림·누락 위험이 크다. 화면 단추는 owner 권한(RLS) 그대로 쓰고 새 서버 기능이 필요 없다.
- 가져오기 단추가 읽는 곳은 우리 사이트(`work.bokdoong.com`의 `/work/press/`)뿐이다. Web1이 살아 있을 때만 쓸 수 있으므로 단계 3·4는 PRESS-Web1삭제보다 반드시 먼저 한다.

## 5. Web1 삭제 순서와 깨질 수 있는 것 (PRESS-Web1삭제)

전제: §4의 5단계까지 끝나 Web2 화면이 Web1을 전혀 읽지 않는다.

1. **main 필수 검사 정리(사용자, GitHub 설정)** — `publication-gate`는 모든 PR의 필수 검사다. 워크플로를 먼저 지우면 이후 **모든 PR이 영원히 "검사 대기"로 막힌다**. 그래서 먼저 GitHub 규칙(ruleset)에서 `publication-gate`를 필수 검사에서 빼거나, 아래 결정 P5의 ②처럼 검사 이름은 남긴다. `docs/main-pr-gate-ruleset.json`도 같은 PR에서 고친다.
2. **게시 경로 PR** — `.claude/commands/게시반영.md`의 press 경로 삭제(기존 페이지 갱신 경로만 남김), `publication-auto-merge.yml` 삭제, `publication-gate.yml` 정리(P5), `scripts/publication-pr-policy.mjs`·`publication-content.test.mjs`·`tests/security/publication-pr-policy.test.mjs` 정리, `docs/sec-publication-auto-merge.md`를 "폐기" 표시.
3. **파일 삭제 PR** — `press/` 전체(글 44·목록·CSS·첨부 4) 삭제. 같은 PR에서 `tests/app-e2e/web1-press.spec.mjs`(이미 5단계에서 바뀜), `list-typography.spec.mjs`의 `/press/` 사례, `assets/rich-copy.js` press 특례, `docs/ai-work-system-source-of-truth.md:18`, `docs/pages-development-excludes-review.md` 해당 줄을 맞춘다.
4. **확인** — Pages 배포 후 `/work/press/` 404, Web2 성명 화면 42건 정상, 다른 PR의 필수 검사 정상 통과.

깨질 수 있는 것:

| 대상 | 영향 | 막는 법 |
| --- | --- | --- |
| 모든 PR의 merge | `publication-gate` 필수 검사가 안 와서 막힘 | 1번을 먼저 |
| Web2 성명 화면 | Web1을 읽는 코드가 남아 있으면 빈 화면 | §4의 5단계 이후에만 삭제 |
| 옛 공개 주소(`work.bokdoong.com/work/press/…`, `mj880616.github.io/work/press/…`) | 404. 사용자 확인으로 외부 공유 링크 없음. 검색엔진 캐시는 한동안 남음 | 받아들임(필요하면 Google Search Console 삭제 요청) |
| `workforce/press-conference-0914/press-release/` | `press/` 밖이라 그대로 남음. 성명 목록 1건이 이 주소 | 남길지 결정 P2 |
| `analysis/kptu-corpus/*.md` 안 press 주소 | 링크만 죽음 | 손대지 않음(분석 기록) — 보고만 |
| `tests/domain/bokdoong-router.test.mjs` `/work/press` | Worker 주소 규칙 시험이라 파일 삭제와 무관 | 그대로 |
| 공개 git 이력 | 지운 글·첨부·전화번호가 이력에 남음 | 결정 P4 |
| `pull_request_target` 2026-11-02 기본 차단 | 게시 경로가 사라지면 해당 없음 | — |

## 6. 자동올리기 설계 (PRESS-자동올리기)

### 6.1 흐름

1. Web2 성명 화면 [파일로 올리기] → HWP·HWPX·PDF·DOCX·TXT 1개 선택.
2. 새 Edge 함수 `press-ingest`(새 함수: `first_deploy=true`, verify_jwt 명시, `docs/web2-env6b-edge-source.md` 5절 표 사전 등록. 코드에서 토큰 → owner 확인).
   - 원본 파일은 자료실(Drive)에 보관(첨부로 연결).
   - 글자 읽기: HWP·HWPX는 기존 `@ssabrojs/hwpxjs`, PDF는 OpenAI `input_file`, TXT는 그대로. 5만 자 상한.
   - OpenAI Responses(`store:false`)에 **구조화 출력(JSON 스키마)** 요청: 제목·날짜·종류·발신·요지 줄·본문 문단·소제목·연락처 유무.
   - **HTML은 모델이 만들지 않는다.** 서버가 고정 양식(최근 글 구조: `header.head` → `article.article`)에 글자를 이스케이프해 채운다. 모델 답에 이상한 HTML이 와도 글자로만 들어간다.
3. 화면에 **초안 미리보기**(칸막이) → 사용자가 날짜·종류·제목을 확인·수정 → [게시] → `app_press_posts`에 `origin='ai_upload'` 한 행(owner 권한).
4. 실패하면 아무 행도 만들지 않는다. 자료실에 올라간 원본은 남겨 다시 시도할 수 있다.

### 6.2 OpenAI 사용량 추정 (월 1만 원대 안)

가정(만들 때 OpenAI 가격표로 다시 확인, 1달러 ≈ 1,400원): 성명 1건 글자 3천~8천 자, 한국어 1자 ≈ 1토큰 안팎, 지시문 1.5천 토큰, 출력은 본문을 다시 쓰므로 입력과 비슷.

| 항목 | 1건 |
| --- | --- |
| 입력 | 약 5천~1만 토큰 |
| 출력 | 약 4천~9천 토큰 |

| 모델 급(가격 가정, 100만 토큰당 입력/출력) | 1건 비용 | 월 10건 | 월 30건 |
| --- | --- | --- | --- |
| 작은 모델(약 $0.4 / $1.6) | 약 $0.02 (약 30원) | 약 300원 | 약 900원 |
| 중간 모델(약 $2 / $8) | 약 $0.09 (약 130원) | 약 1,300원 | 약 4,000원 |
| 큰 모델(약 $5 / $20) | 약 $0.23 (약 330원) | 약 3,300원 | 약 1만 원 |

- 지난 2년 목록 42건 → 월 평균 2건 안팎, 바쁜 달 10건 내외. 어느 모델이든 월 1만 원 안이다. 다른 AI 기능(바구니 자동 정리 등)과 합친 전체 예산은 원장 결정대로 OpenAI 쪽 월 사용 한도로 막는다.
- 같은 파일을 다시 올리면 다시 비용이 든다 → 화면에서 "이미 올린 파일" 안내(파일 해시 비교).
- PDF를 `input_file`로 보내면 쪽 이미지까지 읽어 입력 토큰이 늘 수 있다. 글자 추출이 되는 PDF는 글자로만 보내는 것을 먼저 시도한다.

### 6.3 선행 조건

PRESS-Web2자리 완료, 운영 비밀값 `OPENAI_API_KEY` 등록(사용자 대시보드, BASKET-AI자동정리와 같이), HWP 글자 읽기 확인(이미 있는 라이브러리 재사용).

## 7. 결정 필요 (일상어)

- **P1. 성명 47건을 어디에 둘까**
  - ① Web2 DB의 비공개 표에 원문 HTML 그대로, 첨부 4개만 자료실 — **추천**. 이유: 서버 배포 없이 보이고, 빠르고, 자료실과 안 섞인다.
  - ② Drive에 HTML 파일로 올리고 자료실 목록으로. 이유: DB 변경은 없지만 보려면 서버 배포가 필요하고 자료실에 42건이 섞인다.
  - ③ 저장소 안 비공개 자리. 이유: 공개 저장소라 **불가능**.
- **P2. 목록에 없던 글은 어떻게 할까** (목록 밖 옛 글 2건, 안내 페이지 1건, `press/` 밖 기자회견 보도자료 1건)
  - ① 목록 42건만 옮기고, 목록 밖 옛 글 2건은 같이 옮기되 "목록 밖" 표시, 안내 페이지는 옮기지 않음, 기자회견 보도자료 페이지(`workforce/…`)는 Web1에 그대로 둠 — **추천**. 이유: 잃는 글이 없고, 기자회견 페이지는 성명 폴더가 아니라 따로 판단할 일이다.
  - ② 목록 42건만. 이유: 단순하지만 옛 글 2건은 Web1 삭제 때 사라진다.
- **P3. Web2에서 성명 화면 모양을 얼마나 원본과 같게 할까**
  - ① 글 본문은 원본 그대로, 복사·첨부 단추만 칸막이 밖에 — **추천**. 이유: 원본 양식을 지키면서 안전하게 보인다.
  - ② 원본 스크립트(복사 단추 등)까지 그대로 돌리기. 이유: 칸막이를 넓혀야 해서 안전 기준이 낮아진다.
- **P4. 지운 뒤에도 공개 git 이력에 남는 글(전화번호 5건 포함)을 어떻게 할까**
  - ① 받아들이고, 앞으로 새 글은 Web2에만 쓴다 — **추천**. 이유: 이력 지우기는 저장소 전체를 다시 쓰는 큰 작업이고 다른 작업 브랜치·PR이 모두 깨질 수 있다.
  - ② 이력에서 `press/`를 지우고 GitHub에 캐시 정리 요청. 이유: 전화번호까지 지울 수 있지만 위험이 크고 PC 작업이 필요하다.
  - ③ 전화번호가 든 5건만 Google·GitHub에 개별 삭제 요청. 이유: 중간안. 효과가 부분적이다.
- **P5. `publication-gate` 검사를 어떻게 정리할까**
  - ① GitHub 규칙에서 필수 검사를 뺀 뒤 워크플로를 지운다 — **추천**. 이유: 쓸모없는 검사를 남기지 않는다. 사용자가 GitHub 설정에서 한 번 바꾸면 된다.
  - ② 검사 이름은 남기고 내용만 "항상 통과"로 줄인다. 이유: 설정을 안 건드려도 되지만 의미 없는 검사가 계속 돈다.
- **P6. 자동올리기는 올리자마자 게시할까**
  - ① 초안을 보여 주고 [게시]를 눌러야 올라감 — **추천**. 이유: 날짜·종류를 AI가 틀릴 수 있다.
  - ② 바로 게시. 이유: 빠르지만 틀린 글이 목록에 먼저 올라간다.

## 8. 정지 지점 (AGENTS.md §6)

1. `app_press_posts` DB 적용 — 폰 경로 C 또는 사용자 승인형 DB workflow.
2. main 규칙(ruleset) 필수 검사 변경 — 사용자 GitHub 설정.
3. `press-ingest` 새 Edge 함수 배포 — 사용자 승인형 workflow(`first_deploy=true`).
4. `OPENAI_API_KEY` 등록 — 사용자 대시보드.

AI는 어느 것도 실행·승인하지 않는다.
