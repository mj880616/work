# 녹음 중복 막기·정리 (S69 녹음중복, 2026-11-24)

📱 폰 경로 B는 없음. 전사 앱 스크립트 편집기(script.google.com)가 필요하다. PC 브라우저나 폰의 데스크톱 보기로 한다.

명진이 쓰는 전사 앱 스크립트(Drive에 있는 '전사' 앱 스크립트 프로젝트, `Code.gs`·`Analysis.gs`)에 붙여 넣는 **통째 교체본**이다.
원문: [`transcription-dedupe.gs`](transcription-dedupe.gs). 단위 시험: `tests/security/transcription-dedupe-gas.test.mjs`(가짜 드라이브).
이 문서와 교체본에는 폴더 ID, 파일 이름, 번호가 없다. `Code.gs`의 `PIPELINES`는 그대로 쓴다.

## 0. 요약 (명진용)

- **왜 쌓였나**: 폰 녹음 백업 앱은 '원본' 폴더에 녹음이 없으면 다시 올린다. 그런데 전사 스크립트가 큰 녹음(45MB 넘음)과 전사 실패 녹음을 '원본'에서 '수동전사대기'로 **옮겼다**. 그러면 '원본'에서 녹음이 사라지고, 백업 앱이 같은 녹음을 새 파일로 다시 올린다. 큰 녹음은 매번 또 옮겨져서 한 시간에 한 벌씩 쌓였다. 음성녹음 자동 전사를 끈 10/24에 멈췄다. 통화 녹음도 통화 중에 덜 쓰인 파일이 올라오면 실패 → 옮김 → 다시 올림을 전사가 될 때까지 되풀이했다.
- **고친 뒤**:
  - 녹음을 옮기지 않는다. '원본'에 그대로 두고, '수동전사대기'에는 **바로가기**만 하나 둔다. 바로가기는 용량이 0이고, 백업 앱도 다시 올리지 않는다.
  - '원본' 안에 같은 내용의 녹음이 여러 개면 하나만 남기고 나머지는 휴지통으로 보낸다.
  - 막 올라온 녹음(10분 안)은 아직 쓰는 중일 수 있어 다음 실행에서 전사한다.
  - 실패한 녹음이 나중에 더 커지면(백업 앱이 이어 올림) 다시 전사한다.
- **이미 쌓인 것**: `cleanupDuplicateRecordings`를 **한 번만** 누른다. 끝까지 알아서 이어 간다.
  - 같은 내용(md5) 묶음마다 하나만 남기고 휴지통으로 보낸다. 30일 안에 되돌릴 수 있고, 영구 삭제는 하지 않는다.
  - 결과는 한 줄로 나온다: `묶음 N개 · 휴지통 N개 · 줄인 용량 X`. 남은 게 있으면 `· 이번에 휴지통 N개 · 남음 N개 · 한 번 더 실행(5분 뒤 자동)`이 붙는다.
  - 한 번 실행은 4분 30초에서 스스로 멈추고 결과를 남긴다(앱 스크립트 한도 6분에 끊기지 않게). 남은 게 있으면 5분 뒤 한 번 도는 트리거를 하나만 걸어 이어 하고, 다 끝나면 그 트리거를 지운다.
  - 실행 기록 파일 `중복정리기록_날짜_시각.txt`가 녹음 폴더에 남는다.
- **지우지 않는 것**:
  - 기록이 가리키는 파일: 분석 결과가 가리키는 전사 TXT, 웹2 자료·회의·통화 기록이 가리키는 파일(3절에서 확인), 바로가기가 가리키는 녹음.
  - '원본'에 있는 녹음(지우면 백업 앱이 또 올림).
  - 전사 중인 녹음.
  - 이름만 같고 내용이 다른 녹음(덜 쓰인 통화 녹음 등). 이런 것은 세기만 한다.
  - 기록이 아무것도 가리키지 않으면 가장 오래된 것을 남긴다. 단, '원본'에 있는 것이 우선이다.
- 내용은 열지 않는다. 파일 번호·이름·크기·md5·시각만 본다.

