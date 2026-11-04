# 주간보고 메뉴 짝짓기 설계 (WEEKLY-메뉴짝짓기 + DESK-주별표 ②~⑮)

📱 폰 가능. 이 문서는 설계·시안만 한다. 앱 코드·DB·Edge·권한 변경 없음.

- 작성: 2026-11-04, Claude Code 웹(작업 세션 S49-41). 기준 main `9016457`.
- 요청: 요청함 11/04 16:48(WEEKLY-메뉴짝짓기, 명진 결정 16:50 = B), 16:53(DESK-주별표·펼치기, 덧붙임 16:54, 명진 결정 16:58), 16:38(WEEKLY-요약표수기·내부회의빼기, 결정 16:45).
- 시안: [weekly-menu-mockup.html](weekly-menu-mockup.html) — 혼자 열리는 HTML. 폰 412px·PC 1440px, 밝은/어두운. 세 화면: 담당조직 '이번 주 조직보고', 사업 보고 '이번 주 주간보고', 홈 [주간 정리].
- 앞 설계: [weekly-one-flow.md](weekly-one-flow.md)(주간 정리 = 주간보고 한 흐름, draft 한 벌), [weekly-hwpx-draft.md](weekly-hwpx-draft.md)(양식 칸), [weekly-draft-feedback.md](weekly-draft-feedback.md)(임시저장·환류), [project-into-report.md](project-into-report.md)(사업영역 요약), [org-dispute-stage.md](org-dispute-stage.md).
- 같은 시간에 도는 작업: S49-39(사업요약표 수기·내부회의 빼기, 코드), S49-40(담당조직 [전체 표] 오름차순·시작~끝 날짜·펼치기, 코드·DB). 이 문서를 쓸 때 두 PR은 아직 열리지 않았다 → 그 둘이 정할 저장 자리는 **[추정]**으로 적고, 바뀌면 9절 '그 PR 뒤 바꿀 것'대로 이 문서를 고친다.
- 표기: **[사실]** 코드·migration에서 확인(파일 위치) / **[결정]** 이 문서가 정함 / **[추정]**. 웹 세션이라 운영 DB는 보지 않았다. 예시는 모두 가짜("A 지부", "가상 교섭").

---

## 0. 한 줄 요약

메뉴 하나 = 주간보고 칸 하나. **담당조직 = 조직보고**, **사업 보고 = 사업요약표·주요 사업·회의결과**, **홈 [주간 정리] = 요청사항·주요 일정 쓰기 + 전체 모아 보기·고치기 + 한글 파일**. 칸마다 저장 자리는 하나이고, 두 화면은 같은 부품으로 같은 자리를 읽고 쓴다(결정 B). 조직보고만 **새 표 1개**(주 × 조직 × 줄, `app_weekly_org_lines`)를 두고, 나머지는 이미 있는 그 주 한 행(`app_weekly_exec_requests.draft`)을 그대로 쓴다. 새 주는 빈 표, 기록·업데이트를 저장하면 그 자리에서 흐린 '제안' 줄이 올라오고, 명진이 [✓ 넣기]한 줄만 주간보고에 들어간다. 금요일 [주간 정리]에서는 비었거나 1줄 이하인 조직에 지난주 줄을 흐리게 보여 [가져오기].

---

## 1. 지금 따로 도는 길 (사실)

| 길 | 화면·파일 | 읽는 재료 | 저장 자리 | AI |
| --- | --- | --- | --- | --- |
| ① 사업요약표 미리보기 | 사업 보고 ⋯ [사업요약표 미리보기] 팝업 `app/report-summary-preview.js`(부르는 곳 `app/team.js` 433행) | `app_meetings`(team.js 93행) → `business-area-model.mjs` `previewRecords` | `app_weekly_exec_requests.draft.area_summaries`(`weekly-draft-store.js` `changeWeekAreaSummary`) | `ai-assist` `area_week_summary`(report-summary-preview.js 92행, 서버 `ai-assist/business-area.ts`) — **S49-39가 삭제** |
| ② 그 HWP | 같은 팝업 [HWP로 내려받기] | 자체 파일 없음 — `journal.js` `showWeek(day,{hwpx:true})`(1652행)로 ④를 연다 | ④와 같음 | ④와 같음 |
| ③ 홈 [주간 정리] | `app/journal.js`(주인) → `journal-weekly.js` `renderWeekly`, 칸 부품 `weekly-flow-cells.js`·`weekly-exec-requests.js`·`weekly-hq-schedule.js`·`weekly-discuss-table.js`·`weekly-detail-lines.js`·`weekly-hand-lines.js`·`journal-org-summary.js` | 정리함 `app_notes`+`app_record_links`, `app_project_progress_updates`, `app_meetings`, `app_suborganization_updates`, 달력(Edge `google-calendar`) | 그 주 한 행 `app_weekly_exec_requests`(`items` + `draft` 칸들), 4.1) 조직 요약만 따로 `app_weekly_org_summaries` | `org_summary`, `weekly_line`, `overlap_check`, `work_scope` |
| ④ 주간 정리 HWP | `app/journal-hwpx.js` `mountWeeklyHwpx`, 엔진 `app/weekly-hwpx/*` | ③과 같은 재료 + 지난 개인본 파일 + `app_org_status_rows`(3.2) 투쟁 사업장 칸, journal-hwpx.js 71·170행) | `draft.rows`(summary·orgs·sites 칸 글), [확정] = 자료실 개인본(`library-files`) | `weekly_draft`, `weekly_review` |
| ⑤ 업무일지 '주간' | `journal.js` mode=`week` → `setMode`(611행) → ③과 **같은 화면** | ③과 같음 | ③과 같음 | — |
| ⑥ 담당조직 [전체 표] | `app/org-overview.js`(칸: 조직 \| 쟁의 단계 \| 최근 주요 일정·현황) | `app_org_status_rows`(조직 상세 [현황 표]와 같은 표, 주 구분 없음) | `app_org_status_rows`(migration `20261030234000`) | `org_status_rows`([AI로 채우기]·[모두 다시 채우기 (AI)], `org-status-table.js` 184행) |

