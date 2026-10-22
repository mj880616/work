# 자료실 AI 자동 채우기 (LIB-AI자동분류)

📱 폰 가능. 코드·시험은 PR #959(채우기)·LIB-자동정리 PR(기존 자료 자동 정리, 6절). DB·Edge는 적용·배포 직전에 멈춘 상태다(5절·6.5절).

- 요청: 2026-10-22 08:13 + 09:09 사용자 확정(요청함).
- 바탕: [ai-server.md](ai-server.md)의 `ai-assist`(열쇠 `WEB2_OPENAI_API_KEY`, 비용 세 겹 한도, verify_jwt=true + 소유자 확인). 옛 `OPENAI_API_KEY` 경로는 쓰지 않는다.
- 조율: [global-search.md](global-search.md) 3.2절·결정 3. 글자 읽기 함수는 이 PR이 한 곳에 만들고 전체 검색이 그대로 쓴다.

## 1. 사용자 결정

| # | 결정 | 구현 |
| --- | --- | --- |
| ① | 올리면 버튼 없이 AI가 빈 칸만 채움 | 올리기 성공 직후 화면이 뒤에서 `document-text` → `ai-assist library_fill(mode fill)`을 부른다. 기다리지 않는다. |
| ② | 채우는 칸: 제목·자료 날짜·저자(작성 주체)·유형 | `title`·`document_date`·`source`·`category` 4칸만. 프로젝트·조직 연결은 범위 밖. |
| ③ | 화면 어디에도 AI 표시 없음 | 칸별 기록 `field_origin`은 DB에만 두고 화면은 그리지 않는다. 자료실에 원래 있던 "자동분류" 글(관리 목록의 "· 자동분류", 등록 완료 문구, 관리 창 설명)도 같이 지웠다. 올리기 창 분류 첫 선택지 "자동 분류"(= 비워 두기)는 자료별 표시가 아니라 남겼다. |
| ④ | 직접 쓴 칸·고친 칸은 덮어쓰지 않음 | 올리기 창에 직접 넣은 칸은 `keep`으로 보내 `'user'`가 된다. 자료 정보 수정에서 고친 칸은 화면이 `'user'`로 바꾼다(그 칸의 `'ai'` 기록이 지워짐). 서버는 `'user'` 칸을 어느 모드에서도 쓰지 않는다. |
| ⑤ | PDF·HWPX 등은 글자로, 사진·못 읽는 파일은 이름으로 | 2절. |
| ⑥ | 바구니 '자료실로 보내기'에도 적용 | 새로 등록된 경우(`created`)만. 이미 있던 자료(`exists`)는 다시 채우지 않는다. |
| ⑦ | Drive 원본 이름 그대로 | 원본 파일은 읽기만 한다(이름·위치·내용 변경 없음). 시험으로 확인. |
| ⑧ | ~~기존 자료 전수 정리는 목록 먼저, 적용은 확인 뒤 별도~~ → **2026-10-22 20:54 바뀜**: "자료 정보 중 손으로 입력하지 않은 건 백그라운드에서 알아서" | 제안 목록·체크·적용 화면 없이 자료실을 열 때 조용히 정리(6절). #998의 정리 제안 화면은 삭제. |
| ⑨ | (2026-10-22 20:42) 자동으로 바꾸는 칸의 원래 값 백업 위치 = 서버 안 백업 표 | `app_library_tidy_backups`(6.3절). 되돌리기는 서버 함수로만(화면 버튼 없음). |

## 2. 흐름