## 1. 붙이기 전에

1. 전사 앱 스크립트 프로젝트를 연다.
2. 되돌리기용 사본을 만든다. 왼쪽 **개요(ⓘ)** → **사본 만들기**를 누르고, 이름 끝에 `_20261124백업`을 붙인다. 사본에는 트리거가 없으니 그대로 둔다.

## 2. 붙이는 순서

1. 왼쪽 **파일 +** → **스크립트**를 누르고 이름을 `중복막기`로 짓는다.
2. 새 파일 안의 글을 지우고 [`transcription-dedupe.gs`](transcription-dedupe.gs)를 **통째로** 붙여 넣는다. 맨 아래 `module.exports` 부분도 그대로 둔다. 앱 스크립트에서는 무시된다.
3. `Code.gs`에서 아래 두 함수를 **통째로 지운다**. `function 이름(` 줄부터 그 함수가 끝나는 맨 왼쪽 칸의 `}` 줄까지다.
   - `function transcribeNewRecordings(`
   - `function transcriptionMoveManualCandidates_(`

   같은 이름 함수가 두 군데 있으면 어느 쪽이 쓰일지 정해지지 않는다. 그래서 반드시 지운다.
4. 저장(💾)한다.
5. 미리 보기를 한다.
   - 함수 칸에서 `previewDuplicateRecordings`를 고르고 [실행]을 누른다.
   - 로그 첫 줄에 `묶음 N개 · 휴지통 N개 · 줄인 용량 X (미리 보기)`가 나온다. 이때는 아무것도 바뀌지 않는다.
   - 권한 창이 뜨면 명진 계정으로 허용한다. 새로 쓰는 권한은 없다(드라이브·외부 요청은 이미 쓰고 있음).
6. 웹2 기록 확인을 한다(3절, 커맨드센터). 걸린 번호가 있으면 프로젝트 설정 → 스크립트 속성 `RECORDING_KEEP_IDS`에 쉼표로 넣는다. 그다음 5를 다시 돌린다.
7. 실제 정리를 한다. 함수 칸에서 `cleanupDuplicateRecordings`를 고르고 [실행]을 **한 번** 누른다.
   - 로그 첫 줄이 결과 한 줄이다.
   - `남음 N개 · 한 번 더 실행(5분 뒤 자동)`이 붙어도 다시 누르지 않는다. 5분마다 스스로 이어 간다(6절에서 진행 확인).
8. 그 뒤로는 기존 10분 트리거(`transcribeNewRecordings`)가 새 함수로 돈다. 이 트리거는 바꾸지 않는다.

## 2-1. 이미 붙인 상태에서 `중복막기` 파일 통째 교체

1절 사본이 이미 있고 `Code.gs`의 두 함수도 이미 지웠다면 아래만 한다.

1. 왼쪽 파일 목록에서 `중복막기`를 연다.
2. 안의 글을 모두 지운다(Ctrl+A → Delete).
3. [`transcription-dedupe.gs`](transcription-dedupe.gs)를 통째로 붙여 넣는다.
4. 저장(💾)한다.
5. 함수 칸에서 `cleanupDuplicateRecordings`를 고르고 [실행]을 한 번 누른다.
   - 처음이면 '트리거 관리' 권한을 묻는 창이 뜰 수 있다(이어 하기 트리거를 걸기 위함). 명진 계정으로 허용한다.
   - 프로젝트 설정에서 `appsscript.json`에 `oauthScopes`를 직접 적어 두었다면 `https://www.googleapis.com/auth/script.scriptapp`이 있어야 한다. 없으면 실행 때 권한 오류가 난다(적어 두지 않았으면 할 일 없음).
6. 6절로 진행을 확인한다.

`Code.gs`·스크립트 속성·기존 10분 트리거는 건드리지 않는다. 앞서 끊긴 실행이 휴지통에 보낸 것은 다시 세지 않는다(남은 것만 다시 묶는다).

## 3. 웹2 기록 확인 (커맨드센터, 읽기만)

