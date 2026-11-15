import { createReleaseNotesSyncHandler } from "./handler.mjs";

// verify_jwt=false(신규, docs/web2-env6b-edge-source.md 5절). 부르는 쪽은 main의 Pages 배포 workflow뿐이고,
// 함수 코드가 GitHub Actions OIDC 토큰(서명·저장소·main·workflow 파일)을 확인한다. 토큰이 없거나 틀리면 401.
// 브라우저 화면은 부르지 않으므로 CORS 머리를 두지 않는다.
Deno.serve(createReleaseNotesSyncHandler({ env: (name) => Deno.env.get(name) }));
