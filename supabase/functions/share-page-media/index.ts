import { createClient } from "npm:@supabase/supabase-js@2";
import { createShareMediaHandler, type MediaRow } from "./handler.ts";

// verify_jwt=true(신규, docs/web2-env6b-edge-source.md 5절). 코드에서도 로그인을 다시 확인한다.
// 소유 확인·사진 기록 읽기·쓰기는 호출자의 로그인 토큰으로 DB(owner RLS)가 한다. 서버 키는 비공개 버킷 읽기·쓰기에만 쓴다.
const URL = Deno.env.get("SUPABASE_URL")!;
const BUCKET = "share-page-media";
const admin = createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const asUser = (token: string) => createClient(URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { Authorization: `Bearer ${token}` } },
});

Deno.serve(createShareMediaHandler({
  async userId(token) {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  },
  async pageWorkspace(token, pageId) {
    const { data, error } = await asUser(token).from("app_share_pages").select("workspace_id").eq("id", pageId).maybeSingle();
    if (error) throw new Error("page lookup failed");
    return data ? String(data.workspace_id) : null;
  },
  async insertRow(token, row) {
    const { error } = await asUser(token).from("app_share_page_media").insert(row);
    return !error;
  },
  async rowsFor(token, pageId, ids) {
    if (!ids.length) return [];
    const { data, error } = await asUser(token).from("app_share_page_media").select("id,page_id,storage_path").eq("page_id", pageId).in("id", ids);
    if (error) throw new Error("media lookup failed");
    return (data || []) as MediaRow[];
  },
  async rowById(token, id) {
    const { data, error } = await asUser(token).from("app_share_page_media").select("id,page_id,storage_path").eq("id", id).maybeSingle();
    if (error) throw new Error("media lookup failed");
    return (data as MediaRow | null) ?? null;
  },
  async deleteRow(token, id) {
    const { error } = await asUser(token).from("app_share_page_media").delete().eq("id", id);
    return !error;
  },
  async putFile(path, bytes) {
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false, cacheControl: "300" });
    return !error;
  },
  async removeFile(path) {
    const { error } = await admin.storage.from(BUCKET).remove([path]);
    return !error;
  },
  async signFile(path, seconds) {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, seconds);
    return error || !data ? null : data.signedUrl;
  },
}));