미리 보기 로그의 `휴지통 후보` 줄에서 둘째 칸(파일 번호)만 모은다. 그 번호들을 SQL Editor 새 쿼리 창(+)에 넣고 아래를 실행한다(select만 함).
결과에는 **번호와 표 이름만** 나온다. 기록 내용은 보지 않는다(AGENTS.md 3절).

```sql
with ids(id) as (select unnest(string_to_array('여기에_번호,쉼표로', ',')))
select 'app_documents' as t, d.file_id as id from public.app_documents d join ids on d.file_id = ids.id
union all select 'app_meeting_server_jobs', j.source_file_id from public.app_meeting_server_jobs j join ids on j.source_file_id = ids.id
union all select 'app_meeting_transcribe_jobs', j.drive_file_id from public.app_meeting_transcribe_jobs j join ids on j.drive_file_id = ids.id
union all select 'app_task_attachments', a.drive_file_id from public.app_task_attachments a join ids on a.drive_file_id = ids.id
union all select 'app_ledger_sources', s.drive_file_id from public.app_ledger_sources s join ids on s.drive_file_id = ids.id
union all select 'app_feed_items', f.source_ref from public.app_feed_items f join ids on f.source_ref = ids.id;
```

- 0줄이면 그대로 2-7로 간다.
- 줄이 나오면 그 번호들을 `RECORDING_KEEP_IDS`에 넣는다.

## 4. 되돌리기

- **지운 파일**: 드라이브 휴지통에서 복원한다. 30일 안에만 된다. 실행 기록 파일에 지운 파일 번호·폴더·크기가 다 적혀 있다.
- **스크립트**: `중복막기` 파일을 지우고, 1절 사본의 `Code.gs`에서 두 함수를 다시 복사해 붙인다. 함수를 되돌리면 녹음을 다시 옮기므로 중복도 다시 생긴다.
- 새 코드가 만든 바로가기는 지워도 녹음에는 영향이 없다.

## 5. 확인 (명진 할 일 없음, 커맨드센터가 하루 뒤 확인)

- 수동전사대기 폴더에 같은 이름의 진짜 녹음 파일이 더 늘지 않는다(바로가기만 생김).
- 트리거 실행 기록에 `수동전사대기 바로가기(원본은 그대로)` 또는 `원본 안 같은 녹음 휴지통` 줄이 보일 수 있다. 정상이다.
- 통화 녹음은 끝나고 10분쯤 뒤에 전사된다. 예전에는 바로 전사됐다.

## 6. 정리 진행 확인 (커맨드센터)

- **스크립트 속성 `RECORDING_CLEANUP_LAST`**(프로젝트 설정 → 스크립트 속성): 마지막 실행의 결과 한 줄(`line`), 이번에 보낸 수(`trashed`), 실패(`failed`), 남은 수(`remaining`), 다 끝났는지(`done`), 이어 하기 트리거가 걸렸는지(`scheduled`).
- **실행 기록 파일 `중복정리기록_날짜_시각.txt`**: 실행마다 하나씩 녹음 맨 위 폴더에 남는다. 첫 줄이 결과 한 줄, 아래가 `휴지통`·`실패(HTTP …)` 줄이다.
- **트리거 화면(⏰)**: 남은 게 있는 동안 `cleanupDuplicateRecordings`(한 번 실행) 트리거가 **하나** 보인다. 다 끝나면 사라지고 `transcribeNewRecordings` 10분 트리거만 남는다.
- 끝난 모습: `done: true`, `remaining: 0`, 결과 한 줄에 `남음`이 없다.
- 실패한 것은 다음 실행에서 다시 보낸다. 한 번 실행에서 하나도 못 보내면(모두 실패, 또는 목록 읽기에 시간을 다 씀) 같은 일을 되풀이하지 않게 이어 하기를 멈추고 결과 한 줄에 `자동 이어 하기 안 함(확인 필요)`을 적는다. 그때는 원인을 보고 다시 한 번 누른다.
- 멈추고 싶으면 트리거 화면에서 `cleanupDuplicateRecordings` 트리거를 지운다. 이미 휴지통에 간 것은 4절로 되돌린다.
