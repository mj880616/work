# 전체 검색 설계 (SEARCH-전체검색 ⓪ 조사·설계)

📱 폰 가능. 이 문서는 설계만이며 코드·DB·Edge 변경은 없다. 구현은 UI-상단줄(상단 줄에 검색칸 자리) merge 뒤 별도 세션.

- 요청: 2026-10-22 07:55, 승인 07:57·08:01. 두 단계 — ① 기록 검색 ② 첨부 파일 안 글자.
- 조사 기준: main `5b0ba276`(2026-10-22). production DB·Edge 접근 없음(웹 세션 규칙). 행 수·실제 칼럼은 저장소 migration·코드로만 확인했고, 확인하지 못한 것은 "미확인"으로 표시한다.
- 관련 진행 중: UI-상단줄 #950(상단 줄·검색칸 자리), LIB-AI자동분류 #959(자료실 올릴 때 AI가 빈 칸 채우기, 설계 문서 초안 단계).

## 0. 요약과 추천

1. ① 기록 검색은 **DB 검색 함수 한 개(RPC, `SECURITY INVOKER`) + 브라우저가 Google 일정·할 일을 따로 거르는 혼합**을 추천한다. DB에 있는 것(업데이트·노트·업무일지 한 줄·자료실·회의 결과·프로젝트·담당조직 기록·프로젝트 주요 일정)은 함수 한 번으로 종류별 건수와 앞 3건을 받고, Google 일정·할 일은 Google이 원본이라 이 기기 저장본(+일정은 검색할 때 한 번 더 읽기)에서 찾는다.
2. 권한 경계는 새로 만들지 않는다. 원장 검색(`app_ledger_search`)과 같은 모양(INVOKER, `anon`·`service_role` 권한 없음, 소유자 RLS 그대로)을 쓰고, 일기 제외는 **함수 안에서** 강제한다(화면 숨김 아님).
3. ② 첨부 안 글자는 새 표를 만들지 않는다. 사진 글자(`app_notes.attachments[].ocr.text`)는 이미 DB에 있어 ①에서 바로 찾을 수 있고, 자료실 파일 글자는 이미 있는 `app_documents.extracted_text` 칼럼을 쓴다. 채우는 길은 옛 `document-ai-index`(OpenAI 사용·앱 호출 없음·삭제 후보)를 살리지 않고, 업로드 때 한 번 읽는 새 경로로 하며 LIB-AI자동분류와 **글자 읽기 부분을 하나로 합친다**(4절 결정 3).
4. 화면은 검색 화면 전용 모듈 하나가 결과 창·전용 화면·모바일 전체 화면을 같은 그리기 함수로 그린다. 상단 줄 칸 자리는 UI-상단줄이 소유하고, 검색은 그 자리에 붙기만 한다.

## 1. 대상별 실제 저장 위치와 현재 검색

### 1.1 저장 위치

