# 자료실 AI 자동 채우기 (LIB-AI자동분류)

📱 폰 가능. 코드·시험은 PR #959. DB·Edge는 적용·배포 직전에 멈춘 상태다(5절).

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
| ⑧ | 기존 자료 전수 정리는 목록 먼저, 적용은 확인 뒤 별도 | `mode propose`는 저장 없이 목록만 돌려준다(6절). 적용 단계는 이 PR에 없다. |

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

## 6. 기존 자료 정리 (1단계만)

- `ai-assist mode=propose`(자료 10개씩): 정리 안 된 칸(빈 칸, 파일 이름과 같은 제목, '기타'·목록 밖 분류)에 대해 `{document_id, field, from, to}` 목록만 돌려준다. **저장 없음**(시험으로 확인).
- 화면 함수 `buildTidyProposals(ids)`가 목록을 모은다. 아직 이 목록을 보여 주는 화면·적용 단계는 없다.
- 적용(별도 과제, 운영 데이터 변경 정지 지점): 사용자가 고른 줄만, 원래 값을 먼저 백업 표 또는 Drive 파일로 남기고(자료 id·칸·원래 값·새 값·시각), `updated_at` 확인으로 바꾸고, 되돌리기 SQL을 함께 준비한다. 적용한 칸은 `'ai'`로 기록한다.

## 7. 시험

- 서버: `tests/security/ai-assist-library-fill.test.mjs`(빈 칸만·keep·'user' 보존·읽은 뒤 고친 경우 건너뜀·사진은 이름만·지시문 무시·propose 저장 없음·다른 업무공간 거절·DB 적용 전 `library_not_ready`), `tests/security/document-text.test.mjs`(형식별 읽기·임시 사본 삭제·원본 쓰기 없음·응답에 글자 없음·소유자 확인).
- DB: `tests/auth-handoff/library-ai-fill.test.mjs`(사전 확인·적용·검사·RLS·rollback 막힘).
- 화면 단위: `tests/library-ai-fill.test.mjs`.
- E2E: `tests/app-e2e/library-ai-fill.spec.mjs`(390·1440 빈 칸만 채움·직접 입력 보존·고친 칸 재덮어쓰기 없음·AI 표시 없음·AI 실패 시 업로드 정상·AI 응답을 기다리지 않음), `tests/app-e2e/basket-library-send.spec.mjs`(바구니 보내기 채움, `exists`는 안 채움).
