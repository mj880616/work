# 웹2 앱 구조

## 1. 진입 경로

현재 런타임 진입은 아래 한 경로를 기준으로 함.

1. `index.html`
2. `app.js`
3. `loader-v2.js`
4. `runtime-client.js`, `app-router.js` 등 공용 코어
5. 기능 모듈

`index.html`은 `app.js`만 직접 로드함. 기능 모듈 추가·삭제는 원칙적으로 `loader-v2.js`에서 관리함.

캐시 버전(CI-버전자동화 3단계): 저장소의 HTML·JS·CSS는 번호 없는 경로로 서로를 부르고 `?v=`를 손으로 쓰지 않음. GitHub Pages 배포 빌드(`.github/workflows/pages-deploy.yml` → `scripts/build-pages.mjs`)가 저장소 안 파일을 가리키는 정적 경로마다 그 파일 최종 내용의 SHA-256 앞 10자를 `?v=`로 붙임. 잎부터 계산하므로 기능 모듈이 바뀌면 `view-loader.js` → `loader-v2.js` → `app.js` → `index.html`의 해시가 차례로 바뀜. 빌드가 건드리지 않는 것: `${…}`가 든 동적 경로, 저장소 밖 주소·저장소에 없는 파일, 폴더 이름에 판 번호가 든 외부 라이브러리(`hwp-lab/rhwp-0.8.7/`, `markdown-lib/mermaid-11.17.2/` 등) 안쪽, 스크립트가 읽는 JSON 자료(`press/archive.json`), JSON 파일 안의 주소(`windows-manifest.json`의 아이콘). JS 안 문자열이 저장소 파일 경로와 같으면(예: `'./app.js'`) 빌드가 그 문자열에도 `?v=`를 붙이므로, 경로 문자열을 비교·표시용으로 쓰지 않음. 저장소 소스에 손으로 쓴 `?v=`는 CI(`scripts/check-loader-cache.mjs`)가 막음.

`desk.bokdoong.com`의 Cloudflare Worker(`cloudflare/bokdoong-router.mjs`)는 `?v=` 파일의 내용이 `app/asset-manifest.json`(해당 `?v=` 값과 SHA-256)과 같을 때만 엣지에 보관하고 브라우저에 1년 `immutable`로 보냄. 다르면(배포 전파 중 옛 내용 등) `no-cache`로 보내고 보관하지 않음. 목록은 배포 빌드가 같은 결과물에서 만들며 저장소에는 없음(`scripts/check-pages-build.mjs`가 해시·목록·Worker 판정을 검사함).

이미 옛 내용을 `immutable`로 받아 둔 브라우저는 다시 묻지 않으므로, Worker는 Web2 페이지(HTML) 응답에 브라우저마다 한 번 `Clear-Site-Data: "cache"`를 붙여 HTTP 캐시를 비우게 함(쿠키 `kptu_cache_epoch`로 한 번만). 다시 전체를 비워야 하면 Worker의 `CACHE_EPOCH`를 바꿔 배포함(§6 정지 지점).

## 2. 화면 전환 소유권

화면 전환은 `app-router.js`가 단독 소유함.

