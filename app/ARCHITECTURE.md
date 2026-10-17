# 웹2 앱 구조

## 1. 진입 경로

현재 런타임 진입은 아래 한 경로를 기준으로 함.

1. `index.html`
2. `app.js`
3. `loader-v2.js`
4. `runtime-client.js`, `app-router.js` 등 공용 코어
5. 기능 모듈

`index.html`은 캐시 버전을 가진 `app.js`만 직접 로드함. 기능 모듈 추가·삭제는 원칙적으로 `loader-v2.js`에서 관리함.

## 2. 화면 전환 소유권

화면 전환은 `app-router.js`가 단독 소유함.

- 기본 메뉴: `index.html`의 `.app-nav [data-view]`, 폰 하단 `.mobile-tabs`, 메뉴 창의 `.mobile-menu-panel`을 라우터가 함께 관리함
- 홈 카드 등 이동 버튼: `data-goto`
- 모바일(760px 이하, 8-9e-2): 하단 탭은 홈·바구니·일정·프로젝트·담당조직·메뉴 6칸이고, 앞의 다섯 칸과 같은 순서로 밀기 전환함(메뉴는 밀기 대상 아님). [일정] 탭(`data-mobile-schedule-tab`)은 달력(`calendar`)과 할 일(`tasks`) 두 화면을 맡으며, 라우터가 화면을 바꿀 때 그 탭의 `data-view`를 마지막으로 본 쪽으로 맞춤(새 저장소 없음). 두 화면 위의 `[달력 | 할 일]` 전환(`.schedule-switch [data-view]`)도 라우터의 `data-view` 이동임. 옛 `?view=tasks`와 홈 "할 일 ›" 등 할 일로 가는 이동은 그대로 `tasks` 화면을 열고 [일정] 탭이 선택됨. 회의·자료실·성명·보도자료·게시판·계정은 [메뉴] 탭(`#mobileMenuTab`)이 여는 메뉴 판에서 열며(오른쪽 위 ☰는 폰에서 숨김) topbar-actions.js가 메뉴 이력과 계정 노드 이동을 소유함. 폰 메뉴 판(UI-디자인손질)은 하단 탭 바로 위로 올라오는 판으로, 위쪽 손잡이(누르면 닫힘, 아래로 밀면 닫힘)·큰 칸 3×2([쓰기]·회의·자료실·HWP 편집·성명·보도자료·게시판)·"계정" 상자(화면 색·사본 갱신·로그아웃)이고, 바깥 누르기·Esc·뒤로 가기로도 닫힘. 성명·보도자료는 한 칸(`data-view="media"`)이며 폰 머리줄 이름도 "성명·보도자료" 하나임. [쓰기](`data-menu-write`, 폰 메뉴 판·761~1023px ☰·PC 사이드바)는 topbar-actions.js가 공용 `md-editor.js`를 빈 글로 열고 [저장]을 누르면 바구니 빠른 입력과 같은 `basket-data.js`의 `createNote`로 새 메모 하나를 만든다(새 저장 경로·DB 변경 없음). 저장하지 않고 닫은 글은 이 탭 메모리에만 남아 다음 [쓰기]에서 이어지고(브라우저 저장소에 두지 않음), 로그인이 바뀌면 비운다. 저장 뒤 `kptu:basket-note-created`로 바구니 목록이 보이고 있으면 다시 읽음. 761~1023px는 가로 메뉴와 ☰, 1024px 이상은 사이드바를 유지함
- 모바일 하단 고정(8-9e-2): 홈·바구니 빠른 입력(`home-quick.js`)은 하단 탭 바로 위에 붙고, 자판이 열리면 자판 바로 위로 올라감(뷰포트 `interactive-widget=resizes-content`, 지원하지 않는 브라우저는 topbar-actions.js의 `--kptu-keyboard-inset`). 일정·할 일·프로젝트·자료실의 추가 버튼은 같은 버튼을 하단 탭 위 오른쪽의 동그란 [+] 모양으로만 바꿈(ui-standard.css)
- 좌상단 브랜드: 홈으로 이동

