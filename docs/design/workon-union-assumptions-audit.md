# WORK ON 노조 전제 전수 조사 (S67-51)

2026-11-20 사용자 요청(22:33): "이게 내가 혼자 쓰던 앱이다보니까 내가 당연하게 노조 색을 입혀둔 곳이 많을텐데 그런걸 전수조사해서 사람들이 각자 입력한 값을 참고하게 코드를 짜야해"

- 기준: 2026-11-20 `main` `bf82908`. `app/`, `supabase/functions/`, `supabase/migrations/` 코드를 `rg`로 넓게 찾은 뒤 줄을 읽어 판정했다. 운영 DB 기록 내용은 열지 않았다(AGENTS.md 3절).
- 이 문서는 **동작·자료·판단 규칙·AI 지시문·기본값·폴더 이름**에 박힌 노조 전제를 다룬다. 화면 글자(버튼·메뉴·안내)는 S67-43(단어표)·S67-44(사람별 이름 15칸)가 맡는다. 앱 이름은 S67-49, 브리핑 룸 프롬프트는 S67-50.
- 운영자 전용 기능(통화·텔레그램·가족·News·브리핑 룸 Now 시사점·아스날·원장 메뉴)은 서버 허용 표(`app_operator_features`, `app_my_features`)로 사용자에게만 열린다. 이번 '고칠 대상'에서 빼고 E절 목록에만 둔다.

## 읽는 법

- 영향: **모두** = 가입한 누구나 / **바탕** = 주간 보고 바탕 파일(팀 확정본) 길을 쓰는 사람(지금은 사실상 운영자) / **운영자** = 서버 허용 표로 운영자만.
- 바꿀 방식: **등록값** = 그 사람이 등록한 값(프로필 직책·소속, 담당 대상, 프로젝트, 분류, 내 양식)을 읽음 / **일반 기본값** = 업종 없는 기본값으로 / **사람별 설정** = 서버 저장 설정(`view_prefs`·프로필 칸)으로 옮김 / **유지** = 운영자 전용이거나 해가 없어 그대로.
- 사용자 화면 불변: 사용자의 지금 값은 사용자 본인 설정으로 옮긴다(코드에 사용자 계정·이름을 박지 않음). 새 기본값은 **처음 쓰는 사람**에게만 적용되고, 이미 저장된 사용자 자료는 건드리지 않는다.
- 우선: 상 = 모든 사람의 동작·AI 결과·자료가 노조 전제로 틀어짐 / 중 = 쓰는 사람이 적거나 결과가 어색한 정도 / 하 = 주석·예시·거의 무해.

## A. AI 지시문 (Edge 함수)

공용 자리: `ai-assist/owner-role.ts`의 자리표 `OWNER_ROLE`와 `roleOf`(지금 "노동조합 <직책>", 기본 "노동조합 활동가"). 자리표를 쓰는 지시문은 share-draft·ledger-auto·overlap·schedule-titles·weekly-learn 다섯 개뿐이고, 나머지는 "노동조합 상근자/담당자/활동가"를 글에 직접 쓴다. 회의 쪽에는 같은 규칙 사본 `_shared/meeting-draft-prompt.mjs` `ownerRole`이 따로 있다.