- [사실] ③·④·⑤는 이미 한 행(`draft`)을 같이 쓴다(weekly-one-flow.md 2절). 따로 노는 것은 **①(사업 보고 팝업이 자기 재료·자기 AI 칸 `area_summaries`)**와 **⑥(주 구분 없는 현황 줄)**, 그리고 **4.1) 조직 요약이 `draft.rows.orgs`와 `app_weekly_org_summaries` 두 군데**인 점이다.
- [사실] 내부 정례 회의 빼기: 고정 목록 `app/weekly-major-schedule.mjs` `INTERNAL_MEETINGS`(23행)·`isInternalMeeting`, 사람별 빼기 `app_profiles.weekly_hidden_meeting_kinds`(`journal-meeting-kinds.js`). ③은 `reportsMeeting`으로 빼지만 ①은 따로 읽어서 빠졌다 → S49-39가 한 목록을 모든 길에서 읽게 고친다. (S49-39 #1866 뒤 [사실]: ①·③ 모두 `journal-meeting-kinds.js` `reportsMeeting` 한 곳을 부른다.)
- [사실] 화면 사이 갱신: Supabase Realtime·BroadcastChannel 없음. 같은 탭 안 `window` CustomEvent(`kptu:org-status-changed`, `kptu:suborganization-updated`, `kptu:basket-links-changed`, `kptu:weekly-picks-changed`, `kptu:api-saved` 등)뿐이고, 다른 기기와는 조건부 쓰기(충돌 검출)로 맞춘다.
- [사실] 조직 순서: 앱 순서는 `app/organization-order.js` 고정 목록. 주간보고 '개인본 순서'는 따로 저장하지 않고 지난 개인본 파일이 바탕인데, `weekly-hwpx/delta.mjs` `reportOrgOrder`(80~85행)는 주석과 달리 가나다순으로 정렬한다 → 10절 범위 밖 발견.

---

## 2. 주간보고 칸 ↔ 메뉴 ↔ 저장 자리 (칸마다 저장 자리 하나)

명진 주간보고 구성 순서 그대로 적는다. 오른쪽 '양식 칸'은 한글 양식(weekly-hwpx-draft.md 1.3절)의 어느 자리인지다.

| # | 명진 구성 | 양식 칸 | 쓰는 메뉴(주인) | 같이 고치는 곳(B) | 저장 자리(유일) | 재료·제안 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 사업요약표 업데이트 | 2. 1) 요약 표(사업영역 \| 세부 과제 \| 진행 상황 및 이후 계획 \| 담당) | **사업 보고** '이번 주 주간보고' | 홈 [주간 정리] 2.1) | 진행 = `draft.rows`(section `summary`, 칸 이름 `사업영역›세부 과제`), 담당 = `draft.owners`(`{칸 이름: 한 줄}`) [사실 — S49-39 #1866, `weekly-summary-hand.mjs`·`weekly-draft-store.js` `changeWeekSummaryText`·`withOwnerEdit`] | 수기만. 그 주 사업 보고 제목(사실 기록)을 칸 아래 흐린 참고 줄로. **AI 제안 없음**(16:45 결정) |
| 2 | 그 주 주요 사업 | 2. 2) 세부 내용 중 회의가 아닌 활동(토론회·기자회견·집회 결과) + 3. 1) 집회·농성 등 [추정 — 명진 확인 ②] | **사업 보고** | 홈 [주간 정리] | 사업 보고 기록 자체(`app_meetings` — 원본) + 줄 고침·빼기 `draft.hand`(`details_edits`) [사실: weekly-detail-lines.js] | 그 주 사업 보고 기록 |
| 3 | 주요 회의결과 | 2. 2) 세부 내용 중 회의 결과 상자 | **사업 보고** | 홈 [주간 정리] | 위와 같음(`app_meetings` + `draft.hand`) | 내부 정례 회의는 모든 길에서 조용히 뺌(목록 하나, S49-39) |
| 4 | 조직보고 | 4. 산하조직 현황 1) 요약(사업장 \| 조직현황) — 내 담당 조직 전부, 개인본 순서, 빈칸 자리 유지, 조직당 3줄 이내 [추정 — 명진 확인 ①] | **담당조직** '이번 주 조직보고'([전체 표]) | 홈 [주간 정리] 4. | **새 표 `app_weekly_org_lines`**(주 × 조직 × 줄, 5절) | 그 주 담당조직 기록·조직에 이어진 업데이트 → 실시간 '제안' 줄 |
| 5 | 조직보고 상세 | 3. 2) 투쟁 사업장 현황(조직명 \| 현황) = 투쟁 중인 조직의 쟁의 단계 줄 + 그 조직의 같은 주 조직보고 줄, 4. 2) 참고자료 상자 [추정 — 명진 확인 ①] | **담당조직** 조직 상세 | 홈 [주간 정리] 3.·4.2) | 단계 = `app_suborganization_dispute_stages`(원본), 줄 = 4번과 **같은 `app_weekly_org_lines`**(따로 쓰지 않음), 참고자료 = `draft.hand` | 4번과 같은 줄을 그대로 씀 |
| 6 | 주요 일정 | 1. 2) 주요 일정 + 5. 주요 일정 | **홈 [주간 정리]** | — | 달력(원본) + `draft.picks`(고르기)·`draft.hq`(수기 줄)·`draft.titles`·`dropped`·`kept` [사실] | 그 주·다음 주 달력에서 연대가 필요한 투쟁만 제안(11/02 기준: 회의 빼고 파업·집중 선전전·총력투쟁 결의대회·조합원 총회 투쟁) + 수기 |
| (앞) | 요청사항 | 1. 1) 임원 배정 요청, 1. 3) 상집 논의 요청 | **홈 [주간 정리]**(보통 금요일) | — | `items`(임원 배정 요청, 수기), `draft.discuss` [사실] | 수기 |

