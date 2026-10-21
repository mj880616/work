# 업무 원장 Web2 이전 설계 (AI-서버연동 S7)

📱 폰 경로 C — S7-a(이 문서 + DB 표 migration 초안 + 로컬 시험)만 이번 PR에 있다. 운영 DB·Edge·Drive에는 접근하지 않았다.

- 작성: 2026-10-21, Claude Code. 기준 main `757280c`.
- 원장 행: `docs/roadmap.md` AI-서버연동(S7), 관련 CHAT-이관·MCP-Claude읽기·DOC-AI역할개정·OPS-수집점검.
- 앞 설계: [ai-server.md](ai-server.md) 7절(A안·표 초안·이전 단계). 이 문서가 7.2 표 초안과 7.3 단계를 대신한다.
- 근거: 2026-10-21 사용자 결정(원장 쓰기 = Web2 AI 후보 → 명진 확정, Claude는 가져오기 파일만, 매주 Drive 내보내기, MCP는 보안 설계 먼저)과 이전 계획 문서("ChatGPT 업무 맥락 Web2·Claude 이전 계획", 저장소 밖) 1-1·5·7·11절.
- 공개 저장소라 실제 조직·사건·원장 ID·내용을 쓰지 않는다. 예시는 "가상 노선", "가 지부", `EVT-09xx`처럼 만든 값만 쓴다.

---

## 명진이 정할 것

| # | 정할 것 | 추천안 |
| --- | --- | --- |
| L1 | 시트의 "관심 정보"(업무 밖 소식)를 어떻게 할까 | **원장에 함께 넣되 "관심" 표시**. 검색은 기본으로 업무만 보이고, 관심은 따로 골라야 보임. 버리면 다시 찾을 길이 없음 |
| L2 | 검색인덱스 탭 | **가져오지 않음**. 기록마다 제목·요지를 베낀 표라 원본과 어긋나 있음. 대신 Web2 검색이 기록·주제·조직·출처를 한 번에 찾음. 탭 안의 "관련업무" 글자는 업무주제 사전을 만들 때 재료로만 씀 |
| L3 | 설정 탭 규칙 문장 60여 개 | **Web2 노트 "운영지침" 폴더로 옮김(손으로, 가져오기 아님)**. 마지막 수집 시각 같은 실행 상태값은 버림 |
| L4 | 수집대상·수집로그·수집파일인덱스·피드백 탭 | **가져오지 않고 시트 사본으로 보관**(읽기 전용). 수집기를 다시 만들 때 새로 설계 |
| L5 | 업무주제 사전 30~40개를 누가 만들까 | **Claude가 시트의 분야·관련업무 글자를 묶어 초안 → 명진이 표에서 고침 → 가져오기 파일에 포함** |
| L6 | 출처 문서종류·근거 유형처럼 시트에 수십 종이 섞인 칸 | **아래 4절 고정 목록으로 Claude가 대응표를 만들고, 애매한 것은 "기타"로**. 명진은 대응표만 훑어봄 |
| L7 | 원장 고정 ID 번호 | **시트 ID 그대로 유지**(접두어+번호). Web2에서 새로 생기는 기록은 그 탭의 가장 큰 번호 다음부터. 빈 번호는 다시 쓰지 않음 |
| L8 | 이전 뒤 시트 | **보기만 가능한 보관본으로 둠**(공유 0건 확인). 지우지 않음 |
| L9 | 민감도 S3(조합원·제3자 개인정보 등) | **원장·후보 어디에도 저장하지 않음**. 가져오기·AI가 S3로 본 항목은 버리고 "민감으로 제외 ○건"만 보고 |

---

## 1. 지금과 옮긴 뒤