성명·보도자료는 메뉴의 한 칸(`media`)에서 열고, 게시판은 현장 공유 페이지를 관리함. 개인 배지·구성원 관리·메시지 화면은 앱 셸에서 제거했으며 기존 개인 화면 URL은 홈으로 귀결됨. 포토룸 화면·코드는 삭제했으며(TASK-포토룸삭제 1단계) `?view=photos`는 홈으로 귀결되고 주소에서 폐기된 `view`를 제거함(기본 홈). 저장된 사진·DB 기록은 DB 정리 때 따로 다룸.

TASK-팀AI삭제 1단계에서 조직 상세의 주간보고·타임라인 AI 초안과 비활성 프로젝트 AI 초안 호출을 제거함. 조직의 저장된 주간보고 열람·수정과 타임라인 수동 관리는 유지하며, `?view=ai`·`?view=team-ai` 같은 옛 주소는 홈으로 귀결됨. `team-ai` Edge와 AI 기록은 별도 2단계 대상임.

D-4a ②는 실제 `#homeView`의 읽기 칸을 독립 조회한다. `?view=home`과 브랜드, 기본 `/app/`는 홈으로 가며 일정은 `?view=calendar`이다. 홈이 남아 있는 project query보다 우선하고, 안드로이드 뒤로의 마지막 복귀(Web2 첫 기록에서)는 home이다.

뒤로 가기(BUG-뒤로가기): 열린 것(창·메뉴 판·고르기 시트·화면 안 상세)이 있으면 뒤로 가기는 가장 위의 것 하나를 닫고, 아무것도 열려 있지 않을 때만 이전 탭으로 간다. 열린 것마다 같은 주소의 기록 1개를 갖는 것이 규칙이며, 브라우저·PWA의 뒤로 가기와 안드로이드 앱 뒤로(`native-back-guard.js`의 `KPTUNativeBack` v3 → `KPTURouter.back()`)는 같은 기록을 한 칸 되돌리므로 결과가 같다. 앞으로 만드는 창·화면도 이 규칙을 따른다: `.modal`은 `mobile-modal-history.js`가 폰 폭(760px 이하, 또는 `data-kptu-history-all`)에서 기록을 붙이고, 화면 안에서 여는 상세(바구니 메모 등)는 `KPTURouter.layer.open(name,{close})`로 연다. 화면의 닫기(‹·Esc)는 스스로 닫은 뒤 돌려받은 `close()`를 불러 그 기록을 되돌린다(‹와 뒤로가 같은 결과). 뒤로로 닫힐 때 여는 쪽의 `close({fromBack:true})`가 `false`를 돌려주면(저장 안 한 글을 버리지 않음) 기록을 다시 쓰지 않고 그 칸으로 돌아간다. 다른 탭으로 옮기면 그 화면의 layer는 라우터가 잊고(여는 쪽은 `kptu:view-changed`에서 닫음), 남은 기록은 다음 뒤로 가기에서 건너뛴다. 안드로이드는 Web2의 첫 기록에서 홈이 아니면 홈으로, 홈이면 누름을 소비한다(앱은 닫지 않음, 기존 APK 결정). 바구니 메모와 노트(`basket-notes.js`)는 목록에서 열면 목록 스크롤 위치를 기억했다가 뒤로·‹로 닫을 때 되돌린다.

각 기능 모듈은 직접 모든 `.view-panel`을 숨기거나 활성 메뉴를 다시 계산하지 않음. 화면 전환이 필요하면 `window.KPTURouter.go(view)`를 사용함.

화면 진입 때 추가 작업이 필요하면 클릭 핸들러를 또 만들지 말고 `window.KPTURouter.on(view, callback)`을 사용함. 캘린더와 알림 화면의 진입 후 갱신도 이 방식으로 연결함.

## 3. 세션·API 공용 런타임

`runtime-client.js`가 세션 읽기·저장·만료 확인·refresh token 갱신 잠금과 공용 API 호출을 제공함.

2차 안정화 기준 공용 런타임을 사용하는 주요 모듈:

- `team.js`
- `library-upload.js`
- `collaboration-center.js`
- `notification-center-ui.js`
- `calendar-persistence.js`
- `task-workflow.js`
- `meeting-round-detail.js`

일정·할 일·프로젝트·회의 핵심 보조 모듈에 남아 있던 별도 세션 저장·refresh token 갱신 로직을 제거함. 여러 모듈이 동시에 refresh token을 사용해 각각 세션을 갱신하지 않도록 `runtime-client.js` 안에서 하나의 refresh promise를 공유함.

