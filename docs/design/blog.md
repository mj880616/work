# BLOG-나만의블로그: 노트에서 쓴 글을 차곡차곡 모으는 명진 블로그 (S70-23 설계)

명진 요청(2026-11-25 11:00): "노트에서 글 작성 → 공유페이지로 게시 … 이거를 여기서 더해서 항상 공유하는 블로그 구축(나만의 블로그). 블로그 홈페이지 메뉴를 두고, 노트에서 글 써서 블로그에 공개하면 그 블로그에 차곡차곡 글이 게시되는. 블로그는 다른 거 없고 그냥 게시판 목록(여러 개일 수 있음)만 있고, 게시판 클릭하면 글 목록, 글 클릭하면 글 본문. wo+ 안에 블로그를 볼 수 있는 메뉴를 주고, 웹브라우저에서 별도 페이지를 부여해서 그 주소로도 볼 수 있음."

명진 결정(2026-11-25, 이 설계에 반영):

- 11:05 "블로그 주소는 bokdoong.com 을 활용" / "bokdoong.com 은 내 개인블로그로만 활용"
- 11:06 "다른 가입자는 블로그 기능 안줘." / "다른 가입자는 공유 페이지까지만."
- 11:06 "bokdoong.com 은 내 블로그용으로만 / workonplus.com 은 전체 workonplus 용으로 / nojoplus.com 은 안써 (이건 나중에 노조+ 앱 개발 후 거기에 활용)"

답: **가능하다.** 블로그는 **운영자(명진) 전용 기능**이고, 주소는 **`bokdoong.com` 전체**다. 지금 노트 게시(NOTE-게시 ①②③, `docs/design/note-publish.md`)가 쓰는 공유 페이지 표·사진 거울·익명 읽기 함수 `share-page-read`를 그대로 넓힌다. 새 공개 버킷·anon 권한·RLS 완화 없이, 표 3개 + 서버 허용 표 키 `blog` 하나 + 읽기 함수에 블로그 길 + 밖 화면 하나 + 안 화면 하나다. 그 전에 지금 `bokdoong.com`이 내주는 것을 `workonplus.com` 쪽으로 옮긴다(6절).

이번 PR은 설계·시안만이다(앱·DB·Edge·Worker 코드 변경 없음). 시안: [`mockups/blog.html`](mockups/blog.html).

## 0. 누가 쓰나 (운영자 전용)

- 블로그는 통화·텔레그램·아스날과 같은 **운영자 기능**이다. 서버 허용 표 `public.app_operator_features`에 키 `blog`를 명진 작업공간 한 줄로만 넣는다(SQL로만, 화면·API로 넣는 길 없음, AGENTS 5절). 확인은 `private.app_workspace_has_feature(workspace_id, 'blog')`, 받는 쪽(익명 읽기)은 `public.app_operator_feature_workspace('blog')`(허용된 작업공간이 정확히 하나일 때만 그 id).
- **다른 가입자**: 지금 노트 게시(공유 링크·공유 페이지)까지만 그대로 쓴다. [블로그] 메뉴는 메뉴 목록에서 **빠지고**(`menu-model.mjs`의 `feature: 'blog'` → `withFeatures`가 뺌, 숨김 아님), `?view=blog` 경로는 화면이 열지 않으며, 노트 ⋯의 [블로그에 게시] 줄은 그려지지 않는다. 화면을 우회해 표에 직접 쓰거나 읽기 함수에 블로그 요청을 보내도 **서버가 거절**한다(3절 정책, 4절 읽기).
- 사람마다 블로그·사람마다 주소 이름은 만들지 않는다. 블로그는 하나, 주소는 `bokdoong.com` 하나다.
- 허용 표에서 `blog` 줄을 지우면(SQL) 그 순간 쓰기는 정책에서 막히고 밖 주소는 전부 404가 된다(글·게시판·사본은 남음).

## 1. 지금 구조에서 가져다 쓰는 것 (2026-11-25 main `5621e4e` 조사)

| 부분 | 지금 | 블로그에서 |
| --- | --- | --- |
| 공개용 페이지 행 | `app_share_pages`(제목·`blocks`·status `draft/published/archived`·휴지통, owner RLS) | **글 한 편 = 공유 페이지 행 하나**. `blocks`에 게시 순간의 글 사본(`{"type":"doc","doc":{"v":"ed1",…}}`)을 넣는다 → 이것이 '공개용 사본' |
| 노트 ↔ 페이지 짝 | `app_note_share_pages`(page_id·note_id, owner RLS, service_role은 두 칸만) — 링크 게시용, 노트의 **지금** 글을 읽음 | 블로그 글은 이 짝을 쓰지 않고 새 `app_blog_posts`로 잇는다(3절, 읽는 원본이 다름) |
| 사진 | 주인 화면이 Drive 사진을 1600px JPEG로 다시 그려 `share-page-media`(비공개 버킷)에 올리고 `share:<id>`로 거울, 읽기 때 그 **페이지 소속** 기록만 5분 서명 | 같은 코드(`app/note-publish.js`·`share-photos.js`)를 블로그 글 페이지에 그대로 |
| 익명 읽기 | Edge `share-page-read`(verify_jwt=false), 링크 지문 → 페이지 → 글. 그 밖은 같은 404 | 같은 함수에 **블로그 길** 세 가지(게시판 목록·글 목록·글 본문)를 더한다 |
| 받는 화면 | `share/`(`work.bokdoong.com/work/share/`, noindex, `no-store`, `credentials:'omit'`, textContent·`ed-render.mjs`로만 그림) | 이웃 폴더 `blog/`(그리는 모듈 공유), `bokdoong.com`에서만 내줌(5절) |
| 운영자 기능 확인 | `app_operator_features`(RLS 켬, 정책 없음, API 권한 없음) + `app_my_features`(화면 메뉴용) | 키 `blog` 하나 더함(확인 제약 목록에 추가) |

