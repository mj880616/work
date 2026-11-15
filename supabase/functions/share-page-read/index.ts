import { createClient } from "npm:@supabase/supabase-js@2";
import { createShareReadHandler } from "./handler.ts";

// verify_jwt=false: 링크를 받은 사람은 로그인하지 않는다. 인증 대신 링크 지문으로 한 페이지만 연다.
// 서버 키는 이 함수 안에서만 쓴다. DB에서 service_role은 링크 지문·기한·끔과 페이지 제목·블록·상태 칸, 사진 기록의 id·페이지·경로 칸,
// 짧은 주소의 지문 두 칸, HTML 판의 페이지·글자·만든 시각 칸만 읽을 수 있다.
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
  async mediaForPage(pageId, ids) {
    const { data, error } = await admin.from("app_share_page_media")
      .select("id,storage_path")
      .eq("page_id", pageId)
      .in("id", ids);
    if (error) throw new Error("media lookup failed");
    return data || [];
  },
  // SHARE-보관함·HTML공유: 짧은 주소는 지문으로만 찾고(이름·글자 원문 칸은 service_role이 못 읽음), HTML은 그 페이지의 가장 최근 판 하나.
  async slugByHash(hash) {
    const { data, error } = await admin.from("app_share_page_slugs")
      .select("token_hash,slug_hash")
      .eq("slug_hash", hash)
      .maybeSingle();
    if (error) throw new Error("slug lookup failed");
    return data;
  },
  async latestHtml(pageId) {
    const { data, error } = await admin.from("app_share_page_html")
      .select("html")
      .eq("page_id", pageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("html lookup failed");
    return data ? data.html : null;
  },
  async signMedia(path, seconds) {
    const { data, error } = await admin.storage.from("share-page-media").createSignedUrl(path, seconds);
    return error || !data ? null : data.signedUrl;
  },
}));
