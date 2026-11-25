# BLOG-나만의블로그: 노트에서 쓴 글을 차곡차곡 모으는 공개 블로그 (S70-23 설계)

명진 요청(2026-11-25 11:00): "노트에서 글 작성 → 공유페이지로 게시 … 이거를 여기서 더해서 항상 공유하는 블로그 구축(나만의 블로그). 블로그 홈페이지 메뉴를 두고, 노트에서 글 써서 블로그에 공개하면 그 블로그에 차곡차곡 글이 게시되는. 블로그는 다른 거 없고 그냥 게시판 목록(여러 개일 수 있음)만 있고, 게시판 클릭하면 글 목록, 글 클릭하면 글 본문. wo+ 안에 블로그를 볼 수 있는 메뉴를 주고, 웹브라우저에서 별도 페이지를 부여해서 그 주소로도 볼 수 있음."

답: **가능하다.** 지금 노트 게시(NOTE-게시 ①②③, `docs/design/note-publish.md`)가 쓰는 공유 페이지 표·사진 거울·익명 읽기 함수 `share-page-read`·받는 화면 `share/`를 그대로 넓히면 된다. 새 공개 버킷·anon 권한·RLS 완화 없이, 표 3개 더하기 + 읽기 함수에 블로그 길 + 밖 화면 하나 + 안 화면 하나다.

이번 PR은 설계·시안만이다(앱·DB·Edge 코드 변경 없음). 시안: [`mockups/blog.html`](mockups/blog.html).

## 1. 지금 구조에서 가져다 쓰는 것 (2026-11-25 main `5621e4e` 조사)

| 부분 | 지금 | 블로그에서 |
| --- | --- | --- |
| 공개용 페이지 행 | `app_share_pages`(제목·`blocks`·status `draft/published/archived`·휴지통, owner RLS) | **글 한 편 = 공유 페이지 행 하나**. `blocks`에 게시 순간의 글 사본(`{"type":"doc","doc":{"v":"ed1",…}}`)을 넣는다 → 이것이 '공개용 사본' |
| 노트 ↔ 페이지 짝 | `app_note_share_pages`(page_id·note_id, owner RLS, service_role은 두 칸만) — 링크 게시용, 노트의 **지금** 글을 읽음 | 블로그 글은 이 짝을 쓰지 않고 새 `app_blog_posts`로 잇는다(3절, 읽는 원본이 다름) |
| 사진 | 주인 화면이 Drive 사진을 1600px JPEG로 다시 그려 `share-page-media`(비공개 버킷)에 올리고 `share:<id>`로 거울, 읽기 때 그 **페이지 소속** 기록만 5분 서명 | 같은 코드(`app/note-publish.js`·`share-photos.js`)를 블로그 글 페이지에 그대로 |
| 익명 읽기 | Edge `share-page-read`(verify_jwt=false), 링크 지문 → 페이지 → 글. 그 밖은 같은 404 | 같은 함수에 **블로그 길** 세 가지(게시판 목록·글 목록·글 본문)를 더한다 |
| 받는 화면 | `share/`(`work.bokdoong.com/work/share/`, noindex, `no-store`, `credentials:'omit'`, textContent·`ed-render.mjs`로만 그림) | 같은 폴더에 블로그 화면을 더하거나 이웃 폴더 `blog/`(그리는 모듈 공유) |

지금 노트 게시와 다른 점 하나: 링크 게시는 노트를 고치면 바로 바뀐다(노트 원본을 서버 키로 읽음). 블로그는 **누구나 주소만 알면 목록부터 훑는 공개면**이라, 쓰다 만 글·나중에 적은 비공개 내용이 저절로 새지 않도록 기본을 **[다시 게시]할 때만 바뀌는 사본**으로 권한다(결정 C). 이렇게 하면 익명 읽기가 노트 표를 아예 건드리지 않는다.

## 2. 화면 흐름

### 2-1. WORK ON+ 안 [블로그] 메뉴 (`?view=blog`)