- 기본 메뉴: `index.html`의 `.app-nav [data-view]`, 폰 하단 `.mobile-tabs`, 메뉴 창의 `.mobile-menu-panel`을 라우터가 함께 관리함
- 홈 카드 등 이동 버튼: `data-goto`
- 모바일(760px 이하, 8-9e-2): 하단 탭은 홈·바구니·일정·프로젝트·담당조직·메뉴 6칸이고, 앞의 다섯 칸과 같은 순서로 밀기 전환함(메뉴는 밀기 대상 아님). [일정] 탭(`data-mobile-schedule-tab`)은 달력(`calendar`)과 할 일(`tasks`) 두 화면을 맡으며, 라우터가 화면을 바꿀 때 그 탭의 `data-view`를 마지막으로 본 쪽으로 맞춤(새 저장소 없음). 두 화면 위의 `[달력 | 할 일]` 전환(`.schedule-switch [data-view]`)도 라우터의 `data-view` 이동임. 옛 `?view=tasks`와 홈 "할 일 ›" 등 할 일로 가는 이동은 그대로 `tasks` 화면을 열고 [일정] 탭이 선택됨. 회의·자료실·성명·보도자료·게시판·계정은 [메뉴] 탭(`#mobileMenuTab`)이 여는 메뉴 판에서 열며(오른쪽 위 ☰는 폰에서 숨김) topbar-actions.js가 메뉴 이력과 계정 노드 이동을 소유함. 폰 메뉴 판(UI-디자인손질)은 하단 탭 바로 위로 올라오는 판으로, 위쪽 손잡이(누르면 닫힘, 아래로 밀면 닫힘)·큰 칸 3×2([쓰기]·회의·자료실·HWP 편집·성명·보도자료·게시판)·"계정" 상자(내 프로필·화면 색·로그아웃)이고, 바깥 누르기·Esc·뒤로 가기로도 닫힘. 성명·보도자료는 한 칸(`data-view="media"`)이며 폰 머리줄 이름도 "성명·보도자료" 하나임. [쓰기](`data-menu-write`, 폰 메뉴 판·761~1023px ☰·PC 사이드바)는 topbar-actions.js가 공용 `md-editor.js`를 빈 글로 열고 [저장]을 누르면 바구니 빠른 입력과 같은 `basket-data.js`의 `createNote`로 새 메모 하나를 만든다(새 저장 경로·DB 변경 없음). 저장하지 않고 닫은 글은 이 탭 메모리에만 남아 다음 [쓰기]에서 이어지고(브라우저 저장소에 두지 않음), 로그인이 바뀌면 비운다. 저장 뒤 `kptu:basket-note-created`로 바구니 목록이 보이고 있으면 다시 읽음. 761~1023px는 가로 메뉴와 ☰, 1024px 이상은 사이드바를 유지함
- 모바일 하단 고정(8-9e-2): 홈·바구니 빠른 입력(`home-quick.js`)은 하단 탭 바로 위에 붙고, 자판이 열리면 자판 바로 위로 올라감(뷰포트 `interactive-widget=resizes-content`, 지원하지 않는 브라우저는 `--kptu-keyboard-inset`). 폰 자판 감지(UI-키보드하단바)는 `accessibility-dialog.js` 한 곳(`KPTUA11y.keyboard`)이 앱 전체에서 맡는다: 760px 이하에서 입력 칸(textarea·input·select·contenteditable)에 초점이 있고 화면이 120px 넘게 줄면 `body.kptu-mobile-keyboard`(하단 탭 숨김, `--kptu-mobile-tab-height` 0)·`--kptu-keyboard-inset`·초점 있는 창의 `.modal-action-footer[data-keyboard-open]`을 함께 켜고, 화면이 다시 커지면 끈다(버튼을 누르느라 초점이 빠져도 화면이 커질 때까지 유지, 확대만으로는 켜지 않음). 쓰기 창·홈 빠른 입력·검색 등 모든 화면이 같은 상태를 쓰며 화면별 감지를 새로 만들지 않는다. 전체 화면 편집기(`md-editor.js`)는 폰에서 하단 탭 위에서 끝나고, 탭을 누르면 편집기가 먼저 닫힌 뒤 그 탭으로 간다(글이 있는 메뉴 [쓰기]는 먼저 "저장 안 하고 닫을까요?"). 넓은 화면(761px~, UI-쓰기창PC탭유지)에서는 같은 편집기가 앱 메뉴(`#appView>.app-nav`: 1024px~ 왼쪽 세로, 761~1023px 위쪽 한 줄)를 덮지 않고 그 옆·아래 본문 자리에서만 열린다. 자리는 `placeBesideNav()` 하나가 메뉴 위치를 재어 `--md-editor-left`·`--md-editor-top`만 정하고(화면별 보정·지연 덮어쓰기 없음), 메뉴 항목을 누르면 폰 하단 탭과 같은 `onTab` 규칙이 적용되며, Tab 키 순환은 `accessibility-dialog.js`의 선택 인자 `companions`로 메뉴를 포함한다. 일정·할 일·프로젝트·자료실·회의·바구니 [노트]·일기의 추가 버튼은 같은 버튼을 하단 탭 위 오른쪽의 동그란 [+] 모양으로만 바꿈(ui-standard.css). 위치는 그 규칙 하나(화면 기준 `position:fixed`)가 정하므로 화면 칸(`.view-panel`)과 조상에 `transform`·`will-change`·`filter`·`contain`처럼 fixed의 기준을 바꾸는 값을 두지 않는다. 폰 밀기 전환(`mobile-swipe-navigation.js`)은 손가락을 옆으로 끌 때만 칸을 `left`로 옮기고, 손가락을 대기만 해서는 칸에 아무것도 바꾸지 않는다(UI-일기손질: 예전에는 누를 때마다 `will-change:transform`이 붙어 [+]가 잠깐 칸 아래로 갔다 돌아왔다). 밀기는 목록 위뿐 아니라 내용이 없는 빈 곳에서도 시작되며(라우터의 보이는 화면 칸이 따라 움직임), 열린 창(`.modal:not(.hidden)`·`dialog[open]`·보이는 `role=dialog`/`aria-modal`, [분류 결과 입력] 시트 포함)이 있으면 시작도 확정도 하지 않고, 입력칸·고른 글·실제로 가로 스크롤되는 줄에서는 시작하지 않는다(새 전역 상태 없음, UI-밀기전환). [일기]의 [+]는 고른 날짜(있으면 고치기), 고른 날이 없으면 오늘을 쓴다. 홈 빠른 입력(HOME-빠른입력정리)은 위에서부터 [할 일]의 프로젝트·기한 줄(할 일일 때만) → [바구니]·[할 일]·[업데이트 ▾] → 입력칸 순서이고, [업데이트] 옆 ▾(`data-quick-org`)가 기존 고르기 시트로 조직을 고르며 고른 조직은 입력칸 안내 글자로 보인다. 전환 버튼·필터의 고른 쪽은 어디서든 회색(`--ds-kind-other`), 안 고른 쪽은 흰 바탕이다(UI-선택표시통일, ui-standard.css). 크기(UI-버튼크기): 큰 버튼(`--ds-control-height` 46px)은 그 화면의 주 동작만 쓰고, 전환은 왼쪽에 붙은 작은 세그먼트(홈 [바구니|할 일|업데이트 ▾]·바구니 [메모|노트]·폰 [달력|할 일]·일정 ☰/▦·일정 창 [일정|할 일]), 필터·날짜 고르기는 알약 칩(바구니 [미분류·분류·보류]·자료실·회의·성명 필터·할 일 [오늘·내일·날짜]), 보조 버튼은 32px(`--ds-compact-*`, theme-tokens.css)이다. 보이는 높이는 32px이고 누르는 범위는 `::after`로 위아래를 늘려 44px. 전환·필터는 기기 기본 탭 하이라이트를 끄고(`-webkit-tap-highlight-color:transparent`) 누르는 동안 고른 쪽과 같은 회색이다. 홈 빠른 입력칸은 세 모드 모두 한 줄(46px)에서 시작해 `home-quick.js`의 `size()`가 글에 맞춰 늘리고 5줄에서 멈추며(그 뒤 칸 안 스크롤), [추가]는 첫 줄 옆 46px 그대로다(바구니 화면 입력칸은 CSS 높이 그대로). 바구니는 [메모|노트] 오른쪽에 필터를 한 줄로 두며(`basket.js`의 `.basket-switch-row`), 목록이 숨으면 CSS(`:has`)로 필터도 숨는다. 폰 전환 줄(UI-버튼작게 ③): 760px 이하에서 일정 네 화면의 `.schedule-switch`와 바구니 `.basket-kind-switch`는 아래 탭 바로 위 한 줄(줄 높이 44px = `--kptu-switch-dock`, 가운데 알약 32px)에 화면 기준 fixed로 놓이고(ui-standard.css 한 곳), 그리는 주인은 그대로 각 화면의 그 요소 하나다(복사본 없음). 이때 바구니 위쪽 줄에는 필터만 남는다. 자판이 열리면(`body.kptu-mobile-keyboard`) 아래 탭과 함께 숨고 `--kptu-switch-dock`은 0. 공용 [+]·빠른 입력·목록 끝 여백·알림은 `--kptu-switch-dock`만큼 위로 올라간다. PC는 위쪽 그대로. 바구니·노트 읽기 화면 아래 버튼(메모 [연결하기][할 일 만들기], 노트 [수정][텔레그램용 복사][연결하기])은 한 줄 32px(누르는 범위 44px), 쓰기 창 서식 도구줄 버튼은 28px(`--ds-compact-height-sm`, 누르는 범위 44px)이다. 이 줄과 목록 머리는 `basket.js`의 `paintListChrome()` 하나가 그리며, 메모나 노트가 열려 있으면 숨기고 그 자리에는 열린 쪽의 "‹ 바구니"·"‹ 노트"만 보인다(UI-일기손질 ⑥). 폰 위 상태줄·아래 버튼줄 색은 앱 바탕(`--kptu-bg`): `index.html`·`login/index.html`의 `meta theme-color`(밝게·어둡게)와 manifest `theme_color`이고, 계정 테마를 바꾸면 topbar-actions.js가 지금 켜진 쪽 meta를 그 테마의 `--kptu-bg`로 맞춘다. 시작 화면(스플래시)과 폰 하단 시스템 내비게이션 바(삼성 등 일부 기기가 manifest `background_color`를 씀)는 manifest `background_color`를 따르며 앱 밝은 바탕(`#f3f1ea`)이다. manifest는 테마별 값을 둘 수 없어 어두운 테마 사용자도 이 값이다(UI-하단바색)
- 좌상단 브랜드: 홈으로 이동
- PC 사이드바 묶음(UI-PC메모노트·UI-PC일정묶음): [바구니] 아래 [업데이트]·[노트], [일정] 아래 [달력]·[할 일]·[업무일지]·[일기]가 항상 펼친 하위 메뉴(`.nav-sub`, 1024px~만 보임). 일정 하위 줄은 기존 `data-view`(달력은 상위와 같은 화면이라 `data-goto`)라 라우터가 그대로 이동·선택 표시를 맡고, 상위 [일정](`data-nav-group`)은 네 화면 어디서든 고른 모양(현재 페이지 표시는 달력에서만). 761~1023px 위쪽 한 줄 메뉴는 같은 버튼을 옮겨 쓰므로 예전 순서 그대로다. 주소·내부 이름(`journal` 등)은 그대로이고 화면 이름만 "업무일지". 달력·업무일지·일기 화면(`.view-wide`)은 PC에서 같은 바깥 폭 규칙(`view-wide.css`, view-loader가 세 화면에 함께 불러옴) 하나를 쓴다.

성명·보도자료는 메뉴의 한 칸(`media`)에서 열고, 게시판은 현장 공유 페이지를 관리함. 개인 배지·구성원 관리·메시지 화면은 앱 셸에서 제거했으며 기존 개인 화면 URL은 홈으로 귀결됨. 단, 내 프로필(`profile`, 담당 사업장·프로젝트 편집)은 [계정 ▾] 맨 위 [내 프로필]에서만 열림: 버튼이 `KPTURouter.go('profile')`를 부르면 `view-loader.js`가 처음에 `profile-settings.js`·`profile-settings.css`를 불러오고(시작 로더·`loadAll`에는 없음) 그 모듈이 `#profileView`를 만든 뒤 자료를 읽음. `?view=profile` 주소로 시작하거나 새로고침해도 같은 방식으로 이 화면이 열림(`?view=hwp`와 같음). 포토룸 화면·코드는 삭제했으며(TASK-포토룸삭제 1단계) `?view=photos`는 홈으로 귀결되고 주소에서 폐기된 `view`를 제거함(기본 홈). 저장된 사진·DB 기록은 DB 정리 때 따로 다룸.

TASK-팀AI삭제 1단계에서 조직 상세의 주간보고·타임라인 AI 초안과 비활성 프로젝트 AI 초안 호출을 제거함. 조직의 저장된 주간보고 열람·수정과 타임라인 수동 관리는 유지하며, `?view=ai`·`?view=team-ai` 같은 옛 주소는 홈으로 귀결됨. `team-ai` Edge와 AI 기록은 별도 2단계 대상임.

D-4a ②는 실제 `#homeView`의 읽기 칸을 독립 조회한다. `?view=home`과 브랜드, 기본 `/app/`는 홈으로 가며 일정은 `?view=calendar`이다. 홈이 남아 있는 project query보다 우선하고, 안드로이드 뒤로의 마지막 복귀(Web2 첫 기록에서)는 home이다.

