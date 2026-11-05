# News 전면 개편 설계 (NEWS-전면개편 P0, S51-1)

📱 폰 경로 C(P1·P2·P4 DB 단계) — 이 문서는 설계·조사만 한다. 앱 코드·DB·Edge·워크플로 변경 없음. SQL은 부록의 읽기 전용 확인 SQL(select만)뿐이고, 적용 SQL은 각 DB PR에서 짝 파일 5개로 만든다.

- 작성: 2026-11-06, Claude Code 웹(작업 세션 S51-1, 예약 실행). 기준 main `c372f6c`(#1929).
- 요청: 요청함 11/06 01:48, 명진 결정 02:15 "1 가 2 ㅇ 3 ㅇ"(D1·D2·D3), 시안 [mockups/news-overhaul.html](mockups/news-overhaul.html)(#1929, 이견 없음).
- 표기: [사실] = 저장소 코드·migration·GitHub API로 직접 확인, [추정] = 짐작, "확인 못 함" = 이번 세션에서 확인하지 못함. 웹 세션이라 production·운영 DB에는 접근하지 않았다.
- 공개 저장소: 글 제목·사람 이름·요청함 원문 밖의 업무 내용·비밀값은 쓰지 않는다. 숫자·키·상태 코드만.

## 0. 요약과 추천

1. **수집 예약(D3)**: GitHub 예약은 지난 7일 동안 **정해진 시각에 한 번도 제때 돌지 않았다**(늘 2~5시간 늦고, 낮 13시 칸은 매일 빠짐, 매시 '채우기만'은 13번 중 1번만) [사실, 1.2]. Supabase 안 예약(pg_cron)이 **1분마다 줄(대기열)에서 일 하나씩 꺼내 Edge를 부르는**(pg_net) 구조로 옮긴다. 비밀값은 DB 금고(Vault)에서 DB 안에서 만들어 DB 밖으로 나오지 않게 하고, Edge는 그 값의 지문(해시)만 서버 표에서 읽어 맞춰 본다 → **새 비밀값 등록(명진 손) 없음**(3절). 실행 기록 표로 빠진 시각이 보인다. GitHub workflow는 schedule만 빼고 수동 실행용으로 남긴다.
2. **원문 저장(D1)**: 수집 때 글마다 **본문 문단·사진 주소·캡션**을 새 표 `app_feed_bodies`에 작업공간 소유자 비공개로 저장한다(공개·공유 없음). 매체마다 추출 규칙은 카탈로그에 두고, 못 읽은 글은 이유 코드 + 화면 '원래 사이트 ↗'(4절).
3. **사진**: 파일을 복사해 두지 않고 **주소 + 캡션만** 저장, 화면은 그 주소로 바로 보인다(https만, 리퍼러 안 보냄, 늦게 불러오기). 안 뜨면 '사진 ↗' 링크(4.5).
4. **요약·시사점 미리 만들기(D2)**: 수집 직후 같은 대기열의 '미리 만들기' 일로 기존 상세 저장 칸(`app_now_details`)을 채운다. 비용 추정 **한 달 약 1만 원**(하루 약 190건 전부 만들 때, 5절). 추천 상한 **월 1만 원**(기능 전용, 기존 `ai-assist` 15,000원과 별도). 넘으면 사회운동 → 키워드·채널 기사 → 운동 매체 → 나머지 순(5.3). **금액은 명진 확인 1번.**
5. **화면(P4)**: 시안 그대로. 메뉴 'News', 탭 [전체][사회운동][언론][보관], 문장 찾기는 위 찾기 칸, [매체: 전체 ▾], 매체 색 띠·분류 꼬리표 색, 안 읽은 글 굵게. 상세 = 요약 → 시사점 → 원문 전체(글자 3단계·사진) → 단추 줄. 폴드 펼침·PC는 목록 | 상세(할 일과 같은 `split-resize.js`).
6. **정리(P5)**: '누를 때 만들기'·'기사 먼저 읽기'는 못 만든 글 다시 만들기용으로만 남긴다. 'Now' 글자가 나오는 9곳을 News로(2절). 저장 값 `view_prefs.now_tab`은 지우지 않고 새 칸 `news_tab`으로 옮겨 읽는다.
7. **이번 세션에서 못 한 것**: 출처별 웹 실측(목록 1쪽 + 글 1개)은 **예약 실행이라 WebFetch 허락 요청에 답할 사람이 없어 25곳 모두 열지 못했다**(사이트가 막은 것이 아님) [사실]. 그래서 1.1 표의 '본문·사진' 칸은 저장소 기록(카탈로그 규칙·이전 설계 조사)만으로 채우고, 실측은 **P2 첫 커밋의 '추출 시험 실행'(서버가 출처마다 글 1개를 읽어 결과 숫자만 돌려줌)**으로 옮긴다(4.4). 운영 DB 숫자(7일 건수)는 부록 A 확인 SQL로 CC가 채운다.

## 1. 전수 조사

### 1.1 출처표 (켜질 수 있는 출처 전부 — 카탈로그 기준 [사실])

'7일 건수'는 운영 DB를 봐야 해서 부록 A-1 SQL 결과로 CC가 채운다(이 문서는 칸만 둔다). '본문'·'사진'은 저장소에 남은 기록 기준이고, 이번 세션 실측은 못 함(0절 7).

| 묶음 | 키 | 이름 | 읽는 길 | 7일 건수·마지막 오류 | 본문 추출(저장소 기록) | 사진(저장소 기록) | P2 할 일 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 노동 | `kctu` | 민주노총 | 게시판 HTML | A-1 | 흔한 본문 칸 자동(카탈로그 `bodyClass` 없음) [사실] | 확인 못 함 | 본문 칸 고정 규칙 확인 |
| 노동 | `kptu` | 공공운수노조 | 게시판 HTML, robots 예외(예약 때만) | A-1 | `publishList_write` [사실]. 글 대부분이 그림 + 한글 파일 → 그림뿐인 글은 제목만 [사실, outside-statements 1.5] | **본문이 그림인 글이 많음** → 사진 주소가 사실상 본문 | 그림뿐인 글은 사진 블록으로 보임 + 첨부 이름 줄 |
| 노동 | `kmwu` | 금속노조 | 그누보드 HTML | A-1 | 자동 [사실] | 확인 못 함 | 규칙 확인 |
| 노동 | `kfsu` | 서비스연맹 | 워드프레스 HTML | A-1 | 자동 [사실] | 확인 못 함 | 규칙 확인 |
| 노동 | `hakbi` | 학비노조 | 게시판 HTML | A-1 | 자동 [사실] | 확인 못 함 | 규칙 확인 |
| 정당 | `laborparty` | 노동당 | KBoard HTML, robots 예외 | A-1 | `kboard-content` 공용 칸 [사실, 11절] | 확인 못 함 | 규칙 확인 |
| 정당 | `kgreens` | 녹색당 | 아임웹 HTML(논평·보도자료 두 목록) | A-1 | 자동 [사실] | 확인 못 함 | 규칙 확인 |
| 정당 | `jinboparty` | 진보당 | HTML, 글 주소 바꿔 읽기(`listHref`) | A-1 | `content_box` [사실] | 확인 못 함 | — |
| 정당 | `justice` | 정의당 | 공개 텔레그램 미리보기 | A-1 | 채널 글 자체가 본문(짧음) [사실] | 채널 글 사진 있을 수 있음 [추정] | 채널 글 사진·본문 안 링크 |
| 사회운동 | `pssp` | 사회진보연대 | 그누보드 HTML(공지·성명) | A-1 | 자동 [사실] | 확인 못 함 | 규칙 확인 |
| 사회운동 | `ws` | 노동자연대 | RSS(기사 포함) | A-1 | 피드·글 쪽 [사실] | 기사 사진 많음 [추정] | 규칙 확인 |
| 사회운동 | `platformc` | 플랫폼C | 첫 화면 카드(약 0.8MB) | A-1 | 자동 [사실] | 확인 못 함 | 화면 스크립트로만 그리는지 확인 |
| 사회운동 | `leftall` | 전국결집 | 그누보드 HTML(공지 [입장]) | A-1 | 자동 [사실] | 확인 못 함 | 규칙 확인 |
| 사회운동 | `socialism` | 사회주의를향한전진 | 그누보드 HTML | A-1 | `body_content` [사실] | 확인 못 함 | — |
| 사회운동 | `socialist` | 사회주의자 | 공개 텔레그램 미리보기(사이트는 봇 확인 화면 — 풀지 않음) | A-1 | 채널 글만 [사실] | 확인 못 함 | — |
| 외국 | `jacobin` | Jacobin | RSS + 글 쪽 | A-1 | `po-bo__content` [사실]. **지금은 AI 재료로만 쓰고 버림** | 대표 사진 있음 [추정] | D1로 저장(4.6) |
| 외국 | `labornotes` | Labor Notes | RSS(본문 포함) | A-1 | 피드 본문 200자 이상이면 그것 [사실] | 확인 못 함 | 〃 |
| 외국 | `redpepper` | Red Pepper | RSS | A-1 | 자동 [사실] | 확인 못 함 | 〃 |
| 외국 | `socialistworker` | Socialist Worker | RSS | A-1 | 자동 [사실] | 확인 못 함 | 〃 |
| 언론 | `news-labortoday` | 매일노동뉴스 | RSS(전체) | A-2 | 열기(open) 때 글 쪽, 유료벽이면 리드만 [사실, `page.ts`] | 확인 못 함 | **유료 기사 비율 확인**(리드만 저장) |
| 언론 | `news-beminor` | 비마이너 | RSS(발췌) | A-2 | 열기 때 글 쪽 [사실] | 확인 못 함 | 규칙 확인 |
| 언론 | `news-pressian` | 프레시안 | RSS(https로 적음 — 열리는지 CC 확인 대기 [사실, 카탈로그 주석]) | A-2 | 열기 때 글 쪽 | 확인 못 함 | 피드가 열리는지부터 |
| 언론(외국) | `news-psi` | PSI | RSS | A-2 | 열기 때 | 확인 못 함 | 규칙 확인 |
| 언론(외국) | `news-itf` | ITF | RSS | A-2 | 열기 때 | 확인 못 함 | 규칙 확인 |
| 언론(외국) | `news-labourstart` | LabourStart(아시아) | RSS(제목 중심, 링크가 다른 매체) [추정] | A-2 | 링크가 남의 매체라 카탈로그 허용 호스트 밖 → 본문 못 읽음 [추정] | — | 제목 + '원래 사이트 ↗'만 |
| 언론 | (키워드) | 구글 뉴스 검색 | 구글 RSS | A-2 | **중계 주소라 원문을 읽지 않음**(N3 결정) [사실] | — | 제목 + '원래 사이트 ↗'만(4.3) |
| 언론 | (채널) | 텔레그램 채널 기사 | 열린 주소 규칙(https·robots·사설망 금지) | A-2 | 열기 때 글 쪽 [사실] | 확인 못 함 | 수집 때 바로 읽기로 |

- **시안에 나온 매체 중 카탈로그에 없는 것** [사실]: 한겨레·경향·민중언론참세상은 `news-catalog.ts`에 없다(3.1b '주소 확인 전'). 시안의 색 예시일 뿐이고, 넣으려면 RSS 주소를 [사실]로 확인한 뒤 카탈로그 한 줄 PR(범위 밖, 발견사항).
- 사회운동 국내 글은 이미 문장 표(`app_outside_sentences`, 6만 자 상한)에 본문을 둔다 [사실]. 그런데 **문장 단위로 쪼개 저장해 문단·사진이 사라진다** → 화면 '원문 전체'가 문단 없이 이어진 글이 되는 까닭 중 하나 [사실: 문장 표 모양].
- 뉴스는 `app_news_items.body`(10만 자, `body_kind` full/lead) 칸이 처음부터 있으나, **누를 때(open)만 채운다** [사실, `news-feed/handler.ts`]. 사진 칸은 두 표 모두 없다 [사실].

### 1.2 예약 실행 기록 (GitHub API, 10/31~11/05 UTC, schedule만)

예정: `outside-feed.yml` UTC 23:07·04:07·09:07(서울 08:07·13:07·18:07). `news-feed.yml` UTC 23:22·04:22·09:22 + 11/05 04:48(UTC)부터 매시 22분 '채우기만'(#1901) [사실].

| 서울 날짜 | 사회운동 08:07 칸 → 실제 | 13:07 칸 | 18:07 칸 → 실제 | 언론 08:22 → 실제 | 13:22 | 18:22 → 실제 |
| --- | --- | --- | --- | --- | --- | --- |
| 11/01 | 11:01 (+2시간 54분) | 빠짐 | 20:10 (+2:03) | (함수 첫 배포 전) | — | — |
| 11/02 | 11:16 (+3:09) | 빠짐 | 21:11 (+3:04) | 11:35 (+3:13) | 빠짐 | 21:34 (+3:12) |
| 11/03 | 12:53 (+4:46) | 빠짐 | 20:46 (+2:39) | 12:56 (+4:34) | 빠짐 | 21:00 (+2:38) |
| 11/04 | 11:58 (+3:51) | 빠짐 | 20:58 (+2:51) | 12:02 (+3:40) | 빠짐 | 21:15 (+2:53) |
| 11/05 | 12:21 (+4:14) | 빠짐 | 21:02 (+2:55) | 12:32 (+4:10) | 빠짐 | 21:28 (+3:06) |

- 11/05 언론 '채우기만' 매시 칸: 서울 14:22~03:22 사이 예정 13번(18:22 전체 칸 제외) 중 실제 1번(22:19, 21:22 칸이 57분 늦은 것) [사실, 11/06 03:33 KST 기준].
- 결과는 모두 success(돈 실행은 성공) [사실]. 즉 **고장이 아니라 GitHub 예약 자체가 늦고 빠진다**. GitHub 안내에도 "부하가 큰 시각에는 예약 실행이 늦거나 빠질 수 있다"고 되어 있다 [추정: 공식 문서 문구를 이번에 열어 보지 못함].
- 사회운동 쪽 수동 실행(workflow_dispatch)은 10/31·11/01 네 번, 11/05 한 번 [사실] — 빠진 것을 사람이 채운 흔적.

### 1.3 화면 길 전부 ('Now'·News로 들어가는 곳)

| 위치 | 지금 | P5에서 |
| --- | --- | --- |
| `app/menu-model.mjs:31` 메뉴 | `{id:'outside', label:'Now'}`, 옛 id `news`→`outside`(`OLD_IDS`) | 이름 'News'. **id `outside`는 그대로**(저장된 `menu_layout`이 그대로 맞음, 화면에 안 보임) |
| `app/index.html:65`(PC 위 메뉴)·`:103`(폰 메뉴) | `Now` | `News` |
| `app/topbar-actions.js:191`·`:378` 화면 이름 표(두 벌) | `outside:'Now'` | `News`(두 표 모두 — 같은 표가 두 번 있는 것은 발견사항) |
| `app/outside-statements.js:45`·`:47` 화면 제목·탭 줄 이름 | `Now`, `Now 보기` | `News`, `News 보기` |
| 라우터 `app/app-router.js:12,15`, `app/view-loader.js:189` | `?view=news`·`go('news')` → outside + [뉴스] 탭 | `?view=news`가 News **[전체]**, `?view=outside`는 별칭. 옛 [뉴스] 탭 진입은 [언론] |
| `app/basket-notes.js:453` 노트 [기사로 가기] | `go('news')` | 그 기사 상세로(언론 탭 + 글 id) |
| 알림 줄 `app/notice-outside.js:35` | '새 성명 n건' [보기] → `go('outside')` | [보기] → News [사회운동]. 'Now' 글자 없음 |
| 폰 알림 `phone-push/now-line.ts` | '새 성명 n · 새 기사 n' — **실제로 보내지는 않음**(건수만 셈) [사실] | 글자 그대로(파일 이름만 정리 후보) |
| 홈 줄·홈 위젯·폰 위젯·안드로이드·윈도 앱 | 없음 [사실] (`WidgetNow.kt`는 '지금 일정' 위젯, 이 메뉴와 무관) | 없음 |
| 업데이트 기록 `app/release-notes/*.json` | 'Now' 28번/19파일 [사실] | **고치지 않음**(지난 기록). 새 기록에 'Now → News' 한 줄 |
| `view_prefs.now_tab` | 쓰기 `outside-statements.js:320`, 읽기 `:457`·`:650`, 검사 `view-prefs.js:109,154,274`, DB 검사 `outside|news|saved|search` | 새 칸 `news_tab`(`all|movement|press|saved`)으로 옮김(7.5) |
| `view_prefs.split_ratio.now` | `mountSplitResize({name:'now'})` | 그대로(화면에 안 보이는 이름) |

### 1.4 지금 구조에서 느린 까닭 (요청함 방 조사 ② 확인)

| 단계 | 지금 [사실] | 기다림 |
| --- | --- | --- |
| 언론 글 누름 | `news-feed ?action=open`으로 글 쪽을 그때 읽음(하루 60번) | 최대 60초 |
| 상세 만들기 | `ai-assist` `now_detail` — 관심사 연관(1번) + 요약·시사점(1번), AI 한 번 30초 상한 | 화면 기다림 최대 120초 |
| 하루 40번 넘음 | `level='basic'`(연관·시사점 빔) | — |
| 사회운동 외국 글 | 본문이 없어 원문 쪽을 상세 만들 때 다시 읽음 | 위에 더해짐 |

### 1.5 AI 사용량 기록의 틈 (발견사항, 사실)

- 홈 'AI 사용량'(`drive-summary/ai-usage.mjs`)은 `app_ai_daily_usage`·`app_feed_days`·`app_ai_external_usage`만 더한다 → **`news-feed`의 `app_news_days`가 빠져 있다**.
- `outside-feed`는 요약·외국 소개에 AI를 부르지만 **사용량을 어디에도 적지 않고 한 달 상한도 없다**.
- P3에서 두 틈을 함께 막는다(5.4).

## 2. 결정 반영 한눈에

| 결정 | 바뀌는 옛 결정 | 새 모양 |
| --- | --- | --- |
| D1 가: 수집 때 본문·사진 저장 | news-clipping 0절 4·5절 '기사 본문은 저장하지 않는다', outside-statements 2절 '외국 글 본문 저장 안 함'·Q6 | 모든 출처 본문(문단)·사진 주소·캡션을 `app_feed_bodies`에 소유자 비공개 저장. **전문 번역은 여전히 누를 때만**(`body_ko`, news-clipping 10절 규칙 그대로) |
| D2: 수집 때 요약·시사점 미리 | outside-statements 12.5 '처음 열 때 한 번' | 수집 직후 대기열 '미리 만들기' 일. 한 달 상한·우선순위. 누를 때 만들기는 못 만든 글만 |
| D3: Supabase 예약 | outside-statements 3.4, news-clipping 2.3·7절 '예약 workflow' | pg_cron + pg_net 대기열. GitHub workflow는 수동 실행용(schedule 뺌) |
| 시안 | outside-statements 12.1 탭 넷([사회운동][뉴스][보관][문장 찾기]) | [전체][사회운동][언론][보관] + 위 찾기 칸 |

## 3. P1 수집 예약 옮기기 (DB + Edge 작은 고침)

### 3.1 모양

```
pg_cron (DB 안 시계, postgres 역할로 실행)
 ├ 08:07·13:07·18:07 KST  → private.app_feed_enqueue('outside')   : 실행 1줄 + '계획' 일 1개
 ├ 08:22·13:22·18:22 KST  → private.app_feed_enqueue('news')      : 실행 1줄 + '계획' 일 1개
 ├ 그 밖 매시 22분          → private.app_feed_enqueue('news_fill') : '대기 기사'·'외국 제목' 일 2개
 └ 1분마다                 → ① 받은 응답 정리(net._http_response → 일 결과·다음 일 만들기)
                             ② 꺼낼 일 하나(같은 수집기에 '보냄' 상태 일이 없을 때만)
                                → net.http_post(Edge, 헤더 = 금고 비밀값, 시간 상한 150초)
```

- **'계획' 일의 응답으로 다음 일을 만든다**: Edge `run_plan`이 돌려주는 단체·매체 키 목록(지금 스크립트가 받는 것과 같음)으로 키마다 `run` 일을 줄에 넣는다. 카탈로그·켬 판단은 지금처럼 Edge에 둔다(DB가 카탈로그를 따로 알지 않음 — 두 벌 금지).
- 언론 일 순서는 지금 `scripts/ops/news-feed.mjs`와 같다: 계획 → 매체마다 media → keywords → pending → titles → prune(+ P3의 details).
- 한 번에 하나씩, 1분 간격 → 사회운동 19곳이면 한 칸이 약 20분 [추정]. 지금 GitHub 실행(한 번에 몰아 2~3분)보다 길지만 정해진 시각에 **시작**한다.
- 일마다 3번까지 다시 시도(5xx·시간 초과만), 401·4xx는 바로 실패. 한 칸이 2시간 안에 안 끝나면 남은 일은 '늦음'으로 닫는다(다음 칸과 겹치지 않게).
- pg_net 응답 기록(`net._http_response`)은 몇 시간 뒤 지워진다 [추정: 기본 6시간] → 1분마다 정리해 우리 표로 옮긴다. 응답에서 **건수·상태 코드·단계 코드만** 꺼낸다(제목·주소 없음 — 지금 스크립트와 같은 검사).

### 3.2 비밀값 — 새 등록 없이 (추천 '나')

| 길 | 명진 손 | 위험 |
| --- | --- | --- |
| 가. 지금 비밀값(`OUTSIDE_FEED_CRON_SECRET`·`NEWS_FEED_CRON_SECRET`)을 금고에도 넣기 | GitHub·Edge 비밀값은 다시 볼 수 없어 **새 값으로 바꿔 세 곳(GitHub·Edge·금고)에 붙여 넣기** | 값이 사람 손·화면을 거침 |
| **나. DB가 금고에서 새 값을 스스로 만들고, Edge는 지문만 확인** | **없음** | 값이 DB 밖으로 나가지 않음(Edge로 가는 요청 헤더에만) |

나안 자세히:
1. SQL Editor(3.4 ②)에서 `vault.create_secret(<DB 안에서 만든 무작위 32바이트>, 'web2_feed_cron')` — 값은 화면에 찍지 않는다(select로 돌려받지 않음).
2. 같은 자리에서 그 값의 SHA-256 지문만 새 표 `public.app_cron_keys`(`name`, `secret_sha256`)에 넣는다. 이 표는 RLS 켬·정책 없음·`authenticated`·`anon` 권한 없음, `service_role` 읽기만(`app_operator_features`와 같은 모양).
3. pg_cron 명령은 postgres 역할로 돌므로 `vault.decrypted_secrets`에서 값을 읽어 헤더에 넣는다(함수 없이 예약 명령 안에서만 — SECURITY DEFINER 함수를 만들지 않음).
4. Edge(`outside-feed`·`news-feed`)의 예약 입구는 **지금 비밀값 비교를 그대로 두고**, 하나 더: 헤더 값의 SHA-256을 service role로 `app_cron_keys`에서 읽은 지문과 고정 길이 비교. 둘 중 하나 맞으면 통과(GitHub 수동 실행은 지금 비밀값으로 계속 됨). 두 입구 열쇠가 섞이면 401은 그대로.
5. 바꾸기(회전): 금고 값 새로 + 지문 새로, SQL 두 줄. 명진 손 없음.

- 보안 확인: 지문 표는 화면(authenticated)이 못 읽는다. 지문만 알아서는 헤더를 못 만든다(SHA-256 역산 불가). Edge 비교는 고정 길이. 로그에 값·지문 안 찍음.

### 3.3 DB 표 (P1a migration — 승인형 workflow로 가능한 부분)

| 표 | 칸(요지) | 권한 |
| --- | --- | --- |
| `public.app_cron_keys` | `name`(기본 키, `web2_feed_cron`), `secret_sha256`(64자 16진), `updated_at` | RLS 켬, 정책 없음, `service_role` select만 |
| `public.app_feed_runs` | `id`, `feed`(`outside|news|news_fill`), `slot_at`(예정 시각), `started_at`, `finished_at`, `state`(`running|done|partial|late|failed`), `jobs_total`·`jobs_ok`·`jobs_failed` | RLS 켬, 정책 없음, `service_role` select만(CC는 읽기 SQL로 봄) |
| `public.app_feed_jobs` | `id`, `run_id`, `seq`, `action`(`run_plan|run`), `body` jsonb(키·step만, 200바이트 안쪽 검사), `state`(`queued|sent|ok|failed|late`), `tries`, `request_id` bigint, `sent_at`, `done_at`, `http_status`, `result` jsonb(건수·코드만, 검사), `error_code` | 같음 |
| 함수 `private.app_feed_enqueue(text)`·`private.app_feed_claim(text)` | INVOKER, `search_path=''`, 순수 SQL(실행 줄·일 줄 넣기, 다음 일 하나 '보냄'으로 바꿔 돌려주기) | PUBLIC·anon·authenticated 실행권 회수(예약 명령은 postgres) |

- 워크스페이스 칸이 없다: 한 실행이 모든 작업공간을 함께 읽는 지금 구조 그대로(누구 작업공간에 넣을지는 Edge가 표로 정함).
- 크기: 실행 줄 하루 약 24개, 일 줄 하루 약 100개 [추정]. 30일 지난 줄은 1분 정리 명령이 지운다.

### 3.4 적용 순서와 되돌리기

| 순서 | 무엇 | 길 | 되돌리기 |
| --- | --- | --- | --- |
| ① P1a DB | 3.3 표·함수 + 짝 파일 5개 + 실제 PostgreSQL 시험 | 승인형 DB workflow(시험 적용 먼저) | rollback SQL(표·함수 지움, 다른 표 영향 없음) |
| ② P1b SQL Editor | (1) 확장 켜기 `pg_cron`·`pg_net`(금고 `supabase_vault`는 켜져 있는지 확인만) (2) 금고 값·지문 넣기 (3) `cron.schedule` 4개(이름 앞머리 `web2_feed_`) + schema_migrations 1줄 | **승인형 workflow가 확장·`cron`·`net`·`vault` 문을 막으므로**(`docs/ops-db-workflow.md` 차단 목록) §7 SQL Editor 길 또는 폰 경로 C. CC가 브라우저로, 안 되면 명진 4단계 | `cron.unschedule('web2_feed_…')` 4줄 + 금고 값·지문 지움. 확장은 끄지 않고 둠(읽생기와 같은 DB — 끄기는 따로 판단) |
| ③ P1c Edge | `outside-feed`·`news-feed` 예약 입구에 지문 비교 추가 + 시험(지문 맞음·틀림·섞임·지문 표 없음) | Edge workflow, 한 번에 하나, 되돌리기 ref 기록 | 이전 ref 재배포 |
| ④ 같은 PR | `outside-feed.yml`·`news-feed.yml`에서 `schedule:`만 뺌(수동 실행 남김) + 이 문서 결과 칸 | ③ 뒤, 첫 DB 예약 칸이 제대로 돈 것을 실행 기록으로 확인한 뒤 merge | schedule 되살리는 커밋 |

- **③ 결과(S51-4, PR 코드만 — 배포 전)**: 공용 `_shared/cron-key.ts`(새 파일)로 `outside-feed`·`news-feed` 예약 입구에 지문 길을 더함. 지금 비밀값이 틀릴 때만 service role로 `app_cron_keys`(`web2_feed_cron`)를 읽어 고정 길이 비교, 행 없음·읽기 실패는 지문 길만 실패. 시험 `tests/security/feed-cron-key.test.mjs`. 배포는 CC가 Edge workflow로 한 번에 하나(되돌리기 ref 기록).
- 순서 까닭: ③ 전에 ②의 예약이 돌면 모두 401이 된다 → **② (3) `cron.schedule`은 ③ 배포 확인 뒤**. ②를 (1)(2)와 (3)으로 나눠 실행해도 된다.
- **확인 필요 [확인 못 함]**: 운영 DB에 `pg_cron`·`pg_net`·`supabase_vault`가 이미 켜져 있는지(부록 A-4). 읽생기가 이미 쓰고 있으면 켤 필요가 없고, 없으면 켜는 것이 읽생기에 영향이 없는지 CC가 한 줄 보고. pg_net의 시간 상한(기본 5초)을 150초로 줘도 Edge 쪽 실행이 끝까지 가는지는 첫 실행 기록으로 확인 [추정: Edge는 요청을 끝까지 처리].

## 4. P2 본문·사진 저장 (DB + Edge)

### 4.1 표 `public.app_feed_bodies` (P2a migration)

| 칸 | 내용 |
| --- | --- |
| `id`, `workspace_id` | 소유 작업공간 |
| `outside_post_id` / `news_item_id` | 둘 중 하나만(검사), 글이 지워지면 함께 지워짐(외래 키 cascade), 글마다 한 줄(유일) |
| `blocks` jsonb | 차례대로 `{t:'p', text}`·`{t:'h', text}`·`{t:'quote', text}`·`{t:'img', src, cap, alt}` — 블록 400개·글자 합 10만 자·사진 20개·`src`는 `https://` 2000자·`cap` 300자(DB 검사) |
| `state` | `ok`(본문 있음)·`lead`(유료벽 등 앞부분만)·`image_only`(그림·첨부뿐)·`failed` |
| `reason` | 못 읽은 까닭 코드: `robots`·`bot_check`·`paywall`·`too_big`·`timeout`·`http_4xx`·`http_5xx`·`no_body`·`off_host`(허용 호스트 밖)·`relay`(구글 중계) |
| `rule` | 쓴 추출 규칙 이름·판(예: `kptu@2`) — 규칙을 고치면 다시 뽑을 글을 고르는 데 씀 |
| `chars`, `images`, `extracted_at` | 숫자·시각 |

- 권한: RLS 켬, `private.app_is_workspace_owner(workspace_id)` select 정책(authenticated), 쓰기는 service role만, anon·PUBLIC 없음. 기존 표는 건드리지 않는다(`grant-existing` 회피 — 새 표).
- 지금 칸과의 관계: 화면 '원문 전체'는 이 표만 읽는다. 사회운동 국내 글의 문장 표(문장 찾기용)와 뉴스 `body`(AI 재료·번역 재료)는 **같은 추출 결과에서 함께 쓴다**(한 번 뽑아 세 곳 — 화면용 블록 / 찾기용 문장 / AI용 글자). 외국 사회운동 글의 문장 행 금지(`lang='ko'` 검사)는 그대로 두고 블록만 저장한다.
- 2년 지난 사회운동 글: 문장과 함께 블록도 지운다(Q7 그대로). 언론 매체 글 30일·키워드 180일 정리(N6)도 cascade로 함께.
- 크기 [추정]: 하루 약 190건 × 평균 6KB ≈ 1.1MB/일, 1년 약 0.4GB 상한 쪽(매체 30일 정리로 실제는 훨씬 작음). 부록 A-3로 실제 평균 확인.

### 4.2 매체별 추출 규칙 카탈로그

- 자리: 지금 카탈로그(`_shared/outside-catalog.ts`·`news-catalog.ts`)의 출처 한 줄에 `extract` 칸을 더한다(새 파일 두지 않음): `body`(본문 칸 class 정규식 — 지금 `bodyClass`를 옮김), `drop`(빼는 칸: 공유·관련 기사·광고·기자 소개), `images`(본문 안 그림만, 아이콘·로고·1px 제외 규칙), `caption`(`figcaption`·매체별 캡션 칸), `lead`(유료벽 표시), `version`.
- 공용 추출기 `_shared/feed-extract.ts`(순수 함수): HTML → 블록. 지금 `extractBody`(`_shared/feed-fetch.ts`)를 바탕으로 문단 경계를 남기도록 넓힌다. 글자만 뽑고 HTML은 저장하지 않는다(화면은 글자·주소로만 그림 — 지금 보안 원칙 그대로).
- 시험: 출처마다 줄인 견본 HTML(가짜 글·`example.com`, 본문 넣지 않음 — 지금 원칙)로 블록 모양 고정. **모든 켜진 출처 전수**.

### 4.3 못 읽는 글

| 경우 | 저장 | 화면 |
| --- | --- | --- |
| 구글 뉴스 키워드 기사(중계 주소) | `failed`/`relay` | 제목 + 요약(재료가 제목뿐이면 요약 없음) + '원래 사이트 ↗' |
| LabourStart 등 링크가 허용 호스트 밖 | `failed`/`off_host` | 같음 |
| robots·봇 확인 | `failed`/`robots`·`bot_check` | '사이트가 자동 읽기를 막아 둠' + ↗ |
| 유료벽 | `lead`/`paywall` | 앞부분 + '나머지는 원래 사이트 ↗' |
| 그림·한글 파일뿐(공공운수노조 다수) | `image_only` | 사진 블록 + 첨부 이름 + ↗ |

### 4.4 첫 커밋: 추출 시험 실행 (0절 7의 실측 대신)

- `outside-feed`·`news-feed` 예약 입구에 `probe`(지문 열쇠만, 화면 입구 없음): 출처 키 하나를 받아 목록 1쪽 + 최신 글 1개를 읽고 **숫자만** 돌려줌 — 목록 HTTP·글 HTTP·블록 수·글자 수·사진 수·캡션 수·쓴 규칙·실패 코드. 제목·주소·본문은 돌려주지 않는다. 저장하지 않는다.
- CC가 배포 뒤 출처마다 한 번씩 불러 1.1 표를 [사실]로 채우고, 규칙이 모자란 출처만 P2b에서 고친다.

### 4.5 사진: 주소만 vs 파일 복사 (추천: 주소 + 캡션만)

| | 가. 주소 + 캡션만 저장, 화면이 주소로 보임 (**추천**) | 나. 사진 파일을 우리 저장소에 복사 |
| --- | --- | --- |
| 저작권 | 사진을 복제하지 않음 — 원래 사이트 사진을 그 자리에서 띄우는 것 | 사진을 복제해 둠 — 기사 사진은 대부분 저작물이라 위험이 더 큼(비공개라도) |
| 용량 | 거의 0(주소 글자뿐) | 글 하나 사진 1~5장 × 수백 KB → 한 달 수 GB [추정], Supabase 저장 비용 |
| 사진이 사라지면 | 안 뜸 → '사진 ↗' 링크 | 남아 있음 |
| 사이트가 남의 사이트 표시를 막으면 | 안 뜰 수 있음(리퍼러를 안 보내면 대부분 뜸 [추정]) | 늘 뜸 |
| 원래 사이트가 아는 것 | 명진 기기가 사진을 불러온 사실(글을 열었을 때만) | 없음 |

- 화면 규칙: `https://`만, `referrerpolicy="no-referrer"`, `loading="lazy"`, 크기 상한(폭 100%), 글을 열었을 때만 불러옴. Web2 앱에는 사진 주소를 막는 보안 규칙(CSP)이 없다 [사실] → 바꿀 것 없음.
- 나중 선택: 특정 매체가 사진을 막으면 '서버가 대신 받아 그 자리에서만 전달(저장 안 함)'하는 Edge 길을 따로 설계(지금은 안 만듦).

### 4.6 외국 글 본문 저장 (D1에 따른 바뀜)

- Jacobin 등 외국 글은 지금 '본문 저장 안 함'(Jacobin 이용 조건: 번역은 사전 허가) [사실]. D1(가)은 출처를 가리지 않으므로 **원문 그대로(영어) 비공개 저장**으로 바꾼다. **전문 번역 저장은 여전히 하지 않고**, 누를 때 [번역]만(지금 뉴스와 같음). 공개 경로로 다시 내보내는 길 없음.
- 혹시 외국 사회운동 매체는 예전처럼 요약만 원하면 카탈로그 `extract: false` 한 칸으로 끌 수 있다(명진 확인 M3).

### 4.7 수집 흐름 바뀜

- `outside-feed` `run`: 지금도 글 쪽을 읽어 본문을 뽑는다 → 같은 자리에서 블록도 저장(추가 요청 없음).
- `news-feed` `media`·`pending`: 지금은 피드만 읽고 글 쪽은 누를 때(open) → **수집 때 새 글마다 글 쪽 1번**(요청 사이 2초, 한 실행 예산 100초 안, 남은 것은 다음 '대기 기사' 일로). 요청 수: 매체 글 하루 약 120건 [추정]이 늘어나는 몫. 사이트마다 한 번에 30건 상한 그대로.
- AI 재료는 저장된 블록 글자에서(다시 읽지 않음).

### 4.8 PR·적용 순서

| 순서 | PR | 정지 |
| --- | --- | --- |
| P2a | DB `app_feed_bodies` + 짝 파일 5개 + 권한 시험 | ★DB 적용★(승인형 workflow, 시험 적용 먼저) |
| P2b | Edge 공용 추출기 + 카탈로그 `extract` + `probe` + 두 수집 함수 저장 + 출처 전수 시험 | ★Edge 배포★ `outside-feed` → 확인 → `news-feed`(한 번에 하나, 되돌리기 ref) |
| P2c | 이미 들어간 최근 30일 글 다시 뽑기(일 줄에 `refill` 일, 사이트마다 하루 20건씩) | 운영 데이터 더하기만(지우지 않음), 실행 전 건수 한 줄 보고 |

- 되돌리기: Edge 이전 ref 재배포 → 블록 저장이 멈출 뿐 기존 화면은 그대로. 표는 rollback SQL로 지움(다른 표 영향 없음).

## 5. P3 요약·시사점 미리 만들기 + AI 비용

### 5.1 근거 숫자 (추정 — 부록 A-1·A-2로 고침)

| 묶음 | 하루 새 글(추정) | 근거 |
| --- | --- | --- |
| 사회운동 국내 15곳 | 약 20 | 단체마다 하루 0~3건 |
| 사회운동 외국 4곳 | 약 8 | 매체마다 하루 1~3건 |
| 운동 매체(매일노동뉴스·비마이너·프레시안) | 약 100 | 전체 RSS(프레시안·매일노동뉴스가 대부분) |
| 외국 노조 매체(PSI·ITF·LabourStart) | 약 15 | |
| 키워드 기사 | 약 30 | 하루 30건 상한 [사실, `KEYWORD_ITEMS_DAILY`] |
| 채널 기사 | 약 15 | |
| **합계** | **약 190** | |

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 단가 | 입력 100만 토큰 140원 · 출력 700원 | `_shared/ai-model.ts` 기본값 [사실]. 운영 모델은 비밀값 `WEB2_AI_MODEL`이 먼저라 실제 단가는 확인 못 함 |
| 글 하나 입력 | 약 6,000 토큰 | 본문 재료 6,000자(지금 상한 [사실]) ≈ 4,500 + 지시·관심 주제·내 업무 이름 ≈ 1,500 |
| 글 하나 출력 | 약 1,200 토큰 | 지금 상한 1,600(생각 몫 포함) [사실]의 평균 쪽 |
| 글 하나 비용 | 6,000×140 + 1,200×700 = **약 1.7원** | |
| 하루(190건 전부) | 약 320원 | |
| **한 달(30일)** | **약 9,600원** | |

- AI를 부르지 않는 글: 본문 60자 미만(제목만) — 키워드 기사 다수가 여기 해당해 실제는 더 적을 것 [추정].
- 한 번에 묶어 부르기(글 5개를 한 요청)는 지시 몫이 줄어 10~20% 싸지지만, 한 글 실패가 묶음 전체를 다시 부르게 해 추천하지 않는다.

### 5.2 상한 후보 (명진 확인 M1)

| 한 달 상한 | 하루 몫 | 미리 만들어지는 글 |
| --- | --- | --- |
| 5,000원 | 약 165원 | 약 100건/일 — 사회운동 전부 + 키워드·채널 + 운동 매체 절반 |
| **10,000원(추천)** | 약 330원 | 거의 전부 |
| 15,000원 | 약 500원 | 전부 + 다시 만들기 여유 |

- 기존 `ai-assist` 월 15,000원(다른 기능과 함께 씀)과 **따로** 둔다(미리 만들기가 다른 기능 몫을 먹지 않게).

### 5.3 순서·하루 몫

- 하루 몫 = (상한 − 이번 달 쓴 돈) ÷ 남은 날. 하루 몫 안에서 아래 순서로 만든다:
  1. 사회운동 국내 글(성명·논평)
  2. 키워드에 걸린 기사·채널 기사(명진이 고른 것)
  3. 관심 주제(확정)에 걸린 글
  4. 운동 매체 글
  5. 외국 글·나머지
- 몫이 남지 않은 글은 '요약 준비 안 됨'으로 두고, 누르면 지금처럼 그때 만든다(P5에서 그 길만 남김). 다음 날 몫이 남으면 최근 3일 안 글을 이어서 만든다.

### 5.4 구조

- 일: 대기열 일 `details`(사회운동·언론 각 실행 끝에 1개, 한 번에 글 20개, 예산 100초). 수집 함수(`outside-feed`·`news-feed`)가 예약 입구로 받는다 — `ai-assist`에 예약 입구를 새로 열지 않는다(사용자 로그인 전용 경계 그대로).
- 코드: 지금 `ai-assist/now-detail.ts`의 재료 모으기·지시·모양 검사를 `_shared/now-detail-build.ts`로 옮겨 세 곳(ai-assist 누를 때·두 수집 함수 미리)이 함께 쓴다(복사 금지). 옮긴 뒤 `ai-assist`도 같은 소스로 재배포.
- 저장: 기존 `app_now_details`(service role 넣기 권한 이미 있음 [사실]) — 새 칸 없음. 분류 꼬리표용 `topic`만 7.3에서 따로.
- 사용량: 새 표 `app_feed_ai_days`(`workspace_id`·`day`·`feature`(`outside_summary|news_summary|prebuild`)·요청·입력·출력 토큰·원) — `outside-feed`의 기록 없음(1.5)도 여기로. 홈 'AI 사용량'(`drive-summary ai_usage`)이 이 표와 빠져 있던 `app_news_days`를 함께 더한다.
- 내 기록을 AI에 보내는 규칙은 지금 그대로(이름·제목만, 본문·비밀 메모 없음).

### 5.5 PR·적용 순서

| 순서 | PR | 정지 |
| --- | --- | --- |
| P3a | DB `app_feed_ai_days`(+7.3 `topic` 칸을 함께 넣을지 CC 판단) | ★DB 적용★ |
| P3b | `_shared/now-detail-build.ts` 옮기기(동작 같음, 기존 시험 통과) | ★`ai-assist` 재배포★ |
| P3c | 두 수집 함수 `details` 일 + 상한·순서 + 사용량 기록 + `drive-summary` 합산 | ★Edge 배포★ 셋 차례로 |

## 6. P4 화면 (시안 그대로)

### 6.1 목록

- 메뉴·제목 'News'. 탭 **[전체][사회운동][언론][보관]** — 폰은 아래 떠 있는 탭 줄(01:25 탭 자리 규칙), 폴드 펼침은 오른쪽 아래, PC는 위. 좌우 밀기 = 탭 이동.
- 위 찾기 칸 하나 'News 찾기 — 제목·문장': 제목은 화면 목록에서, 문장은 지금 `app_outside_search`(+비슷한 말 `expand`, 내 성명)로. [문장 찾기] 탭은 없어지고 그 칸(`app/outside-search.js`)을 결과 칸으로 다시 쓴다.
- [매체: 전체 ▾]: 자료실 분류 창과 같은 부품(`app/library-move-picker.js` `createMovePicker`) — 묶음(노동·정당·사회운동·외국·언론 국내·언론 외국) 아래 매체. 지금 칩 줄(`chip-rows.js`)은 이 화면에서 뺀다. 매체 켜고 끄기는 ⋯ 그대로.
- 줄: 날짜 묶음 머리 → 흰 상자 안 줄. 줄 왼쪽 **매체 색 띠** + 매체 이름 같은 색 + **분류 꼬리표**(노동·정치·국제·성명) + 시각 + 별표. 안 읽은 글 굵게, 읽은 글 흐리게. 요약 줄은 목록에서 빼고(시안: 제목 중심) 상세에서.
- 색: 매체 색은 묶음마다 색 계열 하나(노동=붉은 갈색, 정당=청록, 사회운동=보라, 외국=회색, 언론=파랑·초록 계열) 안에서 매체마다 톤다운 한 칸 — 표는 순수 모듈 하나(`app/news-colors.mjs`)에만, 테마 토큰으로(다크 모드 함께). 분류 꼬리표 4색도 같은 모듈.

### 6.2 상세

- 위에서 아래: 꼬리 줄(매체·분류·날짜·글쓴이) → 제목 → **요약**(미리 만든 것, '수집 때 미리' 작은 글) → **시사점** → **원문 전체**(블록: 문단·사진·캡션, 글자 크기 [가 가 가] 3단계 — 서버 저장 `view_prefs`) → [☆ 별표][보관][메모][관심 없음] … [원래 사이트 ↗].
- 미리 만든 것이 없으면 요약·시사점 자리에 '아직 만들지 않음 [지금 만들기]'(P5의 남는 길). 기다림 표시는 그 칸에만, 원문은 먼저 보인다.
- '주요 문장'·'나와의 연관'·'함께 볼 것'(지금 12.4)은 시안에 없다 → 시사점 칸 안 줄로 접어 넣는다(시사점 = 운동 시사점 + 나와의 연관 한 줄). 함께 볼 것은 원문 아래 접기. 명진이 시안에서 이견 없었으므로 이대로 [추정 — 빼라는 뜻이면 M4].
- 폰: 누르면 전체 화면 상세, 뒤로 키 = 목록(주소 해시에 글 id). 폴드 펼침·PC: 왼쪽 목록 | 오른쪽 상세 — 할 일과 같은 `app/split-resize.js`(`mountSplitResize`, 지금 `name:'now'`).

### 6.3 새로 필요한 서버 자료 (발견: 시안에 있는데 지금 없는 것)

| 시안 | 지금 [사실] | 설계 |
| --- | --- | --- |
| 분류 꼬리표(노동·정치·국제·성명) | 없음. 사회운동은 `kind`(성명·논평·보도자료·글)만, 언론은 분류 없음 | 성명 = `kind`가 성명·논평·보도자료. 국제 = 외국 글. 노동·정치 = 미리 만들기 때 AI가 고르는 `topic`(노동·정치·경제·사회 중 하나) → `app_now_details.topic` 칸(P3a, 기존 표에 칸 더하기 — 확장 규칙 `ALTER TABLE` 허용 범위인지 CC 확인) 또는 새 작은 표 |
| 안 읽은/읽은 | 없음(로컬 저장 금지라 기기 기억도 안 됨) | 새 표 `app_feed_reads`(`workspace_id`, 글 id 둘 중 하나, `read_at`) — 소유자 RLS, 화면 넣기·읽기. 상세를 열면 읽음. 환류 기록(`app_now_signals`, 180일 지움)과 섞지 않음 |
| 글자 크기 3단계 | 없음 | `view_prefs.news_font`(`s|m|l`) — 7.5 DB 검사와 함께 |

### 6.4 PR

| 순서 | PR | 파일(겹침) | 정지 |
| --- | --- | --- | --- |
| P4a | DB `app_feed_reads` + `view_prefs` 검사에 `news_tab`·`news_font` | migration | ★DB 적용★ |
| P4b | 목록: 탭 넷·찾기 칸·매체 드롭다운·색·읽음 | `app/outside-statements.js`·`news-clipping.js`·`now-model.mjs`·`now.css`·`outside-statements.css`·`outside-search.js`·`view-prefs.js`·새 `news-colors.mjs` + 업데이트 기록 | — |
| P4c | 상세: 순서·원문 블록·사진·글자 크기·두 칸 | `app/now-detail.js`·`now.css`·`split-resize.js`(부르기만) + 업데이트 기록 | P2·P3 배포 뒤 |

- P4b·P4c는 같은 파일(`now.css`)을 만져 줄 세운다(P4b → P4c). 모바일(갤럭시 폴드 접음·펼침)·PC E2E 시험 함께.

## 7. P5 정리·이름 바꾸기

### 7.1 남기는 길·없애는 길

| 길 | P5 뒤 |
| --- | --- |
| `ai-assist` `now_detail`(누를 때 만들기) | **남김** — 미리 못 만든 글의 [지금 만들기]·관심사 바뀐 뒤 연관 다시 만들기만. 화면이 자동으로 부르지 않음 |
| `news-feed ?action=open`(누를 때 기사 읽기) | **남김** — 블록이 `failed`(일시 오류)인 글의 [다시 읽기]만. 화면이 자동으로 부르지 않음 |
| `outside-feed ?action=read_now`(단체 켜면 바로 읽기) | 그대로(켜자마자 보이게) |
| [문장 찾기] 탭 | 탭 없앰, 위 찾기 칸으로(칸 부품은 다시 씀) |
| 칩 줄(사회운동 묶음·단체 칩, 뉴스 채널·자동·별표 칩) | 이 화면에서 뺌, 매체 드롭다운으로. 공용 `chip-rows.js`는 다른 화면이 쓰므로 그대로 |
| GitHub workflow schedule | P1에서 이미 뺌 |

### 7.2 'Now' → 'News' 전수 (1.3 표)

- 고침: 메뉴 두 곳, 화면 이름 표 두 곳, 화면 제목·탭 줄 이름, 라우터 별칭(`news` = 정식, `outside` = 별칭), 노트 [기사로 가기].
- 안 고침: 메뉴 id `outside`·`split_ratio.now`·파일 이름(`now-*.js`·`outside-*.js`)·Edge 이름(`outside-feed`·`news-feed`)·표 이름 — 화면에 안 보이고, 바꾸면 저장 값·배포 이름이 갈라진다. 지난 업데이트 기록 28곳도 그대로.
- 시험: 화면에 보이는 'Now' 글자가 남지 않았는지(`tests/`에 글자 검사 한 개 — 업데이트 기록 폴더는 빼고).

### 7.3 저장 값 옮기기 (`view_prefs.now_tab` → `news_tab`)

| 옛 `now_tab` | 새 `news_tab` |
| --- | --- |
| `outside` | `movement` |
| `news` | `press` |
| `saved` | `saved` |
| `search` | `all` |
| 없음 | `all` |

- 화면이 읽을 때 `news_tab`이 없으면 `now_tab`을 위 표로 바꿔 쓰고, 탭을 바꾸면 `news_tab`에 쓴다(서버). 옛 `now_tab` 값은 **지우지 않는다**(데이터 보존 — DB 검사에서 옛 값 허용도 그대로). 일괄 고침 SQL 없음.

## 8. 전체 줄 세우기 (DB version은 그 PR을 시작할 때의 시각으로, 아래 차례만 지킴)

| 차례 | PR | DB version(차례) | 앞에 필요한 것 |
| --- | --- | --- | --- |
| 1 | **P0 이 문서** | — | — |
| 2 | P1a DB 예약 표 | 1번째 | 부록 A-4 확장 확인 |
| 3 | P1c Edge 지문 열쇠 | — | 2 |
| 4 | P1b SQL Editor 확장·금고·예약 | 2번째(기록 1줄) | 3 배포 확인 |
| 5 | P1d workflow schedule 빼기 | — | 4의 첫 칸들 실행 기록 확인 |
| 6 | P2a DB 본문 표 | 3번째 | — (2~5와 나란히 가능) |
| 7 | P2b Edge 추출·`probe` | — | 6, 3(같은 함수 — 3 뒤) |
| 8 | P2c 최근 30일 다시 뽑기 | — | 7 + probe 결과 |
| 9 | P3a DB AI 사용량(+`topic`) | 4번째 | — |
| 10 | P3b 공용 상세 코드 옮기기 | — | 9 |
| 11 | P3c 미리 만들기 | — | 7·10 |
| 12 | P4a DB 읽음·화면 설정 | 5번째 | — |
| 13 | P4b 목록 화면 | — | 12 |
| 14 | P4c 상세 화면 | — | 8·11·13 |
| 15 | P5 정리·이름 | — | 14 |

- Edge `outside-feed`·`news-feed`는 3·7·11에서 세 번 고쳐진다 → 같은 함수를 만지는 PR은 반드시 앞뒤로(동시 세션 금지).
- 완료 기준(요청 그대로): 명진 폰·폴드·PC에서 News 목록이 매체·분류 색으로 구분되고, 글을 누르면 기다림 없이 요약·시사점·원문 전체(사진 포함)가 한 화면에, 사회운동·언론 수집이 정해진 시각에 빠짐없이 돈다(실행 기록 표로 확인).

## 9. 보안 확인

- 인증·RLS·권한을 넓히지 않는다: 새 표는 모두 RLS 켬 + 소유자 정책 또는 정책 없음(service role만). anon·PUBLIC 권한·SECURITY DEFINER 함수 없음.
- 예약 열쇠: 값은 DB 금고 안에서 만들어 사람·화면·로그를 거치지 않음. Edge는 지문만, 고정 길이 비교. 지금 비밀값 입구도 그대로.
- 읽는 주소 경계 그대로: 카탈로그 허용 호스트 / 채널 기사 열린 주소 규칙. 사진 주소는 **저장만** 하고 서버가 받으러 가지 않는다(화면이 띄움, https만).
- 본문 저장은 작업공간 소유자 비공개. Web1·공유 링크·공개 저장소로 내보내는 길 없음. 로그·PR·보고에는 건수·키·코드만.
- 외부 입력 → 외부 행동 자동 연결 없음(읽기·저장·AI 요약까지만).
- robots·봇 확인·유료벽을 넘지 않는다(예외는 지금 두 곳 그대로).

## 10. 명진 확인 (일상어)

| 번호 | 질문 | 추천 |
| --- | --- | --- |
| **M1** | 요약·시사점을 미리 만드는 데 한 달 얼마까지 쓸까요? (하루 약 190건 전부 만들면 한 달 약 1만 원 예상) | **월 1만 원** — 넘으면 사회운동 글부터, 나머지는 누를 때 만들기 |
| M2 | 사진은 파일을 따로 복사해 두지 않고, 원래 사이트 사진을 그 자리에서 띄우기만 할까요? (용량 0, 저작권 위험 작음, 대신 사이트가 사진을 지우면 안 보임) | 예 |
| M3 | Jacobin 같은 외국 매체도 원문(영어)을 저장해 한 화면에서 보이게 할까요? 번역은 지금처럼 누를 때만 | 예(D1 그대로) |
| M4 | 상세에서 '주요 문장'·'함께 볼 것'은 시안처럼 따로 칸을 두지 않고 시사점 안·원문 아래 접기로 넣을까요? | 예 |

- M1만 꼭 답이 필요하다. M2~M4는 답이 없으면 추천대로 간다.

## 부록 A. 읽기 전용 확인 SQL (CC 실행 — 숫자·날짜만, 제목 없음)

```sql
-- A-1 사회운동: 출처별 최근 7일 글 수·본문 있음 수·마지막 성공·오류
select p.source_key,
       count(*) filter (where coalesce(p.published_at, p.fetched_at) >= now() - interval '7 days') as posts_7d,
       count(*) filter (where p.fetched_at >= now() - interval '7 days') as fetched_7d,
       count(*) filter (where p.fetched_at >= now() - interval '7 days' and p.has_body) as with_body_7d,
       max(p.fetched_at) as last_fetched
from public.app_outside_posts p
group by p.source_key order by p.source_key;

select source_key, bool_or(enabled) as any_enabled, max(last_ok_at) as last_ok_at,
       string_agg(distinct coalesce(last_error, '-'), ',') as errors
from public.app_outside_sources group by source_key order by source_key;

-- A-2 언론: 갈래·출처별 최근 7일 글 수·본문 종류·상태
select lane, coalesce(source_key, '-') as source_key,
       count(*) as items_7d,
       count(*) filter (where body_kind = 'full') as full_body,
       count(*) filter (where body_kind = 'lead') as lead_only,
       string_agg(distinct state, ',') as states
from public.app_news_items
where created_at >= now() - interval '7 days'
group by lane, source_key order by lane, source_key;

-- A-3 본문 크기 평균(글자 수만)
select 'news' as t, round(avg(char_length(body))) as avg_chars, count(*) as n
from public.app_news_items where body is not null
union all
select 'outside', round(avg(c)), count(*) from (
  select post_id, sum(char_length(text)) as c from public.app_outside_sentences group by post_id) s;

-- A-4 확장이 켜져 있는지 / 쓸 수 있는지
select name, default_version, installed_version
from pg_available_extensions where name in ('pg_cron', 'pg_net', 'supabase_vault') order by name;

-- A-5 상세 만들기 지난 7일(날짜·단계별 건수)
select date_trunc('day', generated_at at time zone 'Asia/Seoul')::date as day, level, count(*)
from public.app_now_details
where generated_at >= now() - interval '7 days'
group by 1, 2 order by 1, 2;
```

- 결과는 숫자만 PR 댓글에 붙이고, 이 문서 1.1 표 '7일 건수' 칸과 5.1 추정을 고치는 문서 PR은 CC가 한다.