- 기본 꺼짐. 메뉴 수정 목록에만 있고, 처음 열면 한 줄 "블로그 꺼짐 · [켜기]". 켜기 창: 주소 이름(영문 소문자·숫자·`-` 3~30자, 겹치면 거절), 블로그 이름, 소개 한 줄(결정 E), 검색 엔진 노출(결정 D, 기본 끔).
- 켠 뒤 화면 = 밖 블로그와 같은 모양 + 주인 손잡이만:
  - 위 얇은 줄: 블로그 이름 · `주소 복사` · `밖에서 열기` · ⋯(이름·소개·주소 이름 고치기, 블로그 끄기).
  - 게시판 목록(왼쪽 / 폰은 첫 화면): 줄마다 이름·글 수. `+ 게시판`, 끌어 순서 바꾸기, 이름 고치기, 지우기(글이 남아 있으면 "글을 옮기거나 내린 뒤 지울 수 있어요"로 막음). 표준 상호작용표(`docs/design/standard-interactions.md`) 적용.
  - 글 목록: 제목·게시일·(사본이 노트보다 오래됐으면) `노트가 바뀜` 작은 표시. 줄 ⋯: `노트 열기` · `다시 게시` · `게시판 옮기기` · `내리기`.
  - 글 본문: 밖에서 보는 그대로(사본). 위 한 줄 `노트 열기 · 다시 게시 · 내리기`.
- 블로그 끄기 = 밖 주소 전체 404(글·게시판·사본은 남김, 다시 켜면 그대로). 완전히 지우기는 글을 다 내린 뒤 ⋯에서.

### 2-2. 노트 ⋯ [블로그에 게시]

- 노트 ⋯ 메뉴, 지금 `공유 링크 만들기` 옆에 `블로그에 게시`. 잠근 폴더 노트·휴지통·보관 노트에는 내지 않는다(링크 게시와 같은 규칙).
- 누르면 작은 고르기 창(시안 ②): 게시판 라디오 목록 + `+ 새 게시판` 한 줄 + "지금 글이 그대로 공개돼요. 사진은 위치 정보를 지우고 올려요. 첨부 파일은 공개되지 않아요." 한 줄 → `[게시]`.
- 블로그가 꺼져 있으면 같은 창 맨 위에 켜기 칸(주소 이름)을 먼저 보인다.
- 게시 뒤 노트 머리에 한 줄 "블로그 · ○○ 게시판 · 11.25 게시 · 다시 게시 · 내리기". 노트 목록에 `블로그` 거르기.
- 노트 하나는 블로그 글 하나(같은 노트를 두 게시판에 동시에 올리지 않음). 링크 게시와는 따로 켤 수 있다.

### 2-3. 게시 글을 고치면 (결정 C)

- 추천 [다시 게시]: 노트를 고쳐도 블로그는 그대로. 노트 머리 한 줄과 글 목록에 `노트가 바뀜` → `다시 게시` 한 번이면 사본·사진 거울을 새로 맞춘다. 게시일은 처음 날짜 유지, `고침 11.27` 작게.
- 다른 안 자동 반영: 링크 게시처럼 읽을 때 노트 원본을 읽음. 편하지만 쓰다 만 글이 바로 공개되고, 익명 길이 노트 표를 읽게 된다.

### 2-4. 내리기

- `내리기` = 그 글 페이지 status `draft` + `blocks: []` + 사진 정리(prune)를 한 번에(링크 게시의 '게시 멈춤'과 같은 코드). 읽기 함수는 status `published`만 보므로 **그 순간부터 404**. 노트는 그대로. 다시 올리면 새로 게시.
- 노트를 휴지통에 넣으면 그 노트의 블로그 글도 내린다(화면이 같이 처리 + 서버 읽기에서도 짝 노트가 휴지통이면 404 — 사본 방식이어도 두 겹).

## 3. 데이터 (새 표 3개, 기존 표·정책·권한은 한 줄도 바꾸지 않음)

| 표 | 칸 | 권한 |
| --- | --- | --- |
| `app_blogs` (작업공간마다 0~1줄) | `workspace_id`(unique), `slug`(주소 이름, unique, 모양 검사·예약어 거절), `title`, `intro`, `enabled`(기본 false), `indexable`(기본 false), `created_at`·`updated_at` | RLS 켬, authenticated owner 정책 하나(`private.app_is_workspace_owner`). anon·PUBLIC 없음. service_role은 `id, slug, title, intro, enabled, indexable` SELECT만 |
| `app_blog_boards` | `id`, `workspace_id`, `blog_id`, `name`(1~40자), `sort`, `public_key`(DB가 만드는 무작위 10자, 주소용) | 같음. 더할 때 같은 작업공간 블로그만. service_role은 `blog_id, name, sort, public_key` SELECT만 |
| `app_blog_posts` | `id`, `workspace_id`, `board_id`, `page_id`(unique, 공유 페이지 행), `note_id`(unique, on delete set null), `public_key`(무작위 10자), `published_at`, `republished_at` | 같음. 고치기 권한은 `board_id`(게시판 옮기기)·`republished_at`만. 더할 때 게시판·페이지·노트(kind 'note')가 모두 같은 작업공간. service_role은 `board_id, page_id, note_id, public_key, published_at, republished_at` SELECT만 |

