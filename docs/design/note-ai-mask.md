# NOTE-AI제외정리 — 노트를 AI에 보낼 때 비밀 부분만 가리기

- 결정: 2026-11-10 17:41 명진 "a"(17:46 "AI 질문에 대한 답도 a"). 10/28 NOTE-비밀메모 결정을 바꾼다.
- 바뀐 점
  - 노트 ⋯ [AI에 보내지 않기]·[AI 제외 풀기] 메뉴를 지웠다.
  - 목록·검색·포스트잇·태그·노트 고르기 창에서 '비밀 메모' 가림을 지웠다(원래 제목·앞 줄 그대로).
  - 노트를 AI로 보낼 때 통째로 빼지 않는다. 비밀번호·토큰·키 모양 부분만 서버가 `[가림]`으로 바꾸고 나머지는 다 보낸다. 화면 표시는 없다.
- 지킨 것
  - 저장된 노트 제목·본문은 바꾸지 않는다.
  - 옛 `metadata.ai_off` 값은 지우지 않고 읽지도 않는다(데이터 보존, DB 변경 없음). 고정·폴더 등 다른 메타데이터 쓰기는 지금처럼 이 값을 그대로 둔다.
  - `ai_export_allowed=false`(AI 내보내기 끔)·보관·일기 제외 규칙은 그대로다.

## 가림 함수 (한 곳)

`supabase/functions/ai-assist/note-secret.ts`

| 함수 | 하는 일 |
| --- | --- |
| `looksSecret(text)` | 비밀 모양인가(규칙 줄은 10/28과 같음) |
| `maskSecret(text)` | ① 개인 키 묶음 ② 알려진 키 모양 ③ 키 모양 덩어리 ④ '비밀번호·토큰' 같은 말이 나온 줄은 그 말부터 줄 끝까지 → `[가림]`. 결과는 늘 `looksSecret=false`(남으면 그 줄, 그래도 남으면 글 전체) |
| `aiNoteRow(row)` | 읽은 노트 행의 제목·본문·AI 제목만 가린 복사본(원래 행·다른 칸 그대로) |

앱의 `app/note-secret.mjs`(화면 공용 판별)는 쓰는 곳이 없어져 지웠다. 가림은 서버만 한다(AGENTS.md 3절: 앱이 가렸다고 믿지 않음).

## 노트 → AI 길 전수 (서버 ai-assist)

| 쓰임(kind) | 읽는 노트 | 전에는 | 이제 | 시험 |
| --- | --- | --- | --- | --- |
| `link_summary` 연결 요약(노트 글·노트 첨부 글) | 고른 노트 1개 | 비밀 모양·[AI에 보내지 않기]면 `note_excluded` | `readLinkNote`가 `aiNoteRow` | `ai-assist-link-sources` |
| `todo_radar` 챙길 것 찾기 | 업데이트·노트·업무일지 줄 | 노트(kind=note)만 통째 제외 | 읽자마자 `aiNoteRow`(모든 kind) | `ai-assist-todo-radar` |
| `ledger_auto` 원장 자동 기록 | 업데이트·노트·업무일지 줄 | 노트만 통째 제외 | 읽자마자 `aiNoteRow`(모든 kind) | `ai-assist-ledger-auto` |
| `share_draft` 공유 AI 초안 | 고른 노트·업데이트 | 노트만 통째 제외(skipped) | 본문 `maskSecret`(자르기 전), 제목은 `shareMaterial`에서 `maskSecret`. 응답의 근거 목록 제목은 원래 제목 | `ai-assist-share-draft` |
| `ask_web2` 물어보기 | 찾은 노트 근거 | 노트만 AI에 안 보냄(sent=false) | 보냄. 비밀 모양 노트는 검색 조각 대신 가린 본문 앞부분(`askNoteAiText`), 제목도 `askMaterial`에서 가림. 근거 목록·저장은 원래 제목 | `ai-assist-ask-web2` |
| `note_title` 노트 AI 제목 | 그 노트 | 비밀 모양이면 `secret`으로 건너뜀, `ai_off`면 `not_allowed` | `noteTitleMaterial(maskSecret(본문))` | `ai-assist-note-title` |
| `work_scope` 업무·개인 가르기 | 그 주 업무일지 줄 | 비밀 모양 줄·`ai_off` 행 통째 제외 | 줄은 원래 글로 두고(뺄 줄 맞추기) `workScopeMaterial`에서 `maskSecret`(사람이 뺀 예시 줄도) | `ai-assist-work-scope` |
| `schedule_titles` 주요 일정 다듬기 | 그 주 업데이트·업무일지 줄 | 검사 없음 | 읽자마자 `aiNoteRow` | `ai-assist-schedule-titles` |
| `overlap_check` 겹침 판정 | 고른 업데이트 | 검사 없음 | 읽자마자 `aiNoteRow`(겹침 지문도 가린 글 기준) | `ai-assist-overlap-check` |
| `file_name` 첨부 AI 이름 | 노트 첨부의 사진·파일 글자 | `ai_off`면 `not_allowed`, 파일 글자가 비밀 모양이면 `secret` | `ai_off` 검사만 지움. 노트 본문은 읽지 않음. 파일 글자 규칙은 그대로(아래 표) | — |

