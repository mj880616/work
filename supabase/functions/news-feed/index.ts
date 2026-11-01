import { createNewsFeedHandler } from "./handler.ts";

// verify_jwt=false(신규, docs/web2-env6b-edge-source.md 5절). 예약 호출(GitHub Actions)은 사용자 로그인이 없다.
// 함수 코드가 예약 입구는 x-news-feed-cron-secret 헤더를 NEWS_FEED_CRON_SECRET과 고정 길이로 비교하고(없거나 틀리면 401),
// 화면 입구(catalog·fill_now·open·translate)는 사용자 로그인을 Auth 서버로 확인한 뒤 owner를 서버에서 확인한다.
// 자동으로 읽는 주소는 코드 카탈로그뿐이고, 채널 기사 원문은 열린 주소 규칙(_shared/feed-fetch.ts openArticleUrl)으로만 읽는다.
Deno.serve(createNewsFeedHandler({ env: (name) => Deno.env.get(name) }));
