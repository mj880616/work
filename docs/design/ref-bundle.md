# REF-참고묶음 설계 — 바구니 업데이트의 세 번째 연결처 '참고' 묶음

상태: 설계·시안만(앱 코드·DB 변경 없음). 시안: `docs/design/mockups/ref-bundle.html`(혼자 열리는 정적 HTML, 가짜 이름·가짜 글).
기준: 2026-10-23 14:19·14:20 명진 요청, 21:17 재확인 — 바구니 업데이트 연결처에 담당조직·프로젝트 말고 세 번째 '참고' 묶음. 처음 묶음은 공공운수노조 / 공공기관사업(본부) / 기타 조직, 명진이 묶음을 더하고 이름을 바꿀 수 있다. 노조 전체·공공기관 사업 전반·담당 아닌 조직 소식을 붙여 두고 참고만 한다. **주간보고 초안·주간 정리에는 넣지 않는다.** 바구니 AI 분류는 조직·프로젝트에 안 맞으면 참고 묶음을 **제안만** 한다. 나중에 '기타 조직'을 조직별로 나눠 옮길 때 원문·날짜·연결 기록을 지키고 여러 개를 한 번에 옮긴다(나누는 기능은 지금 안 만들지만 구조가 막지 않게).

## 1. 지금 연결 구조 (확인한 사실)

### 1.1 연결 표 하나: `app_record_links`

- 바구니 업데이트(`app_notes`, `kind=basket`)·노트(`kind=note`)가 어디로 갔는지는 모두 이 표 한 곳에 줄로 남는다. 업데이트 원문·날짜(`raw_text`·`occurred_at`)는 `app_notes`에 있고, 연결 줄은 "이 업데이트 → 이곳" 꼬리표다.
- 처음 모양: `supabase/migrations/20260927103344_task_impl2_notes_record_links.sql` 19~39행. 이후 칸이 더해졌다.
  - 출처(정확히 하나): `google_task_id` / `note_id` / `source_meeting_id`(회의, `20261023023500`) — 제약 `app_record_links_one_source`.
  - 도착(정확히 하나): `project_id` / `organization_id` / `meeting_id`(`20260928123601`) / `document_id`(`20261010120000`) — 제약 `app_record_links_one_target`.
  - 그 밖: `status`(`suggested`|`confirmed`), `report_kind`(`business`|`organization`|null), `summary`(연결 요약, `20261012100000`), `created_at`.
  - 중복 막기: `app_record_links_unique`(`unique nulls not distinct`, 출처·도착 칸 전부). `app_basket_confirm_links`가 이 이름으로 `on conflict`를 쓴다.
- 권한(RLS): 정책 `record_links_owner_all`(소유자만, `private.app_is_workspace_owner(workspace_id)`, 도착이 같은 업무공간인지 with check) + 좁히기 전용 `record_links_source_meeting_ws`(restrictive, `20261023023500` 226~230행). anon·PUBLIC 표 권한 없음.
- 같은 칸 넓히기는 지금까지 세 번 같은 방식으로 했다: 새 칸 → 새 제약을 `_xxx` 이름으로 만들기 → 옛 제약 지우기 → 원래 이름으로 바꾸기(`20260928123601` 99~114행, `20261010120000` 64~74행, `20261023023500` 209~223행).

### 1.2 바구니 업데이트를 연결하는 길 (모두 같은 RPC)

| 화면 | 코드 | 서버 |
| --- | --- | --- |
| 바구니 메모 [연결하기] | `app/basket-manual-link.js`(담당조직·프로젝트 고르기 ▾ 두 버튼, 16·112~121·152행) | `app_basket_confirm_links` |
| 홈·쓰기 창 [업데이트 ▾] 기록할 곳(여러 곳) | `app/update-places.js` `placeSheetHtml`(99행)·`saveUpdate`(118행): 한 곳이면 그 조직·프로젝트의 자기 기록 표, 두 곳 이상이면 바구니 업데이트 + 연결 | 같은 RPC |
| [분류 결과 입력](AI 답 붙여 넣기) | `app/basket-classification-ui.js`(미리보기·체크·[선택 확정]) | 같은 RPC |
| 연결 해제 뒤 [되돌리기] | `app/basket-record-delete.js` `restoreRecordLink`(176행, kind는 organization·project만) | 같은 RPC |

