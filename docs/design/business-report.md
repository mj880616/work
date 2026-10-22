# 사업 보고 설계 (MTG-사업보고: '회의' 화면을 '사업 보고'로 넓히기)

📱 폰 가능(이 문서) · 설계·조사만 한다. 앱 코드·DB·Edge·설정 변경 없음. 아래 SQL은 설명용 스케치이고 migration 파일은 만들지 않았다.

- 작성: 2026-10-22, Claude Code 웹(설계 세션). 기준 main `783419e1`(#985).
- 요청: 요청함 2026-10-22 13:04 + 13:07 사용자 결정 + 14:28 추가(상단 [+ 추가]).
- 관련 행: MEET-기록보내기(B1 DB 대기, `docs/design/meet-record-send-investigation.md`), UPD-여러곳고르기(#955), JOURNAL-회의종류표시(#963)·`20261022090000_weekly_report_meeting_kinds`, JOURNAL-하루개편(#982, 진행 중), SEARCH-전체검색(S1 DB #968).
- 표시: **사실** = 저장소 코드·migration·문서·PR로 확인. **추정** = 확인하지 못한 짐작. 운영 DB·Edge는 조회하지 않았다(웹 세션 규칙). 착수 세션이 먼저 read-only로 확인할 것은 9절.

---

## 0. 명진이 정할 것 (한 번에 고르기)

각 항목에서 **굵은 것이 추천**이다. "전부 추천대로"라고만 답해도 된다.

1. **[기타] 칸** — **가. 둔다(추천)**: 맨 끝 [기타]. 연대 방문·현장 순회처럼 일곱 칸에 안 맞는 건을 억지로 넣지 않게 한다. DB 허용값에 처음부터 넣으면 나중에 DB를 다시 바꿀 일이 없다. · 나. 두지 않는다(일곱 칸 중 가장 가까운 칸에 넣기).
2. **주간보고·업무일지 칸 이름** — **가. '회의·활동 결과'(추천)**: 업무일지 하루 개편(#982)이 이미 이 이름을 쓴다. 주간보고만 '회의·행사 결과'로 남아 있어 둘을 맞춘다. · 나. '사업 보고' · 다. '회의·행사 결과' 그대로.
3. **주간보고 안에서 칸 표시** — **가. 지금처럼 날짜순, 줄 앞에 칸 이름(예: `[언론] 10.21 철도 파업 출정 기자회견`)(추천, 지금 양식을 덜 흔듦)** · 나. 칸별 작은 제목으로 묶기(회의 → 정책 → 교섭 → 언론 → 국회 → 투쟁 → 교육).
4. **메뉴 순서** — **가. PC 사이드바는 [프로젝트] 바로 아래로 옮김(추천, '프로젝트 = 사업영역별, 사업 보고 = 날짜별'을 나란히 보이게). 폰 [메뉴] 창은 지금 자리([쓰기] 다음 첫 줄) 그대로** · 나. 둘 다 지금 자리(자료실 다음) 그대로.
5. **화면 주소** — **가. 새 주소 `?view=reports`, 옛 주소 `?view=meetings`도 계속 같은 화면으로 열림(추천)** · 나. 주소는 `?view=meetings` 그대로(이름만 바꿈).
6. **[+ 추가]에 일기·공유 페이지 먼저 넣기** — **가. 먼저 넣는다(추천)**: DB가 필요 없고, 두 화면 모두 이미 [새 일기]·[새 공유 페이지] 버튼이 있어 그 버튼을 그대로 누르는 길만 더하면 된다. 사업 보고는 칸 저장(DB 1단계) 뒤에 넣는다. 근거 6.4절. · 나. 셋을 한꺼번에.
7. **캘린더 [결과 남기기]를 같은 일정에서 두 번 누르면** — **가. 같은 날·같은 제목의 사업 보고가 있으면 "이미 있어요 — [열기] [새로 만들기]"를 묻는다(추천, DB 변경 없음)** · 나. 일정 ID를 사업 보고에 저장해 항상 그 보고를 연다(DB 칸 하나 더).
8. **바구니 '사업 보고로 옮기기' 뒤의 업데이트** — **가. 업데이트는 지우지 않고 새 사업 보고에 연결해 둔다(추천)**: 바구니에서는 '분류됨'이 되고 칩에 그 사업 보고 이름이 보인다. 첨부 파일도 업데이트에 그대로 남는다. 표가 이미 허용하는 연결(업데이트 → 회의)이라 DB 변경이 없다. · 나. 옮긴 뒤 업데이트를 지운다(첨부를 사업 보고 자료로 옮기는 서버 작업 필요).
9. **'여러 곳 연결' DB를 MEET-기록보내기 B1과 합치기** — **가. 합친다(추천)**: 두 과제 모두 "회의 → 조직·프로젝트" 연결 칸(`source_meeting_id`)이 필요하다. 한 번에 만들어 DB 승인을 한 번으로 줄인다. 연결만 한 줄(요약 없음)과 고른 글을 보낸 기록(요약 있음)이 같은 줄을 쓴다(같은 곳에는 한 줄, B2 결정과 같음). · 나. 따로(같은 표를 두 번 고침).

---

## 1. 지금 회의 저장 구조 (사실)

### 1.1 회의 표 `app_meetings`

- 생성문은 이 저장소에 없다(읽생기와 공유하는 운영 DB의 초기 스키마, `supabase/local-verify/check-baseline.mjs` 18줄). 정책은 `task12a_owner_all`(소유자만, `20260925084844_task12a_sole_owner_db.sql`).
- 코드에서 확인한 열:

| 열 | 뜻 | 쓰는 곳(예) |
| --- | --- | --- |
| `id`, `workspace_id`, `created_by`, `created_at`, `updated_at` | 기본 | 전부 |
| `series_name` | 회의 이름(=회의 종류 키의 원본) | `team.js` 194줄 저장, `journal-meeting-kinds.js` |
| `title` | 짧은 이름(없으면 회의 이름과 같음) | `team.js` 194줄 |
| `round_no` | 회차 | `team.js`, `meeting-columns.js` |
| `meeting_at` | 일시(KST로 표시) | 목록·일지·주간보고 |
| `project_id` | 프로젝트 **한 곳** | `team.js` 저장, `project-system-v3.js` 342줄 읽기, 748줄 프로젝트 삭제 때 null |
| `transcript_text` | 결과 원문(지금 쓰는 결과 칸) | `meeting-round-detail.js` 28줄 |
| `notes` | 특이사항 | `team.js` |
| `decisions`, `followups`, `result_status`, `finalized_at` | 옛 AI 결과 칸·상태 | `workflow-ai-v3.js`, `page-ai-draft` Edge |
| `location` | 장소 | **추정**: `page-ai-draft` Edge(24줄)만 읽음. 화면은 쓰지도 읽지도 않음 → 9절 확인 |

- **회의 종류**는 별도 칸이 아니다. `series_name`(없으면 `title`)을 띄어쓰기 없이·소문자로 맞춘 이름이 종류 키다(`team.js` 118줄 `meetingNameKey`, `journal-meeting-kinds.js`). 기자회견·토론회도 지금은 회의 행이며 이름으로만 구분된다(`journal-data.js` 375줄 주석).
- **주간보고 회의 종류 선택**(`20261022090000_weekly_report_meeting_kinds`, 오늘 merge): `app_profiles.weekly_hidden_meeting_kinds text[]`, 기본 `궤도집행국회의`·`본부집행위`. 목록에 없는 종류는 올라간다. 권한 변경 없음(내 프로필 행 PATCH). → 이번 설계는 이 칸을 **그대로** 쓴다(종류 키 = 이름, 칸과 무관).

### 1.2 회의 자료 파일

- `app_documents.meeting_id`로 회의에 붙는다(사실: `journal-data.js` `documentLine`, `team.js` 148줄 목록의 `related`). 올리기는 Edge `meeting-files`(`team.js` 194줄, `meeting-round-detail.js` 229줄, `meeting-from-files.js` 256줄).

### 1.3 후속 할 일

- Google 할 일로 만들고, 연결 표 `app_record_links`에 `google_task_id`(출처) → `meeting_id`(도착지) 한 줄(`20260928123601_task_meeting_followup_record_links.sql`). 프로젝트가 있으면 같은 할 일 → `project_id` 줄도 더한다(`team.js` 194줄 `links:[{meeting_id},…{project_id}]`). 홈 '회의 후속' 칸이 이 줄을 읽는다(`home-read.js` 323줄).

### 1.4 연결 표 `app_record_links` (사실)

| 규칙 | 지금 |
| --- | --- |
| 출처 | `google_task_id`·`note_id` 중 정확히 하나(`app_record_links_one_source`) |
| 도착지 | `project_id`·`organization_id`·`meeting_id`·`document_id` 중 정확히 하나(`app_record_links_one_target`) |
| 중복 | `app_record_links_unique`(이름 고정 — `app_basket_confirm_links`가 `on conflict on constraint` 이름으로 씀) |
| 권한 | `record_links_owner_all`(소유자, 쓰기 때 같은 업무공간인지 확인) |

→ **회의는 도착지로만 들어갈 수 있다.** "회의 한 건을 여러 조직·프로젝트에 연결"은 지금 표로 저장할 수 없다(회의가 출처가 되어야 함). MEET-기록보내기 조사(2.2절)와 같은 결론.

### 1.5 업데이트 '여러 곳 연결' 저장 방식 (#955, 오늘 merge, 사실)

- 고르는 창: 공용 `choice-sheet.js`(체크 목록, 여러 개, 아래 'N곳 선택됨 · [취소] [저장]', 바구니 배타), 장소 목록 `update-places.js`.
- 저장: 0곳 = 바구니 업데이트, 1곳 = 그 곳 기록 1건, 2곳 이상 = 바구니 업데이트 1건 + `app_basket_confirm_links`(INVOKER, 1~20곳, 전부 아니면 전무)로 연결. 원본 1건이 각 곳 기록에 함께 보인다(`basket-link-records.js` `readLinkRecords`).
- DB·Edge 변경 없음. → 사업 보고는 **같은 창**을 쓰고, 저장은 같은 모양의 회의용 함수(4.2절)로 한다.

---

## 2. 회의를 읽는 곳 전부 (사실)

| 곳 | 파일 | 읽는 것 | 이번 설계 영향 |
| --- | --- | --- | --- |
| 회의 화면 목록·PC 3단 | `team.js` 74·92·195·196줄(`select=*`), `meeting-columns.js` | 전부 | 칸 칩 줄 추가(5절) |
| 회의 결과 창 | `meeting-round-detail.js` 144·193줄 | `select=*`, PATCH | 칸 표시·바꾸기, 연결 곳 표시 |
| 파일·글로 만들기 | `meeting-from-files.js` 232줄 | POST(칸 안 보냄) | 기본값 '회의'라 그대로 동작 |
| 프로젝트 상세 | `project-system-v3.js` 342줄(`project_id=eq`), 452줄 결정 묶음, 748줄 연결 끊기 | 이름·회차·일시 | 연결 줄(4.2절)도 읽기 |
| 담당조직 상세 | `workplace-detail.js` | **회의를 읽지 않음** | 연결된 사업 보고를 기록 목록에 새로 보임 |
| 업무일지 하루 | `journal-data.js` 228줄 `readWeekMeetings`; #982 뒤 `activityResultsOn()`·`ACTIVITY_SOURCES`(#982 브랜치 439~445줄) | 이름·회차·일시(#982는 결과 첫 줄도) | #982가 만든 함수 하나만 바꾸면 됨 |
| 주간보고(주간 정리·초안 복사·한글) | `journal-weekly.js` 187~197줄, 244줄 `LABELS.meetings='회의·행사 결과'`, 259·381줄 | 위와 같은 읽기 + 종류 선택 | 칸 이름(결정 2·3) |
| 홈 '회의 후속' | `home-read.js` 323·442줄 | 할 일 → 회의 연결, 회의 이름 | 이름 그대로(추천, 후속 할 일은 대부분 회의) |
| 바구니 연결 칩 | `basket-data.js` 54줄(`meeting:app_meetings(...)` — FK 이름 없음), 306줄, `basket.js` 444줄, `basket-notes.js` 27줄 | 회의 이름 | **DB 2단계 전에 FK 이름 지정 필수(7.3절)**, 칩 글자 '회의' → '사업 보고' |
| 할 일 편집 연결 | `google-tasks.js` 104·406줄, Edge `google-tasks` 52줄 | 할 일 → 회의 | 영향 없음(출처가 할 일) |
| 원장 보기 | `ledger-browse.js` 88줄, `ledger_schema.target_meeting_id` | 이름 | 영향 없음 |
| 챙길 것·원장 후보 출처 이름 | `todo-radar-data.js` 14줄, `ledger-candidate-model.mjs` 10줄 `meeting:'회의 결과'` | 글자 | '사업 보고'로(선택, 작은 PR) |
| 검색 | `20261022150000_search_records.sql` 151~158줄(`kind='meeting'`, `project_id=m.project_id`, 조직 없음) | 제목·결과 | 화면은 아직 없음. 연결 곳 반영은 함수 교체(DB, 8절 후속) |
| AI 요약(서버) | Edge `ai-assist/handler.ts` 622줄(`updated_at` 기준 50건, 결과 원문) | 결과 원문·이름 | 칸 이름 넣기는 Edge 배포(선택, 8절) |
| Drive 읽기용 사본 | `drive-summary.js` 18줄, Edge `drive-summary/core.mjs` 104·280줄 | 이름·회차·일시·`project_id` | 연결 곳 반영은 Edge 배포(선택) |
| 기타 Edge | `team-ai`(project_id), `page-ai-draft`, `library-files`·`meeting-files`(회의 존재·소유 확인), `meeting-ai-ingest`·`meeting-ai-draft` | — | 칸 기본값 덕에 영향 없음 |
| 주소 | `?view=meetings`(`app-router.js` 6·8줄, `view-loader.js` 31·117줄, `loader-v2.js` 150·165줄, `topbar-actions.js` 41·204·334·400줄) | — | 5.4절 |
| 메뉴 | `index.html` 57줄(사이드바), 90줄(폰 [메뉴] 창). 폰 아래 탭에는 회의 없음 | — | 이름·순서 |

---

## 3. 칸 뜻과 걸침 기준 (확정, 2026-10-22 13:07)

| 칸 | DB 값(안) | 뜻 | 예 |
| --- | --- | --- | --- |
| 회의 | `meeting` | 내부 회의 — **지금 회의 화면 전부, 기존 기록 전부** | 궤도집행국회의, 본부집행위 |
| 정책 | `policy` | 포럼·세미나·토론회 | 국회에서 연 토론회도 정책 |
| 교섭 | `negotiation` | 대정부 협의, 대사용자 교섭·협의 | |
| 언론 | `press` | 기자회견 등 | 파업 출정식 기자회견도 언론 |
| 국회 | `assembly` | 의원실 면담·입법·국정감사 등 국회 상대 | |
| 투쟁 | `struggle` | 집회·피케팅·파업 | |
| 교육 | `education` | 교육 | |
| (기타) | `other` | 결정 1이 '가'일 때만 화면에 보임 | 연대 방문, 현장 순회 |

- 한 건은 한 칸. 칸은 나중에 결과 창 ⋯ → [칸 바꾸기]로 고칠 수 있다.
- DB에는 영어 값, 화면 글자는 한 곳(`app/report-kinds.mjs` 같은 작은 모듈, 단위 시험으로 고정)에서만 바꾼다. 결정 1이 '나'여도 DB 허용값에 `other`를 넣어 둘지: **넣어 둔다(화면에서만 숨김)** — 나중에 [기타]를 켜도 DB를 다시 고치지 않는다.

---

## 4. 저장 방식

### 4.1 칸 저장: 기존 회의 표에 '칸' 열 추가 vs 새 표

| | A. `app_meetings`에 `activity_kind` 열(추천) | B. 새 표 `app_activity_reports` |
| --- | --- | --- |
| 기존 기록 | 기본값으로 모두 '회의'. 옮길 자료 없음 | 전부 복사하거나 두 표를 함께 읽어야 함 |
| 자료 파일(`app_documents.meeting_id`)·후속 할 일(`app_record_links.meeting_id`)·원장(`target_meeting_id`) | 그대로 | 새 표를 가리키는 칸을 각각 더해야 함(표 3개 DB 변경) |
| Edge(`meeting-files`·`library-files`·`meeting-ai-*`·`ai-assist`·`drive-summary`·`page-ai-draft`) | 그대로 동작(새 칸은 기본값) | 대부분 고치고 다시 배포 |
| 읽는 곳 2절 | 칸을 읽고 싶은 곳만 고침 | 전부 고침 |
| 주간보고 종류 선택 | 그대로 | 다시 연결 |
| 위험 | 이름이 '회의'인 표에 다른 활동이 들어감(코드 주석으로 설명) | 중복 구조(AGENTS.md 4절 "같은 목적의 표 먼저 찾기" 위반 소지) |

→ **A 추천.** 표 이름은 바꾸지 않는다(읽생기와 같은 DB, 바꾸면 Edge·시험·원장 전부 영향).

스케치(DB-1, 실제 파일은 착수 PR에서 사전·사후 확인과 짝 파일 5개와 함께):

```sql
alter table public.app_meetings
  add column activity_kind text not null default 'meeting';
alter table public.app_meetings
  add constraint app_meetings_activity_kind_check check (activity_kind in
    ('meeting','policy','negotiation','press','assembly','struggle','education','other'));
-- 장소 칸이 운영에 없을 때만(9절 확인): add column location text check (char_length(location) <= 200)
```

- 권한: 표 grant·정책·RLS 변경 없음. 기존 `task12a_owner_all` 그대로(소유자만 읽고 씀). 새 함수 없음.
- 경로: 확장 규칙 허용 모양(ALTER TABLE)이라 **사용자 승인형 DB workflow**(승인 한 번). 엄격·확장 규칙이 거절하면 폰 경로 C.
- 되돌리기: `drop constraint app_meetings_activity_kind_check` → `drop column activity_kind` → `schema_migrations` 한 행 삭제. 되돌리면 '회의' 아닌 칸 정보가 사라지므로 적용 뒤 칸을 고친 행이 있으면 rollback 전에 preserve SQL로 `id, activity_kind`를 백업.

### 4.2 여러 곳 연결: 연결 표에 '출처 회의' 칸 (MEET-기록보내기 B1과 합침, 결정 9)

| 선택지 | 내용 | 판단 |
| --- | --- | --- |
| **가. `app_record_links.source_meeting_id`(추천)** | 출처 = 할 일·메모·회의 중 하나. 도착지 = 조직·프로젝트 중 하나. 한 회의 → 같은 곳은 한 줄(B2) | MEET-기록보내기 B1에서 이미 사용자 결정(2026-10-18). 연결 해제·5초 되돌리기·기록 줄 모양(`basket-record-delete.js`, `basket-link-records.js`)을 재사용 |
| 나. 새 연결 표 `app_meeting_links` | 회의 전용 | 같은 목적 표 중복. B1과 따로 만들게 됨 |
| 다. `app_meetings.project_ids uuid[]` 같은 배열 칸 | FK·삭제 연쇄 없음 | 조직이 지워져도 남음, RLS 같은 업무공간 확인 불가 → 비추천 |

스케치(DB-2):

```sql
alter table public.app_record_links
  add column source_meeting_id uuid references public.app_meetings(id) on delete cascade;
-- 출처 규칙: 새 제약 먼저 → 옛 제약 삭제 → 같은 이름으로 바꾸기(기존 방식)
check (num_nonnulls(google_task_id, note_id, source_meeting_id) = 1)
-- 중복 규칙에 source_meeting_id 추가, 이름은 app_record_links_unique 그대로(RPC가 이름으로 씀)
-- 회의 출처 줄 모양: 도착지는 조직·프로젝트만. 요약(summary)은 비어도 됨(= '연결만'), 있으면 '보낸 기록'(MEET-기록보내기)
check (source_meeting_id is null or (meeting_id is null and document_id is null
       and num_nonnulls(project_id, organization_id) = 1))
-- 같은 업무공간 확인: 기존 정책을 고치지 않고 '좁히기 전용'(restrictive) 정책 하나를 더함
create policy record_links_source_meeting_ws on public.app_record_links as restrictive
  for all to authenticated
  using (true) with check (source_meeting_id is null
    or private.app_meeting_in_workspace(source_meeting_id, workspace_id));
-- 저장 함수: 고른 곳 목록을 '그대로 맞추기'(더하기·빼기 한 번에)
create function public.app_meeting_set_links(p_meeting_id uuid, p_meeting_updated_at timestamptz, p_targets jsonb)
  returns ... language plpgsql security invoker set search_path = '' ...
-- revoke all ... from public, anon, service_role; grant execute ... to authenticated
```

- MEET-기록보내기 조사 문서 2.3절 스케치와 다른 점 두 가지: ① 회의 출처 줄의 요약을 **필수에서 선택으로**(연결만 하는 줄이 생기므로) ② RLS를 `alter policy`(확장 규칙 `policy-drop-alter` 거절) 대신 **restrictive 정책 추가**(확장 규칙 허용, 좁히기만 함). `using (true)`가 확장 규칙 `policy-true`에 걸리면 `using (source_meeting_id is null or private.app_meeting_in_workspace(...))`로 같은 식을 쓴다 — 착수 때 `tests/security/db-migration-expanded.test.mjs`로 확인.
- `app_meeting_set_links` 규칙(`app_basket_confirm_links`와 같은 모양): INVOKER, 소유자 RLS를 따름, 0~20곳, 회의 버전(`updated_at`)이 다르면 거절, 프로젝트는 고를 수 있는 것(v2·보관 안 됨)만, 전부 아니면 전무. 목록에서 빠진 곳의 줄은 지운다 — 그 줄에 요약(보낸 기록)이 있으면 화면이 먼저 "보낸 기록도 지워져요"를 묻는다.
- `app_meetings.project_id`: **지우지 않고 '첫 프로젝트'로 함께 맞춘다**(같은 함수 안, 한 번에). 이 칸을 읽는 곳(프로젝트 상세·`team-ai`·`drive-summary`·검색 함수)이 단계적으로 연결 줄을 읽게 바뀐 뒤, 칸 정리(Contract)는 별도 과제로 제안만 한다(`docs/web2-expand-deploy-verify-contract.md` 순서).
- 기존 `project_id`가 있는 회의: DB-2 안에서 같은 곳으로 연결 줄을 한 번 채운다(`insert … select … where project_id is not null on conflict do nothing`). 되돌리기 때 이 줄들도 지워지지만 `project_id`는 그대로라 잃는 것이 없다.
- 경로: 확장 규칙이 받으면 workflow(승인 한 번), 거절하면 폰 경로 C(SQL Editor). rollback의 `drop policy`는 rollback 허용 목록에 없으므로 **rollback은 SQL Editor 경로로 준비**한다.
- 되돌리기 순서: ① preserve로 `source_meeting_id`가 있는 줄 백업 ② `drop function public.app_meeting_set_links(uuid,timestamptz,jsonb)` ③ `drop policy record_links_source_meeting_ws` ④ 회의 출처 줄 삭제 ⑤ 출처·중복 제약을 옛 모양으로(같은 이름) ⑥ `drop column source_meeting_id` ⑦ `schema_migrations` 한 행 삭제.

---

## 5. 화면

### 5.1 폰(390)

```
┌────────────────────────────┐
│ 사업 보고               [+]│
│ 프로젝트 = 사업영역별 진행상황,│
│ 사업 보고 = 날짜별 활동 결과  │
│ ◀[전체][회의][정책][교섭][언론]▶│  ← 가로로 미는 칩 한 줄
├────────────────────────────┤
│ ● 철도 파업 출정 기자회견     │
│   언론 · 10.21(화) 10:00     │
│   국회 소통관 · 회의자료 있음 │
│ ● 궤도집행국회의 12차         │
│   회의 · 10.20(월) 14:00     │
└────────────────────────────┘
```

- 칩 줄은 지금 공용 `filter-chips.js`(가로 스크롤 칩)를 쓴다. 회의 종류 칩(`#meetingTypeFilter`)은 [회의] 칩일 때만 그 아래에 그대로 나온다(종류는 회의 칸 안의 세부).
- [+]를 누르면 먼저 칸 고르기(아래 창, 8칸 버튼) → 고른 칸이 채워진 입력 창. [전체]가 아닌 칩에서 [+]를 누르면 그 칸이 바로 채워진다.

### 5.2 PC(1280)

```
┌ 사업 보고 ───────────────────────────────────────────────────────┐
│ 프로젝트 = 사업영역별 진행상황, 사업 보고 = 날짜별 활동 결과       [+ 추가]│
│ [전체] [회의] [정책] [교섭] [언론] [국회] [투쟁] [교육] [기타]          │
├──────────────┬──────────────┬─────────────────────────────────────┤
│ 회의 종류     │ 차수·날짜     │ 고른 건의 결과(읽기)                   │
│ (회의 칸일 때) │              │ 칸: 언론 · 일시 · 장소                 │
│ — 다른 칸은   │              │ 연결: 철도노조, 2인1조 프로젝트 외 1    │
│ 이 단이 접히고 │              │ 결과 요약 …                           │
│ 날짜 목록만    │              │ 자료 파일 · 후속 할 일                  │
└──────────────┴──────────────┴─────────────────────────────────────┘
```

- [회의] 칩: 지금 PC 3단(MEET-결과3단 #879) 그대로. 다른 칸·[전체]: 왼쪽 종류 단을 접고 '날짜·제목 목록 | 결과' 2단(UI-좌우비율 1/3:2/3, `split-resize.js` 재사용).
- 한 영역 한 그리기 주인: `team.js` `renderMeetings` 하나가 칩 값을 받아 그린다(새 그리기 주인을 만들지 않음, ARCHITECTURE 5절).

### 5.3 입력 창(일곱 칸 공통)

| 칸 | 저장 | 비고 |
| --- | --- | --- |
| 칸 | `activity_kind` | 창 맨 위 칩, 바꿀 수 있음 |
| 이름 | `series_name`(+짧은 이름 `title`) | 지금 회의명 고르기 그대로. 이름이 주간보고 종류 키 |
| 회차 | `round_no` | [회의] 칸에서만 보임(다른 칸은 접힘, 값 있으면 보임) |
| 일시 | `meeting_at` | 공용 `time-input.js` |
| 장소 | `location` | 9절 확인 뒤(없으면 DB-1에 칸 추가) |
| 결과 요약 | `transcript_text` | 지금 '결과 원문' 칸. 필수 규칙 그대로 |
| 자료 파일 | `app_documents.meeting_id`(Edge `meeting-files`) | 그대로 |
| 후속 할 일 | Google 할 일 + 연결 줄 | 그대로 |
| 연결할 곳(선택) | 4.2절 연결 줄 + `project_id` | [연결할 곳 ▾] → 업데이트 '기록할 곳 선택' 창(`choice-sheet.js`, 체크 목록·여러 개·오른쪽 아래 [저장]) 재사용. 바구니 칸은 숨김 |

### 5.4 이름·주소

- 메뉴·화면 제목·위치 표시(`index.html` 57·90줄, `topbar-actions.js` 204·400줄 `VIEW_NAMES`): '회의' → '사업 보고'.
- 내부 화면 이름(`meetings`, `#meetingsView`, `newMeetingBtn`)은 **그대로** 둔다(로더·시험 수십 곳, 바꿀 이득 없음).
- 결정 5가 '가'이면: `app-router.js` `VIEW_ALIAS`에 `reports:'meetings'`를 더하고(기존 `'hwp-lab':'hwp'`와 같은 방식), 주소를 쓰는 `syncUrl`이 `meetings`일 때 `reports`로 적는다. 옛 `?view=meetings`는 그대로 열린다(테스트 그대로 통과). 칩은 `&kind=press`처럼 주소에 남겨 뒤로가기·새로고침에 유지. 외부에서 `?view=meetings`를 거는 곳은 저장소에 없음(사실: Edge·manifest 검색).

### 5.5 연결한 곳 화면에 보이기

- 담당조직 상세(`workplace-detail.js`)·프로젝트 상세(`project-system-v3.js` `recordItems`)의 기록 목록에 연결된 사업 보고 줄을 시간순으로 함께 넣는다. 줄 모양은 바구니 연결 줄(`linkRecordHtml`)과 같고 표시만 '[언론] 사업 보고'. 누르면 사업 보고 결과(폰은 창, PC는 화면 이동 — #982의 '누르면 원본'과 같은 길).
- 읽기: `app_record_links?source_meeting_id=not.is.null&organization_id=eq.…&select=…,report:app_meetings!<source FK 이름>(id,title,series_name,round_no,meeting_at,activity_kind)`. FK 이름을 반드시 지정(7.3절).

---

## 6. 들어오는 길

### 6.1 캘린더 일정 → [결과 남기기]

- 일정을 누르면 열리는 창은 `calendar-interactions-v2.js`의 `#ciGoogleModal`(사실, 61줄). 이 창 아래 버튼 줄에 [결과 남기기]를 더한다. 홈 '오늘 일정' 줄 ⋯에도 같은 버튼(선택).
- 누르면: 사업 보고 화면 준비(`KPTUViewLoader.prepare('meetings')`) → 칸 고르기 → 입력 창(이름 = 일정 제목, 일시 = 일정 시작, 장소 = 일정 장소). 저장은 지금 회의 저장 그대로.
- 대상: 결정에 따라 공공운수노조 캘린더 일정만 버튼을 보일지, 모든 캘린더에 보일지 → **모든 캘린더에 보임**(구분 비용만 늘고 막을 이유 없음, 기술 판단).
- 중복: 결정 7.

### 6.2 바구니 업데이트 ⋯ → '사업 보고로 옮기기'

- ⋯ 목록은 `basket.js` 104~111줄(수정·연결하기·할 일 만들기·노트로 옮기기 …). [노트로 옮기기] 다음에 넣는다.
- 누르면: 칸 고르기 → 입력 창(일시 = 업데이트 `occurred_at`, 결과 요약 = 업데이트 글). 저장 성공 뒤 업데이트 → 회의 도착지 연결 한 줄을 만든다(결정 8 '가'). 첨부 파일은 업데이트에 남는다. 연결 실패 시 "사업 보고는 저장했지만 업데이트와 잇지 못했어요" 안내(사업 보고는 지우지 않음).
- **사실**: `app_basket_confirm_links`는 조직·프로젝트 도착지만 받는다(`20261012100000_basket_link_view_db.sql` 203·225줄, `meeting_id is null` 조건). 업데이트 → 회의 줄은 표 제약·RLS가 이미 허용하지만(`20261010120000_basket1_notes_links.sql` 67·85줄) **지금 앱에서 그 줄을 쓰는 곳은 없다**(바구니는 읽기·칩 표시만). 그래서 이 연결은 ① 소유자 RLS 아래 REST `insert` 한 줄(새 DB 변경 없음, 같은 업무공간 확인은 기존 정책이 함) 또는 ② DB-2의 `app_meeting_set_links` 안에서 함께 처리 중 하나로 한다. **①을 추천**(7단계가 DB-2를 기다리지 않음).

### 6.3 상단 [+ 추가]

- 지금 `topbar-actions.js` 432줄 `ADD_ITEMS=[업데이트, 할 일, 노트, 일정]`, 일정은 그 화면의 기존 버튼을 누르는 방식(`openEventWindow`).
- 더할 것: 일기(`diary.js` `[data-diary-new]` → 오늘 일기 쓰기), 공유 페이지(`share-pages.js` `[data-sp-new]`), 사업 보고(`#newMeetingBtn` → 칸 고르기).

### 6.4 일기·공유 페이지를 먼저 넣어도 되나 (판단: 된다)

- 사실: 두 화면 모두 새로 만들기 버튼이 이미 있고(`diary.js` 389줄, `share-pages.js` 62줄), [+ 추가]의 일정과 같은 방식(화면 불러오기 → 기존 버튼 누르기)으로 새 저장 경로 없이 붙는다.
- 사업 보고와 겹치는 파일은 `topbar-actions.js` 한 줄(`ADD_ITEMS`)뿐이라, 나중에 사업 보고 한 줄을 더하는 PR과 충돌이 작다.
- 주의: 일기는 PC·폰 모두 일기 화면으로 이동한 뒤 쓰기 창이 열린다(쓰기 창이 화면 안에 있음). 공유 페이지도 화면 이동. 그래서 메뉴를 닫고 화면을 바꾸는 순서를 지킨다(라우터 `go` 뒤 버튼).

---

## 7. 영향과 권한

### 7.1 주간보고·업무일지

- 업무일지 하루(#982 merge 뒤): `ACTIVITY_SOURCES`·`activityResultsOn()` 하나만 바꿔 줄에 칸 이름을 붙인다. 칸 이름은 결정 2.
- 주간보고: `journal-weekly.js` `LABELS.meetings`·259·381줄 제목, 줄 모양(결정 3). 초안 복사·한글 파일(`journal-hwpx.js`)은 같은 모델을 쓰므로 같이 바뀐다.
- 정기 내부 회의 빼기(`weekly_hidden_meeting_kinds`): 종류 키 = 이름이라 칸과 무관하게 그대로 이어진다. 다른 칸 건도 이름이 목록에 있으면 빠진다(지금과 같음).
- 기존 회의 기록은 기본값으로 모두 [회의].

### 7.2 검색·AI·Drive 사본

- 검색(`app_search_records`): 종류 'meeting'은 화면 글자만 '사업 보고'로. 연결 곳(조직·프로젝트) 반영은 함수 교체(DB)라 SEARCH 화면 단계에서 함께 제안(이 과제 밖).
- AI 요약(`ai-assist`): 지금도 결과 원문을 읽는다. 칸 이름을 붙이면 AI가 기자회견·회의를 구분하기 쉬움 → 선택 단계(Edge 배포 정지 지점).
- Drive 사본(`drive-summary`): `project_id` 기준이라 DB-2 뒤에도 '첫 프로젝트'는 맞다. 여러 곳 반영은 선택 단계(Edge 배포).

### 7.3 꼭 지킬 순서 — 바구니 목록 오류 막기

- DB-2로 연결 표에서 `app_meetings`로 가는 길이 둘(`meeting_id`, `source_meeting_id`)이 되면, 이름 없이 `meeting:app_meetings(...)`로 읽는 `basket-data.js` 54줄이 PostgREST 모호성 오류(PGRST201)로 실패하고 **바구니 목록 전체가 멈춘다**(MEET-기록보내기 조사 위험 1과 같음). 저장소 전체에서 이 모양은 이 한 곳뿐(사실, 검색).
- 그래서 **2단계(화면, FK 이름 지정)를 merge·배포·확인한 뒤** DB-2를 적용한다(Expand → Deploy → Verify).

### 7.4 권한

- 소유자 전용 유지. 새 표 없음. anon·PUBLIC 권한 없음. RLS 끄기·기존 정책 교체 없음(DB-2는 좁히기 전용 정책 추가만). 새 함수는 INVOKER·`search_path=''`·authenticated만.
- 화면 칸 고르기·연결 고르기는 편의일 뿐이고, 같은 업무공간 확인은 DB(정책·함수)가 한다.
- Web1 공개 경로와 무관. 읽생기 `rtw_*` 건드리지 않음.

---

## 8. 단계별 PR

| 단계 | 내용 | DB·Edge | 선행 | 표시 |
| --- | --- | --- | --- | --- |
| 1 | [+ 추가]에 일기·공유 페이지(6.3·6.4) | 없음 | 없음(지금 가능) | 📱 폰 가능 |
| 2 | 이름 '사업 보고'·첫머리 한 줄·메뉴 순서(결정 4)·주소(결정 5)·칩 글자 '회의'→'사업 보고'(바구니·챙길 것·원장 후보) + **`basket-data.js` 54줄 FK 이름 지정**(7.3) + 화면이 `activity_kind`·연결 줄이 없어도 동작(없으면 '회의', 빈 목록) | 없음 | 없음 | 📱 폰 가능. **DB-2 전 merge·배포 필수** |
| 3 | **DB-1** `app_meetings.activity_kind`(+장소 칸 필요 시) + 짝 파일 5개(`docs/<ver>_<name>.precheck/snapshot/postcheck/rollback.sql`·`.summary.md`) | **있음, 적용 직전 정지** | 2 | 📱 폰 경로 C(또는 승인형 workflow) |
| 4 | 칸 칩 줄(폰 가로·PC 한 줄), 입력 창 칸 고르기·[+]의 칸 고르기 단계, 결과 창 칸 표시·[칸 바꾸기], PC [전체]·다른 칸 2단 | 없음 | 3 적용 | 📱 폰 가능 |
| 5 | **DB-2** `source_meeting_id` + 제약 + 좁히기 정책 + `app_meeting_set_links` + 기존 `project_id` 연결 줄 채우기 + 짝 파일 5개 + preserve. MEET-기록보내기 B1과 합침(결정 9) | **있음, 적용 직전 정지** | 2 배포 확인 | 📱 폰 경로 C |
| 6 | 입력 창 [연결할 곳] → 기록할 곳 선택 창 재사용, 저장 = 새 함수, 조직·프로젝트 상세에 연결된 사업 보고 줄, 연결 해제·5초 되돌리기(회의 갈래) | 없음 | 5 적용 | 📱 폰 가능 |
| 7 | 캘린더 [결과 남기기](6.1·결정 7), 바구니 ⋯ '사업 보고로 옮기기'(6.2·결정 8), [+ 추가] 사업 보고 | 없음 | 4 | 📱 폰 가능 |
| 8 | 업무일지·주간보고 칸 이름(결정 2)·칸 표시(결정 3) | 없음 | 4, #982 merge | 📱 폰 가능 |
| 9(선택) | AI 요약·Drive 사본에 칸·연결 곳 반영 | **Edge 배포 정지** | 6 | 📱 폰 경로(승인형 Edge workflow) |

- MEET-기록보내기 4단계([기록으로 보내기])는 5단계 뒤 같은 함수·같은 줄을 쓴다(요약 칸에 고른 글).
- 같은 파일 충돌: `team.js`(4·6·7), `journal-*.js`(8, #982와), `topbar-actions.js`(1·2·7). 4·6·7은 순서대로(줄 세우기), 8은 #982 merge 뒤.

### 8.1 단계별 E2E

| 단계 | 시험(390·1280) |
| --- | --- |
| 1 | [+ 추가] → 일기 → 일기 화면·오늘 쓰기 창 열림 / 공유 페이지 → 새 공유 페이지 편집 열림 / 메뉴 키보드 이동·Esc 닫기 / 뒤로가기 한 번에 이전 화면 |
| 2 | 사이드바·폰 [메뉴]에 '사업 보고'(순서 결정 4) / 첫머리 한 줄 보임 / `?view=meetings`·`?view=reports` 모두 같은 화면 / 주소 갱신 / 바구니 목록이 회의 연결 칩과 함께 열림(FK 이름 지정, 모의 응답이 모호성 오류를 흉내 내도 목록이 뜸) / 칩 글자 '사업 보고' / `activity_kind` 없는 응답에서도 목록 정상 |
| 3 | DB: precheck·postcheck·rollback SQL을 로컬 DB(`supabase/local-verify`)로 실행, 기존 행 모두 'meeting', 허용값 밖 거절, 다른 업무공간 거절(기존 owner RLS) |
| 4 | 칩 줄: 폰 가로 스크롤·가로 페이지 스크롤 없음, PC 한 줄 / 칩별 목록 거르기 / [회의]만 회의 종류 칩 / [+] → 칸 고르기 → 칸 채워진 창, 칩에서 [+] → 칸 자동 / 저장 요청 본문에 `activity_kind` / [칸 바꾸기] PATCH / PC [회의] 3단·다른 칸 2단 |
| 5 | DB: 출처 셋 중 하나·도착지 조직/프로젝트만·같은 곳 한 줄·다른 업무공간 회의 거절·20곳 넘으면 거절·버전 다르면 거절·빠진 곳 삭제·`project_id`=첫 프로젝트·기존 `project_id` 연결 줄 생김·`app_basket_confirm_links` 그대로 동작(이름 고정 제약)·rollback 뒤 원상 |
| 6 | [연결할 곳] 창이 기록할 곳 선택 창과 같은 모양(체크·여러 개·오른쪽 아래 [저장]·바구니 없음) / 저장 뒤 조직·프로젝트 상세에 줄 / 누르면 사업 보고 열림·뒤로 한 번 / 해제·5초 되돌리기 / 보낸 기록 있는 곳 빼면 확인 창 |
| 7 | 일정 창 [결과 남기기] → 칸 고르기 → 제목·날짜·장소 채움 / 같은 날·같은 제목 있으면 묻기 / 바구니 ⋯ '사업 보고로 옮기기' → 날짜·글 채움 → 저장 뒤 업데이트에 칩·분류됨 / 연결 실패 안내 / [+ 추가] 사업 보고 |
| 8 | 업무일지 하루·주간 정리·초안 복사·한글 파일에 칸 이름·새 제목 / 정기 내부 회의 빼기 그대로 / 빈 주 문구 |

---

## 9. 착수 때 read-only로 먼저 확인할 것 (미확인)

- `app_meetings` 실제 열 목록(특히 `location` 유무·형식), `updated_at` 기본값·트리거 유무.
- `app_record_links`에서 `app_meetings`로 가는 FK 실제 이름(2단계 FK 이름 지정용).
- 업데이트 → 회의 도착지 줄(`note_id`+`meeting_id`)이 운영 정책에서 실제로 insert되는지(저장소 정책상 허용, 6.2절).
- `app_meetings` 행 수, `project_id` 있는 행 수(DB-2 연결 줄 채우기 수), `app_record_links` 행 수(snapshot 기준).
- MEET-기록보내기 B1 migration이 그 사이 따로 진행되지 않았는지(결정 9).

## 10. 범위 밖 발견사항 (고치지 않음)

- 주간보고 제목 '회의·행사 결과'와 업무일지 하루(#982) '회의·활동 결과'가 서로 다르다 → 결정 2로 맞춤 제안.
- `page-ai-draft` Edge만 `location`·`followups` 등 옛 칸을 읽는다. 앱에서 이 함수를 부르는지 별도 확인 필요(옛 경로 정리 후보).
- 담당조직 상세는 지금 회의를 전혀 보여 주지 않는다(조직에 회의를 이을 칸이 없음). 이번 6단계가 처음으로 보여 준다.
