# DB 보관 기간 정리 (S67-24 DB-보관기간정리)

사용자 결정(11/20 10:51·10:52, 사회운동은 11:07에 2개월로 정정): 언론 기사는 **3일**, 사회운동 매체는 **2개월**까지 보관, 나머지 지워도 되는 것은 다 지움.
배경: Supabase 무료 한도 초과(DB 0.664GB / 0.5GB). 크기는 커맨드센터가 카탈로그로만 쟀다(내용 조회 없음).

## 1. 규칙

| 무엇 | 언제 지우나 | 기준 칸 | 어디서 |
| --- | --- | --- | --- |
| 언론 기사(News [언론] 탭: 공용 `app_news_articles` + 옛 `app_news_items`, 모든 lane) | 받은 지 72시간 | `created_at` | `public.app_news_prune` — 수집 때마다(Edge news-feed 'prune' 단계) + 매일 정리 |
| 사회운동 글(공용 `app_outside_articles` + 옛 `app_outside_posts`) | 받은 지 2개월 | `fetched_at` | `public.app_outside_prune` — 매일 정리 |
| 예약 실행 기록 `cron.job_run_details` | 7일 | `end_time`(없으면 `start_time`) | 매일 정리 |
| 백업 사본 `ops_backup.*` | 그 migration 기록이 있고(적용 끝남) 처음 본 지 14일 | `private.app_ops_backup_seen.first_seen_at` | 매일 정리 |

매일 정리 = pg_cron 예약 `web2_retention_daily`(02:43 KST) → `private.app_retention_daily()`.

### 왜 '받은 날' 기준인가

- 수집기는 이미 있는 주소를 건너뛴다. 지운 글이 피드·단체 목록에 아직 실려 있으면 다시 넣고, 다시 본문을 읽고 AI 요약·제목 번역을 한다(헛돎).
- 받은 날 기준이면 지울 때쯤엔 대부분 목록에서 빠져 있다. 언론은 남은 경우까지 막으려고 Edge news-feed가 게시 시각이 72시간 넘은 피드 글을 넣지 않는다(`KEEP_HOURS`, `tests/news-feed-keep-hours.test.mjs`).
- 사회운동은 게시일 기준이면 글이 드문 단체의 목록(몇 달치)에 남은 옛 글을 매번 다시 넣는다. 받은 날 기준이면 2개월에 한 번 다시 들어올 수 있을 뿐이다. 2년 넘은 글을 본문 없이 넣는 기존 규칙(Q7)은 그대로다.
- 그래서 사회운동 글은 게시일이 오래된 글도 **받은 뒤 2개월** 남는다.

## 1-1. 언론 기사 본문은 하루(S73-01 NEWS-본문하루)

사용자 결정(2026-11-27 17:34, DB 무료 한도 500MB 중 406MB): 받은 지 하루 지난 언론 기사는 **본문만** 지우고 제목·요약·주소는 남긴다. 하루 지난 기사는 원래 사이트에서 읽는다.

| 무엇 | 언제 | 기준 칸 | 어디서 |
| --- | --- | --- | --- |
| 언론 기사 본문(공용 `app_news_articles`·옛 `app_news_items`의 `body`·`body_kind`·`body_ko`, 본문 블록 `app_news_article_bodies`·옛 `app_feed_bodies`) | 받은 지 24시간 | `created_at` | `public.app_news_trim_bodies` — 매일 정리 `private.app_retention_daily()`가 부름(`docs/ops/news-body-trim-daily.apply.sql`) |

- 남는 것: 제목·요약·주소·번역 제목·날짜·상태·분야. 번역 시각은 번역 제목이 없을 때만 함께 비운다(표 검사). `updated_at`은 그대로.
- 본문 블록 줄은 지우지 않고 **비운 표시 줄**(`rule = 'trim@1'`, `state failed`·`reason no_body`, 블록 없음)로 바꾼다. 블록 줄이 없던 기사도 하나 넣는다. 그래야
  ① 화면이 그 글을 '본문 없음'으로 알고 열 때 원문을 다시 읽으러 가지 않고(`news-feed open`), ② 수집기 보충(`app_news_refs_sync` — 줄이 없을 때만 넣음)이 옛 본문을 다시 채우지 않는다. 뽑은 시각(`extracted_at`)은 그대로.