| | 지금(2026-10-21) | 옮긴 뒤 |
| --- | --- | --- |
| 원장 원본 | Google 시트(사건DB), 쓰는 주체 없음(동결) | Web2 DB `app_ledger_*` 표 |
| 원장에 들어가는 문 | (없음 — ChatGPT writer 삭제) | **하나: Web2 [원장 후보] 화면에서 명진이 확정** |
| 매일 소량 | — | Web2 `ai-assist`가 바구니·전사·회의를 읽고 후보를 만듦(S7-c) |
| 대량(시트 이전·ChatGPT 대화 이관) | — | Claude가 가져오기 파일을 만들고 명진이 Web2 [원장 가져오기]에 올림(S7-b). Claude는 Web2에 직접 쓰지 않음 |
| Claude가 원장을 읽는 길 | 시트 연결 | 매주 Drive 내보내기 파일(S7-d) → 나중에 MCP-Claude읽기 |
| 검색 | 시트 검색인덱스 탭(손으로 맞춤) | `app_ledger_search` RPC |

## 2. 표 목록

모든 표에 `workspace_id`가 있고, 행 접근은 소유자(`private.app_is_workspace_owner`)만 한다(5절).

| 표 | 시트 탭 | 하는 일 | 지우기 |
| --- | --- | --- | --- |
| `app_ledger_records` | 사건·변화기록·결정·근거·약속 | 원장 기록 한 줄. `kind`로 종류를 나눔 | 안 지움(대체·폐기). 예외 7.3 |
| `app_ledger_sources` | 출처 | 원문 위치·처리범위·처리상태. 원문은 복제하지 않음 | 안 지움(폐기 표시) |
| `app_ledger_organizations` | 조직 | 원장 조직(ORG ID 유지) + Web2 담당조직 연결(선택, 1:1) | 안 지움 |
| `app_ledger_topics` | (새로) | 업무주제 사전: 이름·별칭·Web2 프로젝트 연결 | 안 지움(은퇴 표시) |
| `app_ledger_record_sources` | 각 탭의 출처 칸 | 기록-출처 연결표: 출처마다 한 줄, 근거위치도 그 줄에 | 뗄 수 있음(감사 기록에 남음) |
| `app_ledger_links` | 조직연결 + 비고 속 관계 | 기록 간 연결표: 기록→기록·조직·Web2 프로젝트·회의 | 뗄 수 있음(감사 기록에 남음) |
| `app_ledger_candidates` | 쓰기요청(역할) | 원장 후보: 대기 → 확정·버림 | 안 지움 |
| `app_ledger_audit` | 쓰기요청(옛 행) | 감사 기록: 옛 쓰기요청, 고치기 전 값, 지운 연결, 후보 결정 | 쌓기만 함 |
| `app_ledger_imports` | — | 가져오기 묶음(파일 지문·개수·상태) | 안 지움 |
| `app_ledger_id_counters` | — | 탭별 접두어와 마지막 번호 | 안 지움, 번호는 줄지 않음 |

같은 표에 사건·결정·근거·약속을 둔 이유: 검색·연결·후보가 종류를 넘나들고(결정이 사건의 후속, 근거가 결정을 뒷받침), 공통 칸(제목·요지·기준일·주제·민감도·유효상태)이 대부분이다. 종류별 칸은 CHECK로 "그 종류에서만" 채우게 막았다.

## 3. 칸

### 3.1 원장 기록 `app_ledger_records`

