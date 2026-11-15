import { createCollectorFeedHandler } from "./handler.ts";
import { withWebCors } from "../_shared/web-cors.ts";

// verify_jwt=false(신규, docs/web2-env6b-edge-source.md 5절 36행). 부르는 쪽은 Google 앱 스크립트라 사용자 로그인이 없다.
// 함수 코드가 x-collector-feed-secret 헤더를 COLLECTOR_FEED_SECRET과 고정 길이로 비교하고, 비밀값이 없으면 모두 거절한다.
Deno.serve(withWebCors(createCollectorFeedHandler({ env: (name) => Deno.env.get(name) })));