| 검색 종류(칩) | 대상 | 저장 위치 | 읽는 길 | 비고 |
| --- | --- | --- | --- | --- |
| 업데이트 | 바구니 메모(화면 이름 "업데이트") | `app_notes` `kind='basket'`, 글 `raw_text`, 첨부 `attachments` jsonb | Supabase REST(owner RLS) | 보류(`archived_at`) 포함 여부는 결정 5 |
| 노트 | 노트 | `app_notes` `kind='note'`, `title`·`raw_text` | REST | 폴더는 기기별 저장(검색 대상 아님) |
| 업무일지 한 줄 | 오늘 한 줄 | `app_notes` `kind='work'`, `raw_text`(줄 1~50개, `journal_day`) | REST | 칩은 별도로 두지 않고 "노트" 아래가 아닌 기록 묶음에 넣을지 결정 1 |
| (제외) | 일기 | `app_notes` `kind='diary'` | — | **검색 함수에서 `kind <> 'diary'`를 강제.** 종류 목록 받는 인자에도 `diary`를 허용하지 않는다 |
| 할 일 | Google 할 일 | **Google Tasks가 원본.** Edge `google-tasks` 경유. DB에는 연결 사본(`app_record_links`: 할 일 id·완료 여부만, 제목 없음)과 첨부(`app_task_attachments`: 파일 이름·Drive id) | Edge GET + 기기 저장본 `google-tasks-v2` | 제목·메모는 DB에 없음 |
| 일정 | Google 캘린더 일정 | **Google Calendar가 원본.** Edge `google-calendar` `events`(`timeMin`·`timeMax`, 서버 검색어 없음) | Edge GET + 기기 저장본 `calendar-events-v1` | 저장본은 설명 제외·본 범위 8개까지 |
| 일정 | 프로젝트 주요 일정 | `app_project_milestones`(`title`·`start_at`·`status`·`project_id`) | REST | Google과 연결된 칸도 있음(`20260925032810`) |
| 자료실 | 자료 | `app_documents`(제목·파일 이름·출처·분류·태그·설명·`project_id`·`organization_id`·`meeting_id`·`extracted_text`·`extraction_status`) | REST(자료실)·Edge `library-files`(올리기) | 파일 본문은 Drive. `app_documents` 정의는 이 저장소 migration에 없어(초기 기준 스키마) 칼럼은 코드·정책 파일에서 확인함 |
| 회의 결과 | 회의 | `app_meetings`(`title`·`series_name`·`round_no`·`meeting_at`, 결과는 `transcript_text`, 옛 기록은 `decisions`) | REST(`select=*`) | 회의 첨부는 `app_documents.meeting_id` |
| 프로젝트 | 프로젝트 | `app_spaces`(`name`·`parent_id`·`status`·`metadata`) + 진행 기록 `app_project_progress_updates`(`summary`·`effective_on`)·섹션·블록 | REST | 3단 구조(`parent_id`) |
| 담당조직 기록 | 조직 업데이트·타임라인·주간보고 | `app_suborganization_updates`(`raw_text`·`detail_text`·`occurred_at`)·`app_suborganization_timeline`·`app_suborganization_weekly_reports`·`app_suborganization_status_items` | REST | 조직 이름은 `app_suborganizations` |
| 첨부 안 글자 | 사진 | `app_notes.attachments[].ocr.text`(jpeg·png, 상태 `done`일 때, 최대 16,384자) | REST(노트 행에 포함) | 이미 저장됨 |
| 첨부 안 글자 | 자료실 파일 | `app_documents.extracted_text`(상한 50,000자) | REST | 채우는 앱 경로 없음(2.3 참고) |

연결 조직·프로젝트(결과 줄의 "연결된 곳")는 메모·할 일은 `app_record_links`(`note_id`/`google_task_id` → `project_id`/`organization_id`, `status='confirmed'`), 자료는 `app_documents.project_id`·`organization_id`, 회의는 `app_meetings`·연결 표로 얻는다.

### 1.2 지금 화면별 검색 (모두 "이미 읽어 둔 목록을 브라우저에서 거르기")

| 화면 | 방식 | 찾는 칸 |
| --- | --- | --- |
| 노트 | `basket-notes.js` `matches()` — 읽어 둔 노트 전부에서 `includes` | 제목·본문 |
| 자료실 | `library-upload.js` `luRenderLibrary()` — 읽어 둔 자료에서 `includes` | 제목·파일 이름·출처·분류·태그 (설명·본문 글자는 안 찾음) |
| 바구니 | `basket.js` (검색 4건 — 목록 거르기) | 읽어 둔 메모 |
| 고르기 창 | `choice-sheet.js` — 프로젝트·조직 이름 | 이름 |
| 원장 | `ledger-browse.js` → RPC `app_ledger_search` (낱말 AND 최대 6개, `strpos`) | 유일한 DB 쪽 검색. **설계 전례로 삼는다** |
| 일정·할 일·회의·업무일지·일기·프로젝트 | 화면 전체 검색 없음(프로젝트는 고르기 이름 검색만) | — |

즉 "전체"를 찾는 길은 지금 없고, 화면마다 이미 메모리에 올라온 것만 거른다. 전체 검색이 화면별 목록을 먼저 다 읽어 오는 방식이면 검색할 때마다 화면 수만큼 읽기가 생긴다.

## 2. ① 기록 검색 — 방식 비교

### 2.1 세 가지