| 칸 | 내용 | 비고 |
| --- | --- | --- |
| `kind` | event 사건 / change 변화기록 / decision 결정 / evidence 근거 / commitment 약속 | 만든 뒤 못 바꿈 |
| `ledger_id` | 고정 ID(`EVT-0901` 모양) | 3.6절. 만든 뒤 못 바꿈 |
| `title`·`summary` | 제목(300자)·요지(4,000자) | |
| `scope` | work 업무 / interest 관심 | L1. 검색 기본은 업무 |
| `topic_id` | 업무주제 사전 | 하나만. 여러 주제가 필요하면 연결표에 다른 기록으로 |
| `sensitivity` | S0 공개 가능 / S1 내부 업무 / S2 교섭·전략 | S3은 저장 안 함(L9) |
| `importance` | very_high 매우높음 / high 높음 / normal 보통 / low 낮음 | 시트 "중간" → 보통 |
| `validity` | current 현재유효 / fulfilled 이행완료 / superseded 대체 / retired 폐기 / needs_check 확인필요 | 시트 "유효" → 현재유효 |
| `confidence` | high / medium / low (선택) | 시트 "부분확인" → `verification` |
| `verification` | verified 확인 / partial 부분확인 / unverified 미확인 (선택) | |
| `date_start`·`date_end`·`date_precision`·`date_note` | 기준일 정밀도: day 일 / month 월(1일) / year 연(1월 1일) / range 기간(시작<끝) / unknown 모름(날짜 없음) | 시트의 "2021~2025", "2026-09", "○○ 이전(정확일 미확인)"은 정밀도 + 원래 표기(`date_note`)로 |
| `event_status` | tracking 추적중 / watching 관찰 / closed 종료 / on_hold 보류 | 사건만, 사건이면 꼭. 시트의 상태·계속추적 두 칸을 하나로 |
| `decision_type`·`decision_reason` | adopted 채택 / rejected 기각 / on_hold 보류 / changed 변경 + 이유 | 결정만(옛 결정은 비어도 됨). "폐기한 방안과 이유"의 자리 |
| `evidence_type` | law 법령 / statistics 통계 / budget 예산 / agreement 합의문 / precedent 판례·선례 / gov_position 정부 입장 / counterpart_statement 상대측 발언 / field_fact 현장 사실 / argument 교섭 논거 / other 기타 | 근거만. 시트 96종 → 10개(L6) |
| `counterparty`·`commitment_status`·`follow_up_on` | 상대측·이행상태(waiting 대기 / fulfilled 이행 / broken 불이행 / cancelled 취소)·후속확인일 | 약속만, 약속이면 상대측·이행상태 꼭. 기한 지남은 저장하지 않고 조회 때 계산 |
| `superseded_by`·`supersede_reason` | 대체한 기록·이유 | 대체기록이 있으면 유효상태 = 대체, 그 반대도 |
| `note` | 비고 | |
| `import_id` | 가져온 묶음 | 만든 뒤 못 바꿈 |
| `created_at`·`updated_at` | 만든 때·고친 때(DB가 적음) | |

변화기록의 "신문반영일"(아침신문 전용)은 가져오지 않는다. 변화기록이 어느 사건에 속하는지는 연결표 `belongs_to`로 둔다.

### 3.2 출처 `app_ledger_sources`

제목, `doc_type`(meeting_material 회의자료 / minutes 회의록 / official_letter 공문 / news 기사 / statement 성명·보도자료 / law 법령 / gov_report 정부·기관 보고서 / bargaining 교섭자료 / call_transcript 통화 전사 / telegram 텔레그램 / email 메일 / ai_chat AI 대화(사용자 발언) / internal_doc 내부 문서 / other 기타), 위치(글자, 2,000자), Drive 파일 ID(선택), 출처 날짜, 처리범위, 처리상태(unprocessed / partial 부분처리 / done), 민감도, 비고, 상태(active / retired).

### 3.3 조직 `app_ledger_organizations`

ORG ID, 이름, 별칭(최대 20개), Web2 담당조직 연결(선택, 같은 작업공간, 한 담당조직에 원장 조직 하나), 비고, 상태. 시트의 "Web2연결ID"가 이 연결 칸이 된다.

### 3.4 업무주제 사전 `app_ledger_topics`

TOP ID, 이름(작업공간 안에서 겹치지 않음), 별칭, 설명, Web2 프로젝트 연결(선택, 같은 작업공간), 상태, 순서. 30~40개를 목표로 한다(L5).

### 3.5 연결표 2종

- **기록-출처** `app_ledger_record_sources`: 기록 1 — 출처 1 — 근거위치(쪽·조항·시각, 500자). 같은 기록·출처라도 근거위치가 다르면 여러 줄. 시트의 "SRC-0907~SRC-0909" 같은 범위 표기는 가져오기 때 한 줄씩 풀어 쓴다.
- **기록 간** `app_ledger_links`: 기록 하나에서 대상 하나(기록·원장 조직·Web2 프로젝트·Web2 회의 중 정확히 하나)로.