지금 노트 게시와 다른 점 하나: 링크 게시는 노트를 고치면 바로 바뀐다(노트 원본을 서버 키로 읽음). 블로그는 **누구나 주소만 알면 목록부터 훑는 공개면**이라, 쓰다 만 글·나중에 적은 비공개 내용이 저절로 새지 않도록 기본을 **[다시 게시]할 때만 바뀌는 사본**으로 권한다(결정 C). 이렇게 하면 익명 읽기가 노트 표를 아예 건드리지 않는다.

## 2. 화면 흐름 (운영자 계정)

### 2-1. WORK ON+ 안 [블로그] 메뉴 (`?view=blog`)

- 운영자 계정에만 메뉴 목록에 있다. 처음 열면 한 줄 "블로그 꺼짐 · [켜기]". 켜기 창: 블로그 이름, 소개 한 줄(결정 E), 검색 엔진 노출(결정 D, 기본 끔). 주소는 `bokdoong.com`으로 정해져 있어 고르는 칸이 없다.
- 켠 뒤 화면 = 밖 블로그와 같은 모양 + 주인 손잡이만:
  - 위 얇은 줄: 블로그 이름 · `bokdoong.com` · `주소 복사` · `밖에서 열기` · ⋯(이름·소개 고치기, 블로그 끄기).
  - 게시판 목록(왼쪽 / 폰은 첫 화면): 줄마다 이름·글 수. `+ 게시판`, 끌어 순서 바꾸기, 이름 고치기, 지우기(글이 남아 있으면 "글을 옮기거나 내린 뒤 지울 수 있어요"로 막음). 표준 상호작용표(`docs/design/standard-interactions.md`) 적용.
  - 글 목록: 제목·게시일·(사본이 노트보다 오래됐으면) `노트가 바뀜` 작은 표시. 줄 ⋯: `노트 열기` · `다시 게시` · `게시판 옮기기` · `내리기`.
  - 글 본문: 밖에서 보는 그대로(사본). 위 한 줄 `노트 열기 · 다시 게시 · 내리기`.
- 블로그 끄기 = 밖 주소 전체 404(글·게시판·사본은 남김, 다시 켜면 그대로). 완전히 지우기는 글을 다 내린 뒤 ⋯에서.

### 2-2. 노트 ⋯ [블로그에 게시]

- 운영자 계정의 노트 ⋯ 메뉴, 지금 `공유 링크 만들기` 옆에 `블로그에 게시`. 잠근 폴더 노트·휴지통·보관 노트에는 내지 않는다(링크 게시와 같은 규칙). 다른 가입자의 게시 묶음에는 `공유 링크 만들기`만 있다.
- 누르면 작은 고르기 창(시안 ②): 게시판 라디오 목록 + `+ 새 게시판` 한 줄 + "지금 글이 그대로 공개돼요. 사진은 위치 정보를 지우고 올려요. 첨부 파일은 공개되지 않아요." 한 줄 → `[게시]`.
- 블로그가 꺼져 있으면 같은 창 맨 위에 "블로그 꺼짐 · 켜고 게시" 한 줄을 먼저 보인다.
- 게시 뒤 노트 머리에 한 줄 "블로그 · ○○ 게시판 · 11.25 게시 · 다시 게시 · 내리기". 노트 목록에 `블로그` 거르기.
- 노트 하나는 블로그 글 하나(같은 노트를 두 게시판에 동시에 올리지 않음). 링크 게시와는 따로 켤 수 있다.

### 2-3. 게시 글을 고치면 (결정 C)

- 추천 [다시 게시]: 노트를 고쳐도 블로그는 그대로. 노트 머리 한 줄과 글 목록에 `노트가 바뀜` → `다시 게시` 한 번이면 사본·사진 거울을 새로 맞춘다. 게시일은 처음 날짜 유지, `고침 11.27` 작게.
- 다른 안 자동 반영: 링크 게시처럼 읽을 때 노트 원본을 읽음. 편하지만 쓰다 만 글이 바로 공개되고, 익명 길이 노트 표를 읽게 된다.

### 2-4. 내리기

- `내리기` = 그 글 페이지 status `draft` + `blocks: []` + 사진 정리(prune)를 한 번에(링크 게시의 '게시 멈춤'과 같은 코드). 읽기 함수는 status `published`만 보므로 **그 순간부터 404**. 노트는 그대로. 다시 올리면 새로 게시.
- 노트를 휴지통에 넣으면 그 노트의 블로그 글도 내린다(화면이 같이 처리 + 서버 읽기에서도 짝 노트가 휴지통이면 404 — 사본 방식이어도 두 겹).