- 공개용 사본은 기존 `app_share_pages.blocks`다(새 사본 표 없음). 블로그 글 페이지는 링크 행을 만들지 않으므로 링크 길(`?t=`·`?s=`)로는 열리지 않는다.
- 주소에 내부 uuid를 쓰지 않는다. 게시판·글은 `public_key`, 블로그는 `slug`.
- 쓰는 길은 기존처럼 owner RLS REST(화면)뿐. 새 RPC·SECURITY DEFINER 함수 없음.
- 운영자: 블로그 표는 owner-only라 운영자 화면·함수에 나오지 않는다(AGENTS 3절 '남의 기록 안 보기'). 운영 확인은 켠 블로그 수 같은 숫자만. 공개된 글은 누구나 보는 것이므로 그 주소를 여는 것은 예외가 아니다.
- 노조+ 조합원 얼굴에는 블로그 메뉴·경로가 없다(개인 업무 기능 없음, 메뉴·경로 제거 + 서버 거절 원칙).
- 계정 지우기(`account-delete.md`): 작업공간 cascade로 같이 지워진다. 막기 목록에 오른 사용자의 블로그는 읽기에서 404(작업공간 상태 확인 한 줄).

## 4. 익명 읽기 경로

**함수로 읽는다(정적 생성 안 함).** 정적 생성은 공개 저장소(git)에 글이 쌓여 "내리면 즉시 안 보임"을 지킬 수 없다(기록이 영원히 남음).

`share-page-read`(verify_jwt=false 그대로)에 본문 모양 세 가지를 더한다. 같은 함수의 블로그 손잡이는 별도 파일(`blog.ts`)로 두고 링크 길 코드는 건드리지 않는다.

| 요청 | 서버가 보는 것 | 응답 |
| --- | --- | --- |
| `{blog:"<slug>"}` | 블로그 `enabled` | `{title, intro, indexable, boards:[{key,name,count}]}` (글 0개 게시판도 보임) |
| `{blog, board:"<key>", page?}` | 그 블로그 소속 게시판 | `{board:{key,name}, posts:[{key,title,date}]}` 30개씩, 게시 순서 최신부터 |
| `{blog, post:"<key>"}` | 그 블로그 소속 글 + 페이지 status `published` + 짝 노트가 휴지통·없음 아님 | `{title, date, board, blocks, media}`(사진은 그 **페이지 소속** 기록만 5분 서명) |

- 모든 '없음'(블로그 꺼짐·이름 틀림·다른 블로그의 게시판 key·내린 글·모양 틀림)은 **같은 404 한 모양**. 블로그가 있는지 없는지 구분되지 않는다.
- 응답에 workspace_id·note_id·page_id·uuid·사람 이름·이메일을 넣지 않는다. `slug`·`public_key` 모양을 먼저 검사(정규식)하고 DB를 묻는다.
- 결정 C가 '자동 반영'이면 글 본문만 `noteForPage`처럼 노트 원본을 읽는 길이 하나 더 생긴다(지금 링크 게시와 같은 범위: 제목·글·kind·휴지통·보관 칸만).
- 목록 길은 노트 표를 읽지 않는다(제목은 페이지 행의 제목 사본).

## 5. 밖 화면과 주소 (결정 A)

화면 출처는 **Web2 앱 주소와 반드시 달라야 한다**(공유 화면을 `work.bokdoong.com`에 둔 이유와 같음: 공개 글을 그리는 화면이 로그인 앱과 같은 출처면 화면 결함 하나가 로그인 정보를 위험하게 함). 그래서 `workonplus.com/blog/…`는 후보에서 뺐다.