| 대상 | 관계 고정 목록 |
| --- | --- |
| 기록 | belongs_to 소속(변화기록 → 사건) / follow_up 후속 / supports 뒷받침 / contradicts 반박 / related 관련 |
| 원장 조직 | direct 직접관련 / joint 공동사업 / counterpart 상대기관 / reference 참고 / other 기타 (시트 15종 → 5개) |
| Web2 프로젝트·회의 | related 관련 |

자기 자신 연결과 같은 연결 두 번은 거절한다. Web2 프로젝트·회의가 지워지면 그 연결만 사라지고 감사 기록에 남는다(기록은 그대로).

### 3.6 고정 ID

- 모양: 탭 접두어 + `-` + 4~6자리 숫자(4자리 미만은 0으로 채움). 같은 번호를 다른 모양(`EVT-0912`와 `EVT-00912`)으로 두 번 쓸 수 없다.
- 접두어는 작업공간별 번호표(`app_ledger_id_counters`)에 종류마다 하나. **실제 접두어는 이전 당일 시트 설정 탭(id_rule)에서 그대로 옮긴다**(시험은 가상 접두어 사용).
- 새 행: ID 칸을 비우면 DB가 "그 종류의 가장 큰 번호 + 1"을 붙인다. 화면·AI가 번호를 정하지 못한다.
- 가져오기 행: 시트 ID를 그대로 넣는다(가져오기 묶음이 있을 때만 직접 적을 수 있음, 접두어가 맞아야 함). 더 큰 번호가 들어오면 번호표가 따라 올라간다.
- 번호표는 줄어들지 않는다(트리거). 행이 지워져도(7.3) 그 번호는 다시 쓰지 않는다 = 빈 번호 재사용 금지.

## 4. 원장 후보 `app_ledger_candidates`

| 칸 | 내용 |
| --- | --- |
| `origin` | web2_ai Web2 AI(ai-assist) / claude_import Claude 가져오기 파일(가져오기 묶음이 꼭 있음) / user 명진 직접 |
| `status` | pending 대기 / confirmed 확정 / discarded 버림. 한 번 정하면 못 바꿈(트리거) |
| `action` | new 새 기록 / add_source 기존 기록에 출처 추가 / update 기존 기록 고침 / supersede 기존 기록 대체. new가 아니면 대상 기록이 꼭 있음 |
| `kind`·`title`·`sensitivity` | 목록 표시용. 민감도는 S0~S2(L9) |
| `payload` | 기록 칸·연결·출처 묶음(JSON, 64KB). 모양 검사는 S7-c 확정 함수 |
| `dedup_key` | 중복 열쇠(날짜\|조직\|주제 모양). 같은 열쇠의 대기 후보는 하나만 |
| `result_record_id`·`discard_reason`·`decided_at` | 확정이면 만든·고친 기록, 버림이면 이유 |

확정 처리(후보 → 기록·연결·출처 쓰기 → 후보 확정)는 S7-c에서 SECURITY INVOKER 함수 하나로 한 거래 안에서 한다. 이번 표는 그 함수 없이도 소유자 권한·RLS로 같은 쓰기를 할 수 있다(화면이 아직 없음).

## 5. 권한