| ID | 위치 | 지금 전제 | 영향 | 바꿀 방식 | DB | 담당 | 우선 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | ai-assist/owner-role.ts:8-13 | `NEUTRAL_ROLE="노동조합 활동가"`, 직책 앞에 늘 "노동조합 " | 모두 | 등록값(프로필 소속 `union_name` + 직책), 없으면 일반 기본값 "업무 담당자" | 아니오 | S67-51 #2821 | 상 |
| A2 | _shared/meeting-draft-prompt.mjs:34-41 | A1 사본 `ownerRole`(회의결과 정리: meeting-ai-draft·meeting-transcribe) | 모두 | A1과 같은 규칙(사본 없이 한 규칙) | 아니오 | S67-51 #2821 | 상 |
| A3 | ai-assist/web2-ask.ts:185 | "노동조합 상근자 개인 업무 시스템" | 모두 | `OWNER_ROLE` | 아니오 | S67-51 #2821 | 상 |
| A4 | ai-assist/journal-draft.ts:50,54 | "노동조합 상근자 개인 업무일지", 예 "3차 교섭 준비회의… ○○지부와 통화" | 모두 | `OWNER_ROLE` + 중립 예시 | 아니오 | S67-51 #2821 | 상 |
| A5 | ai-assist/work-scope.ts:94-96 | 업무 정의 "노동조합 일(교섭·회의·조직·지부·조합원 상담·집회·기자회견·성명…)" | 모두 | `OWNER_ROLE` + 일반 업무 정의 | 아니오 | S67-51 #2821 | 상 |
| A6 | ai-assist/org-summary.ts:105-112 | "노동조합 본부 부팀장의 주간보고 '산하 조직 현황'", 예 "임금교섭 3차", "쟁의행위 찬반투표", "지부장" | 없음(쓰임 org_summary는 WEEKLY-메뉴짝짓기 P7에서 지움, 지시문만 남음) | 쓰지 않는 지시문 정리(범위 밖) | 아니오 | 후속 | 하 |
| A7 | ai-assist/org-status-rows.ts:79-85 | "노동조합 담당자", 먼저 고를 일 "교섭·조정·쟁의·집회·결의대회·투표·협약" | 없음(쓰임 org_status_rows도 P7에서 지움) | 쓰지 않는 지시문 정리(범위 밖) | 아니오 | 후속 | 하 |
| A8 | ai-assist/todo-radar.ts:159-178, todo-recheck.ts:50-52 | 기록 주인 = "산하 조직·사업장을 맡아 확인·연락·지원하는 팀의 실무 담당자", 다른 주체 = "조합원·현장 간부·지부·지부장·임원" | 모두 | 일반 기본값(담당 대상·상대 기관·동료) | 아니오 | S67-51 #2821 | 상 |
| A9 | ai-assist/schedule-titles.ts:99-100 | 예 "지티엑스→다온에이운영지부 임단투 점검 회의", "공철 파업선포→공항철도 경고파업" | 모두 | 특정 조직 없는 중립 예시. 정식 이름은 지시문에 이미 들어가는 내 담당 대상 목록에서 | 아니오 | S67-51 #2821 | 상 |
| A10 | ai-assist/share-draft.ts:86-95 | "현장 조합원·간부가 로그인 없이 읽는", 기록 주인 실명 | 모두 | "링크를 받은 사람", "기록 주인" | 아니오 | S67-51 #2821 | 상 |
| A11 | document-ai-index/index.ts:37,40, meeting-ai-ingest/index.ts:35 | "이 파일은 노조 업무·회의·정책 자료다" | 모두 | "업무 자료" | 아니오 | S67-51 #2821 | 상 |
| A12 | page-ai-draft/index.ts:36 | "민주노총 A노조의 웹2에서 공공기관사업팀 업무를…" | 없음(화면 `app/`에서 부르는 곳 없음, 기능 검사도 없음) | 함수 정리 작업으로(범위 밖) | 아니오 | 후속 | 하 |
| A13 | ai-assist/org-people-brief.ts:77-78, record-one-line.ts:51-56, library-sort.ts:58, library-files/photo-brief.ts:23, record-line.ts:13 | "노동조합 담당자/활동가", "다음 교섭 날짜" | 모두 | `OWNER_ROLE` | 아니오 | S67-51 #2821 | 중 |
| A14 | ai-assist/home-day-picks.ts:255 | 일기 재료 고르기 "노동조합 상근자 한 사람" | 모두 | `OWNER_ROLE` | 아니오 | S67-51 #2821 | 중 |
| A15 | ai-assist/hwp-convert.ts:67 | 일반 규칙 "노동조합 문서를…"(63줄 `ppwu_forms`는 운영자) | 모두 | "업무 문서" | 아니오 | S67-51 #2821 | 중 |
| A16 | ai-assist/library-fill.ts:39-41 | 내 분류를 못 읽을 때의 기본 분류 `교섭·투쟁·교육·선전·정책·회의·기타` | 모두 | C1과 같은 일반 기본값 | 아니오 | 후속(C1과 함께) | 상 |
| A17 | ai-assist/library-fill.ts:237-244 | 예 "국토교통부, A노조", "A 지부 임금교섭 요구안", 분류 기준 성명·교섭·투쟁 지침 | 모두 | 예시 중립화. 분류 기준은 "내 목록에 그 이름이 있을 때만" | 아니오 | S67-51 #2823 | 중 |
| A18 | ai-assist/ledger-auto.ts:58,89-93 | 활동 분류 이름 `negotiation:"교섭" press:"언론" assembly:"국회" struggle:"투쟁"`, 교섭이면 최소 S2 | 모두(자동 원장) | 분류 이름은 S67-44 사람별 이름을 읽음. 민감도 바닥 규칙은 값(`negotiation`)에 걸려 있어 유지 | 아니오 | S67-44 뒤 | 중 |
| A19 | ai-assist/ledger-auto.ts:142-160, ledger-candidates.ts:49-55 | "상대 기관과의 교섭", "외국 노조·사용자 단체", S3 "조합원·제3자 개인정보" | 모두 | "상대와의 협상·협의", "구성원·제3자" | 아니오 | S67-51 #2821 | 중 |
| A20 | ai-assist/ledger-weekly.ts:51 | 기본 절 이름 `struggle:"투쟁 사업"` | 바탕 | 내 양식 제목(form-names) 참조 | 아니오 | 후속 | 하 |
| A21 | ai-assist/file-name.ts:50, note-title.ts:49 | 예 "교섭위원 명단", "임단투 3차 교섭 준비" | 모두 | 중립 예시 | 아니오 | S67-51 #2821 | 하 |
| A22 | mcp-read/core.mjs:21 | 도구 설명 "현재 쟁의 단계" | 모두(Claude 읽기 연결) | "진행 단계" | 아니오 | 후속(C4와 함께) | 중 |
| A23 | _shared/brief-room.mjs:229-238 | "노동조합 담당자를 돕는 비서", conflicts = "노동조합 주장과 부딪히는 대목" | 모두(document-actions 기능 검사 없음) | 등록값 + 내 입장 설정 | 아니오 | **S67-50** | 상 |