뒤로 가기(BUG-뒤로가기): 열린 것(창·메뉴 판·고르기 시트·화면 안 상세)이 있으면 뒤로 가기는 가장 위의 것 하나를 닫고, 아무것도 열려 있지 않을 때만 이전 탭으로 간다. 열린 것마다 같은 주소의 기록 1개를 갖는 것이 규칙이며, 브라우저·PWA의 뒤로 가기와 안드로이드 앱 뒤로(`native-back-guard.js`의 `KPTUNativeBack` v3 → `KPTURouter.back()`)는 같은 기록을 한 칸 되돌리므로 결과가 같다. 앞으로 만드는 창·화면도 이 규칙을 따른다: `.modal`은 `mobile-modal-history.js`가 폰 폭(760px 이하, 또는 `data-kptu-history-all`)에서 기록을 붙이고, 화면 안에서 여는 상세(바구니 메모 등)는 `KPTURouter.layer.open(name,{close})`로 연다. 화면의 닫기(‹·Esc)는 스스로 닫은 뒤 돌려받은 `close()`를 불러 그 기록을 되돌린다(‹와 뒤로가 같은 결과). 뒤로로 닫힐 때 여는 쪽의 `close({fromBack:true})`가 `false`를 돌려주면(저장 안 한 글을 버리지 않음) 기록을 다시 쓰지 않고 그 칸으로 돌아간다. 다른 탭으로 옮기면 그 화면의 layer는 라우터가 잊고(여는 쪽은 `kptu:view-changed`에서 닫음), 남은 기록은 다음 뒤로 가기에서 건너뛴다. 안드로이드는 Web2의 첫 기록에서 홈이 아니면 홈으로, 홈이면 누름을 소비한다(앱은 닫지 않음, 기존 APK 결정). 바구니 메모와 노트(`basket-notes.js`)는 목록에서 열면 목록 스크롤 위치를 기억했다가 뒤로·‹로 닫을 때 되돌린다.

고르기 시트(`choice-sheet.js`, 모양 `choice-sheet.css`)는 폰(760px 이하)에서 메뉴 판·쓰기 창처럼 하단 탭 바로 위에서 올라오고 탭을 덮지 않는다(자판이 열려 탭이 숨으면 화면 맨 아래). 탭 위에 겹쳐 있으면 맨 아래 줄을 누른 뒤 같은 자리를 한 번 더 누를 때(시트는 이미 닫힘) 그 아래 탭이 눌려 다른 화면으로 갔다(BUG-내보내기탭이동). 시트를 쓰는 모든 곳(쓰기 창 [내보내기]·"저장 안 하고 닫을까요?", 홈·바구니 빠른 입력, 바구니 [연결하기], 일정 창 프로젝트)이 이 한 규칙을 따른다.