- 표 10개 모두 RLS 켬. 정책은 표마다 owner 하나(`private.app_is_workspace_owner(workspace_id)`, authenticated만).
- PUBLIC·anon·service_role 권한 없음(호스팅 기본 권한을 먼저 걷어 냄). Edge 함수(ai-assist 포함)는 지금처럼 명진 로그인 토큰으로 읽고 쓴다. 공유 페이지(`share-page-read`)·Web1 함수는 이 표를 읽을 수 없다.
- authenticated에는 필요한 동작·칸만: ID·workspace·종류·가져오기 묶음·만든 때는 UPDATE 칸 목록에서 뺐다. 감사 기록은 UPDATE 권한이 없다.
- 지우기: 원장 행(기록·출처·조직·주제)과 옛 쓰기요청 감사 행은 **확인 전(applied) 가져오기 묶음에서 들어와 고친 적 없는 것만**(되돌리기 전용 제한 정책). 연결 두 표는 떼기 가능. 지운 행은 모두 감사 기록에 남는다.
- 원장 표끼리 참조는 `(workspace_id, id)` 묶음 외래 키다. 없는 행·남의 작업공간 행을 가리키면 RLS와 상관없이 DB가 거절한다(23503). Web2 프로젝트·회의는 기존 `private.app_space_in_workspace`·`private.app_meeting_in_workspace`, 담당조직은 같은 작업공간 확인을 정책에 넣었다.
- 함수 6개 모두 SECURITY INVOKER·`search_path = ''`. **SECURITY DEFINER 없음.** 트리거 함수 5개는 누구에게도 실행 권한이 없고(트리거로만), 검색 함수만 authenticated 실행.
- 고정 ID 트리거는 authenticated가 남의 작업공간에 넣으려 하면 번호표를 보기 전에 `42501`로 멈춘다(번호 존재 여부를 알리지 않음).

## 6. 이력

- 원장 내용은 지우지 않는다. 틀린 기록은 `validity = retired`(폐기), 바뀐 결정은 새 기록 + 옛 기록 `superseded`(대체, 대체기록·이유 꼭).
- 기록·출처·조직·주제를 고치면 **바뀐 칸의 고치기 전 값**이 `app_ledger_audit`에 `row_update`로 쌓인다(트리거). 연결을 떼거나 행이 지워지면 행 전체가 `row_delete`로 남는다.
- 후보를 확정·버리면 `candidate_decided`.
- 시트 쓰기요청 117행은 `legacy_write_request`로 가져온다(옛 ID·상태·날짜·요지를 `detail`에). 같은 옛 ID는 한 번만.
- 가져오기 묶음의 적용·확인·되돌리기는 S7-b 화면이 `import_applied`·`import_confirmed`·`import_reverted`로 남긴다.

## 7. 가져오기 (S7-b, 이번에는 표만)

### 7.1 시트 탭 → 표

| 시트 탭 | 표 | 비고 |
| --- | --- | --- |
| 사건 | records(event) | 상태·계속추적 → `event_status` 하나. 분야 → 주제 사전 |
| 변화기록 | records(change) + links(belongs_to → 사건) | 출처 글자 → 출처 ID(못 찾으면 거부 목록). 신문반영일 버림 |
| 결정 | records(decision) | 유효상태·대체기록ID·대체사유 → `validity`·`superseded_by`·`supersede_reason` |
| 근거 | records(evidence) + record_sources | 유형 → 10개(L6), 근거위치 → 연결표 `locator` |
| 약속 | records(commitment) | 상대측·이행상태·후속확인일 |
| 출처 | sources | 문서종류 → 고정 목록 |
| 조직 | organizations | Web2연결ID → `suborganization_id` |
| 조직연결 | links(→ 조직) | 관계유형 15종 → 5개 |
| 쓰기요청 | audit(legacy_write_request) | 보류 8건은 이전 전 사유 확인 |
| 검색인덱스 | (가져오지 않음) | L2 |
| 설정 | (가져오지 않음) | L3, 접두어만 번호표로 |
| 수집대상·수집로그·수집파일인덱스·피드백 | (가져오지 않음) | L4 |

### 7.2 가져오기 파일 규칙

- 명진이 시트를 탭별 CSV로 내려받고, Claude가 대응표(L5·L6)를 적용한 **가져오기 파일 하나**(JSON, 표별 행 배열)로 만든다. 원문·파일은 저장소에 두지 않는다.
- Web2 [원장 가져오기] 화면(S7-b)이 파일을 읽어 **미리보기 → 검사 → 해 보기(dry-run) → 적용 → 확인** 순서로 진행한다.
- 검사(화면 + DB 둘 다):
  - 깨진 참조 거부: 파일 안 ID끼리 맞아야 하고(변화기록 → 사건, 근거 → 출처, 조직연결 → 조직), 없는 ID를 가리키면 그 행이 아니라 **묶음 전체를 거부**하고 목록을 보여 줌. DB도 묶음 외래 키로 한 번 더 막음.
  - 고정 목록 밖 값, 날짜 정밀도 규칙 위반, 빈 제목, S3 표시 → 거부.
  - 같은 ID 두 번, 이미 원장에 있는 ID → 거부(시트 이전) 또는 "기존 기록에 출처 추가" 후보로(ChatGPT 이관).