AI로 보내지 않는 노트 읽기(가림 필요 없음): 오늘 일기(`home_day_picks` 겹침 거르기, 서버에서만 씀), 업무일지 줄 있는지 확인(`journal_draft`), `note_title` 저장 뒤 확인. `tests/note-secret-server.test.mjs`가 handler.ts의 노트 읽는 곳마다 가림 함수를 거치는지, 아니면 이 목록에 있는지 본다.

화면(앱) 쪽: 공유 AI 초안 고르기 목록(`app/share-ai-draft.js`)도 노트를 빼지 않는다(AI 허용·보관 안 된 것만 읽는 조건은 그대로). 전체 검색·노트 고르기 창(`note-pick.mjs`)은 AI가 아니라 가림만 지웠다.

## 다른 '비밀 모양' 규칙 쓰는 곳 (노트가 아님 — 이번에 바꾸지 않음)

| 곳 | 재료 | 지금 규칙 | 메모 |
| --- | --- | --- | --- |
| `record_one_line` 조직 기록 한 줄 | 조직 기록 원문 | 비밀 모양이면 AI 안 부름(`secret`) | 노트 아님. 같은 부분 가림으로 바꿀지는 CC 결정 |
| `file_name` 첨부 AI 이름 | 사진·파일 글자 | 비밀 모양이면 `secret` | 첨부 글자. 위와 같음 |
| `area_suggest` 사업영역 추천 | 화면이 보낸 제목·글 | 비밀 모양이면 `secret` | 위와 같음 |
| `ask_web2` 질문 글 | 사람이 친 질문 | 비밀 모양이면 400 `ask_secret` | 질문 자체라 그대로 |
| `journal_draft` 오늘 한 줄 초안 | 일정·할 일·회의·소식 줄(화면이 보냄) | 비밀 모양 줄만 뺌 | 줄 단위로 이미 부분 제외 |
| `journal_memorable`·`home_day_picks`·`next_week_sheet`·`pre_meeting_sheet` | 통화·텔레그램·일정·원장 줄 | 비밀 모양 줄·항목 뺌 | 노트 아님 |
| AI 답 검사(`evidence.ts`·`share-draft.ts` 등) | AI가 돌려준 글 | 비밀 모양 줄 버림 | 나가는 글 검사라 그대로 |
| 노트 첨부 글자(`link_summary` 파일 요약) | 사진·파일 글자 | 검사 없음(전에도 노트 본문만 봄) | 범위 밖 발견사항으로 보고 |
