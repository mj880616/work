# 두 번 녹음한 회의를 한 보고로 (REC-한회의로잇기) — 1단계 설계

S57-22 설계(문서 전용). 요청함 11/11 11:27 접수분. 시안: `docs/design/mockups/rec-join.html`(#2376).
기준선: main `a5fe675`(2026-11-11). 아래 '사실'은 이 기준선의 코드를 직접 읽은 것이고, 짐작은 '추정'이라고 적는다.

요청 요지(원문은 요청함, 사람·회의 이름은 옮기지 않음):

- 녹음 → [멈추고 정리] → 또 녹음 → [멈추고 정리]. 이 둘이 사실은 한 회의일 때 한 보고로 넣는다.
- 사용자 결정(11/11 11:25): **"나 · 백그라운드 · 자동저장"** — 두 녹음 전사 전체로 회의 결과를 처음부터 다시 요약하고, 몇 분 걸려도 되니 뒤에서 하고, AI 요약을 **내가 지정한 회의에 자동 저장**한다(고치는 것은 나중에 직접).
- 할 일 1~6: ① 정리 끝에서 한 번 묻기 ② [그 보고에 잇기] = 창 없이 뒤에서 ③ 저장되는 것 ④ 지켜 두는 것(합치기 전 글·후속 할 일은 후보만) ⑤ 이미 저장한 두 보고 합치기 ⑥ '저장 안 한 첫 초안이 사라지는지' 확인.

이 문서는 구현하지 않는다. 다음 구현 세션이 이 문서만 보고 PR을 나눠 시작할 수 있게 하는 것이 완료 기준이다.

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
  - 폰 알림을 눌러 연 주소 `?view=reports&rec_job=<작업 id>`는 `loadServerJobs()`(455~472줄, 461·467줄)가 읽어 같은 길로 초안 창을 연다.
  - 서버가 서버 정리를 모르면 `deps.openDraft`(core 257줄, `phone-recorder.js` 44~54줄) → `KPTUReportEntry.open` → `draft.fill`.
- (다) 그 자리 전사: `app/meeting-round-detail.js` 590~601줄 → `KPTUMeetingRecorder.transcribeAttached({documentId,meetingId})`(`meeting-recorder.js` 619~627줄, `kind:'attached'`) → 끝나면 `openServerResult`의 attached 갈래(407~418줄) → `KPTUMeetingRoundDetail.fillTranscript(job.meeting_id,{text,draft})`(`meeting-round-detail.js` 604줄~). 이미 **어느 회의인지 정해진** 길이다.
- (라) 파일: `app/meeting-transcript-draft.js` — `takeAudio`(103줄)·`transcribe`(117줄) → `run()`(216줄) → `keepFull`(181줄, 전문을 '회의록 전문' 칸에) → `applyDraft`(199줄, 요약을 '회의 결과' 칸에 `mergeText`로 덧붙임).

네 길 모두 **새 보고든 기존 보고든 저장은 사람이 누른다.** 서버가 보고 글을 직접 고치는 길은 지금 없다.

### 1-2. 서버 작업 길이 지금 저장하는 것

- Edge `meeting-transcribe`(`supabase/functions/meeting-transcribe/index.ts`, verify_jwt=true + 코드에서 로그인 재확인, 2줄 주석).
  - 입구: 1108~1144줄. `job_tick`만 서버 키 HMAC, 나머지는 `userOf(req)`로 로그인 확인 뒤 action별 처리(1131~1135줄 `job_start`·`job_read`·`job_list`·`job_opened`·`job_retry`).
  - 소유 확인: `requireOwner(userId, workspaceId)`(89~94줄) — 화면이 보낸 `workspace_id`를 그대로 믿지 않고 `app_workspace_members`에서 그 로그인의 `role='owner'`를 확인한다. 작업 id로 들어오는 action은 작업 행의 `workspace_id`로 같은 확인을 한다(`ownJob` 95줄~, `ownServerJob`).
  - `jobStart`(981~1045줄): 작업 한 행을 `app_meeting_server_jobs`에 넣고(1036줄) `runStep`을 뒤에서 돌린다. 같은 녹음(session_id)에 진행 중 작업이 있으면 새로 만들지 않고 그 작업을 돌려준다(990~993줄). 유일 색인 충돌(23505)은 `busy`(1037줄).
  - `jobOpened`(1063~1075줄): `opened_at`을 적는다. `meeting_id`를 함께 받으면 **부른 사람 로그인(owner RLS)으로 그 회의를 읽어** 같은 작업공간인지 확인한 뒤 작업 행에 적는다(1066~1071줄). 지금 화면은 이 값을 보내지 않는다.
  - 끝 알림: `notifyDone`(952~978줄) — 폰 알림 '회의 요약이 준비됐어요', 여는 주소에 `rec_job`.
- 서버 작업이 저장하는 곳은 **작업 표 한 곳**이다: `public.app_meeting_server_jobs`(`supabase/migrations/20261103170000_meeting_server_jobs.sql` 34~75줄) — `transcript_text`(전사 전문)·`draft`(요약 초안 jsonb)·`parts`·`status`·`stage`·`error_code`·`meeting_id`·`opened_at` 등. `app_meetings`(보고)는 건드리지 않는다.
  - 권한: authenticated는 읽기만(`meeting_server_jobs_owner_read`, `private.app_is_workspace_owner(workspace_id)`, 96~97줄), 쓰기는 service_role(Edge)만, anon·PUBLIC 없음.
- Edge `meeting-ai-draft`: 화면 정리 길·[녹음 요약하기]가 부르는 요약 함수. '새 회의' 길(meeting_id 없음)은 서버에 저장하지 않는다(`app/meeting-transcript-draft.js` 3줄 주석).

### 1-3. 보고가 저장되는 표·칸

- 보고 한 건 = `public.app_meetings` 한 행. [사업 보고 저장] = `saveMeeting`(`app/team.js` 434줄)이 PostgREST로 직접 insert. 수정 저장 = `app/meeting-round-detail.js` 352줄~ `mrdSaveEdit`의 PATCH(376줄) — **덮어쓰기**.
- 칸 대응([회의] 칸 기준, 화면 이름과 칸 이름이 엇갈리니 주의):

| 화면 | DB 칸 |
| --- | --- |
| 회의명 / 짧은 이름 | `series_name` / `title` |
| 일시 | `meeting_at` |
| 차수 | `round_no` |
| 참석인원 | `attendees` |
| **회의 결과**(요약: 참석·결정·공유) | `transcript_text` |
| **회의록 전문**(전사 전체) | `notes` |
| 휴지통 | `deleted_at`(`supabase/migrations/20261025100000_trash_org_report_db.sql` 67줄) |

- 녹음·자료·사진 연결 = `public.app_documents` 행(`meeting_id`, `file_id`(Drive), `tags`). 녹음은 Edge `meeting-transcribe`의 `attach`(374줄~)가 한 행을 만들고 `app_meeting_transcribe_jobs.meeting_id`를 채운다. 화면은 [이 회의에 녹음 붙이기]가 켜진 채 저장했을 때만 저장 뒤(`kptu:record-saved`) 이것을 부른다(`app/meeting-transcript-draft.js` 155~168줄).
- 후속 할 일 = Google Tasks가 원본(Edge `google-tasks`), 보고와의 연결은 `app_record_links`.
- 휴지통: DELETE가 오면 트리거가 지우지 않고 `deleted_at`만 채운다(위 migration 94~115줄). 화면은 `deleted_at`을 직접 채울 수 없다(restrictive 정책 74~75줄). 되살리기는 RPC `app_trash_restore`(종류 `'report'`).
- **보고 글의 옛 판을 보관하는 표·칸은 없다**(migrations·회의 화면·회의 Edge에서 `revision|history|previous_|prior_` 검색 0건). 수정 저장은 덮어쓰기다.
- 보고에 '녹음으로 썼다'·녹음 길이·녹음 시작 시각을 적는 칸도 없다. 녹음과 보고의 고리는 위 붙이기(`app_documents` 태그 '회의녹음', `app_meeting_transcribe_jobs.meeting_id`)뿐이고, 붙이기를 끄고 저장한 보고는 고리가 없다.

### 1-4. '자동 저장 없음' 원칙이 걸린 곳

- `app/meeting-transcript-draft.js` 5~6줄 머리 주석: "저장은 … [사업 보고 저장]으로 한다(자동 저장 없음)"(2026-10-29 결정).
- `app/meeting-recorder.js` 12줄·404줄 주석: "저장은 … [사업 보고 저장]".
- `app/meeting-server-job.mjs` 1~5줄: 서버는 합치기 → 전사 → 요약까지만, 화면은 진행만 본다.
- 코드로는: 서버 작업이 `app_meetings`를 쓰는 곳이 없고(1-2), 화면도 결과를 **입력 창 칸에 채우기만** 한다(`fillResult`·`applyDraft`·`mrdFillTranscript`).
- 이번 사용자 결정으로 **잇기·합치기에 한해** 자동 저장으로 바뀐다. 나머지 길(새 보고 만들기, 그 자리 전사, 파일 넣기)은 그대로 '사람이 저장'이다.

## 2. 요청 6번 확인 — 저장 안 한 첫 초안이 둘째 정리로 사라지는가

(작성 중 — 코드 추적과 브라우저 E2E 결과를 이 절에 적는다.)

## 3. 정할 것

(작성 중 — ① 잇기 서버 작업 흐름 ② 합치기 전 글 보관 ③ 저장한 두 보고 합치기·되돌리기 ④ 후속 할 일 후보 ⑤ 실패·중복·동시 실행 ⑥ 외부 입력 분석과 외부 행동 분리)

## 4. PR 나눔 계획

(작성 중)

## 5. 사용자가 더 고를 것

(작성 중)