## 3. 데이터 (새 표 3개 + 허용 표 키 하나, 기존 표·정책·권한은 바꾸지 않음)

| 표 | 칸 | 권한 |
| --- | --- | --- |
| `app_blogs` (작업공간마다 0~1줄, 실제로는 명진 한 줄) | `workspace_id`(unique), `title`, `intro`, `enabled`(기본 false), `indexable`(기본 false), `created_at`·`updated_at` | RLS 켬, authenticated 정책 하나: **`private.app_is_workspace_owner(workspace_id)` 그리고 `private.app_workspace_has_feature(workspace_id, 'blog')`**(using·with check 모두). anon·PUBLIC 없음. service_role은 `workspace_id, title, intro, enabled, indexable` SELECT만 |
| `app_blog_boards` | `id`, `workspace_id`, `blog_id`, `name`(1~40자), `sort`, `public_key`(DB가 만드는 무작위 10자, 주소용) | 같은 정책(주인 + `blog` 허용). 더할 때 같은 작업공간 블로그만. service_role은 `blog_id, name, sort, public_key` SELECT만 |
| `app_blog_posts` | `id`, `workspace_id`, `board_id`, `page_id`(unique, 공유 페이지 행), `note_id`(unique, on delete set null), `public_key`(무작위 10자), `published_at`, `republished_at` | 같은 정책. 고치기 권한은 `board_id`(게시판 옮기기)·`republished_at`만. 더할 때 게시판·페이지·노트(kind 'note')가 모두 같은 작업공간. service_role은 `board_id, page_id, note_id, public_key, published_at, republished_at` SELECT만 |

- 허용 표: `app_operator_features`의 키 확인 제약 목록에 `'blog'`를 더하고(지금 목록 그대로 + 하나), 명진 작업공간 한 줄을 넣는다. 이 넣기는 migration 안 SQL 한 줄(작업공간은 이미 `calls` 키를 가진 작업공간으로 고름 — 아스날·읽을 거리 키를 넣을 때와 같은 방식, 이름·이메일을 쓰지 않음).
- **운영자 아닌 사람의 블로그 게시 요청은 서버가 거절한다**: 세 표 모두 정책이 `blog` 허용을 요구하므로, 다른 가입자가 REST로 `app_blogs`·`app_blog_boards`·`app_blog_posts`에 넣거나 고치면 RLS가 막는다(행 0개·42501). 공유 페이지 행(`app_share_pages`) 자체는 링크 게시용으로 지금처럼 누구나 만들 수 있지만, 블로그 글 짝이 없으면 블로그 길로는 절대 나오지 않는다.
- 공개용 사본은 기존 `app_share_pages.blocks`다(새 사본 표 없음). 블로그 글 페이지는 링크 행을 만들지 않으므로 링크 길(`?t=`·`?s=`)로는 열리지 않는다.
- 주소에 내부 uuid를 쓰지 않는다. 게시판·글은 `public_key`.
- 쓰는 길은 기존처럼 owner RLS REST(화면)뿐. 새 RPC·SECURITY DEFINER 함수 없음.
- 운영자 화면·함수: 블로그는 명진 본인 작업공간 기능이고, 운영 확인은 켠 여부·글 수 같은 숫자만(AGENTS 3절 '남의 기록 안 보기'와 충돌 없음 — 다른 사람 블로그가 없다).
- 노조+ 조합원 얼굴에는 블로그 메뉴·경로가 없다(개인 업무 기능 없음, 메뉴·경로 제거 + 서버 거절 원칙).
- 계정 지우기(`account-delete.md`): 작업공간 cascade로 같이 지워진다.

## 4. 익명 읽기 경로

**함수로 읽는다(정적 생성 안 함).** 정적 생성은 공개 저장소(git)에 글이 쌓여 "내리면 즉시 안 보임"을 지킬 수 없다(기록이 영원히 남음).

`share-page-read`(verify_jwt=false 그대로)에 본문 모양 세 가지를 더한다. 같은 함수의 블로그 손잡이는 별도 파일(`blog.ts`)로 두고 링크 길 코드는 건드리지 않는다. 허용 출처(`ALLOWED_ORIGINS`)에 `https://bokdoong.com` 정확히 하나를 더한다.

**블로그 작업공간은 요청이 정하지 않는다.** 서버가 매번 `app_operator_feature_workspace('blog')`로 정한다(허용된 작업공간이 정확히 하나가 아니면 404). 요청에 작업공간·사람을 고르는 칸이 없으므로, 다른 가입자가 어떤 값을 보내도 그 사람 표는 읽히지 않는다.

| 요청 | 서버가 보는 것 | 응답 |
| --- | --- | --- |
| `{blog:"home"}` | 허용 작업공간 하나 + 그 블로그 `enabled` | `{title, intro, indexable, boards:[{key,name,count}]}` (글 0개 게시판도 보임) |
| `{blog:"board", board:"<key>", page?}` | 그 블로그 소속 게시판 | `{board:{key,name}, posts:[{key,title,date}]}` 30개씩, 게시 순서 최신부터 |
| `{blog:"post", post:"<key>"}` | 그 블로그 소속 글 + 페이지 status `published` + 짝 노트가 휴지통·없음 아님 | `{title, date, board, blocks, media}`(사진은 그 **페이지 소속** 기록만 5분 서명) |

