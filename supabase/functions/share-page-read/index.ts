import { createClient } from "npm:@supabase/supabase-js@2";
import { createShareReadHandler } from "./handler.ts";

// verify_jwt=false: 링크를 받은 사람은 로그인하지 않는다. 인증 대신 링크 지문으로 한 페이지만 연다.
// 서버 키는 이 함수 안에서만 쓴다. DB에서 service_role은 링크 지문·기한·끔과 페이지 제목·블록·상태 칸만 읽을 수 있다.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

Deno.serve(createShareReadHandler({
  async linkByHash(hash) {
    const { data, error } = await admin.from("app_share_page_links")
      .select("page_id,token_hash,expires_at,disabled_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (error) throw new Error("link lookup failed");
    return data;
  },
  async pageById(id) {
    const { data, error } = await admin.from("app_share_pages")
      .select("id,title,blocks,status")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("page lookup failed");
    return data;
  },
}));