| 후보 | 모양 | 바꿀 것 | 정지 지점 |
| --- | --- | --- | --- |
| A1 (추천) | `blog.workonplus.com/<이름>` · 게시판 `…/<이름>/b/<key>` · 글 `…/<이름>/p/<key>` | Worker에 호스트 하나 + 경로 → `/work/blog/` 정적 화면으로 안쪽 넘김, Wrangler Custom Domain 하나 | **Cloudflare 설정(6절)**: Custom Domain·DNS 레코드 자동 생성. 되돌리기 = Custom Domain 연결 해제 또는 이전 Worker 커밋 재배포 |
| A2 | `work.bokdoong.com/blog/<이름>/…` | Worker 경로 매핑 한 줄(새 호스트·DNS 없음) | Worker 배포(코드 PR + 배포 workflow). 다만 `bokdoong.com` 계열은 쓰지 않기로 한 주소(11-21 결정)라 오래 쓸 주소로는 부적합 |
| A3 | `<이름>.workonplus.com` (사람마다 하위 도메인) | 와일드카드 DNS·인증서, Worker 와일드카드 경로 | Cloudflare·DNS. 앱 주소와 같은 등록 도메인 아래 사람마다 출처가 생겨 관리 부담이 큼 — 비추천 |

- 화면은 GitHub Pages 정적 파일(`blog/index.html` + 공용 그리기 `app/ed-render.mjs`), `credentials:'omit'`·`no-store`·자체 meta CSP(공유 화면과 같은 수준)·`referrerPolicy:'no-referrer'`.
- 짧은 주소처럼 미리보기 수집기(텔레그램·카카오톡)에 글 제목을 넣어 주는 Worker 처리는 후속(같은 `head:true` 방식).

## 6. 캐시·갱신

- 읽기 응답 `Cache-Control: no-store`(지금 공유와 같음) → 내리기·끄기가 즉시 반영된다. 화면 파일은 Pages 빌드 해시(`?v=` 손으로 안 씀).
- 위험: 익명 요청이 늘면 Edge 호출·Worker 무료 한도(하루 10만)를 쓴다. 1단계는 그대로 두고, 지켜볼 숫자(호출 수)만 운영 점검에 더한다. 짧은 캐시(예: 목록 30초)는 "내리면 즉시"와 맞바꾸는 일이라 명진 결정 없이는 넣지 않는다.

## 7. 검색 엔진 노출 (결정 D)

- 추천: **기본 금지**, 블로그마다 [검색 허용] 스위치(기본 끔). 금지 = 화면 `<meta name="robots" content="noindex,nofollow,noarchive">` + Worker 응답 `X-Robots-Tag: noindex`. 허용으로 켜도 사진 주소(5분 서명)는 색인되지 않는다.
- 이유: 한 번 색인되면 내려도 검색 저장본이 한동안 남는다(우리가 지울 수 없음). 주소를 아는 사람만 보는 것이 지금 공유와 같은 기대다.
- 화면을 자바스크립트로 그리므로 허용해도 색인 품질은 낮다. 제대로 노출하려면 Worker가 글 HTML을 그려 주는 후속이 필요(지금 범위 밖).

## 8. 보안 점검 목록 (구현 PR 완료 기준 시험)

| 지키는 것 | 시험 이름 |
| --- | --- |
| 비공개 노트·다른 사람 글이 익명 경로로 안 보임(게시 안 한 노트, 다른 작업공간 블로그의 게시판 key·글 key를 섞어 요청, 링크 게시만 한 노트) | `tests/security/blog-read-private-notes.test.mjs` |
| 내린 글은 즉시 안 보임(status draft·blocks 빔·사진 404, 노트 휴지통, 블로그 끄기, 게시판 옮긴 뒤 옛 게시판 목록에서 빠짐) | `tests/security/blog-takedown.test.mjs` |
| 사본 표에 익명 직접 권한 없음(`app_blogs`·`app_blog_boards`·`app_blog_posts`·`app_share_pages`에 anon·PUBLIC 권한·정책 0, RLS 켬, service_role 칸 한정) | `tests/security/blog-tables-no-anon.test.mjs` (migration 정적 검사 + postcheck SQL) |
| 모든 '없음'이 같은 404 모양, 응답에 내부 id·작업공간·이메일 없음 | `tests/security/blog-read-uniform-404.test.mjs` |
| 남의 게시판·페이지·노트로 글 짝을 못 만듦, 고치기는 두 칸만 | `tests/security/blog-posts-same-workspace.test.mjs` (로컬 합성 DB, RLS 아래 두 사용자) |
| 사진은 그 글 페이지 소속만, Drive 번호·첨부 링크 없음, EXIF 없음 | `tests/security/blog-read-media-scope.test.mjs` |
| 잠근 폴더·휴지통·보관 노트에는 [블로그에 게시]가 없음 | `tests/note-blog-publish-model.test.mjs` |
| 운영자 화면·함수가 블로그 관리 내용을 읽지 않음 | `tests/security/operator-no-blog-content.test.mjs` |
| 주소 이름 모양·예약어(`admin`·`api`·`work`·`s`·`b`·`p` 등) 거절 | `tests/blog-model.test.mjs` |
| 블로그 밖 화면이 noindex·no-store·credentials omit·CSP | `tests/security/blog-page-headers.test.mjs` |
| 화면 흐름(켜기 → 게시판 → 노트 게시 → 밖 화면 확인 → 다시 게시 → 내리기 → 404) | `tests/app-e2e/blog.spec.mjs`(실제 Edge 처리 코드를 메모리 저장소 위에서), `tests/app-e2e/standard-interactions.spec.mjs` 화면 표에 블로그 게시판·글 목록 추가 |