- [결정] 메뉴는 그 칸의 **주인**(평소에 쓰는 곳)이고, 홈 [주간 정리]는 **모든 칸을 모아 보고 그 자리에서 고치는 곳**이다. 두 곳이 같은 부품을 쓰므로 모양·동작이 같다(16:50 결정 B).
- [결정] 4번 조직보고와 5번 조직보고 상세의 줄은 같은 표 한 벌에서 나온다. 3. 2) 투쟁 사업장 칸에 따로 쓰지 않는다(지금도 '한 곳 고치면 두 곳 같음' 원칙, migration `20261030234000` 머리 주석).
- [결정] 담당 팀원 이름·■ 일시(`draft.me`·`date`)는 홈 [주간 정리] 맨 위 한 줄 그대로.

### 2.1 조직 상세 [현황 표]와 주별 표의 관계 (DESK ⑥)

[결정] 조직 상세 [현황 표](`app_org_status_rows`)는 **오래 쌓이는 그 조직의 사건 기록**으로 남기고, 주별 표는 **그 주 주간보고에 낸 줄**이다. 주별 표에서 더한 줄은 [현황 표]에 저절로 들어가지 않는다(두 벌로 저절로 복사하면 고친 값이 어긋남). 대신 [현황 표]에 새로 넣은 줄도 그 주 주별 표의 '제안' 재료가 된다(이미 짧으므로 AI 없이 그대로 제안).

---

## 3. 화면 세 곳 (시안과 같은 이름)

### 3.1 담당조직 '이번 주 조직보고' ([전체 표]가 바뀜)

- 표 위 한 줄: 주 고르기 `[‹ 11.2~11.8 ›]`(홈 [주간 정리]와 같은 부품 `week-pick`, 같은 주 기준 = 월~일).
- 칸: 조직 \| 쟁의 단계 \| 이번 주 조직보고. 조직 자리는 개인본 순서로 늘 그대로(내용 없으면 빈칸).
- 조직 칸 안 순서: ① 넣은 줄(진한 글, 날짜 오름차순 `- 11.2.` / `- 11.2.~11.5.`) ② 제안 줄(흐린 글 + `[✓ 넣기] [고치기] [×]`, 끝에 작은 'AI' — AI가 줄인 줄만) ③ `[+ 줄]` 한 자리.
- 넣은 줄이 3줄을 넘으면 조직 이름 옆에 작게 '주간보고 3줄 넘음'(자르지 않음). 3줄 넘는 칸은 가장 최근 3줄 + 그 앞 줄을 접은 `외 n줄 ▾`(S49-40 `splitRows` 펼치기 부품 그대로, 펼친 줄도 바로 고치기·빼기).
- 줄을 누르면 그 자리에서 글 칸(Ctrl+Enter 저장, Esc 취소). 줄 ⋯ = [원래 기록 열기]·[빼기].
- 지난 주를 고르면 그때 낸 줄이 그대로 보인다(고칠 수 있지만 이번 주와 따로 저장 — 지난 주를 고쳐도 이번 주는 그대로, 반대도 같음).
- **없어지는 것**: [AI로 채우기]·[모두 다시 채우기 (AI)] 버튼(⑪).

### 3.2 사업 보고 '이번 주 주간보고' ([사업요약표 미리보기] 팝업이 바뀜)

