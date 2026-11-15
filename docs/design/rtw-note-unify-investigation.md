# 읽생기 글 → Web2 노트 일원화 조사 (RTW-노트일원화 ①)

📱 폰 가능 — 이 문서는 조사·설계만 한다. 코드·DB·Edge·Cloudflare·비밀값·운영 데이터 변경 없음. 운영 DB는 조회하지 않았고, 수치가 필요한 곳은 7.2절 "명진이 확인할 조회 SQL"로 남겼다.

## 명진용 요약

1. 읽생기 글(읽기 글·메모·질문·글쓰기 기록)은 사진·파일이 없는 글자뿐이라, Web2 노트 하나하나로 옮길 수 있다. 저자·출처·주소·발표일, 글에 붙인 메모·책갈피 문장, 주제·질문 이름은 노트 본문 위아래에 글자로 붙인다.
2. 잃는 것은 "주제·질문끼리 서로 이어 보기", "메모 유형으로 거르기", "책갈피 문장 위치로 바로 가기", "발표일 달력(아카이브)", "AI 읽기" 같은 읽생기만의 화면 기능이다. 글 자체는 잃지 않는다.
3. ChatGPT "읽생기 글 추가"는 지금 읽생기 전용 열쇠 하나로 명진 계정에 바로 쓴다. Web2에는 이런 문을 새로 만들지 않고, 당장은 ChatGPT 답을 [쓰기]→[노트]에 붙여 넣는 방식(새 개발 없음)을 추천한다. 나중에 귀찮으면 바구니 수집 통로(텔레그램·녹음 수집)와 같은 문 하나로 합친다.
4. 옮기기(④)는 백업 → ChatGPT 연결 끊기 → 한 번에 옮기는 SQL 1회(먼저 "해 보기만" 실행) → 확인 순서로, 되돌리기는 "옮겨 온 노트만 지우기" 한 번이다. 읽생기 쪽 글은 지인 시험이 끝날 때까지 그대로 둔다.
5. 명진이 정할 것은 7.1절 12가지이며 모두 추천안이 있다. 정하기 전에 7.2절 조회 SQL로 글 개수를 먼저 보면 결정이 쉬워진다.