## B. 주간 보고·업무일지·한글 파일

처음 쓰는 사람의 '내 양식' 길(`weekly-own-form-model`·`weekly-own-draft`)에는 노조 전제가 없다. 전제는 **바탕 파일(팀 확정본)로 도는 한글 파일 엔진 길**에 몰려 있다. 칸 자리 14개가 `app/weekly-hwpx/form-profile.mjs`(= `supabase/functions/_shared/weekly-form-profile.mjs` 사본)에 고정돼 있고, 투쟁 사업장·쟁의 단계·상집·임원 요청 규칙이 거기에 묶여 있다. 칸 제목 글자는 이미 사람별(내 양식·바탕 파일, `weekly-screen-titles.mjs`)이다.

| ID | 위치 | 지금 전제 | 영향 | 바꿀 방식 | DB | 담당 | 우선 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | app/weekly-major-schedule.mjs:8-41 (`MAJOR_SCHEDULE_RULE`·`MAJOR_RULES`), 쓰는 곳 report-plan-model.mjs:90-104, weekly-hq-schedule.js:17,47 | '주요 일정'·일정 화면 '보고할까요?' 판정 낱말: 파업·선전전·결의대회·공동투쟁·국회 토론회, '궤도 주최' | 모두 | 사람별 설정(넣는 낱말). 일반 기본값은 '기자회견·토론회·행사'. 빼는 낱말은 이미 사람별(`weekly_hidden_meeting_kinds`) | 예(`view_prefs` 키 검사) | S67-51 ④(후속) | 상 |
| B2 | app/weekly-hwpx/form-profile.mjs:13-22, hwpx-form-read.mjs:14,162 | 엔진 자리 14개·순서·표 칸 수 고정(임원 요청 표 → 사업 → 투쟁·집회·사업장 → 산하 조직 → 일정). 다 있어야만 한글 파일이 나옴 | 바탕 | 자리를 '있으면 채움'(투쟁·산하 조직 자리 선택). 못 맞춘 파일은 '내 양식' 길로 | 아니오(`app_weekly_forms.form` JSON) | 후속(사용자 결정 1) | 상 |
| B3 | app/weekly-own-draft*.mjs | '내 양식' 길에는 한글 파일 출력이 없음(노조 엔진 길에서만 나옴) | 모두 | 내 양식 자리 정보로 범용 한글 출력 | 아니오 | 후속(사용자 결정 1) | 상 |
| B4 | app/org-dispute-stage-model.mjs:71-84,150-160, weekly-hwpx/draft.mjs:254-266, journal-hwpx.js:163,642,861-866 | 투쟁 중인 담당 대상을 '투쟁 사업장 현황' 표에 자동으로 넣음 | 바탕 | 양식에 `siteTable` 자리가 있을 때만(지금도 바탕 길 한정) | 아니오 | 후속 | 중 |
| B5 | app/weekly-cell-names.mjs:75-78, journal.js:838, weekly-flow-cells.js:135 | 투쟁 사업장 표의 조직은 산하 조직 칸을 '- 투쟁 사업장 보고 참고'로 바꿈 | 바탕 | 두 자리가 모두 있을 때만, 문구는 양식 제목에서 | 아니오 | 후속 | 중 |
| B6 | app/weekly-discuss*.js, journal-weekly.js:387,482,683 | 요청 절의 '상집 논의 요청'(안건·관련 조직) | 바탕 | `discuss` 자리를 선택 자리로 | 아니오 | 후속 | 중 |
| B7 | app/weekly-exec-requests.js:29,136-151, update-requests.js:9 | '임원 배정 요청' 표, 지난주 줄을 '임원 요청·참석 요청' 낱말로 판정 | 바탕 | 판정 낱말 사람별 설정, 이름은 일반 기본값 '참석 요청' | 아니오 | 후속 | 중 |
| B8 | app/journal-data.js:177-183, journal-hwpx.js:10-13, weekly-hwpx/draft.mjs:146-152 | 보고일 = 다음 월요일(상집 보고일), 주요 일정 = 그날부터 2주 | 모두 | 사람별 설정(보고 요일·일정 주 수). 기본값은 지금 그대로 | 예(`view_prefs`) | 후속 | 중 |
| B9 | app/weekly-hwpx/delta.mjs:7,63-83, draft.mjs:5-7,34 | 팀 확정본의 '담당 팀원' 칸에서 내 이름으로 내 줄만 고름 | 바탕 | 팀이 없으면 이 길을 타지 않음(지금도). 유지 | 아니오 | 유지 | 하 |
| B10 | app/weekly-hwpx/template.mjs:9,144,211 `CREATOR='노동조합+'`, journal-hwpx.js:412,430 | 한글 파일 만든이 정보에 앱 이름 | 모두 | 앱 이름 상수(얼굴) 참조 | 아니오 | **S67-49** | 하 |
| B11 | app/journal-weekly.js:126-127, weekly-own-form-model.mjs:23-28 | 휴가 낱말, 칸 이름 짐작의 '지회·지부·분회' | 모두 | 일반 낱말과 함께 있어 무해. 유지 | 아니오 | 유지 | 하 |
| B12 | app/journal-data.js:185,418, report-calendar.mjs | 주석의 'A노조' 달력·'철도→지하철' 순서 | 없음 | 코드는 이미 사람별(`view_prefs.report_calendar`·`org_order`). 주석만 | 아니오 | S67-43 | 하 |

