import { withWebCors } from "../_shared/web-cors.ts";
import { createAccountDeleteHandler } from "./handler.ts";

// verify_jwt=true(신규, docs/web2-env6b-edge-source.md 5절 48행). 로그인한 사람만 부르고 예약 호출이 없다.
// 함수 코드도 Auth 확인 + 위임 열쇠 거절을 다시 하고(handler.ts), 무엇을 지울지는 DB 함수가 사용자 토큰으로 정한다.
// 새 비밀값 없음(Supabase 기본값 SUPABASE_URL·SUPABASE_ANON_KEY·SUPABASE_SERVICE_ROLE_KEY만 읽음). 서버 키는 사진 버킷 파일 지우기에만 쓴다.
Deno.serve(withWebCors(createAccountDeleteHandler({ env: (name: string) => Deno.env.get(name) })));