- 사업 보고 화면 위 접는 칸 하나 `이번 주 주간보고 ▾`(팝업 아님) + 같은 주 고르기 부품.
- 1) 사업요약표: 사업영역 \| 세부 과제 \| 진행 상황 및 이후 계획 \| 담당. '진행'·'담당' 칸은 누르면 글 칸(수기, S49-39). 칸 아래 그 주 사업 보고 제목이 흐린 참고 줄(누르면 그 보고 열기) — 넣는 버튼 없음(제안이 아니라 사실 목록).
- 2) 그 주 주요 사업, 3) 주요 회의결과: 그 주 사업 보고 기록 줄(내부 정례 회의는 빠짐). 줄 ⋯ = [고치기]·[빼기](주간보고에서만 뺌, 기록은 그대로).
- 맨 아래 `[주간 정리에서 보기 ›]` 한 줄(한글 파일은 주간 정리 한 곳에서만 만든다).
- **없어지는 것**: 팝업, 그 안 '(고침)'·제안 줄·[HWP로 내려받기].

### 3.3 홈 [주간 정리]

- 명진 구성 순서대로 한 화면: ■ 일시 → 1. 요청사항(임원 배정 요청 수기, 상집 논의 요청) → 2. 1) 사업요약표(3.2와 같은 부품) → 2. 2) 주요 사업·회의결과 → 4. 조직보고(3.1과 같은 부품) → 3. 2) 조직보고 상세 → 5. 주요 일정(달력 고르기 + 수기) → `[확정하고 한글 파일 받기]`(weekly-one-flow.md 그대로).
- 조직보고에서 **넣은 줄이 1줄 이하인 조직**은 그 자리에 지난주 줄을 흐리게 보여 주고 줄마다 `[가져오기]`, 조직 머리에 `[지난주 모두 가져오기]`(⑭). 가져온 줄은 이번 주 줄로 새로 생기고(지난 주 줄은 그대로) 바로 고칠 수 있다. 2줄 이상인 조직은 지난주 줄을 접어 `지난주 n줄 ▸`만.
- [결정] 기준 '1줄 이하'는 CC 제안값이다(조직당 3줄 이내 규칙에서 1줄 이하면 부실로 봄). 바꾸기 쉬운 상수 하나.
- 지난주 줄은 담당조직 [전체 표]에서도 같은 부품으로 보인다(B). 단 평일엔 접힌 `지난주 n줄 ▸` 한 줄, 주간 정리에서만 부실 조직을 펼쳐 둔다.
- **없어지는 것**: 4. 1) 조직 요약 [요약 만들기](AI `org_summary`)·[요약 고치기] — 주별 표가 대신한다. 한글 파일 상자 안 3.2·4.1 칸의 따로 고치기(그 칸은 주별 표를 읽기만).

---

## 4. 실시간 '제안' 줄 (⑧'·⑨·⑩·⑫·⑮)

### 4.1 재료

| 재료 | 저장 자리 [사실] | 조직 판정 | 날짜 |
| --- | --- | --- | --- |
| 담당조직 기록(조직 상세 [기록]) | `app_suborganization_updates`(`workplace-detail.js`) | 그 행의 조직 | 기록의 일어난 날(없으면 쓴 날) |
| 조직에 이어진 업데이트 | 정리함 `app_notes` + `app_record_links`(organization_id, status=confirmed, `app_basket_confirm_links`) | 연결된 조직. **분류 안 된 업데이트는 뜨지 않고 정리함 '미분류'에 남음**(⑫) | 업데이트의 일어난 날 |
| 조직 상세 [현황 표] 새 줄 | `app_org_status_rows` | 그 행의 조직 | 그 줄의 날짜(S49-40 이후 시작~끝) |

- 그 주 = 재료 날짜가 든 주(월~일). 지난 주 날짜의 기록을 오늘 넣으면 지난 주 표에 제안이 생긴다.

### 4.2 흐름 [결정]

1. 기록·업데이트·현황 줄이 저장되면(같은 탭 이벤트 `kptu:suborganization-updated`·`kptu:basket-links-changed`·`kptu:org-status-changed`) 화면이 서버에 **기록 번호만** 보낸다: `ai-assist` 새 쓰임 `org_week_lines` `{source_kind, source_id}`.
2. 서버가 사용자 로그인(RLS)으로 그 기록을 다시 읽고(화면이 보낸 글·조직·날짜를 믿지 않음 — AGENTS.md 3절 3), 정돈한다.
   - 짧은 글(한 줄, 40자 이하)·현황 표 줄: **AI 없이** `날짜 + 글` 그대로.
   - 긴 글: AI 1번 — '주간보고 표기(명사형·짧게, 60자 이내)로 한 줄만 줄이기. 글에 없는 내용은 쓰지 않기'. 같은 조직·같은 주의 기존 줄(글만, 10개까지)을 같이 주고 `same_as`(같은 사건인 줄 번호)를 받는다.
   - 결과를 `app_weekly_org_lines`에 `state='suggested'`로 넣는다(같은 사건이면 그 제안 줄의 `source_*_ids`에 번호만 더하고 글은 그대로).