| | A. 브라우저에서 각 출처 읽어 거르기 | B. DB 검색 함수(RPC) | C. 혼합(추천) |
| --- | --- | --- | --- |
| 동작 | 검색 때 노트·자료·회의·프로젝트·조직 기록을 REST로 전부 읽어 `includes` | 함수 하나가 DB 표 여러 개를 `ILIKE`로 찾아 종류별 건수+앞 N건을 돌려줌 | DB 것은 B, Google 일정·할 일은 브라우저가 저장본(+일정 한 번 더 읽기)에서 거름 |
| 한국어 부분 일치 | 쉬움(`includes`) | `ILIKE '%글자%'`(필요하면 `pg_trgm` 인덱스) | 둘 다 |
| 성능 | 기록이 늘수록 전송량·메모리 증가, 첫 검색이 느림. 폰에서 불리 | 필요한 줄만 전송. 표가 작으면 인덱스 없이도 충분, 커지면 trigram 인덱스 | B와 같음 + Google은 이미 있는 저장본 |
| 비용 | 읽기 요청 많음(Supabase 비용은 작으나 지연이 큼) | 요청 1회. 인덱스 저장 공간만 추가 | B + 일정 읽기 1회 |
| 권한 경계 | 지금 화면과 같음(owner RLS) | `SECURITY INVOKER`라 owner RLS 그대로. 일기 제외·종류 목록을 함수 안에서 강제 | 같음. Google은 기존 Edge 경로 그대로 |
| 새 위험 | 없음(그러나 일기 제외를 화면이 지켜야 함) | 함수 오류가 한 번에 여러 표에 영향. migration 필요(정지 지점) | 같음 |
| 본문 글자 검색(②와 연결) | 첨부 글자 5만 자 × 자료 수를 브라우저로 내려야 함 → 사실상 불가 | 서버에서 찾고 앞뒤 한 줄만 돌려줌 | 같음 |

**추천: C.** A는 ②(본문 글자)를 못 하고 일기 제외가 화면 규칙에만 의존한다. B만으로는 Google 원본 데이터(일정 제목·할 일 제목)를 못 찾는다.

### 2.2 Google 일정·할 일은 어디서 찾나

- **할 일**: `google-tasks-v2` 저장본(기기별, 로그아웃·계정 변경 때 runtime이 지움)에 이미 보이는 목록이 있다. 먼저 저장본에서 찾고, 저장본이 없거나 오래됐으면 검색 창을 열 때 Edge로 한 번 읽어 채운다(새 서버 검색 없음). 완료한 오래된 할 일은 Edge가 `completed_days`로 제한하므로 검색 범위는 "미완료 + 최근 완료"이며 결과 창에 그렇게 밝힌다(결정 4).
- **일정**: 저장본은 본 범위 8개뿐이라 검색에는 모자란다. 검색칸에 처음 글자를 쓸 때 **지난 3개월~앞 6개월**(결정 4에서 조정)을 기존 Edge `events`로 한 번 읽어 메모리에 두고 거른다. 새 Edge 함수·서버 검색어 추가 없음. 찾는 칸은 제목·장소이고 설명은 저장본에 없어 제외한다(설명까지 찾으려면 읽기 크기가 커져 결정 4).
- 프로젝트 주요 일정(`app_project_milestones`)은 DB 함수가 일정 칩에 함께 넣는다.
- 새 Google 데이터 사본 표를 DB에 만들지 않는다("같은 목적의 표 중복·새 저장소 금지" 규칙, 원본은 Google).

### 2.3 DB 검색 함수 설계 (구현은 별도 PR)