로그인 방식, Google OAuth 진입·복귀 방식, 세션 저장 키와 DB 구조는 변경하지 않음.

## 4. 런타임 계층

### 인증

- `native-auth-bridge.js`
- `calendar-return-bridge.js`
- `auth-handoff-client.js`
- `auth-bootstrap.js`
- `session-resilience.js`

Android OAuth 복귀 경로는 별도 기능 수정과 섞지 않음. 인증 UI 변경 시 Android WebView와 일반 브라우저 흐름을 각각 확인함.

Task 20: 가입·초대·접근요청·관리자 지정 모듈과 비활성 구성원 화면을 제거했다. 전용 `login/`은 로그인만 제공하며, 구성원 조회 결과가 비어 있으면 `team.js`가 `accessDeniedView`(접근 거부·로그아웃)를 표시한다. loader는 `denied` 상태에서 기능 모듈을 불러오지 않는다. 서버 권한은 기존 RLS·Edge가 계속 확인한다.

### 기본 셸

- `runtime-client.js`: 공용 세션 갱신 및 공용 API 기반
- `app-router.js`: 화면 전환 단일 소유자
- `team.js`: 워크스페이스 기본 데이터 및 기본 기능
- `workspace-ui.css`: 공통 UI 보정. 단순 스타일 수정용 JS 모듈을 새로 만들지 않음.
- 디자인 기준(UI-디자인기준): 글자·선·모서리·종류 색·다크 모드 값은 `theme-tokens.css`의 `--ds-*` 한 곳에 둔다. 적용 규칙은 `ui-standard.css`가 소유하며 `view-loader.js`가 모든 화면의 스타일 목록 끝에 불러온다(그래서 공용 셸·창 규칙도 어느 화면에서 시작해도 적용된다). 규칙은 모두 `#appView` + 적용 화면 ID로 한정해(프로젝트 상세 창은 `#appView` 밖에 붙으므로 `#ps3DetailModal`로 한정) 다른 화면과 불러오는 순서에 영향받지 않는다. 버튼은 높이 하나(`--ds-control-height`, 홈 빠른 입력 [추가] 높이)와 네 종류(채운 버튼·종류 색·0.5px 테두리·빨간 테두리)만 쓴다. 다크 모드는 기기 설정(`prefers-color-scheme:dark`)만 따라 Web2 전체(창 포함)에 켜지며 값만 `theme-tokens.css`에서 바꾼다(테마 4종은 계정 색만 다시 정함). HWP 편집기·성명·게시판 본문 칸막이(iframe) 바탕은 `--ds-frame-paper`로 밝게 둔다. 바구니의 분류 버튼 셋([분류 요청]·[분류 결과 입력]·[GPT 답변 가져오기])은 머리줄 [⋯ 더보기](`<details data-basket-more>`) 안에 있다. 프로젝트 목록 오른쪽은 다음 주요 일정 D-day 알약 하나뿐이다(목록 한 번의 묶음 읽기, 홈 D-day와 같은 표·조건). 목록 줄 이름은 13px·400, 보조 줄 12px 흐린 색(프로젝트 메인만 500). 담당조직 목록은 이름 한 줄이고, 이름 왼쪽 점 색으로 마지막 기록이 며칠 전인지 보인다(기존 날짜 묶음 읽기 1회, 조직별 요청 없음). 자료실 종류 표시는 확장자, 없으면 Drive 파일 종류(`mime_type`)로 정하고 색은 `--ds-file-*`. 단계마다 적용 화면을 넓혔다(1단계: 홈·바구니, 2단계: 일정·할 일·프로젝트, 3단계 1부: 담당조직·자료실·회의, 3단계 3부: HWP 편집 바깥 틀·성명·보도자료·게시판·공용 셸(폰 머리줄·하단 탭·PC 사이드바·☰ 메뉴 판·계정 메뉴)·화면 색 창·공용 창(`.modal`)·고르기 시트). 공용 창은 `.modal`로 한정하고 제목 18px·500, 버튼 한 높이, 입력칸 46px·모서리 8px. 디자인 손질(UI-디자인손질, 8-9e 후속)은 같은 파일 끝에 더했다: 회의 결과 창 묶음 상자와 성명·보도자료 목록 줄의 안쪽 여백, 일정 하루 보기 창의 할 일 줄(바탕·테두리 없음, 기한 지난 것만 빨간 "지남"), 담당조직 머리줄 수 표시 삭제, 폰 메뉴 판, 바구니 메모 읽기 머리줄·[⋯]·연결 칩. 앱 아이콘("9-6", 남색 바탕·왼쪽 위가 열린 크림색 틀·테라코타 점)은 `scripts/app-icon/build-app-icons.py`가 `app/app-icon.svg`(32px 이하에서는 SVG 안 미디어 조건으로 점만 키움)와 `app/icons/*.png`(16·32·48·180·192·512, maskable 192·512)를 저장소 안에서 만든다.