- `app_basket_confirm_links(p_note_id, p_note_updated_at, p_targets)`: INVOKER, `kind`는 `organization`·`project`만(`20261012100000` 194행~ 본문). 전부 아니면 전무.
- 연결 요약 고치기 `app_basket_update_link_summary`(같은 파일 373행~)는 `num_nonnulls(organization_id, project_id)=1`인 줄만 받는다.
- 연결 해제는 연결 줄 1행 DELETE(소유자 RLS), 업데이트 원문은 남는다.

### 1.3 바구니 AI 분류 (서버 AI 없음, 붙여 넣기 방식)

- [AI 분류 요청]은 `app/basket-ai-handoff.js` `buildHandoff`(66행)가 메모 목록 + 담당조직 목록 + 프로젝트 목록 + 답 형식(`app/basket-classification.js` `classificationFormat`, 10행)을 글로 만들어 복사한다. 명진이 ChatGPT에 붙여 넣고 답을 [분류 결과 입력]에 넣는다.
- 답 검사 `parseClassification`(같은 파일 42행, 허용 kind 6행), 미리보기 `previewClassification`(128행). 미리보기에서 체크된 것만 [선택 확정]을 눌러야 저장된다 — 이미 "제안만, 사람이 확정" 구조다. `status='suggested'` 줄을 실제로 쓰는 곳은 지금 없다(읽기만).
- 분류 대상은 확정·제안 연결이 하나도 없는 메모만(`selectHandoffNotes` 14행). 참고에 붙인 업데이트도 연결이 있으므로 자동으로 다시 분류 대상에서 빠진다.

### 1.4 주간보고·주간 정리가 업데이트를 모으는 곳

- 모든 묶음의 뿌리는 `app/journal-data.js` `basketPlaces`(322행): 업데이트마다 확정 연결 중 **조직 줄·프로젝트 줄만** 골라 `{orgs, projects}`를 만든다.
  - `orgNewsOn`(346행): 조직 소식. `unsorted=true`이면 조직·프로젝트 어디에도 없는 업데이트를 '미분류'에 넣는다.
  - `projectRecordsOn`(364행): 프로젝트(사업) 소식.
  - `journalMemoItemsOn`(387행)·`unsentUpdatesOn`(392행): 기타 메모 / 어디에도 안 보낸 업데이트.
- [주간 정리]·[복사]·한글 파일: `app/journal-weekly.js` `weeklySummary`(184행) — `summary`(191행, projectRecordsOn), `orgs`(213~216행, **orgNewsOn 기본값 = '미분류' 포함**), `notes.memos`(250행). [복사] 글은 `weeklyReportText`(262행), 한글 파일 [붙이기] 후보는 `app/weekly-hwpx/draft.mjs` `weekMaterial`(256행)이 같은 모델을 쓴다.
- 하루 카드: `dayCard`(464행) — 조직 소식은 `{open:true, unsorted:false}`, 어디에도 안 보낸 업데이트는 '그 밖의 기록'.
- 서버 쪽 조직 요약(`ai-assist` `org_summary`, `handler.ts` 1367행)은 `organization_id=in.(...)`로만 연결을 읽는다.

**지금 그대로 참고 연결을 더하면 생기는 문제(사실):** `basketPlaces`가 참고 줄을 모르므로 참고에만 붙인 업데이트는 "조직·프로젝트 어디에도 안 간 것"으로 보여 [주간 정리] 조직 소식 **'미분류'에 들어간다**(= 주간보고 초안 [복사]에도 나감). 하루 카드에서는 '어디에도 안 보낸 업데이트'로 보인다. 바구니 상태(`app/basket-data.js` `noteState` 309행)는 '확정'이 되지만 갈 곳 이름이 '연결 대상 없음'으로 나온다. 그래서 4절의 제외 지점을 화면 PR에서 반드시 같이 고친다.

