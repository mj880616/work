import { createOutsideFeedHandler } from "./handler.ts";

// verify_jwt=false(신규, docs/web2-env6b-edge-source.md 5절 40행). 예약 호출(GitHub Actions)은 사용자 로그인이 없다.
// 함수 코드가 예약 입구는 x-outside-feed-cron-secret 헤더를 OUTSIDE_FEED_CRON_SECRET과 고정 길이로 비교하고(없거나 틀리면 401),
// 화면 입구(catalog·expand)는 사용자 로그인을 Auth 서버로 확인한 뒤 owner를 서버에서 확인한다. 읽는 주소는 코드 카탈로그뿐이다.
Deno.serve(createOutsideFeedHandler({ env: (name) => Deno.env.get(name) }));