## C. 담당 대상·프로젝트·분류·자료실

| ID | 위치 | 지금 전제 | 영향 | 바꿀 방식 | DB | 담당 | 우선 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | app/document-categories.js:9, migration 20261018112943 칸 기본값, ai-assist/library-fill.ts:39 | 새 가입자 자료 분류 기본 `교섭·투쟁·교육·선전·정책·회의·기타`(세 곳이 같아야 함) | 모두(새 가입자) | 일반 기본값 `회의·보고·기획·자료·교육·기타`(세 곳 함께). 이미 저장된 분류는 그대로 | 예(칸 기본값만) | 후속(S67-51 다음 PR — 세 곳·시험 14개가 이 목록 기준) | 상 |
| C2 | app/org-dispute-stage-model.mjs:8-23, org-dispute-stage.js:54-58 `ensureSeeded` | 쟁의 단계 기본 11개(교섭 시작 전~임단협 찬반투표·협약체결)를 관리 창을 열거나 저장할 때 내 작업공간에 자동으로 넣음 | 모두 | 일반 기본값(시작 전·진행 중·주의·마무리 등 중립 단계). 이미 넣은 행은 보존. 판정은 이름이 아니라 `is_struggle`·`is_ending` 표시라 그대로 동작 | 아니오(기본값은 화면 쪽) | S67-51 #2823 | 상 |
| C3 | app/report-kinds.mjs:3-12 (DB CHECK 20261022182319) | 사업 보고 활동 분류 8칸 회의·정책·**교섭·언론·국회·투쟁**·교육·기타 | 모두 | 값(영어)은 유지, 화면 이름은 기록+ 기본(회의·기획·협의·홍보·외근·행사·교육·기타) + 사람별 이름 | 아니오(이름만) / 예(칸 수를 바꿀 때) | **S67-43/44** | 상 |
| C4 | app/org-dispute-stage-ui.js, suborganizations.js:62-95, org-overview.js | '쟁의 단계'·'투쟁 중' 화면 이름 | 모두 | 글자 | 아니오 | S67-43 | 중 |
| C5 | app/activity-photo-model.mjs:10-19 | 활동 분류 → 자료 분류 고정 연결(negotiation→교섭·합의, press→성명·보도자료, struggle→투쟁) | 모두 | 등록값: 내 분류 목록에 있는 이름일 때만 연결, 없으면 기본 | 아니오 | S67-51 #2823 | 중 |
| C6 | app/hwp-drive.js:28,51-58,195-222, hwp-lab.js:344, hwp-convert.js:55,146, journal.js:682-698 | 한글 서식 분류 이름 '노조 서식'을 내 분류 목록에 자동으로 더함, 서식 힌트 `/노조\|문서 스타일\|통일/` | 모두(한글 서식 쓰는 사람) | 새로 더할 때는 일반 이름 '서식', 옛 이름 '노조 서식'도 계속 같은 분류로 읽음(사용자 자료 불변) | 아니오 | 후속 | 중 |
| C7 | app/library-sort-model.mjs:116 | 정리 제안 종류 낱말 합의서·협약서·요구안·성명서·결의문·규약·소식지·선전물 | 모두 | 일반 문서 낱말 추가 + 내 분류 이름 참조 | 아니오 | 후속 | 중 |
| C8 | app/collab-groups-model.mjs:4,52,66-77, DB 20261118110000 | 묶음 종류 `union` 노조 묶음/`dept` 부서 묶음, 부서 묶음에도 `union_name` 필수 | 모두 | 화면 이름 '단체'(S67-43), 필수 여부는 결정 필요 | 예(필수를 풀 때) | S67-43 + 사용자 결정 3 | 중 |
| C9 | app/profile-settings.js:11,92,175 | 프로필 칸 '노조명'(`app_profiles.union_name`) | 모두 | 화면 이름 '소속'(S67-43). 값은 A1 역할 문장이 씀 | 아니오 | S67-43 | 중 |
| C10 | app/workplace-detail.js:127-130,452 | 담당 대상 칸 '조합원수'·'대표자', 소속 묶음 `council` 협의회·`taskforce` 사업단 두 종류 | 모두 | 글자는 S67-43. 두 종류 고정은 후속(등록 묶음) | 확인 필요 | S67-43 / 후속 | 중 |
| C11 | app/org-name-match.mjs:4-16 (= _shared/org-name-match.mjs), org-similar.mjs:7 | '노동조합'='노조', 끝의 '지부'·'지회' 무시, 비슷한 이름 꼬리 노조·지부·연맹·협의회 | 모두 | 노조가 아닌 이름에는 해가 없음. 유지(일반 꼬리 '주식회사·(주)' 추가는 후속) | 아니오 | 유지 | 하 |
| C12 | app/suborganizations.js:25-26 | 담당 지정이 없으면 `default_assignee_name`=내 이름으로 판정(1인 시절 잔재) | 사실상 운영자 | 유지(새 사용자는 값이 비어 영향 없음) | 아니오 | 유지 | 하 |
| C13 | app/calendar-ref-model.mjs:19-23, record-window-model.mjs:155 | 조직 참고 캘린더 '주요 일정' 낱말: 집회·농성·선전전·조정 신청·대의원회·결의대회·총회·투쟁, 빼는 낱말 중집 | 그 캘린더를 고른 사람 | B1과 같은 사람별 낱말 | 예(B1과 같이) | S67-51 ④(후속) | 중 |
| C14 | app/document-categories.js:14-23(LEGACY), app-router.js:14-16 | 옛 분류 맞춤(교섭자료·보도자료·'노조 서식'), `?view=media` → '성명·보도자료' | 옛 자료가 있는 사람 | 유지(호환) | 아니오 | 유지 | 하 |

