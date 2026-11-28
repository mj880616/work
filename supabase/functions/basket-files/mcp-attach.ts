// MCP-Claude쓰기 ③ (설계 docs/design/mcp-claude-write.md 11절, 사용자 결정 D-W2 2026-11-28 "지금 열기 / 상한도 높여").
// basket-files?action=mcp-attach — 위임 열쇠(Claude)를 받는 basket-files의 유일한 길. 다른 동작은 handler.ts에서 지금처럼 위임 열쇠를 401.
//
// 순서(바꾸지 않는다):
//   ① 이 길은 위임 열쇠만 받는다(client_id 없는 일반 로그인 열쇠는 401 — 화면은 기존 올리기 길을 쓴다).
//   ② Auth GET /auth/v1/oauth/userinfo로 열쇠 확인(sub 일치). /auth/v1/user는 Supabase 수정(#2898) 뒤 위임 열쇠에 403이라 쓰지 않는다.
//   ③ 같은 열쇠로 DB app_mcp_attach_check(문지기: 허용 클라이언트·운영자 기능 mcp_write·연결·쓰기 스위치·상한, 대상·판·첨부 수·하루 상한) → 기록 1행.
//      ①~③이 통과하기 전에는 서버 키 요청·Drive 요청이 하나도 나가지 않는다(시험으로 지킴).
//   ④ 서버 키로 작업공간 owner 확인 → 그 작업공간 Drive 연결 → 기존 폴더 고르기(attach-common.ts) →
//      (가) 받은 파일을 기존 drive.upload로 / (나) 내 소유 Drive 파일을 확인(ownedFileInfo) 뒤 복사(copyInto).
//   ⑤ 서버 키로 DB app_mcp_attach_commit(같은 기록 행·같은 판일 때만, 한 트랜잭션). 확실히 거절되면 올린 파일을 지운다(기존 실패 정리와 같은 길).
// 작업공간·사용자 값은 요청에서 받지 않는다(사용자 = Auth가 확인한 sub, 작업공간 = 그 사람이 owner인 작업공간).
import { isDelegatedToken } from "../_shared/delegated-token-guard.mjs";
import { createDriveUpload, UploadError } from "../_shared/drive-upload.ts";
import type { UploadAdmin, UploadLog } from "../_shared/drive-upload.ts";
import { attachmentFolder, MAX_FILE, validateFiles } from "./attach-common.ts";

export type McpAttachEnv = { supabaseUrl: string; anonKey: string };
type RpcAdmin = UploadAdmin & {
  rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any; status?: number }>;
};

