# 노트·업무일지·일기 설계 (JOURNAL-일지 · MEMO-노트)

📱 폰 경로 C(DB 적용 단계) — 이 문서는 설계·조사만 한다. 앱 코드·DB·Edge·권한 변경 없음. SQL은 초안 파일만 있고 적용하지 않았다.

- 작성: 2026-10-16, Claude Code 웹. 기준 main `a96161e`.
- 원장 행: `docs/roadmap.md`의 JOURNAL-일지 · MEMO-노트.
- SQL 초안: [`sql/20261020090000_journal_memo_notes_kind.sql`](sql/20261020090000_journal_memo_notes_kind.sql), 짝 되돌리기 [`.rollback.sql`](sql/20261020090000_journal_memo_notes_kind.rollback.sql), 읽기 전용 확인 [`.check.sql`](sql/20261020090000_journal_memo_notes_kind.check.sql).

## 0. 요구사항 정리 (원장 기준)

| 구분 | 요구 | 출처 |
| --- | --- | --- |
| 노트(파랑) | 오래 두고 고쳐 쓰는 문서. 제목·본문, 조직·프로젝트 연결, 검색·정렬, 바구니 메모를 노트로 옮기기. 텔레그램·한글·HWP 내보내기(MD-내보내기) | MEMO-노트 행, 2026-10-15 결정 |
| 업무일지(초록) | **별도 저장 없이 날짜로 보는 화면**. 그날의 바구니 메모·일정·끝낸 할 일·수정한 노트가 자동으로 모이고 **"오늘 한 줄 정리"만 저장**. [주간보고 초안]으로 연결 | JOURNAL-일지 행, 2026-10-15 결정 |
| 일기(보라) | 개인 기록, 업무와 분리. 날짜 숫자 줄 + 기록 있는 날 점 표시 + 한 달 달력 펼치기. **그날 사진 여러 장 업로드 필수**, **기본은 달력 보기**, **날짜를 누르면 아래에 주요 내용과 사진을 크게** | JOURNAL-일지 행, 2026-10-15·10-16 |
| 공통 | 공유·공개·원장 직접 쓰기 없음. sole-owner. 마크다운 표시는 MD-표시 모듈 재사용 | AGENTS.md §5, MEMO-노트 행 |

## 1. 지금 있는 구조 (코드 조사 결과)

### 1.1 표

| 표 | 지금 쓰임 | 열(요약) | 권한 |
| --- | --- | --- | --- |
| `app_notes` | 바구니 메모 | `id, workspace_id, raw_text(≤2만 자), occurred_at, created_at, updated_at, attachments jsonb(≤20개), archived_at, ai_export_allowed, metadata jsonb`. 종류(kind)·제목 열 **없음** | RLS on, 정책 `notes_owner_all`(authenticated 전용, `private.app_is_workspace_owner(workspace_id)`), anon 권한 없음. 트리거 없음 |
| `app_record_links` | 메모·할 일 → 프로젝트·조직·회의·자료 꼬리표 | `note_id`가 `app_notes`를 가리킴(삭제 시 같이 삭제) | owner 정책 + 같은 workspace 검사 |
| `app_pages` | Web1 공개 페이지 원본(옛 구조). `space_id, slug, title, summary, body, content_format, visibility, status, owner_id, published_at` | 생성문이 저장소에 없음(마이그레이션 폴더 이전). `visibility`는 Web2에서 `private`만 허용하는 트리거 | owner 정책 |
| `app_documents` | 자료실 | Drive 파일 1개 = 1행 | owner 정책 |
| `app_drive_settings` | Drive 폴더 id 보관 | `basket_folder_id` 등 | owner 정책 |

출처: `supabase/migrations/20260927103344_task_impl2_notes_record_links.sql`, `20261010120000_basket1_notes_links.sql`, `20261013034836_basket_photo_ocr_db.sql`, `20260925084844_task12a_sole_owner_db.sql`, `20260925143746_task13_web2_private_boundary.sql`.

### 1.2 첨부(사진) 저장 흐름

