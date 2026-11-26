# NOTE-게시: 공유 페이지를 노트 안 기능으로 (S69-77)

사용자 요청(2026-11-24 21:41): "노션의 자유로운 편집 기능과 페이지 공유 게시 기능을 나의 노트에도 가져와서 공유 페이지를 아예 노트 내 기능으로 만들어버리고 별도 메뉴에서 공유 페이지 삭제". CC 1단계 안(21:42 "ㄱ"): 공유 페이지 → 노트 게시로 합치기.

## 1. 지금 구조 (2026-11-24 main 기준 조사)

| 부분 | 지금 |
| --- | --- |
| 메뉴·화면 | 왼쪽 메뉴 `pages`('공유 페이지', `app/menu-model.mjs`), 화면 `#pagesView` → `#sharePagesRoot`의 유일한 그리기 주인 `app/share-pages.js`(목록·편집기·보관함·링크), HTML 파일 페이지 `app/share-html.js`, 사진 `app/share-photos.js` |
| 저장 표 | `app_share_pages`(제목·블록·status draft/published/archived·휴지통 deleted_at, owner RLS), `app_share_page_links`(받는 사람별 링크, token은 DB가 만듦, 읽기는 token_hash로만), `app_share_page_slugs`(짧은 주소), `app_share_page_html`(HTML 판), `app_share_page_media`(사진) |
| 공개 읽기 | Edge `share-page-read`(verify_jwt=false): 링크 값/짧은 주소 → sha256 → 링크 행(꺼짐·기한) → 페이지(published만) → 제목·블록(또는 HTML 판). 그 밖은 모두 같은 404. service_role은 표마다 필요한 칸만 SELECT |
| 받는 화면 | `share/`(work.bokdoong.com/work/share/?t=… 또는 ?s=…), `app/sr-render.mjs`·`app/ed-render.mjs`로 textContent만 그림 |
| 노트 | `app_notes` kind 'note': `title`, `raw_text`(글자 사본), `doc`(새 편집기 서식 `{"v":"ed1","doc":{…}}`, 비면 옛 글), `attachments`(Drive 파일), `metadata`(폴더·고정·보드…), `deleted_at`(휴지통), `archived_at`. owner RLS `notes_owner_all` |

두 형식 차이: 공유 페이지 새 글은 블록 하나 `{"type":"doc","doc":{"v":"ed1","doc":…}}` = 노트 `doc` 칸과 같은 모양이다. 다른 것은 (1) 옛 6종 블록(한 줄 현황·진행 단계·일정·쟁점·링크·업데이트 기록) 페이지, (2) HTML 파일 페이지, (3) 사진: 공유 페이지 사진은 `share:<id>`(공개용 저장소, 짧은 주소로 보임), 노트 사진은 `drive:<파일 id>`(본인 Drive, 밖에 안 보임).

## 2. 설계

- 게시 = 기존 공유 링크 길을 그대로 탄다. 노트 하나를 게시하면 화면이 owner 권한으로 (1) 공유 페이지 줄(제목 사본·빈 블록·status `published`), (2) 새 짝 표 `app_note_share_pages` 한 줄(페이지 ↔ 노트), (3) 링크 한 줄을 넣는다. 새 공개 길·새 RPC 없음.
- 읽기: `share-page-read`가 페이지 확인 뒤 짝 표에 그 페이지 줄이 있으면 그 노트의 **지금** 제목·글을 글 블록 하나로 돌려준다(노트를 고치면 게시도 바로 바뀜). 노트 사진은 자리만 남기고 주소·파일 번호는 지운다(①). 첨부·메타·작업공간은 읽지 않는다.
- 게시 멈춤 = 페이지 status `draft`(같은 링크가 다시 게시하면 살아남). 노트가 휴지통·보관이면 404, 노트를 완전히 지우면 짝의 note_id가 비어 404.
- 보안: 노트 표 RLS·권한은 바꾸지 않는다. 짝 표는 RLS 켬·owner 정책 하나·고치기 권한 없음, 더할 때 같은 작업공간의 kind 'note' 노트와 같은 작업공간의 페이지만. anon·PUBLIC 권한 없음. service_role은 짝 표의 page_id·note_id 두 칸만.

## 3. 순서 (PR 줄 세우기)

1. **① 서버·DB**(이 PR): migration `20261124230000_note_share_pages` + 짝 파일 5개, `share-page-read` 노트 길, 시험.
2. **② 화면**: 노트 ⋯ [공유 링크 만들기]/[링크 복사]/[게시 멈춤], 노트 머리 한 줄 '게시 중 · 링크 복사 · 게시 멈춤', 목록 '게시 중' 거르기. 잠근 폴더 노트는 게시 메뉴를 내지 않음. 공유 페이지 목록에서 짝이 있는 줄은 빼기(노트 쪽에서만 보임).
3. **③ 메뉴 제거·사진**(S69-93): 2026-11-25 03:05 사용자 결정 — 사용자 작업공간의 옛 공유 페이지가 0개(휴지통·HTML 판·사진 0)라 **공유 페이지 글 → 노트 옮기기 migration은 하지 않는다**. 다른 사용자 데이터가 있을 수 있어 표·데이터는 지우지 않는다. 왼쪽 메뉴·폰 메뉴·메뉴 수정·[+ 추가]의 '공유 페이지'와 그 화면(`share-pages.js`·`share-html.js`·`share-ai-draft.js`와 모양 파일)을 코드째 지웠다. 옛 주소 `?view=pages`·`go('pages')`는 라우터 별칭으로 노트(`?view=basket&pane=note`)를 연다. 저장된 메뉴 순서의 `pages`는 모르는 이름이라 버려진다. 남긴 것: 표 5개·`share-page-read`·`share-page-media`·받는 화면 `share/`(옛 링크는 그대로 열림)·휴지통의 공유 페이지 줄(되살리기·영구 삭제). 게시한 노트의 사진은 받는 사람에게도 보인다(5절, "ㅇ").