1. 자료 등록(`library-files` 올리기 또는 `document-actions register-basket-attachment`) — 기존 그대로.
2. 화면 `app/library-ai-fill.js` `fillLibraryDocument(id,{keep})`:
   - `document-actions` `action=document-text` — 서버가 자료 행·소유자를 DB에서 확인하고 Drive 파일 글자를 읽어 **이미 있는** `app_documents.extracted_text`·`extraction_status`·`extraction_error`·`extracted_at`에 둔다. 응답에 글자는 없다(상태만). 이미 `ready`면 다시 읽지 않는다.
   - `ai-assist` `kind=library_fill, mode=fill, document_ids=[id], keep=[…]` — 서버가 자료 행·글자·분류 목록을 로그인 토큰으로 읽고(owner RLS), 앞 8,000자와 파일 이름·형식만 AI에 보낸다.
   - 채워지면 `kptu:documents-changed`로 목록을 다시 읽는다. 실패는 조용히 끝난다(올리기 결과·문구 그대로, 재시도 없음).
3. 서버 저장 규칙: 막 올린 자료(1시간 안)만, `'user'`·`keep` 칸 제외, AI 값이 있고 지금 값과 다를 때만. 저장은 `updated_at`이 읽을 때와 같을 때만(그 사이 사용자가 고쳤으면 건너뜀). 이미 있는 분류를 '기타'로 바꾸지 않는다.
4. AI 답은 믿지 않는 입력: 형식(strict JSON schema)·키·글자 수(제목 120·저자 60)·날짜(1980년~1년 뒤)·분류(사용자 분류 목록 안)를 다시 검사하고 HTML·제어 문자를 지운다. 자료 안의 지시문은 따르지 않도록 지침에 적었고 시험으로 확인했다.
5. 비용: `ai-assist`의 기존 세 겹 한도(월 추정·하루 전체 50회) 안. `library_fill` 하루 상한 50회.

## 3. 글자 읽기 (전체 검색과 공유)

`supabase/functions/_shared/document-text.ts` 하나. `document-actions`가 부르고, 전체 검색 ②도 이 함수를 그대로 쓴다.

| 형식 | 방법 | OpenAI |
| --- | --- | --- |
| txt·md·csv | 내려받아 UTF-8 | 없음 |
| HWPX | 내려받아 zip 안 `Contents/section*.xml`의 글자(외부 라이브러리 없음) | 없음 |
| PDF·HWP·DOC·DOCX·RTF·ODT | Drive가 Google 문서로 바꾼 **임시 사본**을 text/plain으로 내보낸 뒤 사본 삭제(성공·실패 모두) | 없음 |
| 사진·그 밖 | 읽지 않음 → 파일 이름으로만 판단 | 없음 |

- 저장 상한은 12,000자다. 자료 목록 화면 여러 곳(`library-upload.js`·`team.js`·`meeting-round-detail.js`·`project-system-v3.js`)이 `app_documents`를 `select=*`로 읽어서, 5만 자를 넣으면 목록 읽기가 그만큼 무거워진다. 전체 검색이 전체 글자가 필요하면 그 PR에서 목록 읽기 칸을 좁힌 뒤 `DOCUMENT_TEXT_CHARS` 값만 올린다(옛 상한 50,000자). **global-search.md 3.3의 "5만 자 상한 유지"와 다른 점**이며 이유는 이것이다.
- 옛 `document-ai-index`(OpenAI로 PDF 읽기·옛 열쇠)는 되살리지 않았다. `library-files`도 고치지 않았다(글자 읽기는 올리기 뒤 화면 요청으로 붙임 — global-search.md 3.3의 "library-files 업로드 훅" 대신. 이유: 두 PR이 같은 Edge 파일을 동시에 고치지 않기, 올리기 응답 시간을 늘리지 않기).

## 4. DB (`supabase/migrations/20261022100000_library_ai_fill.sql`, 미적용)

- `app_documents.field_origin jsonb not null default '{}'` 1칸 + 검사(키 4개, 값 `'ai'`·`'user'`만). 기존 행은 `{}`.
- 글자 칸은 새로 만들지 않고 있는 칸을 다시 쓴다(사전 확인에서 4칸의 존재·종류를 확인, 없으면 멈춤).
- 새 표·함수·트리거·정책·권한 없음. 기존 owner 정책·authenticated UPDATE 권한이 그대로 걸린다.
- 짝 파일 5개: `docs/20261022100000_library_ai_fill.{precheck,snapshot,postcheck,rollback}.sql`, `.summary.md`.
- rollback은 칸별 기록이 한 줄이라도 있으면 지우지 않고 멈춘다(화면·Edge를 먼저 되돌린 뒤 보관 여부 결정).