1. 화면(`app/basket-upload.js`)이 파일을 **한 장씩** Edge 함수 `basket-files`로 보낸다(POST multipart, 로그인 토큰).
2. `basket-files`(verify_jwt=false, 코드에서 `getUser` + workspace owner 확인)가 Drive의 **"Web2 바구니"** 폴더에 올린다. 폴더 id는 `app_drive_settings.basket_folder_id`, 매번 "내 소유·휴지통 아님·소유자 1명" 확인.
3. 올린 파일의 `{drive_file_id, file_name, mime_type, size_bytes}`를 `app_notes.attachments`에 붙인다. `note_id`를 주면 **기존 행에 이어 붙인다**(행 종류는 보지 않음, `updated_at`·`attachments` 비교 후 저장). DB가 거절하면 방금 올린 Drive 파일을 지운다.
4. 제한: 파일당 100 MiB, 행당 20개, 이미지 전용 제한은 없음.
5. 보기: 지금은 **사진을 화면에 직접 보여 주지 않는다**. "Drive에서 열기" 링크(`drive.google.com/file/d/<id>/view`)뿐이다. 사진을 크게 보여 주려면 새 서버 동작이 필요하다(§4.3).
6. 삭제: `basket-files?action=note-delete`가 Drive 파일을 휴지통으로 옮긴 뒤 행을 지운다.

### 1.3 화면에서 재사용할 것

- 마크다운 표시: `app/markdown-view.js`(`renderMarkdownInto`), 머리말에 "일지·노트 재사용" 명시. 기준 `docs/markdown-view.md`.
- 달력: `app/calendar-month-view.js`는 일정 화면 `#calendarGrid`에 묶여 있어 그대로 쓰기 어렵다. 날짜 계산(`visibleRange`)과 서울 시간 도우미(`app/meeting-time.js`의 `seoulDateKey` 등)만 재사용하고, 점 표시가 있는 작은 달력은 일지 전용으로 만든다. 기존 CSS에 점 표시는 없다.
- 업무일지에 모일 재료: 바구니(`app/basket-data.js` `readBasket`), 일정(Edge `google-calendar`), 끝낸 할 일(Edge `google-tasks`), 수정한 노트(`app_notes`의 `updated_at`).

### 1.4 `app_notes`를 읽는 곳 (종류 열을 더하면 영향받는 곳)

| 위치 | 읽는 방식 | 종류 필터 필요 |
| --- | --- | --- |
| `app/basket-data.js:42` `readBasket` | workspace 전체 목록 | **필요**(`kind=eq.basket`) |
| `app/basket-note-tasks.js:71` | `metadata.tasks`가 있는 행 목록 | 필요 |
| `app/basket-link-records.js:32` | 꼬리표에서 메모로 inner join | 필요(노트 꼬리표를 따로 볼지 결정) |
| `supabase/functions/drive-summary/basket-read.mjs` | 바구니 읽기용 사본 | 필요(Edge 배포 필요 — 아래 3단계 이후) |
| `app/basket-classification.js:127`, `basket-record-delete.js`, `basket-write-request.js` | id 하나로 읽기 | 불필요 |
| `basket-files`, `document-actions`, `_shared/hwp-edit.ts`, `_shared/basket-file-origin.ts` | id·첨부 기준 | 불필요(첨부 재사용에 오히려 유리) |

## 2. 저장 위치 비교

### 안 A — `app_notes` 한 표에 "종류" 열을 더한다 (추천)

- 열 3개 추가: `kind`(basket·note·work·diary, 기존 행은 전부 basket), `title`(노트만), `journal_day`(업무일지·일기만).
- 하루 한 행: `(workspace_id, kind, journal_day)` 고유 색인.
- 업무일지 행 = "오늘 한 줄"(1~300자, 한 줄, 첨부 없음). 그날 모이는 재료는 저장하지 않고 화면이 날짜로 모아 보여 준다.
- 일기 행 = 본문(≤2만 자) + 사진(`attachments`). **일기는 DB가 AI 내보내기를 늘 끔**(`ai_export_allowed=false` 강제).
- 노트 행 = 제목(필수) + 본문(≤10만 자).
- 좋은 점
  - 정책·권한을 **새로 만들지 않는다**. 기존 owner 정책 하나가 그대로 지킨다.
  - **사진 올리기를 그대로 재사용**: `basket-files`에 `note_id`(일기 행 id)를 주면 지금 코드 그대로 붙는다. 업로드용 Edge 변경이 없다.
  - 바구니 → 노트 옮기기가 "종류를 note로 바꾸고 제목을 넣기" 한 번이다. 꼬리표·첨부·삭제 흐름이 따라온다.
  - 꼬리표(`app_record_links`)로 노트를 프로젝트·조직에 연결하는 길이 이미 있다.
- 나쁜 점
  - 바구니 목록 등 4곳이 종류 필터를 빠뜨리면 노트·일기가 바구니에 섞여 보인다(권한 문제는 아니고 화면 문제). → 1단계에서 필터 추가와 **"필터 누락 검사" 테스트**를 같이 넣는다. 일기는 DB가 AI 내보내기를 막아 두므로 섞여도 AI 복사로 새지 않는다.
  - 사진 한도가 행당 20장(기존 검사 조건). 하루 일기 사진 20장이면 충분하다고 보고 그대로 둔다.

