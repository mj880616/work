# 두 번 녹음한 회의를 한 보고로 (REC-한회의로잇기) — 1단계 설계

S57-22 설계(문서 전용, 코드는 고치지 않음). 요청함 11/11 11:27 접수분. 시안: `docs/design/mockups/rec-join.html`(#2376).
기준선: main `a5fe675`(2026-11-11). 아래 '사실'은 이 기준선의 코드를 직접 읽은 것이고, 짐작은 '추정'이라고 적는다. 줄 번호도 이 기준선의 것이다(문서를 마감할 때 main은 `99f4a1b`였고, 아래에 적은 파일의 줄 번호는 그대로였다).

요청 요지(원문은 요청함. 사람·회의 이름은 옮기지 않음):

- 녹음 → [멈추고 정리] → 또 녹음 → [멈추고 정리]. 이 둘이 사실은 한 회의일 때 한 보고로 넣는다.
- 사용자 결정(11/11 11:25): **"나 · 백그라운드 · 자동저장"** — 두 녹음 전사 전체로 회의 결과를 처음부터 다시 요약하고, 몇 분 걸려도 되니 뒤에서 하고, AI 요약을 **내가 지정한 회의에 자동 저장**한다(고치는 것은 나중에 직접).
- 할 일 1~6: ① 정리 끝에서 한 번 묻기 ② [그 보고에 잇기] = 창 없이 뒤에서 ③ 저장되는 것 ④ 지켜 두는 것(합치기 전 글·후속 할 일은 후보만) ⑤ 이미 저장한 두 보고 합치기 ⑥ '저장 안 한 첫 초안이 사라지는지' 확인.

완료 기준: 다음 구현 세션이 이 문서만 보고 PR을 나눠 시작할 수 있다.

## 0. 한눈에

- **뒤에서 도는 서버 작업이 보고 글을 고치는 길은 지금 없다.** 녹음 네 길 모두 결과를 창의 칸에 채우기만 하고 저장은 사람이 누른다(1절). 이번 일은 '잇기·합치기'에 한해 서버가 고른 보고에 저장하는 첫 길을 만든다.
- **새 표 1개 + 서버 전용 함수 2개**가 필요하다(3-2절). 기존 표의 칸·제약·정책·권한은 한 줄도 바꾸지 않는다. '합치기 전 글'도 이 새 표에 둔다.
- 잇기 작업은 **녹음 띠(녹음기 상태)와 따로** 돈다. 잇는 몇 분 동안에도 다음 녹음을 시작할 수 있어야 하기 때문이다(3-1절).
- 어느 보고에 이을지는 **늘 사람이 고르고**, 작업공간·보고 소유는 **서버가 로그인으로** 정한다. AI 요약은 내 보고 글에만 들어가고, 할 일·일정·공유·삭제 같은 바깥 행동은 저절로 일어나지 않는다(3-4·3-6절).
- 요청 6번: **사라진다(사실).** 저장 안 한 초안 창은 묻지 않고 닫히고, 다음 정리 결과가 열릴 때 창의 칸을 묻지 않고 비운다. 같은 뿌리로 '녹음 중에 창에 직접 쓰던 글'도 지워진다(2절). 고치는 것은 다음 PR(4절 PR-0).
- PR은 여섯으로 나눈다: PR-0 초안 지키기(화면) ∥ PR-1 DB → PR-2 Edge → PR-3 화면(물음·잇기) → PR-4 보고 ⋯ [다른 보고에 합치기] → PR-5 나머지 두 길(4절).

## 1. 지금 구조 (main a5fe675 기준)

### 1-1. 녹음 네 길이 '정리' 뒤 여는 것

| 길 | 시작 | 정리 뒤 여는 것 | 저장 |
| --- | --- | --- | --- |
| (가) 노트북 녹음 | 녹음 띠 [멈추고 정리] | 새 사업 보고 입력 창(`#meetingModal`, [회의] 칸) | 사람이 [사업 보고 저장] |
| (나) 폰 앱 녹음 | 폰 띠·알림줄 [멈추고 정리] | (가)와 같은 창(같은 함수) | 사람이 [사업 보고 저장] |
| (다) 회의자료 그 자리 전사 | 회의 상세 자료 줄 ⋯ [전사해서 결과에 넣기] | **그 회의** 상세 창의 [수정] 모드 | 사람이 [저장] |
| (라) [녹음·전사 넣기] 파일 | 입력 창 안 [녹음·전사 넣기] | 열려 있는 그 입력 창의 칸 | 사람이 [사업 보고 저장] |

사실(파일·줄):

- (가) 노트북: `app/meeting-recorder.js`
  - [멈추고 정리] → `stopAndFinish()`(311~323줄) → `finishSession()`(373~377줄) → `serverFinish({start:{workspace_id,kind:'recording',session_id}})`(383~403줄).
  - `watchServerJob`(`app/meeting-server-job.mjs` 69~101줄)이 `job_start`를 보내고 5초(숨겨진 화면은 30초)마다 `job_read`로 진행만 본다.
  - 끝나면 `openServerResult(job)`(406~438줄) → `openEntry()`(439~446줄) → `KPTUReportEntry.open({kind:'meeting',at})`(444줄) → `app/team.js` 524~539줄 → `openMeetingModal`(568줄).
  - 창이 열린 뒤 `KPTUMeetingTranscriptDraft.fillResult({text,draft,jobs,name})`(428줄, 정의 `app/meeting-transcript-draft.js` 279~293줄)로 전문·요약을 채우고, `job_opened({job_id})`만 보낸다(429줄 — 회의 id는 보내지 않음).
  - 바로 열지 못하면 띠가 '정리 끝 · 회의 요약이 준비됐어요 [초안 열기][닫기]'(103~106줄). [초안 열기] → `openReady()`(448~452줄) → 같은 `openServerResult`.
  - 서버가 서버 정리를 모를 때만 옛 화면 정리 길: `finishOnScreen()`(475~517줄) → `openDraft()`(522~533줄) → 같은 `KPTUReportEntry.open` → `draft.fill`(화면이 `meeting-ai-draft`를 부름).
- (나) 폰 앱: `app/phone-recorder.js`·`app/phone-recorder-core.mjs`
  - `job_start`(core 212줄) 뒤 진행 띠를 `KPTUMeetingRecorder.watch(job)`에 넘긴다(core 223줄, `phone-recorder.js` 43줄, `meeting-recorder.js` 629~635줄). 그 뒤는 (가)와 같은 `openServerResult`.
  - 폰 알림을 눌러 연 주소 `?view=reports&rec_job=<작업 id>`는 `loadServerJobs()`(455~472줄)가 읽어 같은 길로 초안 창을 연다.
  - 서버가 서버 정리를 모르면 `deps.openDraft`(core 257줄, `phone-recorder.js` 44~54줄) → `KPTUReportEntry.open` → `draft.fill`.
- (다) 그 자리 전사: `app/meeting-round-detail.js` 590~601줄 → `KPTUMeetingRecorder.transcribeAttached({documentId,meetingId})`(`meeting-recorder.js` 619~627줄, `kind:'attached'`) → 끝나면 `openServerResult`의 attached 갈래(407~418줄) → `KPTUMeetingRoundDetail.fillTranscript(job.meeting_id,{text,draft})`(`meeting-round-detail.js` 604줄~). 이미 **어느 회의인지 정해진** 길이다.
- (라) 파일: `app/meeting-transcript-draft.js` — `takeAudio`(103줄)·`transcribe`(117줄) → `run()`(216줄) → `keepFull`(181줄, 전문을 '회의록 전문' 칸에) → `applyDraft`(199줄, 요약을 '회의 결과' 칸에 `mergeText`로 덧붙임). 이 길의 전사 글은 **화면만 갖고 있다**(서버 작업 행이 없다 — Edge `transcribe`는 글을 응답으로만 돌려준다, `supabase/functions/meeting-transcribe/index.ts` 8~10줄).

네 길 모두 **새 보고든 기존 보고든 저장은 사람이 누른다.**

### 1-2. 서버 작업 길이 지금 저장하는 것

- Edge `meeting-transcribe`(`supabase/functions/meeting-transcribe/index.ts`). verify_jwt=true(`docs/web2-env6b-edge-source.md` 5절 38행)이고 코드에서도 로그인을 다시 확인한다(2줄 주석, `userOf` 78줄).
  - 입구 1107~1144줄. `job_tick`만 서버 키 HMAC(1097~1105줄), 나머지는 `userOf(req)` 뒤 action별 처리(1131~1135줄 `job_start`·`job_read`·`job_list`·`job_opened`·`job_retry`).
  - 소유 확인 `requireOwner(userId, workspaceId)`(89~94줄): 화면이 보낸 `workspace_id`를 그대로 믿지 않고 `app_workspace_members`에서 그 로그인의 `role='owner'`를 확인한다. 작업 id로 들어오는 action은 작업 행의 `workspace_id`와 만든 사람으로 다시 확인한다(`ownServerJob`).
  - `jobStart`(981~1041줄): 작업 한 행을 넣고(1036줄) `runStep`을 뒤에서 돌린다. 같은 녹음에 진행 중 작업이 있으면 새로 만들지 않고 그 작업을 돌려준다(990~993줄). 유일 색인 충돌(23505)은 `busy`(1037줄).
  - `runStep`·`stepOnce`(759~861줄): 한 번 호출 = 한 단계. 잡기(lease) → `combine` → `transcribe` → `summary` → `done`, 단계마다 같은 함수의 `job_tick`을 다시 부른다. 요약 단계는 긴 글을 조각으로 나눠 요약한 뒤 합치고, 시간 초과·답 잘림이면 반으로 나눠 잇는다.
  - `jobOpened`(1063~1075줄): `opened_at`을 적는다. `meeting_id`를 함께 받으면 **부른 사람 로그인(owner RLS)으로 그 회의를 읽어** 같은 작업공간인지 확인한 뒤 작업 행에 적는다. 지금 화면은 이 값을 보내지 않는다.
  - `jobList`(1051~1061줄): 지난 48시간의 내 작업 가운데 `opened_at`이 빈 것만(1056줄). 한 번 '열었음'이 되면 띠에 다시 뜨지 않는다.
  - 끝 알림 `notifyDone`(952~978줄): 폰 알림 '회의 요약이 준비됐어요', 주소에 `rec_job`. 알림에는 제목·글을 싣지 않는다.
- 서버 정리 작업의 결과가 남는 곳은 **작업 표**다: `public.app_meeting_server_jobs`(`supabase/migrations/20261103170000_meeting_server_jobs.sql` 34~75줄) — `transcript_text`(전사 전문)·`draft`(요약 초안)·`parts`·`status`·`stage`·`error_code`·`meeting_id`·`opened_at`. 실패 이력 칸 `fail_log`와 그것을 채우는 트리거는 뒤에 더해졌다(`supabase/migrations/20261111010000_meeting_server_job_fail_log.sql`). 그 밖에 구간 전사 작업 표의 상태(882~892줄), AI 사용량(938줄), 폰 알림 기록·기기(963~977줄)를 쓴다. **`app_meetings`(보고)는 건드리지 않는다.**
  - 권한: authenticated는 읽기만(정책 `meeting_server_jobs_owner_read`, `private.app_is_workspace_owner(workspace_id)`, 96~97줄), 쓰기는 service_role이 **정해진 칸만**(85~94줄), 지우기·anon·PUBLIC 없음.
  - `kind`는 `recording`·`attached` 둘, `stage`는 `combine`·`transcribe`·`summary`·`done` 넷으로 check 제약이 걸려 있다(60~64줄).
- Edge `meeting-ai-draft`(verify_jwt=true, 5절 8행): 화면 정리 길·[녹음 요약하기]가 부르는 요약 함수. '새 회의' 길(meeting_id 없음)은 서버에 저장하지 않는다(`app/meeting-transcript-draft.js` 3줄).
  - 이 함수에는 `meeting_id`를 주면 **그 요청 안에서, 부른 사람 로그인으로** 보고 행(`transcript_text`·`ai_draft`·`result_status`)을 고치는 옛 길이 남아 있다(`app/workflow-ai-v3.js` 55줄이 부름). 그 창을 여는 `window.__KPTU_OPEN_AI_FOR_MEETING__`을 부르는 곳은 앱에서 검색 0건이다(추정: 지금 화면에서는 닿지 않는 옛 길). 이번 설계는 이 길을 쓰지 않고 고치지도 않는다.

### 1-3. 보고가 저장되는 표·칸

- 보고 한 건 = `public.app_meetings` 한 행. [사업 보고 저장] = `saveMeeting`(`app/team.js` 434줄)이 PostgREST로 직접 insert. 수정 저장 = `mrdSaveEdit`(`app/meeting-round-detail.js` 352줄~)의 PATCH(376줄) — **덮어쓰기**.
- 칸 대응([회의] 칸 기준. 화면 이름과 칸 이름이 엇갈리니 주의):

| 화면 | DB 칸 |
| --- | --- |
| 회의명 / 짧은 이름 | `series_name` / `title` |
| 일시 | `meeting_at` |
| 차수 | `round_no` |
| 참석인원 | `attendees` |
| **회의 결과**(요약: 참석·결정·공유) | `transcript_text` |
| **회의록 전문**(전사 전체) | `notes` |
| 휴지통 | `deleted_at`(`supabase/migrations/20261025100000_trash_org_report_db.sql` 67줄) |

- 녹음·자료·사진 연결 = `public.app_documents` 행(`meeting_id`, `file_id`(Drive), `tags`). 녹음은 Edge `meeting-transcribe`의 `attach`(374~388줄)가 자료 행 하나를 만들고(모양 `attachDocument`, `model.mjs` 236~245줄, 태그 '회의녹음') `app_meeting_transcribe_jobs.meeting_id`를 채운다. DB만 쓰고 Drive는 건드리지 않는다. 화면은 [이 회의에 녹음 붙이기]가 켜진 채 저장했을 때만 저장 뒤(`kptu:record-saved`) 이것을 부른다(`app/meeting-transcript-draft.js` 155~168줄). 붙이지 않은 녹음은 30일 뒤 Drive 휴지통(`model.mjs` 17줄).
- 후속 할 일 = Google Tasks가 원본(Edge `google-tasks`), 보고와의 연결은 `app_record_links`(`meeting_id`·`google_task_id`).
- 휴지통: DELETE가 오면 트리거가 지우지 않고 `deleted_at`만 채운다(위 migration 94~115줄). 화면은 `deleted_at`을 직접 채울 수 없고 휴지통 행을 볼 수도 없다(restrictive 정책 `app_meetings_trash_hidden`, 74~75줄). 되살리기는 RPC `app_trash_restore('report', id)`(소유자 확인 포함). **Edge(service_role)는 RLS를 건너뛰므로 `deleted_at is null`을 직접 걸러야 한다.**
- **보고 글의 옛 판을 보관하는 표·칸은 없다**(`revision|history|previous_|prior_`로 찾으면 다른 표의 것만 나온다 — 예: 수집 요약 고친 이력 `supabase/migrations/20261027200000_tg_summary_edit.sql` 52줄. `app_meetings`에 대한 것은 0건). 수정 저장은 덮어쓰기다.
- 보고에 '녹음으로 썼다'·녹음 길이·녹음 시작 시각을 적는 칸도 없다. 녹음과 보고의 고리는 위 붙이기(자료 행 태그 '회의녹음', `app_meeting_transcribe_jobs.meeting_id`)뿐이고, 붙이기를 끄고 저장한 보고는 고리가 없다. 서버 정리 작업 행의 `meeting_id`는 녹음 길(recording)에서는 늘 비어 있다(화면이 안 보냄, 1-2).

### 1-4. '자동 저장 없음' 원칙이 걸린 곳

- `app/meeting-transcript-draft.js` 5~6줄 머리 주석: "저장은 … [사업 보고 저장]으로 한다(자동 저장 없음)"(2026-10-29 결정).
- `app/meeting-recorder.js` 12줄·404줄 주석: "저장은 … [사업 보고 저장]".
- `app/meeting-server-job.mjs` 1~5줄: 서버는 합치기 → 전사 → 요약까지만, 화면은 진행만 본다.
- 코드로는: 서버 정리 작업이 `app_meetings`를 쓰는 곳이 없고(1-2), 화면도 결과를 **입력 창 칸에 채우기만** 한다(`fillResult`·`applyDraft`·`mrdFillTranscript`).
- 이번 사용자 결정으로 **잇기·합치기에 한해** 자동 저장으로 바뀐다. 나머지(새 보고 만들기, 그 자리 전사를 수정 창에 넣기, 파일 넣기)는 그대로 '사람이 저장'이다. 구현 PR은 위 세 주석에 이 예외를 한 줄씩 적는다.

### 1-5. 보고 ⋯ 메뉴가 뜨는 곳

- 메뉴 정의는 한 곳: `mrdEnsureMoreMenu()`(`app/meeting-round-detail.js` 73~81줄). 항목은 [수정]·[종류 바꾸기]·[삭제].
- 목록 우클릭(`meetingListMenu`, `app/team.js` 394~396줄)·달력과 사진 보기 우클릭(`reportViewMenu`, 383~389줄)은 모두 `openReportMenuAt`(377줄~)으로 모여 상세 창의 그 ⋯ 메뉴를 누른 자리에 띄운다. 그래서 **한 곳에 항목을 더하면 세 곳에 다 뜬다.**
- 요청함이 '진행 중'이라고 적은 #2370(달력 우클릭)은 이 기준선에 이미 들어와 있다(`f5d826f`). 줄 세울 필요가 없다.
- 시안 ④의 메뉴 그림은 [고치기]로 그렸지만 실제 항목 이름은 [수정]이다. 이름은 바꾸지 않고 [다른 보고에 합치기]만 더한다.

## 2. 요청 6번 확인 — 저장 안 한 첫 초안이 둘째 정리로 사라지는가

**결론: 사라진다(사실).** 두 순간에 일어난다.

### 2-1. 코드로 따라간 것 (사실)

1. **저장 안 한 초안 창을 닫을 때 묻지 않는다.** 입력 창 닫기는 `closeModal`(`app/team.js` 404줄)이 창을 숨기기만 하고, 닫기 요청의 기본 처리도 같은 함수다(403줄). `#meetingModal`을 만지는 모듈(`team.js`·`meeting-transcript-draft.js`·`meeting-from-files.js`·`task-workflow.js`·`workflow-ai-v3.js`) 어디에도 '쓰던 글이 있으면 묻기'가 없다. 일기·바구니·편집 창에는 있다(`app/diary.js` 874줄 `CLOSE_TEXT`, `app/basket.js`의 `closeDetailText`, `app/ed-window.js` 99줄).
2. **둘째 녹음을 하려면 첫 초안 창을 닫아야 한다.** [녹음] 버튼은 사업 보고 위쪽 줄에 있고(`app/index.html` 163줄), 입력 창은 화면 전체를 덮는다(`.modal`, `app/base-ui.css` 139줄). 그리고 정리 중·'정리 끝' 띠가 떠 있는 동안은 [녹음]이 잠긴다(`paintButton`, `meeting-recorder.js` 120줄).
3. **닫은 초안은 다시 열 길이 없다.** 창을 다시 여는 길은 모두 `openMeetingModal`(`app/team.js` 568줄)을 지나는데, 이 함수는 회의명·일시·회의록 전문·차수·짧은 이름·회의 결과 칸을 **조건 없이 비우고** 시작한다. 첫 결과는 창을 열 때 이미 서버에 '열었음'으로 알렸으므로(`job_opened`, `meeting-recorder.js` 429줄) 띠의 [초안 열기]에도 다시 뜨지 않는다(`jobList`, Edge 1056줄).
4. **창이 열려 있어도 결과가 오면 묻지 않고 비운다.** `openServerResult`(406~438줄) → `KPTUReportEntry.open` → `openMeetingModal`은 창이 이미 열려 있는지, 칸에 글이 있는지 보지 않는다. 녹음 띠는 입력 창보다 위에 떠 있어(`.rec-band` z-index 70, `app/meeting-recorder.css` 4줄 > `#meetingModal` 51, `app/project-system-v3.css` 32줄) 창을 연 채로 [멈추고 정리]·[초안 열기]를 누를 수 있다. 그래서 **녹음하면서 입력 창에 직접 쓰던 글**도 정리 결과가 열릴 때 지워진다. 요청이 물은 경우와 뿌리가 같다.
5. 새로고침·창 닫기 경고(`beforeunload`, 602~606줄)는 녹음 중·조각 올리는 중에만 뜬다. 저장 안 한 초안은 경고 대상이 아니다.

남는 것: 녹음 소리(Drive, 붙이지 않으면 30일 뒤 휴지통)와 서버 작업 행의 전문·요약(`app_meeting_server_jobs`, 화면에서 다시 여는 길 없음). 화면에서는 되찾을 수 없다.

### 2-2. 브라우저 시험으로 본 것

`tests/app-e2e/rec-join-open-draft.spec.mjs`(새 파일, 가짜 마이크·가짜 서버·가짜 글)가 지금 동작을 그대로 적는다.

- ① 첫 녹음 정리 → 초안 창 → 저장하지 않고 [닫기](묻는 창 없이 닫힘) → 화면이 서버에 첫 결과를 '열었음'으로 보냄 → 띠가 닫히고 [녹음]이 다시 켜짐 → 둘째 녹음 정리 → 다시 열린 창의 '회의록 전문'·'회의 결과'에는 둘째 글만 있고 첫 글은 없다. 그 사이 저장 요청은 0건.
- ② 녹음 중에 입력 창을 열어 '회의 결과'에 직접 쓴다 → 창을 연 채 띠의 [멈추고 정리] → 결과가 열리면 직접 쓴 글이 없다.

결과: **두 시험 모두 통과**(2026-11-11, 이 PR의 CI `browser-e2e` 첫 실행 — ①은 14번 갈래, ②는 15번 갈래). 화면에서 사실로 확인된 것: 2-1의 1(닫을 때 묻지 않음), 3의 앞부분(다시 여는 창은 비워지고, 첫 결과를 '열었음'으로 보냄), 4('회의 결과' 칸에 쓰던 글이 지워짐). **시험이 보지 않는 것**: '열었음'이 된 결과가 띠에 다시 안 뜨는 것은 서버 쪽 거르기(Edge 1056줄)라 가짜 서버로는 증명되지 않는다 — 코드 읽기로만 확인했다. 2-1의 2(창을 닫아야 둘째 녹음 가능)·5도 코드 읽기다. 이 세션은 규칙대로(`docs/web-session-testing.md` '하지 않는 일') 브라우저 시험을 직접 돌리지 않고 CI 결과로 확인했다.

이 시험은 **고치기 전 동작을 적어 둔 것**이다. PR-0이 막는 물음을 넣으면서 기대를 새 동작으로 바꾼다(지우거나 건너뛰지 않는다).

### 2-3. 고칠 때(PR-0) 지킬 것

- 묻는 곳은 한 곳: 입력 창의 주인인 `app/team.js`(`KPTUReportEntry.open`·`openMeetingModal`). 모든 길이 여기를 지나므로 녹음 네 길·다른 화면이 여는 길이 한 번에 막힌다. 길마다 따로 막지 않는다.
- 창이 열려 있고 사람이 쓴(또는 채워진 뒤 저장 안 한) 글이 있으면 비우기 전에 묻는다. 고를 것: 쓰던 창 그대로 두기(결과는 띠에 남김) / 쓰던 글을 버리고 새 결과 열기.
- 저장 안 한 채 닫을 때 묻는다(일기·바구니와 같은 물음 부품).
- 녹음 결과는 **저장했을 때**(회의 id와 함께) 또는 사람이 버렸을 때 '열었음'으로 알린다. 창을 열기만 했을 때는 알리지 않아, 닫아 버린 초안도 띠 [초안 열기]로 다시 열 수 있게 한다. Edge `job_opened`는 이미 회의 id를 받으므로(1063~1075줄) 서버는 고칠 것이 없다. 이렇게 하면 '이 녹음으로 쓴 보고'가 서버에 남아 3-3절의 물음 조건도 정확해진다.
- 덮어쓰기·숨김으로 가리지 않는다(창을 두 벌 두거나, 지운 뒤 다시 채워 넣는 식은 쓰지 않는다).

## 3. 정할 것

### 3-1. ① '그 보고에 잇기' 서버 작업 흐름

**원칙**: 화면은 "어느 보고에, 무엇을 잇는다"만 말한다. 작업공간·소유·저장은 서버가 정한다.

요청(화면 → Edge `meeting-transcribe`, 모두 로그인 필요):

| action | 몸통 | 뜻 |
| --- | --- | --- |
| `join_start` | `{target_meeting_id, source:{job_id}}` | 서버 정리가 끝난 녹음 결과(아직 보고로 저장 안 함)를 그 보고에 잇기 — (가)(나)(다) |
| `join_start` | `{target_meeting_id, source:{meeting_id}}` | 이미 저장한 다른 보고를 그 보고에 합치기 — ⋯ [다른 보고에 합치기] |
| `join_text` | 몸통 = 전사 글 그대로. 머리글 `x-target-meeting-id`, `x-record-jobs`(붙일 녹음 작업 id, 쉼표, 20개까지) | 입력 창이 갖고 있는 전사 글을 그 보고에 잇기 — (라) |
| `join_candidates` | `{job_id}` 또는 `{meeting_id}` | 같은 날 녹음으로 쓴 보고 목록(id·녹음 길이). 3-3절 |
| `join_read` · `join_list` · `join_retry` | `{job_id}` · `{}` · `{job_id}` | 진행 보기 · 내 진행 중/막 끝난/실패 목록 · 다시 |
| `join_seen` | `{job_id, candidates?}` | 끝 알림을 닫음 / 새 할 일 후보를 닫음 |
| `join_undo` | `{job_id, scope:'before'\|'joined'\|'all'}` | 회의 결과를 합치기 전 글로 / 이은 글로 / 통째로 되돌리기(3-5절) |

**몸통에 `workspace_id`가 없다.** 서버가 정하는 순서(`join_start`·`join_text`):

1. 로그인 확인 `userOf(req)`(지금과 같음, 78줄).
2. 고른 보고를 **부른 사람의 로그인으로** 읽는다(`userClient(req)` — owner RLS `task12a_owner_all` + 휴지통 숨김 정책). 못 읽으면 없는 것·남의 것·휴지통 구분 없이 `not_found`.
3. 작업공간 = **읽은 보고 행의 `workspace_id`**. 그 값으로 `requireOwner(user.id, …)`를 한 번 더 한다(다른 action과 같은 기준).
4. 고른 보고가 [회의] 칸인지 확인한다(`activity_kind`가 `meeting`이거나 비어 있음, `app/report-kinds.mjs` 18·22줄). 다른 칸에서는 `notes`가 '특이사항'이라(`app/report-words.mjs` 30줄) 전문으로 보고 덮으면 안 된다 → `bad_target`.
5. 잇는 재료 확인.
   - `job_id`: `ownServerJob`(작업공간 owner + 만든 사람)으로 읽고, 보고와 같은 작업공간·`status='done'`·아직 다른 보고에 쓰이지 않음(`meeting_id`가 비었거나 그 보고)을 확인. 그 자리 전사(attached) 작업이면 `meeting_id`가 고른 보고여야 한다.
   - `meeting_id`: 부른 사람 로그인으로 읽고, 같은 작업공간·고른 보고와 다른 행·[회의] 칸임을 확인.
   - 글(`join_text`): 100만 자 이하(작업 표의 전문 한도와 같음). 붙일 녹음 작업 id는 하나씩 `ownJob` + **끝남·휴지통 아님·아직 어느 회의에도 안 붙음·같은 작업공간**(지금 `attach` 374~388줄이 하는 확인과 같게).
6. 고른 보고·없어지는 보고 어느 쪽도 **다른 진행 중 잇기 작업에 어떤 역할로든**(이을 보고든 없어질 보고든) 걸려 있지 않아야 한다. 걸려 있으면 `busy`. (예: 가에 녹음을 잇는 중에 가를 나에 합치면, 나는 옛 가 글로 만들어지고 새 녹음은 휴지통의 가에만 남는다.)
7. 앞 글이 있는지 확인: 고른 보고의 '회의록 전문'(`notes`)에 글이 있어야 한다. 없으면 그 보고에 연결된 서버 정리 작업(`meeting_id`가 그 보고)의 전문을 쓴다. 둘 다 없으면 **시작하지 않고** `no_first_transcript`(전체 다시 요약을 할 재료가 없음 — 보고는 그대로).
8. 잇기 작업 한 행을 넣는다(3-2절 표). `workspace_id`는 3의 값, `created_by`는 로그인한 사람. **시작할 때 읽은 보고의 두 글**을 `before_result`·`before_notes`에 넣어 둔다(합치기면 없어지는 보고의 두 글 지문도). 바로 `{ok, job}`을 돌려주고 뒤에서 단계를 돌린다.

합친 전문 규칙(요청 3):

- 순서: 고른 보고의 전문이 앞, 잇는 재료가 뒤. 다만 재료의 시작 시각이 고른 보고의 일시보다 앞이면 재료를 앞에 둔다(시간순).
- 시각의 출처(보고에는 녹음 시작 칸이 없다, 1-3): 보고 = `meeting_at`(녹음으로 만든 보고는 화면이 녹음 시작 시각으로 채운다, `meeting-recorder.js` 423·444줄). 녹음 결과 = 작업 `created_at` − 녹음 길이(화면이 지금 쓰는 계산, 423줄). 글(mode `text`) = 시각 모름(늘 뒤에 둔다).
- 사이에 한 줄 `― 이어서 · HH:MM 녹음 ―`(뒤에 오는 쪽의 시작 시각, 서울). 시각을 모르면 `― 이어서 ―`. 지금 구간 구분 줄(`― 60분부터 ―`, Edge `server-job.mjs` `joinParts` 92줄~)과 같은 긴 줄표를 써서, 구분 줄을 말소리로 세지 않는 기존 검사(`meeting-recorder.js` 505줄 등)가 그대로 통한다.
- 이미 쓴 전문은 지우지 않고 붙인다('이미 쓴 글은 지우지 않는다', `app/meeting-transcript-model.mjs` 115줄 `mergeText`).

뒤에서 도는 단계(사용자 로그인 없음, 서버 키 HMAC):

| 단계 | 하는 일 | 보고를 건드리나 |
| --- | --- | --- |
| `summary` | 합친 전문으로 회의 결과를 처음부터 다시 요약. 지금 요약 단계 코드(`stepOnce`의 summary 갈래, 긴 글 조각 요약·반 나눔·`serverDraft` 한도·사용량 기록)를 **그대로 함께 쓴다** | 아니오 |
| `apply` | 서버 전용 DB 함수 한 번(3-2절). 보고 글 바꾸기 + 녹음 연결(합치기면 자료·할 일 연결 옮기기 + 없어지는 보고 휴지통)을 **한 트랜잭션**으로 | 예(여기서만) |
| `done` | 끝 알림 | 아니오 |

Edge에서 고칠 곳(PR-2가 막히지 않게 적어 둔다):

- **단계 입구**: 지금 `job_tick`은 몸통 키가 `exp,job_id` 둘일 때만 받고(`server-job.mjs` `tickCheck` 38~40줄), `runStep`은 서버 정리 작업 표 하나에 묶여 있다(`readServerJob`·`patchServerJob` 722~738줄, 767줄). 새 action `join_tick`을 같은 모양으로 두되 **서명 머리글자를 따로**(`meeting-job-tick:` → `meeting-join-tick:`) 써서 한쪽 서명이 다른 쪽에서 통하지 않게 한다. `runStep`은 '어느 표·어느 tick'인지 받게 고치고, 요약 갈래는 끝에서 지금 바로 `done`으로 가는데(861줄) 잇기 작업이면 `apply`로 간다. 요약 코드를 한 벌 더 만들지 않는다. 그래서 새 표의 칸 이름(`status`·`stage`·`step_no`·`step_total`·`summary_parts`·`transcript_text`·`draft`·`lease_until`·`attempts`·`error_code`)을 서버 정리 작업 표와 같게 맞춘다.
- **회의 결과 글 만들기**: 요약을 '회의 결과' 글로 펴는 `draftText`는 화면에만 있다(`app/meeting-transcript-model.mjs` 93줄). Edge 묶음은 `app/`을 불러오지 않으므로 Edge 쪽에 같은 함수를 두고, **두 함수가 같은 입력에 같은 글을 내는지 맞춰 보는 단위 시험**을 넣는다.
- **`join_text`**: 지금 JSON 몸통은 4096자에서 막힌다(1116~1119줄). `upload`·`rec_piece`처럼 그 앞에서 따로 가른다. CORS 허용 머리글(66줄)에 `x-target-meeting-id`·`x-record-jobs`를 더한다.
- **`join_list {}`**: 작업공간을 몸통으로 받지 않는다. 로그인한 사람이 owner인 작업공간(`app_workspace_members`)의, 그 사람이 만든 작업만 — 지난 48시간의 진행 중·실패·끝났는데 `seen_at`이 빈 것. 결과 글은 싣지 않는다(지금 `job_list`와 같음).
- **`join_candidates`**: `{job_id}`면 `ownServerJob`으로, `{meeting_id}`면 부른 사람 로그인으로 그 보고를 읽어 작업공간을 정한다. 보고 목록은 **부른 사람 로그인으로** 읽는다(휴지통 숨김이 그대로 걸린다). 녹음 길이만 서비스 권한으로 읽되 그 작업공간·그 보고 id로 거른다.
- **잇는 중인 녹음 결과는 `job_list`에서 뺀다.** 그러지 않으면 잇기가 끝나기 전에 다른 기기에서 [초안 열기] → 새 보고 저장으로 같은 녹음이 두 보고에 들어간다. 잇기가 실패하면 다시 보인다.
- **새 실패 코드의 화면 문구**: 서버 코드 목록(`model.mjs`)에 코드를 더하면 `tests/meeting-server-job.test.mjs`가 화면 문구 표(`app/meeting-server-job.mjs` `FAIL_TEXT`)에도 같은 코드를 요구한다. 그래서 문구 표 줄은 PR-2가 같이 넣는다(글자만, 동작 없음).
- **끝 알림(폰)**: 지금 `notifyDone`과 같은 길(FCM, 설정·조용한 시간 존중, 제목·글은 싣지 않음)로 '보고에 이어 붙였어요'. **알림 종류는 지금 있는 `meeting_done`('회의 요약')을 그대로 쓴다.** 종류를 새로 만들면 `app_push_log`·`app_profiles`의 기존 check 제약 2개를 고치는 DB 변경이 따로 필요하다(선례 `supabase/migrations/20261105120000_family_push_kind.sql` 28~33줄) — 이번 줄에는 넣지 않는다. 여는 주소는 `?view=reports&join_job=<작업 id>&notice=meeting_done.<열쇠>`.
- **`join_retry`**: `report_changed`·`source_changed`로 멈춘 작업은 **처음부터** — 같은 보고·같은 재료로 `join_start`의 확인을 다시 거쳐 **새 작업 행**을 만든다(앞 행은 실패로 남긴다. `before_*`는 넣을 때만 쓰는 칸이라 고쳐 쓰지 않는다). 그 밖은 지금 `job_retry`처럼 멈춘 단계부터.

**녹음 띠와 따로 돈다(중요).** 녹음 띠는 상태 하나짜리 기계다(`meeting-recorder.js` 30~37줄). 띠가 idle이 아니면 [녹음]이 잠긴다(120줄). 잇기를 띠의 상태로 넣으면 잇는 몇 분 동안 다음 녹음을 못 한다. 그래서:

- 진행 줄 '○○에 잇는 중 · 전체 다시 요약 · 화면을 옮겨도 계속돼요'와 끝 줄 '○○ 보고에 이어 붙였어요 [열기]'는 **맨 위 알림 줄**(`app/notice-bar.js`의 손님, `putNotice`)로 그린다. 그리는 주인은 새 모듈 하나(`app/meeting-join.js`)다. 회의 이름은 화면이 자기 자료로 붙인다(서버·폰 알림에는 싣지 않음).
- [그 보고에 잇기]를 누르면 녹음 띠는 바로 닫힌다(idle). 그 녹음 결과는 `apply`가 '열었음 + 그 보고'로 표시한다.
- 앱을 다시 열면 `join_list`로 진행 줄을 이어 그린다(지금 `job_list`와 같은 방식).

실패하면: 까닭별 한 줄 + [다시](되는 것만) + [새 보고로 열기](그 녹음 결과를 지금처럼 초안 창으로). 보고는 그대로다. 녹음 결과도 다시 띠 [초안 열기]에 보인다.

### 3-2. ② '합치기 전 글' 보관 — 새 표 1개 + 서버 전용 함수 2개

**DB가 필요하다.** 이유: (1) 보고 글의 옛 판을 둘 곳이 지금 없다(1-3). (2) 뒤에서 도는 작업의 상태를 둘 곳이 필요하다. (3) '바꾸기 + 연결'이 한 번에 되거나 아예 안 되어야 한다(실패하면 보고는 건드리지 않음) — Edge에서 REST를 여러 번 부르는 것으로는 안 된다.

**새 표 `public.app_meeting_join_jobs`** — 잇기·합치기 한 번 = 한 행. 밑그림(실제 migration은 PR-1이 쓴다):

| 칸 | 뜻 | 쓰는 쪽 |
| --- | --- | --- |
| `id`, `workspace_id`(→ `app_workspaces`, cascade), `created_by` | 작업공간은 고른 보고 행에서 서버가 읽은 값 | Edge(넣을 때) |
| `mode` | `job`(녹음 결과 잇기) · `report`(저장한 보고 합치기) · `text`(입력 창의 전사 글 잇기) | Edge(넣을 때) |
| `target_meeting_id`(→ `app_meetings`, cascade) | 이을 보고 | Edge(넣을 때) |
| `source_job_id`(→ `app_meeting_server_jobs`, set null) · `source_meeting_id`(→ `app_meetings`, set null) · `source_text` · `source_record_jobs`(붙일 녹음 전사 작업 id들) · `source_result_sha`·`source_notes_sha`(합치기: 없어질 보고의 두 글 지문) | 잇는 재료 | Edge(넣을 때) |
| `before_result` · `before_notes` | **합치기 전** 회의 결과·회의록 전문. 시작할 때 읽은 그대로. 넣은 뒤에는 바뀌지 않는다 | Edge(넣을 때만) |
| `status` · `stage` · `step_no` · `step_total` · `summary_parts` · `transcript_text`(합친 전문) · `draft` · `result_text`(회의 결과 칸에 넣을 글) · `error_code` · `lease_until` · `attempts` · `started_at` · `finished_at` | 서버 정리 작업 표와 같은 이름·같은 뜻. `stage`는 `summary`·`apply`·`done` | Edge(진행) |
| `applied_at` · `moved`(jsonb: 새로 만든 자료 행 id, 옮긴 자료 행 id, 옮긴 할 일 연결 id) · `kept_result`(되돌릴 때 보고에 있던, 사람이 직접 고친 글 한 벌) · `undone_at` | 적용·되돌리기 기록. `status`에 `undone`(통째 되돌림) | **함수만** |
| `seen_at` · `candidates_closed_at` · `created_at` · `updated_at` | 끝 알림 닫음 · 할 일 후보 닫음 | Edge |

- 제약: `mode`·`status`·`stage` 값, 글 길이(전문 100만 자), jsonb 모양·크기, `error_code` 모양. **'재료 칸 가운데 하나는 꼭 차 있어야 한다'는 check는 걸지 않는다** — 없어진 보고를 휴지통에서 영구 삭제하면 `source_meeting_id`가 비는데(set null), 그 check가 있으면 영구 삭제가 막힌다. 재료가 mode와 맞는지는 Edge가 넣을 때와 함수가 쓸 때 확인한다.
- 부분 유일 색인: 같은 `target_meeting_id`에 진행 중(`queued`·`running`) 하나 / 같은 `source_job_id`에 진행 중·끝남 하나 / 같은 `source_meeting_id`에 진행 중 하나.
- **권한은 서버 정리 작업 표와 같은 모양**(20261103170000 84~97줄): RLS 켬, authenticated는 `private.app_is_workspace_owner(workspace_id)`로 **읽기만**, service_role은 읽기 + 위 표의 'Edge' 칸만 넣기·고치기, 지우기 없음, anon·PUBLIC 없음. **적용·되돌리기 기록 칸과 `before_*`는 service_role에도 고치기 권한을 주지 않는다**(함수만 쓴다). 합치기 전 글은 자기 보고의 글이므로 주인만 읽는다.
- 서버 정리 작업 표에는 실패 이력 칸·트리거(`fail_log`, `supabase/migrations/20261111010000_meeting_server_job_fail_log.sql`)가 있다. 새 표에는 이번에 넣지 않는다(필요해지면 같은 모양으로 따로).
- 크기: 한 행에 전문 사본이 두 벌까지 남는다(`before_notes`·합친 전문). `apply`가 끝나면 작업용 사본(`summary_parts`·`source_text`)은 비운다. 합친 전문은 남긴다 — 보고가 옛 글로 덮였을 때 되찾는 원본이기 때문이다(3-5절). 보관 기한은 두지 않고, 보고를 영구 삭제하면 그 보고의 잇기 작업 행도 함께 없어진다(cascade).

**서버 전용 함수 2개**(둘 다 `security definer` + `set search_path = ''`, 실행권은 **service_role만** — PUBLIC·anon·authenticated 회수. 사용자 로그인 확인은 부르는 Edge가 하고, 함수는 아래를 SQL로 **다시** 확인한다. 화면이나 Edge가 만든 행 모양을 받지 않고 **id만 받아 DB 행에서 직접 만든다**):

- `public.app_meeting_join_apply(p_job uuid)`
  1. 작업 행 잠금: `status='running'`·`stage='apply'`·`applied_at is null`이 아니면 아무것도 안 하고 지금 상태를 돌려줌(두 번 불러도 한 번만).
  2. 작업을 만든 사람이 **지금도** 그 작업공간의 owner인지(`app_workspace_members`).
  3. 고른 보고 잠금: 같은 작업공간·`deleted_at is null`·[회의] 칸. **지금 두 글이 시작할 때 읽은 글(`before_result`·`before_notes`)과 같은지 글 자체로 비교한다.** 다르면 예외(`report_gone` / `report_changed`) → 전체 취소. (`updated_at`만 보지 않는다 — 이 값은 화면이 자기 시계로 적고(`app/meeting-round-detail.js` 361줄) 안 올리는 쓰기도 있어(`app/report-links.js` 106줄) 믿을 수 없다.)
  4. 보고를 고친다: `transcript_text = result_text`, `notes = 합친 전문`, `updated_at = now()`. **회의명·일시·참석인원·차수·종류·연결은 건드리지 않는다**(요청 3).
  5. mode `job`·`text`: `source_record_jobs`의 녹음 전사 작업 행을 하나씩 잠그고 같은 작업공간·끝남·휴지통 아님을 확인한다. 아직 안 붙었으면 그 행에서 **직접** 자료 행을 만들어 넣는다(모양은 지금 `attachDocument`, `model.mjs` 236~245줄과 같게: 분류 '회의자료'·태그 '회의녹음'·Drive 주소·`visibility 'private'`·올린 사람 = 작업 만든 사람·작업공간과 회의는 보고 행의 값). 이미 그 보고에 붙어 있으면 건너뛰고, **다른 보고에 붙어 있으면 예외 `already_joined`**. mode `job`이면 서버 정리 작업 행도 잠가 `meeting_id`가 비었거나 그 보고일 때만 `meeting_id`·`opened_at`을 채운다(아니면 `already_joined`).
  6. mode `report`: 없어지는 보고 잠금 — 같은 작업공간·휴지통 아님·[회의] 칸·**두 글 지문이 시작 때와 같음**(다르면 `source_changed`) → 그 보고의 자료 행(`app_documents.meeting_id`)과 할 일 연결(`app_record_links`의 할 일 줄, 같은 할 일이 이미 붙어 있으면 그대로 둠), 녹음 작업의 `meeting_id`를 고른 보고로 옮김 → 없어지는 보고에 `deleted_at = now()`(**휴지통, 지우지 않음**). 옮긴 id는 `moved`에.
  7. 작업 행: `applied_at`·`status='done'`·`stage='done'`, 작업용 사본 비우기.
- `public.app_meeting_join_undo(p_job uuid, p_scope text)`
  - 공통: 작업 행 잠금(`applied_at`이 있고 `undone`이 아님), 만든 사람이 지금도 owner, 고른 보고 잠금(같은 작업공간·**휴지통 아님** — 휴지통에 있으면 `report_gone`).
  - `before` / `joined`: '회의 결과' 칸에 `before_result` / `result_text`를 쓴다. 지금 칸의 글이 그 둘 어느 것과도 다르면(사람이 직접 고친 글) 먼저 `kept_result`에 넣어 둔다. 두 원본(`before_result`·`result_text`)은 바꾸지 않는다 — 몇 번을 오가도 어느 쪽도 사라지지 않는다.
  - `all`: 조건 ① 이 작업이 그 보고에 **마지막으로 적용된** 잇기 작업 ② 보고의 회의록 전문이 이 작업이 쓴 합친 전문 그대로, 회의 결과가 `result_text`나 `before_result` 그대로(사람이 고친 적 없음) — 아니면 `report_changed` ③ mode `report`: 없어진 보고가 아직 휴지통에 있고, 옮긴 자료·연결 행이 아직 고른 보고에 붙어 있음 — 아니면 `source_gone`. 맞으면: 두 글을 합치기 전으로, mode `job`·`text`는 `apply`가 만든 자료 행을 없애고(Drive 파일은 그대로) 녹음 작업의 `meeting_id`·`opened_at`을 비움(그 녹음 결과가 다시 띠 [초안 열기]에 뜸), mode `report`는 옮긴 자료·연결을 제자리로 돌리고 없어진 보고의 `deleted_at`을 비움. 작업 행 `status='undone'`.
  - 예외는 고정 글자로만 던진다(`JOIN_REPORT_CHANGED`·`JOIN_REPORT_GONE`·`JOIN_SOURCE_CHANGED`·`JOIN_SOURCE_GONE`·`JOIN_ALREADY_JOINED`·`JOIN_NOT_APPLIED`). Edge가 실패 코드로 바꾼다. 글 내용은 예외·로그에 싣지 않는다.

함수 본문에는 DDL·동적 SQL·세션 설정을 쓰지 않고, 모든 UPDATE·DELETE에 WHERE를 건다(`docs/ops-db-workflow.md` 확장 규칙 거절 목록).

**적용 규칙**(`docs/ops-db-workflow.md` '승인 한 번 흐름' + AGENTS.md 7절):

- 짝 파일 5개 필수: `docs/<version>_meeting_join_jobs.precheck.sql`·`.snapshot.sql`·`.postcheck.sql`·`.rollback.sql`·`.summary.md`. snapshot은 시스템 카탈로그만 읽는다.
- 적용 SQL 끝(`commit;` 앞)에 `supabase_migrations.schema_migrations` 기록 1행. `supabase db push`·`migration repair`는 쓰지 않는다.
- 이 모양은 확장 규칙이 받는 범위다: 새 public 표(같은 파일에서 RLS 켬) + 새 표 정책(authenticated) + 새 표·새 함수 권한(authenticated·service_role) + 색인 + 함수(PUBLIC·anon 실행권 회수, definer는 search_path 고정). **기존 표에는 권한·정책·칸·제약을 더하지 않는다.**
- precheck에서 미리 볼 것: 새 표·새 함수가 아직 없음, `private.app_is_workspace_owner(uuid)`·`app_meetings.deleted_at`·`app_meeting_server_jobs`·`app_meeting_transcribe_jobs`·`app_record_links.meeting_id`가 있음. postcheck: RLS 켜짐, 정책 1개, anon·PUBLIC·authenticated의 함수 실행권 없음, authenticated는 표 읽기만, service_role은 정한 칸만.
- rollback: 함수 2개 → 표 순서로 없앤다. **SQL Editor 전용**이다(승인형 workflow는 `drop table`을 막는다, `docs/ops-db-workflow.md` 189줄 차단 목록, 선례 `docs/20261103170000_meeting_server_jobs.rollback.sql` 6줄). 없애면 '합치기 전 글'도 같이 없어진다는 것을 summary에 일상어로 적는다. rollback은 자동으로 돌지 않는다.
- 일상어 3줄(구현 PR이 그대로 쓴다): 무엇이 바뀌나 — "잇기 작업과 합치기 전 글을 두는 새 표 하나와, 서버만 부를 수 있는 함수 둘이 생긴다. 기존 보고·자료는 그대로다." / 잘못되면 — "새 표가 안 생기면 잇기 버튼이 뜨지 않을 뿐, 지금 쓰는 녹음·보고는 그대로 된다." / 되돌리는 방법 — "rollback 파일로 새 표와 함수만 없앤다."

**고르지 않은 길과 이유**

- 서버 정리 작업 표(`app_meeting_server_jobs`)에 종류 `join`을 더하기: 새 칸에는 service_role 칸 권한을 더해야 하는데, 승인형 workflow는 **기존 표에 권한 추가를 거절한다**(`grant-existing`). `kind`·`stage` check 제약도 고쳐야 한다. 또 옛 화면(갱신 전)이 `job_list`에서 끝난 `join` 작업을 보고 '초안 열기' 띠를 띄우게 된다.
- `app_meetings`에 '이전 글' 칸 더하기: 엄격 규칙으로 되지만, 화면의 수정 저장이 그 칸까지 덮어쓸 수 있고, 작업 상태·옮긴 자료 기록을 둘 곳이 따로 또 필요하다.
- 화면이 직접 PATCH(사용자 로그인): 창을 닫으면 멈춘다. 사용자 결정 '백그라운드'에 어긋난다.
- 함수가 Edge가 만든 자료 행 모양을 받아 그대로 넣기: 권한이 높은 함수가 받은 값(`file_id`·올린 사람·공개 범위)을 믿게 된다. id만 받는다.

### 3-3. 물음(요청 1)과 네 길

**언제 묻나**: 정리 결과를 열기 직전(`openServerResult`가 `openEntry`를 부르기 전), **같은 날(서울) 녹음으로 쓴 보고가 있을 때만 한 번.** 없으면 지금 그대로 초안 창이 열린다.

- '같은 날 녹음으로 쓴 보고'는 서버가 찾는다(`join_candidates`): 그 작업공간에서 ① 서버 정리 작업의 `meeting_id`가 채워진 보고(PR-0 뒤로 쌓임) ② 녹음 자료 행(태그 '회의녹음')이 붙은 보고 가운데, [회의] 칸이고 보고 일시가 새 녹음과 같은 날인 것. 돌려주는 것은 보고 id와 녹음 길이뿐이고, 이름·시각은 화면이 이미 읽어 둔 자기 보고 목록에서 붙인다.
- 물음 한 줄: '오늘 녹음으로 쓴 보고가 있어요. 같은 회의인가요? · 10:02 ○○ · 녹음 38분' + [다른 보고 고르기] [새로 만들기] [그 보고에 잇기](시안 ①). 가장 가까운 앞 보고 하나를 먼저 보이고, [다른 보고 고르기]는 같은 날 보고부터 늘어놓는다(시안 ④의 고르기와 같은 부품).
- **어느 보고인지는 사람이 고른다.** 서버·AI가 '같은 회의 같다'고 판단해 저절로 잇지 않는다. 묻지 않고 잇는 길은 만들지 않는다.
- [새로 만들기] = 지금 그대로(초안 창, 직접 저장). 물음을 닫으면 결과는 띠 [초안 열기]에 남는다.
- 물음을 그리는 주인은 `app/meeting-join.js` 하나다. 녹음 띠(`#recBand`)는 지금처럼 `meeting-recorder.js`만 그린다.

| 길 | 물음 조건 | [잇기]가 보내는 것 |
| --- | --- | --- |
| (가) 노트북 · (나) 폰 앱 | 같은 날 녹음으로 쓴 보고가 있음 | `join_start` + `source:{job_id}` |
| (다) 그 자리 전사 | 그 회의에 이미 회의록 전문이 있음(고를 보고는 그 회의로 정해져 있음) | `join_start` + `source:{job_id}`(attached 작업). 안 고르면 지금처럼 수정 창에 넣기 |
| (라) [녹음·전사 넣기] | 입력 창이 **새 보고**이고 같은 날 녹음으로 쓴 보고가 있음 | `join_text`(화면이 가진 전사 글). 고르면 그 입력 창은 닫는다 |
| 보고 ⋯ [다른 보고에 합치기] | (메뉴에서 직접. [회의] 칸 보고에서만 보임) | `join_start` + `source:{meeting_id}` |

서버가 아직 없을 때(표 적용 전·옛 Edge): `join_candidates`·`join_list`가 지금 `unavailable()`(`app/meeting-server-job.mjs` 13~16줄)과 같은 기준으로 '모름'이면, 화면은 **묻지 않고 지금 길로** 간다. [다른 보고에 합치기] 항목도 그때는 그리지 않는다.

### 3-4. ④ 후속 할 일은 저절로 만들지 않는다(후보만)

- 새 요약의 할 일 목록(`draft.actions`)은 잇기 작업 행에만 둔다. **Google Tasks를 서버가 만들지 않는다.**
- 보고 상세에 '새 할 일 후보 n [보고 넣기]'(시안 ③). 화면이 작업 행(주인 읽기)에서 후보를 읽고, 그 보고에 이미 붙은 할 일과 제목이 같은 것은 뺀다(겹쳐 생기지 않게).
- [보고 넣기]는 사람이 누를 때만, 지금 후속 할 일 [추가]와 **같은 길**(`task-workflow.js` → Edge `google-tasks?action=create`, 보고와 연결)로 만든다. 새 저장 길을 만들지 않는다.
- 넣거나 닫으면 `join_seen {candidates:true}`로 후보 줄을 닫는다.
- 합치기(mode `report`)에서 두 보고에 이미 있던 할 일은 **새로 만들지 않고 연결만 옮긴다**(3-2절 6).

### 3-5. ③⑤ 되돌리기, 실패·중복·동시에 두 번

**되돌리기**

| 버튼 | 어디 | 하는 일 |
| --- | --- | --- |
| [합치기 전 글로 되돌리기] | 보고 상세 '회의 결과' 머리 옆(시안 ③) | '회의 결과' 글만 합치기 전 글로 바꾼다(`before`). 회의록 전문·녹음은 이은 채로 둔다. 누른 뒤에는 같은 자리에 [이은 글로 다시]가 보인다(`joined`). 두 원본은 작업 행에 그대로 있어 어느 쪽도 지워지지 않는다 |
| [되돌리기] | 합치기 끝 알림 줄(시안 ④), 합친 보고 ⋯ | 원래 두 보고로(`all`): 합친 보고의 두 글을 합치기 전으로, 옮긴 자료·할 일 연결을 제자리로, 없어진 보고를 휴지통에서 꺼냄. 한 트랜잭션 |

- 모두 Edge `join_undo`가 로그인·소유를 확인한 뒤 `app_meeting_join_undo`를 부른다.
- `all`은 **합친 뒤 그 보고를 사람이 고치지 않았고**, 그 뒤에 그 보고로 또 다른 잇기·합치기가 적용되지 않았고, 없어진 보고가 아직 휴지통에 있을 때만 된다(3-2절). 아니면 거절하고 까닭을 알린다('합친 뒤 고친 글이 있어 통째로는 못 되돌려요. 없어진 보고는 휴지통에 있어요'). 그 보고는 휴지통에서 따로 되살릴 수 있다.
- 서버는 `all`을 녹음 잇기(mode `job`·`text`)에서도 되게 만든다 — 잘못 고른 보고에 이었을 때 전문·녹음까지 되돌리는 길이다. 화면에 그 버튼을 둘지는 5절에서 사용자가 고른다.
- 화면 글자는 `docs/design/ui-words.md` 그대로: 원래대로는 **되돌리기**, 휴지통에서 꺼내기만은 **되살리기**(13줄).
- 한 보고에 여러 번 이었으면 [합치기 전 글로 되돌리기]는 **마지막 잇기** 것만 보인다.

**실패하면 보고는 그대로**: 보고를 쓰는 곳은 `apply` 함수 하나뿐이고 한 트랜잭션이다. 요약 실패·시간 초과·한도는 `apply` 전에 멈춘다.

| 경우 | 막는 방법 | 화면 |
| --- | --- | --- |
| 같은 보고에 [잇기]를 두 번(더블클릭·두 기기) | 부분 유일 색인(같은 보고에 진행 중 하나) + `join_start`가 같은 재료의 진행 중 작업을 그대로 돌려줌. 다른 재료면 `busy` | '그 보고에 이미 잇는 중이에요' |
| 잇는 중인 보고를 다른 보고에 합치기(또는 그 반대) | `join_start` 6번(어떤 역할로든 진행 중이면 `busy`) + `apply`가 없어질 보고의 글 지문을 다시 봄(`source_changed`) | '그 보고는 지금 잇는 중이에요' |
| 같은 녹음 결과를 두 번 잇기 / 잇는 사이 다른 기기에서 그 녹음으로 새 보고 저장 | 유일 색인(같은 `source_job_id`) + 잇는 중인 녹음 결과는 `job_list`에서 뺌 + `apply`가 녹음 작업의 `meeting_id`를 잠그고 다시 봄(`already_joined`) | '이미 다른 보고에 들어간 녹음이에요' |
| 단계가 동시에 두 번 돎 | 지금 lease 방식 그대로(`leaseTake`, 읽은 `lease_until` 그대로일 때만 잡음) | — |
| `apply`가 두 번 불림 | 함수가 `applied_at`을 보고 두 번째는 아무것도 안 함 | — |
| 잇는 사이 사람이 그 보고의 글을 고쳐 저장 | `apply`가 글 자체를 비교 → `report_changed`, 보고 그대로 | '그 사이 보고를 고쳐서 잇지 않았어요 [다시]'(다시 = 고친 글로 처음부터) |
| **수정 창을 연 채 잇기가 적용됨**(같은 기기·다른 기기) | 지금 수정 저장은 조건 없이 두 글 칸을 통째로 덮어쓰고(`app/meeting-round-detail.js` 361·376줄), 고치는 중에는 새 글을 받아오지 않는다(552줄). 그대로 두면 이은 글이 옛 글로 덮인다. PR-3이 ① 두 글 칸을 쓰는 수정 저장에 '읽었을 때 그대로일 때만'(읽은 `updated_at`과 같음 — `apply`가 이 값을 서버 시각으로 바꾸므로 잡힌다) 조건을 걸고, 0행이면 덮지 않고 묻는다 ② 잇기가 끝났을 때 그 보고의 수정 창이 열려 있으면 바로 알린다. 그래도 덮였으면 [이은 글로 다시]와 작업 행의 합친 전문으로 되찾는다 | '그 사이 이 보고에 녹음을 이어 붙였어요' [이은 글 보기] [내 글로 저장] |
| 잇는 사이 보고가 휴지통·삭제 | `report_gone` | '그 보고를 찾지 못했어요 [새 보고로 열기]' |
| 합치기를 이어서 두 번(나→가, 가→다) 한 뒤 앞 것을 되돌리기 | `undo all` 조건(고른 보고가 휴지통 아님·마지막 적용 작업·옮긴 행이 아직 붙어 있음) | '뒤에 한 합치기부터 되돌려 주세요' |
| 요약 실패·시간 초과·하루 한도 | 지금 코드 그대로(`draft_failed`·`draft_timeout`·`draft_cut`·`draft_step_cut`·`daily_limit`·`too_many_steps`) | 지금 문구(`app/meeting-server-job.mjs` `FAIL_TEXT`) + [다시] |
| 서버가 중간에 끊김 | `join_read`·`join_list`가 멈춘 작업을 다시 깨움(지금 `needsKick`) | 진행 줄 유지 |

새 실패 코드: `report_changed`·`report_gone`·`source_changed`·`source_gone`·`already_joined`·`no_first_transcript`·`bad_target`.

### 3-6. ⑥ 외부 입력 분석과 바깥 행동을 한 흐름으로 잇지 않는다

전사·요약은 바깥에서 들어온 소리를 AI가 읽은 결과다. 이 결과가 **할 수 있는 일은 글이 되는 것뿐**이다.

- 잇기 작업이 쓰는 곳(전부): ① 고른 보고의 두 글 칸 ② 그 보고의 녹음 자료 행(이미 내 Drive에 있는 파일의 링크)과 녹음 작업의 '어느 보고' 칸 ③ 잇기 작업 행 ④ 합치기에서만: 자료·할 일 **연결**을 옮기고 없어지는 보고를 휴지통으로 — 이것은 사람이 [다른 보고에 합치기]에서 직접 고른 일이지, 전사 내용으로 정해지는 일이 아니다. 그 밖에 지금 요약 단계가 쓰는 AI 사용량 기록·알림 기록은 그대로다.
- 하지 않는 것: Google 할 일·일정 만들기, 메일·메시지·알림 글에 내용 싣기, 공유 링크·Drive 권한 바꾸기, Drive 파일 올리기·옮기기·지우기, 보고·자료 영구 삭제, 다른 보고 고치기.
- 요약 글은 값으로만 다룬다. 요약 글 안의 문장이 서버의 다음 행동(어느 보고에 쓸지, 무엇을 지울지)을 정하는 곳이 없다. 고른 보고·재료·모드는 시작할 때 사람이 정한 것이 작업 행에 굳고, 뒤 단계는 그 행만 본다.
- 폰 알림에는 종류와 여는 주소만 싣는다(지금 `notifyDone`과 같음).

### 3-7. 보안 확인표 (구현 PR이 시험으로 고정)

- 화면이 보낸 작업공간 값에 기대지 않는다: `join_*` 몸통에 `workspace_id`를 받지 않는다(있어도 쓰지 않는다).
- 고른 보고·합칠 보고는 **부른 사람 로그인으로** 읽는다(owner RLS·휴지통 숨김). service_role로 먼저 읽지 않는다.
- 뒤 단계(서비스 권한)는 `deleted_at is null`·작업공간 일치·owner 여부·[회의] 칸을 함수 안에서 다시 확인한다. 함수는 id만 받고, 넣을 행은 DB에서 직접 만든다.
- 새 함수는 service_role만 실행한다. authenticated가 직접 부를 수 있는 새 함수·새 쓰기 권한은 없다. anon·PUBLIC 권한 없음. 적용·되돌리기 기록 칸은 함수만 쓴다.
- `join_tick` 서명은 `job_tick` 서명과 서로 통하지 않는다.
- `meeting-transcribe`의 verify_jwt는 **true 그대로**(`docs/web2-env6b-edge-source.md` 5절 38행, 표 고칠 것 없음). 함수 인증 경계는 바꾸지 않는다.
- RLS·기존 정책·기존 권한을 약하게 하지 않는다. `rtw_*`는 건드리지 않는다.
- 다른 작업공간의 보고 id·작업 id·녹음 작업 id를 넣으면 `not_found`(있는지 없는지 구분 안 됨). 시험: 남의 보고 id, 휴지통 보고, [회의]가 아닌 칸, 다른 작업공간 재료, 이미 다른 보고에 붙은 녹음, 비로그인(401).

## 4. PR 나눔 계획 (줄 세우기)

순서: **PR-0 ∥ PR-1 → PR-2 → PR-3 → PR-4 → PR-5.** PR-0과 PR-1은 서로 겹치는 파일이 없어 같이 돌려도 된다.

| PR | 무엇 | 고치는 파일 | 앞 PR·겹침 | 정지 지점 |
| --- | --- | --- | --- | --- |
| **PR-0** 초안 지키기(화면) | 2-3절: 열려 있는·저장 안 한 초안이 있으면 먼저 묻기, 닫을 때 묻기, '열었음'은 저장·버림 때(회의 id와 함께). `rec-join-open-draft.spec.mjs` 기대를 새 동작으로 | `app/team.js`, `app/meeting-recorder.js`, `app/meeting-transcript-draft.js`, `app/phone-recorder.js`, `tests/app-e2e/rec-join-open-draft.spec.mjs`·`laptop-recording.spec.mjs`, `tests/phone-recorder.test.mjs`, 업데이트 기록 1개 | `app/team.js`가 진행 중인 달력 쓰기 창 작업(#2373)과 겹침 → **그것이 main에 들어간 뒤 시작**(자료 올리기 #2345는 이미 들어옴) | 없음(화면만) |
| **PR-1** DB | 3-2절: 새 표 + 색인 + 권한 + 함수 2개, 짝 파일 5개, 정적 시험 | `supabase/migrations/<ver>_meeting_join_jobs.sql`, `docs/<ver>_meeting_join_jobs.*`(5개), `tests/security/meeting-join-migration.test.mjs`, `docs/migration-history.md` | 겹침 없음 | **DB 적용**(CC: 시험 적용 → 적용 → 사후 확인) |
| **PR-2** Edge | 3-1절: `join_*`·`join_tick` action, 단계 돌리기를 두 표가 함께 쓰게, `apply`·`undo` 함수 부르기, 잇는 중인 녹음 결과를 `job_list`에서 빼기, 끝 알림(폰, 지금 있는 종류로). 표가 없으면 '모름'으로 답함 | `supabase/functions/meeting-transcribe/index.ts`·`server-job.mjs`·`model.mjs`(+ 새 `join-job.mjs`), `app/meeting-server-job.mjs`(실패 문구 표 줄만 — 서버 코드 목록과 맞춰 보는 시험이 요구), `tests/meeting-join-job.test.mjs`(새)·`tests/meeting-server-job.test.mjs`, `tests/security/meeting-transcribe.test.mjs`, `tests/edge-isolation/meeting-transcribe.test.mjs` | PR-1이 **운영에 적용된 뒤** merge·배포(그 전에 배포돼도 '모름'으로 안전) | **Edge 배포**(CC: `meeting-transcribe` 하나, verify_jwt keep=true, 이전 소스 SHA 기록, 비로그인 401·OPTIONS 확인) |
| **PR-3** 화면: 물음·잇기 | 3-3절 (가)(나): 물음, [그 보고에 잇기], 진행 줄·끝 줄, 보고 상세의 [합치기 전 글로 되돌리기]·'새 할 일 후보 n [보고 넣기]'·녹음 두 줄. **수정 저장에 '읽었을 때 그대로일 때만' 조건**(3-5절 — 두 글 칸을 쓰는 저장 길 전수: `mrdSaveEdit` 376줄, 473줄의 PATCH 등) | 새 `app/meeting-join.js`·`meeting-join-model.mjs`·`meeting-join.css`, `app/meeting-recorder.js`(`openServerResult` 한 곳), `app/meeting-server-job.mjs`(문구 표), `app/meeting-round-detail.js`, `app/loader-v2.js`, `docs/design/ui-words.md`, 시험(단위 + E2E), 업데이트 기록 | **PR-0 위에서 시작**(같은 `meeting-recorder.js`). PR-2 배포 전이어도 지금처럼 동작해야 함 | 없음. PC(1280)·폰(412) 화면 사진 |
| **PR-4** 화면: 보고 ⋯ [다른 보고에 합치기] | 요청 5: 메뉴 항목(한 곳 → 목록·달력·상세 모두), 고르기(같은 날 보고부터), 뒤에서 합침, 끝 줄 [되돌리기] | `app/meeting-round-detail.js`(73~81줄 메뉴), `app/meeting-join.js`, `tests/app-e2e/meeting-detail-menu.spec.mjs`·`meeting-context-menu.spec.mjs`·`report-views.spec.mjs`, 업데이트 기록 | **PR-3 위에서 시작**(같은 두 파일) | 없음. 화면 사진 |
| **PR-5** 나머지 두 길 | 3-3절 (다)(라)에 같은 물음 | `app/meeting-round-detail.js`(`mrdFillTranscript`), `app/meeting-transcript-draft.js`, `app/meeting-join.js`, 시험, 업데이트 기록 | **PR-4 위에서 시작**(같은 파일) | 없음. 화면 사진 |

공통:

- 화면 PR마다 `app/release-notes/YYYYMMDD-HHMM-….json` 1개(일상어), 화면 글자는 `docs/design/ui-words.md`.
- `?v=`를 손으로 쓰지 않는다. 새 모듈은 번호 없는 경로로 부른다.
- 화면 PR은 서버가 없을 때의 동작(묻지 않고 지금 길)을 E2E로 고정한다.
- 원장(`docs/roadmap.md`)은 작업 PR이 고치지 않는다(PR 본문 '원장 반영' 절).
- 사업 보고 달력 '그날 창' 시안(#2377, BIZ-달력그날창)이 구현에 들어가면 보고 보기·상세 파일이 PR-3·PR-4와 겹칠 수 있다. 커맨드센터가 앞뒤로 세운다.
- 이번 줄에 넣지 않은 것: 폰 알림에 '보고 잇기' 종류를 따로 두기(설정에서 따로 끄기·최근 알림 목록의 이름). 기존 표 제약 2개를 고치는 DB 변경 + `phone-push` 배포가 따로 필요해서, 이번에는 지금 있는 '회의 요약' 종류로 보낸다(3-1절). 따로 두려면 별도 과제로 올린다.
- 요청함 완료 기준 대응: [그 보고에 잇기] 한 번으로 저장(PR-3) · 창을 닫아도 끝까지(PR-2) · ⋯ [다른 보고에 합치기](PR-4) · 두 가지 되돌리기(PR-3·PR-4) · 할 일 겹침 없음(PR-3) · 브라우저 E2E·화면 사진(PR-3~5).

## 5. 사용자가 더 고를 것

**고를 것 1가지**

- 잘못 고른 보고에 이어 붙였을 때, **통째로 되돌리는 버튼**(회의 결과뿐 아니라 붙은 전문·녹음까지 떼어 내고, 그 녹음 결과를 다시 [초안 열기]로)을 화면에 둘까요? 시안에는 '회의 결과 글만 되돌리기'와 '두 보고 합치기의 [되돌리기]'만 있습니다. 서버는 어느 쪽이든 되게 만들어 두므로 화면만의 결정입니다.
  - 가. 둔다 — 끝 알림 줄 '○○ 보고에 이어 붙였어요 [열기]' 옆에 [되돌리기](제안).
  - 나. 두지 않는다 — 시안 그대로. 잘못 이으면 회의 결과만 되돌리고 전문·녹음은 직접 고친다.
  - 답이 없으면 '가'로 진행한다.

**알고만 있으면 되는 것**

1. 요청함 방이 추천한 두 가지를 시안 그대로 넣는다: 이어 붙인 뒤에도 **[합치기 전 글로 되돌리기]**가 있고, 할 일은 저절로 생기지 않고 **'새 할 일 후보'로만** 보인다.
2. 이어 붙이면 앞 보고의 **'회의 결과' 글이 새 요약으로 통째로 바뀐다.** 앞 보고에서 직접 고쳐 둔 글도 새 요약으로 바뀐다(합치기 전 글은 남겨 두어 버튼 하나로 되돌릴 수 있음). '전체 전사로 다시 요약' 결정에 따른 것이다.
3. 합치기 전 글과 이은 전문은 서버에 **기한 없이** 남겨 둔다(그 보고를 휴지통에서 영구 삭제하면 같이 없어진다). 기한을 두고 싶으면 따로 정하면 된다.
4. 폰 알림은 지금 있는 '회의 요약' 알림과 같은 종류로 온다(설정에서 '회의 요약'을 끄면 이것도 안 온다).
