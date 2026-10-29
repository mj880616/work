# 공유 페이지 보관함 하나로 + HTML 파일 공유 페이지 (SHARE-보관함·HTML공유)

📱 폰 가능(이 문서) · DB 단계 📱 폰 경로 C 또는 승인형 DB workflow · Edge 단계 승인형 Edge workflow · 화면 단계 앱 PR

- 요청: Drive 'Web2 요청함' [10/29 08:24] 1~6. 명진 결정 10/29 08:35 "추천대로"(이름 + 무작위 글자 링크, 블록 편집 공유 페이지 유지, 5MB).
- 작성: 2026-10-29, Claude Code 웹(작업 세션). 기준 main `3e7b73e`(#1462).
- 표시: **사실** = 저장소 코드·migration·문서로 확인. **추정** = 확인 못 한 짐작. 운영 DB·Edge는 조회하지 않았다.

## 0. 한눈에

| | 정한 것 |
| --- | --- |
| 보관함 | '이전 페이지'·'지나간 업무·사업' 접힘 두 개를 없애고 공유 페이지 목록 아래 접힌 **'보관함 n' 하나**. 보관한 내 공유 페이지(날짜순) → 옛 Web1 페이지 5개(지난 사업 꼬리표 포함). 자료는 지우지 않는다 |
| HTML 종류 | 공유 페이지 표는 그대로, **HTML 판 표를 새로**. 판이 하나라도 있으면 'HTML' 종류. 새 파일로 바꾸기 = 판 추가(이전 판 보관), 링크는 그대로 |
| 링크 주소 | `bokdoong.com/s/<이름>-<무작위 8글자>` (예: `bokdoong.com/s/minja-rail-k7q2m9xa`). 이름은 명진이, 글자는 DB가. **4글자는 부족해 8글자**(3절) |
| 기존 링크와 | 같은 링크 행에 짧은 주소를 하나 붙인다. 끄기·기한·게시 상태·지문 확인·검색 차단·no-store는 기존 그대로. 긴 링크(`/work/share/?t=`)도 계속 열린다 |
| 읽는 화면 | 기존 공유 화면(`work.bokdoong.com/work/share/`)이 내용을 받아 **격리 칸**(sandbox iframe, allow-same-origin 없음) 안에서만 돌린다 |
| 저장 | HTML은 DB 비공개 표에만(owner RLS). 공개 저장소(GitHub)·Pages에 남지 않는다. 한도 5MB |
| 미리보기 제목 | 페이지 제목(올릴 때 HTML `<title>`을 기본값으로, 고칠 수 있음). Worker의 SHARE-미리보기제목 길을 그대로 쓰되 제목만 받는 요청으로 |

## 1. 지금 구조 (사실)

- 화면: `app/share-pages.js`가 `#sharePagesRoot`(목록·편집기)의 유일한 그리는 곳. 목록 아래 이미 접힌 '보관함 n'(status `archived`)이 있다(`share-pages-archive.mjs`, SHARE-페이지삭제). 그 아래 `app/index.html`의 `#web1BoardLegacy`('이전 페이지') 안에 `web1-board.js`가 그리는 옛 Web1 카드 5개, 또 그 안에 '지나간 업무 · 사업'(`main_project_archive_state`가 archived인 카드)이 따로 있다 → **접힘이 세 군데**.
- 표: `app_share_pages`(제목·블록·status draft/published/archived·휴지통 칸), `app_share_page_links`(링크 원문 token은 DB가 만듦, `token_hash`=sha256, `expires_at`, `disabled_at`), `app_share_page_media`(사진). 모두 owner RLS, anon 없음. service_role은 읽기에 필요한 칸만.
- 읽기: `share-page-read`(verify_jwt=false). `{token}` 하나만 받아 지문 → 링크(꺼짐·기한) → 게시된 페이지의 제목·블록만. 그 밖은 같은 404. 응답 no-store·noindex, CORS는 `https://work.bokdoong.com`만.
- 읽는 화면: `share/index.html`+`share.js`. 엄격한 CSP(`default-src 'none'; script-src 'self'`), noindex, no-referrer. `?t=`는 바로 `#t=`로 옮겨 다시 보내지 않는다.
- Worker(`cloudflare/bokdoong-router.mjs`): `work.bokdoong.com/work/share/?t=`에 미리보기 수집기가 오면 share-page-read로 제목만 뽑아 og:title을 바꾼다(SHARE-미리보기제목). `bokdoong.com`은 Web2 전용(`/work/app/**`)이라 `/s/`는 지금 404.
- 주소 이전 설계(`docs/design/domain-move.md` 4절): ④ Web1 삭제 뒤에도 **`share/`와 `work.bokdoong.com/work/share/`는 남긴다**(Web2와 다른 주소라 공유 화면이 Web2 로그인 정보에 닿지 않음). 옛 `s/`(Web1 옛 공유 껍데기)는 지울 목록.

## 2. 합치는 방법

### 2.1 HTML 종류

- **새 표 `app_share_page_html`**: workspace·page_id·html(글자)·file_name·bytes(생성 칸)·created_at. 더하기만(고치기 권한 없음). 가장 최근 판을 보여 준다.
- 공유 페이지 표에 '종류' 칸을 더하지 않는다. 이유: 기존 표에 열 권한을 더하는 것은 승인형 DB workflow 확장 규칙이 거절(`grant-existing`)하고, 판이 있느냐로 충분히 구분된다. HTML 페이지의 blocks는 빈 배열 그대로.
- 게시·보관·휴지통·되살리기는 **기존 status 흐름 그대로**(HTML 페이지도 `published`일 때만 열림). 휴지통 완전 삭제는 페이지 행을 지우므로 판·링크·짧은 주소가 cascade로 함께 지워진다.

### 2.2 짧은 주소

- **새 표 `app_share_page_slugs`**: 링크의 `token_hash`(unique)를 가리키고 `slug_name`(명진이 정함)·`slug_code`(DB 기본값으로만 생김)·`slug_hash`(= sha256(`이름-글자`), 생성 칸, unique).
- 링크 행 하나에 짧은 주소 하나. 끄기·기한은 링크 행이 그대로 맡으므로 **짧은 주소와 긴 주소가 늘 같이 켜지고 같이 꺼진다**. 링크를 지우면 짧은 주소도 cascade로 지워진다.
- 서버(service_role)는 `token_hash`·`slug_hash`만 읽는다. 이름·글자 원문은 owner만 읽는다(복사할 때만 읽고 화면에 남기지 않음 — 기존 token 규칙과 같음).
- 블록 페이지에도 같은 표를 쓸 수 있다(이번 화면은 HTML 페이지에서만 짧은 주소를 만든다. 블록 페이지 링크는 지금 그대로).

## 3. 이름 + 무작위 글자: 몇 글자면 되나

- 이름은 비밀이 아니다(사업 이름이라 짐작 가능). **안전은 무작위 글자만으로** 정해진다고 본다.
- 글자: 헷갈리는 `l·o·0·1`을 뺀 소문자·숫자 32개 → 한 글자 5비트. v4 UUID 첫 바이트(무작위 8비트)를 32로 나눈 나머지라 치우침이 없다.
- share-page-read에는 잦은 시도 제한이 없다(사실, `field-share-pages.md` 7절). 초당 100번 두드린다고 치면:

| 글자 수 | 경우의 수 | 절반을 맞히는 데 걸리는 시간(초당 100번) | 판단 |
| --- | --- | --- | --- |
| 4 | 32⁴ ≈ 105만 | 약 1.5시간 | **부족** |
| 6 | 32⁶ ≈ 10.7억 | 약 62일 | 부족(한 달이면 약 24% 확률) |
| 8 | 32⁸ ≈ 1.1조 | 약 174년(초당 1,000번이어도 17년) | **채택** |

- 그래서 **8글자**로 늘렸다(예: `minja-rail-k7q2m9xa`). 요청 예시(4글자)보다 4글자 길지만, 긴 링크(64자)에 비하면 짧고 사람이 읽을 수 있다. 시도 제한을 서버에 따로 두면 줄일 수 있으나 공용 장치가 없어 이번 범위 밖(10절).

## 4. 주소와 Worker

- 보내는 주소: `https://bokdoong.com/s/<짧은 주소>`. Worker가 사람에게는 **302로 `https://work.bokdoong.com/work/share/?s=<짧은 주소>`**에 보낸다. 실제 화면은 Web2와 다른 주소(work)에서 돌아 Web2 로그인 정보와 떨어져 있다(주소 이전 설계 4.3절과 같음).
- 미리보기 수집기(텔레그램·카카오톡 등)가 `bokdoong.com/s/…`에 오면 Worker가 바로 공유 화면 HTML을 내주며 og:title을 그 페이지 제목으로 바꾼다(302를 따라가지 않는 수집기 대비). `work…/share/?s=`에 직접 와도 같다.
- 공유 화면은 `?s=`를 바로 `#s=`로 옮긴다(`?t=`와 같은 이유: 다시 불러도 서버로 다시 보내지 않음). Worker는 공유 화면 요청의 `?` 뒤를 Pages로 넘기지 않는다(기존).
- 제목만 받기: Worker가 share-page-read에 `{token|slug, head:true}`를 보내면 제목만 돌아온다(5MB HTML을 받지 않음). Edge가 아직 옛 판이면 400 → 공통 카드(제목 없음)로 조용히 넘어간다.
- ④ Web1 삭제와 맞춤: `bokdoong.com/s/`는 Worker 경로라 저장소 `s/` 폴더(옛 Web1 껍데기, 삭제 예정)와 상관없다. `work…/work/share/`는 ④ 뒤에도 남는 경로다.

## 5. 격리 칸(안전장치)

- **Web2 안 미리 보기**: `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms" srcdoc=…>`. allow-same-origin이 없어 칸 안은 '이름 없는 주소'(opaque origin)다: Web2의 localStorage(Supabase 로그인 정보)·쿠키·부모 문서에 손댈 수 없고, 부모 화면을 다른 곳으로 옮길 수도 없다(allow-top-navigation 없음). Web2에는 CSP가 없어 CDN 스크립트·인라인 스크립트(그래프)가 칸 안에서 돈다.
- **공유 화면**: 공유 화면은 엄격한 CSP라 srcdoc 칸은 그 CSP를 물려받아 CDN·인라인 스크립트가 막힌다. 그래서 **별도 주소** `share/frame.html`(CSP 없음)을 같은 sandbox 속성으로 띄우고, 받은 HTML을 postMessage로 넘겨 그 칸이 그린다. `frame.html`은 자기가 opaque origin(=sandbox 안)이고 부모가 있을 때만 그린다(누가 sandbox 없이 이 파일을 띄워 work 주소 권한으로 남의 HTML을 돌리는 것을 막음). 공유 화면 CSP에는 `frame-src 'self'`만 더한다.
- 받는 사람이 링크로 여는 화면에는 로그인 정보가 없다. 그래도 같은 sandbox로 돌려 work 주소의 다른 저장값(옛 Web1 편집 로그인 등)에 닿지 않게 한다.
- 자동 시험(화면 PR): 칸 안 HTML이 `localStorage`·`parent.localStorage`·`document.cookie`·`parent.document`를 읽으려 하면 모두 막히는지, 칸 속성에 allow-same-origin이 없는지, CDN 주소 스크립트·인라인 그래프가 도는지 Web2 미리 보기와 공유 화면 두 곳에서 본다.
- 남는 위험: 올린 HTML이 칸 안에서 가짜 로그인 화면을 그릴 수는 있다(명진 본인 파일이라 받아들임). 외부 주소를 불러오는 것은 막지 않는다(CDN 라이브러리 동작 조건).

## 6. 크기·저장

- 5MB = 5,242,880바이트(UTF-8). DB 검사로 막고, 화면도 올리기 전에 같은 값으로 막는다. 그림이 든 HTML은 대개 그림을 data: 주소로 품어 커진다 → 넘으면 "5MB까지예요"라고만 알린다.
- 판은 고치지 않고 더한다. 이전 판은 화면에 보이지 않지만 남는다(되돌리기용). 정리(오래된 판 지우기)는 이번 범위 밖.

## 7. 화면

- 목록 머리: `내 공유 페이지 n` + [+ 새 공유 페이지](블록, 그대로) + [+ HTML].
- 줄: 제목 · 종류 꼬리표(`HTML`/`블록`) · 상태(HTML은 `● 공유 중`/`링크 꺼짐`/`초안`, 블록은 지금처럼 `게시`/`초안`). ⋯(PC 오른쪽 클릭 같음):
  - HTML: 링크 복사 · 새 파일로 바꾸기 · 링크 끄기(꺼졌으면 링크 켜기) · 보관함으로 · 삭제(휴지통).
  - 블록: 지금 그대로(보관 · 삭제).
- [+ HTML] 창: 파일(끌어 놓기·누르면 고르기) → 미리 보기(격리 칸) → 제목(HTML `<title>` 기본) · 링크(`bokdoong.com/s/` + 이름 + `-········`) · 기한(없음 ▾ / 30일 / 90일 / 날짜) → [저장하고 링크 켜기]. 이름은 제목에서 영문·숫자만 뽑아 기본값(없으면 비워 둠, 직접 입력).
- HTML 줄을 누르면 미리 보기 창(같은 격리 칸)이 열린다.
- 보관함 n(접힘): 보관한 공유 페이지(날짜순, ⋯ 되살리기·삭제) → 옛 Web1 페이지 5개(누르면 지금처럼 내용 보기, 지난 사업은 '지난 사업' 꼬리표). 옛 Web1 페이지는 고정 카드라 날짜가 없어 맨 아래에 둔다.
- 저장 순서: 페이지(초안) → HTML 판 → 링크 → 짧은 주소 → 게시. 중간에 실패하면 그 페이지는 'HTML · 초안'으로 남고 ⋯ [링크 켜기]로 이어서 할 수 있다(지운 것 없음).

## 8. 단계와 순서

| 단계 | PR | 정지 지점 |
| --- | --- | --- |
| 1 DB | `20261029140000_share_html_pages` + 짝 파일 5개 + PostgreSQL 시험 | **운영 적용 직전 정지**(승인형 DB workflow 확장 규칙 통과 확인: 새 표·authenticated/service_role 권한만) |
| 2 Edge | `share-page-read` 확장: `{slug}`·`head:true`, HTML 판 응답. verify_jwt=false 유지(기존 함수, first_deploy 아님, 5절 표 변경 없음) | **배포 직전 정지** — 1 적용 뒤. 되돌리기: 이전 운영 소스 SHA로 같은 workflow 재실행 |
| 3 화면 | 보관함 하나로, [+ HTML] 창, 목록 꼬리표·⋯, 공유 화면 HTML 칸(`share/frame.html`), Worker `/s/` 경로, E2E, 업데이트 기록 | merge = Pages·Worker 배포(Worker는 main merge 때 자동) — 2 배포 뒤. 되돌리기: revert PR(Worker도 같은 PR revert로 이전 판 재배포) |

- 2를 1보다 먼저 배포하면 새 표가 없어 짧은 주소는 503, HTML 판 질의는 실패한다(블록이 있는 페이지는 질의 실패를 무시하고 블록을 그대로 돌려주게 만들어 기존 링크는 계속 열림). 그래도 **1 → 2 순서**로 한다.
- 3을 2보다 먼저 merge하면 짧은 주소가 404, 미리보기 제목이 빠진다(블록 페이지 긴 링크 읽기는 그대로). 그래서 1 → 2 → 3.

## 9. 권한 경계

- Web2 인증·RLS·Edge 인증을 넓히지 않는다. 새 표는 기존 owner 함수(`private.app_is_workspace_owner`)만 쓰고 anon·PUBLIC 권한이 없다.
- 로그인 없는 쪽이 받을 수 있는 것은 "살아 있는 링크(긴 값 또는 짧은 주소)를 아는 경우, 게시된 그 한 페이지의 제목과 블록 또는 최신 HTML 판"뿐이다.
- 짧은 주소 글자는 DB가 만든다(화면이 정하지 못함, 열 권한 없음). 지문 비교는 기존과 같이 끝까지 비교.

## 10. 범위 밖·남은 것

- share-page-read 잦은 시도 제한(공용 장치 없음). 생기면 글자 수를 줄일 수 있다.
- 오래된 HTML 판 정리, 판 되돌리기 화면.
- 블록 페이지 링크에도 짧은 주소 만들기(표는 준비됨).
- 기존 `main_project_archive_state`(옛 카드 '지나간' 표시)는 로그인 없이 읽힌다(`field-share-pages.md` 7절). 이번에도 읽기만 하고 바꾸지 않는다. ④ Web1 삭제 때 함께 정리.