### 협업

- `notification-center-ui.js`: 전용 알림 화면
- `suborganizations.js`, `suborganization-planned-assignee.js`: 산하조직 영역
- `organization-order.js`: 담당조직 공통 순서·묶음(TASK-조직순서)의 유일한 정의. 담당조직 목록, 일정 등록·수정의 담당조직 체크, Google 할 일 편집창의 조직 선택이 이 모듈을 쓴다. 조직 상세의 연결된 할 일은 `google-tasks.js`가 그린다(TASK-조직상세).

### 업무 기능

- 홈: `home-read.js`가 읽기 칸의 유일한 renderer, `home-read-model.js`가 KST 날짜·주 경계와 선택 규칙을 소유한다. `/app/` 기본은 홈이며 일정은 `?view=calendar`이다. 날짜·메뉴 셸을 먼저 공개한 뒤 각 칸을 독립 조회하고, Google 목록·확정 연결·프로젝트 카탈로그·조직 목록은 공유한다. 완료 상태는 `google-tasks.js`의 toggleTask·3초 settling·기존 변경 이벤트를 쓴다. 빠른 입력은 D-4a ③ 범위다.

- 바구니: `basket.js`가 목록·상세·보기 선택의 유일한 renderer다. `basket-data.js`가 홈과 공유하는 글 검증·app_notes REST와 note_id 연결 조회·상태 계산을 소유한다. 메모 상세는 읽기 화면(원문·첨부·연결 상태)으로 열고 [수정]을 눌러야 편집 화면과 자판이 열린다(BASKET-보기모드). 원문·작성 중 글·보기 선택은 브라우저 영구 저장소에 두지 않으며, 목록 재진입 기본은 미분류다. 홈의 기존 모드 기억 키는 유지하고 저장된 모드가 없으면 바구니가 기본이다. 조직 업데이트는 BASKET-2b 전까지 기존 경로를 쓴다. 연결 해제(링크 1행 삭제)와 메모 원문 삭제(연결은 `note_id` cascade)는 `basket-record-delete.js` 하나가 확인·요청·결과 재확인을 소유하며, 첨부가 있는 메모는 `basket-files`의 `note-delete`가 첨부를 Drive 휴지통으로 옮긴 뒤 로그인 사용자 JWT로 메모를 지운다(서버가 이 동작을 모르는 구버전 응답이면 기존 REST 삭제로 메모만 지우고 첨부는 Drive에 남는다, BASKET-삭제). 조직·프로젝트 상세의 연결 기록(`basket-link-records.js`)과 바구니 읽기 화면의 [삭제]가 함께 쓴다(BASKET-연결해제삭제). 바구니 읽기 화면의 [연결하기]·[할 일 만들기]는 `basket-manual-link.js`가 상세 안의 한 칸에만 그리며(편집 중·패널 열림 중에는 읽기 버튼을 숨김), 연결은 AI 정리 결과 넣기와 같은 `app_basket_confirm_links`(사유 고정 `직접 연결`, 직접 쓴 요약) 1회 호출, 할 일은 홈 빠른 입력과 같은 `createGoogleTask`를 쓴다(BASKET-수동연결). 만든 할 일은 `basket-note-tasks.js`가 그 메모 `metadata.tasks`(최신 먼저, 최대 50개)에 기록한다: owner RLS REST PATCH로 metadata만 쓰고 updated_at(원문 버전)은 바꾸지 않으며, `updated_at`·첫 번째 할 일 일치 조건으로 동시 수정을 막는다. 기록 실패는 안내만 하고 할 일을 다시 만들지 않는다. 메모 읽기 화면의 '이 메모로 만든 할 일'은 `basket.js`가, 할 일 화면 목록·편집창의 '출처 메모'는 `google-tasks.js`가 그리며, 출처 조회는 목록 1회 `metadata` contains 묶음 조회다. 두 화면 사이 이동은 같은 모듈의 1회용 요청(로그인 사용자·업무 공간 일치, 1분)으로 넘기고, 출처 메모 링크 주소는 `?view=basket&note=`이다(BASKET-할일출처). 메모 읽기 화면의 [쓰기요청 후보]·후보 상자는 UI-디자인손질에서 없앴다(`basket-write-request.js` 삭제). 이미 저장된 `metadata.write_request`는 지우지 않고 화면에서 무시하며, 할 일 기록의 `noteTaskGuard`는 그 값(`marked_at`)을 그대로 조건에 넣어 남은 metadata를 덮어쓰지 않는다. Web2는 Drive 원장에 쓰지 않고 ChatGPT를 부르지 않는다(BASKET-4b-2). 메모 읽기 화면의 원문 칸은 `basket.js`의 `paintReadText`가 공용 `markdown-view.js`(순수 변환 `markdown-render.mjs`, 모양 `markdown-view.css`)로 마크다운·Mermaid·수식을 정화해 그리며, [원문 그대로 보기]는 저장된 글을 그대로 보인다. 라이브러리는 `app/markdown-lib/` 같은 주소 반입본(버전 `scripts/markdown/md-pin.json`)이며 Mermaid·KaTeX는 그 요소가 있는 글에서만 불러온다(MD-표시, `docs/markdown-view.md`). 연달아 나오는 그림은 칩 하나로 접어 누를 때만 불러오고, `> [!NOTE]` 등은 강조 상자로, 원문의 `https://chatgpt.com/share/<id>`는 원문 칸 위 카드(`renderShareCards`)로 보인다. 홈·바구니 빠른 입력(`home-quick.js`)은 붙여 넣은 완전한 HTML 문서를 기존 첨부 업로드로 .html 첨부로 바꾸고, 메모 읽기 화면은 .html 첨부를 `html-frame.js`의 sandbox iframe(allow-scripts만, 앞머리 CSP로 네트워크 차단)으로 보이며 내용은 `document-actions` `html-view`(읽기 전용, 2MB)로 받는다(MD-표시보완). 메모 수정 화면의 [큰 창에서 수정](옛 [크게 쓰기])은 공용 전체 화면 편집기 `md-editor.js`(도구 막대 `md-editor-ops.mjs`, 텔레그램 변환 `md-telegram.mjs`, 모양 `md-editor.css`)를 연다. 편집기는 `body`에 붙는 `.modal` 하나를 단독으로 그리고 스스로 저장하지 않으며(메뉴 [쓰기]처럼 여는 쪽이 `save.run`을 넘기면 [저장]이 그 기존 저장을 부를 뿐이다), 글은 고칠 때마다 수정 칸으로 돌아가 기존 [수정 저장] 흐름으로 저장된다(MD-편집기, `docs/markdown-view.md` 8절). 메모 읽기 화면(UI-디자인손질): 맨 위 "‹ 바구니"(목록으로)와 이 메모의 [⋯](수정·원문 그대로 보기·보관·삭제), 본문 아래 한 줄에 연결(색 점 칩)·날짜, 큰 버튼은 [연결하기]·[할 일 만들기] 둘. 목록용 [⋯]([AI 분류 요청]·[GPT 답변 가져오기])는 목록에서만 보인다. [AI 분류 요청]을 누르면 복사 뒤 ChatGPT에 붙여 넣고 답을 [분류 결과 입력]에 넣으라는 안내 한 줄이 나온다.