3. 화면은 응답을 받으면 같은 탭에 `kptu:weekly-org-lines-changed {week, organization_id}`를 보내고, 그 주 표를 보여 주는 곳(담당조직·홈 [주간 정리])이 그 조직 줄만 다시 읽는다.
4. **열 때 빠진 것 채우기**: 다른 기기·서버 경로(텔레그램 수집 등)로 들어온 기록은 1번이 없었을 수 있다. 주별 표를 열면 그 주 재료 중 어떤 줄의 출처에도 없는 기록 번호를 서버에 한 번 보낸다(한 번에 10개까지, `org_week_lines` 같은 쓰임).
5. 원래 기록을 고치면(⑨): 그 기록에서 나온 줄이 `edited=false`면 다시 정돈해 글을 바꾸고, 명진이 표에서 고친 줄(`edited=true`)은 그대로 둔다. 원래 기록 글의 해시(`source_hash`)가 같으면 AI를 부르지 않는다.
6. [✓ 넣기] = `state='in'`. [고치기] = 글 칸 → 저장하면 `state='in'`, `edited=true`. [×] = `state='dropped'`(같은 기록으로 다시 제안하지 않음, 원래 기록은 그대로 — ⑩). 받은/뺀 제안은 지금처럼 `draft.picks`에도 한 줄씩 남겨 환류 학습이 그대로 읽는다(`weekly-picks.mjs` 모양 그대로, kind만 `org_line`).
7. 주간보고(홈 [주간 정리]·한글 파일)에는 `state='in'` 줄만 들어간다.

- [결정] AI는 줄 정돈만 하고 새 내용을 지어내지 않는다. 발송·공유 같은 바깥 행동과는 이어지지 않는다(표에 뜨기만).
- [결정] 다른 탭·다른 기기 화면은 실시간 연결(Realtime)을 쓰지 않고 **화면이 다시 보일 때**(`visibilitychange`)와 주를 바꿀 때 그 주 줄을 다시 읽는다. 캐시 지우기가 아니라 다시 읽기다. Realtime은 DB 발행 설정 변경이 필요해 이번 범위에서 제외(필요하면 따로 제안).

### 4.3 줄 모양

- `- 11.2. 가상 교섭 상견례` / 기간이면 `- 11.2.~11.5. 파업 찬반투표`. 날짜 없는 줄은 `- 가상 현안 설명회 준비`.
- 조직 칸 안 정렬: 날짜 오름차순(날짜 없는 줄은 맨 뒤), 같은 날은 `sort_order`. 끌어서 순서 바꾸기는 지금 [현황 표] 부품 그대로.

---

## 5. DB 표 설계 — `app_weekly_org_lines` [결정]

DB 변경은 이 표 1개 + 가드 트리거 함수 1개뿐이다. 기존 표·정책·권한·자료는 바꾸지 않는다(기존 `app_org_status_rows` 줄은 옮기지 않고 그대로 — 5.3).

```sql
create table public.app_weekly_org_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  week_start date not null,                         -- 월요일
  organization_id uuid not null references public.app_suborganizations(id) on delete cascade,
  day date,                                         -- 날짜 없는 줄 허용
  end_day date,                                     -- 기간이면 끝나는 날
  body text not null,                               -- 1~200자, 한 줄
  sort_order integer not null default 0,            -- 0~1000
  state text not null default 'in',                 -- suggested | in | dropped
  origin text not null default 'user',              -- user(수기) | plain(AI 없이 정돈) | ai | last_week(가져오기)
  edited boolean not null default false,            -- 명진이 글을 고침 → 원래 기록이 바뀌어도 덮지 않음
  source_update_ids uuid[] not null default '{}',   -- app_suborganization_updates.id, 10개까지
  source_note_ids uuid[] not null default '{}',     -- app_notes.id(조직 연결 업데이트), 10개까지
  source_status_ids uuid[] not null default '{}',   -- app_org_status_rows.id, 10개까지
  source_hash text,                                 -- 정돈할 때 원래 글 해시(같으면 AI 다시 안 부름)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),    -- 트리거가 매 고침마다 서버 시각으로
  check (extract(isodow from week_start) = 1),
  check (end_day is null or (day is not null and end_day >= day)),
  check (char_length(body) between 1 and 200 and body = btrim(body) and body !~ '[[:cntrl:]]'),
  check (sort_order between 0 and 1000),
  check (state in ('suggested','in','dropped')),
  check (origin in ('user','plain','ai','last_week')),
  check (cardinality(source_update_ids) <= 10 and cardinality(source_note_ids) <= 10 and cardinality(source_status_ids) <= 10)
);
create index on public.app_weekly_org_lines(workspace_id, week_start, organization_id, sort_order);
```

### 5.1 권한

- `enable row level security`, 정책 하나 `for all to authenticated using/with check (private.app_is_workspace_owner(workspace_id))` — 작업공간 주인만.
- `revoke all ... from public, anon, authenticated, service_role` 뒤 authenticated에 `select`, `insert(필요한 칸만)`, `update(day, end_day, body, sort_order, state, edited, source_update_ids, source_note_ids, source_status_ids, source_hash)`만. **delete 없음**(빼기 = `state='dropped'`, 기록 보존). anon·PUBLIC 권한·SECURITY DEFINER 함수 없음.
- `workspace_id`·`organization_id`·`week_start`·`origin`은 만든 뒤 고칠 수 없다(update 칸에서 뺌). 제안 줄은 서버(`ai-assist`)가 **사용자 로그인 그대로**(서비스 키 아님) 넣으므로 RLS가 그대로 걸린다. 화면이 출처 번호를 직접 보내더라도 자기 작업공간 자료만 바뀐다.
- 가드 트리거(`security invoker`, `search_path=''`): 조직이 같은 작업공간인지, `source_*` 번호가 같은 작업공간 기록인지(세 표를 RLS 아래에서 확인), (주 × 조직) 줄이 40개 넘지 않는지(제안·뺀 줄 포함), `updated_at = clock_timestamp()`.