## 5. 적용 순서와 정지 지점

| 순서 | 무엇 | 방법 | 되돌리기 |
| --- | --- | --- | --- |
| 1 | DB `20261022100000_library_ai_fill` | 승인형 `db-migration-apply` (mode apply, 사용자 승인 한 번) | `docs/…rollback.sql` (SQL Editor) |
| 2 | Edge `document-actions` (verify_jwt=true 유지) | `edge-function-deploy` function=document-actions, ref=이 PR merge SHA | 직전 운영 ref 재배포(배포 전 운영 출처 SHA 확인. 원장 기준 최근 v9 = `c568edc`) |
| 3 | Edge `ai-assist` (verify_jwt=true 유지) | `edge-function-deploy` function=ai-assist, ref=이 PR merge SHA | 직전 운영 ref 재배포(배포 전 운영 출처 SHA 확인) |
| 4 | 화면 | Pages(merge = 배포) | revert PR |

- 화면은 어느 순서로 먼저 나가도 깨지지 않는다: DB 전이면 `ai-assist`가 `library_not_ready`, Edge 전이면 404/알 수 없는 동작 → 화면은 조용히 끝나고 올리기는 그대로. 수정 저장은 `field_origin` 칸이 행에 없으면 보내지 않는다.
- `ai-assist`는 DB 칸(`field_origin`)이 있어야 동작하므로 DB → Edge 순서.

## 6. 기존 자료 자동 정리 (LIB-자동정리)

### 6.1 무엇을 바꾸나

- 대상: 올린 지 1시간이 지난 자료(막 올린 자료는 2절 fill이 맡는다)의 4칸 중 **정리 안 된 칸**만. 정리 안 된 칸 = 빈 칸, 파일 이름과 같은 제목, '기타'이거나 내 분류 목록 밖인 분류(서버 `needsTidy`, 화면 `untidyFields` 같은 규칙).
- 절대 안 바꾸는 칸: `field_origin`이 `'user'`인 칸, 이미 의미 있는 값이 있는 칸, 그리고 칸별 기록이 생기기 전에 사람이 손댄 칸(`classification_note`가 '사용자 수정'이면 4칸 모두, '사용자 입력 제목…'이면 제목 — `legacyUserFields`). 서버가 다시 고르고(화면 값 불신), DB 함수도 `'user'` 칸이면 전체를 취소한다.
- AI 경로는 새로 만들지 않았다: `ai-assist` `kind=library_fill`에 `mode=tidy`를 더했고 재료·지침·형식 검사(strict JSON·글자 수·날짜 범위·분류 목록)·하루 50회·월 한도는 fill과 같다.
- 바꾼 칸은 `field_origin` `'ai'`. 화면에는 아무 표시도 없다(③).

### 6.2 실행 방식 (조사 뒤 결정)

**자료실을 열 때 화면이 조용히 소량씩 서버에 맡긴다**(기본안 채택). 서버 예약 실행은 쓰지 않았다: ai-assist는 로그인 토큰으로 owner RLS를 그대로 타는 구조(서버 관리자 키 없음, ai-server.md D1)라 예약 실행을 하려면 새 비밀값이나 관리자 키 경로가 필요하고, 이는 지시서의 "새 비밀값·권한 확대 없이"와 맞지 않는다.

