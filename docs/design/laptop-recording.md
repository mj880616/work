# 노트북 Web2 [녹음] — 설계 (MTG-노트북녹음)

💻 화면 확인은 노트북(PC 1440) 실기기. 코드·DB·서버는 📱 폰 경로 C(DB)·승인형 Edge workflow로 적용.

요청: 요청함 [10/29 14:26] '노트북 Web2 [녹음] 버튼'. 명진 결정(14:26, 추천대로): 버튼은 사업 보고 줄, 폰에는 안 보임, 원본은 드라이브 보관, 긴 회의는 끊어 이어 녹음하고 전사는 한 회의로 합침.

단계: **1단계(이 문서·DB·서버)** → 2단계 화면(버튼·녹음 띠·진행 한 줄·이어서 정리). 사업 보고 위쪽 줄은 BIZ-버튼줄정리(#1505)가 먼저 바꾸므로 화면은 그 뒤에 한다.

## 1. 한눈에

```
[녹음] 누름 ─ 마이크 허락 ─ MediaRecorder(한 구간 = 최대 59분)
   │  5분마다 조각 ──► Edge meeting-transcribe ?action=rec_piece ──► 명진 Drive '웹2/회의자료/회의 녹음/녹음 조각'
   │                                                └► DB app_meeting_recordings(구간 1행: 조각 id 순서·크기·길이)
   │  59분이 되면 새 구간(rec_start, 같은 session_id) — 녹음은 끊김 없이 이어짐(띠 시간도 계속)
[멈추고 정리] ─ rec_finish ─ 구간마다 조각을 차례로 이어 붙여 한 파일(회의 녹음 폴더)로 저장
   │              └► 기존 전사 작업 표 app_meeting_transcribe_jobs 한 행(uploaded) ── 조각은 Drive 휴지통
   ├─ 구간마다 기존 ?action=transcribe(이미 있는 길, 명진 Gemini 키, 사용량 기록 포함)
   ├─ 화면이 구간 글을 순서대로 합침 → 기존 '전사 글 → 회의 기록 초안'(meeting-ai-draft 새 회의 길)
   └─ 사업 보고 › 회의 입력 창이 초안을 채운 채 열림 → 명진이 보고 [사업 보고 저장] → (기존) 녹음 링크 붙이기
```

## 2. 재사용과 새로 만드는 것

| 무엇 | 재사용(그대로) | 새로 |
| --- | --- | --- |
| 녹음 원본 보관 | Drive 연결(`public_policy_drive_config` 갱신 열쇠), '웹2/회의자료/회의 녹음' 폴더 규칙 | 그 아래 '녹음 조각' 폴더(임시) |
| 전사 | Edge `meeting-transcribe` `transcribe`(Gemini Files 올림·전사 설정·400 재시도·사용량 기록·월 상한·진행 중 1건) | 없음 |
| 회의에 붙이기 | `attach`(구간마다) | 없음 |
| 붙이지 않은 녹음 정리 | `sweep`의 30일 뒤 휴지통 | 같은 sweep에 조각 정리만 더함 |
| 요약·초안 | `meeting-ai-draft` 새 회의 길, `app/meeting-transcript-draft.js`의 [초안 채우기] 흐름 | 없음(2단계에서 녹음 띠가 이 흐름을 부름) |
| 진행 상태 | 전사 작업 표 | **DB 새 표 1개** `app_meeting_recordings`(구간 1행) |
| 서버 | 같은 함수 `meeting-transcribe`(verify_jwt=true 유지) | 동작 4개 `rec_start`·`rec_piece`·`rec_finish`·`rec_pending` |

새 Edge 함수는 만들지 않는다. 기존 표의 칸·권한·정책은 바꾸지 않는다(새 표가 전사 작업 표를 참조만 함).

## 3. DB: `app_meeting_recordings` (migration `20261029200000_meeting_recordings`)

- 한 행 = 녹음 한 구간. `session_id`가 같으면 한 회의 녹음. `segment_no` 1~24(59분 × 24 ≈ 하루).
- 칸: 작업공간·만든 사람·session_id·segment_no·status(`recording`→`closed`→`combined`, 또는 `empty`·`failed`)·error_code·mime_type(`audio/webm|ogg|mp4`)·piece_ids(Drive 조각 id 순서, 16개까지)·size_bytes(100MB까지 = 전사 작업 표와 같은 상한)·duration_sec(1시간까지)·job_id(합친 뒤 전사 작업)·pieces_trashed_at·closed_at·시각.
- 소리·전사 글·요약 칸은 없다. 소리는 Drive, 글은 회의 기록에만.
- 권한: authenticated는 소유자(`private.app_is_workspace_owner`) 읽기만. service_role(Edge)은 넣기 5칸·고치기 9칸·읽기, 지우기 없음. anon·PUBLIC 없음.
- 작업공간마다 `recording` 상태는 한 행만(부분 유일 색인), 한 녹음 안 구간 번호는 겹치지 않음.

## 4. 서버: `meeting-transcribe`에 더하는 동작

모두 POST, 로그인 확인(Auth 서버) + 작업공간 소유자 + 본인이 만든 행만. 규칙은 `supabase/functions/meeting-transcribe/recording.mjs`(Node 시험·Deno 공용).

| 동작 | 입력 | 하는 일 |
| --- | --- | --- |
| `rec_start` | `{workspace_id, mime, session_id?}` | 이 작업공간에 열린 구간이 있으면 먼저 닫음(조각 없으면 `empty`). session_id가 있으면 그 녹음의 다음 구간, 없으면 새 녹음. 구간 1행(`recording`). 답: recording_id·session_id·segment_no·조각 길이(300초)·구간 길이(3540초) |
| `rec_piece` | 몸통 = 조각 그대로. 머리글 `x-recording-id`·`x-piece-seq`(1부터)·`x-duration-sec`(구간 시작부터 잰 초)·Content-Length | 순서 확인(이미 받은 번호면 `already`, 건너뛰면 409 `piece_gap` + 기다리는 번호). Drive '녹음 조각'에 흘려 올리고, 행을 `updated_at` 비교로 고침(동시에 두 번 오면 하나만 남기고 남은 파일은 휴지통) |
| `rec_finish` | `{session_id}` | 열린 구간 닫기 → `closed` 구간마다 조각을 순서대로 이어 한 파일로 Drive '회의 녹음'에 저장 → 전사 작업 1행(uploaded) → `combined`·job_id → 조각 휴지통. 200초가 넘으면 `more: true`로 끊고, 화면이 다시 부름. 답: 구간 목록(번호·상태·job_id·길이) |
| `rec_pending` | `{workspace_id}` | 30일 안의 끝나지 않은 녹음(열린 구간이 12분 넘게 조용함·닫힘·합쳤지만 전사 전) 목록 → 화면의 '이어서 정리' 한 줄 |

- 조각을 이어 붙이는 이유: 브라우저 MediaRecorder가 `timeslice`로 내주는 조각은 첫 조각에만 머리가 있고 나머지는 이어지는 바이트라, 순서대로 이으면 그대로 한 파일이다(webm·ogg·mp4 조각 모두). 서버는 소리를 풀거나 다시 만들지 않는다(Edge에 ffmpeg 없음). 이어 붙이기는 Drive → Drive 흘려 보내기라 Edge 메모리에 다 담지 않는다.
- 조각이 하나라도 빠지면 그 뒤 소리가 깨지므로 서버는 순서를 강제하고(`piece_gap`), 화면은 실패한 조각을 **메모리에 두고** 같은 번호로 다시 보낸다(기기 저장 없음).
- 창을 닫거나 노트북이 꺼지면 마지막 5분 안쪽만 잃는다. 다시 열면 `rec_pending` → '이어서 정리' → `rec_finish`.
- 정리(`sweep`, config·rec_pending이 부를 때마다): 합친 구간 중 조각 휴지통이 안 끝난 것 다시 시도, 30일 넘게 합치지 못한 구간은 조각을 휴지통으로 옮기고 `failed`(`expired`). 휴지통은 '녹음 조각' 폴더 바로 아래 파일만(`_shared/drive-trash.ts`).
- 로그에는 조각 내용·전사 글·파일 이름을 찍지 않는다(오류 코드만).

## 5. 명진 결정과 다른 점 — 확인 필요

- **끊는 간격: 결정은 3시간, 설계는 59분.** 이미 있는 전사 길이 Gemini 한 번 요청 상한(녹음 1시간, `MAX_SECONDS`)을 지키므로 3시간 파일은 한 번에 전사할 수 없고, 서버는 소리를 잘라 다시 만들 수 없다. 그래서 브라우저가 59분마다 새 구간으로 넘어간다. 명진이 보는 동작은 같다(녹음은 이어지고 띠 시간도 계속, 전사는 한 회의로 합침). 다른 점은 Drive 원본이 59분짜리 파일 여러 개라는 것뿐이다. 3시간 한 파일이 꼭 필요하면 2단계에서 '3시간 묶음 사본'을 따로 만드는 방법이 있으나 이번에는 넣지 않았다.
- 화자 구분: 기존 규칙대로 30분 넘는 구간은 화자 구분 없이 전사한다(59분 구간은 화자 표시 없음). 구간을 30분으로 줄이면 화자 표시가 붙지만 구간마다 '화자1'이 같은 사람이라는 보장은 없다. 지금은 59분(전사 횟수·비용 기록 줄 수가 적음).

## 6. 긴 녹음 Gemini 비용 — AI 사용량 줄

- 구간 전사는 기존 `transcribe`를 그대로 쓰므로 `app_ai_external_usage`에 `ref 'mtg-<작업 id>-…'`, `source 'transcript'`로 구간마다 한 행씩 들어가고, 홈 'AI 사용량' 줄과 회의 전사 월 상한(5,000원)이 같은 기록을 센다. 새 칸·새 기록 길 없음.
- 추정(단가표 `_shared/ai-prices.mjs`에 전사 모델 줄이 없어 가장 비싼 줄로 셈): 음성 1시간 ≈ 11.5만 토큰 ≈ 320원 + 글 출력 ≈ 150원 → **1시간 약 500원, 3시간 약 1,500원**. 월 상한으로 한 달 약 10시간.
- 요약(초안 채우기)은 기존 `meeting-ai-draft` 사용량 기록 그대로.
- 상한에 닿으면 기존 `transcribe`가 429 `monthly_limit`로 멈춘다. 녹음 원본·합친 파일·전사 작업은 남으므로 다음 달 또는 상한 조정 뒤 '이어서 정리'로 이어 전사할 수 있다. 2단계 화면은 `config`의 이번 달 금액과 녹음 길이로 '예상 ○○원' 한 줄을 보여 줄 수 있다.
- 남은 일(범위 밖 발견): 전사 모델 단가 줄을 `_shared/ai-prices.mjs`에 더하면 금액이 실제에 가까워진다(가격 확인 필요).

## 7. 보안·저장 원칙

- 기기 저장 없음: 녹음 중 조각은 올릴 때까지 메모리에만 있고, 5분마다 서버로 간다(`localStorage`·IndexedDB 안 씀).
- 로그인 + 소유자 + 본인 행만. Drive 휴지통은 앱이 만든 폴더 바로 아래 파일만. 표에 지우기 권한 없음.
- 비밀값(Gemini 키·Drive 열쇠)은 Edge 환경·기존 설정 표에만. 화면·로그·PR에 없음.
- 같은 Gemini 키(`GEMINI_API_KEY`)는 프로젝트 하나다. MULTI(노조 사용자) 2단계에서 사람별 키·상한을 나눌 때 이 길도 함께 본다(지금은 소유자 한 명).

## 8. 2단계(화면)에서 할 일

1. 사업 보고 위쪽 줄을 `[녹음][+ 사업 보고][⋯]`로(#1505 merge 뒤 그 줄에 하나 더함). **PC 폭에서만 보임**(폰 412·884에는 없음). 작고 낮은 버튼(`docs/design-decisions.md` UI-버튼기준).
2. 누르면 마이크 허락(처음 한 번) → 바로 녹음. 제목·조직은 묻지 않음.
3. 화면 맨 위 얇은 띠: 빨간 점 · 녹음 중 · 시간 · [일시정지] [멈추고 정리]. 다른 메뉴로 옮겨도 녹음 계속(띠와 녹음기는 앱 껍데기 한 곳이 주인, 화면 전환에 다시 그리지 않음).
4. 녹음기: `MediaRecorder`(webm/opus 우선, 없으면 ogg·mp4), `audioBitsPerSecond` 32000 안팎, `timeslice` 300초. 조각마다 `rec_piece`, 실패하면 메모리에 두고 같은 번호로 다시 보냄. 3540초가 되면 같은 마이크 흐름으로 새 MediaRecorder를 먼저 켜고(새 구간 조각은 메모리에 잠시 둠) 앞 녹음기를 멈춤 → 앞 구간 마지막 조각을 보냄 → `rec_start`(같은 session_id) → 새 구간 조각을 보냄. 서버는 `recording` 상태 구간에만 조각을 받으므로 순서를 바꾸면 마지막 조각이 `closed`로 거절된다.
5. [멈추고 정리]: 마지막 조각 → `rec_finish`(more면 반복) → 구간마다 `transcribe`(차례로) → 글 합치기(구간 머리 '― 59분부터 ―' 한 줄) → 기존 [초안 채우기] 흐름 → 사업 보고 › 회의 입력 창이 초안을 채운 채 열림. 띠에 진행 한 줄(올림 › 전사 › 요약 › 초안 열림).
6. 저장 뒤 녹음 붙이기: 기존 [이 회의에 녹음 붙이기]를 구간마다(`attach`).
7. 다시 열었을 때 `rec_pending`이 있으면 사업 보고 위에 '이어서 정리' 한 줄 → 5번과 같은 흐름.
8. 창 닫기 경고(`beforeunload`)는 녹음 중일 때만.
9. 업데이트 기록(`app/release-notes/…json`) 1개.
10. 시험: 순수 규칙(구간 넘김·조각 재시도·글 합치기) 단위 시험은 `app-smoke-check.yml`에 새 step, 화면은 E2E(가짜 MediaRecorder)로 PC에만 보이는지·폰 폭에 없는지.
11. 완료 기준(요청함): PC 1440에서 5분·30분 시험 → 자동으로 초안 열림. 녹음 중 창을 닫았다 다시 열어 '이어서 정리'로 전사되는지. 명진 실기기(노트북) 확인.

## 9. 적용 순서

1. PR A(DB, 이 문서 포함) → 커맨드센터가 승인형 DB workflow로 `20261029200000_meeting_recordings` 적용(정지 지점).
2. PR B(Edge `meeting-transcribe` 다시 배포, `verify_jwt` keep=true) → 승인형 Edge workflow. 표가 먼저 있어야 한다(없으면 녹음 동작만 실패, 기존 전사 길은 그대로).
3. 2단계 화면 PR.

되돌리기: 화면 → Edge(이전 운영 소스 SHA로 재배포) → DB rollback(SQL Editor, 새 표 1개·기록 1행만). 소리 파일은 Drive에 남는다.
