# 홈 [하루] 읽을 만한 글·기록 제안 서버 (HOME-하루채우기 PR-B)

명진 11/09 09:43 시안 ④ 승인("하루 시안은 좋아"). 화면 칸 부품·거르기는 PR-A(#2198, `app/home-day-fill.js`·`app/home-day-picks-model.mjs`), 이 문서는 서버(PR-B), 화면 연결은 PR-C.

## 길

- '기억할 소식'(`journal_memorable`)과 같은 길: Web2 화면 → `ai-assist`(verify_jwt true, 사용자 로그인) 쓰임 `home_day_picks` → 서버가 사용자 토큰으로 읽기(owner RLS) → OpenAI(`WEB2_OPENAI_API_KEY`, `store:false`) → 결과를 owner 표 `app_home_day_picks`에 저장 → 화면은 표를 읽어 그림. 새 Edge 함수 없음.
- 화면이 보내는 것: `{kind:"home_day_picks", day, events, done}`.
  - `events`: 그 날이 든 주(월~일)의 구글 캘린더 일정 `{day, start, end, title}` 최대 40개(종일은 start·end 빈 값).
  - `done`: 그 날 끝낸 할 일 제목 최대 30개.
  - 구글 캘린더·할 일은 사용자 연결(구글)이라 `ai-assist`가 읽지 못해 화면이 제목만 보낸다(`schedule_titles`·`next_week_sheet`와 같은 방식). 믿지 않는 입력으로 모양·길이·제어 문자를 검사한다.
- 서버가 읽는 것: 최근 사흘 뉴스(`app_news_items`, 숨김 제외), 내 담당조직(`app_suborganizations`+담당자), 사업영역(`app_spaces`), 오늘 회의(`app_meetings` 제목), 오늘 업무 통화(`app_feed_items source=call`, 운영자 기능 calls일 때만), 오늘 일기(`app_notes kind=diary`, 겹침 거르기에만).

## 언제

- ② 읽을 만한 글: 오늘 처음 열 때(저녁 6시 앞 = 아침) 한 번, 저녁 6시 뒤 첫 열기에 한 번 — 단 아침에 본 가장 새 뉴스 뒤로 새 글이 들어왔을 때만. 뉴스가 하나도 없으면 AI를 부르지 않는다.
- ③ 기록 제안: 오늘 저녁 6시 뒤 한 번. 재료가 없으면(모두 일기에 썼거나 할 일이 없으면) 부르지 않고 다음 열기에 다시 본다.
- 두 기기가 동시에 열면 `run_at` 차지로 한 쪽만 AI를 부른다(3분 지나면 끝나지 못한 것으로 보고 다시 차지).
- 사용량: 쓰임 이름 `home_day_picks`(하루 8회 안, 모든 쓰임 합계 80회·월 상한은 기존과 같음). 상한에 닿으면 429 `monthly_limit`/`daily_limit` — 화면은 기존 한도 알림 문구로 보인다(칸을 조용히 비우지 않음).

## AI가 하는 것·안 하는 것

- ②: 번호 붙은 뉴스 중 ① 담당조직 ② 사업영역 ③ 이번 주 일정과 이어지는 글을 최대 3개 고르고 `what`(무슨 일, 80자)·`why`(왜 나에게, 60자)만 쓴다. 같은 사건은 하나만, 이어지는 게 없으면 채우지 않는다.
  제목·출처·시각·원문 주소는 서버가 DB 줄에서 붙인다(주소는 https만, AI에 id·주소를 보내지 않음).
- ③: 오늘 지난 일정·끝낸 할 일·회의·업무 통화 요약 가운데 아직 일기에 안 쓴 일에서 1~2개를 고르고 `text`(일기 첫 줄 제안, 60자)·`basis`(근거, 60자)만 쓴다. id(s1·s2)는 서버가 붙인다.
- **일기 원문은 AI에 보내지 않는다**(ai-server.md: 일기는 늘 제외). '이미 일기에 쓴 일'은 서버가 글자 겹침(줄 전체가 들어 있거나 낱말 60% 이상)으로만 재료에서 뺀다. 시안의 "이미 오늘 일기를 썼으면 그 내용과 겹치는 건 뺌"을 이 방식으로 지킨다.
- 가족: 가족 통화는 업무 통화 표에 없다(개인 통화함). 그 밖에 가족 낱말·가족 이름(Edge 비밀값 `FAMILY_NAME`, 없으면 낱말만) 들어간 줄은 재료에서 빼고, AI 답에 들어 있어도 버린다.
- AI 답은 믿지 않는 입력: 보낸 번호만, 같은 번호·같은 제목 한 번, HTML·제어 문자·연락처·비밀 모양·길이 초과 줄은 버린다. 답 전체가 깨지면 그 때는 저장하지 않는다(다음 열기에 다시).
- 로그에는 숫자만.

## 표 `app_home_day_picks` (migration `20261109180000_home_day_picks`)

작업공간·날짜 한 줄. `reads`(jsonb 배열 0~3)·`reads_at`·`reads_slot`(am|pm)·`news_seen_at`·`suggests`(jsonb 배열 0~2)·`suggests_at`·`suggests_done`(일기를 쓴 제안 id s1~s9, 화면 PR-C가 고침)·`run_at`·`created_at`.
owner 정책 하나(authenticated만). authenticated 읽기·넣기(`workspace_id`·`day`만)·고치기(값 칸만), 지우기 없음, anon·PUBLIC·service_role 없음.

## 화면 연결(PR-C)이 할 일

- 홈 [하루]를 열 때 오늘이면 `home_day_picks`를 부르고(구글 일정·끝낸 할 일 제목을 함께), 응답 `picks`(또는 표 읽기)를 `cleanReads`·`cleanSuggests`로 걸러 그린다.
- `suggests_done`에 든 제안은 그리지 않는다. 제안을 눌러 일기를 저장하면 그 id를 `suggests_done`에 더한다.
- 429 `monthly_limit`·`daily_limit`는 기존 한도 알림 문구로 보인다.
