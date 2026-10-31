import { createGdriveHandler } from "./handler.ts";

// verify_jwt=true(신규, docs/web2-env6b-edge-source.md 5절 39행). 로그인한 운영자 작업공간 owner만 부른다.
// 함수 코드도 Auth 확인 + owner + 운영자 기능(gdrive_photos) + Drive 연결 주인 확인을 다시 한다(handler.ts 맨 위).
// Drive 토큰은 service role로만 읽고 응답에 싣지 않는다. 새 비밀값 없음.
Deno.serve(createGdriveHandler({ env: (name) => Deno.env.get(name) }));