- 모든 '없음'(블로그 꺼짐·`blog` 허용 없음·틀린 key·내린 글·모양 틀림)은 **같은 404 한 모양**.
- 응답에 workspace_id·note_id·page_id·uuid·사람 이름·이메일을 넣지 않는다. `public_key` 모양을 먼저 검사(정규식)하고 DB를 묻는다.
- 결정 C가 '자동 반영'이면 글 본문만 `noteForPage`처럼 노트 원본을 읽는 길이 하나 더 생긴다(지금 링크 게시와 같은 범위: 제목·글·kind·휴지통·보관 칸만).
- 목록 길은 노트 표를 읽지 않는다(제목은 페이지 행의 제목 사본).

## 5. 밖 화면과 주소 (정해짐: `bokdoong.com` 전체)

| 주소 | 화면 |
| --- | --- |
| `bokdoong.com/` | **블로그 첫 화면 = 게시판 목록**(블로그 이름·소개 한 줄) |
| `bokdoong.com/board/<key>` | 게시판의 글 목록 |
| `bokdoong.com/post/<key>` | 글 본문 |
| `bokdoong.com/s/…`·`/work/**` | 옛 주소 넘기기 전용(6절, 블로그가 쓰지 않음) |
| 그 밖 | 404 |

- 화면 파일은 저장소 `blog/`(GitHub Pages `/work/blog/`) 정적 파일 + 공용 그리기 `app/ed-render.mjs`. Worker가 위 세 모양만 안쪽으로 `/work/blog/`를 가져와 내준다(주소창은 그대로). `/work/blog/`는 `bokdoong.com`에서만 내주고 `workonplus.com`·`nojoplus.com`에서는 404(앱과 같은 출처에서 열리지 않게, 라우터 시험으로 고정).
- `credentials:'omit'`·`no-store`·자체 meta CSP(공유 화면과 같은 수준)·`referrerPolicy:'no-referrer'`. 게시판·글 key 모양이 틀리면 Worker가 아무것도 묻지 않고 404.
- **출처 분리 원칙을 만족한다**: '공개 글을 그리는 화면과 로그인 앱은 주소를 나눠야 안전하다'(공유 화면을 `work.bokdoong.com`에 둔 이유). 앱은 `workonplus.com`, 블로그는 `bokdoong.com`으로 **등록 도메인부터 다르다**(같은 사이트도 아님). 지금 공유 화면(`work.bokdoong.com`)이 앱(옛 `bokdoong.com`)과 같은 사이트의 다른 하위 주소였던 것보다 더 넓게 떨어진다. 블로그 화면에는 로그인 정보가 없고, 6절 ⑥에서 `bokdoong.com`을 Web2 함수 허용 출처·로그인 돌아올 주소에서 빼면 블로그 출처는 앱 쪽 어떤 문에도 들어갈 수 없다.
- 미리보기 수집기(텔레그램·카카오톡)에 글 제목을 넣어 주는 Worker 처리는 후속(공유 짧은 주소와 같은 `head:true` 방식).

## 6. 옮기는 순서: `bokdoong.com` → `workonplus.com`, 그다음 블로그

### 6-1. 지금 bokdoong.com 계열이 내주는 것 (`cloudflare/bokdoong-router.mjs`, 2026-11-25 브랜치 기준)

| 호스트·경로 | 지금 응답 |
| --- | --- |
| `bokdoong.com/`, `/work/app`, `/work/app/**` | 이전 안내 한 장(S68-01 `movedNotice`, 200·noindex, 버튼 → 같은 경로의 `workonplus.com`) |
| `bokdoong.com/work/app/native-callback.html`·`origin-redirect.js`·`native-auth-bridge.js` | Pages에서 그대로(옛 폰 앱 0.5.16 이하 로그인 복귀, `BOKDOONG_KEPT`) |
| `bokdoong.com/work/app/icons/**` | Pages에서 그대로(공유 화면 미리보기 그림, `BOKDOONG_KEPT_PREFIXES`) |
| `bokdoong.com/work/app/onedrive-return.html`, `/work/app/oauth-consent/**` | `workonplus.com` 같은 경로·쿼리로 302(`BOKDOONG_FORWARD`) |
| `bokdoong.com/(work/app/)?…&google=connected·error·denied&native=android` | `workonplus.com` 같은 경로·쿼리로 302(폰 앱 캘린더 연결 복귀, `CALENDAR_RETURN`) |
| `bokdoong.com/favicon.png`·`/favicon.ico` | Pages `/work/personal/portal/` 아이콘 |
| `bokdoong.com/s/<짧은 주소>` | 사람 → `work.bokdoong.com/work/share/?s=…` 302, 미리보기 수집기 → 제목 카드. 모양 틀림·`?` 붙음 → 404 |
| `bokdoong.com/work/**`(앱 밖) | `work.bokdoong.com` 같은 경로로 302 |
| `bokdoong.com` 그 밖 | 404 |
| `work.bokdoong.com/` | `/work/`로 302 → 410 |
| `work.bokdoong.com/work/app/**` | `bokdoong.com` 같은 경로로 302(→ 이전 안내) |
| `work.bokdoong.com/work/share/**` | 공유 화면(`?t=`는 미리보기 수집기에 제목 카드, `/work/share?t=`·`?s=`는 `/work/share/`로 301) |
| `work.bokdoong.com/work/about/**`, `/work/favicon.svg`, `/work/personal/**` | Pages에서 그대로 |
| `work.bokdoong.com/work/**` 그 밖 | 옛 Web1 '더 이상 운영하지 않는 페이지입니다'(410, noindex) |
| `desk.bokdoong.com/`, `/work/app/**` | `bokdoong.com` 같은 경로로 302(→ 이전 안내), 그 밖 `/work/**` → `work.bokdoong.com` 302 |
| `arsenal.bokdoong.com/**` | `bokdoong.com/work/app/?view=arsenal`로 302(→ 이전 안내), `/favicon.ico`만 직접 |
| `read.bokdoong.com` | 이 Worker 밖(읽생기 rtw-router) — 이번에 그대로 |