- 중복 실행 거부 표식: 묶음마다 파일 sha256을 `app_ledger_imports.file_sha256`에 적고, 같은 파일은 적용·확인 상태인 동안 다시 못 넣는다(유일 색인). 이미 들어간 ID도 유일 키로 막혀 두 번 들어가지 않는다(`rtw-note-copy-*`의 "이미 옮긴 표식 + 넣을 때 한 번 더 확인"과 같은 겹 장치).
- 해 보기: 같은 쓰기를 한 거래 안에서 해 본 뒤 개수표를 보여 주고 되돌린다(아무것도 안 남음).
- 적용: 한 거래(전부 아니면 전무). 묶음 상태 `applied`.
- 확인: 명진이 숫자 대조(시트 행 수 = 들어간 수 + 거부·제외 수) 뒤 [확인] → `confirmed`. 이후 그 묶음 행은 지울 수 없다.
- 되돌리기: `applied` 묶음만. 그 묶음에서 들어와 **고친 적 없는** 행만 지우고(제한 정책), 고친 행이 있으면 멈춘다. 상태 `reverted`. 지운 행은 감사 기록에 남고, 그 번호는 다시 쓰지 않는다.
- ChatGPT 이관(CHAT-이관 P4~P5)은 같은 파일 모양이지만 **기록이 아니라 후보**(`origin = claude_import`)로 들어간다. 30건 묶음, 명진이 후보 화면에서 확정.

## 8. 검색 RPC `app_ledger_search`

```
app_ledger_search(p_query, p_kinds, p_organization_id, p_topic_id, p_date_from, p_date_to,
                  p_max_sensitivity = 'S2', p_scope = 'work', p_include_inactive = false, p_limit = 50)
```

- 소유자만: SECURITY INVOKER라 기존 RLS가 그대로 걸린다. anon·service_role 실행 권한 없음.
- 글자 일치: 띄어 쓴 낱말(최대 6개)이 **모두** 들어 있는 기록. 대소문자 무시, `%`·`_`는 그냥 글자.
- 찾는 곳: 기록 ID·제목·요지·비고·결정이유·상대측·날짜 표기, 주제 이름·별칭, 연결된 조직 이름·별칭·ORG ID, 연결된 출처 ID·제목. 시트 검색인덱스가 하던 "별칭으로 찾기"를 원본에서 바로 한다.
- 필터: 종류, 조직(원장 조직 ID 또는 Web2 담당조직 ID), 주제, 기간(기준일 범위가 겹치면), 민감도 상한(기본 S2 = 모두, MCP·내보내기는 낮춰 부름), 범위(기본 업무, `null`이면 둘 다), 대체·폐기 포함 여부.
- 정렬: 제목에 맞은 낱말 수(+ID 정확히 일치 10점) → 기준일 최신 → ID. 요지는 앞 300자만 돌려준다.
- 잘못된 입력(200자 초과, 모르는 종류·민감도·범위, 거꾸로 된 기간, 상한 1~200 밖)은 `22023 LEDGER_SEARCH_*`로 거절.
- 1년 2,500건 규모(이전 계획 11-5)에서는 순차 검색으로 충분하다(추정). 느려지면 그때 `pg_trgm` 색인을 별도 DB 단계로 검토(확장 설치는 정지 지점).

## 9. 매주 Drive 내보내기 (S7-d)