### 안 B — 노트는 `app_notes`, 일지·일기는 새 표 `app_journal_days`

- 좋은 점: 날짜 중심 자료가 따로 있어 구조가 직관적이다.
- 나쁜 점: 새 표·새 정책·새 권한이 생긴다. 사진 올리기가 `app_notes`에만 붙으므로 **`basket-files`를 고치거나 새 Edge 함수가 필요**하다(§6 정지 지점 추가). "같은 목적의 표를 새로 만들지 않는다"(AGENTS.md §4)와도 부딪힌다.

### 안 C — 노트를 `app_pages`에 넣는다

- 좋은 점: `title`·`body`가 이미 있다.
- 나쁜 점: `app_pages`는 Web1 공개 페이지 원본이 남아 있는 표이고 `slug`·`published_at`·`visibility` 같은 공개 구조가 붙어 있다. Web2 공개 경로를 되살리지 않는다는 규칙(AGENTS.md §5)과 섞이기 쉽고, 생성문이 저장소에 없어 제약을 먼저 production에서 확인해야 한다. 첨부 재사용도 안 된다.

### 추천: 안 A

권한 경계를 넓히지 않고, 새 정책·새 함수·새 Edge 없이 DB 변경 1건으로 세 화면을 모두 받칠 수 있다. 위험(필터 누락)은 화면 쪽 테스트로 막을 수 있는 종류다.

## 3. 추천안 DB 초안 요약

파일: `docs/design/sql/20261020090000_journal_memo_notes_kind.sql` (version은 적용 때 새로 정함)

| 항목 | 내용 |
| --- | --- |
| 바뀌는 것 | `app_notes`에 `kind`(기본 basket)·`title`·`journal_day` 열, 검사 조건 5개, 본문 길이 조건 교체, 색인 2개 |
| 안 바뀌는 것 | RLS 정책(`notes_owner_all`) · 표 권한 · 함수 · Edge · 기존 바구니 행 내용 |
| 함수 | **새 함수 없음**. 저장은 기존처럼 PostgREST(owner 정책). 그래서 SECURITY INVOKER·search_path 고정 대상 함수가 없다. 나중에 함수가 필요하면 기존 `app_basket_*`처럼 `security invoker set search_path = ''` + authenticated 전용 실행권한(사전 revoke)으로 만든다 |
| 안전장치 | 적용 전 확인(선행 migration 기록, 열 없음, RLS on, 정책 1개, 트리거 0, anon 권한 없음, 기존 행이 옛 규칙에 맞음) → 다르면 멈춤. 적용 끝에 사후 확인(RLS·정책·anon·basket 외 행 0) → 다르면 전체 취소 |
| 기록 행 | `commit;` 직전 `insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261020090000', 'journal_memo_notes_kind', …)` |
| 되돌리기 | `.rollback.sql`: 노트·업무일지·일기 행이 하나라도 있으면 멈춤(데이터를 지워서 통과시키지 않음) → 색인·조건·열 삭제 → 바구니 본문 규칙 원문 복원 → 기록 행 삭제 |
| 확인 SQL | `.check.sql`: select만. 적용 전·후 상태, 종류별 행 수 |

로컬 검증(이 PR, PostgreSQL 16 임시 DB, production 아님): 같은 모양의 `app_notes`를 만들고 적용 → 허용 3건 저장, 거절 7건(제목 없는 노트·같은 날 두 번째 업무일지·여러 줄 업무일지·AI 내보내기 켠 일기·날짜 없는 일기·제목 있는 바구니·빈 바구니) 거절 → 되돌리기는 새 종류 행이 있을 때 멈추고, 지운 뒤에는 원래 조건으로 복원 → 다시 적용 성공. 임시 DB에는 사진 검사 조건이 없어 확인 SQL 3번 조건 수가 6으로 나왔다(production 기대값 7).

일상어 3줄(적용 단계에서 다시 제시):
- 무엇이 바뀌나: 바구니 메모 표에 "종류·제목·날짜" 칸이 생겨 같은 표에 노트·업무일지 한 줄·일기를 담을 수 있게 된다. 지금 바구니 메모는 그대로다.
- 잘못되면: 적용 SQL이 멈추면 아무것도 안 바뀐다. 적용 뒤 화면이 종류를 안 가리면 노트가 바구니 목록에 섞여 보일 수 있다(남에게 보이지는 않음).
- 되돌리는 법: 새 종류 글을 아직 안 썼다면 짝 되돌리기 SQL 한 번으로 원래대로. 이미 썼다면 먼저 내용을 보관한 뒤 되돌린다.