## 9. 지금 노트 게시와의 관계 (합치기)

- 한 노트의 공개 출구는 두 개: **링크**(받는 사람에게 보내는 숨은 주소, 지금 그대로)와 **블로그**(내 블로그 목록에 쌓임). 둘 다 공유 페이지 행 + 사진 거울 + `share-page-read`라는 한 길 위에 있다. 노트 ⋯ 메뉴 안 '게시' 묶음 하나로 보인다.
- 사진 거울·정리·게시 멈춤 코드(`note-publish.js`)를 페이지 하나 기준 함수로 묶어 두 출구가 같이 쓴다(복사해 새로 만들지 않음).
- 결정 C가 '자동'이면 링크와 블로그가 같은 원칙, '[다시 게시]'면 둘이 다르다. 나중에 링크도 [다시 게시]로 맞출지는 별도 결정(발견사항).

## 10. 구현 PR 나누기 (줄 세우기)

| 순서 | PR | 내용 | 완료 기준 시험 | 정지 지점 |
| --- | --- | --- | --- | --- |
| ① | BLOG ① 서버·DB | migration `…_blog_tables`(표 3개) + 짝 파일 5개, `share-page-read` 블로그 길(`blog.ts`) | `blog-tables-no-anon`, `blog-read-private-notes`, `blog-read-uniform-404`, `blog-read-media-scope`, `blog-takedown`(서버 부분), `blog-posts-same-workspace` | **DB migration**(승인형 workflow: 시험 적용 → 적용 → 사후 확인), **Edge 배포** `share-page-read`(되돌리기 ref = 직전 운영 SHA) |
| ② | BLOG ② 밖 화면·주소 | `blog/` 정적 화면(게시판 → 글 목록 → 본문, PC·폰), Worker 호스트·경로 | `blog-page-headers`, `blog.spec`(밖 화면 부분) | **Cloudflare**(A1이면 Custom Domain), Worker 배포 |
| ③ | BLOG ③ 안 화면 | [블로그] 메뉴·켜기·게시판 관리, 노트 ⋯ [블로그에 게시]·다시 게시·내리기, 노트 휴지통 연동, 업데이트 기록 json | `blog-model`, `note-blog-publish-model`, `operator-no-blog-content`, `blog.spec` 전체, `standard-interactions` | 없음(Pages 배포만) |

Expand → Deploy → Verify(`docs/web2-expand-deploy-verify-contract.md`): ①(쓰는 사람 없는 표·길) → ②(빈 블로그도 404로 안전) → ③(사용자 손에 닿음). 각 단계 뒤 상태로도 새는 길이 없다.

## 11. 명진 결정

| | 질문 | 추천 |
| --- | --- | --- |
| A | 주소 모양 | `blog.workonplus.com/<이름>` |
| B | 게시판 = 노트 폴더 vs 따로 | 따로(폴더 이름·잠금이 공개면에 끌려 나오지 않음, 폴더 정리를 바꿔도 블로그가 흔들리지 않음) |
| C | 노트 고치면 자동 반영 vs [다시 게시] | [다시 게시](쓰다 만 글이 저절로 공개되지 않음) |
| D | 검색 엔진 노출 | 기본 금지 + 블로그마다 허용 스위치 |
| E | 블로그 이름·소개 한 줄 | 둠(이름 필수, 소개 선택) |

## 12. 범위 밖 발견사항

- 링크 게시는 노트를 고치면 바로 바뀐다. 블로그를 [다시 게시]로 정하면 두 출구의 원칙이 달라진다 — 링크도 맞출지 별도 결정.
- `ai-assist`의 공유 페이지 AI 초안(kind `share_draft`)은 부르는 화면이 없다(`note-publish.md` 4절에 이미 적힘, 그대로).