- 목적: ① 백업 ② Claude가 원장을 읽는 길(MCP 전 단계).
- 방식: 기존 `drive-summary`의 Drive 읽기용 사본 폴더(`drive.file`, 공유 금지 검사)에 **원장 내보내기 문서** 추가. 매주 1회 예약(ORG-사본자동갱신과 같은 예약 경로) + Web2 [지금 내보내기].
- 형식(두 파일):
  1. `원장-YYYY-MM-DD.json`: 표별 전체 행(감사 기록 제외), 내보낸 시각·행 수·sha256. 되살리기(복구)용.
  2. `원장-읽기용` Google 문서(같은 이름 덮어쓰기): 주제별 → 종류별 기록 목록(ID·기준일·제목·요지·유효상태·연결 조직·출처 ID), 끝에 "기한 지난 약속" 표. Claude 읽기용.
- S2(교섭·전략)는 읽기용 문서에 제목·ID만(요지 빼기) — MCP 원칙("S2 이상 요지만")과 맞춤. JSON 백업에는 모두.
- 정지 지점: Edge 재배포(drive-summary), 예약 비밀값이 새로 필요하면 등록.

## 10. 이전 당일 절차 (S7-b 완료 뒤)

| 순서 | 할 일 | 누가 |
| --- | --- | --- |
| 1 | 시트 공유 설정 0건 확인, 시트 전체 사본 만들기(백업) | 명진 |
| 2 | 탭별 CSV 내려받기(7.1 표의 가져올 탭만) | 명진 |
| 3 | Claude가 가져오기 파일 + 대응표 + 거부·제외 목록 작성(저장소 밖) | Claude |
| 4 | Web2 번호표에 시트 접두어 등록(가져오기 화면 첫 단계) | 명진 |
| 5 | [원장 가져오기] 해 보기 → 개수표 캡처 → 커맨드센터 확인 | 명진 |
| 6 | 적용 → 숫자 대조(탭별 시트 행 수 = 들어간 수 + 거부·제외) | 명진 |
| 7 | 검색으로 몇 건 찾아보기, 기한 지난 약속 표시 확인 → [확인] | 명진 |
| 8 | 시트를 보기 전용 보관본으로(L8). Claude 메모리의 원장 위치 문장 갱신 | 명진·커맨드센터 |

시트는 이미 동결이라 이중 쓰기 위험은 없다. 5~6에서 이상하면 되돌리기 후 3부터 다시.

## 11. 다음 과제와 관계

| 과제 | 내용 | 정지 지점 | 앞뒤 |
| --- | --- | --- | --- |
| **S7-a**(이 PR) | 설계 + 표·권한·검색 migration + 로컬 시험 | **DB 적용**(SQL Editor) | — |
| S7-b | [원장 가져오기] 화면 + 가져오기 파일 검사기 + 해 보기·적용·확인·되돌리기 | 없음(쓰기는 S7-a 표·권한). 실제 가져오기는 명진 | S7-a 적용 뒤 |
| S7-c | [원장 후보] 화면 + 확정 함수(INVOKER) + 원장 목록·검색 화면 + `ai-assist`에 "원장 후보" 일 | **DB**(확정 함수), **Edge 재배포** | S7-b 뒤(후보가 기존 기록과 대조하려면 원장이 차 있어야 함) |
| S7-d | 매주 Drive 내보내기 | **Edge 재배포**, 예약 | S7-b 뒤 |
| CHAT-이관 | P1~P3(목록·선별·추출·대조)는 지금 병행, P4 등록은 S7-c 뒤 `claude_import` 후보로 | — | |
| MCP-Claude읽기 | 읽기 도구가 `app_ledger_search`를 명진 토큰으로 부름(민감도 상한 S1, S2는 제목만) | 보안 설계 먼저 | S7-d 뒤 |
| DOC-AI역할개정 | `ai-work-system-source-of-truth.md`의 원장 writer·약속 위치, AGENTS §2 문구 | 규칙 변경 승인 | S7-b 이전 당일 전 |
| OPS-수집점검 | "마지막 원장 후보 만든 시각", "마지막 내보내기 시각"을 점검 칸에 | — | S7-c·d 뒤 |
| BASKET-주간넘기기 | ChatGPT 넘기기 전제가 사라짐 → 원장 후보(S7-c)로 대체할지 | — | DOC-AI역할개정에서 |

