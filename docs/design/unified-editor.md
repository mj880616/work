# ED-통합편집기 설계 (블로그 글쓰기형 편집기 하나로 일기·업데이트·노트·공유 페이지)

📱 폰 가능(이 문서) · 이 문서는 설계·조사만 한다. 앱 코드·DB·Edge·Cloudflare·설정 변경 없음.

- 작성: 2026-10-22, Claude Code 웹(설계 조사 세션). 기준 main `5b0ba276`(#957).
- 원장 행: ED-통합편집기(요청함 2026-10-22 09:28 접수). 관련 행: NOTE-마크다운선택(#898), MD-편집기(#582), MD-내보내기(8-11a 완료·8-11b 남음), SHARE-현장공유·SHARE-보이는편집(#845), BUG-공유페이지삼성(#839), JOURNAL-일기.
- 표시: **사실** = 저장소 코드·migration·문서로 확인. **추정** = 확인 못 한 짐작(운영 DB·Edge는 조회하지 않았다). **측정** = 이 세션에서 직접 재 본 값.

---

## 0. 명진이 정할 것 (한 번에 고르기)

각 항목에서 **굵은 것이 추천**이다. "전부 추천대로"라고만 답해도 된다.

1. **편집기 엔진** — **가. ProseMirror(추천)** · 나. Tiptap(ProseMirror 위에 덧씌운 것) · 다. Lexical · 라. 직접 만들기. 근거 2절.
2. **치는 중 자동 서식** — **가. 끔(추천)**: `1. `·`- `·날짜를 쳐도 목록·제목으로 바뀌지 않는다. 서식은 버튼으로만. · 나. 켬(노션처럼 `# `→제목).
3. **AI 답변(마크다운 글자) 붙여넣기** — **가. 그대로 붙이고, 마크다운 기호가 보이면 작은 [서식으로 바꾸기] 한 번 누르기(추천, 되돌리기 가능)** · 나. 항상 자동으로 서식 변환 · 다. 변환 기능 없음.
4. **① 버튼** — **가. 누를 때마다 바로 앞 줄 번호의 다음 번호(①→②→③, 앞에 없으면 ①)(추천)** · 나. 항상 ①만 넣기.
5. **기존 노트 옮기기** — **가. 열어서 저장할 때 한 편씩 바뀜 + 바꾸기 전에 전체 원본을 한 번 따로 백업(추천)** · 나. 하루 날 잡아 한 번에 전부 변환 · 다. 옛 노트는 옛 방식 그대로 두고 새 노트만 새 편집기.
6. **기존 공유 페이지 블록(진행 단계 막대·일정표 등)** — **가. 옛 블록은 그대로 보이고 고칠 수 있게 두고, 새 글은 새 편집기 칸 하나로. 원하면 [새 편집기로 바꾸기] 버튼으로 옮김(추천)** · 나. 모두 새 편집기로 바꿈(진행 단계 막대 모양은 번호 목록으로 바뀜).
7. **공유 사진이 링크를 끈 뒤 언제 안 보이나** — **가. 5분 안(사진 주소를 5분짜리로 발급, 추천)** · 나. 즉시(사진마다 서버가 매번 확인해 내려 줌, 느리고 서버 부담 큼).
8. **공유 사진 크기** — **가. 긴 변 1600px, JPEG(추천)** · 나. 2048px(일기와 같음) · 다. 1280px.
9. **업데이트에 서식 저장** — 가. 바구니 업데이트(미분류)는 서식까지 저장, 담당조직·프로젝트 기록으로 바로 보내는 업데이트는 글자만 저장 · **나. 모든 업데이트에 서식 저장(조직·프로젝트 표 2개 DB 변경 추가) — 사용자 결정(2026-10-22 16:00, 10-23 17:21 재확인)**. 주간보고·업무일지로 들어갈 때는 글자만(11.3).
10. **일기** — **가. 글 칸만 새 편집기로 바꾸고 사진 달력·사진 넘기기는 지금 그대로(추천)** · 나. 글 사이에 사진도 넣기(사진 위치 저장 추가).
11. **노트 '마크다운' 체크(10/21 17:53 요청, #898로 이미 완료)** — **가. ③ 노트 단계가 끝나면 체크 칸을 없애고 이 과제에 합침(추천)** · 나. 체크 칸을 계속 둠. 자세히 7절.
12. **표 기능 범위(첫 버전)** — **가. 칸 추가·삭제, 머리줄, 칸 합치기 없음(추천)** · 나. 칸 합치기까지.

---

## 1. 현재 상태 조사 (사실)

### 1.1 한눈에

| 화면 | 편집 | 저장 위치·형식 | 읽기 화면 | 사진 |
| --- | --- | --- | --- | --- |
| 노트 | `md-editor.js` 큰 창(마크다운 글자 + 서식 버튼이 기호 삽입) · 노트 상세 `textarea` | `app_notes`(kind=note) `title`, `raw_text`(글자, 10만 자), `metadata.markdown`(true/false, #898) | `markdown-view.js`(markdown-it + DOMPurify) 또는 쓴 그대로(`showPlainText`) | 첨부(`attachments` jsonb, Drive "노트 첨부" 폴더), 보기는 `basket-files?action=photo`(owner만) |
| 업데이트(바구니) | 한 줄 입력(`home-quick.js`) · ⤢ 크게 = `write-window.js` → `md-editor.js` · 상세 수정 `basket.js` → `md-editor.js` | `app_notes`(kind=basket) `raw_text`(2만 자) | `markdown-view.js` | 첨부(Drive) |
| 업데이트(담당조직·프로젝트로 바로) | 같은 쓰기 창, 저장만 다른 표 | `app_suborganization_updates.raw_text` · `app_project_progress_updates.summary`(`quick-save.js`) | 각 화면이 글자로 | 없음 |
| 일기 | `diary.js` 편집 칸의 `textarea` | `app_notes`(kind=diary, 하루 1행) `raw_text`(2만 자), `ai_export_allowed=false` 강제(DB) | `.diary-text`(`white-space:pre-wrap`, 글자 그대로) | 하루 20장, 폰에서 긴 변 2048px JPEG로 줄여 Drive 업로드(`diary-data.js shrinkPhoto`), 사진별 코멘트 `metadata.photo_comments` |
| 공유 페이지 | `share-pages.js` 블록 틀 편집 + "보이는 그대로"(#845) | `app_share_pages.blocks` jsonb(6종: 한 줄 현황·진행 단계·일정·쟁점·자료·업데이트 기록), DB check가 6종 외 거절·60블록·256KB | Web1 `share/` → Edge `share-page-read` → `app/sr-render.mjs`(Web2 미리보기와 같은 모듈, `textContent`만) | 없음 |

### 1.2 공용 편집기 `md-editor.js`

- 부르는 곳 3곳(사실): `write-window.js`(새 글: 업데이트/노트), `basket.js`(업데이트 큰 창 수정), `basket-notes.js`(노트 큰 창 수정, `keepOpen`).
- 편집 바탕은 `textarea` 하나. 서식 버튼은 `md-editor-ops.mjs`가 마크다운 기호를 넣고, `execCommand('insertText')`로 브라우저 되돌리기에 남긴다. 미리보기는 `markdown-view.js`.
- 이 모듈은 저장하지 않는다. 여는 쪽이 `save.run(text, kind, {title, markdown})`로 기존 저장 경로를 쓴다. → **새 편집기도 이 계약(글을 넘기고 저장은 여는 쪽)을 그대로 이어받으면 여는 쪽 3곳의 저장 코드는 거의 그대로 둔다.**
- 머리줄·자판 하단바·PC 메뉴 옆 배치·닫기 확인 시트 등 창 껍데기 기능이 이 파일에 함께 있다(514줄).

### 1.3 마크다운이 글을 망가뜨리는 이유 (사실)

- 저장은 글자 그대로지만, 읽기·미리보기가 마크다운으로 해석한다. `2026.10.21.`처럼 숫자+점으로 시작하는 줄을 번호 목록으로, `- `·들여쓰기를 목록·코드로 읽는다(요청함 10/21 17:53 원문 사례).
- #898은 노트마다 "마크다운 해제 = 쓴 그대로 보이기"로 우회했다. 업데이트·바구니 읽기는 여전히 마크다운으로 해석한다.
- 새 편집기에서는 **서식이 기호가 아니라 구조로 저장**되므로, 글자 `1.`은 언제나 글자다. 해석 단계가 없어 이 문제가 근본적으로 사라진다.

### 1.4 본문을 꺼내 쓰는 곳 (raw_text 소비처, 사실)

| 기능 | 위치 | 쓰는 값 |
| --- | --- | --- |
| 텔레그램용 복사 | `md-telegram.mjs`(`md-editor.js` 내보내기, 노트 목록·상세 [복사] `note-preview.mjs`) | 마크다운 글자 → 꾸밈 기호 뺀 글자 |
| 한글용 복사 | `md-hangul.mjs` | 마크다운 → text/plain + text/html(굵게·표), 번호 기호 단계 들여쓰기(`docs/hwp-style-map.md` 3절) |
| HWP 파일로 받기 | `md-editor.js` 내보내기 목록에만 있고 "준비 중"(8-11b 미구현) | — |
| 노트 목록 미리보기 | `note-preview.mjs` `plainInline` | 마크다운 기호 걷어 낸 글자 |
| 노트 검색 | `basket-notes.js` `matches`: `title + raw_text` 소문자 포함 검사(화면 안, 서버 검색 아님) | raw_text |
| "전체 검색" | **하나로 된 전체 검색 기능은 찾지 못했다.** 노트 검색·자료 검색·원장 찾기(`ledger-browse.js`)가 따로 있다 | — |
| AI(서버) | `ai-assist` Edge: 노트 한 개 요약(`raw_text`), 챙길 것 후보(`kind in basket,note,work`, `ai_export_allowed=true`의 `title+raw_text`), 조직 업데이트 `raw_text` | 글자 |
| AI 넘기기(화면) | `basket-ai-handoff.js`·`basket-ai-summary.js` | raw_text(일기 제외) |
| 연결 기록 요약 | `basket-link-records.js` `recordText`·`noteExcerpt(raw_text)`, `record-sheet.js` | 글자 앞부분 |
| 업무일지·주간보고 | `journal-data.js`(조직 업데이트 `raw_text` 첫 줄, 노트는 제목만), `drive-summary`(조직 업데이트 `raw_text`), `journal-hwpx.js`/`weekly-hwpx/` | 글자 |
| 바구니 파일 올리기 | `basket-files` Edge가 `raw_text`를 받아 행 생성 | 글자 |

→ **결론: 이 소비처들이 모두 `raw_text`(글자)만 읽으므로, 새 편집기가 저장할 때 `raw_text`에 "글자 꺼내기" 결과를 계속 넣으면 이들은 손대지 않아도 계속 된다.** 바뀌어야 하는 것은 복사(텔레그램·한글)와 읽기 화면뿐이다(3절).

### 1.5 Web1 공유 페이지 렌더 경로 (사실)

- `work.bokdoong.com/work/share/?t=<링크 값>` → `share/share.js`가 값을 `#`로 옮김 → Edge `share-page-read`(verify_jwt=false)에 POST `{token}` → 지문 확인·꺼짐·기한·게시 상태 확인 → `{title, blocks}`만 반환 → `app/sr-render.mjs`의 `renderPage`가 `textContent`로 그림.
- `share/index.html` CSP: `img-src 'self'`, `connect-src`는 Supabase 주소 하나. 사진을 넣으려면 CSP 변경이 필요하다(5절).
- Edge는 `blocks`가 배열인지만 본다(블록 안 모양은 보지 않음) → **새 블록 종류를 넣어도 Edge 글자 읽기는 바뀌지 않는다.** 사진 주소 발급에는 Edge 변경이 필요하다.
- `sr-render.mjs`는 Web1이 불러오므로 옛 삼성 인터넷 문법(`?.`·`??`·`replaceChildren` 금지)과 클래스 이름에 "share" 금지 규칙이 있다(BUG-공유페이지삼성). 새 그리기 코드도 이 규칙을 따라야 한다.
- 링크 미리보기 카드: Cloudflare Worker(`cloudflare/bokdoong-router.mjs`)가 제목만 넣는다. 본문 형식과 무관.

### 1.6 사진 처리 현황 (사실)

- 일기: 브라우저에서 `createImageBitmap(file, {imageOrientation:'from-image'})` → canvas → `toBlob('image/jpeg', 0.86)`로 긴 변 2048px로 줄인다. **단, 이미 2048px 이하인 JPEG는 원본 그대로 올린다**(`shrinkPhoto`: `scale === 1 && file.type === 'image/jpeg'`이면 `return file`). → 이 경우 원본 EXIF(위치 포함)가 Drive에 남는다(사실; Drive 비공개라 지금은 문제 아님). 공유 사진에는 이 예외를 두면 안 된다(5.4).
- Supabase Storage 사용처는 `event-media`(버킷 `team-event-media`, 서버 키 + 서명 주소) 하나(사실). 저장소 migration에 `storage.buckets`·`storage.objects` 정책 정의는 없다(사실; 운영 버킷 설정은 확인 못 함, 추정: 대시보드에서 만든 것).

---

## 2. 편집기 엔진 비교

### 2.1 비교표

크기는 이 세션에서 esbuild로 한 파일로 묶어 잰 값(**측정**, 표·목록·되돌리기·붙여넣기 포함 최소 구성, min / gzip).

| | 가. ProseMirror (추천) | 나. Tiptap | 다. Lexical | 라. 직접 contenteditable |
| --- | --- | --- | --- | --- |
| 크기(측정) | 약 256KB / 79KB (model·state·view·transform·commands·history·keymap·tables·schema-list) | 약 488KB / 153KB (core·starter-kit·table·image·text-align, ProseMirror 포함) | 약 253KB / 81KB (lexical·rich-text·table·list·history·html) | 0 (대신 코드 수천 줄 추정) |
| 고정 버전·무결성 | npm 공개, 버전 고정 + sha512 확인 가능. 패키지가 여러 개라 **반입할 때 한 파일로 묶어야 함**(같은 패키지가 두 번 들어가면 깨짐) | 같음(패키지 더 많음) | 같음(여러 패키지 → 묶기 필요) | 해당 없음 |
| CDN + SRI | jsdelivr 고정 버전 파일에 SRI 가능. 다만 여러 패키지를 브라우저가 따로 받는 구조라 import map 필요 | 같음 | 같음 | — |
| 한글 IME | 조합 중에는 화면을 건드리지 않는 처리가 오래 다듬어짐. 안드로이드 키보드 대응 코드 있음(**추정**: 실기기 확인 필요) | ProseMirror와 같음 | 한글·안드로이드 조합 관련 버그 보고가 이어져 왔음(**추정**) | 조합 중 처리를 전부 직접 해야 함. 가장 위험 |
| 표 | `prosemirror-tables`(칸 추가·삭제·합치기, 칸 선택) | 같은 것을 감쌈 | `@lexical/table` | 직접 |
| 사진 | 스키마에 image 노드 직접 정의(주소 모양 우리가 정함) | image 확장 | 직접 노드 정의 | 직접 |
| 붙여넣기 정리 | 스키마에 없는 모양은 자동으로 버림(허용 목록 방식). 붙여넣기 전 변환 함수 제공 | 같음 | `@lexical/html`이 변환 | 직접 정화(DOMPurify 재사용 가능하나 구조 변환은 직접) |
| 저장 형식 | 스키마 JSON(우리가 정한 노드 이름) | 같음(Tiptap 이름) | Lexical 고유 JSON(버전마다 바뀐 이력, **추정**) | 직접 |
| 유지보수 | 작은 핵심 라이브러리, 업데이트가 잦지만 하위 호환 중시. 화면 코드(버튼 줄)는 직접 써야 함 | 편하지만 두 겹 의존, 3.x 대개편 이력, 일부 기능 유료 확장 | Meta 주도, 0.x(아직 1.0 아님)라 바뀜이 큼 | 전부 우리 몫. 브라우저마다 다른 동작을 계속 쫓아야 함 |
| 라이선스 | MIT | MIT(일부 확장 유료) | MIT | — |

### 2.2 추천: ProseMirror (반입 방식은 저장소 직접 보관)

- **한글 IME 안정성**과 **표 기능**이 이 과제의 핵심 위험인데, 둘 다 가장 오래 쓰인 바탕이다. 직접 만들기(라)는 IME·붙여넣기·되돌리기를 모두 새로 만들어야 해 이 저장소의 "중복 구현 금지·임시방편 금지" 원칙과 맞지 않는다.
- Tiptap은 같은 바탕에 크기가 두 배이고, 우리가 필요한 것(작은 버튼 줄·우리 모양)은 어차피 직접 그린다. Lexical은 크기는 같지만 0.x라 저장 형식이 바뀔 위험이 크다.
- **반입 방식**: 이 저장소는 실행 중에 CDN을 부르지 않고 라이브러리를 저장소에 넣는다(`app/markdown-lib/`, `app/pdf-lib/`, `app/hwp-lab/rhwp-0.8.7/` — 사실). 같은 방식으로:
  - `scripts/editor/editor-pin.json`에 패키지별 버전·sha512 고정 → 반입 스크립트가 npm에서 받아 sha512 확인 → **고정 버전 esbuild로 한 파일(ESM)로 묶어** `app/editor-lib/prosemirror-<묶음 이름>/`에 `LICENSE`·`SOURCE.md`·`SHA256SUMS`와 함께 둔다. 테스트가 pin·폴더·해시를 매번 대조한다(`tests/markdown-view.test.mjs`와 같은 방식).
  - 버전은 반입하는 날 기준 공개 2주가 지난 최신 안정판(MD-표시 기준과 같음).
  - CDN + SRI도 가능하지만, 여러 패키지를 import map으로 이어야 하고 외부 주소 의존이 생기므로 쓰지 않는다.
- **불러오는 시점**: 편집기를 열 때만(약 80KB gzip). 읽기 화면은 엔진 없이 우리 그리기 함수로 그린다(3.4) → Web1 공유 페이지는 엔진을 받지 않는다.

### 2.3 편집기 부품 모양 (요청 그대로)

- 한 칸에 이어 쓰는 문서. 문단마다 블록 손잡이·끌기 없음.
- 위쪽 버튼 줄(높이는 UI-버튼작게 `--ds-compact-height-sm` 28px, 누르는 범위 44px; `docs/design-decisions.md` UI-버튼기준):
  ① `본문 2 ▾`(제목 1·2·3, 본문 1·2·3 — 지금 문단의 단계가 글자로 보임) ② 굵게·기울임·밑줄·취소선 ③ `·` `※` `→` `①` ④ 인용·사진·표·목록·번호 목록·구분선 ⑤ 왼쪽·가운데 정렬.
- 폰에서 넘치면 가로로 넘기기(`overflow-x:auto`, 줄바꿈 없음). 버튼을 눌러도 글 칸 초점·폰 자판이 유지되게(`md-editor.js`의 `pointerdown` 처리와 같은 방식).
- 보이는 모양: 넓은 여백, 큰 제목, 옅은 인용선, 가운데 정렬 사진, 얇은 선 표. 색·크기는 `theme-tokens.css`의 토큰만 쓴다.
- 창 껍데기(머리줄, 저장 아이콘, 닫기 확인, 폰 하단 탭, PC 메뉴 옆 배치, 내보내기 시트)는 `md-editor.js`의 것을 그대로 옮겨 쓴다(새로 만들지 않음). 실제로는 `md-editor.js` 안의 "글 칸" 부분만 갈아 끼우는 구조를 추천한다(①단계 PR에서 확정).

---

## 3. 저장 형식

### 3.1 원칙: 구조(JSON) + 글자 꺼내기(plain text)를 함께 저장

- **구조**: ProseMirror 스키마 JSON. 우리 스키마 이름 `ed1`을 문서에 넣는다(`{"v":"ed1","doc":{...}}`). 나중에 스키마를 바꾸면 `ed2`로 올리고 읽을 때 변환한다.
- **글자**: 저장할 때마다 구조에서 만들어 `raw_text`(공유 페이지는 해당 없음)에 넣는다. 1.4의 소비처(검색·AI·업무일지·연결 요약 등)는 그대로 둔다.
- **구조가 원본, 글자는 사본**이다. 글자만 고쳐 넣는 다른 경로가 있으면 구조와 어긋나므로, 구조가 있는 행을 글자로만 고치는 경로는 막거나(구조를 지우고 글자 원본으로 돌림) 구조도 함께 고친다(③ 단계에서 경로별 확인; 지금 노트 글자만 고치는 경로는 `saveNoteDoc`·`patchKind`·`moveToNote`·`basket-files` 업로드 — 사실).

### 3.2 스키마(노드·꾸밈) 초안

- 노드: 문단(`style`: body1·body2·body3, `align`: left·center), 제목(level 1~3, `align`), 인용, 목록·번호 목록·목록 항목, 구분선, 표·표 줄·표 칸(머리 칸 구분), 사진(`src` 모양은 아래, `alt`, `align`), 줄바꿈, **코드 묶음**(버튼은 없지만 옛 마크다운 노트의 코드·도식을 잃지 않으려고 둠).
- 꾸밈: 굵게·기울임·밑줄·취소선·링크(http·https·mailto만).
- 사진 `src`는 주소가 아니라 **우리 식별자**만: 노트·일기·업데이트는 `drive:<Drive 파일 ID>`(그 행의 `attachments`에 있어야 보임), 공유 페이지는 `share:<사진 ID>`. 바깥 주소 사진은 넣지 않는다(붙여넣기에서 들어오면 "이미지: 설명" 링크 글자로 바꿈 — `markdown-view.js` 규칙과 같음).

### 3.3 저장 위치(표별)

| 대상 | 구조 저장 | 글자 저장 | DB 변경 |
| --- | --- | --- | --- |
| 공유 페이지 | `app_share_pages.blocks`에 새 블록 종류 `{"type":"doc","doc":{...}}` | 없음(공유 페이지는 글자 소비처 없음) | **있음**: blocks check에 `doc` 추가(6종→7종), 크기 한도 검토 |
| 노트·일기·바구니 업데이트(`app_notes`) | 새 칸 `doc jsonb null`(null = 옛 글자 원본) | `raw_text` = 구조에서 꺼낸 글자 | **있음**: 칸 추가 + 크기 check. 권한은 기존 표 권한·owner RLS 그대로(새 정책 없음) |
| 담당조직·프로젝트 업데이트 | 결정 9 나: 새 칸 `doc jsonb null`(11.3) | `raw_text`·`summary` = 구조에서 꺼낸 글자 | **있음**: 표 2개에 칸 추가(11.3) |

- `metadata` jsonb에 넣는 방법도 있지만(DB 변경 없음), `metadata`는 고정·폴더·할 일·일지 표시 등 여러 곳이 키별 동시 수정 보호(guard)를 걸고 쓰는 칸이라(사실: `saveNoteDoc`의 guard 줄) 큰 문서를 섞으면 충돌·크기 위험이 커진다. **새 칸을 추천한다.**
- 크기: 노트 `raw_text` 10만 자 한도는 글자에 그대로 둔다. `doc`은 예: `octet_length(doc::text) <= 1MB`(사진은 식별자뿐이라 충분, 추정).

### 3.4 글자 꺼내기·복사·HWP·AI·검색이 계속 되게

모두 한 모듈(예: `app/ed-text.mjs`, 순수 함수, Node 테스트 가능)에서 구조를 읽어 만든다.

| 출력 | 규칙(초안) |
| --- | --- |
| 글자(`raw_text`, 검색·AI·일지용) | 문단·제목은 한 줄씩, 빈 줄로 구분. 목록 `- `, 번호 목록 `1. `(실제 번호), 인용 `> `는 빼고 글만, 구분선 `────`, 표는 줄마다 `칸 | 칸`, 사진은 `[사진: 설명]`, 꾸밈 기호 없음 |
| 텔레그램용 복사 | 위 글자와 같되 목록은 `• `, 제목 뒤 빈 줄(`md-telegram.mjs` 규칙표 `docs/markdown-view.md` 8절과 같은 모양으로 맞춤) |
| 한글용 복사 | text/plain + text/html(제목·굵게·밑줄·표·가운데 정렬). 손으로 쓴 번호 기호 줄의 단계 들여쓰기는 `md-hangul.mjs`의 `markLevel` 규칙을 재사용 |
| HWP 파일로 받기(8-11b) | 구조 → 한글 문단·표. 마크다운을 거치지 않으므로 더 정확해진다. 구현은 8-11b에서(이 과제 밖, 순서는 4단계 뒤 추천) |
| AI | 지금처럼 `raw_text`(글자). 서식이 필요한 AI 넘기기가 생기면 구조 → 마크다운 변환을 그때 추가 |
| 노트 목록 미리보기·검색 | `raw_text` 그대로(이미 글자) |
| 읽기 화면 | 구조 → DOM을 우리 함수로 그림(`textContent`만, 허용 노드만, 링크 http(s)·mailto). Web2와 Web1이 같은 함수를 씀(`sr-render.mjs` 옆에 `ed-render.mjs`, 옛 삼성 문법 규칙 적용) |

---

## 4. 기존 글 옮기기 (내용 손실 없이)

### 4.1 노트·업데이트·일기 (결정 5 가: 열 때 변환 + 전체 백업)

1. **백업 먼저**(③ DB 단계와 같은 승인 흐름): 변환 시작 전에 `app_notes` 중 kind in (note, basket, diary)의 `id, raw_text, metadata, updated_at`를 비공개 백업 표에 한 번 복사(승인형 DB workflow의 백업 단계 또는 SQL Editor, 백업 표 권한은 모두 회수 — `docs/ops-db-workflow.md` 백업 규칙). 일기 원문도 같은 백업 표에 들어가므로 백업 표는 반드시 비공개.
2. **열 때 변환**: `doc`이 null인 행을 새 편집기로 열면
   - 마크다운 판정(`noteMarkdown`: 저장된 체크값, 없으면 기호 추정 — 사실, `note-markdown.mjs`)이 **켜짐**이면 이미 반입된 markdown-it 토큰으로 구조를 만든다. 제목·굵게·목록·표·인용·구분선·링크는 그대로, 강조 상자(`> [!NOTE]`)는 "참고:" 머리가 붙은 인용, 체크 목록은 `☐`/`☑` 글자가 든 목록, 코드·도식(mermaid)·수식은 **코드 묶음에 원문 그대로**(그림은 안 보이지만 글은 남음).
   - **꺼짐**이면 줄마다 문단 하나. `1.`·`-`·날짜는 글자 그대로(해석 없음). → 직접 쓴 글은 하나도 바뀌지 않는다.
   - 열기만 해서는 DB에 쓰지 않는다. 사용자가 저장할 때 `doc` + 새 `raw_text`가 함께 저장된다.
3. **주의(사실)**: 마크다운 노트를 저장하면 `raw_text`가 "기호 없는 글자"로 바뀐다(예: `## 제목` → `제목`). 검색·AI에는 오히려 낫지만 원래 글자는 백업 표에만 남는다. 그래서 1번 백업이 필수다.
4. **되돌리기**: 행 단위로 `doc = null, raw_text = 백업 raw_text`(백업 뒤 다시 고친 행은 제외하고 목록으로 보고). 화면은 `doc`이 null이면 옛 방식(markdown-view/쓴 그대로)으로 그리므로, 화면 코드를 되돌리지 않아도 옛 글은 계속 읽힌다.
5. 변환 결과 확인: 변환 함수에 "옛 글자 → 구조 → 글자"가 원문의 글(기호 제외)을 모두 담는지 비교하는 Node 테스트를 둔다(실제 노트는 쓰지 않고 견본 글로).

결정 5 나(한 번에 변환)는 사용자가 모든 노트를 열어 보지 않아도 되지만, 변환 오류가 한꺼번에 퍼지고 Edge·DB 쓰기 작업이 필요해 추천하지 않는다. 다(옛 노트는 옛 방식)는 두 편집기를 계속 유지해야 한다.

### 4.2 공유 페이지 (결정 6 가)

- 옛 6종 블록은 그대로 두고 지금처럼 보이고 고칠 수 있다. 새 페이지는 `doc` 블록 하나로 시작한다. 한 페이지에 옛 블록 + `doc` 블록이 섞여도 순서대로 그린다(DB·Edge가 그대로 받음).
- [새 편집기로 바꾸기](선택): 한 줄 현황 → 큰 문단, 진행 단계 → 번호 목록(지금 단계는 굵게 + "(지금)"), 일정 → 2칸 표, 쟁점 → 제목 3 + 문단, 자료·링크 → 링크 목록, 업데이트 기록 → 날짜 굵게 + 문단 목록. 바꾸기 전 블록 원본은 같은 행의 이전 값으로 [취소] 가능, 저장 전 "보이는 그대로" 미리보기로 확인. 진행 단계 막대 그림은 사라진다(그래서 선택).
- 되돌리기: 저장 전이면 취소. 저장 뒤에는 Web2에 저장 이력이 없으므로(사실: `app_share_pages`에 이력 표 없음) **바꾸기 직전 블록을 같은 페이지의 숨은 백업 값으로 두는 것**을 ① 단계 PR에서 검토(예: 바꾸기 할 때 원본을 `doc` 블록 안 `legacy` 속성에 보관하고 Web1 응답에서는 빼기 — 추정, Edge 응답에서 빼려면 Edge 변경 필요하므로 대안: 바꾸기 전에 [복사본 만들기]로 초안 페이지를 하나 남김. ①b PR에서 쉬운 쪽으로 확정).

---

## 5. 공유 사진 보관

### 5.1 요구와 원칙

- 노트·일기·업데이트 사진: 지금처럼 Drive 비공개, 보기는 owner 전용 `basket-files?action=photo`(사실). 변경 없음.
- 공유 페이지 사진: **따로 복사해 Web2 쪽에 보관**, 링크가 살아 있고 페이지가 게시 상태일 때만 보임. Drive '링크 있는 누구나' 금지. 크기 줄이기 + 위치 정보 제거.
- 저장소 규칙: anon·PUBLIC 권한·정책 추가 금지(AGENTS.md 3절, ops-db-workflow 확장 규칙이 거절), Web2 원본은 비공개 유지·공개할 내용만 Web1(5절).

### 5.2 추천 구조: 비공개 버킷 + 서버만 열쇠 + 짧은 서명 주소

| 부분 | 내용 |
| --- | --- |
| 저장 공간 | Supabase Storage **비공개 버킷** 하나(예: `share-page-media`), public=false. `storage.objects`에 **anon·authenticated 정책을 하나도 만들지 않는다** → 브라우저는 직접 읽기·쓰기 불가, 서버 키(service_role)만 접근 |
| 기록 표 | `app_share_page_media`(id, workspace_id, page_id → `app_share_pages` on delete cascade, 저장 경로, 가로·세로·바이트, 만든 시각). owner RLS(`private.app_is_workspace_owner`), anon 권한 없음, service_role은 읽기에 필요한 칸만(기존 `app_share_page_links`와 같은 모양) |
| 올리기 | 새 Edge 함수(예: `share-page-media`, **verify_jwt=true** + 코드에서 owner 확인). 브라우저가 줄인 JPEG를 보내면: 로그인·owner·페이지 소유 확인 → 파일 검사(5.4) → 버킷에 저장 → 기록 표에 행 → `share:<id>` 반환 |
| 지우기 | 같은 함수의 지우기 동작(owner 확인 → 버킷 파일 + 행 삭제). 페이지 삭제 때 남는 파일 정리도 이 함수가 맡음(DB cascade는 행만 지우므로) |
| 읽기 | 기존 `share-page-read`가 성공 응답(링크 살아 있음·게시 상태)일 때만, 그 페이지 `doc` 안 `share:<id>` 중 **그 페이지 소속으로 기록 표에 있는 것**에 대해 짧은 서명 주소(결정 7 가: 5분)를 만들어 `{media:{id:url}}`로 함께 돌려줌. 링크가 꺼졌거나 초안이면 지금처럼 404 → 주소 발급 없음 |
| Web1 화면 | `share/index.html` CSP `img-src`에 Supabase 저장소 주소 추가. `<img referrerpolicy="no-referrer">`, `loading="lazy"`, 서명 주소는 화면 메모리에만 |
| Web2 편집 화면 | 같은 Edge의 owner 전용 보기 동작(서명 주소)으로 미리보기 |

- **권한을 넓히지 않는 이유**: 로그인 없는 사람이 쓰는 문은 지금 있는 `share-page-read` 하나 그대로이고, 그 함수가 링크 지문을 확인한 뒤에만 사진 주소를 만든다. DB·버킷에 anon 권한·정책을 추가하지 않는다 → "anon 읽기 정책 추가 금지" 원칙과 충돌 없음(사실 확인: 2026-10-20 공유 페이지 PR 1 migration과 같은 모양).
- **Web1 공개 경로 규칙(AGENTS.md 5절)과의 관계**: 공유 페이지는 이미 승인된 Web1 공개 경로(S1 가)이다. 공유용 사진은 "공개할 내용만 따로 복사"에 해당하고, Drive 원본(노트·일기 사진)은 비공개 그대로다. Web2 인증·RLS를 완화하지 않는다.
- **남는 위험(결정 7)**: 서명 주소는 만든 뒤 기한까지는 누구나 열 수 있다. 링크를 끈 직후 최대 5분은 이미 받은 사진 주소가 살아 있다. "즉시"가 꼭 필요하면 결정 7 나(서버가 사진마다 링크를 다시 확인하고 바이트를 직접 내려 줌; 화면은 `fetch` → `blob:` 주소, CSP `img-src blob:` 필요, Edge 호출·전송량이 사진 수만큼 늘어남).
- 다른 방식과 비교: Drive 공개(요구가 금지), 공개 버킷(링크 없이 주소만 알면 영구 열림, 금지), 사진을 DB에 base64로(256KB 한도·속도 문제) — 모두 추천하지 않는다.

### 5.3 다른 글의 사진을 공유 페이지에 넣을 때

- 노트·일기 사진을 공유 페이지에 넣으면: 브라우저가 owner 전용 사진 보기(`basket-files?action=photo`, 큰 크기)로 받아 → canvas로 다시 줄여 → 공유 사진으로 올림. Drive 파일 권한은 건드리지 않는다. 결과는 별도 사본이라 노트 사진을 지워도 공유 사진은 남고, 반대도 같다.

### 5.4 크기 줄이기·위치 정보 제거 위치

- **브라우저에서** 줄이고 다시 저장한다(기존 `shrinkPhoto` 재사용, 긴 변 결정 8). canvas로 다시 그린 JPEG에는 원본 EXIF(위치 포함)가 들어가지 않는다(사실: canvas `toBlob` 결과는 픽셀만 담음). **단, 지금 `shrinkPhoto`의 "작은 JPEG는 원본 그대로" 예외는 공유 사진에서는 끄고 항상 다시 그린다.**
- **서버에서 한 번 더 확인**(화면을 믿지 않음, AGENTS.md 3절 5): Edge가 JPEG 시작 표시·크기 한도(예: 3MB)를 확인하고, JPEG 머리 구간에 EXIF(APP1 `Exif`)·XMP가 있으면 **거절**(Deno에서 다시 그리기는 무거우므로 검사만, 추정: 라이브러리 없이 바이트 검사로 충분). 이렇게 하면 화면이 실수로 원본을 보내도 위치 정보가 공개되지 않는다.
- 사진 회전은 `imageOrientation:'from-image'`로 다시 그릴 때 반영된다(사실, 일기와 같음).

---

## 6. 단계별 작업 쪼개기

모든 PR은 merge 전 사용자 승인(커맨드센터). DB·Edge·Cloudflare 설정은 적용 직전 정지(AGENTS.md 6절). 단계마다 앞 단계 merge 뒤 시작.

### ① 편집기 부품 + 공유 페이지

- **①a ED-부품(DB·Edge 없음)**: 엔진 반입(`scripts/editor/`, `app/editor-lib/`, pin·해시 테스트), 스키마·버튼 줄·글자 꺼내기·텔레그램/한글 복사·구조 → 화면 그리기 모듈, 단위 테스트(Node), E2E(버튼 줄 가로 넘기기·초점 유지·표·되돌리기·붙여넣기 정리·마크다운 글자 붙여넣기 뒤 [서식으로 바꾸기]). 화면에는 아직 연결하지 않거나 시험 주소에서만. 되돌리기 = PR revert.
  - IME 확인은 자동 시험으로 완전히 못 한다(조합 입력 흉내만 가능). **실기기 확인 목록**(안드로이드 크롬·삼성 인터넷 + 삼성 키보드·Gboard, PC 크롬·엣지 한글 IME): 조합 중 굵게 누르기, 조합 중 엔터, 표 칸 안 입력, 목록 안 백스페이스, 붙여넣기 직후 입력.
- **①b 공유 페이지 적용**:
  1. DB(정지 지점): `app_share_pages_blocks_check`에 `doc` 추가 + doc 블록 크기 한도. 짝 파일 5개, 승인형 DB workflow(정책·권한 변경 없음, 제약 교체만 — 확장 규칙 허용 여부는 PR에서 확인, 안 되면 폰 경로 C). rollback = 제약을 6종으로 되돌림(그 전에 `doc` 블록이 있는 페이지가 없어야 함 → rollback 사전 확인 SQL 포함).
  2. 화면 PR: `share-pages.js` 편집에 새 편집기, `sr-render.mjs`에 `doc` 그리기(옛 삼성 문법), 옛 블록 그대로 + [새 편집기로 바꾸기]. Edge 변경 없음(1.5). 순서: DB 적용 → 화면 merge(Pages 배포). 되돌리기 = 화면 revert(이미 만든 `doc` 블록은 Web1에서 "표시하지 못했어요" 안내로 보임 → 그 전에 초안으로 돌리기 안내).

### ② 공유 사진 보관

1. DB(정지 지점): `app_share_page_media` 표 + owner RLS + service_role 칸 읽기, 짝 파일 5개. **버킷 만들기**는 `storage` 스키마라 승인형 DB workflow가 받는지 확인 필요(추정: 받지 않음) → 커맨드센터 승인 뒤 사용자가 대시보드에서 비공개 버킷 생성(설정값 문서화), 정책은 만들지 않음.
2. Edge(정지 지점): 새 `share-page-media`(first_deploy, verify_jwt=true 명시, `docs/web2-env6b-edge-source.md` 5절 표 사전 등록) + `share-page-read` 변경(서명 주소). 각각 승인형 Edge workflow, 되돌리기 = `share-page-read`는 이전 SHA 재배포, 새 함수는 화면이 안 쓰는 상태 유지.
3. 화면 PR: 편집기 사진 버튼(공유 페이지일 때 공유 사진 경로), Web1 그리기·CSP `img-src` 추가. 순서: DB → 버킷 → Edge 2개 → 화면 merge. CSP는 저장소 파일(`share/index.html`)이라 Cloudflare 설정 변경 아님(사실).

### ③ 노트·일기

1. 백업(정지 지점, 4.1-1).
2. DB(정지 지점): `app_notes.doc jsonb null` + 크기·형식 check. 표 권한은 이미 표 단위 grant라 새 칸도 owner RLS 안(사실: `grant select, insert, update, delete on table public.app_notes … to authenticated`). rollback = 칸 삭제(그 전에 `doc`이 있는 행의 `raw_text`가 글자로 남아 있으므로 내용은 유지, 서식만 사라짐 — 이를 rollback 요약에 명시).
3. 화면 PR(노트): 노트 쓰기·수정·큰 창·읽기 화면을 새 편집기·새 그리기로, 열 때 변환, `doc`을 고치지 않는 글자 전용 수정 경로 정리(3.1). `[마크다운]` 체크 칸 제거(결정 11 가), 옛 노트 변환에만 그 값을 씀.
4. 화면 PR(일기): 글 칸만 교체(결정 10 가). 일기는 `ai_export_allowed=false` DB 강제 그대로.
5. `basket-files` 업로드가 `raw_text`를 직접 쓰는 경로(사실)는 새 행 생성용이라 `doc` null로 두면 옛 방식으로 읽힘 — 영향 없음(PR에서 재확인).

### ④ 업데이트

- 홈·바구니 한 줄 입력창은 그대로. ⤢ 크게 쓰기(`write-window.js`)와 업데이트 수정 큰 창(`basket.js`)을 새 편집기로. 바구니 업데이트(app_notes kind=basket)는 ③의 `doc` 칸을 함께 씀(DB 추가 변경 없음). 담당조직·프로젝트로 바로 보내는 업데이트도 결정 9 나로 서식까지 저장(11절에서 범위·순서를 다시 정함).
- ④가 끝나면 `md-editor.js`의 마크다운 글 칸·`md-editor-ops.mjs`는 쓰는 곳이 없어짐 → 삭제는 사용처 확인 뒤 별도 정리 PR. 옛 글 읽기용 `markdown-view.js`는 유지.

### 그 뒤 (이 과제 밖, 원장 제안)

- MD-내보내기 8-11b(HWP 파일)를 구조 기반으로 구현. 업무일지·주간보고가 노트 서식을 쓰게 할지는 별도 결정.

---

## 7. 10/21 17:53 '노트 마크다운 체크' 요청과의 관계

- **사실**: 그 요청은 NOTE-마크다운선택으로 접수돼 **#898로 이미 merge**됐다(원장: "완료(사용자 확인 대기)", DB 변경 없음, `metadata.markdown`, 새 노트 기본 해제, 기호 판정, 해제 상태 버튼 동작·날짜 두 번 문제 포함). 요청함의 접수 줄은 아직 "대기"로 남아 있다(오래된 표시).
- **제안**:
  1. 요청함 17:53 접수 줄을 "완료 #898 · 후속은 ED-통합편집기 ③에서 대체"로 고친다(커맨드센터 몫).
  2. ③ 노트 단계 전까지는 #898 동작을 그대로 둔다(지금 직접 쓴 노트는 해제 상태로 안전).
  3. ③에서 새 편집기가 들어오면 체크 칸은 없애고(결정 11 가), 저장된 `metadata.markdown` 값은 옛 노트를 변환할 때 "마크다운으로 읽을지"를 정하는 데만 쓴다. 값 자체는 지우지 않는다(되돌리기 대비).
  4. 남은 확인 "체크 상태에서도 날짜로 시작하는 줄이 번호 목록으로 잘못 읽히는 일"은 새 편집기에서 해석 단계가 없으므로 자연히 해결 → 별도 작업 불필요.

---

## 8. 남은 위험·범위 밖 발견

- **IME**: 엔진 선택과 무관하게 안드로이드 키보드별 차이는 실기기 확인이 필요하다(①a 확인 목록).
- **두 형식 공존 기간**: ③~④ 사이에는 구조 있는 글과 옛 글자 글이 섞인다. 읽기 화면이 `doc` 유무로 갈라 그리므로 깨지지는 않지만, 글자만 고치는 경로가 남아 있으면 구조와 글자가 어긋날 수 있다(3.1, ③ PR에서 경로 전수 확인).
- **raw_text 내용 변화**: 마크다운 노트를 새 편집기로 저장하면 `raw_text`에서 기호가 빠진다. 기호에 기대는 곳은 찾지 못했지만(사실: 소비처 1.4 모두 글자 사용) 텔레그램 복사 결과 모양은 조금 달라진다.
- **공유 사진 5분 창**(결정 7).
- 범위 밖 발견(고치지 않음): `diary-data.js shrinkPhoto`는 2048px 이하 JPEG를 원본 그대로 올려 위치 정보가 Drive에 남는다(Drive 비공개라 지금 노출은 없음). 일기 사진을 나중에 공유 페이지로 옮길 때는 5.3처럼 다시 그리므로 안전.

---

## 9. 기본 기능 대조표 (ED-기본기보강, 2026-10-22 사용자 요청 19:24~19:33)

기준: 구글 문서·네이버 블로그(스마트에디터)·한글의 흔한 기본 기능. "전"은 이 작업 직전 main(SHARE-전체편집 #991까지), "후"는 이 작업 뒤. **조치 없음**은 이유를 함께 적었다.

### 9.1 글자·문단

| 기능 | 구글·네이버·한글 | 전 | 후 | 조치 |
| --- | --- | --- | --- | --- |
| 굵게·기울임·밑줄 | 셋 다 있음, Ctrl+B·I·U | 있음 | 있음 | 그대로(줄 밖) |
| 취소선 | 셋 다 있음 | 있음 | 있음 | `[⋯]` 안으로(자주 안 씀) |
| 글자색 | 셋 다 있음 | 없음 | 있음 | 6색(빨강·주황·초록·파랑·보라·회색) + 색 없음. 이름만 저장, 색은 테마 토큰 |
| 형광펜(글자 바탕색) | 셋 다 있음 | 없음 | 있음 | 5색(노랑·연두·하늘·분홍·살구) + 없음. 붙여 넣은 `<mark>`는 노랑 |
| 글자 크기·글꼴 | 셋 다 있음 | 단계(본문 1~3·제목 1~3) | 그대로 | 조치 없음: 자유 크기·글꼴은 공유 페이지·한글 복사 모양을 흩뜨림. 단계로 충분(설계 2.3) |
| 왼쪽·가운데 정렬 | 셋 다 있음 | 있음(버튼 2개) | 있음 | `[정렬 ▾]` 하나로 묶음 |
| 오른쪽·양쪽 정렬 | 셋 다 있음 | 없음 | 있음 | 추가(요청 5) |
| 들여쓰기·내어쓰기 | 셋 다 있음(Tab·Shift+Tab) | 목록 안에서만 Tab | 있음 | 문단·제목 1~8단(한 단 2em), 버튼은 `[⋯]`, Tab·Shift+Tab. 목록 안에서는 목록 단계 |
| 링크 | 셋 다 있음, Ctrl+K | 붙여넣기로만 | 있음 | `[링크]` 주소 칸(Enter로 넣기, [링크 빼기]), Ctrl+K. http(s)·mailto만, `example.org`는 https:// 붙임 |
| 서식 지우기 | 구글(Ctrl+\\)·한글 있음 | 없음 | 있음 | 굵게·기울임·밑줄·취소선·색·형광펜·정렬·들여쓰기를 걷음(글자·링크는 남음). `[⋯]`, Ctrl+\\ |
| 위·아래 첨자 | 구글·한글 있음 | 없음 | 없음 | 조치 없음: 업무 글에서 거의 안 씀. 필요하면 별도 과제 |
| 줄 간격 | 셋 다 있음 | 고정 | 고정 | 조치 없음: 읽기 모양 통일(설계 2.3) |

### 9.2 단축키·되돌리기

| 기능 | 기준 | 전 | 후 | 조치 |
| --- | --- | --- | --- | --- |
| Ctrl+B·I·U | 셋 다 | 있음 | 있음 | 시험 추가 |
| Ctrl+Z·Y, Ctrl+Shift+Z | 셋 다 | 있음 | 있음 | 시험 추가 |
| Ctrl+K(링크) | 구글·네이버 | 없음 | 있음 | 추가 |
| Ctrl+\\(서식 지우기) | 구글 | 없음 | 있음 | 추가 |
| Ctrl+S(저장) | 셋 다 | 공유 페이지 있음 | 그대로 | 여는 쪽 몫(편집기는 저장 안 함) |
| ↶·↷ 버튼 | 셋 다 | 있음 | 있음 | 그대로 |

### 9.3 붙여넣기

| 기능 | 기준 | 전 | 후 | 조치 |
| --- | --- | --- | --- | --- |
| 서식 유지 붙여넣기 | 셋 다 | 있음(허용 목록) | 있음 | 그대로. 허용: 단계·굵게·기울임·밑줄·취소선·링크·목록·인용·표·형광펜(mark). 다른 곳 색·글꼴은 버림 |
| 서식 없이 붙여넣기 | 구글(Ctrl+Shift+V)·한글 | Ctrl+Shift+V만(브라우저 기본) | 있음 | `[⋯] 서식 없이 붙여넣기` 버튼 추가(클립보드 읽기 허락이 막히면 Ctrl+Shift+V 안내) |
| 마크다운 글자 → 서식 | (AI 답변용, 우리 결정 3 가) | 있음 | 있음 | 그대로 |
| 다른 곳 표 붙여넣기 | 셋 다 | 있음 | 있음 | 시험 추가 |
| 편집기 안 표 복사·붙여넣기 | 셋 다 | 표 밖에 붙이면 표가 깨짐 | 있음 | 표 전체 복사본은 표 밖에서 표 하나로 들어감 |
| 사진·파일 붙여넣기 | 셋 다 | (아무 일 없음) | 안내 | ② 전까지 넣지 않고 안내(9.6) |

### 9.4 기호

| 기능 | 기준 | 전 | 후 | 조치 |
| --- | --- | --- | --- | --- |
| 기호 넣기 | 한글(Ctrl+F10 문자표)·네이버(특수문자) | `·` `※` `→` 한 개씩 | 펼침 | `[·]` 점·네모·별 13개, `[※]` 참고·체크 10개, `[→]` 화살표 10개, `[⋯] 「」` 괄호·단위 13개(괄호는 커서가 가운데) |
| 동그라미 번호 | 한글 문자표 | 누를 때마다 다음 번호 | 펼침 | `[①]` → ①~⑩, 다음 번호에 테두리(요청 6) |

### 9.5 표

| 기능 | 기준 | 전 | 후 | 조치 |
| --- | --- | --- | --- | --- |
| 줄×칸 골라 넣기 | 셋 다(격자) | 2×2 고정 | 있음 | 6×8 격자, 마우스 올리면·키보드 화살표로 크기 표시(요청 2) |
| 칸 우클릭 메뉴(폰 길게 누르기) | 셋 다 | 없음 | 있음 | 위·아래 줄, 왼·오른 칸, 줄·칸 삭제, 합치기·나누기, 머리줄, 글자에 맞추기, 표 고르기, 표 지우기. Esc·바깥 누르기로 닫힘, 폰 하단바 위에 뜸 |
| 칸 폭 끌기 | 셋 다 | 없음(묶음엔 있으나 꺼짐) | 있음 | `columnResizing` 켬. 폭은 칸마다 `colwidth`(px)로 저장, 읽는 쪽도 같은 비율(9.7) |
| 표 크기 끌기 | 구글·한글 | 없음 | 칸 폭으로 | 표 폭 = 칸 폭 합. 마지막 칸 오른쪽 경계를 끌면 표가 넓어짐. 따로 손잡이 없음(손잡이 하나 더는 폰에서 겹침) |
| 두 번 눌러 글자에 맞추기 | 구글·한글(경계 두 번 누르기) | 없음 | 있음 | 그 칸만 가장 긴 줄에 맞춤. 표 전체는 `[글자에 맞추기]`(폭 지움 = 옛 모양) |
| Tab 다음 칸·마지막 칸 Tab 줄 추가 | 셋 다 | 다음 칸만 | 있음 | 추가 |
| 칸 안 정렬 | 셋 다 | 왼·가운데 | 4가지 | 정렬 버튼이 칸 안 문단에 적용, 여러 칸 골라도 됨 |
| 칸 합치기·나누기 | 셋 다 | 없음(설계 결정 12 가) | 있음 | **판단**: 저장 형식이 이미 colspan·rowspan을 받고(ed-schema·ed-render) 읽는 쪽도 그림 → 추가 비용이 작고 흔한 기본이라 넣음. 메뉴·도구 줄에서, 둘 이상 골랐을 때만 켜짐 |
| 머리줄 | 셋 다 | 있음 | 있음 | 그대로 |
| 표 전체 고르기 | 셋 다(모서리) | 없음 | 있음 | 표 왼쪽 위 모서리 작은 손잡이, 메뉴 `[표 고르기]` → Delete·Backspace로 지움, ↶로 복구(요청 4) |
| 여러 칸 끌어 고르고 지우기 | 셋 다 | 끌어 고르기는 됐으나 도구 줄이 나타나며 밀려 자주 실패 | 있음 | 원인: 표 안을 누르는 순간 표 도구 줄이 생겨 글이 아래로 밀림 → 누르고 있는 동안은 도구 줄을 바꾸지 않음. Backspace로 고른 칸 내용만 지움 |
| 표 아래로 못 내려감(오류, 요청 3) | — | **오류** | 고침 | 원인: 표가 글 맨 끝이면 그 뒤에 글을 둘 자리가 없고 gapcursor가 꺼져 있었음. 글 끝에 늘 빈 줄 + gapcursor 반입·켬 + 첫 줄 ↑·마지막 줄 ↓로 표 밖 + 표 아래 빈 곳 클릭 |
| 표 아래 빈 줄 Backspace | 구글(표 선택 후 지움) | 표 끝 칸으로 들어감 | 있음 | 먼저 표 선택 표시 → 한 번 더 누르면 지움 → ↶로 복구. Delete(표 위 줄 끝)도 같음 |

### 9.6 사진·파일·기타 덩어리 (요청 3·7)

| 기능 | 기준 | 전 | 후 | 조치 |
| --- | --- | --- | --- | --- |
| [사진] 누르기 | 셋 다 | "사진 자리"만 넣음(파일 고르기 없음) | 버튼 없음 | **원인(사실)**: 사진 넣기는 처음부터 ② 공유 사진 보관(비공개 버킷·기록 표·Edge `share-page-media`·`share-page-read` 서명 주소, 5·6절)을 전제로 "자리만"으로 만들어졌다. ②가 없어 Web1 받는 쪽은 사진을 받을 길이 없다(CSP `img-src 'self'`). DB·버킷·Edge는 정지 지점이라 이번에 고치지 않음 |
| 끌어 놓기 | 셋 다 | 브라우저 기본(아무것도 안 들어가거나 글자 주소) | 안내 | 사진·파일을 놓으면 넣지 않고 "아직 넣을 수 없어요" 안내 |
| 붙여넣기 | 셋 다 | 아무 일 없음 | 안내 | 같음 |
| 기존 사진 자리 | — | 보임 | 보임 | 저장된 자리는 그대로 보이고 지울 수 있음(표·구분선과 같은 앞뒤 커서·Backspace 고르기) |
| [파일] | 네이버 | 없음 | 없음 | ②로 넘김 |
| 구분선 뒤·사진 자리 뒤 | 셋 다 | 구분선은 뒤 줄 만듦, 맨 앞 덩어리는 앞에 못 씀 | 있음 | 표와 같은 점검: 글 끝 빈 줄, gapcursor, Backspace 먼저 고르기 |
| 목록·인용 | 셋 다 | 있음 | 있음 | 목록·번호는 줄 밖, 인용은 `[⋯]`. 빈 항목 Enter로 목록 끝, Tab 단계 |

**[사진] 버튼을 빼는 쪽을 고른 이유**: 기존 결정(설계 0절 결정 6·7·8, ②단계)은 "공유 사진은 ②에서 비공개 보관과 함께"이고, "누르면 아직 안 된다고 알리는" 버튼은 사용자 화면 취향("쓰지 않는 기능은 숨기지 말고 삭제", 프로젝트 지침)과 맞지 않는다. 비활성 버튼도 같은 이유로 두지 않았다. ② 화면 PR에서 버튼을 다시 넣는다(저장 형식 `image` 노드·`share:` 식별자는 그대로라 형식 변경 없음).

### 9.7 저장 형식 변경과 호환

- 형식 이름은 `ed1` 그대로. **선택 속성·꾸밈만 더했다**: 문단·제목 `align`에 `right`·`justify`, `indent`(1~8), 표 칸 `colwidth`(칸 수만큼 px 배열, 0=정하지 않음 — prosemirror-tables 모양), 꾸밈 `color`·`highlight`(`attrs.color`는 정해진 이름만).
- 기존 글: 새 속성이 없으면 전과 똑같이 열리고 그대로 저장된다(시험: `ed-basics.spec.mjs` "기존 글 열기 호환", 열고 `getValue()`가 원본과 같음).
- DB: `app_share_pages_blocks_check`는 doc 블록의 바깥 모양(`v`·`doc.type`·`content` 배열)만 보므로 바뀌지 않는다(`20261022130000`). Edge `share-page-read`도 blocks를 그대로 돌려준다 → **DB·Edge 변경 없음**.
- Web1 받는 쪽: `ed-render.mjs`가 같은 허용 목록(`cleanDoc`)을 거쳐 정렬·들여쓰기·색 클래스와 표 칸 폭(`<colgroup>`, `table-layout:fixed`, 폭 합만큼·글 폭 넘지 않음)을 그린다. 새 문법 없음(옛 삼성 인터넷 규칙 유지). 옛 판 화면이 새 글을 받으면 모르는 속성은 무시하고 글은 모두 보인다.
- 칸 폭 비율: 편집 화면과 읽는 화면이 같은 함수(`ed-schema.mjs` `tableLayout`)로 칸마다 `폭/합`%를 쓴다. 폰처럼 좁으면 표가 글 폭으로 줄고 비율은 같다(시험: 1280 편집·읽기·390 읽기 비율 차 2~3% 이내).
- 글자 꺼내기(`ed-text.mjs`): 색·형광펜·정렬·들여쓰기·칸 폭은 글자에 영향 없음(그대로).
- 편집기 묶음: `pm-ed1-1.0.0` → `pm-ed1-1.1.0`(`prosemirror-gapcursor` 1.4.1 추가 반입, 표 묶음에서 칸 선택·합치기·나누기·칸 폭 끌기 꺼내 씀). 버전·sha512는 `scripts/editor/editor-pin.json`, 폴더 이름이 바뀌어 옛 주소 캐시와 섞이지 않음.

### 9.8 남은 것(이번에 안 함)

- 글자 크기·글꼴 자유 지정, 위·아래 첨자, 줄 간격, 찾기·바꾸기(구글·한글 Ctrl+F·H): 조치 없음(위 이유) 또는 별도 과제 제안.
- 표 칸 바탕색: 한글·구글 있음. 형광펜과 같은 이름 방식으로 넣을 수 있으나 이번 범위(요청 목록)에 없어 제안만.
- 폰 길게 누르기: 안드로이드 크롬·삼성 인터넷은 길게 누르기가 `contextmenu`로 오지만 글자 선택 손잡이가 함께 뜰 수 있다(실기기 확인 필요).

---

## 10. ② 공유 사진 보관 구현 기록 (2026-10-23, PR 한 개에 파일·시험 전부, 운영 적용은 아직)

설계 5·6절 ② 그대로 만들었고, 아래만 정했다. 결정 7(5분)·8(긴 변 1600px JPEG)은 추천안(가)대로다.

- **DB**(`20261023110000_share_page_media`, 정지 지점): 새 표 `app_share_page_media`(id, workspace_id, page_id, 저장 경로, 가로·세로·바이트) 하나. owner RLS 한 개, anon·PUBLIC 없음. authenticated는 읽기·삭제와 INSERT 7칸만(UPDATE 없음). service_role은 id·page_id·저장 경로 읽기만(공유 읽기 Edge용). 저장 경로는 `페이지 id/사진 id.jpg` 한 모양만 받는 CHECK. 짝 파일 5개(snapshot·precheck·postcheck·rollback·summary). rollback은 사진 기록이 있으면 멈춤. 버킷은 migration이 아니라 대시보드에서 만든다(설정값은 아래).
- **버킷**(정지 지점, 사용자가 대시보드): 이름 `share-page-media`, **Public 끔**, 파일 크기 제한 3MB, 허용 형식 `image/jpeg`, `storage.objects` 정책은 **하나도 만들지 않음**(서버 키만 접근).
- **Edge `share-page-media`**(신규, verify_jwt=true, 정지 지점): POST 한 문(multipart 올리기 / JSON `sign`·`delete`). 소유 확인·기록 읽기·쓰기는 로그인 토큰으로 DB(owner RLS)가 한다 → 화면이 보낸 페이지 id를 믿지 않는다. 서버 키는 버킷 저장·삭제·서명 주소에만. JPEG 시작 표시·3MB·그림 크기 1~8000px 확인, 머리 구간에 EXIF·XMP(APP1)·IPTC(APP13)가 있으면 422로 거절(바이트 검사).
- **Edge `share-page-read`**(변경, 정지 지점): 링크·기한·게시 상태를 통과한 뒤에만, 글 블록 안 `share:<id>` 중 **그 페이지 소속으로 기록된 것**에 5분 서명 주소를 만들어 `media:{id:주소}`로 함께 돌려준다. 사진이 없으면 `media` 키 자체가 없고, 사진 조회가 실패해도 글 읽기는 그대로 성공한다. 링크가 꺼졌거나 초안이면 지금처럼 404(주소 발급 없음).
- **화면**: `app/share-photos.js`(브라우저 쪽: `shrinkPhoto(redraw:true, 1600px)` → Edge 올리기 → `share:<id>`, 보기 주소는 메모리에만), 편집기 `[사진]` 버튼·끌어 놓기·붙여넣기(공유 페이지 글쓰기에서만, `photos` 옵션이 있을 때), 한 페이지 40장. 저장 안 한 새 페이지는 "먼저 저장" 안내. `ed-render.mjs`는 주소가 https로 넘어온 사진만 `<img>`(`loading=lazy`, `referrerpolicy=no-referrer`)로 그리고 없으면 자리 그대로. Web1 CSP `img-src`에 Supabase 주소 한 곳만 추가(`share/index.html`, Cloudflare 설정 아님).
- **배포 순서**: DB 적용 → 버킷 만들기 → `share-page-media` 첫 배포(`first_deploy=true`, `verify_jwt=true`) → `share-page-read` 배포 → 이 화면 PR merge. 되돌리기: 화면 revert(이미 올린 사진은 비공개 버킷에 남고 Web1에서는 자리로 보임), `share-page-read`는 이전 SHA 재배포, 새 함수는 화면이 안 쓰는 상태 유지, DB는 rollback(사진 기록이 있으면 멈춤).
- **남은 것**(이 PR 밖): 사진 설명(alt) 입력, 다른 글 사진 가져오기(5.3, ③ 단계와 함께). 버킷 파일 정리는 아래 SHARE-사진같이지우기에서 했다.
- **SHARE-사진같이지우기**(2026-10-23, 사용자 결정 "사진을 지우면 보관함 파일도 같이 지운다"): `share-page-media`에 정리 동작 `prune`(JSON `{action:'prune', page_id, keep}`)을 더했다. 소유 확인은 기존처럼 로그인 토큰 + owner RLS, 무엇을 쓰는지는 **DB에 저장된 페이지 블록**으로 정하고(`usedPhotoIds`, 개수 제한 없음, 다 못 읽으면 409로 아무것도 안 지움), 그 페이지 기록 중 안 쓰는 것을 **파일 먼저 → 기록** 순으로 지운다(한 번 100장). 파일을 못 지우면 기록이 남아 다음 정리 때 다시 지운다(따로 "삭제 대기" 칸 없이 기록 표가 대기 목록). `keep`은 아직 저장 안 한 편집 화면에 남은 사진(지울 대상에서 빼기만). 기존 `delete`도 파일 먼저로 바꿨다(파일 실패 시 503, 기록 유지). 화면(`share-photos.js` `prune`, `share-pages.js`)은 저장 성공 뒤와 편집 화면을 닫을 때 부르며 기다리지 않고 오류를 보이지 않는다. 열린 페이지마다 첫 정리는 무조건 한 번(이전 실패·탭 닫기로 남은 것 청소), 그 뒤는 사진이 빠졌을 때만. 올리는 중인 사진이 있으면 끝날 때까지 기다린다. 화면은 버킷 권한이 없다(정책 없음 그대로). 공유 페이지 자체를 지우는 화면·경로는 없다(사실, 2026-10-23): 페이지 삭제·보관 기능이 생기면 이 정리를 먼저 부른 뒤 지워야 한다(DB cascade는 기록만 지우므로 파일이 남음).
- **SHARE-페이지삭제**(2026-10-23, 사용자 요청 → 21:45 결정 "둘 다 가능하게"): 목록 줄 ⋯(PC 우클릭도 같은 메뉴)에 **[보관]·[삭제]** 둘.
  - **[보관]**: `app_share_pages.status`를 `archived`로(`20261023160000_share_pages_archived_status`, 운영 적용 run #56). 목록에서 빠져 보관함으로, 링크 행·사진 기록·파일은 그대로, 공개 링크는 `share-page-read`가 `published`만 보여 줘 저절로 404. 확인 한 번(게시 페이지는 "링크로 보던 사람도 더 이상 볼 수 없어요") 뒤 5초 [되돌리기](상태·수정 시각을 원래대로).
  - **보관함**: 목록 맨 아래 작은 접기 줄 '보관함 n'(보관한 페이지가 있을 때만, 글자 크기 meta·테두리 없음, 기본 접힘). 펼치면 제목·보관 날짜 줄, 줄은 열리지 않고 ⋯ → [되살리기]·[완전히 삭제]. 보관한 페이지는 편집 화면에서 열지 않는다(저장하면 몰래 되살아나므로).
  - **되살리기 = 항상 초안으로**. 비교: (가) 보관 전 상태를 기억하는 새 칸(`archived_from` 등) — DB PR·권한 검토가 따로 필요하고, 게시였던 페이지가 확인 없이 링크가 다시 열린다. (나) 칸 없이 초안으로 — DB 변경 없음, 링크는 사용자가 열어서 [게시]를 다시 눌러야만 열림. 공개 범위를 사용자가 눈으로 보고 다시 여는 쪽이 안전해 (나)를 골랐다. 보관 직후 5초 [되돌리기]만 원래 상태(게시면 게시)를 그대로 돌린다(화면이 그 순간 값을 알고 있음).
  - **[삭제]**(목록·보관함 모두, 보관함에서는 [완전히 삭제]): 확인 한 번("페이지·링크·사진이 모두 지워지고 되살릴 수 없어요"), 되돌리기 없음. 서버 `share-page-media`의 `purge_page`가 로그인 토큰 + owner RLS로 소유를 확인하고 → 사진 기록마다 **파일 먼저 → 기록** → 이 페이지 폴더에 기록 없이 남은 파일 → **페이지 행 delete(사용자 토큰)**, 링크·사진 기록은 FK `on delete cascade`. 파일을 못 지우면 페이지·남은 기록을 두고 503 → 다시 누르면 남은 것부터. DB migration 없음(기존 `grant delete`+owner 정책). Edge 변경은 별도 PR #1063(배포 뒤 이 화면 merge).

## ED-표크기끌기 (2026-10-23)

- 표 오른쪽 아래 모서리의 작은 손잡이를 마우스로 끌면 표 전체가 커지거나 작아진다. **저장 방식은 새로 만들지 않았다**: 표 크기 = 칸 폭(`colwidth`)의 합이므로, 끌기는 모든 칸에 같은 배율을 곱해(`ed-schema.mjs` `scaleWidths`) 칸 비율을 유지하고, 놓을 때 한 번 저장한다(되돌리기 한 번). 편집기 문서 속성이라 노트·일기·업데이트에도 그대로 쓴다.
- 한계: 칸 하나 최소 32px, 표는 글 폭을 넘지 않는다(끄는 중에도). Esc로 취소. 끄는 동안 표 테두리가 따라온다.
- 읽는 화면(공유 페이지 공개 읽기·Web1)은 이미 `colwidth` 합과 비율을 그리므로(`ed-render.mjs`) 읽는 쪽·서버(DB check·`share-page-read`) 변경 없음.
- 손가락 끌기는 만들지 않았다(손잡이는 터치 화면에서 숨김). 이유: 칸 폭 끌기(prosemirror-tables `columnResizing`)가 마우스 이벤트(mousedown·mousemove)만 받고 터치 끌기를 처리하지 않으며, 폰에서는 표를 끌면 화면 스크롤·긴 누르기 메뉴와 겹친다. 후보: 폰 [열 넓게][열 좁게] 버튼(사용자 결정 대기).

---

## 11. ED-③ 편집기 하나로 (2026-10-23 설계, 코드 변경 없음)

기준 main `4d08521`(#1055). 이 절은 설계만 한다(앱·DB·Edge 변경 없음). 6절 ③·④의 순서를 아래로 **대체**한다.

- **명진 결정(사실)**: 노트·일기·업데이트와 담당조직·프로젝트 기록의 [크게](옛 큰 쓰기 창)를 모두 새 편집기(`app/ed-editor.js` 계열) 하나로 바꾸고, 옛 큰 창은 지운다. 결정 9 = 나(2026-10-22 16:00, 10-23 17:21 재확인): 노트·일기·업데이트·기록은 **서식까지 저장**, 주간보고·업무일지로 들어갈 때는 **글자만**. 시작 조건 "표 크기 끌기가 끝난 뒤"(10-23 15:48)는 #1054 merge(`404a0bd4`)로 충족.
- **가정**: 편집기의 붙여넣기 버튼 이름은 열린 PR #1062(ED-붙여넣기이름)가 고치는 중이며, 이 설계는 그 이름을 **'서식 없이 붙여넣기'**로 쓴다(지금 main은 '글자만 붙여넣기', `ed-editor.js` 140행).
- 표시: 사실 = 저장소 코드·migration으로 확인, 추정 = 확인 못 한 짐작(운영 DB는 조회하지 않음).

### 11.1 옛 큰 창을 부르는 곳 전수 (사실, grep 근거)

옛 큰 창 = `app/md-editor.js`의 `openMarkdownEditor`(창 id `#mdEditor`, 마크다운 `textarea` + 서식 줄). 직접 부르는 곳 4곳, 그 위에 덧씌운 쓰기 창 `write-window.js`의 `openWriteWindow`를 부르는 곳 6곳 = **화면에서 여는 입구 10곳**이다.

근거 명령: `grep -rn "openMarkdownEditor\|openWriteWindow\|import('./md-editor.js')\|import('./write-window.js')" app --include=*.js --include=*.mjs`(외부 라이브러리 폴더 제외).

**가. 열기 입구 10곳**

| # | 화면·버튼 | 파일·함수(행) | 부르는 것 | 저장 경로(지금) | 저장 표·칸 |
| --- | --- | --- | --- | --- | --- |
| 1 | PC 상단 줄 [+ 추가] → [업데이트]·[노트] | `topbar-actions.js` `openWriter`(214, 부름 221·478) | `openWriteWindow` | 쓰기 창 자체 저장(`update-places.js` `saveUpdate`/`saveUpdateWithFiles`, `basket-data.js` `createNoteDoc`) | `app_notes`(basket·note) 또는 아래 5·6 표 |
| 2 | 홈 빠른 입력 [크게] | `home-quick.js` `bigBtn.onclick`(319, 부름 326), `mountQuick` from `home-read.js` 654 | `openWriteWindow` | `updateVia` → 홈 입력의 `save()`(241) | 같음 |
| 3 | 바구니 업데이트 입력 [크게] | 같은 `home-quick.js`(319·326), `mountQuick({basketOnly})` from `basket.js` 298 | `openWriteWindow` | 같음 | 같음 |
| 4 | 바구니 노트 입력 [크게] | `home-quick.js` 318(`noteOnly` → `onBig`) → `basket-notes.js` `openNew`(255, 부름 259) | `openWriteWindow`(노트 먼저 고름) | `createNoteDoc` | `app_notes`(note) |
| 5 | 업데이트(바구니 메모) 읽기 → 수정 → [큰 창에서 수정] | `basket.js` `openBigWriter`(762, 부름 766; 버튼 `data-basket-big-write`, 924) | `openMarkdownEditor` | `saveEdit` → `updateNote` | `app_notes.raw_text`(basket) |
| 6 | 노트 읽기 → 수정 → [큰 창에서 수정] | `basket-notes.js` `openBigWriter`(309, 부름 318; 버튼 `data-note-big-write`, 602) | `openMarkdownEditor`(`keepOpen`, 마크다운 체크) | `save` → `saveNoteDoc` | `app_notes.title·raw_text·metadata.markdown`(note) |
| 7 | 담당조직 상세 맨 위 입력 [크게] | `workplace-detail.js` `wdOpenBig`(198, 부름 199; 버튼 `#wdInboxBig`, 296) | `openWriteWindow`(이 조직 고름) | `saveOrganizationUpdate`(`quick-save.js` 6) | `app_suborganization_updates.raw_text` |
| 8 | 담당조직 기록 ⋯ → [수정] → ⤢ | `workplace-detail.js` `wdBigField`(164, 부름 169; 버튼 `data-wd-field-big`, 178·191) | `openMarkdownEditor`(저장 없음, 칸에 되돌려 줌) | 칸의 [저장] → `wdUpSave`(181) PATCH | `app_suborganization_updates.raw_text` |
| 9 | 담당조직 기록 중 연결 기록(바구니 업데이트 연결) 요약 수정 → ⤢ | `basket-link-records.js` `mountLinkSummaryEditor`의 `onBig`(128·261) → `workplace-detail.js` 98 → `wdBigField` | `openMarkdownEditor`(8과 같은 함수) | `updateLinkSummary` RPC `app_basket_update_link_summary`(2000자) | `app_record_links.summary` |
| 10 | 프로젝트 상세 기록 입력 [크게] | `project-system-v3.js` `openRecordBig`(639, 부름 645; 버튼 `data-ps3-record-big`, 391·802) | `openWriteWindow`(이 프로젝트 고름) | `saveProjectProgress`(`quick-save.js` 23) | `app_project_progress_updates.summary` |

- 프로젝트 쪽 연결 기록 요약 수정(`project-system-v3.js` 419 `mountLinkSummaryEditor`)은 `onBig`을 넘기지 않아 ⤢가 없다(사실). 프로젝트 기록 ⋯ [수정](`project-system-v3.js` 427)은 한 줄 `input`(500자)이고 ⤢가 없다(사실).
- 일기(`diary.js` 237 `textarea[data-diary-text]`)는 옛 큰 창을 쓰지 않는다(사실). 새 편집기로 바꾸는 대상이지만 "큰 창 호출"은 아니다.

**나. 큰 창이 열려 있는지만 보는 곳(지우기 PR에서 함께 바꿀 곳)**: `#mdEditor:not(.hidden)` 검사 — `home-quick.js` 318·320, `workplace-detail.js` 165·168·198, `project-system-v3.js` 640, `topbar-actions.js` 215. `history.state?.kptuOverlay==='mdEditor'` — `topbar-actions.js` 228. 상태 줄 `#mdEditor .md-editor-status` — `write-window.js` 57, `basket.js` 773, `basket-notes.js` 308.

**다. 큰 창 모듈의 다른 내보내기를 쓰는 곳(큰 창이 아니므로 지우면 안 됨)**: `copyText`(`md-editor.js` 103) — `journal.js` 39, `todo-radar.js` 14, `share-pages.js` 13, `basket.js` 24, `basket-notes.js` 13. → 삭제 PR 전에 `copyText`를 작은 공용 파일(예: `app/copy-text.js`)로 옮긴다.

**라. 큰 창 전용 부품(삭제 대상 후보)**: `md-editor.js`(566줄)·`md-editor.css`·`md-editor-ops.mjs`·`md-toolbar-layout.mjs`, 시험 `tests/md-editor.test.mjs`·`tests/md-toolbar-groups.test.mjs`·`tests/app-e2e/md-editor.spec.mjs`·`md-editor-pc-tabs.spec.mjs`·`helpers/md-tools.mjs`, CI 목록(`.github/workflows/app-smoke-check.yml` 152), `view-loader.js` 23의 `md-editor.css`, `ui-standard.css`의 `.md-editor`·`html.md-editor-open` 규칙(669~717·895~896·1192~1196). `md-editor`·`#mdEditor`를 쓰는 E2E는 27개 파일(`grep -rln "md-editor\|mdEditor\|write-window\|openWriteWindow" tests`) — 단계마다 새 편집기 기준으로 고친다.
- **남기는 것**: `md-telegram.mjs`(`basket.js` 25·`basket-notes.js` 16·`note-preview.mjs` 4가 옛 글 복사에 씀), `markdown-view.js`(옛 글자 행 읽기용: `basket.js`·`basket-notes.js`·`record-sheet.js`·`text-clamp.js`), `note-markdown.mjs`(옛 글 판정·`ed-editor.js` 붙여넣기 판정).

### 11.2 창 껍데기: 새 편집기를 담을 "쓰기 창" 하나

- 지금 새 편집기(`createDocEditor`, `ed-editor.js` 216)는 **글 칸 부품**뿐이고 창 껍데기(머리줄·저장 아이콘·닫기 확인·폰 하단 탭·PC 메뉴 옆 배치·뒤로 가기 기록·내보내기 시트·[업데이트 ▾ | 노트]·노트 제목·폴더·[📎 첨부])는 옛 `md-editor.js`에만 있다(사실).
- 설계 2.3의 방향(껍데기는 옮겨 쓰고 글 칸만 갈아 끼움)대로, **새 파일 `app/ed-window.js` 하나**가 껍데기를 맡는다: `md-editor.js`의 껍데기 코드를 그대로 옮기고 `textarea`·마크다운 서식 줄·미리보기 자리에 `createDocEditor`를 넣는다. 옛 창과 새 창이 한동안 함께 있으므로 창 id는 `#edWindow`, 뒤로 가기 기록 키도 따로 둔다(둘이 동시에 열리지 않게 "열려 있나" 검사는 둘 다 보게 공용 함수 `bigWindowOpen()` 하나로 모은다).
- 계약(여는 쪽이 저장)은 그대로: 여는 쪽은 `{value, text}`(구조 + 꺼낸 글자)를 받아 기존 저장 함수에 넘긴다. `[마크다운]` 체크·[쓰기|미리보기] 전환은 새 창에 두지 않는다(결정 11 가: 서식이 구조로 보이므로 미리보기가 필요 없음).
- `write-window.js`는 `openMarkdownEditor` 대신 새 창을 부르도록 한 곳만 바꾸면 1~4·7·10 입구 6곳이 함께 넘어간다(사실: 6곳 모두 `openWriteWindow`를 거침).

### 11.3 저장 형식

**원칙(3.1 그대로)**: 구조 `{"v":"ed1","doc":{…}}`가 원본, 글자는 저장할 때마다 `ed-text.mjs` `toPlain`으로 꺼낸 사본. 지금 글자를 읽는 곳(검색 RPC·AI·업무일지·주간보고·Drive 요약·연결 요약·미리보기)은 **하나도 바꾸지 않는다** — 이것이 "주간보고·업무일지는 글자만"을 지키는 방법이다.

**DB 변경: 필요하다(판단).** 표 3개에 같은 모양의 칸 하나씩.

| 표 | 새 칸 | 글자 칸(그대로) | 크기 검사 |
| --- | --- | --- | --- |
| `app_notes`(note·basket·diary; work 행은 쓰지 않음) | `doc jsonb null` | `raw_text`(note 10만 자, 나머지 2만 자 — 기존 check 그대로) | `doc is null or (jsonb_typeof(doc)='object' and doc->>'v'='ed1' and jsonb_typeof(doc->'doc'->'content')='array' and octet_length(doc::text) <= 1048576)` |
| `app_suborganization_updates` | `doc jsonb null` | `raw_text` | 같음 |
| `app_project_progress_updates` | `doc jsonb null` | `summary` | 같음 |

- `metadata`에 넣지 않는 이유는 3.3과 같다(여러 저장이 키별 보호 조건으로 쓰는 칸). 조직·프로젝트 두 표는 `metadata` 칸이 있는지도 저장소에서 확인되지 않는다(사실: 두 표의 `create table`은 저장소 migration에 없음, `docs/design/basket-update-merge.md` 69행).
- 권한: 새 정책·grant 없음. 세 표 모두 기존 owner RLS(`task12a_owner_all` 등) 아래 표 단위 권한이라 새 칸도 그 안이다(사실: `app_notes`는 표 단위 grant; 조직·프로젝트 표는 `20260925084844_task12a_sole_owner_db.sql` 116·179행의 정책). **추정**: 운영에서 칸 단위 grant를 쓰고 있지 않은지 precheck에서 확인한다.
- 검색 RPC `app_search_records`의 사전 확인은 칸 **개수**를 센다(`20261022150000` 19·30·36행 `attname in (...)) <> N`). 새 칸 이름이 그 목록에 없으므로 개수에 영향 없다(사실). 함수 자체는 `raw_text`·`summary`를 읽으므로 바꾸지 않는다.
- `app_record_links.summary`(입구 9, 2000자 RPC)는 **서식 저장 대상에서 뺀다**(추천, 결정 E): 연결 요약은 짧은 한 줄 요약이고 RPC·검사를 바꿔야 해서 비용이 크다. 새 창은 열되 "서식 없이" 모드(11.4)로 글자만 돌려준다.
- **migration 하나**(DB PR 맨 앞): 세 표에 칸 + check(`not valid` 없이, 기존 행은 모두 null이라 바로 통과). 짝 파일 5개(snapshot·precheck·postcheck·rollback·summary). rollback = 세 칸 삭제 — 그 전에 `doc`이 있는 행이 있으면 멈춤(서식이 사라지므로), 강제 rollback이어도 `raw_text`·`summary`에 글자가 남아 내용은 유지. 승인형 DB workflow로 적용(확장 규칙 안: 칸·check 추가, 권한 변경 없음 — 받지 않으면 폰 경로 C).

**기존 글자 데이터와의 호환(지우거나 바꾸지 않음, 읽을 때 변환)**

- `doc`이 null인 행 = 옛 글자 원본. 읽기 화면은 지금 방식 그대로(노트 `markdown-view`/쓴 그대로, 조직·프로젝트 기록 `previewLines`·`text-clamp.js`). 화면 코드가 되돌려져도 옛 글은 그대로 읽힌다.
- 새 창으로 열 때만 메모리에서 변환: 노트는 `noteMarkdown`이 켜짐이면 `markdownToDoc`, 꺼짐이면 줄마다 문단. **업데이트·조직·프로젝트 기록·일기는 마크다운 해석 없이 글자 그대로**(이 글들은 마크다운 체크가 없고 사람이 쓴 `1.`·`-`·날짜가 많음).
- **줄바꿈 보존(측정)**: 지금 `plainToDoc`(`ed-markdown.mjs` 109)은 줄마다 문단을 만들어, 열고 바로 저장하면 `toPlain`이 문단 사이에 빈 줄을 넣는다(`"2026.10.21. 교섭\n- 사측 안 제시\n\n다음 주 재교섭"` → 줄 사이에 빈 줄이 하나 더 생김). 업무일지는 `raw_text` 첫 줄, 주간보고·Drive 요약은 글자 전체를 쓰므로, 고치지 않은 글의 글자가 바뀌면 안 된다. → **빈 줄로 나뉜 덩어리를 문단 하나로, 덩어리 안 줄바꿈은 `hard_break`로** 바꾸는 `plainToDocKeep`을 새로 둔다(이 세션에서 같은 규칙으로 만들어 `toPlain` 결과가 원문과 같음을 확인, 측정). 노트 이외 옛 글은 모두 이 함수로 연다.
- **열기만 해서는 DB에 쓰지 않는다.** 저장할 때 `doc` + 새 글자를 한 번에 PATCH. 고치지 않고 [저장]을 누르면 지금처럼 "바뀐 것 없음"으로 끝낸다(글자가 같으면 쓰지 않음).
- 백업(4.1-1): 마크다운 노트는 저장 때 `raw_text`에서 기호가 빠지므로, **노트 화면 PR 전**에 note·basket·diary와 조직·프로젝트 기록의 `id, raw_text|summary, updated_at` 백업 표를 승인형 workflow 백업 단계로 한 번 만든다(비공개, 권한 회수). 업데이트·기록은 `plainToDocKeep` 덕에 글자가 바뀌지 않지만, 같은 백업에 함께 넣는다(비용이 작음).

**글자만 뽑는 지점(주간보고·업무일지로 넘길 때)**

- 뽑는 곳은 **저장하는 순간 한 곳**(새 창 → 여는 쪽 저장 함수가 `toPlain(doc)`을 `raw_text`/`summary`에 넣음)뿐이다. 읽는 쪽은 모두 그 글자를 그대로 읽는다(사실 확인한 소비처):
  - 업무일지: `journal-data.js` 216·225·357(`app_suborganization_updates.raw_text` 첫 줄, `app_project_progress_updates.summary`), 노트는 제목만.
  - 주간보고: `journal-weekly.js`·`weekly-hwpx/`가 `journal-data.js`가 모은 글자를 씀(사실: `summaryLine`, 88).
  - Drive 요약: `supabase/functions/drive-summary/core.mjs` 73·81·276(`raw_text`), `app/drive-summary.js` 12·16.
  - AI: `supabase/functions/ai-assist/handler.ts` 657·686·701·1333·1533·1555(`raw_text`·`summary`).
  - 검색: `app_search_records`(`raw_text`·`summary`).
- 그래서 **Edge·서버 함수 변경 없음**. 서식이 필요한 주간보고(굵게·표를 HWP로)는 이 과제 밖(6절 "그 뒤").
- 글자 길이: 조직 기록 `raw_text`·프로젝트 `summary`의 운영 길이 제한은 저장소에서 확인되지 않는다(추정: 프로젝트 화면 입력은 `maxlength="500"`, `project-system-v3.js` 391·427). 새 창은 저장 전 `toPlain` 길이를 기존 화면 한도(노트 10만·업데이트 2만·프로젝트 기록 500 → 결정 F)로 검사한다.

**글자만 고치는 옛 경로(구조와 어긋남 방지, 3.1)**: 행에 `doc`이 있는데 글자만 바꾸는 경로가 남으면 서식과 글자가 어긋난다. 단계 PR마다 아래를 정리한다 — 그 경로로 고치면 `doc`을 null로 함께 지우거나(서식 버림, 확인 문구), 그 경로도 새 창을 쓰게 한다.

| 경로 | 위치(사실) | 처리 |
| --- | --- | --- |
| 업데이트 수정 칸 `textarea` | `basket.js` `startEdit`·`saveEdit` → `updateNote` | 수정 칸 자체를 새 편집기로(PR 3) |
| 노트 수정 칸 `textarea`·`saveNoteDoc`·`patchKind`·`moveToNote` | `basket-notes.js`·`basket-data.js` 179·195 | 수정 칸을 새 편집기로, `moveToNote`·`moveToBasket`은 `doc`을 그대로 옮김(같은 행) |
| 조직 기록 수정 칸 | `workplace-detail.js` `wdUpEdit`·`wdUpSave`(174·181) | 칸을 새 편집기로(PR 5) |
| 프로젝트 기록 ⋯ [수정] 한 줄 칸 | `project-system-v3.js` 427·`mutateProgressRecord` 431 | `doc`이 있는 기록은 새 창으로 열기(PR 5) |
| 일기 글 칸 | `diary.js` 237·`saveDiaryText`(`diary-data.js` 108) | 새 편집기로(PR 4) |
| `basket-files` Edge 업로드 | `supabase/functions/basket-files/handler.ts` 149~209 | 새 행만 만듦(`doc` null) → 첨부와 함께 저장한 업데이트는 그 뒤 `doc`을 한 번 PATCH(PR 3에서 확인) |
| 홈·바구니 한 줄 입력 [추가] | `home-quick.js` `save` | 한 줄 입력은 그대로 글자만(`doc` null) — 새 글이라 어긋남 없음 |

### 11.4 단계별 PR

모든 PR: merge 전 사용자 승인, `docs/roadmap.md` 수정 없음(본문 "원장 반영"), DB 적용은 정지 지점. 앞 PR merge 뒤 시작(줄 세우기는 AGENTS.md 2절).

| 순서 | PR | 범위 | 시험 | 정지·되돌리기 |
| --- | --- | --- | --- | --- |
| 0 | **ED③-DB** | migration 하나: 세 표 `doc jsonb null` + check, 짝 파일 5개. 같은 PR에 백업 SQL(백업 표 만들기·권한 회수)도 짝 파일로 | migration 정적 시험(`tests/` 기존 migration 검사), precheck가 칸 없음·정책 그대로 확인 | **정지**: 승인형 DB workflow 적용 → postcheck. rollback = 칸 삭제(`doc` 있는 행 있으면 멈춤) |
| 1 | **ED③-창** | `app/ed-window.js`(껍데기, 11.2) + `plainToDocKeep` + `copyText`를 `app/copy-text.js`로 옮김(다른 5곳 import만 바꿈) + `bigWindowOpen()` 공용 검사. **아직 아무 입구도 연결하지 않음**(시험 화면만) | Node: `plainToDocKeep`→`toPlain` 원문 같음(빈 줄·`1.`·`-`·날짜·끝 공백), E2E 고정 화면: 열기·닫기 확인·Ctrl+Enter 저장·폰 하단 탭 누르면 먼저 닫힘·뒤로 가기 한 번에 닫힘·자판 열림 때 서식 줄 위치 | 되돌리기 = revert(화면 영향 없음) |
| 2 | **ED③-노트** | 노트 쓰기·수정·[큰 창에서 수정](입구 4·6, 그리고 1의 [노트])·읽기 화면을 새 창·`ed-render`로. `saveNoteDoc`이 `doc` 함께 저장(기존 보호 조건 그대로). `[마크다운]` 체크 칸 제거(결정 11 가, 값은 지우지 않음). 텔레그램·한글 복사는 `doc`이 있으면 `ed-text`(`toTelegram`·`toHangul`), 없으면 옛 `md-*` | E2E: 옛 마크다운 노트 열기→저장 시 `raw_text` 기호 제거·`doc` 저장, 옛 쓴 그대로 노트 열기→고치지 않고 저장 시 아무것도 안 씀, 표·색 저장 후 다시 열기, 폴더·고정·첨부가 그대로, 다른 탭에서 바뀐 노트 저장 거절 | 백업(0) 적용 확인 뒤 merge. 되돌리기 = revert(`doc` 있는 노트는 옛 화면에서 `raw_text`로 보임) |
| 3 | **ED③-업데이트** | `write-window.js`를 새 창으로(입구 1·2·3과 7·10의 "바구니로 저장" 갈래), 업데이트 수정 칸·[큰 창에서 수정](입구 5)·읽기 화면. `createNote`·`updateNote`·`saveUpdate`·`saveUpdateWithFiles`에 `doc` 인자 | E2E: 홈 [크게]→바구니 저장, 여러 곳 고르기 저장, 첨부와 함께 저장 뒤 `doc`이 붙음, 수정 칸 저장, 홈 한 줄 [추가]는 `doc` null, 업무일지 첫 줄이 꺼낸 글자 | 되돌리기 = revert |
| 4 | **ED③-일기** | 일기 글 칸(결정 10 가: 사진 달력·넘기기는 그대로), `saveDiaryText`에 `doc`. `ai_export_allowed=false` 그대로 | E2E: 일기 열기·저장·사진 코멘트 그대로, 옛 일기 고치지 않고 닫기 | 되돌리기 = revert |
| 5 | **ED③-기록** | 담당조직 기록(입구 7의 이 조직 저장 갈래·8·9)과 프로젝트 기록(입구 10의 이 프로젝트 저장 갈래, ⋯ [수정])을 새 창으로. `saveOrganizationUpdate`·`saveProjectProgress`·`wdUpSave`·`mutateProgressRecord`에 `doc`. 기록 목록은 `doc`이 있으면 `ed-render`(접기 규칙 `text-clamp.js` 그대로), 연결 요약(9)은 서식 없이 모드 | E2E: 조직 [크게]→저장→목록에 서식, 업무일지·주간보고 미리보기는 글자만, 기록 수정 동시 저장 거절, 프로젝트 기록 500자 검사 | 되돌리기 = revert(목록은 글자로 보임) |
| 6 | **ED③-옛창삭제** | 11.1 라 목록 삭제, 나의 검사·키를 새 창 것으로, E2E 27개 파일 정리, CI 목록·`view-loader.js`·`ui-standard.css` 규칙 정리. `md-telegram`·`md-hangul`·`markdown-view`·`note-markdown`·`toolbar-pop`은 남김 | 전체 E2E·`loader-cache-check`·`grep -rn "openMarkdownEditor\|#mdEditor\|md-editor" app tests`가 0건(남기는 파일 제외) | 되돌리기 = revert |

- 3과 5는 같은 `write-window.js`를 지나므로 **3 → 5 순서 고정**(5는 3의 head 위가 아니라 3 merge 뒤 main에서 시작).
- 2~5는 서로 다른 화면이라 사용자가 하나씩 폰에서 확인할 수 있다. 각 PR은 해당 입구만 새 창으로 바꾸고 나머지는 옛 창을 계속 쓴다(두 창 공존 기간).

### 11.5 위험

- **동시 편집·자동 저장 충돌**
  - 지금 큰 창에는 자동 저장이 없다(사실: `md-editor.js`·`ed-editor.js`에 타이머 저장 없음). 새 창에도 **자동 저장을 넣지 않는다**(저장은 저장 아이콘·Ctrl+Enter만). 넣으면 노트 `metadata` 보호 조건과 경합하고 글자만 읽는 곳이 반쯤 쓴 글을 읽는다.
  - 노트는 `saveNoteDoc`이 `updated_at`·폴더·고정·할 일 보호 조건으로 저장하므로 다른 기기에서 바뀌면 거절된다(사실, `basket-data.js` 186). 업데이트 `updateNote`(31)·조직 `wdUpSave`·프로젝트 `mutateProgressRecord`는 `updated_at` 조건이 **없다**(사실) → 두 기기에서 같은 기록을 고치면 나중 저장이 앞 저장을 덮는다(지금도 같음). `doc`과 글자는 한 PATCH라 서로 어긋나지는 않는다. 보호 조건 추가는 범위 밖 제안(결정 G).
  - 저장 중 창이 닫히거나 화면이 바뀌면 여는 쪽 `same()` 검사(지금 코드)가 막는다 — 새 창도 같은 계약.
  - 저장 안 한 글: 옛 창처럼 이 탭 메모리에만(브라우저 저장소 금지), 닫을 때 "저장 안 하고 닫을까요?".
- **모바일(갤럭시 폴드·삼성 인터넷)**
  - 뒤로 가기: 새 창도 `.modal` + `data-kptu-history-all`로 기록 1개(`mobile-modal-history.js`). 새 편집기 안의 작은 상자(글자색·표 칸 메뉴·⌄)는 지금 기록을 쓰지 않는다(사실: `ed-editor.js`·`toolbar-pop.js`에 history 없음) → 상자가 열린 채 뒤로 가기를 누르면 **창 전체가 닫힐 수 있다**. ED③-창 PR에서 "상자가 열려 있으면 뒤로 가기는 상자만 닫음"을 `KPTURouter.layer`로 맞춘다(BUG-뒤로가기 규칙).
  - 하단바 가림: 옛 창은 폰에서 하단 탭 위에서 끝나고 자판이 열리면 공용 자판 상태(`KPTUA11y.keyboard`)를 따른다. 새 편집기의 상자는 `visualViewport`로 화면 안에 놓인다(사실, `ed-editor.js` 1064·1136). 창 껍데기를 옮길 때 서식 줄 상자·표 칸 메뉴가 하단 탭·[저장] 줄에 가리지 않는지 폴드 접힘(약 344px)·펼침(약 673px) 두 폭에서 E2E로 본다.
  - 삼성 인터넷 한글 조합: 실기기 확인 목록(①a)을 노트 PR 뒤 한 번 더(삼성 키보드 + 표 칸, 목록 안 백스페이스).
  - 폴드 펼침 폭(약 673px)은 "폰"(760px 이하) 규칙이라 서식 줄 묶음(ED-서식줄묶음)이 그대로 적용된다(사실).
- **붙여넣기**
  - 기본 붙여넣기는 허용 목록 서식 유지(9.3). 카톡·텔레그램에서 복사한 글은 글자만 들어오므로 그대로. AI 답변 마크다운은 [서식으로 바꾸기] 한 번(결정 3 가).
  - 한글·워드에서 붙인 표·색은 허용 목록으로 걸러지고, 큰 표는 `LIMITS`(칸 20, 글자 20만)에 걸릴 수 있다 — 넘으면 저장 전 안내.
  - '서식 없이 붙여넣기'(#1062 이름)는 클립보드 읽기 허락이 막히면 Ctrl+Shift+V 안내(사실, 938행). 삼성 인터넷은 클립보드 읽기 허락 창이 다르게 뜰 수 있음(추정, 실기기 확인).
  - 사진·파일 붙여넣기: `photos`가 없는 노트·업데이트에서는 넣지 않고 안내(사실). 노트·업데이트 본문 사이 사진(`drive:`)은 이 과제 밖(결정 10 가와 같은 이유), 첨부는 지금처럼 [📎 첨부].
- **두 형식 공존**: 2~5 사이 화면마다 새/옛이 섞인다. 읽기는 `doc` 유무로 갈라 그리므로 깨지지 않는다. 옛 창으로 `doc` 있는 행을 고치는 경로가 남지 않게 11.3 표를 PR마다 확인.
- **글자 변화**: 마크다운 노트만 저장 때 `raw_text`가 바뀐다(백업으로 대비). 업데이트·기록·일기는 `plainToDocKeep`으로 고치지 않은 줄은 그대로.
- **불러오는 크기**: 새 창은 열 때 편집기 묶음(약 80KB gzip)을 받는다. 홈 [크게]를 처음 누를 때 약간 늦을 수 있음(추정) → 홈 진입 뒤 쉬는 시간에 미리 받기는 범위 밖 제안.

### 11.6 명진에게 물을 결정

굵은 것이 추천이다. "전부 추천대로"라고 답해도 된다.

- **A. 옛 큰 창이 사라지는 순서** — **가. 노트 → 업데이트 → 일기 → 조직·프로젝트 기록 순으로 하나씩 바꾸고, 다 바뀐 뒤 옛 창을 지움(추천: 화면마다 폰에서 확인 가능)** · 나. 한 번에 전부 바꿈(확인할 것이 한꺼번에 몰림).
- **B. 마크다운으로 쓴 옛 노트를 새 창에서 저장하면 기호(`##`, `**`)는 서식으로 바뀌고 글자 사본에서는 기호가 빠짐** — **가. 그렇게 함 + 바꾸기 전 전체를 한 번 따로 보관(추천)** · 나. 옛 노트는 손대지 않고 새 노트만 새 창.
- **C. 미리보기 버튼** — **가. 없앰(추천: 새 창은 쓰는 화면이 곧 보이는 모양)** · 나. 남김.
- **D. 고치지 않은 옛 글을 열었다 닫을 때** — **가. 아무것도 저장하지 않음(추천)** · 나. 열 때 새 형식으로 바로 바꿔 저장.
- **E. 연결된 업데이트의 "요약"(담당조직 기록 안 연결 기록의 짧은 요약)** — **가. 새 창으로 열되 서식 없이 글자만 저장(추천: 한 줄 요약이고, 서식까지 하려면 서버 함수도 바꿔야 함)** · 나. 요약도 서식 저장.
- **F. 프로젝트 기록 길이** — 지금 프로젝트 기록 입력은 500자까지다. **가. 새 창에서도 500자(추천: 업무일지·주간보고 한 줄 모양 유지)** · 나. 업데이트처럼 2만 자로 늘림.
- **G. 두 기기에서 같은 기록을 동시에 고칠 때** — 지금 업데이트·조직·프로젝트 기록은 나중 저장이 앞 저장을 덮는다(노트만 막음). **가. 이번에는 그대로 두고 별도 작업으로 올림(추천: 범위가 커짐)** · 나. 이번에 함께 막음.
- **열린 결정(다른 세션에서 답 대기, 여기서는 정하지 않음)**: 큰 쓰기 창 [📎 첨부]를 서식 줄 아이콘 규칙에 맞출지. 새 창 껍데기(11.2)는 그 답을 따르도록 [📎 첨부] 자리만 비워 두고, 답이 나오면 ED③-창 또는 ED③-노트 PR에 반영한다.
- 이미 대기 중인 관련 결정(이 설계는 결과에 영향받지 않음): ED-폰표칸버튼, 편집기 ⌄ 펼침 기억(SET #1052).

### 11.7 범위 밖 발견(고치지 않음)

- 업데이트 `updateNote`·조직 기록 `wdUpSave`·프로젝트 기록 `mutateProgressRecord`에 `updated_at` 보호 조건이 없어 두 기기 동시 수정 때 나중 저장이 덮는다(11.5, 결정 G).
- `app_suborganization_updates`·`app_project_progress_updates`의 표 정의·길이 check가 저장소 migration에 없다(운영에만 있음, 추정). ED③-DB precheck에서 칸 목록·제약을 읽어 snapshot에 남길 것.
- `ed-markdown.mjs` `plainToDoc`은 줄마다 문단이라 `toPlain`과 왕복하면 빈 줄이 늘어난다(측정). 지금은 쓰는 화면이 없어(시험만) 영향 없음 — ED③-창에서 `plainToDocKeep`을 추가하고 `plainToDoc`의 쓰임은 시험만 남는지 확인.
