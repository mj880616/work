import { createCloudFilesHandler } from "./handler.ts";
import { withWebCors } from "../_shared/web-cors.ts";

// verify_jwt=true(신규, docs/web2-env6b-edge-source.md 5절 43행). 로그인한 운영자 작업공간 owner만 부른다.
// 함수 코드도 Auth 확인 + owner + 운영자 기능(files) + (구글) Drive 연결 주인 / (원드라이브) 그 작업공간 연결을 다시 확인한다(handler.ts 맨 위).
// 토큰은 service role로만 읽고 응답에 싣지 않는다. 새 비밀값 없음(원드라이브 ONEDRIVE_* · Supabase 기본값을 그대로 씀).
Deno.serve(withWebCors(createCloudFilesHandler({ env: (name) => Deno.env.get(name) })));