### 6-2. 옮긴 뒤 주소

| 옛 주소 | 옮긴 뒤 |
| --- | --- |
| `bokdoong.com/work/app/**`(안내·넘김 자리 전부) | `workonplus.com` **같은 경로·쿼리로 301**(`handoff` 값은 지금 안내 링크처럼 싣지 않음, 원드라이브·Claude 연결 동의·캘린더 복귀는 지금처럼 싣음) |
| `bokdoong.com/work/app/native-callback.html`·스크립트 2개·`icons/**` | 당분간 그대로 Pages에서(옛 폰 앱이 남아 있는 동안). 0.5.16 이하가 쓰이지 않는다는 숫자 확인 뒤 301로 바꿈. 블로그 경로와 겹치지 않음 |
| `bokdoong.com/s/<짧은 주소>` | `workonplus.com/s/<같은 값>`으로 301(미리보기 수집기는 지금처럼 그 자리에서 제목 카드). 이미 보낸 짧은 주소가 계속 열림. `/s/`는 블로그가 영원히 쓰지 않는 예약 경로 |
| `bokdoong.com/work/**`(앱 밖) | `workonplus.com/work/about/**`는 그쪽으로 301, 그 밖은 `work.bokdoong.com` 규칙 그대로 |
| `bokdoong.com/` | ①~⑤ 동안은 지금 이전 안내 그대로 → ⑦에서 **블로그 첫 화면** |
| `work.bokdoong.com/work/share/**` | 새 공유 주소 같은 경로·쿼리로 301(아래 주의). 미리보기 수집기는 옛 주소에서도 제목 카드(같은 코드) |
| `work.bokdoong.com/work/about/**` | `workonplus.com/work/about/**`로 301 |
| `work.bokdoong.com/work/app/**`, `desk.bokdoong.com/**`(앱) | `workonplus.com` 같은 경로로 301(한 번에, `bokdoong.com`을 거치지 않음) |
| `arsenal.bokdoong.com/**` | `workonplus.com/work/app/?view=arsenal`로 302(바로) |
| `work.bokdoong.com` 옛 Web1 | 410 그대로 |
| `nojoplus.com`·`www.nojoplus.com` | **이번에 그대로**(코드 안 바꿈). 그 밖 `/work/**` → `work.bokdoong.com` 302는 거기서 다시 301로 이어져 열림 |

**주의 — 공유 화면은 `workonplus.com/work/share/`로 옮기지 않는다(요청과 다른 점).** 공유 화면이 앱과 같은 출처(`workonplus.com`)에 서면 '공개 화면과 로그인 앱은 주소를 나눈다' 원칙이 깨진다(공유 글을 그리는 화면 결함 하나가 앱 로그인 정보에 닿음). 그래서 새 공유 주소는 **`share.workonplus.com/work/share/`**(앱과 다른 출처, Worker Custom Domain 하나)로 추천한다. 대안은 `work.bokdoong.com/work/share/`를 공유 전용으로 남기는 것이지만, 'bokdoong.com은 블로그용으로만' 결정과 맞지 않아 뺐다. 이 점은 CC가 구현 PR 전에 명진에게 한 줄로 확인한다.

301로 하는 이유: 옛 앱·공유·짧은 주소는 다시 `bokdoong.com`으로 돌아올 일이 없다(명진 결정). 다만 브라우저가 301을 오래 기억하므로, 되돌릴 일이 생겨도 이미 다녀간 사람 브라우저는 새 주소로 간다 — 그래서 `bokdoong.com/`(블로그 자리)에는 301을 쓰지 않는다.

### 6-3. 주소를 박아 둔 곳 (영향 목록)