## 2. 저장 구조안

### 2.1 원칙

- 연결은 **기존 연결 표 `app_record_links`를 그대로 쓴다.** 도착 칸 하나(`bundle_id`)만 더한다. 참고 전용 연결 표를 따로 만들지 않는다(중복 표 금지, 연결 해제·요약·노트 연결·검색 등 기존 길이 그대로 통함).
- 묶음 목록(이름·순서)만 작은 새 표 하나에 둔다. 담당조직 표(`app_suborganizations`)에 '참고' 종류를 섞지 않는다 — 그 표는 담당조직 목록·일정 조직 체크·할 일 조직·주간보고 조직 줄 등 10곳 넘게 읽어서, 섞으면 모든 곳에 거르기 조건이 늘고 하나만 빠져도 참고가 주간보고에 새어 들어간다. 프로필 jsonb(`document_categories` 방식)도 쓰지 않는다 — 연결 줄이 이름 글자를 들고 있으면 이름 바꾸기 때 모든 줄을 고쳐야 하고, 지운 묶음을 가리키는 줄을 DB가 막지 못한다.

### 2.2 새 표 `app_reference_bundles`

```
app_reference_bundles
  id            uuid pk default gen_random_uuid()
  workspace_id  uuid not null references app_workspaces(id) on delete cascade
  name          text not null check (char_length(btrim(name)) between 1 and 30)
  sort_order    integer not null default 0          -- 낮은 번호 먼저, 같으면 created_at
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()  -- 이름 바꾸기 때 조건부 PATCH용
  unique (workspace_id, name)
```

- RLS 켬. 정책 하나 `reference_bundles_owner_all`: `for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id))` — `app_notes`의 `notes_owner_all`과 같은 모양. `revoke all … from public, anon, authenticated` 뒤 `grant select, insert, update, delete … to authenticated`(기존 방식). anon·PUBLIC·service_role 확대 없음. Edge·Web1·공유 페이지는 이 표를 읽지 않는다.
- 처음 묶음 3개는 migration이 업무공간마다 한 번 넣는다(`공공운수노조` 10, `공공기관사업(본부)` 20, `기타 조직` 30). 이름은 일반 명칭이라 공개 저장소에 써도 된다. 이미 같은 이름이 있으면 건너뜀(`on conflict do nothing`).
- 더하기·이름 바꾸기·순서는 화면이 소유자 REST로 한다(새 RPC 없음, 이름 바꾸기는 `updated_at` 일치 조건 PATCH). 연결 줄은 `bundle_id`(id)로 가리키므로 이름을 바꿔도 붙은 소식은 그대로다.
- 지우기: 연결 FK를 `on delete restrict`로 두어 **붙은 소식이 있는 묶음은 DB가 못 지우게** 한다. 화면은 빈 묶음에만 [묶음 지우기]를 준다(질문 4).

### 2.3 연결 표에 칸 하나: `app_record_links.bundle_id`

```
alter table app_record_links add column bundle_id uuid
  constraint app_record_links_bundle_id_fkey references app_reference_bundles(id) on delete restrict;
-- 기존 방식대로 새 제약 → 옛 제약 삭제 → 같은 이름으로:
one_target : num_nonnulls(project_id, organization_id, meeting_id, document_id, bundle_id) = 1
unique     : (google_task_id, note_id, project_id, organization_id, meeting_id, document_id, source_meeting_id, bundle_id)
새 모양 검사 app_record_links_bundle_shape:
  bundle_id is null or (note_id is not null and status = 'confirmed' and report_kind is null)
index app_record_links_bundle_idx on (bundle_id) where bundle_id is not null
```

