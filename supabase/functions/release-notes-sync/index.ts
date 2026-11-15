import { createReleaseNotesSyncHandler } from "./handler.mjs";
import { withWebCors } from "../_shared/web-cors.ts";

// verify_jwt=false(신규, docs/web2-env6b-edge-source.md 5절). 부르는 쪽은 main의 Pages 배포 workflow뿐이고,
// 함수 코드가 GitHub Actions OIDC 토큰(서명·저장소·main·workflow 파일)을 확인한다. 토큰이 없거나 틀리면 401.
// 브라우저 화면은 부르지 않는다. CORS는 다른 Web2 함수와 같은 공용 감싸기(허용 출처만)를 그대로 쓴다.
Deno.serve(withWebCors(createReleaseNotesSyncHandler({ env: (name) => Deno.env.get(name) })));