## 4. 화면 단계 나누기

### 0단계 — DB 적용 (폰 경로 C)

- 순서: 커맨드센터 승인 → 사용자가 `.check.sql` 1번 실행·캡처 → 적용 SQL(main 파일 원문) 실행 → `.check.sql` 2·3번 캡처 → 커맨드센터 판정.
- 적용 SQL은 약 100줄이라 폰 붙여넣기 한 번에 들어간다(조각 나누기 불필요). 첫 줄 `begin;`·끝 줄 `commit;`·대상 프로젝트 확인.
- DB 적용 전에는 1단계 화면 PR을 merge하지 않는다(Expand → Deploy 순서, `docs/web2-expand-deploy-verify-contract.md`). 단, **바구니 종류 필터는 열이 생긴 뒤에야 쓸 수 있으므로** 필터 PR은 DB 적용 직후 바로 merge한다(그 전까지 새 종류 행을 만드는 화면은 없으므로 섞임 없음).

### 1단계 — 노트 (MEMO-노트)

- 바구니 쪽: §1.4의 "필요" 3곳(화면)에 `kind=eq.basket`. drive-summary는 Edge라 별도(아래 위험 참고).
- 노트 탭: 목록(제목·고친 날, 검색·정렬) → 읽기(MD-표시) → 고치기(본문 텍스트). 프로젝트·조직 연결은 기존 꼬리표 재사용.
- 바구니 메모 → [노트로 옮기기]: `kind='note'`, `title` 입력(첫 줄 제안). 되돌리기 버튼 없이 노트에서 [바구니로 돌리기]로 대칭.
- 검사
  - 단위: 바구니 읽기 경로마다 `kind=eq.basket`이 붙는지 고정(필터 누락 검사).
  - 브라우저 E2E: 노트 만들기·고치기·검색, 바구니→노트 옮기기 후 바구니 목록에서 사라짐, 모바일·데스크톱 폭.
  - 권한: 로그아웃 상태 REST 호출 거절(기존 보안 테스트 패턴), anon 권한 0 확인 SQL.

### 2단계 — 업무일지

- 화면: 날짜 숫자 줄(이번 주) + [달력 펼치기]. 날짜를 누르면 그날 바구니 메모·일정·끝낸 할 일·고친 노트를 모아 보여 주고 맨 위에 "오늘 한 줄" 입력칸 하나.
- 저장: `kind='work'`, `journal_day`, `raw_text`=한 줄. 같은 날 다시 쓰면 고친다(PostgREST upsert, `on_conflict=workspace_id,kind,journal_day`).
- 점 표시: 한 줄이 있는 날 또는 재료가 있는 날(결정 필요 J4).
- [주간보고 초안]: 이번 주 한 줄 7개 + 재료 목록을 WEEKLY-자동화로 넘긴다(이 단계는 링크·복사까지만).
- 검사: 날짜 경계(서울 0시) 단위 테스트, 같은 날 두 번 저장 시 1행 유지, 여러 줄 입력 거절 메시지, E2E 날짜 넘기기.

### 3단계 — 일기

- 화면 기본 = 한 달 달력. 기록 있는 날 보라 점. 날짜를 누르면 달력 아래에 그날 사진을 크게(가로로 넘기기) + 주요 내용.
- 쓰기: 그날 일기 행을 먼저 만든 뒤(`ai_export_allowed=false` 꼭 보냄 — 안 보내면 DB가 거절), 사진을 한 장씩 `basket-files`에 `note_id`로 올린다(기존 코드 그대로).
- **사진 보기는 새 서버 동작이 필요**: Drive 파일은 로그인 없이 볼 수 없고, 화면에 있는 건 Drive 링크뿐이다. 추천은 `basket-files`에 owner 전용 "사진 보기" 동작 추가(서버가 Drive에서 작은 크기 사진을 받아 그대로 돌려줌). 이것은 Edge 배포라 §6 정지 지점이다. 그 전까지 3단계 1부는 "Drive에서 열기" 링크로 출시 가능.
- 사진 줄이기: 폰 사진(3~8 MB) 그대로면 하루 10장에 50 MB 이상 올라간다. 올리기 전에 화면에서 긴 변 2048px JPEG로 줄이는 것을 추천(결정 필요 J3).
- 검사: 사진 여러 장 순서대로 올리기·중간 실패 시 이미 올린 사진 유지, 21장째 거절 메시지, 달력 점 표시, 날짜 누름→크게 보기, 일기가 바구니·AI 복사에 안 나오는지(DB 조건 + 화면 필터 둘 다).

