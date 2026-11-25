import { createClient } from "npm:@supabase/supabase-js@2";
import { createShareReadHandler } from "./handler.ts";

// verify_jwt=false: 링크를 받은 사람은 로그인하지 않는다. 인증 대신 링크 지문으로 한 페이지만 연다.
// 서버 키는 이 함수 안에서만 쓴다. DB에서 service_role은 링크 지문·기한·끔과 페이지 제목·블록·상태 칸, 사진 기록의 id·페이지·경로 칸,
// 짧은 주소의 지문 두 칸, HTML 판의 페이지·글자·만든 시각 칸, 노트 게시 짝의 페이지·노트 두 칸만 읽을 수 있다.
// 노트 표(app_notes)는 service_role 표 권한이 원래 있다(basket-files 등). 이 함수는 짝이 가리킨 노트 하나의 보여 줄 칸만 고른다.
// BLOG ①: 블로그 세 표(app_blogs·app_blog_boards·app_blog_posts)의 정해진 칸, 블로그 작업공간 함수(app_operator_feature_workspace)도 읽는다.
// NOTE-게시 ③: 노트 사진은 주인 화면이 게시할 때 올린 짝 페이지 사진 기록(app_share_page_media, 위 mediaForPage)으로만 보인다. Drive는 읽지 않는다.
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
  // NOTE-게시: 짝 표는 page_id·note_id 두 칸만 읽을 수 있다(그 밖의 칸 권한 없음). 노트는 보여 줄 칸만 고른다.
  async noteForPage(pageId) {
    const { data, error } = await admin.from("app_note_share_pages")
      .select("note_id")
      .eq("page_id", pageId)
      .maybeSingle();
    if (error) throw new Error("note pair lookup failed");
    return data;
  },
  async noteById(id) {
    const { data, error } = await admin.from("app_notes")
      .select("id,kind,title,raw_text,doc,deleted_at,archived_at")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error("note lookup failed");
    return data;
  },
  // BLOG ①: 블로그 작업공간은 서버 허용 표가 정한다(허용된 작업공간이 정확히 하나일 때만). 세 표는 service_role이 정해진 칸만 읽는다.
  // 노트 표는 짝 노트의 휴지통 여부(id·deleted_at)만 본다(글은 읽지 않음 — 블로그 글은 페이지 사본).
  blog: {
    async workspace() {
      const { data, error } = await admin.rpc("app_operator_feature_workspace", { p_feature: "blog" });
      if (error) throw new Error("blog workspace lookup failed");
      return typeof data === "string" ? data : null;
    },
    async blogByWorkspace(workspaceId) {
      const { data, error } = await admin.from("app_blogs")
        .select("id,workspace_id,title,intro,enabled,indexable")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) throw new Error("blog lookup failed");
      return data;
    },
    async boardsForBlog(blogId) {
      const { data, error } = await admin.from("app_blog_boards")
        .select("id,blog_id,name,sort,public_key")
        .eq("blog_id", blogId)
        .limit(200);
      if (error) throw new Error("blog boards lookup failed");
      return data || [];
    },
    async postsForBoards(boardIds) {
      const { data, error } = await admin.from("app_blog_posts")
        .select("board_id,page_id,note_id,public_key,published_at,republished_at")
        .in("board_id", boardIds)
        .order("published_at", { ascending: false })
        .limit(2000);
      if (error) throw new Error("blog posts lookup failed");
      return data || [];
    },
    async postByKey(key) {
      const { data, error } = await admin.from("app_blog_posts")
        .select("board_id,page_id,note_id,public_key,published_at,republished_at")
        .eq("public_key", key)
        .maybeSingle();
      if (error) throw new Error("blog post lookup failed");
      return data;
    },
    // 주소 길이를 넘지 않게 100개씩 나눠 묻는다.
    async pagesByIds(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await admin.from("app_share_pages")
          .select("id,title,blocks,status")
          .in("id", ids.slice(i, i + 100));
        if (error) throw new Error("blog pages lookup failed");
        out.push(...(data || []));
      }
      return out;
    },
    async notesByIds(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await admin.from("app_notes")
          .select("id,deleted_at")
          .in("id", ids.slice(i, i + 100));
        if (error) throw new Error("blog notes lookup failed");
        out.push(...(data || []));
      }
      return out;
    },
    async mediaForPage(pageId, ids) {
      const { data, error } = await admin.from("app_share_page_media")
        .select("id,storage_path")
        .eq("page_id", pageId)
        .in("id", ids);
      if (error) throw new Error("media lookup failed");
      return data || [];
    },
    async signMedia(path, seconds) {
      const { data, error } = await admin.storage.from("share-page-media").createSignedUrl(path, seconds);
      return error || !data ? null : data.signedUrl;
    },
  },
  async signMedia(path, seconds) {
    const { data, error } = await admin.storage.from("share-page-media").createSignedUrl(path, seconds);
    return error || !data ? null : data.signedUrl;
  },
}));