## D. 홈·알림·폴더 이름·안내

| ID | 위치 | 지금 전제 | 영향 | 바꿀 방식 | DB | 담당 | 우선 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | app/org-quiet.js:84-100, journal.js:116, view-prefs.js:344 `quiet_weeks:3` | 홈 '연락 없는 조직'은 '연락'을 통화·텔레그램으로만 셈. 홈은 누구에게나 이 줄을 계산하는데, 기준 고르기는 통화·텔레그램이 있는 사람에게만 보임(suborganizations.js:89). 통화·텔레그램이 없는 사람이 주요 인물을 넣으면 모든 조직이 '3주째 연락 없음'으로 뜨고 끌 수도 없음 | 모두 | 서버 기능(calls·telegram)이 없으면 줄을 만들지 않음(같은 판정 `my-features.js`) | 아니오 | S67-51 #2820 | 상 |
| D2 | app/photos.js:8,1406,1922, photos-model.mjs:317, onedrive-photos/graph.ts:34 | 폴더 '.노조+ 휴지통', 폰 'Pictures/노조+/' | 모두 | 앱 이름 상수 + 옛 이름도 계속 찾기 | 아니오 | **S67-49** | 중 |
| D3 | app/record-backup.js:19-75, record-backup/model.mjs:14, _shared/hwp-edit.ts:41, files-auto-model.mjs:27-35, drive-summary/core.mjs:18-21 | Drive 폴더 '노조+ 백업'·'노조+ 편집 백업'·'노조+ 읽기용 사본' | 모두 | 앱 이름 상수 + 옛 이름 찾기 | 아니오 | **S67-49** | 중 |
| D4 | record-backup/model.mjs:34,117 | 백업 표 이름 "쟁의 단계"(`app_dispute_stages`) | 모두 | "진행 단계" | 아니오 | S67-43 | 하 |
| D5 | phone-push/handler.ts:537, ai-assist/handler.ts:266, global-search.js:227-244 | 알림 "노조+ · 시험 알림", "노동조합+에 물어보기" | 모두 | 앱 이름 상수 | 아니오 | **S67-49** | 하 |
| D6 | app/help-content.mjs, first-use.js | 쓰는 법·빈 화면 예시가 노조 업무(바다지회·들판분회, 임금 교섭, 단체협약안, '예시노조 예시지부') | 모두 | 중립 예시 | 아니오 | S67-43 | 중 |
| D7 | app/app-download.mjs:39-48, topbar-actions.js:60-67, login/index.html, index.html, brand/faces.mjs | '노조+ 파일 올리기', '노동조합 업무 보조' | 모두 | 얼굴 단어 | 아니오 | S67-43/49 | 하 |
| D8 | app/global-search*.js, 서버 `app_search_records` | 검색 동의어 표 없음(낱말 그대로) | 없음 | 해당 없음 | 아니오 | — | — |
| D9 | app/ask-web2-model.mjs:63, ledger-browse-model.mjs:13 | 원장 민감도 S2 이름 '교섭·전략'이 물어보기 근거 꼬리표로 나옴 | 모두(자동 원장) | '대외비·전략' 글자 | 아니오 | S67-43 | 하 |
| D10 | app/record-window-model.mjs:20-21 `RECORD_ONE_FROM='2026-11-09'` | 전환 주 상수 | 모두 | 작업공간 만든 날보다 앞이라 무해. 유지 | 아니오 | 유지 | 하 |