- 일정: `calendar-view.js`가 보기 선택(list/week/month)·범위·목록 추가 조회·기기별 저장을 단독 소유한다. `calendar-list-view.js`는 목록 DOM·추가 조회 감지, `calendar-week-view.js`는 월~일 7줄 DOM, `calendar-month-view.js`는 월간 DOM의 유일한 renderer다. `calendar-day-items.js`의 날짜별 항목 계산·일정 줄·할 일 링크·포커스 복귀를 목록과 주간이 공유하며, `home-read-model.js`의 KST·배타적 종료·월요일 주 경계를 재사용한다. 주간은 KST 7일 범위 1회 조회하고 목록만 14일 분할·추가 조회한다. 범위는 `calendar-persistence.js`에 전달하며 Google 선택·캐시·owner/sequence 기반 stale-response 방어를 공유한다. `calendar-tasks.js`는 날짜 제한 없는 Google 목록을 모든 보기에 전달한다. `calendar-day-overflow.js`는 월간 날짜·+N과 목록·주간 할 일 링크의 공통 날짜 창을 그린다. persistence는 Google 선택·조회만 담당하며 DOM을 직접 그리지 않는다. 새 일정·수정은 기존 Google 저장 경로를 사용하고 프로젝트 주요 일정의 연결도 유지한다. 나머지 `calendar-*`는 생성·편집·OAuth 복귀·날짜 상세 등 명시적 보조 기능을 담당한다.
- 할 일: `task-*`. 할 일 줄의 [X] 삭제(TASK-삭제버튼)는 `google-tasks.js`가 5초 되돌리기 대기 뒤 Google Tasks `delete`를 보낸다. TASK-삭제유지: 대기 중 다른 화면·다른 탭으로 가도 대기가 끝나면 삭제하며, 취소는 [되돌리기]를 누를 때와 로그인이 바뀔 때뿐이다. 페이지를 닫으면(`pagehide`) 대기를 버리고 삭제하지 않는다(닫히는 페이지에서 보낸 삭제는 결과를 확인할 수 없으므로 할 일이 남는 쪽). 다른 화면에서 삭제가 실패하면 할 일을 되돌리고 알림으로 알린다.
- 프로젝트: `project-*`
- 회의: `meeting-*`
- 자료실: `library-upload.js`. 바구니 메모 첨부의 [자료실로 보내기]는 `basket-library-send.js`가 `document-actions` `register-basket-attachment`를 1회 호출하고(결과 불명은 다시 보내지 않음), 보낸 첨부의 [자료실에서 보기]는 같은 모듈의 1회용 요청(로그인 사용자·업무 공간 일치, 1분)으로 자료실 화면에 그 자료 id를 넘긴다. 자료실은 목록을 불러온 뒤 그 행으로 이동·포커스하며, 행이 필터에 가려지면 검색·프로젝트 필터만 비운다(BASKET-4b-1, UI-바구니버튼정리).
- 게시/현장공유: `page-editor-fix.js`
- HWP 편집기(HWP-편집기 1·2단계·메뉴 입구): `?view=hwp` 한 화면(`#hwpView`)을 `hwp-lab.js`가 유일하게 그린다. ☰ 메뉴·사이드바 [HWP 편집]으로 들어가며(하단 탭에는 없음), 옛 주소 `?view=hwp-lab`은 `app-router.js`·`view-loader.js`의 `VIEW_ALIAS`로 이 화면이 된다. `loadAll`에 넣지 않아 다른 화면은 편집기를 불러오지 않는다. 고정 버전 rhwp 편집기(`hwp-lab/rhwp-0.8.7/`, `scripts/hwp-lab/build-rhwp-studio.sh`로 다시 만들고 직접 고치지 않음)를 `hwp-frame.js`가 `sandbox="allow-scripts"` iframe(allow-same-origin 없음)으로 연다. 편집기는 Web2 창·로그인 정보·저장소·API에 닿지 못하고 파일은 MessagePort로만 주고받는다. 편집기 HTML의 CSP와 `hwp-lab/studio-guard.js`는 그대로 둔다. 메뉴로 열면 내 기기 파일 편집([파일 선택]·[내 기기에 저장](HWP 다운로드)·[자료실에 올리기]: `library-upload-request.js` 1회용 요청으로 기존 자료실 [+ 자료 등록] 창에 파일을 채워 열 뿐 업로드는 기존 흐름), 자료실 ⋯ 메뉴·바구니 첨부의 [편집]은 `hwp-drive.js` 1회용 요청(로그인 사용자·업무 공간 일치, 1분)으로 같은 화면을 Drive 편집 모드로 연다. 열기·덮어쓰기는 `document-actions` `hwp-open`·`hwp-overwrite`, 새 파일 저장은 기존 `library-files`·`basket-files`를 쓴다. 저장 형식은 HWP 하나. 절차·결정은 `docs/hwp-editor.md`.