| 곳 | 지금 | 바꿀 것 |
| --- | --- | --- |
| Supabase Auth Redirect URLs | `bokdoong.com`·`desk`·`work`의 `/work/app/` 줄, `workonplus.com/**`, github.io | ⑥에서 `bokdoong.com`·`desk`·`work` 앱 줄을 뺌(블로그 출처가 로그인 돌아올 곳이 되지 않게). 옛 폰 앱용 `bokdoong.com/work/app/native-callback.html` 줄만 그 화면을 없앨 때까지 남김. Site URL(github.io) 그대로 |
| Google 로그인 동의 화면(브랜딩 홈페이지·처리방침 주소) | `work.bokdoong.com/work/about/…` | **먼저**(②) `workonplus.com/work/about/…`로 바꿈. 승인된 도메인에 `workonplus.com` 있는지 확인. 브랜드 인증 재검토가 걸릴 수 있음(남은 위험) |
| 로그인 화면 링크(`app/login/index.html`) | `work.bokdoong.com/work/about/` | `workonplus.com/work/about/`(앱 코드 PR) |
| 폰 앱(`android-app` `ShellRules`) | 처음 여는 주소 `workonplus.com`(0.5.17~), 안쪽 호스트에 `bokdoong.com`·desk·work 포함, `movedToHome` | 다음 판: `bokdoong.com`을 **바깥**(브라우저로 엶)으로 — 블로그를 앱 안에서 열지 않게. desk·work 앱 경로는 `movedToHome` 그대로. 새 공유 주소 바깥 |
| 바구니 PC(`PcDoor.AllowedOrigins`) | bokdoong 3개 + nojoplus + workonplus | 다음 판에서 bokdoong 3개 뺌 |
| Edge 허용 출처 `_shared/web-cors.ts`, `auth-handoff`, `public-policy-drive` | `bokdoong.com`·`desk`·`work` 포함 | ⑥에서 세 줄을 뺌(함수마다 배포, 되돌리기 ref 기록). `public-page-edit`·`pc0921-board`(옛 Web1)는 별도 정리 |
| `public-policy-drive` 돌아갈 주소 | `DRIVE_APP_URL`·`CALENDAR_APP_URL` = `bokdoong.com/work/app/…`(폰 앱 `android` 칸 포함) | `workonplus.com`으로(⑥, 그 전까지는 301이 이어 줌) |
| Edge `share-page-read` 허용 출처 | `work.bokdoong.com` | ①에서 `https://share.workonplus.com`, ⑦에서 `https://bokdoong.com` 더함. `work.bokdoong.com`은 301 뒤 뺌 |
| 공유 링크(`app/share-pages-model.mjs` `SHARE_ORIGIN`) | `work.bokdoong.com` | 새 공유 주소(①) |
| 짧은 주소(`app/share-html-model.mjs`) | 기본 `bokdoong.com/s/`, 연 주소 따름 | 기본을 `workonplus.com/s/`로, `bokdoong.com`은 목록에서 뺌 |
| github.io 넘기기(`app/origin-redirect.js`) | `bokdoong.com`으로 | `workonplus.com`으로 |
| 원드라이브 돌아올 주소(Edge 비밀값·Azure 등록) | `bokdoong.com/work/app/onedrive-return.html` | 301이 이어 주므로 급하지 않음. Azure 등록·비밀값을 `workonplus.com`으로 바꾸는 것은 대시보드 일(CC, 비밀값 변경은 사용자 대시보드 규칙) |
| Claude 연결 동의(`/work/app/oauth-consent/`) | `bokdoong.com`에서 302 | 301이 이어 줌. 등록 주소 정리는 후속 |
| Worker 배포 확인(`cloudflare-worker-deploy.yml`)·시험(`tests/domain/*`) | bokdoong 안내·넘김 확인 | 새 301·블로그 경로·`/work/blog/` 다른 호스트 404 확인으로 |

### 6-4. 단계 (모두 정지 지점: Worker merge = Cloudflare 자동 배포, CC가 처리)

| 단계 | 할 일 | 되돌리기 |
| --- | --- | --- |
| ① | 새 공유 주소: Worker에 `share.workonplus.com` Custom Domain(`wrangler.toml`) + 공유 화면 규칙 그대로 적용, `SHARE_ORIGIN`·짧은 주소 302 대상을 새 주소로, `share-page-read` 허용 출처 더함(Edge 배포). 옛 `work.bokdoong.com` 공유는 그대로 열림 | 이전 Worker 커밋 재배포(`cloudflare-worker-deploy.yml`) + Custom Domain 해제, Edge는 기록한 이전 ref |
| ② | Google 동의 화면 about 주소를 `workonplus.com/work/about/`로, 로그인 화면 링크 고침(앱 PR) | 콘솔 값 원래대로 |
| ③ | Worker: 6-2 표의 301들(앱·짧은 주소·공유·about), desk·arsenal 바로 `workonplus.com`. `bokdoong.com/`은 아직 이전 안내 | 이전 Worker 커밋 재배포(이미 다녀간 브라우저는 301 기억) |
| ④ | 확인: 옛 공유 링크 `?t=`·짧은 주소·about·원드라이브·캘린더 복귀가 새 주소에서 열림(데이터 생성 없이) | — |
| ⑤ | 폰 앱 다음 판(`bokdoong.com` 바깥), 바구니 PC 다음 판 | 옛 판 다시 설치 |
| ⑥ | 정리: Web2 함수 허용 출처에서 `bokdoong.com`·desk·work 빼기(함수마다), `public-policy-drive` 돌아갈 주소, Redirect URLs 앱 줄 빼기, `origin-redirect.js` | 같은 값 다시 더함 / 이전 ref 재배포 |
| ⑦ | 블로그 구현(10절 BLOG ①②③). ②에서 `bokdoong.com/` = 블로그 첫 화면 | 이전 Worker 커밋(`/`가 이전 안내로 돌아감) |