## 4. 남은 결정·위험

- HTML 파일 공유 페이지는 노트 글로 바꿀 수 없다: 노트 첨부(HTML 첨부 보기)로 옮기고 공개는 지금처럼 HTML 판을 보여 줄지, 그대로 둘지 ③ 전에 정한다.
- (③에서 정리) 옛 공유 페이지 옮기기는 하지 않으므로 HTML 판·`share:` 사진 옮기기 결정은 필요 없어졌다. 옛 링크는 지금처럼 열린다.
- 마크다운으로 쓴 노트(metadata.markdown)는 ①에서 글자 그대로 문단으로 보인다.
- 사진은 주인 화면이 게시할 때·게시 중 노트를 [저장]할 때만 맞춘다. 다른 길(큰 창 첨부만 저장, 이어 붙이기 등)로 사진이 바뀌면 다음 저장·다시 게시 때 맞춰진다. 못 올린 사진은 자리만 보이고 화면에 한 줄 알림.
- 게시 중 노트를 휴지통에 넣으면 읽기는 바로 막히지만(404) 짝 페이지 사진 파일은 남는다(게시 멈춤·휴지통에서 공유 페이지 영구 삭제 때 지워짐). 이미 받은 5분짜리 사진 주소는 그 5분 동안만 열린다.
- 같은 사진을 두 노트에 넣어도 페이지마다 따로 올린다(지문이 페이지마다 다름).
- 서버 `ai-assist`의 공유 페이지 AI 초안(kind `share_draft`)은 부르는 화면이 없어졌다. 함수 정리는 따로 한다(발견사항).

## 5. 게시한 노트 사진 보이기(③, S69-93)

보안 경계(AGENTS.md 5절): 받는 사람의 요청 때 서버가 주인 Google Drive를 대신 읽지 않는다. 그래서 **주인이 로그인한 화면**이 사진을 옮겨 둔다.

| 때 | 주인 화면(`app/note-publish.js`)이 하는 일 |
| --- | --- |
| 게시할 때([공유 링크 만들기]), 게시 중 노트를 [저장]·태그 저장한 뒤 | 노트 글(doc) 안 사진 칸 중 **이 노트 첨부인 사진만**(`notePhotoSrcs`, 파일 칸 제외, 20장까지) → 이미 올린 지문이면 건너뜀 → 아니면 내 Drive 사진을 `basket-files`(주인만)로 받아 `share-photos.js`로 1600px JPEG로 **다시 그려**(EXIF·위치 없음, 서버 `inspectJpeg`가 APP1을 거절) `share-page-media`에 짝 페이지 사진으로 올림(비공개 버킷 `share-page-media`, 기록 `app_share_page_media`) → 짝 페이지 `blocks`에 거울 한 줄 저장 → `share-page-media` 정리(prune: 저장된 블록에 없는 이 페이지 사진 파일·기록 삭제) |
| 게시 멈춤 | status `draft` + `blocks: []`를 한 번에 → (돌던 맞추기가 끝나면 한 번 더 비움) → 정리로 사진 파일·기록 삭제. 받아 둔 사진 주소도 404 |

거울 모양: `[{type:'doc', doc:{v:'ed1', doc:{type:'doc', content:[{type:'image', attrs:{src:'share:<사진 id>', key:'<64자>'}}…]}}}]`. `key` = sha256(`<페이지 id>:<노트 사진 src>`) — Drive 파일 번호는 짝 페이지에도 남기지 않는다. 공유 페이지 블록 검사(`app_share_pages_blocks_check`, doc 블록 바깥 모양)를 그대로 지나므로 **DB 변경 없음**.

읽기(`share-page-read`, verify_jwt=false 그대로): 짝이 있으면 노트의 지금 글에서 `drive:` 사진 src마다 지문을 셈 → 거울에 있는 사진 id만 → `mediaForPage`(그 **페이지 소속** 기록만) → 5분 서명 주소를 `media`로. 그 밖의 사진은 자리만. 파일 칸은 이름·크기만(Drive 번호·링크 없음 — ①에서 파일 칸 src가 그대로 나가던 것을 함께 막음). 거울만 따로 보이지 않게: 짝을 못 읽으면 503, 짝이 없는 거울 페이지(예: 휴지통에서 되살린 옛 짝 페이지)는 404.

새 공개 버킷·anon 권한·RLS 완화·새 RPC 없음. 쓰는 길은 기존 owner RLS REST(`app_share_pages` blocks)와 기존 로그인 Edge(`basket-files`·`share-page-media`)뿐. 시험: `tests/security/share-page-read-note.test.mjs`(③ 3개), `tests/note-publish-model.test.mjs`, `tests/app-e2e/note-publish.spec.mjs`(실제 Edge 처리 코드를 메모리 저장소 위에서 돌림).
