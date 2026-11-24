# NOTE-게시: 공유 페이지를 노트 안 기능으로 (S69-77)

명진 요청(2026-11-24 21:41): "노션의 자유로운 편집 기능과 페이지 공유 게시 기능을 나의 노트에도 가져와서 공유 페이지를 아예 노트 내 기능으로 만들어버리고 별도 메뉴에서 공유 페이지 삭제". CC 1단계 안(21:42 "ㄱ"): 공유 페이지 → 노트 게시로 합치기.

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

1. **① 서버·DB**(이 PR): migration `20261124220000_note_share_pages` + 짝 파일 5개, `share-page-read` 노트 길, 시험.
2. **② 화면**: 노트 ⋯ [공유 링크 만들기]/[링크 복사]/[게시 멈춤], 노트 머리 한 줄 '게시 중 · 링크 복사 · 게시 멈춤', 목록 '게시 중' 거르기. 잠근 폴더 노트는 게시 메뉴를 내지 않음. 공유 페이지 목록에서 짝이 있는 줄은 빼기(노트 쪽에서만 보임).
3. **③ 옮기기·메뉴 제거**: 공유 페이지 글 → 노트 옮기기 migration(페이지마다 노트 한 줄 + 짝 한 줄, 페이지·링크·짧은 주소는 그대로라 보낸 주소가 안 깨짐). 글 블록 페이지는 doc을 그대로, 옛 6종 블록은 문단으로, HTML 파일 페이지·`share:` 사진 처리는 명진 결정 뒤(아래 4절). 되돌리기 SQL·snapshot 포함. 그 뒤 왼쪽 메뉴·메뉴 수정의 '공유 페이지' 화면·경로 제거(데이터 보존, 옛 주소는 노트로).

## 4. 남은 결정·위험

- HTML 파일 공유 페이지는 노트 글로 바꿀 수 없다: 노트 첨부(HTML 첨부 보기)로 옮기고 공개는 지금처럼 HTML 판을 보여 줄지, 그대로 둘지 ③ 전에 정한다.
- 공유 페이지 사진(`share:`)을 노트로 옮기면 노트 편집기에서는 안 보인다. ③에서 공개용 사진은 짝 페이지 소속으로 계속 보여 주는 방법(읽기 함수가 짝 페이지의 사진 기록만 서명)을 같이 낸다.
- 마크다운으로 쓴 노트(metadata.markdown)는 ①에서 글자 그대로 문단으로 보인다.