### 5.2 동시 고침 (결정 B의 충돌 규칙)

- 줄 하나 = 행 하나이므로 **바뀐 줄만 저장**된다. 고치기는 `PATCH ?id=eq.<id>&updated_at=eq.<읽은 값>`(`Prefer: return=representation`). 0행이면 그사이 다른 화면이 그 줄을 고친 것 → 그 줄만 다시 읽고 그 자리에 작게: "다른 화면에서 먼저 고쳤어요: '<새 글>'" + `[그대로 두기] [내 글로 바꾸기]`. 다른 줄은 영향 없음.
- 두 화면에서 동시에 줄을 **더하는** 것은 충돌이 아니다(각각 새 행).
- 순서 바꾸기는 움직인 줄의 `sort_order`만 보낸다(지금 `orderChanges`와 같음).
- 같은 규칙을 draft 쪽(사업요약표 등)에도 쓴다: 지금 `draft_saved_at` 조건 쓰기 + `merge3`(칸별 3자 비교, weekly-draft-store.js 440행)가 이미 '바뀐 칸만'이다 [사실]. 같은 칸을 두 곳에서 고친 경우만 위와 같은 안내를 그 칸에 띄운다 [결정 — 지금 상자 안 충돌 질문을 칸 자리 안내로 통일].

### 5.3 도입 주와 지난 기록

- [결정] 새 주는 빈 표(16:58 결정). 도입 주(처음 쓰는 주)에는 '지난주' 줄이 없으므로, 조직마다 `app_org_status_rows` 최근 3줄을 '지난주' 자리에 흐리게 보여 줘 [가져오기]할 수 있게 한다(옮기는 migration 없음, 원래 자료 그대로).
- 도입 전 주의 한글 파일·[주간 정리]는 지금 길(`draft.rows.orgs`·`app_weekly_org_summaries`)을 읽기만 한다. `app_weekly_org_summaries`·`draft.area_summaries`(AI 값)는 지우지 않고 화면에서만 안 읽는다.

### 5.4 짝 파일 (AGENTS.md 7절)

`supabase/migrations/20261104211500_weekly_org_lines.sql` + `docs/20261104211500_weekly_org_lines.{precheck,snapshot,postcheck,rollback}.sql` + `.summary.md`(S49-46 #1867, 시험 `tests/auth-handoff/weekly-org-lines-db.test.mjs`), `commit;` 앞 `schema_migrations` 1행. 승인형 workflow로 dry-run(tx-probe) → apply → postcheck. rollback = 표·트리거 함수 drop(새 표라 기존 자료 영향 없음).

---

## 6. 하나로 합치는 계획과 없어지는 것

### 6.1 합친 뒤 구조 [결정]

```
재료(원본)                      저장 자리(유일)                        보이는 곳(같은 부품)
담당조직 기록·조직 업데이트 ─┐
조직 상세 [현황 표] 새 줄  ──┼→ ai-assist org_week_lines → app_weekly_org_lines ─→ 담당조직 '이번 주 조직보고' / 홈 [주간 정리] 4.·3.2) / 한글 파일
                             │
사업 보고 기록(app_meetings) ─→ (원본 그대로) + draft.hand 고침  ─→ 사업 보고 '이번 주 주간보고' 2)·3) / 홈 [주간 정리] 2.2) / 한글 파일
명진 수기                    ─→ draft.rows.summary                 ─→ 사업 보고 1) / 홈 [주간 정리] 2.1) / 한글 파일
요청·일정(수기·달력 고르기) ─→ items·draft.hq·discuss·picks…     ─→ 홈 [주간 정리] 1.·5. / 한글 파일
```

- 한글 파일은 홈 [주간 정리] 한 곳(`journal-hwpx.js`)에서만 만든다. 사업 보고의 HWP 버튼은 없앤다(②는 이미 ④로 가는 문이었음).
- 공용 부품 [결정]: `app/week-pick.js`(주 고르기 — 지금 `journal.js`의 `.journal-week-nav`를 떼어 냄, 사업 보고의 `data-bp-week`도 이걸로), `app/weekly-org-lines-model.mjs`(줄 정렬·3줄 넘음·부실 판정·충돌 판정, node 시험) + `app/weekly-org-lines.js`(그리기·쓰기), `app/weekly-summary-table.js`(사업요약표 칸, S49-39가 만든 수기 칸을 떼어 냄).

### 6.2 없어지는 화면·기능 (데이터는 보존)

| 없어지는 것 | 지금 위치 [사실] | 대신 | 서버 쪽 |
| --- | --- | --- | --- |
| 사업 보고 [사업요약표 미리보기] 팝업과 그 [HWP로 내려받기] | `report-summary-preview.js`, `team.js` 433행 | 사업 보고 '이번 주 주간보고' 접는 칸 + [주간 정리에서 보기 ›] | — |
| 사업요약표 AI 제안('(고침)'·제안 줄) | 같은 파일 92행 | 수기 | `ai-assist` `area_week_summary` — **S49-39가 지움** |
| 담당조직 [AI로 채우기]·[모두 다시 채우기 (AI)] | `org-overview.js` 114·127행 | 실시간 제안 줄 | — |
| 조직 상세 [현황 표] [기록에서 다시 채우기 (AI)]·처음 열 때 자동 채우기 | `org-status-table.js` 184행 | [현황 표]는 수기 기록으로, 주간보고 줄은 주별 표 제안으로 | `ai-assist` `org_status_rows` 쓰임(마지막 PR에서 지움) [명진 확인 ③] |
| 홈 [주간 정리] 4.1) [요약 만들기](AI)·[요약 고치기] | `journal-org-summary.js` 104행 | 주별 표 | `ai-assist` `org_summary` 쓰임(마지막 PR에서 지움), 표 `app_weekly_org_summaries`는 보존 |
| 한글 파일 상자 안 3.2)·4.1) 칸 따로 고치기·AI 초안의 그 칸 | `journal-hwpx.js`(`draft.rows` orgs·sites) | 주별 표를 읽기만 | `weekly_draft`는 1~2절·5절에만 |
| 담당조직 '외 n줄 — 조직 상세에서' 안내 | `org-overview.js` | `외 n줄 ▾`(S49-40) | — |