- 참고 연결은 바구니 업데이트·노트 출처만 받는다(할 일·회의 출처 불가). `report_kind`는 비워 두어 "보고용이 아님"을 DB 모양으로도 남긴다.
- 같은 업무공간 확인은 **기존 정책을 고치지 않고** 좁히기 전용 정책 하나를 더한다(회의 출처 때와 같은 방식): `record_links_bundle_ws as restrictive for all to authenticated using/with check (bundle_id is null or exists (select 1 from app_reference_bundles b where b.id = bundle_id and b.workspace_id = app_record_links.workspace_id))`. 권한은 좁아지기만 한다.
- RPC 두 개를 넓힌다(새 함수 없음, INVOKER·`search_path=''`·authenticated만 그대로):
  - `app_basket_confirm_links`: `kind`에 `reference`를 더함. 검사 = 그 묶음이 메모와 같은 업무공간(`for share` 잠금). insert 때 `bundle_id` 채움·`report_kind` null. '제안 있음(SUGGESTED_EXISTS)' 검사도 같은 규칙.
  - `app_basket_update_link_summary`: 대상 조건 `num_nonnulls(organization_id, project_id)=1`을 `num_nonnulls(organization_id, project_id, bundle_id)=1`로(참고 연결에도 요약을 붙이거나 고칠 수 있게).

### 2.4 이 구조가 막지 않는 것

- 노트도 같은 연결 표를 쓰므로 노트 [연결하기]에도 그대로 붙일 수 있다(화면은 질문 대상 아님, 바구니 업데이트와 같은 버튼을 쓰면 됨).
- 검색 RPC `app_search_records`, 할 일 연결, 회의 출처 연결, Drive 사본(`drive-summary`)은 `bundle_id`를 읽지 않으며 제약 변경의 영향이 없다(1.1의 다른 도착 칸이 더해질 때와 같음).

## 3. 나중에 '기타 조직'을 조직별로 옮길 때 (지금은 만들지 않음)

- 옮기기 = **연결 줄을 그 자리에서 고치기**: 같은 줄의 `bundle_id`를 비우고 `organization_id`(또는 `project_id`)를 채우고 `report_kind='organization'`. 새 줄을 만들고 옛 줄을 지우지 않는다.
  - 원문·날짜: `app_notes` 행은 건드리지 않으므로 그대로.
  - 연결 기록: 같은 연결 줄이라 id·`created_at`(처음 붙인 때)·요약이 그대로.
  - 옮긴 흔적: 그 PR의 migration에서 `moved_from_bundle_id uuid`(묶음 지우기 때 null)·`moved_at timestamptz` 두 칸을 더하고 옮길 때 채운다. 지금 미리 만들지 않는 이유: 쓰는 곳 없는 칸을 두지 않음. 더해도 기존 줄은 null이라 다른 영향이 없다.
- 여러 개 한 번에: 저장 함수 하나 `app_reference_move_links(p_link_ids uuid[], p_kind text, p_target_id uuid)`(INVOKER, 1~200개, 전부 아니면 전무). 그 업데이트가 이미 그 조직에 연결돼 있으면 중복 규칙에 걸리므로, 그 줄은 고치지 않고 참고 줄만 지운 뒤 '이미 연결됨'으로 센다(요약이 있으면 화면이 먼저 묻는다).
- 옮긴 소식은 그때부터 조직 소식이 되므로, 옮긴 주가 지난 주라도 그 주 [주간 정리]를 다시 열면 조직 소식에 보인다(업데이트 날짜 기준). 이것이 맞는 동작인지는 옮기기 PR에서 다시 묻는다.
- 2절 구조에서 이 동작을 막는 것은 없다: 도착 칸은 한 줄에 하나(one_target)라 고치기만 하면 되고, 출처는 그대로이며, `bundle_shape`는 `bundle_id`가 null이 되면 조건이 사라진다.

## 4. 주간보고·주간 정리 제외 지점 (화면 PR에서 고칠 코드 위치)

규칙 한 줄: **참고 연결은 '어디로 갔는지'에는 들어가지만, 보고 묶음(조직 소식·사업 소식·미분류·기타 메모)에는 들어가지 않는다.**