export const MCP_ATTACH_LIMITS = Object.freeze({
  direct: 8 * 1024 * 1024, // (가) 직접 올리기 파일 하나
  drive: MAX_FILE, // (나) Drive 파일(기존 첨부 상한 100 MB)
  body: 12 * 1024 * 1024, // 요청 몸통(8 MB base64 ≈ 10.7 MB + 여유)
});
const TOOLS = new Set(["web2_attach_file", "web2_attach_drive_file"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,255}$/;
const MIME = /^[^/\s]{1,127}\/[^/\s]{1,127}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
// DB 거절 문구 → 일상어 코드(DB 오류 원문은 내지 않는다).
const DB_CODES = ["RATE_LIMITED", "DISCONNECTED", "WRITE_OFF", "NOT_FOUND", "CHANGED", "LOCKED", "TOO_LARGE", "TOO_MANY", "BAD_INPUT", "NOT_ALLOWED"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
const refuse = (status: number, code: string) => json({ ok: false, code }, status);

function claimsOf(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1] || "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function readCapped(req: Request, max: number): Promise<string | null> {
  const length = Number(req.headers.get("Content-Length") || 0);
  if (length > max) return null;
  const reader = req.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > max) {
      try { await reader.cancel(); } catch { /* 이미 끊김 */ }
      return null;
    }
    parts.push(chunk.value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return new TextDecoder().decode(all);
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> | null {
  if (!B64.test(text) || text.length % 4 !== 0) return null;
  try {
    const bin = atob(text);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number) =>
  typeof v === "string" && v.trim().length >= 1 && [...v.trim()].length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : null;

export function createMcpAttachHandler(
  admin: RpcAdmin,
  options: { fetch?: typeof fetch; log?: UploadLog; env?: McpAttachEnv } = {},
) {
  const request = options.fetch ?? globalThis.fetch;
  const log = options.log ?? ((code: string) => console.error(code));
  const drive = createDriveUpload(admin, { fetch: request, log });

  return async (req: Request): Promise<Response> => {
    const env = options.env;
    if (!env?.supabaseUrl || !env?.anonKey) return refuse(503, "UPSTREAM_UNAVAILABLE");
    if (req.method !== "POST") return refuse(405, "BAD_INPUT");
    // ① 위임 열쇠만.
    const match = (req.headers.get("Authorization") || "").match(/^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/);
    const token = match ? match[1] : "";
    if (!token || !isDelegatedToken(token)) return refuse(401, "NOT_ALLOWED");
    const claims = claimsOf(token);
    if (!claims || typeof claims.sub !== "string" || !UUID.test(claims.sub)) return refuse(401, "NOT_ALLOWED");
    const userId = claims.sub;
    // ② Auth OAuth 서버로 열쇠 확인.
    try {
      const res = await request(`${env.supabaseUrl}/auth/v1/oauth/userinfo`, {
        headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
        redirect: "error",
      });
      const info = res.ok ? await res.json().catch(() => null) : null;
      if (!info || info.sub !== userId) return refuse(401, "NOT_ALLOWED");
    } catch {
      return refuse(503, "UPSTREAM_UNAVAILABLE");
    }
    if ((req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
      return refuse(415, "BAD_INPUT");
    }
    const text = await readCapped(req, MCP_ATTACH_LIMITS.body).catch(() => null);
    if (text === null) return refuse(413, "TOO_LARGE");
    let body: any;
    try { body = JSON.parse(text); } catch { return refuse(400, "BAD_INPUT"); }
    const tool = body?.tool, args = body?.arguments;
    if (!TOOLS.has(tool) || !args || typeof args !== "object" || Array.isArray(args)) return refuse(400, "BAD_INPUT");
    const direct = tool === "web2_attach_file";
    const keys = direct
      ? ["kind", "id", "base_version", "file_name", "mime_type", "content_base64"]
      : ["kind", "id", "base_version", "drive_file_id"];
    if (Object.keys(args).some((k) => !keys.includes(k)) || keys.some((k) => !(k in args))) return refuse(400, "BAD_INPUT");
    const kind = args.kind, id = args.id, base = str(args.base_version, 64);
    if (!["note", "update"].includes(kind) || typeof id !== "string" || !UUID.test(id) || !base) return refuse(400, "BAD_INPUT");
    let file: File | null = null, driveFileId = "";
    if (direct) {
      const name = str(args.file_name, 255), mime = str(args.mime_type, 255);
      if (!name || !mime || !MIME.test(mime) || typeof args.content_base64 !== "string") return refuse(400, "BAD_INPUT");
      if (args.content_base64.length > Math.ceil(MCP_ATTACH_LIMITS.direct / 3) * 4) return refuse(413, "TOO_LARGE");
      const bytes = decodeBase64(args.content_base64);
      if (!bytes || !bytes.length) return refuse(400, "BAD_INPUT");
      if (bytes.length > MCP_ATTACH_LIMITS.direct) return refuse(413, "TOO_LARGE");
      file = new File([bytes], name, { type: mime });
      try { validateFiles([file]); } catch { return refuse(400, "BAD_INPUT"); }
    } else {
      if (typeof args.drive_file_id !== "string" || !DRIVE_ID.test(args.drive_file_id)) return refuse(400, "BAD_INPUT");
      driveFileId = args.drive_file_id;
    }

    // ③ 같은 열쇠로 DB 확인(문지기). 파일 내용은 보내지 않는다.
    const checkArgs = direct
      ? { kind, id, base_version: base, file_name: file!.name, mime_type: file!.type, size_bytes: file!.size }
      : { kind, id, base_version: base, drive_file_id: driveFileId };
    let check: any;
    try {
      const res = await request(`${env.supabaseUrl}/rest/v1/rpc/app_mcp_attach_check`, {
        method: "POST",
        headers: { apikey: env.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_tool: tool, p_args: checkArgs }),
        redirect: "error",
      });
      check = await res.json().catch(() => null);
      if (!res.ok) {
        const message = String(check?.message || "");
        const code = DB_CODES.find((c) => message.includes(c)) || (res.status === 401 || res.status === 403 ? "NOT_ALLOWED" : "UPSTREAM_UNAVAILABLE");
        return refuse(code === "UPSTREAM_UNAVAILABLE" ? 503 : code === "RATE_LIMITED" ? 429 : 403, code);
      }
    } catch {
      return refuse(503, "UPSTREAM_UNAVAILABLE");
    }
    if (!check || !UUID.test(String(check.log_id || "")) || check.id !== id || !["note", "basket"].includes(check.note_kind) || typeof check.version !== "string") {
      return refuse(503, "UPSTREAM_UNAVAILABLE");
    }

    // ④ 여기서부터 서버 키·Drive.
    let driveToken = "";
    let made = "";
    let stage = "authorize";
    try {
      const { data: member, error: memberError } = await admin.from("app_workspace_members")
        .select("workspace_id,role").eq("user_id", userId).maybeSingle();
      if (memberError) throw new UploadError(503, "authorize_unavailable", stage);
      if (member?.role !== "owner") return refuse(403, "NOT_ALLOWED");
      stage = "drive_token";
      driveToken = await drive.driveToken(member.workspace_id);
      stage = "drive_folder";
      const folder = await attachmentFolder(drive, member.workspace_id, driveToken, check.note_kind);
      let attachment: { drive_file_id: string; file_name: string; mime_type: string; size_bytes: number };
      if (file) {
        stage = "drive_upload";
        made = await drive.upload(file, folder, driveToken);
        attachment = { drive_file_id: made, file_name: file.name, mime_type: file.type, size_bytes: file.size };
      } else {
        stage = "drive_file";
        const info = await drive.ownedFileInfo(driveFileId, driveToken, MCP_ATTACH_LIMITS.drive);
        stage = "drive_copy";
        made = await drive.copyInto(info.id, info.name, folder, driveToken);
        attachment = { drive_file_id: made, file_name: info.name, mime_type: info.mimeType, size_bytes: info.size };
      }
      // ⑤ 같은 기록 행·같은 판일 때만 첨부 칸에 더한다(서버 키 전용 함수).
      stage = "note_save";
      if (typeof admin.rpc !== "function") throw new UploadError(503, "note_save_failed", stage);
      const saved = await admin.rpc("app_mcp_attach_commit", {
        p_log_id: check.log_id, p_user_id: userId, p_base: check.version, p_file: attachment,
      });
      if (saved.error) {
        const message = String(saved.error.message || "");
        const code = DB_CODES.find((c) => message.includes(c));
        const definite = /^[0-9A-Z]{5}$/.test(String(saved.error.code || "")) || Boolean(code);
        if (definite) {
          await drive.discardUploadedFile(made, driveToken);
          made = "";
          return refuse(code === "RATE_LIMITED" ? 429 : 409, code || "CHANGED");
        }
        // 결과를 모름(전송 오류 뒤 저장됐을 수 있음): 다시 읽어 붙었으면 성공, 아니면 파일을 남기고 알린다.
        const { data: row } = await admin.from("app_notes").select("id,attachments,updated_at")
          .eq("id", id).eq("workspace_id", member.workspace_id).is("deleted_at", null).maybeSingle();
        if (Array.isArray(row?.attachments) && row.attachments.some((a: any) => a?.drive_file_id === made)) {
          return json({ ok: true, result: { ok: true, kind, id, version: row.updated_at, action: "attach" }, file: { ...attachment } });
        }
        log("mcp_attach_result_unknown");
        return refuse(503, "UPSTREAM_UNAVAILABLE");
      }
      const result = saved.data || {};
      return json({
        ok: true,
        result: { ok: true, kind, id, version: result.version, action: "attach" },
        file: { file_name: attachment.file_name, mime_type: attachment.mime_type, size_bytes: attachment.size_bytes },
      });
    } catch (error) {
      if (made && driveToken && stage !== "note_save") await drive.discardUploadedFile(made, driveToken);
      const e = error instanceof UploadError ? error : new UploadError(500, "internal_error", stage);
      log(e.code);
      const code = e.code === "drive_file_not_found" ? "NOT_FOUND"
        : e.code === "drive_file_not_owned" ? "NOT_OWNED"
        : e.code === "drive_file_type" || e.code === "file_metadata_invalid" ? "BAD_FILE"
        : e.code === "file_too_large" ? "TOO_LARGE"
        : e.status === 424 ? "DRIVE_NOT_CONNECTED"
        : "UPSTREAM_UNAVAILABLE";
      return refuse(code === "UPSTREAM_UNAVAILABLE" ? 503 : e.status, code);
    }
  };
}