DNS: `bokdoong.com`·`work`·`desk`·`arsenal`은 이미 Worker Custom Domain이라 DNS를 손으로 바꿀 일이 없다. 새로 생기는 것은 `share.workonplus.com` Custom Domain 하나(Cloudflare가 레코드·인증서 생성, 같은 이름 레코드가 없는지 먼저 확인). `nojoplus.com`은 이번에 그대로.

## 7. 캐시·갱신

- 읽기 응답 `Cache-Control: no-store`(지금 공유와 같음) → 내리기·끄기가 즉시 반영된다. 화면 파일은 Pages 빌드 해시(`?v=` 손으로 안 씀).
- 위험: 익명 요청이 늘면 Edge 호출·Worker 무료 한도(하루 10만)를 쓴다. 1단계는 그대로 두고, 지켜볼 숫자(호출 수)만 운영 점검에 더한다. 짧은 캐시(예: 목록 30초)는 "내리면 즉시"와 맞바꾸는 일이라 명진 결정 없이는 넣지 않는다.

## 8. 검색 엔진 노출 (결정 D)

- 추천: **기본 금지**, [검색 허용] 스위치(기본 끔). 금지 = 화면 `<meta name="robots" content="noindex,nofollow,noarchive">` + Worker 응답 `X-Robots-Tag: noindex`. 허용으로 켜도 사진 주소(5분 서명)는 색인되지 않는다.
- 이유: 한 번 색인되면 내려도 검색 저장본이 한동안 남는다(우리가 지울 수 없음).
- 화면을 자바스크립트로 그리므로 허용해도 색인 품질은 낮다. 제대로 노출하려면 Worker가 글 HTML을 그려 주는 후속이 필요(지금 범위 밖).

## 9. 보안 점검 목록 (구현 PR 완료 기준 시험)

| 지키는 것 | 시험 이름 |
| --- | --- |
| **운영자 아닌 사람의 블로그 게시 요청 서버 거절**(`blog` 허용 없는 작업공간이 세 표에 넣기·고치기 → RLS 거절, 읽기 함수는 허용 작업공간 하나만 내주고 요청 값으로 작업공간을 못 고름, 허용 줄을 지우면 쓰기·읽기 모두 막힘) | `tests/security/blog-operator-only.test.mjs` (로컬 합성 DB, 운영자·일반 두 사용자 + 읽기 처리 코드) |
| 다른 가입자 화면에 [블로그] 메뉴·`?view=blog`·노트 ⋯ [블로그에 게시]가 없음(빼기, 숨김 아님) | `tests/blog-menu-feature.test.mjs` |
| 비공개 노트가 익명 경로로 안 보임(게시 안 한 노트, 링크 게시만 한 노트, 틀린·남의 key) | `tests/security/blog-read-private-notes.test.mjs` |
| 내린 글은 즉시 안 보임(status draft·blocks 빔·사진 404, 노트 휴지통, 블로그 끄기, 게시판 옮긴 뒤 옛 게시판 목록에서 빠짐) | `tests/security/blog-takedown.test.mjs` |
| 사본 표에 익명 직접 권한 없음(`app_blogs`·`app_blog_boards`·`app_blog_posts`·`app_share_pages`에 anon·PUBLIC 권한·정책 0, RLS 켬, service_role 칸 한정) | `tests/security/blog-tables-no-anon.test.mjs` (migration 정적 검사 + postcheck SQL) |
| 모든 '없음'이 같은 404 모양, 응답에 내부 id·작업공간·이메일 없음 | `tests/security/blog-read-uniform-404.test.mjs` |
| 남의 게시판·페이지·노트로 글 짝을 못 만듦, 고치기는 두 칸만 | `tests/security/blog-posts-same-workspace.test.mjs` |
| 사진은 그 글 페이지 소속만, Drive 번호·첨부 링크 없음, EXIF 없음 | `tests/security/blog-read-media-scope.test.mjs` |
| 잠근 폴더·휴지통·보관 노트에는 [블로그에 게시]가 없음 | `tests/note-blog-publish-model.test.mjs` |
| 블로그 밖 화면이 noindex·no-store·credentials omit·CSP | `tests/security/blog-page-headers.test.mjs` |
| 주소: `bokdoong.com/`·`/board/`·`/post/`만 블로그, `/work/blog/`는 다른 호스트에서 404, 옛 앱·짧은 주소·공유·about 301 | `tests/domain/bokdoong-router.test.mjs`(고침) |
| 화면 흐름(켜기 → 게시판 → 노트 게시 → 밖 화면 확인 → 다시 게시 → 내리기 → 404) | `tests/app-e2e/blog.spec.mjs`(실제 Edge 처리 코드를 메모리 저장소 위에서), `tests/app-e2e/standard-interactions.spec.mjs` 화면 표에 블로그 게시판·글 목록 추가 |

## 10. 지금 노트 게시와의 관계 (합치기)