### 단계 공통

- 캐시 버전 사슬(`AGENTS.md` §4): 새 모듈은 `view-loader.js` → `loader-v2.js` → `app.js` → `index.html` 순서로 `?v=`를 올리고 `tests/app-e2e/` 기대값을 같은 PR에서 맞춘다.
- UI-디자인기준 공통 색: 바구니 주황, 노트 파랑, 업무일지 초록, 일기 보라.

## 5. 위험과 막는 법

| 위험 | 막는 법 |
| --- | --- |
| 바구니 목록·AI 복사에 노트·일기가 섞임 | 화면 필터 + 필터 누락 테스트. 일기는 DB가 AI 내보내기 금지 |
| drive-summary(바구니 읽기용 사본)에 노트·일기가 섞임 | Edge `drive-summary`의 `basket-read.mjs`에 종류 필터 필요 → Edge 배포(§6 정지 지점). 이 배포를 1단계 노트 출시 조건으로 둔다(노트가 생기기 전에 필터 적용) |
| 사진 보기용 서버 동작이 owner 확인 없이 열림 | 기존 `basket-files` 인증(토큰 → owner)을 그대로 거치고, 요청한 사진이 그 workspace 행의 `attachments`에 있을 때만 응답 |
| 일기 사진이 바구니 폴더에 섞임 | 같은 "Web2 바구니" 폴더를 쓰는 것이 기본(업로드 코드 변경 0). 분리하려면 Edge 변경 필요(결정 J2) |

## 6. 결정 필요 (일상어)

- **J1. 노트·일지·일기를 어디에 저장할까**
  - ① 바구니 메모 표 하나에 "종류" 칸을 더해 같이 저장 — **추천**. 이유: 권한을 새로 만들지 않고, 사진 올리기를 그대로 쓰고, 바구니→노트 옮기기가 쉽다.
  - ② 노트만 바구니 표, 일지·일기는 새 표. 이유: 구조는 깔끔하지만 사진 올리는 서버 기능을 새로 만들어야 한다.
  - ③ 옛 공개 페이지 표에 노트 저장. 이유: 공개용 구조가 남아 있어 섞이기 쉬워 비추천.
- **J2. 일기 사진을 Drive 어느 폴더에 둘까**
  - ① 지금 바구니 폴더("Web2 바구니")에 같이 — **추천**. 이유: 서버 수정 없이 바로 된다. 앱 안에서는 일기로 나뉘어 보인다.
  - ② "Web2 일기" 폴더를 따로. 이유: Drive에서 직접 볼 때 깔끔하지만 서버 배포가 한 번 더 필요하다.
- **J3. 일기 사진을 원본 그대로 올릴까**
  - ① 올리기 전에 폰에서 줄여서(긴 변 2048px) — **추천**. 이유: 올리기가 빠르고 Drive 용량을 덜 쓴다. 다시 보기에 충분한 화질.
  - ② 원본 그대로. 이유: 화질은 그대로지만 하루 수십 MB를 올리게 된다.
- **J4. 업무일지 달력에 점을 어떤 날 찍을까**
  - ① "오늘 한 줄"을 쓴 날만 — **추천**. 이유: 한 줄 쓰기 습관이 눈에 보인다.
  - ② 바구니·일정 등 재료가 있는 날 모두. 이유: 거의 매일 점이 찍혀 구분이 안 된다.
- **J5. 일기에 글 없이 사진만 저장해도 될까**
  - ① 사진만 / 글만 / 둘 다 모두 허용 — **추천**. 이유: 바쁜 날에도 사진 몇 장만으로 남길 수 있다. 화면은 사진 올리기를 맨 앞에 둔다.
  - ② 사진 1장 이상이 꼭 있어야 저장. 이유: "사진 필수"를 엄격히 지키지만 사진 없는 날은 기록을 못 남긴다.
- **J6. 노트 글 길이 상한**
  - ① 10만 자 — **추천**. 이유: 긴 문서도 담고, 바구니(2만 자)보다 넉넉하다.
  - ② 바구니와 같은 2만 자. 이유: 단순하지만 긴 회의 정리가 잘릴 수 있다.

## 7. 정지 지점 (AGENTS.md §6)

1. 0단계 DB 적용 — 폰 경로 C 또는 사용자 승인형 DB workflow.
2. 3단계 사진 보기 동작 — `basket-files` Edge 배포(기존 함수, verify_jwt=false 유지, `docs/web2-env6b-edge-source.md` 5절 표 변경 없음).
3. drive-summary 종류 필터 — `drive-summary` Edge 배포.

AI는 어느 것도 실행·승인하지 않는다.