| 위치 | 지금 | 바꿀 것 |
| --- | --- | --- |
| `app/journal-data.js` `basketPlaces`(322행) | 조직·프로젝트 줄만 모음 | 참고 줄을 따로 `refs`로 모음(조직·프로젝트 목록에는 넣지 않음) |
| 같은 파일 `orgNewsOn`(346·352~353행) | 조직·프로젝트 없으면 '미분류' | `refs`가 있으면 '미분류'에 넣지 않음 → [주간 정리] 조직 소식·[복사]·한글 파일 후보에서 빠짐 |
| 같은 파일 `projectRecordsOn`(364행) | 조직 없을 때 프로젝트 소식 | 변경 없음(참고 줄은 `projects`에 없음). 시험으로 고정 |
| 같은 파일 `journalMemoItemsOn`(387행)·`unsentUpdatesOn`(392행) | 조직·프로젝트 없으면 기타 메모 / 어디에도 안 보낸 업데이트 | `refs`가 있으면 둘 다에서 빠짐. 하루 카드 '그 밖의 기록'에 새 묶음 '참고'(묶음 이름 · 첫 줄)로 보임 — 질문 2. 이 묶음은 `weeklySummary`의 `notes`에 넣지 않음 |
| `app/journal-weekly.js` `weeklySummary`(184행, 191·216·250행) | 위 함수들을 그대로 씀 | 코드 변경 없음, 위 변경으로 제외됨. `weeklyReportText`(262행)·`weekly-hwpx/draft.mjs` `weekMaterial`(256행)도 같은 모델이라 자동 제외. 시험 추가: 참고에만 붙인 업데이트가 [복사] 글·`weekMaterial` 후보 어디에도 없음 |
| `app/basket-data.js` `noteState`(309행) | 갈 곳 이름 표에 참고 없음 → '연결 대상 없음' | `['bundle','참고']` 더함 → "참고: 기타 조직" |
| 같은 파일 `BASKET_PLACES`(327행)·`notePlaces`(328행)·`placeTargetNames` | 참고 없음 | [분류] 아래 칩 `[참고]` + 묶음 이름 칩(질문 6) |
| 같은 파일 `noteHasOrgOrProject`(350행) | 조직·프로젝트만 | 그대로 둠 — 참고에 붙인 업데이트도 [업무일지에 남기기]는 가능(참고는 보고가 아니므로). 단 기타 메모 묶음에서는 위 규칙대로 빠짐 |
| `app/basket-link-records.js` `readLinkRecords`(37행) | kind는 organization·project | kind `bundle` 더함(참고 화면 목록용, 같은 읽기 한 번) |
| 서버 `ai-assist` `org_summary`(`handler.ts` 1367행) | `organization_id=in.(…)`만 읽음 | 변경 없음(참고 줄은 organization_id가 null이라 안 읽힘). 시험으로 고정 |
| `drive-summary` `basket.mjs` `basketState`(26행) | 확정 연결이 있으면 '확정'(개수만) | 변경 없음(참고에 붙이면 정리된 것으로 셈 — 맞는 동작) |

## 5. AI 제안 방식 (제안만, 자동 확정 없음)

- [AI 분류 요청] 글(`buildHandoff`)에 '참고 묶음 목록 (ID · 이름)'을 담당조직·프로젝트 목록 아래 붙인다. 답 형식(`classificationFormat`)에 한 줄: "`reference`(참고 묶음)는 담당조직·프로젝트 어디에도 맞지 않을 때만 제안하세요. 노조 전체·공공기관 사업 전반·담당이 아닌 조직의 소식이 여기에 해당합니다. 담당조직·프로젝트와 함께 쓰지 마세요."
- `parseClassification`의 허용 kind에 `reference`(UUID 필수), `previewClassification`이 묶음 목록으로 이름·업무공간을 확인한다.
- 미리보기: 참고 제안 줄은 **체크가 꺼진 채** 보인다(조직·프로젝트 제안은 지금처럼 켜진 채). 명진이 체크하고 [선택 확정]을 눌러야만 저장된다(질문 5). 바꿔 고르기 선택칸(`destinationChoices`)에 참고 묶음도 들어간다.
- DB에 `suggested` 줄을 새로 쓰지 않는다(지금처럼 제안은 화면 메모리에만). Edge·서버 AI 변경 없음.
- [연결하기]의 연결 요약 AI(`ai-assist` `link_summary`)는 참고에는 붙이지 않는다(요약 칸은 비워도 됨, 손으로 쓸 수 있음).