1. `app/library-upload.js`: 자료실 목록을 읽어 그린 **뒤** `luStartAutoTidy()`(기다리지 않음). 한 번에 하나만 돈다.
2. `app/library-ai-fill.js` `autoTidyLibrary`: 행에 `field_origin` 칸이 없으면(DB 적용 전) 끝. 시도 기록(`app_library_tidy_attempts`)을 읽지 못하면(표 없음) 끝. 후보를 10개씩, 한 번 열 때 최대 3묶음(30개) 보낸다. 75개면 세 번 열면 끝난다.
3. 글자 읽기: `extraction_status`가 `ready`·`error`인 자료(이미 읽어 본 자료)는 `document-text`를 다시 부르지 않는다. 아직 안 읽은 자료만 동시 3개, 한 자료 20초가 넘으면 기다리지 않고 파일 이름만으로 진행한다.
4. 서버(`mode tidy`): 시도 기록이 있는 자료와 막 올린 자료는 AI에 보내지 않는다 → 같은 자료를 다시 AI에 보내지 않는다(되돌린 뒤에도).
5. 멈춤: 하루·월 한도, 준비 안 됨(404·표 없음), 권한, 로그인 필요면 그 로그인 동안(화면 메모리) 다시 부르지 않는다. 그 밖의 실패(바쁨·시간 초과)도 그 묶음에서 조용히 멈추고 재시도하지 않는다. 다음에 자료실을 열면 남은 자료부터.
6. 다른 업무공간·로그아웃(세션 epoch 변경)·자료실을 떠나면 다음 요청을 보내지 않는다(`isCurrent`). 이미 보낸 한 묶음은 서버가 마저 처리한다(owner RLS 안, 같은 업무공간).
7. 바뀌면 목록만 다시 읽는다. 화면 문구·진행 표시·안내문은 없다. 브라우저 저장소를 쓰지 않는다.

### 6.3 DB (`supabase/migrations/20261022212757_library_auto_tidy.sql`, 미적용)

- `app_library_tidy_backups`: 묶음 id·자료 id·칸·원래 값·원래 칸 기록(없음/`'ai'`)·새 값·시각·되돌린 시각. authenticated는 읽기, 함수가 쓰는 칸만 넣기, `reverted_at`만 고치기. 원래 값·새 값은 고칠 수 없고 행을 지울 수도 없다.
- `app_library_tidy_attempts`: 자료마다 1행(묶음 id·바꾼 칸 수·시각). 자료가 지워지면 같이 지워진다.
- `public.app_library_auto_tidy_apply(uuid, jsonb)`: 자료 1~10개. 행 잠금 → `updated_at`이 읽을 때와 다르면 건너뜀 → 칸마다 형식 검사(칸 이름 4개·글자 수·꺾쇠/제어문자·날짜 1980년~1년 뒤)·`'user'` 거절 → **백업 행 → 자료 칸·`'ai'` 기록 → 시도 기록을 한 트랜잭션으로**. 하나라도 틀리면 그 호출 전체 취소.
- `public.app_library_auto_tidy_revert(uuid)`: 한 묶음의 안 되돌린 칸 중 **지금 값이 AI 새 값 그대로이고 칸 기록이 `'ai'`인 칸만** 원래 값·원래 기록(없었으면 기록 삭제)으로. 그 사이 사용자가 고친 칸은 건너뛴다(백업 행 유지). 시도 기록은 남긴다.
- 두 표 모두 RLS 켜고 owner 정책 1개(`private.app_is_workspace_owner`, 자료는 같은 업무공간만). PUBLIC·anon·service_role 권한 없음. 두 함수 SECURITY INVOKER·`search_path = ''`, authenticated만 실행. 기존 표·정책·자료 변경 없음.
- 승인형 DB workflow 확장 규칙 통과(apply·dry-run, 짝 파일 5개). rollback은 표 삭제라 SQL Editor(폰 경로 C) 전용이며, 안 되돌린 백업이 한 줄이라도 있으면 멈춘다.

### 6.4 되돌리기 (화면 버튼 없음, CC가 승인형 절차로)