---

## 7. PR 나누기·순서 [결정]

| 순서 | PR | 바꾸는 것 | 겹치는 파일·앞 PR | 정지 지점 |
| --- | --- | --- | --- | --- |
| P0 | 이 PR | 설계·시안 | — | — |
| (급) | S49-39 | 사업요약표 수기·내부회의 빼기·AI 제안 삭제 | `report-summary-preview.js`, `journal-weekly.js`, `ai-assist/business-area.ts` | Edge 배포 |
| (먼저) | S49-40 | [전체 표] 오름차순·시작~끝 날짜·펼치기 | `org-overview.js`, `org-status-table.js`, `app_org_status_rows`(end_day 추정) | DB |
| P1 | DB: `app_weekly_org_lines` | 5절 표·가드 트리거 + 짝 파일 5개 | S49-40 DB 뒤(같은 날 두 DB 변경을 겹치지 않게) | DB dry-run → apply |
| P2 | Edge: `ai-assist` `org_week_lines` | 기록 번호 → 정돈 → 제안 줄 넣기, 하루 상한 `org_week_lines: 40` | P1 뒤. `ai-assist/handler.ts` | Edge 배포(되돌리기 ref) |
| P3 | 공용 부품 + 담당조직 '이번 주 조직보고' | `week-pick.js`, `weekly-org-lines*.{js,mjs}`, `org-overview.js`를 주별 표로, [AI로 채우기] 버튼 지움 | S49-40 PR 브랜치 위(줄 세우기), P2 뒤 | — |
| P4 | 제안 부르는 자리 | `workplace-detail.js`·`basket-classification.js`·`org-status-table.js` 저장 뒤 호출, 열 때 빠진 것 채우기 | P3 뒤 | — |
| P5 | 사업 보고 '이번 주 주간보고' | 팝업 → 접는 칸, `weekly-summary-table.js` 떼어 냄, HWP 버튼 지움 | S49-39 뒤. `team.js`·`report-summary-preview.js` — P3·P4와 파일이 안 겹쳐 같이 돌 수 있음 | — |
| P6 | 홈 [주간 정리]·한글 파일 | 4.·3.2)를 주별 표 부품으로, 지난주 가져오기, 2.1)을 공용 사업요약표, `journal-hwpx.js`가 주별 표 읽기, [요약 만들기] 지움 | P3·P5 뒤. `journal-weekly.js`·`journal-hwpx.js`·`journal-org-summary.js` | — |
| P7 | 정리(Contract) | `ai-assist`에서 `org_status_rows`·`org_summary` 쓰임 지움, 안 쓰는 코드 정리 | P6 배포·실기기 확인 뒤 | Edge 배포 |

- 이번 주 금요일 보고는 S49-39(급)로 먼저 막고, P1~ 구조 변경은 그 뒤(16:48 할 것 ④).
- 각 화면 PR은 `app/release-notes/` 기록 1개(AGENTS.md 10절).
- 시험: `weekly-org-lines-model.mjs` node 시험(정렬·3줄 넘음·부실 판정·충돌), E2E(두 화면에서 같은 줄 고치기 → 뒤 저장이 0행 → 안내, 담당조직에서 넣은 줄이 주간 정리에 보임, 지난 주 고쳐도 이번 주 그대로), 보안 시험(새 표 anon 거절·다른 작업공간 거절·delete 권한 없음).

---

## 8. AI 호출 수·비용 예상 (⑬·⑮)

- [사실] 기본 모델 `gpt-6-luna`(생각 low), 100만 토큰당 입력 140원·출력 700원(`supabase/functions/_shared/ai-model.ts`). 운영은 비밀값 `WEB2_AI_MODEL`이 우선 [사실] — 다른 모델이면 아래 값이 달라진다.
- [추정] 한 번에 입력 약 800토큰(지시 400 + 기록 300 + 기존 줄 100), 출력 약 80토큰(생각 토큰 별도, low) → **한 번 약 0.2원**.
- [추정] 하루 담당조직 기록·조직 업데이트 10~20건, 그중 긴 글 절반 → **하루 5~10번, 약 1~2원, 한 달 약 30~60원**. 짧은 글·현황 표 줄·같은 글 다시 저장은 0번.
- [결정] 하루 상한 `org_week_lines: 40`(전체 하루 80회 상한 안). 넘으면 AI 없이 앞 60자 그대로 제안.
- 줄어드는 것: `area_week_summary`(상한 30), `org_status_rows`(상한 30, [모두 다시 채우기] 한 번에 조직 수만큼), `org_summary`(상한 50) 호출이 없어진다 → 전체로는 지금보다 적거나 비슷하다 [추정].

