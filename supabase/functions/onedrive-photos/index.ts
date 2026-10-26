import { createClient } from "npm:@supabase/supabase-js@2";
import { createOneDriveHandler } from "./handler.ts";

// verify_jwt=true(신규, docs/web2-env6b-edge-source.md 5절 37행). 로그인한 소유자만 부른다.
// 함수 코드도 Auth getUser + 작업공간 owner 확인을 다시 한다(토큰은 service role로만 읽고, 응답에 싣지 않는다).
// 비밀값(ONEDRIVE_CLIENT_ID / ONEDRIVE_CLIENT_SECRET / ONEDRIVE_REDIRECT_URI)이 없으면 '연결 준비 안 됨'으로 안전하게 멈춘다.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
Deno.serve(createOneDriveHandler(admin, { env: (name) => Deno.env.get(name) }));