## 5. 알림 모듈 안정화

`notification-center-ui.js`는 2차 안정화에서 다음 옛 구조를 제거함.

- 전역 `MutationObserver`
- capture 단계의 전역 클릭 가로채기
- 12초 `setInterval` polling

알림 화면 진입은 `KPTURouter.on('notifications', ...)`에서 명시적으로 처리함. 프로젝트 초대·할 일 배정 수락/거절 및 읽음 처리는 알림 화면의 명시적 액션으로 처리함. 포커스 복귀 시에도 알림 화면이 실제로 열려 있을 때만 갱신함.

## 6. 비활성 파일 격리

현재 진입 경로에서 로드되지 않는 과거 보정 모듈은 `app/legacy/`로 격리함. Task 13에서 공개 페이지와 프로젝트 공유를 되살릴 수 있던 격리 모듈은 제거함.

- `editable-page.js`
- `meeting-detail-patches.js`
- `page-preview-tools.js`
- `project-child-header.js`
- `project-hierarchy-ui.js`
- `startup-speed.js`

`app/legacy/README.md`에 격리 원칙을 기록함. 새 기능에서 legacy 파일을 다시 import하지 않고, 필요한 과거 구현은 현재 소유 모듈에 통합함.

## 7. 변경 규칙

- 화면 이동은 `app-router.js`만 담당함.
- 새 창·판·상세 화면은 열 때 기록 1개를 갖고 뒤로 가기로 가장 위의 것부터 닫혀야 함(2절 "뒤로 가기"). 화면별 popstate 임시 처리·지연 덮어쓰기를 만들지 않음.
- 같은 버튼에 여러 모듈이 `onclick`/`click`을 중복 등록하지 않음.
- 세션 refresh 로직을 기능 모듈에 새로 만들지 않고 `runtime-client.js`를 사용함.
- DOM 생성 시점을 기다리기 위한 전역 `MutationObserver`는 최후 수단으로만 사용함. 가능하면 명시적 이벤트를 사용함.
- 단순 CSS 변경을 JavaScript 주입 모듈로 만들지 않음.
- 새 기능은 기존 소유 모듈에 통합하는 것을 우선함.
- 비활성 파일은 바로 삭제하지 않고 의존성 검사 후 `legacy`에 격리함.
- 사용자 기능 변경과 인증·세션 구조 변경을 한 커밋에 섞지 않음.