---

## 9. S49-39·S49-40 뒤 바꿀 것 — 확인 결과 (S49-46, main `992355c`)

두 PR(#1866·#1862)이 main에 들어간 뒤 실제 코드와 대조했다. 다른 곳은 아래처럼 고쳤다.

| 앞 PR | 가정했던 것 | 실제 [사실] | 이 문서에서 바꾼 곳 |
| --- | --- | --- | --- |
| S49-39 #1866 | 진행·담당 모두 `draft.rows`(summary) | 진행 = `draft.rows` summary 칸(칸 이름 `사업영역›세부 과제`, `summaryCellKey`), **담당 = 따로 `draft.owners`**(`weekly-summary-hand.mjs` `readOwners`·`withOwner`, `weekly-draft-store.js` `withOwnerEdit`). 홈 [주간 정리]에는 담당 칸이 없고 미리보기·한글 파일 요약 표 담당 칸에만 쓰인다 | 2절 1행 저장 자리. P5 `weekly-summary-table.js`는 `weekly-summary-hand.mjs`(순수 규칙)를 그대로 쓰고 그리기만 떼어 낸다. P6에서 홈 [주간 정리] 2.1)에 담당 칸을 보일지는 그때 시안으로 |
| S49-39 #1866 | 내부 회의 목록은 `weekly-major-schedule.mjs` 한 곳 | 모든 길이 `journal-meeting-kinds.js` `reportsMeeting`(안에서 고정 목록 + 사람별 빼기)을 부른다 | 1절 내부 회의 줄 |
| S49-39 #1866 | `area_week_summary` 서버 쓰임 지워짐 | 맞음(`ai-assist/handler.ts`·`business-area.ts`에서 지움, 저장된 `draft.area_summaries`는 보존·다시 실어 보내기만) | 바꿀 것 없음 |
| S49-40 #1862 | `app_org_status_rows`에 끝나는 날 칸 | 맞음 — 이름 `end_day`(date, null 허용, `end_day >= day`, migration `20261104201500`). 단 그 표의 `day`는 **not null** | 5절 `end_day` 이름 같음. 새 표는 날짜 없는 줄을 허용하므로(`day` null) 정렬은 `org-status-model.mjs` `sortRows`를 감싸 '날짜 없는 줄 맨 뒤'만 더한다(P3 `weekly-org-lines-model.mjs`) |
| S49-40 #1862 | 날짜 오름차순·`외 n줄 ▾` 펼치기 부품 | 정렬 한 곳 `sortRows`(시작일 → `sort_order` → id), 기간 표기 `periodLabel(day,end)`(`11.2.~11.5.`), 보이는 줄 = **가장 최근 3줄**, 그 앞 오래된 줄이 `외 n줄 ▾`(`splitRows`, `org-overview.js` `st.expanded`) | 3.1 '처음 3줄 + 외 n줄'을 '최근 3줄 + 앞의 외 n줄'로 읽는다(P3에서 같은 `splitRows`·`periodLabel` 재사용) |

## 10. 범위 밖 발견

- `app/weekly-hwpx/delta.mjs` `reportOrgOrder`(80~85행): 주석은 '바탕(개인본) 순서'인데 코드는 가나다순 정렬이다 [사실]. 16:48 결정 '조직 순서는 개인본 순서 고정'과 맞지 않을 수 있다 → P6에서 확인 필요(이 PR에서는 고치지 않음).

## 11. 명진이 고를 것

- **11/04 17:34 명진 답: 다섯 가지 모두 기본대로(ㅇ)** — ① 조직보고·조직보고 상세 칸 짝, ② '그 주 주요 사업' 범위, ③ 조직 상세 [현황 표] AI 다시 채우기 지움, ④ 지난주 줄은 넣은 줄 1줄 이하 조직만, ⑤ 시안 모양 그대로. 아래는 물었던 내용.

1. **조직보고·조직보고 상세가 양식 어느 칸인지**: 기본(이 설계) = 조직보고 → 4. 산하조직 현황 요약(담당 조직 전부), 조직보고 상세 → 3. 2) 투쟁 사업장 현황(투쟁 중 조직, 같은 줄) + 4. 2) 참고자료. 다르면 2절 표만 바꾸면 된다.
2. **'그 주 주요 사업'**: 기본 = 2. 2) 세부 내용 중 회의가 아닌 활동 + 3. 1) 집회·농성 등.
3. **조직 상세 [현황 표]의 [기록에서 다시 채우기 (AI)]도 지울지**: 기본 = 지움(주별 표 제안이 대신, 쓰지 않는 기능은 삭제).
4. **'부실' 기준**: 기본 = 넣은 줄 1줄 이하면 지난주 줄을 펼쳐 보여 줌.
5. 시안에서 화면 모양(조직 칸 안 제안 줄 위치·버튼 크기).