누른 자리 펼치기(UI-PC팝업위치): 넓은 화면(761px~)에서는 같은 고르기 시트가 아래에서 올라오지 않고 누른 버튼 바로 아래(자리가 없으면 위, 위아래 모두 없으면 옆)에 작은 목록으로 열린다. 화면을 어둡게 하지 않고, 바깥 누름·Esc·×로 닫히며, 열 때 고른 항목(없으면 첫 항목)에, 닫을 때 누른 버튼에 초점이 간다. 너비 360px(조직 칩처럼 한 줄에 여럿 놓는 목록은 480px), 높이는 최대 480px(칩 560px)이고 남는 것은 목록 안에서 스크롤된다. 창 크기 바꾸기·바깥 스크롤에는 버튼을 따라가고, 버튼이 화면 밖으로 나가거나 사라지면 닫힌다. 폭이 760px 이하로 바뀌면 그 자리에서 하단 시트가 된다. 위치 계산은 `anchored-popup.js` 하나가 맡는다: `placeAnchored(panel, anchor, {maxWidth, maxHeight})`가 `position:fixed`인 판의 자리·최대 높이를 정하고(창 밖으로 나가지 않음), `followAnchor(panel, anchor, {place, lost})`가 스크롤·창 크기 변경을 따라가며 돌려준 `stop()`으로 끝낸다. `isWide()`가 폰/PC 구분이다. 고르기 시트(`createChoiceSheet`)는 이 둘을 이미 쓰므로 여는 쪽은 `open(kind, trigger)`만 부르면 되고, 버튼이 아닌 다른 상자 옆에 펼칠 때는 `open(kind, trigger, anchor)`(초점은 trigger로 돌아감), PC에서도 하단 시트로 두려면 `anchored:kind=>false`를 준다. ⋯ 메뉴처럼 시트가 아닌 작은 판도 같은 두 함수로 자리를 잡는다(새 위치 계산을 만들지 않음). 노트의 ⋯ 메뉴(UI-노트메뉴정리: 목록 줄·열린 노트 공용 `#noteDocMenu`, 폰·PC 같은 항목, `basket-notes.js`)가 그 예다. 노트 줄 미리보기 글(마크다운 기호 제거·제목 중복 제거)과 [복사] 내용은 `note-preview.mjs`가 맡는다. 노트 폴더(UI-노트폴더 1단계, `docs/design/note-folders.md`): 폴더는 노트 행의 기존 `metadata.folder`(이름 하나, 1~20자, 최대 30개, 노트에만, DB 변경 없음)이고 폴더 목록은 노트들이 가진 이름을 모은 것이다(따로 저장하지 않아 노트 없는 폴더는 이 화면 메모리에만 잠시 있음). 검색칸 아래 한 줄 [전체]·폴더들·[폴더 없음](공용 `filter-chips.js`) + 줄 끝 폴더 ⋯([새 폴더]·[폴더 이름 바꾸기]·[폴더 지우기])를 `basket-notes.js`가 그리고, 노트 ⋯의 [폴더로 옮기기]는 공용 고르기 창(`createChoiceSheet`)을 연다. 고른 폴더는 모듈 메모리에만 둔다. 폴더·고정 쓰기는 `basket-data.js`의 한 경로(`patchNoteMetadata`)가 다시 읽고 다른 metadata 칸을 그대로 두며 `updated_at`·`pinned_at`·`folder`가 읽은 때와 같을 때만 저장한다(`updated_at`은 바꾸지 않음). 폴더 이름 바꾸기·지우기는 노트마다 저장하고, 중간에 실패한 노트는 [다시 시도]로 마저 한다. [바구니로 돌리기]는 같은 조건 저장으로 `folder`를 지운다.
노트 첨부(NOTE-파일붙이기): 노트의 파일은 업데이트와 같은 `app_notes.attachments`(DB 변경 없음)이고, 올리기는 같은 `basket-files`에 노트 id를 보내는 한 경로(`basket-upload.js`의 `uploadNoteFiles`, 사진 글자 읽기 없음)다. 서버가 행의 `kind=note`를 보고 Drive "Web2 바구니/노트 첨부"(공유된 폴더 거절)에 올린다. 노트 입력칸(`home-quick.js` noteOnly)은 업데이트 입력칸과 같은 클립·끌어 놓기를 쓰고 [추가] 때 노트를 먼저 만든 뒤 파일을 올린다(파일만이면 첫 파일 이름이 제목). 큰 편집 창(`md-editor.js`)의 `attach.inTools(kind)`가 [📎 첨부]를 서식 도구줄 맨 끝에 두며(쓰기 창 [노트]·노트 [큰 창에서 수정]), 고른 파일 목록은 본문 아래에 남는다. 첨부는 본문 아래 공용 파일 줄(종류·이름·크기·[Drive에서 열기]) + ⋯ → [빼기](`basket-data.js`의 `detachNoteFile`: 다시 읽고 `updated_at`이 같을 때만 `attachments`에서 그 항목만 지움, Drive 무변경). 본문 없이 파일만 있는 노트는 "본문이 없는 노트입니다." 상자 없이 파일 줄만 보인다. 노트 삭제는 연결과 노트만 지우고 파일은 Drive에 남긴다(`deleteNoteOriginal`의 `keepFiles`).
고르기 창 내용(UI-고르기창개선, PC만): `choice-sheet.js`가 프로젝트 줄(`projectRow`/`projectRows`)과 조직 묶음 줄(`orgGroupRows`)을 함께 만든다. `render()`가 `search`(검색칸 이름)를 돌려주면 목록 위(스크롤 밖)에 검색칸이 생기고 이름으로 거른다(빈 묶음·칸 숨김, ↓로 첫 항목). PC 목록에서 프로젝트는 한 줄에 하나·작은 체크칸·하위는 들여쓰기와 흐린 글자(↳ 없음)·고른 줄 연한 초록이고, 담당조직은 묶음마다 한 줄(왼쪽 묶음 이름, 오른쪽 24px 칩, 고른 칩 초록 + ✓, 이름은 줄이지 않음)이다. 묶음과 순서는 `organization-order.js` 하나(철도/지하철/민자철도/민간도시철도, 밖은 "그 외")이며, 묶음에 든 조직이 없으면 묶음 이름 없이 한 묶음이다. 폰(아래 시트)은 검색칸·묶음 이름·체크칸 없이 예전 모양 그대로다. 쓰는 곳: 바구니·노트 [연결하기]의 담당조직·프로젝트와 할 일 만들기 프로젝트, 홈·쓰기 창 [업데이트 ▾] 기록할 곳, 홈 [할 일] 프로젝트, 일정 창 프로젝트. 할 일 상세의 "연결할 프로젝트·조직" 체크 목록(`google-tasks.js`, 창이 아닌 체크 목록)도 PC에서 하위 ↳를 숨기고 들여쓰기·흐린 글자, 조직 묶음 이름을 보인다(열 수는 #776 규칙 그대로).
기록할 곳 창(UI-기록할곳창PC·UI-기록할곳되돌리기): `render()`가 `split:true`를 주는 창(홈·쓰기 창 [업데이트 ▾])은 넓은 PC(1024px~)에서 너비 최대 880px·버튼 아래 남은 높이(최대 760px)로 열리고, 검색칸이 제목 옆으로 가며, "최근" 한 줄 아래에 왼쪽 담당조직 / 오른쪽 프로젝트 두 열(`data-sheet-col`)이 놓인다. 항목이 많으면 창이 아니라 각 열 안에서만 스크롤된다. 761~1023px와 폰은 예전처럼 위아래(최근 → 담당조직 → 프로젝트). 조직·프로젝트에 업데이트를 추가하면 홈 입력은 바구니(미분류)로 돌아가고, 방금 쓴 곳은 다시 불러오거나 로그인이 바뀌기 전까지 "최근" 맨 앞에 남는다(`update-places.js`의 `rememberPlace`, 메모리만). 추가 없이 다른 화면에 다녀오거나 [크게] 창을 저장 없이 닫아도 바구니로, 추가가 실패하면 고른 곳을 유지한다. 홈 [할 일]의 [프로젝트 ▾]도 추가가 끝나면 "프로젝트 없음"으로 돌아간다.

창 머리 고정(UI-팝업머리고정): 모든 창(`.modal-card`)의 맨 위 제목 줄(`.modal-head`, 닫기 × 포함)은 폰·PC 모두 창 위에 붙어 있고 본문만 스크롤된다(base-ui.css 한 규칙). 저장 버튼은 창 아래 고정 줄(`.modal-action-footer`)에 둔다: 이미 그 줄이 있던 창(일정·할 일·프로젝트 만들기 등)은 그대로, 저장이 내용 끝에 있던 창(자료 정보 수정, 담당조직 추가·담당자 지정, 협의회·사업단 소속, 타임라인 추가, 주간보고 수정, 회의 결과 수정)은 이 줄로 옮겼다(폰 엄지 위치, 자판이 열리면 줄은 제자리). PC 할 일 상세 칸(`#gtDetailPane`, 창이 아닌 화면 안 칸)만 저장을 제목 줄 × 옆에 둔다(#766). 새 창도 제목 줄은 `.modal-card`의 첫 자식 `.modal-head`, 저장은 `.modal-action-footer`에 둔다.

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
- `my-organizations.js`: "내 담당 조직"(ORG-담당13기준)의 유일한 정의. 원본은 소유자의 담당 연결(`app_suborganization_assignees`, 내 프로필 → 담당 사업장)과 활성 조직의 교집합이고, 담당 0개·조회 실패면 활성 전체다. 바구니 담당조직 목록(`basket-ai-handoff.js`·`basket-manual-link.js`)과 업무일지 조직 소식·주간보고 초안(`journal-data.js`, 담당 밖 조직 기록은 "그 외" 한 묶음)과 주간보고 한글 파일의 내 담당 조직 줄(`journal-hwpx.js`, 별칭 포함, 띄어쓰기 무시)이 쓴다. Drive 사본(`supabase/functions/drive-summary/basket.mjs`)은 배포 사본을 두고 검사로 같음을 확인한다. 순서·묶음은 `organization-order.js`가 맡는다.
- `collection-status.js`: 홈 "마지막 수집 시각" 칸(OPS-수집점검)의 유일한 renderer. 소유자일 때만 탭당 10분에 한 번 `drive-summary` GET `?action=status`(사본 폴더 시각·단계 코드만, `refreshSession:false`)와 `app_todo_radar_state.last_success_at`(owner RLS 읽기)을 읽는다. 사본 24시간·챙길 것 찾기 48시간을 넘거나 마지막 실패가 성공보다 나중이면 "주의"를 보인다. 텔레그램 수집·통화 전사는 Web2 권한(`drive.file`) 밖이라 직접 읽지 않고, 같은 상태 응답의 `collectors`(통화 전사용 앱 스크립트가 `POST ?action=heartbeat`로 보낸 시각·건수, OPS-수집점검 2단계)로 보인다. 텔레그램 26시간(매일 07:30 1회 수집)·통화 전사 72시간을 넘으면 "주의 · 오래됨", 신호 자체가 3시간 넘게 없으면 "주의 · 점검 신호 끊김", 아직 신호가 없으면 "점검 신호 없음". 옛 함수(`collectors` 없음)면 두 줄은 "확인 불가"로 남는다. 함수 미배포(405·네트워크)·표 없음(404)·기록 없음은 그 줄을 숨기고, 확인할 줄이 없으면 칸을 숨긴다. 상태는 이 모듈 메모리에만 있다.
- `drive-summary.js`: Drive 읽기용 사본(조직·프로젝트 문서 2개, Edge `drive-summary`) 저장 뒤 자동 갱신(ORG-사본자동갱신). 화면 표시·버튼 없음(계정 메뉴 [사본 갱신]은 #870에서 없앰). `loader-v2.js`가 소유자 작업공간에서 한 번 불러온다. `kptu:api-saved`(사본이 읽는 표·열이 바뀐 성공 저장만)·`kptu:documents-changed`(프로젝트 자료 삭제)와 `team.js`의 `KPTUDriveSummary.saved()`(자료 저장·회의 저장·회의 파일 업로드)를 받아 마지막 저장 3분 뒤(처음 저장부터 최대 10분) 본문 없는 POST 한 번을 보낸다. 부르는 중 들어온 저장은 끝난 뒤 한 번 더 묶는다. 화면이 가려지거나 닫히면(`visibilitychange` hidden·`pagehide`) 기다리던 갱신을 keepalive 요청으로 바로 보낸다. 실패는 알리지 않고 다시 시도하지 않는다(원본 저장과 무관). 놓친 변경은 하루 2번 예약 실행(`.github/workflows/drive-summary-refresh.yml`, 06:17·13:17 KST)이 채운다. 상태는 이 탭 메모리에만 있다.

### 업무 기능

- 홈: `home-read.js`가 읽기 칸의 유일한 renderer, `home-read-model.js`가 KST 날짜·주 경계와 선택 규칙을 소유한다. `/app/` 기본은 홈이며 일정은 `?view=calendar`이다. 날짜·메뉴 셸을 먼저 공개한 뒤 각 칸을 독립 조회하고, Google 목록·확정 연결·프로젝트 카탈로그·조직 목록은 공유한다. 완료 상태는 `google-tasks.js`의 toggleTask·3초 settling·기존 변경 이벤트를 쓴다. 빠른 입력은 D-4a ③ 범위다.

- 바구니: `basket.js`가 목록·상세·보기 선택의 유일한 renderer다. `basket-data.js`가 홈과 공유하는 글 검증·app_notes REST와 note_id 연결 조회·상태 계산을 소유한다. 분류 상태는 확정 연결 또는 첨부가 프로젝트·담당조직 자료인지(첨부 `drive_file_id` = `app_documents.file_id`, 먼저 등록된 자료의 `project_id`·`organization_id`)로 정한다. [자료로 넣기]는 연결 기록을 만들지 않으므로 그 메모는 이 자료 조회로 [미분류]에서 빠지고 "○○ · 자료"(조직이면 "담당조직 자료: ○○ · 자료") 칩이 보이며, 자료를 옮기거나 프로젝트에서 빼면 다음 읽기(`kptu:documents-changed`)에서 따라 바뀐다. 따로 저장하는 상태는 없다(BUG-자료넣기미분류). 메모 상세는 읽기 화면(원문·첨부·연결 상태)으로 열고 [수정]을 눌러야 편집 화면과 자판이 열린다(BASKET-보기모드). 원문·작성 중 글·보기 선택은 브라우저 영구 저장소에 두지 않으며, 목록 재진입 기본은 미분류다. 목록 거르기(UI-바구니거르기)는 [미분류 N]·[분류]·[보류] 세 칸이다: [미분류]는 보관되지 않았고 아직 어디로도 가지 않은 메모(제안만 저장된 메모도 여기, "정리 제안 있음"), [분류]는 확정 연결·[자료로 넣기] 자료·이 메모로 만든 할 일(`metadata.tasks`) 중 하나가 있는 메모, [보류]는 보관한 메모(`archived_at`, 이름만 바꿈). [분류]를 고르면 바로 아래 한 줄에 분류된 곳 칩 [전체·담당조직·프로젝트·자료실·할 일](공용 `filter-chips.js`)이 나오고 `basket-data.js`의 `notePlaces`가 이미 읽은 것만으로 거른다: 확정 연결의 대상 종류(조직·프로젝트·자료실 `document_id`), [자료로 넣기] 자료는 프로젝트·자료실 양쪽, 할 일은 `metadata.tasks`. 그 아래 한 줄 더(UI-바구니거르기2): [담당조직]·[프로젝트]는 [모든 ○○ N] + 연결된 메모가 있는 조직·프로젝트 이름 칩(많은 순), [자료실]은 자료 분류 칩(`document-categories.js`의 현재 분류 목록과 `categoryOf`, 연결된 자료와 [자료로 넣기] 자료의 `category`)이며 `placeSubOptions`가 만든다. [전체]·[할 일]은 이 줄이 없다. 두 줄 모두 넘치면 옆으로 민다. 새 저장·상태 저장소는 없고(기존 읽기에 자료 `category` 열만 더 읽음) `noteState`(drive-summary와 같은 기준)는 바꾸지 않았다. 고른 칸·칩은 이 모듈 메모리에만 있고 바구니에 다시 들어오면 [미분류]·[전체]부터다. 홈의 기존 모드 기억 키는 유지하고 저장된 모드가 없으면 바구니가 기본이다. 조직 업데이트는 BASKET-2b 전까지 기존 경로를 쓴다. 연결 해제(링크 1행 삭제)와 메모 원문 삭제(연결은 `note_id` cascade)는 `basket-record-delete.js` 하나가 확인·요청·결과 재확인을 소유하며, 첨부가 있는 메모는 `basket-files`의 `note-delete`가 첨부를 Drive 휴지통으로 옮긴 뒤 로그인 사용자 JWT로 메모를 지운다(서버가 이 동작을 모르는 구버전 응답이면 기존 REST 삭제로 메모만 지우고 첨부는 Drive에 남는다, BASKET-삭제). 조직·프로젝트 상세의 연결 기록(`basket-link-records.js`)과 바구니 읽기 화면의 [삭제]가 함께 쓴다(BASKET-연결해제삭제). 연결 해제는 네 화면이 같은 방식으로 한다(BUG-바구니연결해제): 조직 상세(`basket-link-records.js`)·프로젝트 상세(`project-system-v3.js`)의 🧺 기록 줄은 줄 누르기 = 원래 메모 열기, 줄 끝 ⋯ = [메모 열기]·[연결 해제](조직 상세는 [요약 수정]·[원문 삭제]도 함께, 프로젝트 상세는 해제만), 바구니 목록 메모 줄과 메모 화면의 조직·프로젝트 연결 칩은 ×(44px, 이름 "○○ 연결 해제")이고 메모 화면 칩 누르기는 그 조직·프로젝트를 연다. 확인은 `basket-record-delete.js`의 `disconnectWithUndo` 한 곳에서 "○○ 연결을 해제할까요? 메모는 남아요" 한 번, 해제 뒤 5초 [되돌리기]는 새 저장 경로 없이 기존 `app_basket_confirm_links`(사유 `직접 연결`, 원래 요약)로 같은 곳을 다시 잇는다(보관·AI 제외 메모 등 RPC가 거절하면 안내만). 알림은 열린 대화상자 안에 붙어 초점 순환에 들어간다. 회의·자료실 연결 칩은 되돌릴 경로가 없어 ×를 두지 않는다. 해제·되돌리기 뒤 네 화면은 기존 `kptu:basket-links-changed`로 다시 읽는다(바구니는 열린 메모·작성 중 입력을 두고 연결만 다시 읽음). 파일만 있는 메모의 [자료로 넣기]는 프로젝트와 담당조직에 같은 흐름·같은 부품으로 한다(UI-바구니첨부메모 PR 3): `basket-manual-link.js`가 대상을 고르고 `basket-file-docs.js`의 `putFilesIntoTargets`가 `document-actions` `register-basket-attachment`(첨부당 1회, Drive 파일은 한 곳에만)로 자료를 등록한 뒤 바뀐 열(`project_id`/`organization_id`)만 PATCH하고 돌려받은 행을 확인한다. 글이 있는 메모는 요약 기록(연결)과 파일 자동 등록을 함께 한다. 바구니 읽기 화면의 [연결하기]·[할 일 만들기]는 `basket-manual-link.js`가 상세 안의 한 칸에만 그리며(편집 중·패널 열림 중에는 읽기 버튼을 숨김), 연결은 AI 정리 결과 넣기와 같은 `app_basket_confirm_links`(사유 고정 `직접 연결`, 직접 쓴 요약) 1회 호출, 할 일은 홈 빠른 입력과 같은 `createGoogleTask`를 쓴다(BASKET-수동연결). 만든 할 일은 `basket-note-tasks.js`가 그 메모 `metadata.tasks`(최신 먼저, 최대 50개)에 기록한다: owner RLS REST PATCH로 metadata만 쓰고 updated_at(원문 버전)은 바꾸지 않으며, `updated_at`·첫 번째 할 일 일치 조건으로 동시 수정을 막는다. 기록 실패는 안내만 하고 할 일을 다시 만들지 않는다. 메모 읽기 화면의 '이 메모로 만든 할 일'은 `basket.js`가, 할 일 화면 목록·편집창의 '출처 메모'는 `google-tasks.js`가 그리며, 출처 조회는 목록 1회 `metadata` contains 묶음 조회다. 두 화면 사이 이동은 같은 모듈의 1회용 요청(로그인 사용자·업무 공간 일치, 1분)으로 넘기고, 출처 메모 링크 주소는 `?view=basket&note=`이다(BASKET-할일출처). 메모 읽기 화면의 [쓰기요청 후보]·후보 상자는 UI-디자인손질에서 없앴다(`basket-write-request.js` 삭제). 이미 저장된 `metadata.write_request`는 지우지 않고 화면에서 무시하며, 할 일 기록의 `noteTaskGuard`는 그 값(`marked_at`)을 그대로 조건에 넣어 남은 metadata를 덮어쓰지 않는다. Web2는 Drive 원장에 쓰지 않고 ChatGPT를 부르지 않는다(BASKET-4b-2). 메모 읽기 화면의 원문 칸은 `basket.js`의 `paintReadText`가 공용 `markdown-view.js`(순수 변환 `markdown-render.mjs`, 모양 `markdown-view.css`)로 마크다운·Mermaid·수식을 정화해 그리며, [원문 그대로 보기]는 저장된 글을 그대로 보인다. 라이브러리는 `app/markdown-lib/` 같은 주소 반입본(버전 `scripts/markdown/md-pin.json`)이며 Mermaid·KaTeX는 그 요소가 있는 글에서만 불러온다(MD-표시, `docs/markdown-view.md`). 연달아 나오는 그림은 칩 하나로 접어 누를 때만 불러오고, `> [!NOTE]` 등은 강조 상자로, 원문의 `https://chatgpt.com/share/<id>`는 원문 칸 위 카드(`renderShareCards`)로 보인다. 홈·바구니 빠른 입력(`home-quick.js`)은 붙여 넣은 완전한 HTML 문서를 기존 첨부 업로드로 .html 첨부로 바꾸고, 메모 읽기 화면은 .html 첨부를 `html-frame.js`의 sandbox iframe(allow-scripts만, 앞머리 CSP로 네트워크 차단)으로 보이며 내용은 `document-actions` `html-view`(읽기 전용, 2MB)로 받는다(MD-표시보완). 노트 읽기 화면(`basket-notes.js`)도 같은 `paintHtmlAttachments`(html-frame.js)로 본문 아래에 같은 칸막이를 그리고, 본문 글 없이 HTML만 있으면 "본문이 없는 노트입니다." 대신 HTML이 보인다(BUG-노트HTML표시). 메모 수정 화면의 [큰 창에서 수정](옛 [크게 쓰기])은 공용 전체 화면 편집기 `md-editor.js`(도구 막대 `md-editor-ops.mjs`, 텔레그램 변환 `md-telegram.mjs`, [내보내기] ② 한글용 복사 변환 `md-hangul.mjs`(쓴 번호 기호·`-`·`*`·`>`는 쓴 대로, 들여쓰기만 노조 번호 단계, `@1`~`@50` → ①~㊿, `docs/markdown-view.md` 9절), 모양 `md-editor.css`)를 연다. 편집기는 `body`에 붙는 `.modal` 하나를 단독으로 그리고 스스로 저장하지 않으며(메뉴 [쓰기]처럼 여는 쪽이 `save.run`을 넘기면 [저장]이 그 기존 저장을 부를 뿐이다), 글은 고칠 때마다 수정 칸으로 돌아가 기존 [수정 저장] 흐름으로 저장된다(MD-편집기, `docs/markdown-view.md` 8절). 노트는 [마크다운] 체크를 노트마다 기존 `metadata.markdown`(true/false, DB 변경 없음)에 두고, 값이 없는 기존 노트는 `note-markdown.mjs`가 본문의 마크다운 기호(## 머리·**굵게**·표·``` 등)로 판정한다. 해제된 노트는 읽기 화면·복사가 쓴 그대로이고, 편집기는 미리보기 없이 쓰는 칸 하나에 글자로 되는 꾸밈(- ·1. ·☐ ·────)만 바로 넣고 나머지는 켤지 묻는다. 노트 [큰 창에서 수정]은 `keepOpen`이라 저장해도 창이 그대로이고(저장했어요), ✕·Esc는 저장 뒤 바뀐 것이 있으면 한 번 묻는다(NOTE-마크다운선택·NOTE-큰창저장유지). 마크다운 표시는 날짜로 시작하는 줄(2026. 10. 21.)을 번호 목록으로 읽지 않는다(`markdown-render.mjs` guardDateLines). 메모 읽기 화면(UI-디자인손질): 맨 위 "‹ 바구니"(목록으로)와 이 메모의 [⋯](수정·원문 그대로 보기·보관·삭제), 본문 아래 한 줄에 연결(색 점 칩)·날짜, 큰 버튼은 [연결하기]·[할 일 만들기] 둘. 목록용 [⋯]([AI 분류 요청]·[GPT 답변 가져오기])는 목록에서만 보인다. [AI 분류 요청]을 누르면 복사 뒤 ChatGPT에 붙여 넣고 답을 [분류 결과 입력]에 넣으라는 안내 한 줄이 나온다.

- 일정: `calendar-view.js`가 보기 선택(list/week/month)·범위·목록 추가 조회·기기별 저장을 단독 소유한다. `calendar-list-view.js`는 목록 DOM·추가 조회 감지, `calendar-week-view.js`는 월~일 7줄 DOM, `calendar-month-view.js`는 월간 DOM의 유일한 renderer다. `calendar-day-items.js`의 날짜별 항목 계산·일정 줄·할 일 링크·포커스 복귀를 목록과 주간이 공유하며, `home-read-model.js`의 KST·배타적 종료·월요일 주 경계를 재사용한다. 주간은 KST 7일 범위 1회 조회하고 목록만 14일 분할·추가 조회한다. 범위는 `calendar-persistence.js`에 전달하며 Google 선택·캐시·owner/sequence 기반 stale-response 방어를 공유한다. `calendar-tasks.js`는 날짜 제한 없는 Google 목록을 모든 보기에 전달한다. `calendar-day-overflow.js`는 월간 날짜·+N과 목록·주간 할 일 링크의 공통 날짜 창을 그린다. persistence는 Google 선택·조회만 담당하며 DOM을 직접 그리지 않는다. 새 일정·수정은 기존 Google 저장 경로를 사용하고 프로젝트 주요 일정의 연결도 유지한다. 나머지 `calendar-*`는 생성·편집·OAuth 복귀·날짜 상세 등 명시적 보조 기능을 담당한다.
- 시간 입력(FORM-시간입력): 시간이 있는 창(일정 만들기·수정, 회의 만들기·수정, 프로젝트 주요 일정)은 공용 `time-input.js` 하나를 쓴다. 시간 칸은 숫자 자판 글 칸(`data-time-input`)으로 `0900`→`09:00`, `930`→`09:30`이 되고, 읽을 수 없는 시각은 칸 아래 안내(`aria-invalid`·`aria-describedby`)를 띄운다. 일시 칸은 옛 id의 숨은 칸(`data-datetime-input`)이 날짜 고르기(`#id`+`Date`)와 시간 칸(`#id`+`Time`)을 그리고, 숨은 칸의 `.value`는 예전 `YYYY-MM-DDTHH:MM` 그대로라 저장 경로는 바뀌지 않는다. 일정 종료는 `linkEventEnd`가 맡는다: 손대지 않은 종료는 시작 + 2시간, 사용자가 고친 종료(수정 창은 불러온 종료)는 시작을 옮길 때 길이를 유지하고, 자정을 넘으면 종료 날짜가 다음 날이 되며, 종일 일정은 건드리지 않는다. 일정 수정 창에도 장소 칸이 있고 Edge `google-calendar`의 기존 `location`으로 저장한다. Google 일정 저장 실패 안내는 일정 만들기·수정 창 모두 `calendar-save-notice.js` 하나가 정한다: 로그인 만료·서버 확인·Google 거절(HTTP 400·401)은 "저장하지 않았음"으로 알리고 다음 저장을 바로 보내며, 응답을 받지 못한 경우만 "결과 모름"으로 두어 다음 클릭에서 Google의 실제 위치를 먼저 읽는다(쓰기 없음). Google·서버 영어 원문은 화면에 내지 않고 개발용 console에만 남긴다. 종일↔시간 전환은 Edge가 반대쪽 `date`/`dateTime`을 `null`로 보내 지운다(Google PATCH 병합).
- 할 일: `task-*`. 입력(UI-할일입력): [할 일] 화면에는 공용 [+]가 없고, 목록 위(PC)·폰 아래 전환 줄 바로 위에 늘 보이는 입력 칸 + [추가]가 있다. `google-tasks.js`가 화면을 처음 열 때 공용 빠른 입력(`home-quick.js`의 `taskOnly`, 바구니 메모 입력과 같은 상자)을 한 번 붙이며, 저장은 홈 빠른 입력 [할 일]과 같은 `createGoogleTask` 1회이고 기한은 늘 오늘(KST)이다(프로젝트·날짜는 기존 편집 창에서). 실패하면 글을 남기고, 결과를 확인하기 전에는 새로 만들지 않는다. 폰 위치·자판 처리는 홈·바구니 빠른 입력 규칙(ui-standard.css 8-9e-2)을 그대로 쓴다. [달력]·[일기] 등은 [+] 그대로. 할 일 줄의 [X] 삭제(TASK-삭제버튼)는 `google-tasks.js`가 5초 되돌리기 대기 뒤 Google Tasks `delete`를 보낸다. TASK-삭제유지: 대기 중 다른 화면·다른 탭으로 가도 대기가 끝나면 삭제하며, 취소는 [되돌리기]를 누를 때와 로그인이 바뀔 때뿐이다. 페이지를 닫으면(`pagehide`) 대기를 버리고 삭제하지 않는다(닫히는 페이지에서 보낸 삭제는 결과를 확인할 수 없으므로 할 일이 남는 쪽). 다른 화면에서 삭제가 실패하면 할 일을 되돌리고 알림으로 알린다. 할 일 조작 통일(UI-할일조작통일): 홈 [오늘 할 일] 줄의 제목 칸은 이 화면의 수정 창(`openEditor`)을 그대로 열고, 달력 날짜 목록(`calendar-day-overflow.js`)의 할 일 줄은 동그라미(완료·완료 취소) 옆에 ⋯ 버튼(`calendar-tasks.js`가 `anchored-menu.js`로 여는 완료/완료 취소·삭제 메뉴)을 둔다. 삭제는 수정 창 [삭제]와 같이 확인 창을 거쳐 `google-tasks.js`의 `deleteTask`(기존 Edge `delete`)를 부르며 Edge 변경은 없다.
- 업무일지(JOURNAL-일지 2단계, `?view=journal`): `journal.js`가 `#journalRoot`의 유일한 renderer다(이번 주 월~일 날짜 줄·주 넘기기, 고른 날 맨 위 "오늘 한 줄", 아래 그날 재료). 저장은 "오늘 한 줄" 목록(`app_notes` kind=work, 날짜당 1행, 본문에 줄을 저장 순서대로 `\n`으로 이음 — JOURNAL-오늘한줄목록, 줄마다 300자·하루 50줄은 `20261020051027_journal_work_lines` 적용 뒤) 하나뿐이고 `journal-data.js`가 기존 owner RLS REST로 읽고 쓴다(새 날은 POST, 아는 날은 본 판 `updated_at` 조건 PATCH, 마지막 줄을 지우면 그 행 DELETE. 화면이 몰랐던 날의 409나 그사이 바뀐 행은 다시 읽어 같은 변경을 한 번 더 적용). [저장]은 입력칸 글을 아래 목록 끝에 더하고 입력칸을 비우며, 줄을 누르면 그 자리에서 고치기 칸 [저장][취소][삭제](삭제 뒤 5초 공용 [되돌리기], 팝업·⋯ 없음; PC는 줄마다 [수정][삭제]가 마우스를 올리거나 키보드 초점일 때 보임). 아래 칸(JOURNAL-일지카드정리)은 일정(`google-calendar` events)·끝낸 할 일(`google-tasks` tasks)·조직 소식(그날 업데이트를 조직 이름별로 묶음, 조직·프로젝트 어디에도 안 보낸 것은 '미분류': 바구니 행 `readBasket`의 확정 연결·[자료로 넣기] 조직 + `app_suborganization_updates`)·회의·행사 결과(그날 `meeting_at`인 `app_meetings` 행)이고, JOURNAL-주간보고허브 1단계로 그 뒤에 프로젝트 소식(`app_project_progress_updates` + 프로젝트로만 보낸 바구니 업데이트, 프로젝트별 — 순서는 `project-catalog.js` 프로젝트 순서, 그 목록을 못 읽으면 이름순 — 조직 소식 '미분류'에서 옮김)·할 일 예정(같은 `google-tasks` 응답의 미완료 할 일, 마감일 기준, 서버 기본 범위)·자료실 새 자료(그 주 `created_at`인 `app_documents`, 분류 표시)·공유 페이지(그 주 `updated_at`인 `app_share_pages`)가 붙는다. 저장하지 않고 화면에서만 모으며(주 범위·칸 제한·개수 제한, 긴 본문 안 읽음) 읽기마다 따로 실패·[다시 시도]한다. 그날 빈 묶음은 상자 없이 맨 아래 "기록 없는 묶음" 한 줄로 접는다. 업데이트 하나는 첫 줄(또는 연결 요약) 한 항목이다. [주간보고 초안 복사]는 날짜마다 그날 줄들(저장 순서, 한 줄씩) + 날짜별 재료(화면 순서)를 글로 복사(`md-editor.js` `copyText`)까지만 한다. 요청 표시(JOURNAL-요청표시): 바구니 업데이트 행의 기존 `metadata.requests`(`exec_schedule` 임원 일정 배정 요청·`discussion` 논의 요청, 이 순서, 없으면 키 없음, DB 변경 없음)이고 종류·읽기·확인값·꼬리표는 `update-requests.js` 하나가 정한다. UI-요청버튼삭제로 화면에서 켜고 끄는 버튼(입력칸 아래·업데이트 상세)은 없앴고 새로 쓰지 않는다(필요하면 업데이트 글 안에 그 단어를 쓴다). 이미 저장된 표시는 그대로 읽으며, 노트 고정·폴더 쓰기(`basket-data.js` `patchNoteMetadata`)와 할 일 기록(`noteTaskGuard`)은 다른 키를 그대로 두고 `requests`도 조건에 넣어 지우지 않는다. 바구니 목록 줄과 업무일지 하루 카드 항목 앞에 같은 꼬리표를 보이고, [주간보고 초안 복사]에는 표시별 맨 앞 묶음을 두지 않고, 표시된 업데이트는 원래 속한 조직 소식·프로젝트 소식 묶음에 꼬리표를 단 채 들어간다. 노트로 옮긴 업데이트(5-2 A): [노트로 옮기기](`basket-data.js` `moveToNote`)가 그 행의 `metadata.moved_from_update_at`(옮긴 시각, DB 변경 없음)을 남기고(읽고 다시 쓰되 다른 키는 그대로, `updated_at`·표시·다른 쓰기 주체의 키를 조건으로 건 PATCH), 업무일지는 이 표시가 있는 `kind=note` 행만 id·제목·원래 업데이트 날(`occurred_at`)·표시로 따로 읽어(`readMovedNotes`, 본문 안 읽음, 실패해도 일지 나머지는 그대로) 그날 칸에 "노트: (제목)" 한 줄로 보인다(노트 아이콘, 누르면 그 노트 열림). `GROUPS`에 넣지 않아 주간보고 초안에는 없고, 표시가 없는 노트(처음부터 쓴 노트·표시 도입 전에 옮긴 노트)는 일지에 나오지 않는다. [하루 | 주간 정리](JOURNAL-주간보고허브 2단계): 날짜 줄 위 작은 전환(고른 쪽은 메모리에만). [주간 정리]는 날짜 줄·하루 카드를 숨기고 같은 주의 같은 읽기(한 번만 읽음)를 상집보고 양식 순서로 보인다 — 1. 요청사항(임원 일정 배정·논의 요청, 재료가 없어 "아직 재료 없음" 자리만, 입력 없음) → 2. 요약 표(사업영역=1단 → 세부 과제=2단 → 진행 상황, 담당 팀원 칸은 비움; 프로젝트 트리·순서는 `project-catalog.js`, 3단 기록은 "세부과제 › 사안: 내용", 트리 밖 프로젝트는 표 아래 이름별)·회의·행사 결과(회의 날짜) → 4. 산하 조직 현황(조직 소식 순서) → 참고(일정·한 줄·끝낸 할 일·자료실·공유 페이지·기타 메모). 노트로 옮긴 업데이트는 넣지 않는다. 묶음 만들기·그리기는 `journal-weekly.js`가 하고 `journal.js`가 자기 칸에 부른다(렌더러 하나). 묶음 자체는 저장하지 않고, [주간보고 초안 복사] 글은 그대로. [주간보고 한글 파일 만들기](WEEKLY-한글초안 2단계, `docs/design/weekly-hwpx-draft.md` 13절): `journal-hwpx.js`가 `[data-journal-hwpx]` 상자의 유일한 renderer다(`journal.js`는 자리만 주고 주·읽기가 바뀌면 `setWeek`·`refresh`로 알림, 주가 바뀌면 초안을 닫음). 지난주 팀 확정본은 자료실 분류 "주간보고 확정본" 최신 행(기존 `document-actions` `hwp-open`) 또는 기기 파일이고, HWP 5 ↔ .hwpx 바꾸기는 HWP 편집기와 같은 칸막이 엔진(`hwp-frame.js`, 숨긴 sandbox iframe), 표 읽기·빈 서식·보고서 만들기·규격 검사는 `weekly-hwpx/*.mjs`(브라우저 `CompressionStream`, 외부 라이브러리 없음)가 기기 안에서 한다. 내 칸만(담당 팀원 칸 = 프로필 이름, 산하조직·투쟁 사업장 = `my-organizations.js`) 고칠 칸으로 보이고 그 주 묶음의 기록을 이름이 같은 줄 옆에 [붙이기]로 준다. 바탕과 다른 줄만 파란 글씨. [확정]은 한 번 묻고 기존 `library-files`로 자료실(분류 "주간보고 개인본", 제목·날짜를 줘서 서버가 내용을 읽지 않음)에 1회 저장한다. 브라우저 저장소·새 DB·새 Edge 없음.
- 챙길 것(JOURNAL-챙길것 1단계 + AI-서버연동 S5, `docs/design/todo-radar.md` 10·11절): `todo-radar.js`가 홈 `[data-home-card="radar"]`(주요 일정 바로 아래, 폰은 빠른 입력 아래·오늘 일정 위로 `arrangeHome`이 함께 옮김)와 업무일지 `[data-journal-radar]`(하루 카드 위, [주간 정리]에서는 숨김)의 유일한 renderer다. `home-read.js`·`journal.js`는 빈 자리를 만들고 고른 날만 알린다. 자료·서버 호출은 `todo-radar-data.js`: owner RLS 표 `app_todo_candidates`·`app_todo_radar_state`(migration `20261021075034`)를 공용 런타임 REST로 읽고 상태만 조건부 PATCH(`status=eq.open` 등)한다. 찾기는 서버 `ai-assist` `kind=todo_radar`가 하며 화면은 `{kind,mode}`만 보낸다(`auto` = 이 탭에서 하루 처음 열 때 한 번, 서버도 오늘 이미 찾았으면 건너뜀 / `again` = [다시 찾기]). [할 일로]는 제목·기한을 고친 뒤 기존 `createGoogleTask` 1회(출처의 프로젝트·조직·회의 연결), 그 뒤 후보를 `tasked`로 표시하고 출처가 업데이트면 기존 `recordNoteTask`로 그 업데이트에도 남긴다. 결과를 모르면 다시 만들지 않는다. [무시]는 5초 [되돌리기](`offerUndoNotice`). 상대 약속은 서버가 저장하지 않고 응답으로만 주며 화면은 [원장으로 복사]만 준다. 이미 미완료 할 일과 같은 제목은 보이지 않는다(할 일 모듈이 가진 목록, 새 요청 없음). 홈 카드는 보일 후보·약속이 없으면 접히고(업무일지 상자는 [다시 찾기]와 함께 남음), 화면 요청은 후보 읽기 1회 + `ai-assist` 1회(하루 처음)뿐이다. 브라우저 저장소에 아무것도 두지 않으며, 표나 함수가 아직 없으면(404) 상자를 숨긴다.
- 프로젝트: `project-*`. 단계(PRJ-3단, `docs/design/project-3-levels.md`): 프로젝트는 최대 3단(상위 → 하위 → 그 아래)이며 제한은 화면 규칙이다(DB는 `parent_id`만 저장, 순환·4단 방지 트리거는 아직 없음). `project-system-v3.js`의 상위 고르기는 1·2단 트리에서 자기·자기 아래·4단이 되는 곳을 빼고, 저장 직전 같은 검사(`parentProblem`)를 한 번 더 한다. 목록은 `catalog.tree` 순서의 들여쓰기 트리(3단 `data-ps3-depth="2"`), 3단 상세에는 하위 칸이 없고 계층 줄은 `1단 › 2단`, 색은 맨 위 프로젝트의 연한 톤. 순서(PRJ-순서바꾸기): 형제 순서는 기존 `app_spaces.sort_order` 하나이고(낮은 번호 먼저, 같으면 `created_at`, DB 변경 없음) `project-order.mjs`가 규칙을, `project-catalog.js`가 모든 목록(tops·kids·tree·options·basketProjects)에 적용한다. 프로젝트 화면에서 PC는 목록 줄을 같은 단계 형제 줄 위로 끌어다 놓고, 폰은 목록 머리 [순서 바꾸기]를 눌러 줄마다 ↑ ↓로 바꾼다(그동안 줄을 눌러도 상세가 열리지 않고, 머리 버튼은 [완료]; 상세 ⋯에는 순서 버튼이 없다). 저장은 소유자 PATCH로 형제 번호만 10, 20, …으로 다시 매기며 `parent_id`는 쓰지 않는다(상위 바꾸기는 [수정]에서만). 기록할 곳·할 일 연결·자료실·업무일지 프로젝트 소식·[주간 정리]·주간보고 한글 파일이 모두 이 목록 순서를 따른다. 기록할 곳 창(`update-places.js` → `choice-sheet.js`)은 검색으로 걸러질 때만 3단 줄에 경로를 붙이고(검색은 이름만), 자료실 거르기는 고른 프로젝트 아래 자료까지 함께 보인다(세부 줄의 3단 칩은 `2단 › 3단`). 상세에는 접힌 '메모' 칸이 없다(UI-프로젝트화면정리: 저장된 `app_project_comments` 행은 그대로 두고 읽지 않음). 기록 목록(조직·프로젝트 상세, UI-기록아이콘)은 같은 확정 연결을 `readLinkRecords({noteKinds:['basket','note']})`로 읽어 노트도 함께 보이고, 줄 앞 표시는 `basket-link-records.js`의 업데이트·노트 아이콘(`recordMark`, 🧺 없음)이다. 노트 줄은 노트 읽기 화면을 열고(`requestNoteDocFrom`), 돌아오기·뒤로 가기는 업데이트와 같은 규칙이다.
- 회의: `meeting-*`
- 자료실: `library-upload.js`. 바구니 메모 첨부의 [자료실로 보내기]는 `basket-library-send.js`가 `document-actions` `register-basket-attachment`를 1회 호출하고(결과 불명은 다시 보내지 않음), 보낸 첨부의 [자료실에서 보기]는 같은 모듈의 1회용 요청(로그인 사용자·업무 공간 일치, 1분)으로 자료실 화면에 그 자료 id를 넘긴다. 자료실은 목록을 불러온 뒤 그 행으로 이동·포커스하며, 행이 필터에 가려지면 검색·프로젝트·분류 필터를 비운다(BASKET-4b-1, UI-바구니버튼정리). 분류 칩은 사용자 분류 목록(`app_profiles.document_categories`, 기본 7개, [기타]는 고정)이며 목록은 `document-categories.js`가 읽고 `kptu:document-categories-changed`로 알린다. [편집](종류 칩 줄 맨 끝, 접근성 이름 "분류 편집") 창의 '분류 목록' 편집(추가·이름 바꾸기·지우기)은 `document-category-editor.js`가 소유하고, 서버 호출은 `app_document_category_add/rename/delete` 세 함수뿐이다(저장 값은 그대로 두고 화면이 옛 이름을 현재 목록으로 대응, 권한 판단은 서버). 담당조직 상세의 [자료] 묶음(`workplace-detail.js`, 최근 5개 + "전체 N개 보기 ›")의 전체 보기는 새 화면 없이 `window.KPTULibrary.showOrganization`으로 자료실을 그 조직으로 걸러 연다(조직 거르기 칩은 자료실을 떠나면 풀린다). 조직의 [조직에서 빼기]는 `organization_id`만 비우고 자료·파일은 그대로 둔다. 거르기 줄은 검색·프로젝트 칩 줄·자료 분류 칩 줄이다. 예전 [일반 자료|회의자료만] 줄은 없앴고(UI-바구니거르기) 회의 자료는 다른 자료와 한 목록에 보이며 분류 칩 [회의](회의자료·회의결과)로 거른다.
- 공유 페이지(SHARE-현장공유 PR 2, `?view=pages`): 위쪽 `#sharePagesRoot`는 `share-pages.js`가 유일하게 그린다(내 공유 페이지 목록·[새 공유 페이지]·편집). 블록 6종의 안 모양·검사는 `share-pages-model.mjs` 한 곳이고 Web1 읽기 화면(`share/`)도 같은 모듈을 읽는다. 블록 그리기는 `sr-render.mjs`, 모양은 `sr-blocks.css` 한 벌이고 Web1 읽기 화면과 편집 화면이 함께 쓴다(SHARE-보이는편집): 편집 화면 본문은 저장될 모양(`normalizeBlocks`)을 읽기 화면과 똑같이 그리고, 블록을 누르면 그 블록 하나만 그 자리에서 입력 칸이 된다([완료]·[취소]·Esc=완료, 블록 사이 [+ 블록], 블록 ⋯=위로·아래로·삭제). 열린 블록 상태(`editing.open`)는 화면 메모리에만 있고 저장 경로는 그대로다. 저장은 PR 1의 owner RLS 표 `app_share_pages`·`app_share_page_links`를 공용 런타임 REST로(새 RPC 없음), 페이지 수정은 `updated_at` 일치 조건. 링크 값(token)은 [복사]를 누를 때만 그 한 칸을 읽어 바로 클립보드로 보내며 화면·메모리·로그·브라우저 저장소에 두지 않는다. 편집 화면은 `KPTURouter.layer`로 기록 1개를 갖는다. 옛 Web1 카드 5개(`web1-board.js`)는 아래 `<details id="web1BoardLegacy">` "이전 페이지"로 접어 그대로 둔다(S7). Web1 읽기 주소는 `https://work.bokdoong.com/work/share/#t=<64자>`이고 `share/share.js`가 `share-page-read`에 POST만 하며 받은 글은 모두 textContent로 그린다.
- 원장(AI-서버연동 S7-b, `?view=ledger`): 내 프로필 → 계정 → [원장]으로만 들어간다(메뉴·하단 탭에 없음, `loadAll`에 없음). `ledger-import.js`가 `#ledgerRoot`의 유일한 renderer이고, 파일 읽기·검사·대응표는 `ledger-import-model.mjs`(브라우저 안, 원문은 서버로 보내지 않음)가 한다. 쓰기는 SECURITY INVOKER RPC `app_import_ledger_apply`(해 보기·적용)·`_confirm`·`_revert` 한 번씩이고 읽기는 owner RLS REST와 `app_import_ledger_counts`다. 원장 표가 없으면(REST 404) "원장 표 준비 전" 안내만 그린다. 설계 `docs/design/ledger-web2.md` 7.3. S7-c: 같은 화면에 칸 두 개가 더 있고 칸마다 renderer가 하나다 — `ledger-candidates.js`가 `#ledgerCandidatesRoot`(원장 후보 [확정]·[고쳐서 확정]은 SECURITY INVOKER RPC `app_confirm_ledger_candidate` 한 번, [버림]은 대기 후보 PATCH, 확정 직후 [되돌리기](10초)·최근 확정 ⋯ [확정 취소]는 SECURITY INVOKER RPC `app_unconfirm_ledger_candidate` 한 번(함수 없으면 두 버튼 숨김), [원장 후보 만들기]는 `ai-assist` `{kind:"ledger_candidates"}`), `ledger-browse.js`가 `#ledgerBrowseRoot`(검색 RPC `app_ledger_search`와 owner RLS 읽기만). 순수 함수는 `ledger-candidate-model.mjs`·`ledger-browse-model.mjs`. 표·함수가 없으면(404) 각 칸이 조용히 숨고, 칸끼리는 `kptu:ledger-changed` 이벤트로만 알린다. Claude 후보 파일은 `#ledgerRoot`가 `app_queue_ledger_candidates`로 넣는다. 설계 15절.
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

- 로그인(세션 주입 도우미 `tests/app-e2e/helpers/session-login.mjs`; 로그인 화면은 Google 버튼만 있음)
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