## 12. 운영 DB에서 먼저 확인할 것 (읽기 전용, 명진 SQL Editor)

1. `docs/20261021082000_ledger_schema.precheck.sql` — 앞 9개 모두 "예", owner member count = 1.
2. `docs/20261021082000_ledger_schema.snapshot.sql` — 결과 저장(표 10개 absent, 원장 함수 없음).
3. 아래 한 덩어리(표·함수 이름 충돌, 읽생기와 공유하는 이름 확인):

```sql
select 'ledger-like tables' as item, coalesce(string_agg(relname, ', ' order by relname), '없음') as value
  from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname ~ 'ledger|sagun|event_db'
union all select 'same-workspace helpers', string_agg(p.oid::regprocedure::text || ':' || p.prosecdef::text, ', ')
  from pg_proc p where p.oid in (to_regprocedure('private.app_space_in_workspace(uuid,uuid)'), to_regprocedure('private.app_meeting_in_workspace(uuid,uuid)'))
union all select 'suborganizations columns', string_agg(attname, ', ' order by attnum)
  from pg_attribute where attrelid = 'public.app_suborganizations'::regclass and attnum > 0 and not attisdropped
union all select 'default ACL on public tables', coalesce(string_agg(defaclacl::text, ' / '), '없음')
  from pg_default_acl where defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r'
union all select 'server version', current_setting('server_version');
```

기대: ledger-like tables 없음, helpers 둘 다 `true`(SECURITY DEFINER, 기존 그대로), suborganizations에 `id, workspace_id`가 있음, server version 15 이상.

## 13. 적용과 되돌리기

- 파일: `supabase/migrations/20261021082000_ledger_schema.sql`, 짝 `docs/20261021082000_ledger_schema.{precheck,postcheck,snapshot,rollback}.sql`, `.summary.md`.
- 승인형 DB workflow는 쓸 수 없다(정책·트리거·표 grant를 검사기가 거절, 시험으로 확인). **SQL Editor(폰 경로 C) 전용.**
- 순서: 12절 확인 → 커맨드센터 승인 → 새 쿼리 창(+)에 migration 전체(약 52KB) 붙여 넣기 → 첫 줄 `begin;`·마지막 줄 `commit;`·프로젝트 확인 → 실행 → Success → postcheck 10줄 모두 "예".
- 한 덩어리로 실행한다(조각으로 나누지 않음). 붙여 넣기가 잘리면 `commit;`이 없어 아무것도 저장되지 않는다. 폰에서 52KB가 잘리면 PC로.
- 되돌리기: `docs/20261021082000_ledger_schema.rollback.sql`. 원장 표에 한 줄이라도 있으면 멈춘다(번호표 포함). 그때는 S7-b 되돌리기·내보내기로 보관한 뒤 따로 계획.

## 14. 남은 위험

- **확정 경로가 아직 없음**: 표만 있고 화면·확정 함수가 없다. 적용 뒤 S7-b 전까지 표는 비어 있다(위험 없음, 쓸모도 없음).
- **소유자는 화면 없이도 표를 직접 고칠 수 있음**: 지금 Web2 모든 표와 같은 수준. 원장 내용 지우기는 막았고, 고침은 감사 기록에 남는다.
- **감사 기록 크기**: 고칠 때마다 쌓인다. 1년 2,500건 규모에서는 작다(추정). 내보내기에서 감사 기록은 빼고 백업 JSON 크기를 본다.
- **검색 속도**: 순차 검색(8절). 수만 건이 되면 색인 필요.
- **payload 모양**: 후보 내용 JSON은 크기만 DB가 막는다. 모양 검사는 S7-c 확정 함수와 화면 몫이다.
- **시트 값 대응의 판단**: 96종 → 10종처럼 줄이는 대응표가 틀리면 분류가 어긋난다. 명진이 대응표를 훑어보고, 애매하면 "기타"로 두고 나중에 고친다(고침은 감사 기록에 남음).
