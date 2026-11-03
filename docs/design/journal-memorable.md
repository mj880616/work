# JOURNAL-기억할통화텔레그램 설계 (S49-12, 요청함 11/03 10:06 명진 덧붙임)

- 앞 설계: [call-telegram-feed.md](call-telegram-feed.md)(통화·텔레그램 수집), [weekly-draft-feedback.md](weekly-draft-feedback.md)(주간보고 환류), 규칙 [AGENTS.md](../../AGENTS.md).
- 앞 PR: JOURNAL-노트옮긴것빼기(#1827) — 그 밖의 기록에서 '업무 통화' 묶음을 뺐다. 이 설계가 그 자리를 대신한다.

## 1. 하려는 것

업무일지 [하루] 주간보고 재료에 네 번째 묶음 **기억할 통화·텔레그램**을 둔다. 그날 업무 통화(업무 통화함만, 개인 통화 제외)와 텔레그램 수집 중에서 AI가 주간보고에 담을 만한 것만 골라 한 줄씩 보인다. 나머지는 보이지 않는다.

- 한 줄: 조직 이름 먼저, 명사형 끝맺음, 사람 이름·사적 내용 뺌, 줄마다 근거 기록(원래 통화·텔레그램 기록)으로 가는 링크.
- 줄마다 [넣기] [고쳐서 넣기] [빼기(이유 선택)] — 주간보고 환류와 같은 길. 고른 줄이 주간보고 조직 칸 후보가 된다.
- 머리에 작게 "10:00 기준"(마지막으로 고른 시각).

## 2. 운영자 전용 (서버가 막는다)

통화·텔레그램은 운영자 작업공간에서만 서버가 허용한다(MULTI D2). 화면 숨김으로 막지 않는다.

- 새 표 두 개 모두 owner 정책 위에 restrictive 정책으로 `private.app_workspace_has_feature(workspace_id, 'calls'|'telegram')`를 더 요구한다(출처별: call→calls, telegram→telegram). 권한을 넓히지 않고 좁히기만 한다.
- Edge는 사용자 로그인(JWT)으로 표를 읽고 쓰므로 같은 정책이 서버에서 그대로 걸린다. 허용 행이 없는 작업공간은 읽기·쓰기가 모두 빈 결과/거절이다. 화면은 `app_my_features()`로 묶음을 그릴지 정하되 그것은 편의일 뿐 보호가 아니다.

## 3. 저장 (이 PR의 migration)

| 표 | 한 줄 | 비고 |
| --- | --- | --- |
| `app_journal_memorable` | AI가 고른 한 건: 날짜·출처(call/telegram)·근거 `app_feed_items.id`·조직 이름·한 줄(≤160자)·결과(suggested/kept/dropped)·고쳐 넣은 글·뺀 이유 | `(workspace_id, feed_item_id)` 유일 → 같은 기록은 한 번만 고른다 |
| `app_journal_memorable_runs` | 하루 1행: 마지막으로 AI에 보낸 시각 | 1시간 갱신 판정 |

권한: authenticated는 읽기, 넣기(값 칸만), 고치기(결과 칸 4개만). 지우기 없음. anon·PUBLIC·service_role 없음. 원문 전체·전화번호·사람 이름은 넣지 않는다.

## 4. 갱신 방식 (⑥) — 추천: 화면을 열 때

- 추천: 업무일지 [하루]를 열었을 때 `runs.last_run_at`이 1시간보다 오래됐고 그 뒤 새로 들어온 통화·텔레그램이 있으면 **그때 새 것만** AI에 보낸다. 결과는 `app_journal_memorable`에 저장하고(같은 기록은 다시 보내지 않음) `last_run_at`을 갱신한다. 안 볼 때는 AI 비용이 0이다. 하루 AI 한도 안(기존 ai-assist 한도 공유).
- 매시 예약 실행 대안: 안 열어도 AI가 매시 돈다. 업무일지를 하루에 몇 번만 여는 사용 패턴에서는 대부분의 실행이 헛돌고, 예약 실행은 사용자 로그인(JWT)이 없어 owner RLS를 못 쓴다(service_role 권한을 새로 줘야 함 → 권한 확대). 그래서 채택하지 않는다.
- 수집 자체의 지연(보고): 텔레그램은 매시 보내되 한국 0~7시는 쉬고 7시에 몰아서, 통화는 전사 10분 간격 + 분석 후 1시간마다 보내기라 새 통화는 보통 1~2시간 뒤에 보인다(call-telegram-feed.md 7절). 따라서 이 묶음의 최신성은 "수집 주기 + 최대 1시간"이다. 더 빠르게 하려면 수집 스크립트 주기를 줄이는 별도 작업이 필요하다.

## 5. 서버 (다음 PR, DB 적용 뒤)

- ai-assist에 `journal_memorable` 용도 하나 추가(Edge 함수 `ai-assist`, verify_jwt 값 유지). 순수 함수는 `supabase/functions/ai-assist/journal-memorable.ts`(재료 검사·답 검사, journal-draft.ts와 같은 모양), 입출력은 handler.ts.
- 서버가 `app_feed_items`에서 그날 source=call(업무 통화함만)·telegram 줄의 제목·요약 짧은 칸만 읽어 AI에 보낸다(비밀 모양 줄 제외·연락처 지움). 화면이 보낸 줄을 믿지 않는다.
- AI 답도 믿지 않는 입력으로 검사한다(한 줄·160자·HTML·제어 문자·연락처·사람 이름 모양). 기록(로그·사용량)에는 숫자만.
- 배포는 커맨드센터가 승인형 workflow로(한 번에 하나, 되돌리기 ref 기록).

## 6. 화면 (다음 PR)

- `app/journal-data.js` REPORT_PARTS에 네 번째 묶음, `app/journal.js` 그리기(주간보고 재료 안, 다른 묶음과 같은 줄 모양).
- 줄 버튼은 기존 환류 부품을 재사용(새 상태 저장소 만들지 않음). [넣기]/[고쳐서 넣기]는 주간보고 조직 칸 후보로 연결.

## 7. 순서·복구

1. 이 PR(설계 + migration + 짝 파일 5개) merge → 커맨드센터가 시험 적용 → 적용 → 사후 확인. 표만 생기고 화면·Edge는 아직 안 쓰므로 영향 없음.
2. 다음 PR: ai-assist `journal_memorable` + 화면. merge 뒤 Edge 배포(`ai-assist`).
3. 복구: DB는 짝 rollback(SQL Editor), Edge는 이전 SHA 재배포, 화면은 표가 없으면 묶음을 그리지 않는다.