## 6. 묶음 화면 위치

- **연결처 고르기**(시안 가):
  - 바구니·노트 [연결하기]: `[담당조직 ▾] [프로젝트 ▾] [참고 ▾]` 세 버튼(같은 고르기 시트, 참고는 묶음 목록 체크 줄).
  - 홈·쓰기 창 [업데이트 ▾] 기록할 곳 시트: 최근 → 담당조직 → 프로젝트 → **참고**(맨 아래 한 덩어리, PC 두 열 창에서는 프로젝트 열 아래). 참고만 고르면 바구니 업데이트 + 참고 연결(지금 두 곳 이상 고를 때와 같은 저장 길).
- **참고 화면**(시안 나): 새 화면 `?view=reference` 하나, 그리는 주인은 새 모듈 `reference-bundles.js` 하나(라우터 `KPTURouter.go`, 처음 열 때만 불러옴, 하단 탭·사이드바 항목은 늘리지 않음).
  - 들어가는 곳(추천): 담당조직 목록 맨 아래 한 줄 `참고 묶음 ›`(질문 1). 바구니 [분류] › [참고] 칩, 업데이트 화면의 "참고: ○○" 칩을 누르면 그 묶음이 열림.
  - 묶음 목록: 줄마다 이름 · 붙은 소식 수 · 마지막 날짜. 목록 머리 오른쪽 ⋯ [묶음 더하기]·[순서 바꾸기].
  - 묶음 상세: 붙은 소식 목록(날짜 · 첫 줄 또는 요약, 최신 먼저). 줄 누르기 = 원래 업데이트 열기, 줄 끝 ⋯ = [업데이트 열기]·[연결 해제](기존 `disconnectWithUndo`, 5초 되돌리기). 나중 옮기기 기능의 [여러 개 고르기]는 이 ⋯ 자리에 들어간다.
  - 이름 바꾸기: 상세 머리 ⋯ [이름 바꾸기] → 그 자리 한 줄 입력칸 [저장][취소]. [묶음 지우기]는 붙은 소식이 0개일 때만 보임.
  - PC(1024px~)는 왼쪽 목록 / 오른쪽 상세 두 칸(`split-resize.js` 그대로), 폰은 목록 → 상세(뒤로 가기 기록 1칸).

## 7. PR 순서

1. **DB PR**(코드 변경 없음): migration 1개 + 짝 파일 5개(`precheck`·`snapshot`·`postcheck`·`rollback`·`summary`) + `preserve.sql`(되돌리기 전 참고 연결 보관용 읽기) + `supabase/tests/authz_reference_bundles.sql`(남의 업무공간 묶음 연결 거절, anon 거절, 다른 출처 거절, 묶음 삭제 restrict). 내용: 2.2 표·정책·처음 묶음 3개, 2.3 칸·제약·좁히기 정책·색인, RPC 두 개 넓히기. 정지 지점: 운영 적용 직전(승인형 workflow). 함수 본문 교체가 들어가므로 되돌리기는 SQL Editor 경로(8절).
2. **화면 PR 1 — 제외·읽기**(DB 적용 뒤): 4절 표 전부 + 시험(참고 업데이트가 [주간 정리]·[복사]·한글 후보·미분류·기타 메모에 없음, 하루 카드 '참고'에는 있음, 바구니 상태 '참고: ○○'). 아직 참고에 붙이는 버튼은 없다(제외가 먼저 들어가야 붙인 소식이 보고에 새지 않음).
3. **화면 PR 2 — 고르기·참고 화면**: [연결하기] [참고 ▾], 기록할 곳 시트 참고 덩어리, `restoreRecordLink` kind 넓히기, `reference-bundles.js` 화면(목록·상세·이름 바꾸기·더하기·빈 묶음 지우기), 담당조직 목록 맨 아래 입구, 바구니 [참고] 칩. `app/ARCHITECTURE.md`에 유일 renderer 한 줄. E2E(고르기 → 저장 → 참고 화면 → 이름 바꾸기 → 주간 정리에 없음).
4. **AI PR**: 5절(handoff 글·답 검사·미리보기 기본 체크 꺼짐) + 시험.
5. (나중) 옮기기 PR: 3절 칸 2개 + `app_reference_move_links` + 참고 화면 [여러 개 고르기 → 조직으로 옮기기].