- 남길 것은 2절과 같은 묶음(+ 읽을 거리 줄, `20261122230000_reading_one_store`) — 걸린 기사는 본문도 그대로. 손 본문 블록(`manual@1`)·읽기 전(`pending`) 기사도 그대로.
- 화면(`app/now-model.mjs` `TRIM_RULE`): 원문 칸에 까닭 한 줄 '지난 기사라 본문은 저장하지 않아요 · 원래 사이트 ↗'. 까닭 줄 [원문 다시 가져오기]·[직접 넣기] 없음. 원문 ⋯ [원문 다시 가져오기]는 그대로라 사람이 원하면 그 글만 다시 읽고(서버 하루 한도), 다음 정리 때 다시 비운다.
- 요약·시사점(AI): 본문으로 만든 저장본(본문 지문 있음)은 본문이 사라져도 그대로 쓴다(`_shared/now-detail-build.ts` `madeFromBody`). 저장본이 없으면 남은 요약을 재료로 만든다.
- 사회운동 글(2개월)·사람별 표시·내가 고친 원문(`app_feed_body_edits`)은 건드리지 않는다.

## 2. 사람이 남긴 것 — 지우지 않음

같은 주소(언론 `url_key`, 사회운동 `url`) 묶음 안에 하나라도 있으면 공용 줄·옛 줄 모두 남긴다(작업공간이 달라도).

| 표시 | 언론 | 사회운동 |
| --- | --- | --- |
| 별표(별표 폴더는 별표가 있어야 함) | `app_news_marks.starred_at`, 옛 `app_news_items.starred_at` | `app_outside_article_marks.starred_at`, 옛 `app_outside_marks.starred_at` |
| 보관 | (별표와 같음) | `archived_at`(공용·옛) |
| 직접 넣은 기사·손으로 고친 기사 | `origin = 'user'`, `manual_at` 있음 | 없음(직접 넣기 없음) |
| 노트 메모(휴지통 노트 포함) | `app_notes.metadata.news_item_id` = 공용 id·옛 id·지도(`app_news_id_map`) 옛 id | `metadata.outside_post_id`(`app_outside_id_map` 포함) |
| 밑줄 | `app_news_highlights` `source_type = 'news'` | `source_type = 'outside'` |

조사한 것(저장소 확인): 주간보고·사업보고·원장·기록 연결(`app_record_links`)은 기사 id를 적지 않는다. 밑줄 [노트로]는 글자를 노트에 복사한다. 홈 '읽을 만한 글'(`app_home_day_picks`)·자세히의 '함께 볼 것'은 AI가 고른 것이라 남길 대상이 아니다(지워진 글은 목록에서 빠짐).

같이 지워지는 것(지우는 기사에 딸린 것만, 외래 키 `ON DELETE CASCADE`): 본문 블록(`app_news_article_bodies`·`app_outside_article_bodies`·옛 `app_feed_bodies`), 문장(`app_outside_article_sentences`·옛 `app_outside_sentences`), 사람별 읽음·숨김·키워드 표시·자세히(AI)·반응 기록(`*_now_signals` — 관심사 환류 재료 중 지운 글 몫)·지도 줄. 텔레그램·통화·가족 표는 읽지도 지우지도 않는다.

## 3. 적용 순서 (커맨드센터)

> **2026-11-25 사용자 결정(21:35 "추천대로", `docs/qa/stalled-audit-20261125.md` 2절) 10번**: DB 적용 때 쌓이는 백업 표(`ops_backup`)는 **적용하고 14일 지난 것만** 지운다(그 migration이 `schema_migrations`에 기록된 것만, 기록 없는 백업은 사람이 본다). 지우기 전에 개수를 한 줄로 보고한다. 사용자는 "CC가 승인형 workflow로"라고 정했지만, workflow는 지금 `drop table`을 막는다(`docs/ops-db-workflow.md` 차단 목록). 길 고르기는 `docs/qa/stalled-audit-20261125.md` I-8.

1. Edge `news-feed` 배포(main merge 커밋, 되돌리기 ref = 지금 운영 소스 SHA). 오래된 피드 글 거르기가 먼저 들어가야 지운 기사가 다시 들어오지 않는다.
2. 승인형 DB workflow: `20261120130000_news_outside_retention.sql` dry-run → apply. 적용 순간에는 줄을 지우지 않는다(최상위 DELETE 없음 → 자동 사본 없음 — 한도 초과 중에 사본으로 더 커지지 않게). **적용 뒤 다음 언론 수집(매시 :22)부터 언론 정리가 시작된다.**
3. SQL Editor(폰 경로 C): `docs/ops/retention-daily.precheck.sql`(숫자 캡처) → `retention-daily.apply.sql` 조각 ①(예약) → precheck → 조각 ②(지금 한 번 정리 + 11/15·16·19 뉴스 백업 지우기) → precheck.
4. SQL Editor: 조각 ③ `VACUUM FULL` 한 줄씩(KST 14:30~14:55 또는 21:30~21:55, 수집 사이) → precheck로 `database size MB` 확인.