## 8. 자동검사

### 정적·구조 smoke test

`.github/workflows/app-smoke-check.yml`에서 아래를 검사함.

- 최상위 JavaScript 문법 검사
- `app.js`에서 시작하는 재귀 의존성 및 누락 파일 검사
- 공용 라우터·공용 세션 런타임·핵심 모듈 버전 검사
- 알림 모듈의 전역 observer/polling/capture interceptor 재유입 방지
- 일정·할 일·프로젝트·회의 모듈의 기능별 refresh/session 저장 로직 재유입 방지
- legacy 파일의 앱 루트 재유입 방지
- 정적 HTTP로 앱 진입 파일 접근 검사

### 브라우저 E2E

`.github/workflows/app-e2e-check.yml`과 `tests/app-e2e/workspace.spec.mjs`를 추가함.

Playwright Chromium에서 Supabase 응답을 테스트 상태로 대체하고 아래 핵심 흐름을 실제 브라우저 클릭으로 확인함.

- 이메일 로그인
- 메뉴 이동
- 일정 저장
- 할 일 저장
- 프로젝트 생성
- 회의 결과 저장
- 성명·보도자료와 게시판 진입
- 알림 화면 진입 및 프로젝트 초대 수락

두 검사는 작업 브랜치의 매 커밋마다 실행하지 않고 `main` 반영 또는 `main` 대상 Pull Request에서 실행하도록 제한함. 개발 중간 실패 메일이 반복되는 문제를 줄이고, 반영 직전 회귀검사에 집중함.

## 9. 2차 안정화 이후 운영 방식

2차 안정화 이후에는 별도의 대규모 구조개편을 계속하지 않음.

1. 기능 개발은 기존 소유 모듈에 통합함.
2. 변경 전후 정적 smoke와 브라우저 E2E를 회귀 기준으로 사용함.
3. 실패가 발생한 기능 단위만 수정함.
4. 인증·Android OAuth·DB 구조는 별도 필요가 확인되지 않는 한 유지함.
5. 새 보정 파일을 늘리기보다 공용 라우터·공용 런타임·명시적 이벤트 구조를 유지함.