## 8. 되돌리기

- 화면 PR들: 각 PR revert. 참고 연결 줄은 DB에 그대로 남고, 화면 PR 1까지 되돌린 상태에서는 참고 업데이트가 다시 '미분류'로 보일 수 있으므로 **화면 PR 2·AI PR을 먼저, 화면 PR 1은 마지막에** 되돌린다.
- DB: 짝 rollback(SQL Editor 전용 — 표 삭제·함수 본문 복원은 승인형 workflow rollback 허용 목록 밖, `docs/ops-db-workflow.md` 206·228행). 순서: 참고 연결 줄이 있으면 멈춤(먼저 `preserve.sql` 결과 보관 → 명진 확인 뒤 연결 줄 삭제를 따로 승인) → 두 RPC를 이전 본문으로 복원 → 좁히기 정책 삭제 → 제약을 옛 모양(같은 이름)으로 → 모양 검사·색인·`bundle_id` 칸 삭제 → 묶음 표 삭제 → 기록 1행 삭제. 업데이트 원문(`app_notes`)·다른 연결 줄은 건드리지 않는다.
- production 데이터 변경: 처음 묶음 3행 추가뿐(되돌리기 때 표째 사라짐).

## 9. 명진에게 묻는 질문 (추천안 포함)

1. 참고 묶음 화면은 어디서 열까요? **추천: 담당조직 목록 맨 아래 한 줄 "참고 묶음 ›".** 대안: 폰 메뉴 판·PC 사이드바에 [참고] 한 칸.
2. 하루 업무일지 카드에 참고 소식을 보일까요? **추천: '그 밖의 기록'(접힘) 안에 '참고' 묶음으로만.** 대안: 업무일지에도 안 보임(참고 화면에서만). 어느 쪽이든 주간 정리·주간보고 초안에는 안 들어갑니다.
3. 업데이트 하나를 담당조직과 참고 묶음에 동시에 붙여도 될까요? **추천: 됨**(지금 여러 곳 고르기와 같음). 그 업데이트는 주간보고에는 조직 쪽으로만 나갑니다.
4. 묶음 지우기는 비어 있는 묶음만 되게 할까요? **추천: 예.** 소식이 붙은 묶음은 연결을 먼저 풀거나(나중엔) 옮긴 뒤 지움.
5. AI가 참고를 제안할 때 체크를 꺼 둔 채로 보일까요? **추천: 예(꺼 둠)** — 한 번 더 눌러야 붙음. 대안: 조직·프로젝트 제안처럼 켜 둠(그래도 [선택 확정]을 눌러야 저장).
6. 바구니 [분류] 거르기에 [참고] 칩을 더할까요? **추천: 예.**
7. 처음 묶음 이름 세 개(공공운수노조 / 공공기관사업(본부) / 기타 조직)와 순서 그대로 둘까요? **추천: 그대로**(나중에 화면에서 바꿀 수 있음).

## 10. 범위 밖 발견 (수정 안 함)

- `status='suggested'` 연결 줄은 지금 쓰는 곳이 없는데 바구니·Drive 사본·AI 분류 대상 계산이 계속 읽는다(`basket-data.js` 321행, `drive-summary/basket.mjs` 26~33행, `basket-ai-handoff.js` 17행). 이번 설계는 이 상태를 쓰지 않는다.
- `ai-assist` `todo_radar`(챙길 것 찾기)는 연결과 상관없이 업데이트 원문을 읽으므로, 참고에 붙인 업데이트에서도 챙길 것 후보가 나올 수 있다(`handler.ts` 657행). 보고서가 아니라 이번 요구 범위 밖이며, 원하면 따로 정한다.