workflow가 받지 못하는 부분(②·③·④)과 이유는 `docs/ops/retention-daily.apply.sql` 머리에 적었다: cron 스키마 쓰기, 백업 표 DROP(동적 EXECUTE), private 새 표, 거래 밖 VACUUM.

### 디스크를 실제로 줄이는 법

- `DELETE`만으로는 빈자리가 표 안에서 다시 쓰일 뿐 DB 크기(무료 한도 기준 `pg_database_size`)는 줄지 않는다. 자동 VACUUM은 빈자리를 '다시 쓸 수 있게'만 한다.
- `VACUUM FULL`이 표를 새로 써서 크기를 줄인다. 그 표를 잠그므로(읽기·쓰기 모두 기다림) 수집 사이에, 한 표씩, 거래 밖에서(SQL Editor 한 창에 한 줄) 돌린다. 지운 뒤라 표가 작아 한 표에 몇 초~수십 초.
- `cron.job_run_details`는 확장이 가진 표라 `must be owner`(42501)로 거절될 수 있다. 그때는 넘어간다: 매일 7일치만 남기므로 빈자리를 다시 쓰며 더 커지지 않는다. 크기까지 줄이려면 Supabase 지원 문의가 필요하다.
- 무료 한도 초과로 DB가 읽기 전용이 되었으면 같은 창 맨 위에 `set session characteristics as transaction read write;`를 더한다.

## 4. 예상 효과 (추정 — 행 수는 보지 않고 크기·기간 비율로 셈)

| 대상 | 지금 | 정리 뒤 | 2개월 뒤 | 근거 |
| --- | --- | --- | --- | --- |
| `cron.job_run_details` | 153MB | 약 75MB(VACUUM FULL 되면) / 153MB 그대로(안 되면, 더 늘지 않음) | 같음 | 11/06부터 14일치 → 7일치 |
| `ops_backup` 뉴스 백업 3개 | 약 98MB | 0 | 0 | 조각 ②에서 바로 |
| `ops_backup` 사진 백업 | 8MB | 8MB → 14일 뒤 0 | 0(새 백업도 14일 뒤 지움) | 14일 규칙 |
| `app_news_items`(옛 표) | 59MB | 약 8~12MB | 같음(3일치 + 별표) | 약 20일치 → 3일치 |
| `app_news_articles` | 59MB | 약 8~12MB | 같음 | 같음 |
| `app_news_article_bodies` | 6.6MB | 약 1MB | 같음 | 같음 |
| `app_feed_bodies` | 11MB | 약 5~7MB(뉴스 몫 빠짐) | 사회운동 몫만 늘다 2개월에서 멈춤 | |
| 사회운동 표(`app_outside_*` 글·문장·본문) | 약 15~20MB | 그대로(10/31부터 받아 2개월 안 됨) | 약 30~60MB에서 멈춤 | 2개월치 상한 |
| `app_cloud_items`·`app_onedrive_photos`·`app_feed_items` | 87·23·6.7MB | 그대로 | 사용량 따라 | 사람의 파일 목록·텔레그램 — 지우지 않음 |
| **DB 전체** | **664MB** | **약 370MB(cron 줄면) ~ 450MB** | **약 420~520MB** | 한도 500MB |

- 2개월 뒤 한도에 다시 가까워질 수 있는 쪽은 사람의 파일 목록(`app_cloud_items`)·사진 목록과 사회운동 2개월치다. 더 줄이려면 옛 표(`app_news_items`·`app_outside_posts`·옛 `app_feed_bodies`)를 통째로 정리하는 C1(옛 표 쓰기 멈춤 → 지우기, `docs/design/news-for-all.md` 4절)이 다음 단계다 — 지금은 공용 표와 옛 표에 같은 글이 두 벌 있다.

## 5. 되돌리기

- 매일 정리: `docs/ops/retention-daily.rollback.sql`(예약·함수·백업 기록 표 지움) → 정리 함수: `docs/20261120130000_news_outside_retention.rollback.sql`(언론 정리 함수를 이전 30일·180일 규칙으로, 사회운동 정리 함수·기록 1행 지움) → Edge news-feed 이전 SHA 재배포.
- **지운 기사·본문·읽음·자세히·실행 기록·백업 사본은 되살릴 수 없다.** 다시 수집되는 글만 돌아온다.