- 작성: 2026-10-18, Claude Code 웹. 기준 work main `321f8bb`(#682). 읽생기는 `mj880616/read-think-write` 읽기 전용 사본(로컬 clone) 기준.
- 원장 행: RTW-노트일원화(커맨드센터가 원장에 추가할 행). 이 PR은 `docs/roadmap.md`를 고치지 않는다.
- 근거 파일(읽생기): `src/api.js`, `src/main.js`, `src/records-ui.js`, `supabase/migrations/*.sql`(8개), `supabase/functions/*/index.ts`, `supabase/functions/rtw-delete-account/account-deletion.js`, `docs/chatgpt/gpt-setup.md`, `docs/chatgpt/rtw-personal-write.openapi.yaml`, `cloudflare/*`, `.github/workflows/*`.
- 근거 파일(Web2): `app/basket-data.js`, `app/basket-notes.js`, `supabase/migrations/20260927103344_task_impl2_notes_record_links.sql`, `20261010120000_basket1_notes_links.sql`, `20261017052234_journal_memo_notes_kind.sql`, `supabase/functions/drive-summary/core.mjs`, `docs/design/journal-memo-diary-design.md`, `docs/migration-history.md`, `docs/web2-env6b-edge-source.md`.

### 이 조사의 한계 (사실/추정 구분)

- `rtw_resources`·`rtw_notes`·`rtw_topics`·`rtw_questions`·`rtw_relations`·`rtw_bookmarks`·`rtw_note_types`·`rtw_ai_usage`·`rtw_personal_mode`의 **표 생성 SQL은 두 저장소 어디에도 없다**(production 기록에만 있는 `rtw_phase1_foundation` 등 22건, `docs/migration-history.md`). 아래 열 목록은 읽생기 코드가 읽고 쓰는 열에서 거꾸로 맞춘 **추정**이다. ④ 착수 전에 7.2절 SQL 1번으로 실제 열을 확인한다.
- 함수 `rtw_is_personal_owner()`의 본문도 저장소에 없다(production 기록 `add_rtw_personal_owner_check`). 이름과 쓰임만 확인했다.
- 운영에 배포된 `rtw-personal-write`(v2, 2026-09-18, `docs/web2-env6b-edge-source.md` 5절)가 읽생기 저장소의 보강판(입력 검사표 포함)과 같은지 확인하지 않았다(원장 RTW-3 대기).

## 1. 읽생기 기능 목록과 행선지

표시: **[노트로 옮김]** = 글(데이터)을 Web2 노트로 옮긴다. **[버림]** = 그 화면 기능은 Web2로 가져오지 않는다(데이터는 노트 글자로 남을 수 있음). **[읽생기에 남김]** = 지인 시험 동안 읽생기에 그대로 둔다. "겹침"은 Web2 노트(`app/basket-notes.js`)·공용 표시 모듈에 이미 있는 기능이다.

| # | 화면·기능 (주소) | 한 줄 설명 | 행선지 | 이유 | Web2와 겹침 |
| --- | --- | --- | --- | --- | --- |
| 1 | 로그인 | Google 로그인, 30일 기억 | 버림 | Web2는 자체 로그인 | 겹침(Web2 로그인) |
| 2 | 베타 초대 확인·거절 화면 | 초대된 이메일만 입장(`rtw-beta-status`) | 읽생기에 남김 | 지인 시험 입장 문 | 없음(Web2는 본인만) |
| 3 | 베타 관리 (`/beta/`) | 관리자가 이메일 초대·해제 | 읽생기에 남김 | 지인 초대 관리 | 없음 |
| 4 | 홈 (`/`) | 최근 추가 글, 이어가는 질문, AI 사용량, 빠른 추가 | 버림 | Web2 홈이 있음 | 부분 겹침 |
| 5 | 읽기 목록·새 글 (`/read/`) | 읽기 글(제목·원문 제목·저자·출처·발표일·주소·본문) 목록과 추가 | 노트로 옮김 | 명진 글의 중심 | 겹침: 노트 목록·[+] 새 노트·검색 |
| 6 | URL 가져오기 (`rtw-url-import`) | 주소만 넣으면 서버가 본문·저자·날짜를 뽑아 채움 | 버림 | Web2에 같은 기능 없음. 필요하면 별도 후보(7.1 D8) | 없음 |
| 7 | 글 상세 (`/read/<id>/`) | 마크다운·Mermaid 본문, 원문 링크, 수정·삭제 | 노트로 옮김 | 노트 읽기 화면으로 대체 | 겹침: MD-표시·Mermaid·[고치기]·삭제 |
| 8 | AI 읽기·생각 확장 (`rtw-ai-read`) | OpenAI로 글 요약·질문·연결 제안, 하루 3회 | 버림 | Web2 AI는 BASKET-AI자동정리에서 따로 설계 | 없음 |
| 9 | 책갈피 (`/bookmarks/`, 글·문장) | 글 통째 또는 문장(위치 포함) 표시, 짧은 메모 | 노트로 옮김(문장·메모만 글자로) / 기능은 버림 | 문장 위치로 바로 가기는 노트에 없음 | 없음 |
| 10 | 메모 (`/notes/`) | 독립 메모·글에 붙은 메모, 유형(생각 등) 고르기 | 노트로 옮김 | 독립 메모는 노트 1개씩, 글에 붙은 메모는 그 글 노트 안에 | 겹침: 노트 |
| 11 | 메모 유형 관리 | 유형 추가·이름 바꾸기·지우기(`rtw_rename_note_type` 등) | 버림 | Web2 노트에 태그·유형 없음. 유형 이름은 글자로 남김 | 없음 |
| 12 | 주제 (`/topics/`) | 주제 만들고 글·메모를 이어 모아 봄 | 버림(이름만 글자로) | Web2 연결 대상은 프로젝트·담당조직·회의·자료 | 부분 겹침: [연결하기] |
| 13 | 질문 (`/questions/`) | 계속 생각할 질문, "현재 생각", 열림·닫힘 | 노트로 옮김 | 질문 1개 = 노트 1개(제목 = 질문) | 겹침: 노트 |
| 14 | 연결 체크박스 | 글·메모 ↔ 주제·질문 잇기(`rtw_relations`) | 버림(글자로) | Web2에 노트끼리 잇는 구조 없음 | 없음 |
| 15 | 아카이브 (`/archive/2026/`) | 발표일 기준 월→날짜→글, 그 자리 메모 | 버림 | 노트는 고친 날 순. 발표일은 본문 머리말로 남김 | 없음 |
| 16 | 검색 (`/search/`) | 글·메모·주제·질문 글자 검색 | 버림 | 노트 검색(제목·본문)으로 대체 | 겹침 |
| 17 | 쓰기 (`/records/`) | 글쓰기 훈련 A(처음 글)·B(피드백)·C(고친 글)·배운 것·태그, 훈련 기준 | 노트로 옮김 | 기록 1개 = 노트 1개, 훈련 기준 = 노트 1개 | 겹침: 노트·마크다운 |
| 18 | 피드백 (`/feedback/`) | 지인이 의견 보내기, 관리자 목록 | 읽생기에 남김 | 지인 시험용 | 없음 |
| 19 | 소개·계정 삭제 (`/about/`) | 개인정보 안내, 탈퇴(`rtw-delete-account`) | 읽생기에 남김 | 지인 탈퇴 경로 | 없음 |
| 20 | Android 앱·공유받기 | Capacitor 앱, 다른 앱에서 주소 공유 | 버림 | 플레이 출시 취소 | Web2 Android 앱은 별도(중단 상태) |
| 21 | ChatGPT 글 추가 (`rtw-personal-write`) | GPT가 읽기 글·메모·질문을 명진 계정에 추가 | 통로 변경(4절) | Web2로 바꿈 | 없음 |
| 22 | 당겨서 새로고침·탭 밀기 | 폰 조작 | 버림 | Web2에 밀기 전환 있음 | 부분 겹침 |

정리: 명진 글의 **내용**은 전부 노트로 간다. **화면 기능** 중 Web2로 새로 만들 것은 이번 일원화 범위에 없다(필요하면 D8처럼 별도 후보로 원장에 올림).

## 2. 데이터

### 2.1 rtw_* 표 (명진 글이 사는 곳)

모든 표에 `owner_id`(로그인 계정)가 있고, 사람별로 행이 나뉜다. 사진·파일 저장(Storage·Drive)은 **없다**(코드에 storage 호출 0건). 글은 모두 글자다.

| 표 | 무엇 | 주요 열 (추정 포함, 2절 머리 참고) | 명진 글? |
| --- | --- | --- | --- |
| `rtw_resources` | 읽기 글 | `id, owner_id, title, original_title, author, source_name, published_on(date), original_url, body_md(마크다운), visibility('private'), created_at, updated_at` | 예 |
| `rtw_notes` | 메모 | `id, owner_id, body(글자, 인용 `> ` 머리 가능), note_type(1~30자 글자, 기본 '생각'), resource_id(글에 붙은 메모면 그 글), created_at, updated_at` | 예 |
| `rtw_questions` | 질문 | `id, owner_id, body, current_thought, status('open' 등), created_at?, updated_at` | 예 |
| `rtw_topics` | 주제 | `id, owner_id, name, slug, summary` | 예(이름·요약) |
| `rtw_relations` | 연결 | `id, owner_id, source_type(resource·note), source_id, target_type(topic·question), target_id, relation_type('related'), created_at` | 예(연결 정보) |
| `rtw_bookmarks` | 책갈피 | `id, owner_id, resource_id, bookmark_type(resource·passage), selected_text, context_before, context_after, start_offset, end_offset, note, created_at, updated_at` | 예 |
| `rtw_records` | 글쓰기 훈련 기록 | `id, owner_id, record_type(5종), title, source_resource_id, a_original, b_feedback, c_revision, takeaway, tags(text[]), origin(chatgpt·manual·reading), created_at, updated_at` (저장소 migration으로 확인) | 예 |
| `rtw_writing_context` | 훈련 기준 | `owner_id(기본 키), profile_md, updated_at` (확인) | 예(1행) |
| `rtw_note_types` | 메모 유형 목록 | `id, owner_id, name, created_at` | 이름만 |
| `rtw_feedback` | 지인 피드백 | `id, owner_id, body, page_path, created_at` (확인) | 아니오 |
| `rtw_beta_access` | 초대 명단 | `email(기본 키), role(admin·user), active, invited_at, note` (확인) | 아니오 |
| `rtw_ai_usage` | AI 하루 사용 횟수 | `owner_id, usage_day, action, count, updated_at` | 아니오 |
| `rtw_personal_mode` | ChatGPT가 쓸 소유자 지정 | `id('owner'), owner_id` | 아니오(설정) |

- 쓰기 경로: 화면은 로그인 사용자 권한(RLS: `owner_id = auth.uid()` + 초대 확인 restrictive 정책)으로 쓴다. ChatGPT는 4절의 서버 함수가 service role로 쓴다.
- `rtw_records`에는 화면·ChatGPT 어느 쪽에도 **추가 코드가 없다**(수정·삭제만). 행이 있다면 예전에 다른 경로로 넣은 것이다(추정). 7.2절 2번에서 개수를 본다.

### 2.2 Web2 노트 저장 방식

- 표 하나: `app_notes`의 `kind='note'` 행(20261017052234). 바구니 메모(`basket`)·업무일지(`work`)·일기(`diary`)와 같은 표.
- 열: `id, workspace_id, kind, title(필수, 한 줄 1~200자), raw_text(마크다운 글자, 0~10만 자), occurred_at, created_at, updated_at, attachments(jsonb, Drive 파일 최대 20개), archived_at, ai_export_allowed(기본 true), metadata(jsonb 객체)`.
- 연결: `app_record_links`(note_id → 프로젝트·담당조직·회의·자료실 1곳). 노트끼리 잇는 구조와 태그는 없다.
- 첨부: Drive "Web2 바구니" 폴더 파일을 `basket-files` Edge가 올리고 `attachments`에 기록. 노트 본문 자체는 Drive가 아니라 DB 행이다.
- 권한: 정책 `notes_owner_all`(authenticated, `private.app_is_workspace_owner(workspace_id)`) 하나. anon 권한 없음.
- 화면: 목록은 `updated_at` 최신순, 검색은 제목+본문 글자. 바구니·AI 복사·drive-summary는 `kind=eq.basket`만 읽으므로 옮겨 온 노트가 바구니·AI 복사·Drive 요약에 섞이지 않는다.

### 2.3 대응표

| 읽생기 | Web2 노트 (`app_notes`, kind=note) | 방법(추천안) | 잃거나 바뀌는 것 |
| --- | --- | --- | --- |
| 읽기 글 1개 | 노트 1개 | `title` ← `title`(200자 초과면 앞 200자, 전체 제목은 본문 머리말에) | 200자 넘는 제목은 제목 칸에서 잘림(본문엔 남음) |
| `original_title, author, source_name, published_on, original_url` | 본문 맨 위 머리말 인용 한 묶음 | `> 원문: [원문 제목](주소) · 저자 · 출처 · 발표 2026-09-18` | 칸으로 거르기·정렬 불가(글자 검색만) |
| `body_md` | 머리말 아래 본문 | 그대로(마크다운·Mermaid는 Web2 MD-표시가 그림) | 없음(6만 자 ≤ 10만 자) |
| 글에 붙은 메모(`rtw_notes.resource_id`) | 그 글 노트의 `## 나의 메모` 절 | 메모마다 `- [유형] 날짜` + 본문 | 메모별 수정 시각·따로 지우기 |
| 글 책갈피(글 통째) | 머리말에 "⭐ 책갈피" 표시 | 글자 한 줄 | 책갈피 목록 화면 |
| 문장 책갈피 | `## 책갈피` 절에 `> 문장` + 메모 | 인용 블록 | 문장 위치로 이동(offset·앞뒤 문맥) |
| 독립 메모 1개 | 노트 1개 | 제목 = 첫 줄(인용 `> `로 시작하면 인용 다음 첫 줄, Web2 `noteTitleFromText`와 같은 규칙), 본문 = 메모 전체 | 유형은 본문 끝 글자로 |
| `note_type` | 본문 끝 `유형: 생각` | 글자 | 유형 거르기 |
| 질문 1개 | 노트 1개 | 제목 = 질문(200자), 본문 = 질문 전문 + `## 현재 생각` + `상태: 열림/닫힘` | 열린 질문 모아 보기 |
| 주제 | 이어진 노트 본문 끝 `주제: A, B` | 글자. 주제 요약(`summary`)이 있으면 주제마다 노트 1개(D5 선택) | 주제별 모아 보기 |
| 연결(`rtw_relations`) | 양쪽 노트 본문 끝 `주제:`·`질문:` 줄 | 글자 | 서로 이동하는 링크 |
| 글쓰기 기록 1개 | 노트 1개 | 제목 = `title`, 본문 = `## A 처음 쓴 글`·`## B 피드백`·`## C 고친 글`·`## 배운 것` + `종류:`·`태그:` 줄, 원본 글이 있으면 그 제목 | 기록 종류·태그 거르기 |
| 훈련 기준(`rtw_writing_context`) | 노트 1개 "글쓰기 훈련 기준" | 그대로 | 없음 |
| `created_at` | `created_at` | 그대로 | 없음 |
| `updated_at` | `updated_at` | 그대로(옮긴 노트가 목록 맨 위를 덮지 않게) | 없음 |
| (발표일 또는 만든 날) | `occurred_at` | 만든 날(`created_at`) 추천. 발표일은 머리말에 | 발표일 달력 |
| 읽생기 행 id | `metadata.rtw = {table, id, migrated_at}` | 다시 실행해도 두 번 안 들어가게, 되돌리기 대상 표시 | 없음 |
| 피드백·초대 명단·AI 사용량·소유자 설정·유형 목록 | 옮기지 않음 | — | 해당 없음 |

옮길 때 잃는 정보(요약): 주제·질문·메모 사이의 "이어 보기"(링크가 글자가 됨), 메모 유형·기록 종류·태그로 거르기, 책갈피 문장 위치·앞뒤 문맥, 질문 열림·닫힘 모아 보기, 발표일 아카이브, 글별 AI 읽기 결과(애초에 저장 안 됨), 200자 넘는 제목의 제목 칸 표시. 글자 내용 자체는 잃지 않는다.

## 3. 로그인·소유 판정

### 3.1 읽생기

- 로그인: Supabase Auth(Google). **Web2와 같은 `auth.users`**를 쓴다.
- 입장: 로그인 이메일이 `rtw_beta_access`에 `active=true`로 있어야 한다(`rtw-beta-status` Edge, verify_jwt=false + 코드에서 `getUser`). 관리자(`role='admin'`)는 초대·피드백 목록·AI 무제한.
- 행 권한: 표마다 `owner_id = auth.uid()` 정책 + `private.rtw_has_beta_access()` restrictive 정책(20260921050000). 지인 데이터는 **행의 `owner_id`로만** 나뉜다(같은 표에 섞여 있음).
- "개인 소유자"(명진): `rtw_personal_mode`의 `id='owner'` 행 하나. ChatGPT 글 추가가 이 계정에 쓴다. `rtw-claim-personal-owner`가 처음 부른 로그인 사용자를 소유자로 지정하고, 이미 있으면 거절한다. `rtw_is_personal_owner()` RPC도 있다(본문 미확인).
- 초기 관리자 지정: `rtw_beta_access`에 `rtw_personal_mode` 소유자의 이메일을 `admin`으로 넣었다(20260921050000).

### 3.2 Web2

- 같은 `auth.users`. Web2 입장은 `app_workspaces.slug='kptu-work'`의 `app_workspace_members.role='owner'` 한 사람만(`private.app_is_workspace_owner`). 지인 계정이 Web2에 로그인하면 "접근 거부 + 로그아웃"만 보인다(Task 20).

### 3.3 얽힌 부분

| 얽힘 | 내용 | 일원화·끄기 때 영향 |
| --- | --- | --- |
| 같은 Auth | 지인 계정이 `auth.users`에 함께 있음 | 지인 계정 삭제는 Web2에도 계정 삭제. 끄기(⑤) 때 사용자 결정 |
| 가입 트리거 `auth.users.app_auth_user_profile` | 읽생기로 가입한 지인에게도 `app_profiles` 행이 생김(묶음A 1.10) | 아래 8.2 ①: 지인 탈퇴가 "Web2 계정"으로 잘못 판정될 수 있음 |
| `rtw-delete-account`의 Web2 판정 | `app_profiles`·`app_workspace_members`·`app_pages`·`app_spaces`에 행이 있으면 로그인 계정은 남기고 읽생기 데이터만 삭제 | 명진은 Web2 계정이라 탈퇴해도 계정 유지(의도). 원장 28(구성원 체계 제거)이 이 판정을 바꿈 → 읽생기를 끄면 이 의존이 사라짐 |
| 소유자 일치 | 읽생기 소유자(`rtw_personal_mode.owner_id`)와 Web2 소유자(`app_workspace_members` owner)가 같은 사람이어야 옮기기가 맞음 | ④ SQL은 둘이 같지 않으면 멈춘다. 7.2절 1번으로 미리 확인 |
| 같은 DB의 DB 버튼 | 승인형 DB workflow(`scripts/ops/db-migration-plan.mjs`)는 `rtw_`가 들어간 SQL을 일부러 거절함 | ④·⑤의 rtw_* 관련 SQL은 DB 버튼으로 못 돌림 → SQL Editor(폰 경로 C)만 가능 |

옮기기 대상 고르기: `owner_id = (rtw_personal_mode의 owner)`이고 그 값이 Web2 owner와 같은 행만. 지인 행은 건드리지 않는다.

## 4. ChatGPT 글 추가 통로

### 4.1 지금 경로 (확인한 것)

- GPT "읽생기 글 추가"(나만 보기, 2026-10-04 재연결) → Action `addPersonalItem` → `POST /functions/v1/rtw-personal-write`.
- 함수: verify_jwt=false. 요청 헤더 `x-rtw-write-key`를 서버 비밀값과 고정 시간 비교(SHA-256). 맞으면 service role로 쓰기.
- 비밀값·환경변수 **이름**: `RTW_PERSONAL_WRITE_KEY`(GPT와 공유하는 전용 키), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`. 값은 이 문서에 적지 않는다.
- 쓰는 곳: 소유자는 요청값이 아니라 `rtw_personal_mode` 행으로 정함. `action`이 `resource`(읽기 글)·`note`(메모)·`question`(질문) 중 하나, 추가만(조회·수정·삭제 없음). 길이 상한 제목 500·본문 6만 자.
- 성격: "키를 아는 쪽은 명진 계정에 글을 추가할 수 있다". 로그인 없이 열린 쓰기 문이다(현재도 존재). 운영 배포본이 저장소 보강판과 같은지는 미확인(원장 RTW-3).

### 4.2 Web2로 바꿀 때 후보 (권한을 넓히지 않는 것)

전제: Web2의 RLS·로그인 경계·Edge 인증은 그대로 둔다. 새 문을 만들 경우에도 "명진 노트에 추가만, 한 종류만"으로 좁힌다.

| 안 | 방법 | 좋은 점 | 나쁜 점 | 새로 생기는 것 |
| --- | --- | --- | --- | --- |
| **C. 붙여넣기 (추천, 지금)** | GPT가 마크다운 노트 초안을 만들면 명진이 복사 → Web2 메뉴 [쓰기] → [노트] → [저장] (이미 있음, #634) | 새 개발·새 권한·새 비밀값 0. 저장 전에 눈으로 봄. 오늘부터 가능 | 글마다 복사·붙여넣기 한 번(폰에서도 됨) | 없음(GPT 지침만 "Action 대신 노트 초안 출력"으로 수정) |
| **B. 바구니 수집 통로와 합치기 (추천, 나중)** | 원장 BASKET-수집연동(텔레그램·녹음 전사본 Drive 폴더 → 정기 수집 → 바구니 미분류)의 같은 입구를 쓴다. GPT 결과는 그 입구로 **바구니 미분류**에 들어오고, 명진이 보고 ⋯ → [노트로 옮기기] | 바깥에서 들어오는 문이 하나뿐. 모든 글이 사람 확인을 거침. 기존 [노트로 옮기기] 재사용 | BASKET-수집연동(귀국 뒤, 미착수)에 기대므로 시간이 걸림. GPT가 Drive·입구에 쓰는 방법(GPT Action 인증)을 그때 설계해야 함. 한 단계 더 거침 | 수집 입구 1개(BASKET-수집연동이 어차피 만들 것). 그 입구의 열쇠는 "바구니에 추가만" |
| A. 노트 전용 쓰기 문 (비추천) | 새 Edge 함수(예: 노트 추가 전용)가 전용 키 헤더를 확인하고 `kptu-work`의 `app_notes`에 `kind='note'` 행 추가만 | GPT 사용 흐름이 지금과 같음(주소·키만 교체) | 바깥에서 명진 노트에 바로 쓰는 문이 하나 더 생김(키가 새면 노트에 글이 들어감). 새 함수 배포·새 비밀값 등록(§6 정지 지점 2개). 수집 통로가 생기면 문이 둘 | Edge 함수 1개, 비밀값 1개 |

추천: **지금은 C**(새 개발 없음) → BASKET-수집연동 설계 때 **B**로 GPT 입구를 함께 넣을지 결정. A는 B와 문이 겹쳐 만들지 않는다.

C로 바꿀 때 GPT 쪽 할 일(명진, ChatGPT 화면): GPT 편집 → 구성 → 작업(Action) 삭제 → 지침을 "노트 제목 한 줄 + 마크다운 본문을 코드 블록 하나로 출력"으로 바꿈. 이렇게 하면 읽생기 쓰기도 끊겨 5절 2단계(읽기 전용)를 겸한다.

## 5. 옮기기(④) 단계 초안 — 설계만, 실행하지 않음

정지 지점(AGENTS §6): 운영 데이터 변경(노트 행 추가). 폰 경로 C(사용자가 SQL Editor에서 실행) 또는 아래 ②안.

### 5.1 순서

| 단계 | 내용 | 누가 | 되돌리기 |
| --- | --- | --- | --- |
| 0 | 7.2절 조회 SQL로 개수·소유자 일치·긴 글 확인 → 7.1 결정 확정 | 명진(SQL Editor) 또는 Claude Code 로컬(조회 전용 MCP) | 해당 없음(조회) |
| 1 | **ChatGPT 연결 끊기**: GPT Action 삭제(4.2 C) | 명진(ChatGPT 화면) | Action 다시 붙이기 |
| 2 | **백업**: 명진 소유 rtw 행을 표별 JSON으로 내려받아 Drive 비공개 폴더에 보관(7.2절 SQL 8번, 결과 [Download]) | 명진 | 해당 없음 |
| 3 | **해 보기(dry-run)**: 옮기기 SQL을 끝만 `rollback;`으로 바꿔 실행 → 표별 "들어갈 노트 수"·"200자 넘는 제목 수"·"10만 자 넘는 본문 수(0이어야)" 확인 | 명진(SQL Editor) | 저절로 취소됨 |
| 4 | **옮기기**: 같은 SQL을 `commit;`으로 실행(표마다 조각 나눔: 읽기 글 → 독립 메모 → 질문 → 기록·기준) | 명진(SQL Editor) | 5.3 |
| 5 | **확인**: 사후 조회(노트 수 = 3단계 숫자, `metadata.rtw` 있는 행 수) + Web2 [노트]에서 몇 개 열어 보기·검색 | 명진 | — |
| 6 | 읽생기 쪽 명진 글은 **지우지 않고** 지인 시험 끝날 때까지 둠(두 번째 백업 역할). 지울 때는 ⑤에서 | — | — |

### 5.2 읽생기 "명진만 읽기 전용" 만드는 법

| 방법 | 내용 | 평가 |
| --- | --- | --- |
| ① GPT 끊기 + 명진이 쓰지 않기 (추천) | 1단계로 바깥 쓰기 차단. 화면에서는 명진이 더 쓰지 않음. 옮긴 뒤 새로 쓴 글이 있는지는 7.2절 9번(옮긴 시각 뒤 바뀐 행 수)으로 확인 | 개발·DB 변경 0. 실수로 쓴 글은 같은 SQL을 다시 돌리면 그 글만 추가로 옮겨짐(중복 방지 표시 덕분) |
| ② 비밀값 교체 | `RTW_PERSONAL_WRITE_KEY`를 아무도 모르는 값으로 교체 | 비밀값 변경(대시보드, 정지 지점). ①의 GPT 삭제로 충분하면 불필요 |
| ③ 읽생기 화면에서 명진 쓰기 숨김 | 읽생기 저장소 코드 수정·배포 | 지인 시험용 화면을 건드림. 비추천 |
| ④ DB에서 명진 쓰기 막기 | rtw 정책에 restrictive 쓰기 차단 추가 | rtw_* 정책 변경(읽생기 저장소 migration, 공유 DB). 비추천 |

### 5.3 옮기는 방식 비교

| 방식 | 내용 | 좋은 점 | 나쁜 점 |
| --- | --- | --- | --- |
| **① SQL Editor 1회 SQL (추천)** | `insert into public.app_notes (...) select ... from public.rtw_*` 를 한 트랜잭션으로. 앞에서 확인(소유자 일치, `app_notes.kind` 검사 조건 존재, `metadata ? 'rtw'` 행 0 또는 "이어서 옮기기" 모드) → 넣기 → 뒤에서 확인(개수 일치, 바구니 행 수 변화 0) → 다르면 전체 취소 | 한 번에 전부 아니면 전무. 새 함수·새 권한·새 Edge·화면 코드 0. 읽생기 데이터는 읽기만 | SQL Editor 붙여넣기 필요(명진이 불편해함). 실행 주체가 SQL Editor라 RLS를 거치지 않으므로 앞뒤 확인을 SQL 안에 꼭 둔다. DB 버튼은 `rtw_` 거절이라 못 씀 |
| ② Web2 1회용 [읽생기에서 가져오기] | 명진이 Web2에 로그인한 상태에서 화면이 rtw_* 를 본인 권한으로 읽고 기존 노트 저장 경로(owner RLS)로 하나씩 씀 | SQL Editor 불필요. 권한 경계 그대로(본인 권한) | 한 번에 전부가 아님(중간 실패 시 일부만). Web2 코드가 rtw_* 를 읽게 됨(제품 경계 흐림, AGENTS §5). 쓰고 나서 지울 임시 기능 |
| ③ Edge 함수 | service role로 서버에서 옮김 | 빠름 | 큰 권한의 새 함수 배포(정지 지점). 비추천 |

①의 SQL은 ④ PR에서 `docs/design/sql/`에 파일로 둔다(데이터 이동이라 `supabase/migrations/` 대상 아님, `schema_migrations` 기록 행 없음 — 7.1 D12에서 확인). 화면 출력 잘림을 피하려고 main 파일 원문을 붙여 넣는다.

### 5.4 되돌리는 법

- 옮긴 노트만 지우기: `delete from public.app_notes where kind = 'note' and metadata ? 'rtw' and workspace_id = (kptu-work)`.
- 안전장치: 옮긴 뒤 명진이 **고친 노트**(`updated_at > metadata.rtw.migrated_at`)나 **연결·첨부가 붙은 노트**가 하나라도 있으면 멈추고 개수만 보여 준다(고친 내용을 지워서 통과시키지 않음). 그런 노트는 따로 판단.
- 읽생기 원본은 그대로이므로, 지운 뒤 같은 SQL을 다시 실행하면 처음부터 다시 옮겨진다.
- 일상어 3줄(④ 적용 때 다시 제시)
  - 무엇이 바뀌나: Web2 노트에 읽생기 글이 노트로 한꺼번에 들어온다. 읽생기 글과 바구니 메모는 그대로다.
  - 잘못되면: SQL이 앞뒤 확인에서 멈추면 아무것도 안 바뀐다. 다 들어간 뒤 모양이 마음에 안 들면 노트 목록에 옛 글이 많이 보일 뿐 남에게는 안 보인다.
  - 되돌리는 법: "옮겨 온 노트만 지우기" SQL 한 번. 읽생기 원본이 남아 있어 다시 옮길 수 있다.

## 6. 읽생기 끄기(⑤) 정리 목록 — 지인 시험 종료 뒤

순서는 "들어오는 길 막기 → 서버 정리 → 데이터 정리 → 흔적 정리". 각 줄은 정지 지점 여부를 표시한다.

| # | 대상 | 할 일 | 정지 지점·주의 |
| --- | --- | --- | --- |
| 1 | 지인 안내 | 종료 날짜 안내, 원하면 각자 탈퇴(계정 삭제 판정 8.2 ① 먼저 확인) | — |
| 2 | `read.bokdoong.com`, `read-test.bokdoong.com` | Cloudflare Custom Domain 해제 → `rtw-router` Worker 삭제 | Cloudflare 설정(정지). 공용 `bokdoong-router`는 read를 다루지 않음(#346, `tests/domain/bokdoong-router.test.mjs`) |
| 3 | 읽생기 GitHub Pages | `mj880616.github.io/read-think-write/` 배포 끄기, 저장소 보관(archive) | 저장소 설정 |
| 4 | Edge 함수 7개 | `rtw-ai-read`, `rtw-beta-status`, `rtw-claim-personal-owner`, `rtw-delete-account`, `rtw-personal-write`, `rtw-recommend`(이미 410), `rtw-url-import` 삭제. 삭제 전 운영본 내려받기 | Edge 삭제(정지, 사용자 대시보드). 지인 탈퇴(1)를 먼저 끝낸 뒤 `rtw-delete-account` 삭제 |
| 5 | Edge 비밀값 | `RTW_PERSONAL_WRITE_KEY`, `RTW_AI_MODEL` 삭제. **`OPENAI_API_KEY`는 Web2 함수(`library-files`·`document-ai-index`·`meeting-ai-ingest`·`team-ai`·`page-ai-draft`)도 쓰므로 지우지 않음** | 비밀값 변경(정지) |
| 6 | rtw_* 표 13개와 함수 | 백업(7.2절 8번, 이번엔 전체 행) 후 삭제: 표 `rtw_relations, rtw_bookmarks, rtw_records, rtw_notes, rtw_questions, rtw_topics, rtw_note_types, rtw_resources, rtw_writing_context, rtw_feedback, rtw_ai_usage, rtw_beta_access, rtw_personal_mode`, 함수 `rtw_is_personal_owner, rtw_rename_note_type, rtw_delete_note_type_if_unused, rtw_delete_resource, rtw_consume_ai_quota, rtw_ai_usage_today, rtw_beta_access_status, private.rtw_beta_access_role, private.rtw_has_beta_access, private.rtw_is_beta_admin` | DB 변경(정지). DB 버튼은 `rtw_`·`drop table`을 거절 → SQL Editor 폰 경로 C. `schema_migrations`의 RTW 기록 행은 이력으로 남김 |
| 7 | Auth | Redirect URLs에서 읽생기 주소 제거, 지인 계정(+`app_profiles` 행) 삭제 여부 결정 | Auth 설정은 Web2와 공유(정지). Site URL은 그대로 |
| 8 | GitHub·Cloudflare 비밀값 | 읽생기 저장소 `RTW_CLOUDFLARE_API_TOKEN`·`RTW_CLOUDFLARE_ACCOUNT_ID`·`READSAENGGI_UPLOAD_*` 삭제, Cloudflare 토큰 폐기 | — |
| 9 | Google·Play | Google OAuth 승인 출처에 읽생기 주소가 있으면 제거, Play Console 앱 초안이 있으면 정리 | — |
| 10 | work 저장소 흔적 | RTW-우회로정리(원장 행 그대로: `index.html`·`app/auth-bootstrap.js`의 `?code=` → read 이동, `tests/domain/read-oauth-return-bridge.test.mjs`, `docs/bokdoong-domain.md`의 읽생기 허용 주소, `personal/portal/index.html` 읽생기 카드·파비콘). 추가: `AGENTS.md` §5 RTW 문단, `docs/web2-env6b-edge-source.md` 5절 표의 rtw 7행, `docs/migration-history.md`(이력은 남기고 "종료" 표시), `personal/arsenal-match-archive/index.html` 머리글 문구. `scripts/ops/db-migration-plan.mjs`의 `rtw_` 거절 규칙은 남겨도 해 없음(정리 선택) | 저장소 변경만. RTW-우회로정리는 끄기 전에도 가능(끼워 넣기) |
| 11 | 원장 | RTW-분리·RTW-출시준비 종료, RTW-3·32의 선행 조건, 28의 "읽생기 탈퇴 판정" 의존 정리 | 커맨드센터 |

## 7. 명진이 정할 것과 확인할 SQL

### 7.1 결정 목록 (일상어, 추천안 포함)

- **D1. ChatGPT로 글 넣는 법** — ① 지금은 ChatGPT가 만든 글을 Web2 [쓰기]→[노트]에 붙여 넣기 **(추천: 새로 만들 것 없음, 저장 전에 눈으로 봄)** ② 나중에 바구니 수집 통로가 생길 때 같은 입구로 받기 ③ Web2에 노트 전용 쓰기 문을 새로 만들기(비추천: 바깥 문이 늘어남).
- **D2. 읽기 글의 저자·출처·주소·발표일** — ① 노트 본문 맨 위 한 묶음으로 **(추천)** ② 버리기.
- **D3. 옮긴 노트의 날짜** — ① 읽생기에서 처음 쓴 날·고친 날 그대로 **(추천: 옛 글이 노트 목록 맨 위를 덮지 않음)** ② 옮긴 날로.
- **D4. 글에 붙인 메모·책갈피 문장** — ① 그 글 노트 안 "나의 메모"·"책갈피" 칸으로 합치기 **(추천: 글과 함께 읽힘)** ② 메모마다 노트 따로.
- **D5. 주제·질문 연결, 메모 유형** — ① 노트 끝에 "주제: …, 유형: …" 한 줄로 남기기 **(추천: 검색으로 찾을 수 있음)** ② 버리기. 주제 설명이 있으면 주제마다 노트 하나 더 만들지도 같이 정함(추천: 설명 있는 주제만).
- **D6. 질문** — ① 질문 하나 = 노트 하나 **(추천)** ② 질문 모음 노트 하나.
- **D7. 글쓰기 훈련 기록(A·B·C)** — ① 기록 하나 = 노트 하나, 훈련 기준도 노트 하나 **(추천)** ② 옮기지 않기.
- **D8. URL 자동 가져오기·AI 읽기 기능** — ① 이번엔 버리고, 아쉬우면 Web2 새 과제로 원장에 따로 올리기 **(추천)** ② 일원화와 함께 Web2에 만들기(범위가 커짐).
- **D9. 옮긴 뒤 읽생기의 명진 글** — ① 지인 시험 끝날 때까지 그대로 두고 끄기 때 함께 지우기 **(추천: 두 번째 백업)** ② 옮기자마자 지우기.
- **D10. 옮기는 방식** — ① SQL Editor에 한 번 붙여 넣기(먼저 "해 보기만" 실행) **(추천: 한 번에 전부 아니면 전무, 새 기능 없음)** ② Web2에 1회용 [읽생기에서 가져오기] 버튼(SQL Editor 없이 되지만, 중간에 끊기면 일부만 들어가고 임시 기능을 만들었다 지워야 함).
- **D11. 읽생기 명진 글 잠그기** — ① ChatGPT 연결 끊고 명진이 읽생기에 더 쓰지 않기 **(추천: 개발 없음)** ② 읽생기 화면이나 DB를 고쳐 막기.
- **D12. 옮기기 기록** — ① 노트마다 "읽생기에서 옮김" 표시(보이지 않는 칸)만 남기고 DB 변경 기록표에는 안 남기기 **(추천: 표 구조는 안 바뀌는 데이터 옮기기라서)** ② 기록표에도 한 줄 남기기.
- 지인 시험 종료 시점과 지인 계정을 계정까지 지울지는 ⑤ 착수 때 정한다(지금 정하지 않아도 됨).

### 7.2 명진이 확인할 조회 SQL (읽기 전용, select만)

- 실행: Supabase SQL Editor 새 쿼리 창(+)에 하나씩 붙여 넣고 실행 → 결과 캡처. 모두 select만 있고 아무것도 바꾸지 않는다. 결과에 이메일·본문은 나오지 않게 개수만 센다(8번만 백업용으로 본문이 나옴, 캡처하지 말고 내려받기).
- DB 버튼(승인형 workflow)은 `rtw_`가 들어간 SQL을 거절하므로 쓸 수 없다. 대안: PC의 Claude Code 로컬 세션(조회 전용 Supabase 연결)이 1~7·9번을 대신 조회할 수 있다(💻).

```sql
-- 1. rtw 표의 실제 열 (2절 추정 확인용)
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name like 'rtw\_%'
order by table_name, ordinal_position;
```

```sql
-- 2. 읽생기 소유자와 Web2 소유자가 같은 사람인지, 명진 글 개수
with me as (select owner_id as id from public.rtw_personal_mode where id = 'owner'),
     web2 as (select wm.user_id as id from public.app_workspace_members wm
              join public.app_workspaces w on w.id = wm.workspace_id
              where w.slug = 'kptu-work' and wm.role = 'owner')
select
  (select count(*) from me) as rtw_owner_rows,                          -- 기대 1
  (select count(*) from web2) as web2_owner_rows,                       -- 기대 1
  (select count(*) from me join web2 using (id)) as same_owner,         -- 기대 1
  (select count(*) from public.rtw_resources where owner_id = (select id from me)) as resources,
  (select count(*) from public.rtw_notes where owner_id = (select id from me)) as notes,
  (select count(*) from public.rtw_questions where owner_id = (select id from me)) as questions,
  (select count(*) from public.rtw_topics where owner_id = (select id from me)) as topics,
  (select count(*) from public.rtw_relations where owner_id = (select id from me)) as relations,
  (select count(*) from public.rtw_bookmarks where owner_id = (select id from me)) as bookmarks,
  (select count(*) from public.rtw_records where owner_id = (select id from me)) as records,
  (select count(*) from public.rtw_writing_context where owner_id = (select id from me)) as writing_context,
  (select count(*) from public.rtw_note_types where owner_id = (select id from me)) as note_types;
```

```sql
-- 3. 언제부터 언제까지 썼는지 (명진 글)
with me as (select owner_id as id from public.rtw_personal_mode where id = 'owner')
select 'resources' as what, min(created_at) as first_made, max(created_at) as last_made, max(updated_at) as last_changed
  from public.rtw_resources where owner_id = (select id from me)
union all
select 'notes', min(created_at), max(created_at), max(updated_at)
  from public.rtw_notes where owner_id = (select id from me)
union all
select 'records', min(created_at), max(created_at), max(updated_at)
  from public.rtw_records where owner_id = (select id from me);
```

```sql
-- 4. 옮길 때 잘리거나 모양이 바뀌는 것 (명진 글)
with me as (select owner_id as id from public.rtw_personal_mode where id = 'owner')
select
  (select count(*) from public.rtw_resources where owner_id = (select id from me) and char_length(title) > 200) as long_resource_titles,
  (select count(*) from public.rtw_questions where owner_id = (select id from me) and char_length(body) > 200) as long_questions,
  (select count(*) from public.rtw_records where owner_id = (select id from me) and char_length(title) > 200) as long_record_titles,
  (select count(*) from public.rtw_notes where owner_id = (select id from me) and resource_id is not null) as notes_on_resources,
  (select count(*) from public.rtw_notes where owner_id = (select id from me) and resource_id is null) as standalone_notes,
  (select count(*) from public.rtw_bookmarks where owner_id = (select id from me) and bookmark_type = 'passage') as passage_bookmarks,
  (select count(*) from public.rtw_bookmarks where owner_id = (select id from me) and bookmark_type = 'resource') as resource_bookmarks,
  (select count(distinct note_type) from public.rtw_notes where owner_id = (select id from me)) as note_type_kinds,
  (select count(*) from public.rtw_topics where owner_id = (select id from me) and coalesce(btrim(summary), '') <> '') as topics_with_summary,
  (select count(*) from public.rtw_questions where owner_id = (select id from me) and status <> 'open') as closed_questions;
```

```sql
-- 5. 글+메모+책갈피를 합치면 10만 자를 넘는 읽기 글 수 (기대 0)
with me as (select owner_id as id from public.rtw_personal_mode where id = 'owner')
select count(*) as over_limit
from (
  select r.id,
         char_length(coalesce(r.body_md, '')) + 2000
         + coalesce((select sum(char_length(n.body) + 60) from public.rtw_notes n where n.resource_id = r.id and n.owner_id = r.owner_id), 0)
         + coalesce((select sum(char_length(coalesce(b.selected_text, '')) + char_length(coalesce(b.note, '')) + 20)
                     from public.rtw_bookmarks b where b.resource_id = r.id and b.owner_id = r.owner_id), 0) as total
  from public.rtw_resources r
  where r.owner_id = (select id from me)
) t
where total > 100000;
```

```sql
-- 6. 지인 쪽 규모 (개수만, 이메일 없음)
with me as (select owner_id as id from public.rtw_personal_mode where id = 'owner')
select
  (select count(*) from public.rtw_beta_access where active) as active_invites,
  (select count(*) from public.rtw_beta_access where role = 'admin') as admins,
  (select count(distinct owner_id) from public.rtw_resources where owner_id <> (select id from me)) as friends_with_resources,
  (select count(*) from public.rtw_resources where owner_id <> (select id from me)) as friend_resources,
  (select count(*) from public.rtw_notes where owner_id <> (select id from me)) as friend_notes,
  (select count(*) from public.rtw_feedback) as feedback_rows;
```

```sql
-- 7. 지인 탈퇴가 "Web2 계정"으로 잘못 판정될지 (8.2 ① 확인, 개수만)
with me as (select owner_id as id from public.rtw_personal_mode where id = 'owner')
select
  (select count(*) from pg_trigger where tgname = 'app_auth_user_profile' and not tgisinternal) as profile_trigger,  -- 1이면 가입 때 프로필 생김
  (select count(*) from auth.users u
     join public.rtw_beta_access b on b.email = lower(u.email)
     where u.id <> (select id from me)
       and exists (select 1 from public.app_profiles p where p.user_id = u.id)) as friends_with_web2_profile,
  (select count(*) from auth.users u
     join public.rtw_beta_access b on b.email = lower(u.email)
     where u.id <> (select id from me)) as friend_accounts;
```

```sql
-- 8. 백업용 (④ 직전에 실행, 결과를 캡처하지 말고 [Download]로 내려받아 Drive 비공개 폴더에 보관)
--    표 이름만 바꿔 rtw_resources, rtw_notes, rtw_questions, rtw_topics, rtw_relations,
--    rtw_bookmarks, rtw_records, rtw_writing_context, rtw_note_types 순서로 한 번씩.
with me as (select owner_id as id from public.rtw_personal_mode where id = 'owner')
select jsonb_agg(to_jsonb(t)) as rows
from public.rtw_resources t
where t.owner_id = (select id from me);
```

```sql
-- 9. Web2 노트 현황과, 옮긴 뒤 읽생기에 새로 쓴 글이 있는지 (④ 뒤에 사용)
select kind, count(*) as rows,
       count(*) filter (where metadata ? 'rtw') as from_rtw
from public.app_notes
group by kind
order by kind;
```

## 8. 위험과 범위 밖 발견사항

### 8.1 위험

| 위험 | 막는 법 |
| --- | --- |
| 지인 글을 명진 노트로 잘못 옮김 | ④ SQL은 `rtw_personal_mode` 소유자 = Web2 owner일 때만 진행, `owner_id` 조건 필수. 사후 확인에서 표별 개수 대조 |
| SQL Editor는 RLS를 거치지 않음 | 대상 workspace(`kptu-work`)·kind(`note`)를 SQL 안에서 고정하고, 앞뒤 확인 실패 시 전체 취소 |
| 같은 글이 두 번 들어감 | `metadata.rtw.id`로 이미 옮긴 행은 건너뜀 |
| 옮긴 뒤 명진이 고친 노트를 되돌리기가 지움 | 되돌리기 SQL이 고친·연결된 노트가 있으면 멈춤 |
| 옮긴 노트가 바구니·AI 복사·Drive 요약에 섞임 | 그 경로들은 `kind=eq.basket`만 읽음(MEMO-노트 PR 2). 옮긴 행은 `kind='note'` |
| 노트 목록이 옛 글로 길어짐 | 날짜를 원래대로(D3) 두면 최근 노트가 위에 남음. 검색으로 찾음 |
| 실제 rtw 열이 추정과 다름 | 7.2절 1번 확인 후 ④ SQL 작성 |
| 명진이 SQL Editor를 불편해함 | 조각을 표별로 나눠 짧게(폰 경로 C 규칙). 대안 D10 ② |
| ChatGPT 끊긴 동안 글 추가가 불편 | C안(붙여넣기)은 오늘부터 가능 |

### 8.2 범위 밖 발견사항 (고치지 않고 기록만)

1. **지인 탈퇴 시 로그인 계정이 남을 수 있음(추정)**: 가입 트리거 `app_auth_user_profile`가 모든 새 계정에 `app_profiles` 행을 만들고(묶음A 1.10), `rtw-delete-account`는 `app_profiles` 행이 있으면 "Web2 계정"으로 보고 로그인 계정을 지우지 않는다. 그러면 지인이 탈퇴해도 읽생기 데이터만 지워지고 계정은 남는다. 7.2절 7번으로 확인 가능. 읽생기 쪽 판정 문제(RTW 소관).
2. **OpenAI 키가 이미 등록돼 있을 수 있음(추정)**: 원장 BASKET-AI자동정리는 운영 Edge 비밀값 `OPENAI_API_KEY`를 "미등록 추정"으로 적었지만, 읽생기 `rtw-ai-read`가 같은 이름의 비밀값을 쓴다. Edge 비밀값은 프로젝트 전체 공용이라, 읽생기 AI 읽기가 동작한다면 키는 이미 있다. 대시보드에서 이름만 확인 권장. 끄기(⑤) 때 이 키를 지우면 Web2 AI가 멈춘다.
3. `src/api.js`의 `isPersonalOwner`·`claimPersonalOwner`는 화면 어디서도 부르지 않는다. 그런데 `rtw-claim-personal-owner`(verify_jwt=false, 로그인만 확인)는 배포돼 있다. 소유자가 이미 지정돼 있어 거절되므로 위험은 낮다(⑤에서 삭제).
4. rtw_* 핵심 표 9개의 생성 SQL과 `rtw_is_personal_owner()` 본문이 두 저장소 어디에도 없다. ⑤ 삭제 전 백업 때 구조도 함께 남기는 것이 좋다(7.2절 1번 결과 보관).
5. `rtw_records`에 행을 추가하는 코드가 화면·ChatGPT 어디에도 없다(origin 기본값 `chatgpt`). 행이 있다면 출처 미상 경로로 들어간 것이다.
6. 운영 `rtw-personal-write`(v2, 9/18)와 저장소 보강판의 일치 여부 미확인(원장 RTW-3). C안으로 바꾸면 이 함수는 끄기 전까지 쓰이지 않는다.
7. 원장의 RTW-분리(별도 프로젝트 분리)·RTW-출시준비(플레이 정책 대응)는 10/18 결정으로 할 필요가 없어졌다. 원장 정리 대상.
