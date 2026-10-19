# 현장 공유 페이지 설계 조사 (SHARE-현장공유)

📱 폰 가능(이 문서) · 구현 단계 중 DB 단계는 📱 폰 경로 C, Edge 단계는 사용자 승인형 Edge workflow — 이 문서는 설계·조사만 한다. 앱 코드·DB·Edge·Cloudflare·설정 변경 없음.

- 작성: 2026-10-20, Claude Code 웹(설계 조사 세션). 기준 main `62ab52d`(#740).
- 원장 행: `docs/roadmap.md`의 SHARE-현장공유(PR #741 브랜치에서 읽은 뒤 main `bf5f46c`(#743)에서 다시 확인). 관련 행: UI-PC사이드바(메뉴 이름 "공유 페이지"), BOARD-이관, PUBLIC-프로젝트페이지.
- 표시: **사실** = 저장소 코드·migration·문서로 확인. **추정** = 확인 못 한 짐작. 운영 DB·Edge는 조회하지 않았다.

---

## 0. 명진이 정할 것

### 결정 S1. 공유 페이지를 어디에 만들까

- **가. Web1 쪽 새 공유 주소 + 내용은 DB에만 + 읽기는 서버 함수 하나가 링크를 확인해서 그 페이지만 돌려줌(추천)**
- 나. Web1 쪽 새 공유 주소 + 내용은 DB에만 + 읽기는 DB 함수(지금 `/p/` 페이지와 같은 방식)를 로그인 없이 부름
- 다. 지금 민자철도 페이지(private-rail)처럼 저장소 파일로 만들고 검색만 차단
- 라. Web2 안에 옛 공유 링크 기능을 되살림
- **추천 이유**: 가·나 모두 "내용은 DB에만, 링크마다 끄기·기한"이 된다. 가는 DB를 로그인 없이 부를 수 있는 입구를 새로 열지 않아도 돼서 더 안전하고, 기존 승인 버튼(Edge 배포 workflow) 절차로 배포·되돌리기가 된다. 다는 내용이 공개 저장소 파일에 남아 "DB에만" 요구와 맞지 않고, 링크를 꺼도 저장소 이력에 남는다. 라는 확정 규칙(AGENTS.md 5절, Task 13)이 폐기한 구조라 추천하지 않는다(3절 참고).

### 결정 S2. 링크를 나중에 다시 복사할 수 있어야 하나

- **가. 다시 복사 가능(추천)**: 링크 값을 명진만 읽을 수 있는 칸에 보관. 새 사람에게 같은 링크를 또 보낼 수 있다.
- 나. 만들 때 한 번만 보여 줌: DB에는 확인용 지문(해시)만 남김. 다시 보내려면 새 링크를 만들어야 하고, 그러면 옛 링크는 꺼짐.
- **추천 이유**: 현장 공유는 "같은 링크를 여러 번 여러 사람에게" 보내는 일이 많다. 가도 링크 값은 로그인한 본인만 읽을 수 있고, 로그인 없이 읽는 쪽 확인은 지문으로만 한다. 나가 더 안전하지만 매번 새 링크를 만들어 돌려야 해 불편하다.

### 결정 S3. 링크 기한 기본값

- **가. 기한 없음, 필요할 때만 날짜 지정(추천)** · 나. 기본 90일 · 다. 기본 30일
- **추천 이유**: 사업 현황 페이지는 몇 달 이어 쓰는 경우가 많다. 대신 링크 목록에 "만든 날·마지막으로 열린 날"을 보여 줘서 안 쓰는 링크를 끄기 쉽게 한다.

### 결정 S4. 한 페이지에 링크를 여러 개 둘까

- **가. 여러 개(추천)**: 받는 쪽(예: 지부 A, 지부 B)마다 따로 만들고 하나만 끌 수 있다. · 나. 페이지당 하나.
- **추천 이유**: 한 곳에서 링크가 새 나가도 그 링크만 끄면 다른 곳은 계속 볼 수 있다.

### 결정 S5. 블록 틀 순서와 첫 버전 범위

- 추천 순서: **한 줄 현황 → 진행 단계 → 일정표 → 쟁점 → 자료 → 업데이트 기록**. 첫 버전은 6가지 블록을 모두 "글·표 수준"으로, 모양은 디자인 시안을 먼저 보고 정함(원장 순서: 링크 공유 → 블록 틀(시안 먼저) → 프로젝트 연결).
- 자료 블록의 Drive 파일 링크는 **Drive 공유 설정이 따로**다. 공유 페이지 링크가 있어도 Drive 파일이 "제한됨"이면 받는 사람은 못 연다. 첫 버전은 "Drive 링크만 넣고, 공유 설정은 명진이 직접"을 추천(자동으로 Drive 공개를 바꾸지 않음).

### 결정 S6. 메뉴 이름·주소

- **Web2 메뉴 이름만 "게시판" → "공유 페이지"(추천)**, Web2 안 주소(`?view=pages`)는 그대로. 이미 현장에 보낸 링크는 Web1 주소(`work.bokdoong.com/work/…`)라 Web2 메뉴 이름·주소와 무관하므로 깨지지 않는다(사실, 4.2절).
- "공유 페이지" 화면 안에는 ① 새 공유 페이지 목록(새로 만든 것) ② 옛 GPT 페이지 5개(지금 게시판 카드)를 아래쪽 "예전 페이지"로 두고 자연 퇴장을 추천.

### 결정 S7. 원장 정리(커맨드센터에 맡김)

- PUBLIC-프로젝트페이지(프로젝트 상황 공개 페이지)는 이 작업의 4단계(프로젝트 연결)와 목적이 거의 같다. 이 설계로 합치는 것을 추천. BOARD-이관(옛 GPT 페이지 원본을 Web2로)은 "기존 GPT 페이지는 옮기지 않고 자연 퇴장" 요구와 부딪히므로 보류·종료 검토를 추천.

---

## 1. 확정 구조 확인 (사실)

- 저장소는 **공개**다(GitHub API `visibility: public` 확인, AGENTS.md 머리말).
- AGENTS.md 5절(Task 13): Web2의 익명 작업공간·공개 프로젝트·프로젝트 게시·**공유 링크**·공개 범위 조정은 폐기됐고 RPC 실행 권한이 회수됐다. **되살리지 않는다.** 외부 공유가 필요하면 원본은 Web2, 필요한 내용만 Web1에 게시하고 Web1 링크를 공유한다. Web1 게시를 위해 Web2 인증·RLS·권한·Edge 검사를 완화하지 않는다.
- `supabase/migrations/20260925143746_task13_web2_private_boundary.sql`: `app_create_share_link`·`app_open_share`·`app_public_project`·`app_set_project_publication`·`app_set_project_block_publication` 등 실행 권한 회수. 함수·표 정의는 남겨 둠. 로그인 사용자가 `app_pages`·`app_documents`에 private 아닌 행을 만들거나 바꾸면 DB가 거절(트리거).
- 유지 대상(5절): Web1 `/p/` 페이지, `app_public_post(text)`, `public-page-edit`, `public-policy-drive`.

## 2. 지금 있는 것 (사실)

### 2.1 Web2 "게시판" 메뉴

- 코드: `app/web1-board.js`(불러오기 `app/view-loader.js` `pages`). 메뉴 이름 "게시판"은 `app/index.html`(PC 사이드바·폰 ☰ 메뉴)과 화면 제목에 있다.
- **목록은 코드에 고정된 카드 5개**(2인1조·공공기관 인력확충·민자철도 사업 현황·궤도협의회·산별전환). DB 목록이 아니다.
- **본문은 공개 저장소 파일**이다. 카드를 누르면 `raw.githubusercontent.com/…/main/<폴더>/index.html`을 받아 격리된 틀(iframe, sandbox)에 넣는다. 즉 이 페이지들의 내용은 이미 공개 저장소와 공개 Pages(`work.bokdoong.com/work/<폴더>/`)에 있다.
- "지나간 업무" 구분은 `main_project_archive_state` 표를 **로그인 없이** 읽어 정한다(`auth:false`). 이 표의 정의·권한은 저장소 migration에 없다(추정: 저장소 이전에 만든 Web1용 표).
- 검색 차단 표시: `private-rail/`·`sanbyeol/`은 `noindex`가 있다. `2in1/`·`workforce/`·`rail-council/`의 첫 화면에는 검색 차단 표시가 **없다**(범위 밖 발견, 10절).

### 2.2 Web1의 DB 기반 `/p/` 페이지

- 껍데기 HTML(`p/<slug>/index.html`, 6개 고정 + `p/index.html?slug=`)이 브라우저에서 `app_public_post(p_slug)`를 로그인 없이(공개용 키) 부르고 받은 제목·요약·본문을 그린다(`p/public-post.js`).
- `app_public_post`: SECURITY DEFINER, `app_pages`에서 `status='published'`이고 `visibility='public'`이거나 **목록에 적힌 6개 slug만** `unlisted` 허용. 문서(`public-doc-…`)도 `visibility='public'`만(`20260920120000_public_single_post_prepare.sql`, `…_cutover.sql`).
- 즉 지금 `/p/`는 **추측 가능한 영어 이름(slug)** 주소이고, 링크 끄기는 "DB에서 비공개 전환"(+ 껍데기 메타 정리 PR)으로 한다(`docs/web1-public-page-withdrawal.md`). 기한·링크별 끄기는 없다. 새 페이지를 `unlisted`로 열려면 함수 안 목록을 고치는 DB 변경이 필요하다.
- 수정: Web1 페이지의 편집 버튼 → `public-page-edit` Edge(verify_jwt=false, 함수 코드에서 로그인·관리자·Origin 확인) → `app_pages` 갱신. 껍데기 메타(제목·요약)는 `scripts/generate-public-pages.mjs`로 저장소 파일에 들어간다 → **제목·요약은 공개 저장소에 남는다.**
- `public-policy-drive`: Web1 공공기관 정책 자료의 Drive 연결용(이번 요구와 직접 관계 없음).

### 2.3 Web1 private-rail(민자철도 현장간부 공유)

- 본문은 저장소 파일(`private-rail/page.html`, 자료 목록 `materials-data.js`), 모든 화면에 `noindex,nofollow`(원장 private-rail-1a, #389). 링크를 아는 사람은 누구나 읽는다.
- 사업장별 임단투 현황 등 일부만 DB 표(`private_rail_bargaining_*`)에서 `pc0921-board` Edge(verify_jwt=false)가 서버 키로 읽어 준다. 쓰기는 관리자 로그인 확인 또는 비밀번호.
- 한계: 내용이 공개 저장소에 있어 **"링크 끄기"를 해도 저장소 이력에 남고**, 주소가 폴더 이름이라 추측 가능하다. 검색 차단은 표시(meta)뿐이다.

### 2.4 옛 "공개 View"·공유 링크 잔존

- 표: `app_project_publications`·`app_project_public_blocks`(프로젝트 공개 블록 선택, `20260920121000_project_public_view.sql`), `app_share_links`(토큰 지문·끄기·기한, `app_open_share`가 읽음). **표·함수는 남아 있고 실행 권한만 회수**(Task 13).
- 코드: `p/public-post.js`에 프로젝트 블록 그리기(`renderProject`)가 남아 있지만 `project-…` 주소는 바로 "찾을 수 없음"으로 끝나 쓰이지 않는다. `s/index.html`은 `?t=`를 `../p/#t=`로 넘기는 옛 공유 링크 껍데기다(지금 `/p/`는 `#t=`를 읽지 않음).
- Web2 앱 코드에서 공개 View·공유 링크를 부르는 곳은 찾지 못했다.

## 3. 요구와 확정 구조의 관계

| 요구 | Web1 쪽으로 가능? | 비고 |
| --- | --- | --- |
| 페이지마다 추측 불가 링크 | 가능 | 새 공유 주소 + 긴 무작위 값 |
| 로그인 없이 그 페이지 하나만 읽기 | 가능 | 링크 확인 후 그 페이지 내용만 돌려줌 |
| 링크 끄기(즉시)·기한 | 가능 | 읽을 때마다 DB에서 확인, 캐시 없음 |
| 검색 차단 | 가능 | 껍데기에 noindex + 링크 값은 주소 `#` 뒤(서버·검색엔진에 안 감) |
| 내용은 DB에만 | 가능 | 껍데기 HTML 하나만 저장소에, 제목·내용은 DB에서 |
| 블록 틀 직접 편집 | 가능 | 편집은 Web2(로그인), 읽기만 Web1 |
| AI는 초안만 | 가능 | Web2 안 AI 호출 없음(원장 25 취소). ChatGPT 초안을 붙여 넣고 사람이 저장 |
| 기존 GPT 페이지 안 옮김 | 가능 | 지금 카드·파일 그대로, 자연 퇴장 |
| 나중에 프로젝트 연결 | 가능 | 공유 페이지에 프로젝트 칸(선택), Web2 프로젝트 상세에서 "공유 페이지 만들기" |

**Web2 공유 링크를 되살려야만 되는 요구는 없다.** 단, 원칙상 주의할 점:

- 공유 페이지 내용은 "원본은 Web2, 공개할 내용만 Web1"(5절)에 맞추려면 **Web2 프로젝트·메모 자체를 공유하는 것이 아니라, 공유용으로 따로 쓴 페이지만** 공개해야 한다. 그래서 새 표(공유 페이지 전용)를 두고, 기존 `app_pages`·프로젝트 블록·`app_share_links`는 쓰지 않는 것을 추천한다(되살림으로 보일 여지를 없앰).
- 4단계 "프로젝트 연결"은 **연결 표시만**(이 공유 페이지가 어느 프로젝트 것인지)이고, 프로젝트 기록을 자동으로 공개 페이지에 싣지 않는다. 자동 반영이 필요해지면 그때 "원본 공개 범위" 결정이 따로 필요하다(위험: 내부 메모가 새 나감).

## 4. 방안 비교

### 4.1 비교표

| | A. Web1 새 공유 주소 + 서버 함수 읽기 (추천) | B. Web1 새 공유 주소 + DB 함수 읽기 | C. private-rail 방식 확장 | D. Web2 공유 링크 되살림 |
| --- | --- | --- | --- | --- |
| 내용 위치 | DB(새 전용 표) | DB(새 전용 표) | 공개 저장소 파일 | DB(`app_pages`) |
| 로그인 없는 읽기 경로 | 새 Edge 함수(verify_jwt=false)가 링크 지문 확인 후 그 페이지만 반환. **DB 표에는 로그인 없는 권한을 주지 않음** | 새 DB 함수(SECURITY DEFINER)에 로그인 없는(anon) 실행 권한 부여 | GitHub Pages가 파일 그대로 제공 | 회수한 `app_open_share` 등 다시 열기 |
| 추측 불가 링크 | 예 | 예 | 아니오(폴더 이름) | 예 |
| 링크 끄기·기한 | 즉시(읽을 때마다 확인) | 즉시 | 불가(파일 삭제 PR, 이력에 남음) | 즉시 |
| 검색 차단 | noindex + `#` 뒤 링크 값 | 같음 | noindex 표시만 | — |
| 권한 경계 | 편집 표는 owner RLS 그대로, 읽기는 함수 코드 한 곳이 지킴 | 편집 표 owner RLS, 읽기는 DB 함수가 지킴. anon 실행 입구가 하나 늘어남 | 내용이 공개 | **확정 구조 위반**(5절) |
| DB 변경 | 새 표 2개(owner RLS) + 링크 만들기·끄기 함수(SECURITY INVOKER, 로그인 사용자만) | 위 + anon 실행 DEFINER 함수 1개 | 없음(또는 기존 표 확장) | 권한 재부여 |
| 승인 workflow 사용 | DB: 승인형 DB workflow 가능(INVOKER·authenticated만이라 규칙 안, `docs/ops-db-workflow.md`) · Edge: 승인형 Edge workflow 신규 함수(`first_deploy=true`, `verify_jwt=false` 명시, `expect_unauth_401=false`) | anon 실행·DEFINER는 DB workflow가 막는 형태(ops-db-workflow 규칙) → **SQL Editor(폰 경로 C)로만** 적용 | — | — |
| 되돌리기 | 화면·껍데기 revert, Edge는 새 함수라 "화면이 안 쓰는 상태 유지"(삭제는 사용자 판단), DB는 짝 rollback(표·함수 drop) | DB rollback(함수 drop) | 파일 삭제 | — |
| 추천 | **예** | 차선 | 아니오 | **금지** |

### 4.2 A안 자세히 (추천)

**역할 분리**
- 편집·링크 관리 = **Web2(로그인)** "공유 페이지" 메뉴. 지금 권한 경계(본인만) 그대로.
- 읽기 = **Web1 공유 주소**(예: `work.bokdoong.com/work/share/#t=<긴 값>`). 껍데기 HTML 하나만 저장소에 있고 내용은 없다.

**데이터(새 표, 이름은 초안)**
- `app_share_pages`: workspace, 제목, 블록(JSON: 한 줄 현황·진행 단계·일정표·쟁점·자료·업데이트 기록), 상태(초안/게시), (4단계) 프로젝트 연결 칸(선택), 만든·고친 시각. RLS = 기존 `private.app_is_workspace_owner`(로그인 본인만). anon 권한 없음.
- `app_share_page_links`: 페이지, 링크 지문(sha256), (S2-가면) 링크 값(본인만 읽음), 이름표(예: "○○지부용"), 기한, 끈 시각, 마지막 열린 날. RLS 같음.
- 링크 만들기·끄기: SECURITY INVOKER 함수(로그인 사용자 전용 실행권한, search_path 고정). 링크 값은 **DB가 만든다**(`gen_random_bytes` 32바이트 이상) — 화면이 보낸 값을 믿지 않음(AGENTS.md 3절 3).
- 기존 `app_pages`·`app_share_links`·공개 View 표는 쓰지 않는다(3절).

**읽기(새 Edge 함수, 예: `share-page-read`)**
- 로그인 없이 POST `{token}` → 지문 계산 → 링크 행이 있고·안 꺼졌고·기한 안 지났고·페이지가 게시 상태면 **그 페이지의 제목·블록만** 돌려줌. 아니면 모두 같은 "찾을 수 없음"(어느 이유인지 알려 주지 않음).
- 서버 키는 함수 안에서만, 읽는 범위는 이 두 표의 그 한 행으로 고정. 응답 `Cache-Control: no-store`, CORS는 `work.bokdoong.com`만.
- 너무 잦은 시도 제한(추정 필요: 기존 함수에 공용 제한 장치가 없음 → 첫 버전은 링크 값 길이로 추측 불가를 보장하고 제한은 후속).

**껍데기(Web1)**
- `share/index.html`: `noindex,nofollow,noarchive`, `Referrer-Policy: no-referrer`(meta), 링크 값은 `#` 뒤에서 읽어 POST 본문으로만 보냄(주소창 `?`에 두지 않아 Pages·Cloudflare 기록·다른 사이트로 새지 않음). 받은 블록은 글자로만 그림(HTML 실행 없음, 링크는 http/https만 — `p/public-post.js`의 기존 방식 재사용).
- 저장소에는 껍데기만 있고 제목·요약 메타도 넣지 않는다(미리보기에는 "공유 페이지"라고만 보임 — 내용이 DB에만 있다는 요구의 대가). 

**편집(Web2)**
- 블록 틀 편집기: 블록 추가·순서·지우기, 각 블록 글·표. 마크다운 편집은 기존 공용 편집기(`md-editor.js`) 재사용 검토.
- AI 초안: Web2에서 AI를 부르지 않는다(원장 25 취소). [초안 붙여 넣기]로 ChatGPT가 만든 블록 글을 넣고 사람이 저장. 정해진 글 형식(블록 제목 줄)으로 붙이면 블록으로 나눠 주는 정도.
- 링크 관리: [링크 만들기](이름표·기한) → 복사, 목록에서 [끄기]. 끄면 다음 읽기부터 바로 안 보임.

**메뉴·주소**
- Web2 메뉴 "게시판" → "공유 페이지"(UI-PC사이드바 작업), Web2 주소 `?view=pages`는 유지. 옛 카드 5개는 "예전 페이지"로 아래에.
- 이미 보낸 외부 링크는 Web1 폴더 주소라 이번 작업으로 바뀌지 않는다. 새 공유 주소(`/work/share/`)는 새로 생기는 것이라 충돌 없음(사실: 저장소에 `share/` 폴더 없음). `docs/bokdoong-domain.md`대로 `work.bokdoong.com/work/**`는 Worker가 Pages로 그대로 넘기므로 **Cloudflare 설정 변경도 필요 없다**(추정: 경로 단위 허용 규칙만 확인, `cloudflare/bokdoong-router.mjs` `allowedPath`).

### 4.3 B안(차선)

- A와 같은 표·편집에, 읽기만 DB 함수 `app_shared_page(p_token)`(SECURITY DEFINER, anon 실행)로. `app_public_post`와 같은 형태라 익숙하다.
- 단점: DB에 로그인 없는 입구가 하나 더 생기고, 승인형 DB workflow 규칙(INVOKER·authenticated만)에 맞지 않아 SQL Editor 직접 적용(폰 경로 C)만 된다. 캐시·응답 머리 제어가 껍데기 쪽에만 있다.

## 5. 권한 경계 정리

- Web2 인증·RLS·기존 권한은 **넓히지 않는다**. 새 표는 기존 owner 경계 함수를 그대로 쓴다.
- 로그인 없는 쪽이 받을 수 있는 것은 "유효한 링크 값을 아는 경우, 그 한 페이지의 게시된 제목·블록"뿐이다. 다른 페이지·프로젝트·메모·조직 정보는 어떤 경우에도 돌려주지 않는다.
- 공유 페이지 내용 자체는 받는 사람이 복사·캡처할 수 있다. 링크 끄기는 "앞으로 못 연다"이지 "이미 본 것을 지운다"가 아니다(안내 문구에 넣음).
- 자료 블록의 Drive 링크 공개 범위는 Drive 설정 따로(S5). 이 작업이 Drive 공유를 자동으로 바꾸지 않는다.

## 6. 추천안과 단계

**추천: A안.**

| 단계 | 내용 | 정지 지점 |
| --- | --- | --- |
| 0 | 디자인 시안: 공유 페이지 읽기 화면(폰 중심)·Web2 편집 화면·블록 6종 모양 | 없음(사용자 시안 승인) |
| 1 | DB: 새 표 2개 + 링크 만들기·끄기 INVOKER 함수 + rollback·snapshot·precheck·postcheck 파일, 로컬 PostgreSQL 시험 | **운영 적용 직전 정지**(§6·§7, 승인형 DB workflow dry-run → apply) |
| 2 | Edge `share-page-read` 신규(verify_jwt=false) + `docs/web2-env6b-edge-source.md` 5절 표 등록 + Web1 껍데기 `share/` | **Edge 첫 배포 직전 정지**(§8, `first_deploy=true`, `expect_unauth_401=false`) — 1단계 적용 확인 뒤 |
| 3 | Web2 "공유 페이지" 화면: 목록·블록 편집·링크 관리, 초안 붙여 넣기, 옛 카드 5개는 "예전 페이지"(메뉴 이름 변경은 UI-PC사이드바 PR과 순서 맞춤) | 없음(앱 PR) — 2단계 배포 뒤 merge |
| 4 | 프로젝트 연결: 공유 페이지에 프로젝트 칸(1단계 표에 미리 두면 DB 변경 없음), 프로젝트 상세에서 "공유 페이지" 바로가기 | 1단계에 칸을 안 넣었으면 DB 정지 |

되돌리기: 3단계 revert → 화면에서 사라짐. 2단계 함수는 화면·껍데기가 안 부르면 쓰이지 않음(삭제는 사용자 판단, 자동 삭제 없음). 1단계는 짝 rollback SQL(새 표·함수만 drop, 기존 표 영향 없음).

## 7. 확인할 것(착수 때)

- `main_project_archive_state`(게시판 "지나간 업무")의 운영 권한 — 로그인 없이 읽힌다. 새 화면에서도 계속 쓸지, "예전 페이지" 구분을 Web2 쪽 설정으로 옮길지.
- Edge 함수의 잦은 시도 제한 방법(기존 공용 장치 없음).
- `p/public-post.js`의 글자 그리기(이스케이프·링크 검사) 재사용 범위.

## 8. 범위 밖 발견사항(고치지 않음)

- `2in1/index.html`·`workforce/index.html`·`rail-council/index.html` 첫 화면에 검색 차단(`noindex`) 표시가 없다. 의도(공개 홍보)인지 확인 필요.
- `s/index.html`(옛 공유 링크 껍데기)은 `?t=`를 `/p/#t=`로 넘기지만 지금 `/p/`는 `#t=`를 읽지 않아 항상 "찾을 수 없음"이 된다. 정리 후보.
- `p/public-post.js`의 프로젝트 블록 그리기(`renderProject`)는 도달하지 않는 코드다. 정리 후보.