- 이름 예: `public.app_search_records(p_query text, p_kinds text[] default null, p_per_kind int default 3, p_offset int default 0, p_kind text default null)`. 한 함수가 (a) 종류별 건수+앞 N건(결과 창), (b) 한 종류 `p_kind` 의 `p_offset`부터 N건(전용 화면 "N건 모두 보기")을 돌려준다. 반환 칸: `kind, id, title, snippet, matched_in('title'|'body'|'attachment'), occurred_at, project_id, project_name, organization_id, organization_name, kind_total`.
- `language plpgsql stable security invoker set search_path = ''`, `revoke all … from public, anon, service_role; grant execute … to authenticated`(원장 검색과 같은 모양).
- 입력 검사: 길이 ≤ 200, 제어문자 거절, 낱말 최대 6개(공백으로 나눔, 모두 포함 = AND), `%`·`_`·`\`는 이스케이프한 뒤 `ILIKE '%…%'`. `p_kinds`는 허용 목록에 있는 값만(`diary` 불허).
- 순서: 종류 안에서 최근 것 먼저(`occurred_at desc`, 동률은 `id`). 관련도 점수는 쓰지 않는다(요청 "최근 것 먼저").
- 앞뒤 한 줄(`snippet`): 본문에서 찾은 첫 위치 앞뒤 각 약 40자를 서버가 잘라 보낸다(본문 통째 전송 안 함). 형광 표시는 브라우저가 `textContent`로 나눠 `<mark>`를 만든다(HTML 삽입 안 함).
- 찾는 칸: 노트 제목·본문, 메모·업무일지 본문, 자료 제목·파일 이름·출처·분류·태그·설명, 회의 제목·시리즈 이름·결과(`transcript_text`, 옛 `decisions`), 프로젝트 이름·진행 기록 요약, 조직 이름·업데이트·타임라인, 주요 일정 제목, 사진 글자(`attachments[].ocr.text`). 연결 조직·프로젝트 이름은 결과 줄 표시용이며 이름 자체를 찾는 칸에는 넣지 않는다(결정 1과 별개).
- 인덱스: 표가 작으면(1인 사용, 행 수는 S-1 직전 읽기 전용 확인 SQL로 측정, 미확인) `ILIKE`만으로 충분하다. 커지면 `pg_trgm` GIN 인덱스(`app_notes.raw_text`·`title`, `app_documents.title`·`extracted_text` 등)를 추가한다. `pg_trgm`은 한국어 3글자 미만 검색어에서는 인덱스를 못 타므로(전체 훑기) 검색어 최소 길이는 결정 2. `create extension`은 DB 정지 지점이다.
- 비용: 요청 1회, OpenAI 호출 없음.

### 2.4 비교 결론(성능·비용·권한)

- 성능: 폰 기준 C가 가장 낫다(전송량이 결과 줄 수에 비례). 입력 후 250ms 기다렸다 보내고(디바운스), 새 글자가 오면 앞 요청을 버린다(`AbortController` + 요청 번호, 기존 화면들의 `epoch` 규칙).
- 비용: Supabase 요청 1회 + (일정) Edge 1회. 추가 AI 비용 없음.
- 권한: 새 권한·정책 없음. 서버 쪽 경계는 RLS와 함수 안 종류 목록, 화면 쪽 경계는 일기 칩이 없는 것(이중이 아니라 서버가 최종).

## 3. ② 첨부 파일 안 글자

### 3.1 이미 있는 것

| 이미 있는 것 | 상태 | 쓰임 |
| --- | --- | --- |
| 사진 글자 읽기(BASKET-사진글자): Drive 임시 문서 OCR(`_shared/drive-ocr.ts`), 결과를 `attachments[].ocr.text`에 저장(jpeg·png, ≤16,384자, 상태 `done`·`empty`·`failed`) | 운영 중(자동 읽기+버튼) | **그대로 검색 대상.** 새 일 없음(①의 함수에 포함) |
| 노트 첨부(NOTE-파일붙이기) | 사진 글자 읽기 없음 | 노트 속 PDF·HWP 글자는 아직 없음 |
| `app_documents.extracted_text`·`extraction_status`·`extracted_at`·`extraction_error` | 칼럼 있음 | **저장 위치로 재사용** |
| `app_document_ai_index`(요약·키워드·`content_hash`·`chunk_count`)·`app_document_chunks`(2,400자 조각) | 표 있음 | 요약·조각용. 부분 일치 검색에는 필요 없음(별도 사용처 확인 전까지 건드리지 않음) |
| Edge `document-ai-index`(HWP·HWPX는 라이브러리로 직접 읽기, PDF·Office는 **OpenAI**로 읽기, 요약·조각 저장) | 운영 v3, **앱에서 부르는 곳 없음**, 2026-09-26 삭제 후보 | 살리지 않는다(아래) |
| `library-files`(올리기) | 업로드 때 제목 추정에 OpenAI 사용(옛 `OPENAI_API_KEY`), `extracted_text`는 쓰지 않음 | 업로드 시점 훅 후보 |
| `ai-assist`(새 열쇠 `WEB2_OPENAI_API_KEY`·소유자 확인·세 겹 한도) | 운영 | LIB-AI자동분류의 바탕 |

### 3.2 LIB-AI자동분류(#959)와 겹침

- 겹치는 곳: 둘 다 "자료실에 올라온 파일의 앞부분 글자를 읽는다". LIB-AI는 읽은 글자로 제목·날짜·저자·유형을 채우고, SEARCH ②는 같은 글자를 저장해 찾는다. 따로 만들면 같은 파일을 두 번 읽고(Drive 내려받기·OCR) 읽기 코드가 둘이 된다.
- 다른 곳: LIB-AI는 앞 몇 쪽이면 충분하고 AI 호출이 있다. SEARCH는 전체 글자가 필요하고 AI 호출이 필요 없다.
- 확인 한계: #959 설계 문서는 아직 제목·바탕만 있어(2026-10-22 기준) 읽기 방식은 미확인이다.
- 추천(결정 3): **글자 읽기 함수 하나를 먼저 만드는 쪽이 소유**하고 다른 쪽은 쓰기만 한다. 읽은 전체 글자는 `app_documents.extracted_text`에 저장하고, LIB-AI는 거기서 앞부분을 AI에 넘긴다. #959가 먼저 merge되면 SEARCH ②는 그 읽기 코드를 쓰고, 아니면 SEARCH ②-b가 만든 읽기 코드를 LIB-AI가 가져다 쓴다(줄 세우기 규칙). 두 PR이 같은 Edge 파일(`library-files`)을 동시에 고치지 않는다.
- 옛 `document-ai-index`는 OpenAI 옛 열쇠를 쓰고 앱 호출이 없어, 살려서 쓰기보다 삭제 후보 그대로 두고 새 경로로 대체한다(삭제는 별도 정지 지점).

### 3.3 읽는 방법 (추천)

| 파일 | 방법 | 비용 |
| --- | --- | --- |
| txt·md·csv·json·log·xml | 그대로 디코딩 | 없음 |
| HWP·HWPX | Edge 안 라이브러리(`document-ai-index`가 쓰던 `@ssabrojs/hwpxjs`) | 없음 |
| PDF·docx·pptx·xlsx·사진 | **Drive 변환 OCR/텍스트 추출**(`drive-ocr.ts`와 같은 임시 문서 방식을 문서 형식으로 확장, 끝나면 임시 문서 삭제) | OpenAI 비용 없음. Drive 용량·시간 사용 |
| 음성·영상 | 대상 아님(전사는 별도 시스템) | — |
| 25MB 초과 | 건너뛰고 `extraction_status='skipped'` | — |

PDF·Office를 OpenAI로 읽는 길(옛 `document-ai-index`)은 비용·외부 전송 때문에 기본으로 쓰지 않는다. Drive 변환이 읽지 못한 파일만 나중에 `ai-assist` 한도 안에서 쓸지는 별도 결정(결정 3 밑).

### 3.4 저장 칼럼/표

- 자료실 파일: `app_documents.extracted_text`(+기존 `extraction_status`·`extracted_at`·`extraction_error`). **새 표 없음.** 5만 자 상한은 기존 `cut()` 규칙 유지.
- 노트 사진: 기존 `attachments[].ocr.text`.
- 노트 안 PDF·HWP: 지금 글자 저장 칸이 없다(`app_notes_attachments_check`가 `ocr`를 jpeg·png에만 허용). 두 길 중 선택 — (1) 노트 첨부를 [자료로 넣기]하면 자료 행이 되어 자료실 길을 탄다(DB 변경 없음, 추천), (2) CHECK를 넓혀 노트 행에 저장(app_notes DB 정지). 결정 6.
- 할 일 첨부(`app_task_attachments`): 파일 이름만 ①에서 찾고, 안 글자는 자료실의 '할 일 첨부' 폴더 파일이 자료 행이면 같은 길, 아니면 대상 밖(미확인 — 구현 전 `google-tasks` Edge의 첨부 등록 경로 확인).
- 검색 인덱스: `extracted_text`에 `pg_trgm` GIN 인덱스(5만 자 × 자료 수만큼 커짐, 크기는 행 수 확인 뒤 결정). 필요 없으면 `ILIKE` 순차 훑기로 시작.

### 3.5 색인 갱신 시점

1. 새 업로드: `library-files`가 Drive에 올린 직후 글자 읽기를 한 번 부른다. 읽기 실패는 올리기를 실패시키지 않고 `extraction_status='failed'`와 코드만 남긴다(올린 파일은 그대로).
2. 기존 자료 채우기(backfill): 사용자가 확인한 목록(건수·종류·예상 시간)을 보고 한 번에 몇 건씩 돌리는 승인형 작업. 건수 확인(읽기 전용) → 시험 1건 → 전체. LIB-AI 전수 정리와 같은 목록 화면을 쓰는지는 #959 확인 뒤.
3. 파일이 바뀔 때: 자료실의 파일 교체·이름 변경은 `file_id`가 같으면 그대로, 바뀌면 `extraction_status`를 `pending`으로 되돌리고 다시 읽는다.
4. 자료를 지우면 같은 행의 칼럼이라 함께 사라진다(고아 없음). 사진 글자는 메모 행과 함께.
5. 검색은 읽기만 하고 읽기를 일으키지 않는다.

### 3.6 정지 지점

| 단계 | 정지 이유 | 복구 |
| --- | --- | --- |
| DB: `pg_trgm` 확장+검색 함수+인덱스 (S-1) | DB migration, 승인형 `db-migration-apply` | `rollback.sql`(함수·인덱스 drop, 확장은 남겨도 됨) |
| DB: `extracted_text` 인덱스 (②-a) | DB migration | 인덱스 drop |
| Edge: 글자 읽기 경로 배포 (②-b, `library-files` 변경) | Edge 배포 승인 | 직전 ref로 재배포(roadmap에 기록된 되돌리기 ref 방식) |
| 비밀값 | 없음(Drive 자격은 이미 서버에 있음). OpenAI를 쓰기로 바꾸면 `WEB2_OPENAI_API_KEY` 한도 설정이 정지 지점 | — |
| 기존 자료 채우기 실행 | production 데이터 변경(대량) | `extracted_text`를 null·`pending`으로 되돌리는 SQL을 미리 준비 |

각 단계는 AGENTS.md §7의 3줄(무엇이 바뀌나 / 잘못되면 어떻게 되나 / 되돌리는 방법)을 먼저 제시한다.

## 4. 화면 구조와 소유권

### 4.1 소유권(ARCHITECTURE 규칙 적용)

| 대상 | 소유자 | 근거 |
| --- | --- | --- |
| 상단 줄 검색칸 자리(`[data-search-slot]`) | UI-상단줄(`topbar-actions.*`, #950) | 상단 줄은 그 과제가 소유. 검색은 칸 자리에 `mount`로 붙기만 하고 상단 줄 마크업을 고치지 않음 |
| 검색칸 입력·결과 창·종류 칩·묶음·전용 화면·모바일 전체 화면의 DOM 전부 | **새 모듈 `global-search.js` 하나**("검색 renderer") | "한 곳이 유일한 renderer" 규칙. 결과 창·전용 화면·모바일 화면은 같은 `renderGroups()`를 다른 컨테이너에 쓴다. 결과 창 = 묶음당 3건, 전용 화면 = 한 종류 전체(더 보기) |
| 검색어 나누기·이스케이프·형광 구간 계산·Google 저장본 거르기·정렬/병합 | `global-search-model.mjs`(DOM·네트워크 없음) | 기존 `*-model.mjs` 방식, Node 시험 |
| 네트워크(RPC·Edge 일정 읽기·저장본 읽기) | `global-search-data.js` | 기존 `runtime-client.js` 공용 API 사용(자체 세션·갱신 금지) |
| 전용 화면 이동 | `app-router.js` 한 곳(`?view=search&q=…&kind=…`; `KPTURouter.go('search')`) | 화면 전환은 라우터 단독. 검색 모듈은 `KPTURouter.on('search', …)`만 씀 |
| 모바일 [메뉴] 창 맨 위 검색칸 | 메뉴 판은 라우터 소유. 검색칸은 누르면 전체 화면 검색을 여는 입구 | 입력 자체는 전체 화면에서(자판 처리는 `KPTUA11y.keyboard` 공용) |
| 뒤로 가기 | 규칙 그대로: 열린 것(결과 창·전체 화면)마다 같은 주소 기록 1개, 뒤로 가기는 가장 위의 것 하나만 닫음 | 모바일 전체 화면의 ← 는 같은 닫기 |
| 홈 | 검색칸 없음 | 요청 |

### 4.2 동작

- 결과 창: 맨 위 종류 칩(전체·업데이트·노트·할 일·자료실·회의 결과·일정 + 건수), 종류별 묶음 2~3건 + "N건 모두 보기". 묶음 제목은 옅은 바탕 한 줄 띠(아이콘+굵은 이름+오른쪽 건수), 위아래 구분선, 결과 줄은 한 칸 들여쓰기. 줄: 종류 아이콘·제목(찾은 단어 형광)·날짜·연결 조직/프로젝트, 본문에서 찾았으면 앞뒤 한 줄. 색·글자·모서리는 `theme-tokens.css`의 `--ds-*`만 사용(새 값 만들지 않음). 칩은 공용 `filter-chips.js`.
- 키보드: ↑↓로 줄 이동(칩·묶음 제목은 건너뜀), 엔터로 열기, Esc로 닫기. 결과 줄은 `role="listbox"`/`option`, 검색칸은 `aria-activedescendant`. 열기 = 해당 화면의 상세로 이동(기존 `KPTURouter.go` + 해당 화면의 열기 약속은 구현 때 화면별 조사).
- 칩 건수 "전체"는 종류 건수의 합. 건수가 상한(예: 200)을 넘으면 "200+".
- 일기는 칩도 결과도 없다. 일기 화면에서 검색해도 같다.
- 빈 결과·오류·불러오는 중을 구분해 말한다(일정 읽기 실패 시 "일정은 이번에 찾지 못했어요" — 나머지 결과는 그대로 보여줌).
- 로그아웃·계정 변경 시 결과·일정 메모리 사본을 지운다(`ownerCache` 정리 대상에 포함, 새 영구 저장 없음. 최근 검색어 기억은 결정 7).

### 4.3 다음 단계 PR 쪼개기와 시험

선행: UI-상단줄(#950) merge. 줄 세우기: S-1 → S-2 → S-3 → S-4 → ②.

| PR | 범위 | 시험 | 정지 |
| --- | --- | --- | --- |
| S-1 DB | `app_search_records` 함수(+필요 시 `pg_trgm`·인덱스), pre/post/rollback/snapshot/summary 파일 | `supabase/tests/`에 SQL 시험: 소유자만 호출(anon·다른 사용자 거절), **일기 행이 어떤 인자로도 안 나옴**, `%`·`_`·`\`·긴 검색어·제어문자·낱말 7개, 종류별 건수·정렬(최근 먼저)·`p_offset`, 사진 글자 찾기, 연결 이름 | **DB 적용 직전 정지**(승인형 workflow) |
| S-2 모델·데이터 | `global-search-model.mjs`, `global-search-data.js`(RPC 호출·요청 취소·Google 저장본 거르기·일정 한 번 읽기) | Node 단위 시험: 낱말 나누기, 형광 구간(겹침·한글·특수문자), 병합·정렬, 일정/할 일 거르기, 오래된 응답 버리기, 로그아웃 시 정리. 화면 없음 | 없음 |
| S-3 PC 화면 | `global-search.js`: 상단 줄 칸 자리에 입력, 결과 창, 칩, 묶음, 키보드, 전용 화면(`?view=search`) | Playwright: 입력→창, ↑↓·엔터·Esc, 칩 전환, "N건 모두 보기", 새로고침/뒤로 가기 주소 복원, 일기 안 나옴, 형광이 HTML 주입 안 됨(`<img onerror>` 검색어), 다크 모드, 콘솔 오류 0. 시각 캡처 `review/` | 없음 |
| S-4 모바일 | [메뉴] 창 맨 위 검색칸, 전체 화면(← 닫기), 홈에 칸 없음 확인 | Playwright 390px: 메뉴→검색→결과→열기, 자판이 떠도 입력줄·결과 안 가림, 뒤로 가기 1단계씩, 가로 스크롤 없음 | 없음 |
| ②-a DB | `extracted_text` 인덱스(필요하면)+함수가 자료 본문을 찾도록 확장 | S-1 시험에 자료 본문·일기 제외 유지 추가 | DB 적용 직전 정지 |
| ②-b Edge | 글자 읽기(txt·HWP·Drive 변환)+`library-files` 업로드 훅. LIB-AI와 읽기 코드 공유 | Deno 단위 시험(형식별·상한·실패 시 업로드 유지), 권한 시험(`tests/security/`) | **Edge 배포 직전 정지** |
| ②-c 채우기 | 기존 자료 목록 확인·단계 실행 도구, 되돌리기 SQL | 건수 확인 읽기 전용 SQL → 1건 시험 → 일부 → 전체 | **production 데이터 변경 정지** |
| ②-d 화면 | 결과 줄에 "첨부 안 글자" 표시(어느 파일인지), 자료실 결과 열기 | S-3 시험에 추가 | 없음 |

PR마다 `docs/roadmap.md`는 고치지 않고 본문 끝에 "원장 반영" 절을 쓴다. 캐시 버전은 CI 자동화에 맡긴다(손으로 `?v=` 쓰지 않음).

### 4.4 건드리지 말 것

- `app-router.js`의 화면 전환 소유권, 세션 갱신(`runtime-client.js`), RLS·정책, `app_ledger_search`.
- 상단 줄(#950) 마크업과 `topbar-actions.*`. 칸 자리가 아직 없으면 UI-상단줄에 요청한다.

## 5. 결정 필요 목록 (일상어, 추천안 포함)

1. **업무일지 한 줄은 어느 칩에 넣나요?** 요청 칩에는 "업무일지"가 없습니다. 추천: "노트" 칩과 분리해 **"업무일지"는 칩 없이 "전체"에만 나오고**, 줄에 날짜를 보여 준다. 대안: 칩 하나 추가(8개가 되어 폰에서 좁아짐).
2. **몇 글자부터 찾나요?** 추천: **2글자부터**(한 글자는 결과가 너무 많고 DB가 느려짐). 대신 제목만 찾는 1글자 검색은 하지 않음.
3. **첨부 안 글자 읽기를 LIB-AI자동분류와 하나로 합치고 AI 비용 없이(Drive 변환) 읽을까요?** 추천: **합치기. 먼저 merge되는 쪽이 읽기 코드를 소유**하고 다른 쪽이 가져다 씀. PDF·Office는 Drive 변환으로 읽고, 그래도 못 읽는 파일만 나중에 AI(월 한도 안)로 읽을지 따로 묻는다.
4. **구글 일정·할 일을 어디까지 찾나요?** 추천: 일정은 **지난 3개월~앞 6개월**의 제목·장소(설명 제외), 할 일은 미완료+최근 완료. 더 오래된 것은 "달력에서 찾기" 안내를 결과 창 맨 아래에 둔다. 대안: 범위 확대(읽는 시간 증가) 또는 설명까지 찾기.
5. **보관(보류)한 업데이트와 끝난 프로젝트도 찾나요?** 추천: **찾되 결과 줄에 "보류"·"끝남" 작은 표시**를 붙이고 최근 순서에 따라 뒤로 간다.
6. **노트에 붙인 PDF·HWP 안 글자는 어떻게 할까요?** 추천: 지금은 **대상 밖**으로 두고, [자료로 넣기]한 파일부터 찾는다(DB 변경 없음). 노트 안 파일까지 필요하면 노트 DB 변경이 따로 필요.
7. **최근 검색어를 기억할까요?** 추천: **기억하지 않음**(공개 저장소·공용 PC 위험 없음, 새 저장소 없음). 기억하려면 이 기기 안에만 저장하고 로그아웃 때 지움.
8. **검색 결과 순서는 "최근 것 먼저"만 쓰나요?** 추천: 예(요청 그대로). 제목에서 찾은 것을 위로 올리는 점수는 쓰지 않음.
9. **이 순서로 진행해도 되나요?** 추천: UI-상단줄 merge → S-1(DB 적용 정지) → S-2 → S-3 → S-4 → ② 순서. ②-b는 LIB-AI자동분류(#959) 설계가 정해진 뒤.

## 6. 미확인 사항과 구현 세션이 먼저 확인할 것

- `app_documents`의 정확한 칼럼 목록·행 수·`extracted_text`가 채워진 자료 수(production 읽기 전용 확인 SQL, 폰 경로 C 가능).
- 표별 행 수와 `pg_trgm` 인덱스 필요 여부, Supabase 프로젝트에서 `pg_trgm` 사용 가능 여부(`create extension`이 승인형 workflow의 "권한 확대 모양" 거절 규칙에 걸리는지 포함).
- `app_document_chunks`·`app_document_ai_index`의 현재 행 수와 다른 사용처(삭제 후보 `document-ai-index` 정리 때 함께).
- 회의 결과 칼럼: `transcript_text`와 옛 `decisions` 외 결과 칸이 더 있는지(`select=*` 사용 중이라 칼럼 목록 미확인).
- 할 일 첨부 파일이 `app_documents` 행인지.
- #959 읽기 방식, #950 상단 줄 칸 자리 이름.
- 결과 줄을 눌렀을 때 화면별 "열기" 방법(노트 상세·자료 열기·회의 결과 창·프로젝트 상세·조직 상세·일정 상세 창)은 구현 때 화면별 소유 모듈의 기존 열기 약속을 조사한다.