- 운영자 노트의 공개 출구는 두 개: **링크**(받는 사람에게 보내는 숨은 주소, 지금 그대로)와 **블로그**(`bokdoong.com`에 쌓임). 둘 다 공유 페이지 행 + 사진 거울 + `share-page-read`라는 한 길 위에 있다. 다른 가입자는 링크 하나.
- 사진 거울·정리·게시 멈춤 코드(`note-publish.js`)를 페이지 하나 기준 함수로 묶어 두 출구가 같이 쓴다(복사해 새로 만들지 않음).
- 결정 C가 '자동'이면 링크와 블로그가 같은 원칙, '[다시 게시]'면 둘이 다르다. 나중에 링크도 [다시 게시]로 맞출지는 별도 결정(발견사항).

## 11. 구현 PR 나누기 (줄 세우기)

| 순서 | PR | 내용 | 완료 기준 시험 | 정지 지점 |
| --- | --- | --- | --- | --- |
| 0-① | 주소 ① 새 공유 주소 | 6-4 ① | `tests/domain/bokdoong-router.test.mjs`, 공유 시험 | Cloudflare Custom Domain·Worker, Edge `share-page-read` |
| 0-② | 주소 ② about·로그인 링크 | 6-4 ②(앱 PR + 콘솔) | 로그인 화면 링크 시험 | Google 콘솔 |
| 0-③ | 주소 ③ 301 넘기기 | 6-4 ③ | `bokdoong-router` 301 표 | Worker 배포 |
| 0-⑥ | 주소 ⑥ 정리 | 6-4 ⑤⑥(폰 앱·바구니 판은 릴리스 때) | `tests/domain/supabase-origin.test.mjs` 등 | Edge 배포 여러 개(하나씩), Supabase Auth |
| ① | BLOG ① 서버·DB | migration `…_blog_tables`(표 3개 + 허용 키 `blog` + 명진 작업공간 한 줄) + 짝 파일 5개, `share-page-read` 블로그 길(`blog.ts`) | `blog-operator-only`, `blog-tables-no-anon`, `blog-read-private-notes`, `blog-read-uniform-404`, `blog-read-media-scope`, `blog-takedown`(서버 부분), `blog-posts-same-workspace` | **DB migration**(승인형 workflow: 시험 적용 → 적용 → 사후 확인), **Edge 배포** `share-page-read`(되돌리기 ref = 직전 운영 SHA) |
| ② | BLOG ② 밖 화면·주소 | `blog/` 정적 화면(게시판 → 글 목록 → 본문, PC·폰), Worker `bokdoong.com/` 블로그 경로 | `blog-page-headers`, `bokdoong-router`, `blog.spec`(밖 화면 부분) | Worker 배포(0-③ 뒤) |
| ③ | BLOG ③ 안 화면 | [블로그] 메뉴(`feature: 'blog'`)·켜기·게시판 관리, 노트 ⋯ [블로그에 게시]·다시 게시·내리기, 노트 휴지통 연동, 업데이트 기록 json | `blog-menu-feature`, `note-blog-publish-model`, `blog.spec` 전체, `standard-interactions` | 없음(Pages 배포만) |

Expand → Deploy → Verify(`docs/web2-expand-deploy-verify-contract.md`): 주소 0-①~③(옛 링크가 계속 열림) → BLOG ①(쓰는 사람 없는 표·길) → ②(빈 블로그도 404로 안전) → ③(명진 손에 닿음) → 0-⑥ 정리. 각 단계 뒤 상태로도 새는 길이 없다. 0-⑥은 BLOG와 앞뒤 상관없이 ④ 확인 뒤 언제든.

## 12. 명진 결정

| | 질문 | 추천 |
| --- | --- | --- |
| B | 게시판 = 노트 폴더 vs 따로 | ★ 따로(폴더 이름·잠금이 공개면에 끌려 나오지 않음, 폴더 정리를 바꿔도 블로그가 흔들리지 않음) |
| C | 노트 고치면 자동 반영 vs [다시 게시] | ★ [다시 게시](쓰다 만 글이 저절로 공개되지 않음) |
| D | 검색 엔진 노출 | ★ 기본 안 나오게 + [검색 허용] 스위치 |
| E | 블로그 이름·소개 한 줄 | ★ 둠(이름 필수, 소개 선택) |

정해진 것(11-25 명진): 주소 = `bokdoong.com` 전체, 블로그 = 명진 전용(다른 가입자는 공유 페이지까지), `workonplus.com` = WORK ON+ 전체, `nojoplus.com` = 이번에 그대로(노조+ 앱 때 사용).

## 13. 범위 밖 발견사항

- 링크 게시는 노트를 고치면 바로 바뀐다. 블로그를 [다시 게시]로 정하면 두 출구의 원칙이 달라진다 — 링크도 맞출지 별도 결정.
- `ai-assist`의 공유 페이지 AI 초안(kind `share_draft`)은 부르는 화면이 없다(`note-publish.md` 4절에 이미 적힘, 그대로).
- 공유 화면(`share/`)과 블로그 화면(`blog/`)은 GitHub Pages 원 주소(`mj880616.github.io/work/…`)에서도 열린다. 지금 공유 화면과 같은 수준(로그인 정보 없음, 읽기 함수 허용 출처 밖이라 글은 안 나옴) — 그대로 두고 적어만 둔다.
- `nojoplus.com`의 그 밖 `/work/**` 넘김은 `work.bokdoong.com`을 거쳐 한 번 더 넘어간다. 노조+ 앱 때 정리.