## E. 운영자 전용이라 유지 (목록만)

| 위치 | 전제 | 열리는 조건 |
| --- | --- | --- |
| collector-feed/telegram.ts:51-58, family.ts:35, context.ts:30-31 `OWN_ORG`, call-analysis.ts:134 | 운영자 소속·직책·이름, 업무 낱말(의원실·기자·지부·연맹·국회) | 서버 `app_operator_features`(telegram·calls·family) |
| ai-assist/call-refill.ts:80-84, journal-memorable.ts:124-128 | 통화 예시, "남의 단체 성명" | `hasFeature(calls/telegram)` |
| ai-assist/hwp-convert.ts:63 | "A노조 본부 문서" | `ppwu_forms` 기능 |
| ai-assist/home-day-picks.ts:155, now-detail.ts:285, _shared/now-detail-build.ts:269-288 | 뉴스 고르기·시사점 칸(A노조 운동·한국 노동운동) | `outside` 기능(now-detail은 재료가 운영자 작업공간에만 있음 — 일반에 열 때 시사점 칸을 사람별로) |
| outside-feed/*, _shared/outside-catalog.ts, outside-tidy.ts, news-rank.ts, news-catalog.ts, news-feed, phone-push/now-line.ts | 노동·진보 단체 출처, 노동 낱말 등급, '새 성명' | `outside` 기능 |
| drive-summary/core.mjs:13,31-36, ledger-export.mjs | 작업공간 이름 고정, 조직 정렬 순서에 특정 노조·회사 이름 | 운영자 작업공간 고정(여럿이 쓰게 되면 각자 담당 순서로 — 후속) |
| app/feed-model.mjs:153-191, call-feed.js | `OWN_ORG='A노조'`, 조직 꼴 낱말 | 메뉴 기능 calls |
| app/tg-mark-model.mjs, forget-list.js:51, home-summary.js:26,73 | 텔레그램 일정 낱말, '소식(텔레그램/통화)' | telegram·family 기능 |
| app/now-model.mjs, news-colors.mjs, notice-outside*.js, outside-statements*.js | News 탭·묶음·공대위 | outside 기능 |
| app/ledger-import-model.mjs, ledger-fix.js, ledger-candidate-model.mjs | 원장 고정 목록(교섭 논거·교섭자료·상대측 발언) | 원장 메뉴는 모두에게서 뺌(menu-model.mjs:33) |

범위 밖 발견(고치지 않음): 브리핑 룸(document-actions brief-start/step)과 page-ai-draft에는 서버 기능 검사가 없다 — 운영자 전용이 아니라 누구나 부를 수 있는 함수로 판정했다(A12·A23).

## 줄 세운 PR 계획

1. **문서** #2817: 이 표.
2. **홈 '연락 없는 조직'은 통화·텔레그램이 있는 사람만**(D1) #2820: 화면만, DB·Edge 없음.
3. **AI 지시문 공용 기록 주인 역할** #2821(A1~A5·A8~A11·A13~A15·A19·A21): `owner-role.ts`를 한 규칙으로(등록값: 프로필 소속+직책, 없으면 "업무 담당자"), 회의 사본도 같은 규칙. 지시문에 박힌 "노동조합 상근자/담당자/활동가"를 자리표로, 노조 예시를 중립으로. Edge 재배포(ai-assist·meeting-ai-draft·meeting-transcribe·document-ai-index·meeting-ai-ingest·library-files). 사용자: 프로필에 소속·직책이 있으면 "<소속> <직책>"이 되어 지금("노동조합 <직책>")보다 구체적. 확인 SQL(개수만)을 `docs/ops/`에.
4. **처음 쓰는 사람 기본값** #2823(C2·C5·A17): 진행 단계 기본 5개, 사진 종류 연결은 내 목록 이름 기준, 자료 AI 예시 중립. 사용자 자료는 이미 저장돼 있어 바뀌지 않음.
   - 후속: 자료실 기본 분류(C1·A16) — 칸 기본값 migration 짝 + 화면 + Edge를 한 번에, 시험 기준 목록을 '이미 쓰는 사람' 고정값으로 옮기며.
5. **④ 판단 낱말 사람별 설정**(B1·C13, 후속): `view_prefs`에 '주요 일정 낱말' 키 + DB 키 검사 migration. 사용자 값은 지금 낱말 그대로 넣는 일회 SQL 짝(`docs/ops/`).
6. 후속(사용자 결정 뒤): B2·B3(바탕 엔진 자리 선택화·내 양식 한글 출력), B6~B8, C6·C7, A20·A22.

## 사용자 결정 필요

1. **주간 보고 노조식 칸**(임원 배정 요청·상집 논의 요청·투쟁 사업장 현황·산하 조직 현황): 지금도 새 사람에게는 '내 양식'이 먼저 나와 바로 보이지는 않습니다. WORK ON 기본에서 이 칸들을 아예 빼고(바탕 파일이 있는 사용자만), 대신 '내 양식'에서도 한글 파일을 만들게 할까요? (추천: 예)
2. **쟁의 단계**: 새 사람에게 '진행 단계'(시작 전·진행 중·주의·마무리) 같은 중립 세트를 넣을까요, 아니면 처음엔 비워 두고 본인이 만들게 할까요? (추천: 중립 세트)
3. **묶음 만들 때 '소속명' 필수**: 부서 묶음에도 노조명이 꼭 있어야 하는 지금 규칙을 풀까요? (DB 변경)
4. **AI가 부르는 내 역할**: 프로필의 소속+직책으로 부릅니다(예: "○○회사 기획팀장"). 사용자는 소속 칸 값에 따라 "노동조합 부팀장" → "<소속> 부팀장"으로 바뀝니다. 괜찮을까요?