1. 읽기 전용으로 묶음 목록을 본다: `select batch_id, min(created_at), count(*) from public.app_library_tidy_backups where reverted_at is null group by 1 order by 2 desc;`
2. 사용자가 SQL Editor 새 창에서 `begin; select public.app_library_auto_tidy_revert('<묶음 id>'); commit;` 실행 → 결과 `{"reverted":n,"skipped":m}`.
3. 전부 되돌릴 때는 묶음마다 2를 반복한다. `skipped`는 그 사이 명진이 고친 칸이라 그대로 둔다.

### 6.5 적용 순서와 정지 지점

| 순서 | 무엇 | 방법 | 되돌리기 |
| --- | --- | --- | --- |
| 1 | DB `20261022212757_library_auto_tidy`(선행: `20261022100000_library_ai_fill` 적용) | 승인형 `db-migration-apply` mode apply, 사용자 승인 1번 | 값은 6.4, 표·함수는 `docs/…rollback.sql`(SQL Editor, 화면·Edge 먼저 되돌린 뒤) |
| 2 | Edge `ai-assist`(verify_jwt=true 유지) | `edge-function-deploy` function=ai-assist, ref=이 PR merge SHA | 배포 전 운영 출처 SHA를 확인해 그 ref로 재배포 |
| 3 | 화면 | Pages(merge = 배포) | revert PR |

- 화면이 먼저 나가도 아무 일도 없다: 시도 기록 표가 없으면 AI를 부르지 않고, Edge가 옛 판이면 `mode tidy`를 400(invalid_request)으로 거절 → 조용히 끝.
- Edge가 DB보다 먼저 나가도: 시도 기록 표·함수가 없으면 `library_not_ready`(AI 호출 전).
- `document-actions`는 고치지 않았다(배포 없음).

### 6.6 옛 정리 제안(propose)

- #998의 '자료 분류 수정' 창 [정리 제안 찾기]·목록과 관련 JS(`luTidy*`, `buildTidyProposals`·`groupTidyProposals` 등)·CSS(`.library-tidy`, `.lt-*`)·시험은 삭제했다.
- 서버 `mode propose`는 건드리지 않았다. 지금 화면 사용처는 없다(서버 시험만 씀). 지울지는 따로 정한다.

## 7. 시험

- 서버: `tests/security/ai-assist-library-fill.test.mjs`(빈 칸만·keep·'user' 보존·읽은 뒤 고친 경우 건너뜀·사진은 이름만·지시문 무시·propose 저장 없음·다른 업무공간 거절·DB 적용 전 `library_not_ready`; tidy: 백업 함수로만 저장·정리 안 된 칸만·옛 수정 칸 보호·시도한 자료 재전송 없음·한도·준비 안 됨), `tests/security/document-text.test.mjs`(형식별 읽기·임시 사본 삭제·원본 쓰기 없음·응답에 글자 없음·소유자 확인).
- DB: `tests/auth-handoff/library-ai-fill.test.mjs`(사전 확인·적용·검사·RLS·rollback 막힘), `tests/auth-handoff/library-auto-tidy.test.mjs`(dry-run·apply·한 트랜잭션·사용자 칸 거절·입력 검사·moved 건너뜀·owner 전용·되돌리기(이후 고친 칸 건너뜀)·rollback 막힘·재적용).
- 화면 단위: `tests/library-ai-fill.test.mjs`(자동 정리 후보·묶음·재시도 없음·글자 읽기 동시 3·시간 제한·화면 표시 없음).
- E2E: `tests/app-e2e/library-ai-fill.spec.mjs`(390·1440 빈 칸만 채움·직접 입력 보존·고친 칸 재덮어쓰기 없음·AI 표시 없음·AI 실패 시 업로드 정상·AI 응답을 기다리지 않음), `tests/app-e2e/basket-library-send.spec.mjs`(바구니 보내기 채움, `exists`는 안 채움).
- E2E 자동 정리: `tests/app-e2e/library-auto-tidy.spec.mjs`(390·1440 조용한 정리·표시 없음·사용자 칸·시도 자료 안 보냄·글자 칸 있으면 document-text 0회·기다리지 않음·떠나면 멈춤·한도·브라우저 저장소 불변·DB 전 0회).
