# 설계: 뉴스 공용 기사 한 벌·뉴스방 (NEWS-모두에게열기)

- 상태: 설계 검토(S62-08b). 이 문서는 코드·DB를 바꾸지 않는다. 구현은 사용자 확인 뒤 다른 세션.
- 앞 작업: NEWS-클리핑(`docs/design/news-clipping.md`), NEWS-전면개편(`docs/design/news-overhaul.md`), MULTI-처음쓰는사람(`docs/design/new-user-start.md`, #2574), HOME-하루채우기.
- 사용자 지시(요청함 V29, 11/14 22:41): 뉴스를 다른 사람에게도 열고(한 번 모은 비용이 사람 수만큼 늘지 않게), 텔레그램 뉴스방 글을 News로.
- 사용자 확정(11/14 22:47 "ㅇ"): 뉴스방은 사용자가 텔레그램 화면 방 ⋯ [뉴스방으로]를 누른 방만(자동 없음). [뉴스방에서 빼기]도 같은 자리.
- 표시: [사실] = 저장소에서 확인(파일:줄), [추정] = 운영 확인 필요(10절).
- **S63-03 NEWS-운영자만(사용자 11/16 09:19 "완성도 높아지면 그 때 열자")**: 공용 기사 한 벌 구조(표·함수)는 그대로 두고, 화면 입구(메뉴 `feature: 'outside'`·주소 `?view=news` 판정 `app/view-loader.js`·노트 '보관한 글'·저녁 새 성명 줄·폰 공유 'News 보관')와 서버 일(`news-feed`·`outside-feed` 예약 수집·키워드·제목 번역·화면 입구, `ai-assist` '읽을 만한 글')을 운영자 기능 키 `outside` 작업공간만으로 되돌렸다(`supabase/functions/_shared/news-access.ts`). 이미 모인 글·보관·밑줄은 지우지 않는다. 공용 표 읽기 정책 `private.app_news_reader_ok()`(가입자 모두)는 DB를 바꾸지 않아 그대로다 — 다시 열 때 이 절과 위 파일들을 함께 되돌린다.

## 0. 한 줄 요약

뉴스 기사 내용(주소·제목·요약·본문·번역)은 **공용 표 한 벌**에 한 번만 모으고 가입자 모두가 읽는다. 별표·숨기기·보관·폴더·키워드 표시는 **사람마다 따로**(자기 작업공간, owner RLS). 공용 표에 들어갈 수 있는 길은 서버 규칙으로 두 가지뿐: ① 매체 사이트 수집분 ② 사용자가 [뉴스방으로] 누른 텔레그램 방 글에서 뽑은 **기사 주소만**. 텔레그램 글 본문·방 이름·보낸 사람·통화·사용자의 표시와 메모는 공용 표에 들어갈 길이 없다.

## 1. 지금 구조 (사실 조사)

### 1-1. 표·정책

| 대상 | 위치 | 지금 |
| --- | --- | --- |
| `app_news_items`(기사 + 별표·폴더·숨김을 한 줄에) | `supabase/migrations/20261101233000_news_clipping.sql` 65~118줄 | 작업공간별(`workspace_id`), 같은 기사는 작업공간마다 한 줄(92줄 `unique (workspace_id, url_key)`), lane `channel`·`keyword`·`media`(98줄) |
| 권한 | 같은 파일 158~189줄 | RLS 켬, `authenticated`는 select + 칸 단위 update(`starred_at, folder_id, hidden_at, updated_at`, 169줄), 넣기·내용 고치기는 service_role(176줄). 정책 `news_items_owner_all`(183줄, owner) |
| `app_news_folders`·`app_news_keywords`·`app_news_days` | 같은 파일 50·127·138줄 | 작업공간별 owner RLS |
| 기사 id를 가리키는 표 | `20261106050000_feed_bodies.sql` 45줄(`app_feed_bodies.news_item_id`), `20261102140000_now_detail.sql` 50줄(`app_now_details`)·119줄(`app_now_signals`), `20261106080000_feed_reads_news_prefs.sql` 72줄(`app_feed_reads`) | 모두 `references app_news_items(id) on delete cascade` |
| 외래 키 없이 가리키는 곳 | `20261108070000_news_highlights.sql`(밑줄 `source_type='news'`, `source_id`), 노트 `app_notes.metadata.news_item_id`(news_clipping 17~18줄) | id만 적음 |
| 기능 키 `outside`(News 메뉴) | `20261113230000_arsenal_outside_features.sql` 5·37~40줄 | 운영자 작업공간에만 행. **메뉴 판정에만 쓰임**(DB 정책·Edge에서 `'outside'` 판정 없음 — `has_feature(..., 'outside')` 검색 0건) |

### 1-2. 수집(Edge)

| 내용 | 위치 |
| --- | --- |
| `news-feed` 예약 입구(비밀 머리), 어느 작업공간에 넣을지 서버가 `app_outside_sources`의 `news-` 키·키워드·대기 줄로 정함 | `supabase/functions/news-feed/handler.ts` 3~10줄 |
| 매체 단계: 매체 피드 한 번 읽고 **그 매체를 켠 작업공간마다 줄을 따로 넣음** | 같은 파일 439~451줄, 523~567줄 |
| 요약(AI `news_summary`)·본문 블록·제목 번역은 줄마다 → 작업공간이 늘면 같은 기사 처리도 늘어남 | 같은 파일 251·301·354~359줄, 369~373줄 |
| 화면 입구 `fill_now`·`open`·`translate`(로그인 + owner, 하루 한도 `app_news_days`) | 같은 파일 11~18줄 |
| 텔레그램 채널 스크랩: 앱 스크립트 `tgScrap_run_`이 **사용자가 구독하는 채널(Drive 수집 폴더)**의 주소 줄을 `collector-feed ?action=scrap`으로 보냄 → 운영자 작업공간(`telegram` 기능) `app_news_items` lane `channel` 대기 줄 | `supabase/functions/collector-feed/handler.ts` 52~58줄, 1080~1090줄. 몸통은 `{items:[{url, at?}]}`뿐(방 정보 없음) |
| 텔레그램 방 글 묶음(`?action=telegram`): 방 키·방 이름·`chat_kind`(user·group·channel)·메시지 원문을 받아 텔레그램 소식 표로 | 같은 파일 26·172·259·328~363줄 |
| 방 표 `app_feed_rooms`(작업공간·방 키·`chat_kind`·고정 `pinned_at`) | `20261027010000_tg_room_day_group.sql` 62~78줄, `20261030060000_tg_room_pin.sql` 39줄. 읽기 정책 owner + 제한 정책 `op_feature_read`(telegram 기능, `20261029090000_operator_features.sql` 184줄) |
| 주소 규칙(https만·사용자 정보·포트·IP·내부 이름·Supabase 막음) | `supabase/functions/_shared/news-url.ts` 7~21줄 |

→ 요청함 사실 ④ "[추정] 텔레그램 글이 News로 들어가는 길 없음"은 **틀림**: 앱 스크립트 채널 스크랩 길이 이미 있다(방 단위 서버 판정은 없음 — 어떤 채널을 읽는지는 앱 스크립트 설정에 있음).

### 1-3. 화면·읽는 곳

| 내용 | 위치 |
| --- | --- |
| News 메뉴 `feature: 'outside'` | `app/menu-model.mjs` 36줄, 빼기 `withFeatures` 120~125줄 |
| 뉴스 목록·한 건·키워드·별표 | `app/news-clipping.js` 73~82줄, `app/outside-statements.js` 101·286줄, `app/now-detail.js` 63~90줄, `app/now-marks.js` 18줄, `app/now-saved.js` 26줄 |
| 홈 '읽을 만한 글' 표시 거르기 | `app/home-day-picks-data.js` 30~40줄(자기 작업공간 `app_news_items`) |
| 홈 고르기 AI(서버) | `supabase/functions/ai-assist/handler.ts` 3878줄(자기 작업공간 뉴스에서 고름) |
| 그 밖 서버 읽기 | `supabase/functions/phone-push/now-line.ts` 35줄, `ai-assist/now-detail.ts` 335줄, `_shared/now-detail-build.ts` 114·216줄 |

## 2. 바뀐 뒤 구조

### 2-1. 표

| 표 | 성격 | 칸(요지) | 권한 |
| --- | --- | --- | --- |
| **`app_news_articles`**(새) | 공용 기사 한 벌 | `id`(옮길 때 운영자 `app_news_items.id` 그대로), `url`, `url_key`(**전체에서 유일**), `origin`(`site`·`tg_room`·`tg_scrap`), `source_key`, `lane`, 제목·요약·본문·번역·상태·날짜(지금 칸 그대로) | RLS 켬. `authenticated` **select만**, 정책: `private.app_news_reader_ok()` 그리고 `origin <> 'tg_scrap'`. 넣기·고치기·지우기는 service_role만. anon·PUBLIC 없음 |
| **`app_news_marks`**(새) | 사람별 표시 | `workspace_id`, `article_id`(→ articles), `starred_at`, `folder_id`, `hidden_at`, `keywords text[]`(그 사람 키워드에 걸린 것), `updated_at`. 줄은 표시·키워드가 생길 때만 | RLS 켬, owner 정책(`app_is_workspace_owner`). `authenticated`는 select·insert·칸 단위 update(`starred_at, folder_id, hidden_at, updated_at`)·delete, `keywords`는 service_role만 |
| `app_news_folders`·`app_news_keywords`·`app_news_days` | 그대로(사람별) | — | 그대로 |
| `app_feed_rooms` | 칸 1개 더함 | `news_at timestamptz`(뉴스방으로 정한 시각, null = 아님) | 기존 정책 그대로. 고치는 길은 새 함수만 |
| `app_news_items` | 옮긴 뒤 쓰지 않음 | — | 데이터 보존(지우지 않음). 정리는 나중 별도 결정 |

### 2-2. 함수

| 함수 | 내용 |
| --- | --- |
| `private.app_news_reader_ok()`(새) | SECURITY DEFINER, 빈 search_path, 실행 권한 authenticated만(정책 안에서 부름). 참 = 로그인 + 본인 owner 행 정확히 1개 + 차단 명단(`app_workspace_signup_allow` kind `blocked`)에 없음. 차단 명단 확인은 가입 함수(`20261113140000_workspace_signup_allow.sql` 98·130줄)와 같은 방식 |
| `public.app_feed_room_news(p_room_key text, p_on boolean)`(새) | `app_feed_room_pin`(`20261030060000_tg_room_pin.sql`)과 같은 모양: SECURITY DEFINER, authenticated만, 작업공간은 `auth.uid()`의 owner 행, **`telegram` 기능 필수**(= 사용자만), 있는 방만, `chat_kind = 'user'`(1:1) 거절, 가족 방 거절(아래 2-4), `news_at`·`updated_at`만 고침 |
| `public.app_news_prune` | 공용 표 기준으로 고침: 별표·밑줄·노트 메모가 **누구라도** 붙은 기사는 지우지 않음 |

### 2-3. 수집(Edge)

| 함수 | 바꾸는 것 |
| --- | --- |
| `news-feed` | 매체 단계: 켠 매체 키의 합집합을 한 번만 읽어 `app_news_articles`에 한 줄(`url_key` 겹치면 무시). 요약·본문 블록·제목 번역은 기사마다 한 번. 키워드 단계: 키워드를 켠 작업공간마다 `app_news_marks.keywords`만 고침(AI 없음, 지금도 글자 대조). [번역]은 공용 칸에 저장 → 두 번째 사람은 저장본을 읽음(재번역 없음). 하루 한도 `app_news_days`는 누른 사람 작업공간에 그대로 셈 |
| `collector-feed ?action=telegram` | 서버가 그 방의 `app_feed_rooms.news_at`을 봄(운영자 작업공간·방 키, 몸통 값이 아니라 표). `news_at`이 있고 `chat_kind`가 `user`가 아니고 가족 방이 아니면, 메시지 글에서 **주소만** 뽑아 `openArticleUrl`·`cleanArticleUrl`·뉴스방 막을 주소(2-4) 통과분을 `app_news_articles`(`origin 'tg_room'`, state `pending`)에 넣음. 메시지 글·방 이름·보낸 사람·시각 외 칸은 넣지 않음(넣을 칸이 없음). 텔레그램 소식 처리는 지금 그대로 |
| `collector-feed ?action=scrap` | 옮기는 동안 `origin 'tg_scrap'`(공용 정책에서 빠짐 → 운영자 화면 전용 정책 하나로만 보임) → 사용자가 해당 채널들을 [뉴스방으로] 누른 뒤 이 입구를 닫음(10절 확인 ⑥, 11절 질문 3) |
| 읽는 곳 `ai-assist`(홈 고르기·now-detail)·`phone-push/now-line`·`_shared/now-detail-build` | 공용 기사 + 내 표시(숨김 거르기)로 읽기 |

### 2-4. 공용 표에 들어갈 수 있는 길 — 서버 규칙 (보안 핵심)

1. 넣는 쪽은 service_role뿐(`news-feed` 매체 단계, `collector-feed` 뉴스방 처리, 옮기는 동안 scrap). 화면(authenticated)은 넣기·고치기 권한이 없다(grant 없음).
2. 텔레그램에서 오는 것은 **기사 주소 한 줄**뿐. 제목·요약·본문은 나중에 `news-feed`가 그 **기사 사이트**에서 읽어 채운다. 텔레그램 메시지 원문은 공용 표 어느 칸에도 들어가지 않는다.
3. 방 판정은 서버 표(`app_feed_rooms.news_at`)로. 앱 스크립트가 보낸 '뉴스방이다' 같은 값은 받지 않는다. 1:1 방(`chat_kind='user'`)은 함수가 뉴스방으로 정하지 못하게 거절하고, 수집 때도 다시 거절. 가족 방은 지금도 `?action=telegram` 자체가 400 `FAMILY_ROOM`으로 거절(collector-feed handler.ts 66~67·775줄) — 뉴스방 함수도 가족 방 표시가 있는 방은 거절.
4. 뉴스방이라도 뽑은 주소가 아래면 버린다(개수만 셈): `t.me`·`telegram.org`·`telegram.me`, `docs.google.com`·`drive.google.com`·`forms.gle`·`forms.google.com`, `onedrive.live.com`·`1drv.ms`·`*.sharepoint.com`, `*.bokdoong.com`, `notion.so`·`*.notion.site`, 단축 주소(`bit.ly` 등 — 펼친 뒤 판정하거나 버림), 짧은 대화방 초대 링크, 그리고 기존 `news-url.ts` 막는 목록. (업무 문서 공유 링크가 실수로 공용 표에 들어가는 것을 막음)
5. [뉴스방에서 빼기] 뒤 들어온 글은 공용 표로 가지 않음. 이미 들어간 기사는 그대로(요청함 방 추천 — 사용자 확정 아님, 11절 질문 4).
6. 공용 기사에 '어느 방에서 왔는지'를 적지 않는다(`origin`만 `tg_room`). 방 키·방 이름 칸 없음.

### 2-5. 금지 확인표

| 항목 | 지킴 |
| --- | --- |
| anon·PUBLIC 권한 | 없음(새 표 둘 다 revoke all 후 authenticated·service_role만) |
| RLS 끄기 | 없음 |
| 다른 작업공간 읽기·쓰기 | 공용 기사는 작업공간 칸이 없는 공용 글(누구 것도 아님). 사람별 표시는 owner 정책. 사용자 별표·숨김·폴더·메모·밑줄·읽음은 각자 표에 남아 다른 사람 화면에 안 나옴 |
| 화면이 보낸 작업공간 값 | 안 믿음. 표시 넣기는 owner 정책 + `with check`, 서버 입구는 owner 행으로 |
| Origin 와일드카드 | 없음(기존 공용 CORS 목록 그대로) |
| 사용자 텔레그램 글·통화 | 공용 표로 가는 길 없음(2-4). 텔레그램 소식·통화 표의 정책·제한 정책(`op_feature_read`)은 그대로 |
| 차단 명단 | `app_news_reader_ok()`가 거절 |

## 3. 위험과 막는 법

| 위험 | 막는 법 | 시험 |
| --- | --- | --- |
| 업무방·1:1·가족 대화 글이 다른 사람에게 보임 | 2-4의 1~6. 원문 칸이 공용 표에 없음 | 뉴스방 아닌 방 묶음 → 공용 표 0줄 / `chat_kind=user` 방을 뉴스방으로 → 함수 거절 / 가족 방 → 거절 / 뉴스방 글 속 `docs.google.com` 주소 → 버림 / 공용 줄의 칸 목록에 원문·방 키·보낸 사람 없음(표 정의 시험) |
| 다른 사람이 사용자 표시를 봄 | 표시는 `app_news_marks` owner 정책 | B 계정이 A의 표시 0줄, `app_news_items` 옛 줄 0줄 |
| 다른 사람이 공용 기사를 고침·지움 | authenticated에 insert·update·delete 권한 없음 | PATCH·DELETE → 권한 오류 |
| 비로그인·차단 계정이 읽음 | 정책이 `reader_ok()` | anon 0줄, 차단 명단 계정 0줄 |
| `tg_scrap`(앱 스크립트가 고른 채널)이 서버 판정 없이 공용이 됨 | 옮기는 동안 공용 정책에서 뺌 | B 계정에 `tg_scrap` 0줄 |
| 같은 기사가 사이트·뉴스방 둘로 들어옴 | `url_key` 전체 유일 → 먼저 들어온 줄 하나. `tg_scrap` 줄에 같은 주소가 공용 길로 오면 `origin`만 넓힘 | 같은 주소 두 길 → 1줄 |
| 비용이 사람 수만큼 늘어남 | 요약·본문·제목 번역은 기사마다 한 번, 저장본 재사용. 홈 '왜:' 고르기만 사람별(사람별 한도 안) | 두 작업공간이 같은 매체를 켜도 AI 요약 호출 1번(가짜 AI 호출 수 시험) |
| 옛 id를 가리키는 표(본문 블록·읽음·now·밑줄·노트 메모)가 끊김 | 공용 기사 id = 운영자 옛 줄 id 그대로. 외래 키는 2단계에서 `app_news_articles`로 옮김 | postcheck: 옛 id 수 = 새 id 수, 고아 줄 0 |
| 다른 작업공간에 이미 뉴스 줄이 있던 경우 | 옮길 때 `url_key`로 합치고 그 사람 표시는 marks로, 그 사람 줄을 가리키던 읽음·now 줄은 합친 id로 고침 | precheck SQL로 먼저 건수 확인(10-1 ②) |
| 사회운동(News 안 [사회운동] 탭, `app_outside_posts`) | 이번 범위 밖. 지금도 작업공간별 수집(켠 단체마다)이라 다른 사람도 켜면 보이지만 비용은 사람 수만큼 → 11절 질문 2 | — |

## 4. 단계 나누기 (Expand → Deploy → Contract)

| 순서 | 내용 | 정지 지점 | 되돌리기 |
| --- | --- | --- | --- |
| D1 DB | 새 표 2개 + `reader_ok()` + `app_feed_rooms.news_at` + `app_feed_room_news()`, 운영자(·다른 작업공간) 줄을 공용 기사·표시로 복사. 옛 표는 그대로. 짝 5파일, 시험 적용 먼저 | DB 적용 | rollback SQL: 새 표·함수·칸 삭제(옛 표 안 건드렸으므로 그대로) |
| E1 Edge | `news-feed`·`collector-feed`가 공용 기사에 쓰기(옮기는 동안 운영자 옛 표에도 같이 써 화면 유지), 뉴스방 처리 | Edge 배포(한 번에 하나, 이전 SHA 기록) | 이전 SHA 재배포 |
| D2 DB | 기사 id를 가리키는 외래 키 4곳을 `app_news_articles`로 옮김(같은 이름 제약 다시 만듦), `app_news_prune` 고침 | DB 적용 | rollback SQL: 외래 키를 옛 표로 되돌림(id가 같아 가능) |
| P1 화면 | 뉴스 화면·홈 읽을 글·텔레그램 방 ⋯ [뉴스방으로]·[뉴스방에서 빼기], `menu-model.mjs` `outside` 기능 키 삭제, 업데이트 기록 | Pages | PR revert(메뉴는 다시 사용자만) |
| E2 Edge | `ai-assist`·`phone-push` 읽기 전환 | Edge 배포 | 이전 SHA |
| C1 | 옛 표 쓰기 멈춤, scrap 입구 닫기(사용자 답 뒤) | Edge 배포 | 이전 SHA |

- **겹치는 파일**: `app/menu-model.mjs`는 구글 드라이브 설계(S62-08a, `docs/design/gdrive-photos-all.md` B3)도 고친다 → 앞뒤로 세우거나 한 PR로. `collector-feed`는 텔레그램 관련 다른 작업과 겹치면 줄 세우기. migration 시각은 그때 최신 뒤로.
- D1의 정책은 새 표라 '넓히는 정책 교체'가 아니다. 다만 공용 읽기 정책(작업공간 조건 없음)은 승인형 workflow 확장 규칙이 거절할 수 있다 → 그러면 SQL Editor 경로(AGENTS.md 7절).

## 5. 시험 목록 (구현 PR에서)

- 정책: anon·차단 계정·작업공간 없는 로그인 0줄, 가입자 읽기 OK, authenticated 쓰기 거절.
- 표시: B가 A 표시를 못 읽고·못 고침, 남의 `article_id`로 넣기는 되지만 자기 작업공간 줄로만(정책 `with check`).
- 뉴스방: 2-4 시험 전부 + `news_at` 고치기는 telegram 기능 있는 owner만.
- 비용: 같은 매체 두 작업공간 → 요약 AI 1회, 번역 저장본 재사용.
- 옮기기: postcheck(줄 수·id 같음·고아 0).
- E2E: 새 계정 폰·PC에서 News 메뉴·홈 '읽을 만한 글', 사용자 별표가 안 보임.

## 6. 완료 기준 (요청함 그대로)

새 계정 폰·PC에서 News 메뉴·홈 '읽을 만한 글'이 보이고 사용자 별표·숨김은 안 보임, 사용자 텔레그램 업무방 글은 새 계정에서 절대 안 보임(서버 거절 시험), 뉴스방으로 정한 채널 기사가 News에 들어옴 + AI 비용이 사람 수만큼 늘지 않음(요약 한 번) + 화면 사진 PR 첨부.

## 7. 요청함 방 추천 (사용자 확정 아님)

- '읽을 만한 글'의 '왜:' 한 줄은 사람마다 다르므로 고르기는 사람별 AI(사람별 한도 안), 기사 요약은 공용 한 벌. → 이 설계는 추천대로 그림.
- 원장 자동 기록은 기사를 넣지 않음. → 그대로(공용 기사는 원장 근거가 아님).
- [뉴스방에서 빼기] 뒤 이미 들어간 기사는 그대로.

## 8. 비용 메모

- 지금: 매체 하나를 n명이 켜면 줄 n개·본문 읽기 n번·(채널 줄은) 요약 n번.
- 바뀐 뒤: 기사마다 1번. 사람 수에 따라 느는 것은 [번역]·[지금 채우기] 누름 횟수 한도 세기와 홈 고르기 AI뿐.

## 9. 범위 밖

- 사회운동 글(`app_outside_posts`) 공용화 — 11절 질문 2.
- `app_news_items` 옛 표 지우기 — 나중 별도 결정.

## 10. 커맨드센터 운영 확인 (읽기 전용)

### 10-1. 읽기 전용 SQL (select만, PR 댓글에도 같은 내용)

```sql
-- ① 작업공간별 뉴스 줄 수(작업공간 id 대신 순번), lane별
select dense_rank() over (order by workspace_id) as ws_no, lane, count(*)
  from public.app_news_items group by workspace_id, lane order by 1, 2;
-- ② 작업공간 사이 겹치는 기사(url_key) 수
select count(*) from (select url_key from public.app_news_items group by url_key having count(distinct workspace_id) > 1) x;
-- ③ 옛 id를 가리키는 줄 수
select (select count(*) from public.app_feed_bodies where news_item_id is not null) as bodies,
       (select count(*) from public.app_feed_reads where news_item_id is not null) as reads,
       (select count(*) from public.app_now_details where news_item_id is not null) as details,
       (select count(*) from public.app_now_signals where news_item_id is not null) as signals,
       (select count(*) from public.app_news_highlights where source_type = 'news') as highlights;
-- ④ 텔레그램 방 종류별 수와 최근 수집 시각(방 이름 없이)
select chat_kind, count(*), max(updated_at) from public.app_feed_rooms group by chat_kind;
-- ⑤ 최근 7일 날짜별 텔레그램 수집 방 수(매시간 도는지 보조 지표)
select day, count(distinct room_key) from public.app_feed_room_days
 where day >= current_date - 7 group by day order by day;
-- ⑥ 채널 스크랩(lane channel) 최근 7일 건수
select date_trunc('day', created_at) d, count(*) from public.app_news_items
 where lane = 'channel' and created_at >= now() - interval '7 days' group by 1 order by 1;
```

### 10-2. 텔레그램 수집 범위 확인 목록 (사용자 10/25 지시 '모든 채팅방·그룹·채널, 매시간')

수집기는 회사 PC(저장소 밖)라 저장소로는 확인할 수 없다. 커맨드센터가 운영 읽기 전용으로 본다.

1. 방송 채널 포함 여부: ④에 `chat_kind = 'channel'` 줄이 있는지, 최근 날짜인지.
2. 그룹·1:1 포함: ④의 `group`·`user` 줄.
3. 새로 구독한 채널이 저절로 들어오는지: 사용자가 새 채널 하나 구독 → 1~2시간 뒤 ④의 `channel` 수가 늘었는지(방 이름은 화면에서만 확인).
4. 매시간인지: ⑤ 날짜별 수 + `collector-feed` 대시보드 Invocations에서 `?action=telegram` 호출 간격.
5. 채널 스크랩(`tgScrap_run_`)이 아직 도는지: ⑥ 최근 건수. 돈다면 어느 채널을 읽는지는 앱 스크립트 설정(Drive 수집 폴더)에서 확인 → 그 채널들을 [뉴스방으로] 옮길 목록.
6. 뉴스 채널 글 속 기사 주소가 실제로 메시지 글(`text`)에 들어오는지(링크 미리보기만 있고 글에 주소가 없으면 수집기에서 링크 칸도 보내야 함 — 그 경우 수집기 변경이 별도 작업).

## 11. 사용자 결정이 더 필요한 것

1. 다른 사람 News에는 모든 매체 기사를 다 보여 줄까요, 각자 켠 매체만 보여 줄까요? (추천: 처음엔 모두 같은 목록, 매체 끄기는 나중에)
2. News 안 [사회운동] 탭(단체 성명)도 공용 한 벌로 바꿀까요? 지금은 각자 단체를 켜면 따로 모읍니다. (추천: 이번엔 그대로, 다음 일로)
3. 지금 앱 스크립트가 읽는 텔레그램 채널 스크랩은, 그 채널들을 [뉴스방으로] 누른 뒤 닫을까요? (추천: 예 — 서버가 방을 판정하는 길 하나로)
4. [뉴스방에서 빼기]를 하면 이미 들어간 기사는 그대로 둘까요? (추천: 그대로)

## 12. 사용자 결정 (11/15, 지시서 S62-12b 기록)

| 질문(11절) | 결정 |
| --- | --- |
| 1 다른 사람 목록 | 가 — 모두 같은 목록(매체 끄기는 나중에) |
| 2 [사회운동] 탭 | **나 — 이번에 공용 한 벌로**(14절) |
| 3 채널 스크랩 | 예 — [뉴스방으로] 옮긴 뒤 커맨드센터가 앱 스크립트 입구를 닫음 |
| 4 뉴스방에서 빼기 | 그대로 — 이미 들어간 기사는 남김 |
| 뉴스방 | 사용자가 누른 방만(자동 없음) |

진행: D1 #2628 운영 적용(승인형 workflow dry-run → apply), E1 Edge #2633(collector-feed·news-feed, 옛 표에도 같이 씀).

## 13. D2 설계 보충 — 기사 id를 가리키는 표 (S62-12b 조사, 구현 전)

4절 D2는 "외래 키 4곳을 공용 기사로 옮김"이었으나, 가리키는 표의 **유일 제약·읽기 정책이 작업공간별 기사 줄을 전제**로 되어 있어 외래 키만 옮기면 깨진다. [사실] = 저장소에서 확인.

### 13-1. 지금 (사실)

| 표 | 가리키는 칸 | 유일·정책 | 공용 기사로 옮기면 |
| --- | --- | --- | --- |
| `app_feed_bodies`(본문 블록) | `news_item_id`(`20261106050000_feed_bodies.sql` 45줄) | `unique (news_item_id)`(56줄), owner select(100줄), 쓰기 service_role | 기사 내용이라 **공용**이어야 하는데 owner 정책이라 다른 사람이 못 읽음 |
| `app_feed_reads`(읽음) | `news_item_id`(`20261106080000_feed_reads_news_prefs.sql` 72줄) | `unique (news_item_id)`(75줄, 작업공간 없음), owner 정책 + 같은 작업공간 확인 트리거 `private.app_feed_reads_scope_guard` | 사람별이어야 하는데 유일 제약 때문에 A가 읽으면 B가 못 넣음, 트리거가 작업공간 칸 없는 기사를 거절 |
| `app_now_details`(한 건 자세히) | `news_item_id`(`20261102140000_now_detail.sql` 50줄) | `unique (news_item_id)`(63줄) | 위와 같은 유일 충돌. [사실] 저장본에 사람 관심사 지문(`interests_key`)이 붙어 관심이 바뀌면 다시 만든다(`ai-assist/now-detail.ts` 5줄) → **사람별** |
| `app_now_signals`(반응) | `news_item_id`(같은 파일 119줄) | 유일 없음, 사람별 | 외래 키만 옮기면 됨 |
| `app_news_highlights`(밑줄) | `source_id`(외래 키 없음, `source_type='news'`) | 사람별 | 옛 id → 공용 id 바꿔 읽기 필요 |
| 노트 `metadata.news_item_id` | 외래 키 없음 | 사람별 | 같음 |

[사실] 사회운동 쪽(`outside_post_id`, `app_outside_marks.post_id` 기본 키)도 같은 모양이다(14절).

### 13-2. 제안 — 옛 표는 건드리지 않고 새 표로 (Expand)

| 새 표·함수 | 내용 | 권한 |
| --- | --- | --- |
| `app_news_article_bodies` | 기사마다 블록 한 줄(`article_id` 기본 키 → `app_news_articles`) | RLS, 읽기 `private.app_news_reader_ok()`(tg_scrap 기사는 운영자만 — 기사 정책과 같은 조건), 쓰기 service_role |
| `app_news_reads` | `(workspace_id, article_id)` 기본 키 | owner 정책, 화면은 자기 줄 넣기·지우기, 넣을 때 읽을 수 있는 기사만(`with check` 하위 조회) |
| `app_news_id_map` | `old_id`(옛 `app_news_items.id`) → `article_id` | 화면 권한 없음(service_role·DEFINER 함수만). 밑줄·노트 메모·now 줄의 옛 id를 지우거나 고치지 않고 읽을 때 바꿈 |
| `app_news_now_details` | 사람별 `(workspace_id, article_id)` 기본 키(지금 칸 그대로). `app_now_signals`는 유일 없음 → 새 칸 `article_id`(공용 기사 외래 키)만 더하거나 같은 모양 새 표(구현 때 작은 쪽) | owner 정책(지금 표와 같음), 쓰기 서버 |

- D2 migration: 위 새 표 + 옮기기(옛 표에만 있는 기사 다시 복사 — 운영자 줄 id 우선, `app_news_id_map` 전부, 대표 줄의 본문 블록, 작업공간마다 읽음). 기존 표·정책·트리거·외래 키는 바꾸지 않는다(되돌리기 = 새 표 삭제).
- E1b Edge: news-feed 본문 블록을 `app_news_article_bodies`에(옮기는 동안 옛 블록도), ai-assist·phone-push·now-detail 읽기를 공용 기사 + 내 표시로(설계 4절 E2를 앞당김).
- ③ 화면: 공용 기사·`app_news_marks`·`app_news_reads`·새 블록 표를 읽음. 옛 id 링크는 지도 함수로.
- C1: 옛 표 쓰기 멈춤. 옛 표·옛 본문 블록 지우기는 따로 결정.
- 시험(실제 PostgreSQL): B가 A 읽음을 못 봄·A가 읽어도 B가 넣을 수 있음, 블록은 가입자 읽기·차단 계정 0줄·tg_scrap 블록은 운영자만, 지도 표 화면 권한 없음, 옮긴 뒤 옛 줄마다 지도 1줄·고아 0.

## 14. [사회운동] 공용 한 벌 (D1b, 사용자 결정 2 나 — #2628 '설계 보충' 댓글 그대로)

### 14-1. 지금 (사실)

| 대상 | 위치 | 지금 |
| --- | --- | --- |
| `app_outside_posts` | `20261031230000_outside_statements.sql` 57~93줄, `20261108020000_outside_post_body_ko.sql`(`body_ko` 칸) | 작업공간별, `unique (workspace_id, url)`(72줄), `unique (id, workspace_id, lang)`(73줄), owner select |
| `app_outside_sentences` | 같은 파일 95~107줄 | 외래 키 `(post_id, workspace_id, lang)`, owner select |
| `app_outside_seen` | 같은 파일 110줄 | 사람별 마지막 본 시각(그대로 둠) |
| `app_outside_sources` | 같은 파일 44줄 | 사람별 단체 켜기 |
| `app_outside_search` | 같은 파일 154줄, `20261102150000_outside_search_undated.sql` 29줄 | 자기 작업공간 문장 검색(authenticated) |
| 가리키는 표 | `app_outside_marks.post_id`(기본 키 — 작업공간 없음), `app_feed_bodies.outside_post_id`·`app_feed_reads.outside_post_id`·`app_now_details.outside_post_id`(각각 유일), `app_now_signals.outside_post_id`, `app_news_highlights`(`source_type='outside'`) | 13-1과 같은 문제 |
| 읽는 곳 | `outside-feed` Edge, `app/outside-statements.js`·`notice-outside.js`·`outside-search*.js`·`now-*.js`, `ai-assist/now-detail.ts`, `phone-push/now-line.ts`, `_shared/now-detail-build.ts` | — |

### 14-2. 바뀐 뒤

| 표·함수 | 성격 | 권한 |
| --- | --- | --- |
| `app_outside_articles`(새) | 공용 글 한 벌: `app_outside_posts` 칸 그대로에서 `workspace_id`만 뺌, `url` 전체 유일, id는 옮길 때 대표 줄(운영자 작업공간 줄 → 먼저 생긴 줄) id 그대로 | RLS, 읽기 `private.app_news_reader_ok()`, 쓰기 service_role. anon·PUBLIC 없음 |
| `app_outside_article_sentences`(새) | 공용 문장(`article_id`, `idx`) | 같음 |
| `app_outside_article_marks`(새) | 사람별 별표·보관·숨김 `(workspace_id, article_id)` | owner, 화면은 자기 줄 넣기·칸 고치기·지우기 |
| `app_outside_article_bodies`·`app_outside_reads`·`app_outside_id_map`(새) | 13-2와 같은 방식 | 13-2와 같음 |
| `public.app_outside_search_shared`(새) | 공용 문장 검색(인자는 지금 함수와 같게), SECURITY INVOKER — 공용 표 정책을 그대로 거침 | authenticated만 |
| `app_outside_seen`·`app_outside_sources` | 그대로(사람별) | 그대로 |

- 수집(`outside-feed`, D1b 뒤 Edge): 누구라도 켠 단체의 합집합을 한 번만 읽어 공용 글 한 줄, 요약·핵심 문장·번역은 글마다 한 번(뉴스 E1과 같은 방식, 옮기는 동안 옛 표에도).
- 처음엔 모두 같은 목록(결정 1 가와 같이). 단체 켜기는 '수집 대상'만 정한다.
- 순서: 이 절(문서) → D1b migration(새 표·함수·옮기기, 짝 5파일, 실제 PostgreSQL 시험) → outside-feed Edge → ③ 화면(뉴스와 한 번에 또는 바로 뒤).
- 시험: 가입자 읽기·anon·차단 계정·작업공간 없는 로그인 0줄, 화면 공용 표 쓰기 42501, B가 A 표시를 못 봄, 검색 함수가 공용 문장만, 같은 단체 두 사람 → 요약 AI 1번.

### 14-3. 결정이 필요한 것

- 없음(사용자 결정 2 나). `app_now_details`는 사람별로 확인됨(13-1).
