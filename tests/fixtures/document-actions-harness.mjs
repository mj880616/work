import { existsSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import {readBoundedJson} from '../../supabase/functions/_shared/bounded-json.mjs';
import {createHwpEdit,HwpEditError} from '../../supabase/functions/_shared/hwp-edit.ts';
const helperURL = new URL(
  "../../supabase/functions/_shared/basket-file-origin.ts",
  import.meta.url,
);
const inspectBasketOriginal = existsSync(helperURL)
  ? (await import(helperURL.href)).inspectBasketOriginal
  : undefined;
const source = stripTypeScriptTypes(
  readFileSync(
    new URL(
      "../../supabase/functions/document-actions/index.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  { mode: "strip" },
).replace(/^import .*basket-file-origin\.ts.*;\s*$/m, "").replace(/^import .*bounded-json\.mjs.*;\s*$/m, "").replace(/^import .*hwp-edit\.ts.*;\s*$/m, "").replace(/^import .*document-text\.ts.*;\s*$/m, "").replace(/^import .*file-rename\.ts.*;\s*$/m, "");
export const folder = (id = "basket-1") => ({
  id,
  name: "Web2 바구니",
  mimeType: "application/vnd.google-apps.folder",
  ownedByMe: true,
  trashed: false,
  parents: ["my-root"],
  permissions: [{ type: "user", role: "owner" }],
});
export const note = (id, attachments = []) => ({
  id,
  workspace_id: "ws-1",
  attachments,
});
export function harness(options = {}) {
  const o = {
    trashed: false,
    patchStatus: 200,
    getStatus: 200,
    role: "owner",
    owned: ["ws-1"],
    notes: {},
    settings: {},
    folders: [],
    ...options,
  };
  const calls = [];
  let handler, docReads = 0, memberReads = 0, rootReads = 0;
  const fetchMock = async (url, init = {}) => {
    const u = new URL(String(url)),
      path = u.href,
      method = init.method || "GET";
    calls.push({
      path,
      method,
      body: init.body,
      headers: new Headers(init.headers),
    });
    if (u.pathname === "/auth/v1/user") {
      return Response.json({ id: "owner-1" }, { status: o.authStatus || 200 });
    }
    if (u.pathname === "/token") {
      return Response.json({ access_token: "drive-token" });
    }
    if (u.pathname.startsWith("/rest/v1/")) {
      const table = u.pathname.split("/").at(-1);
      if (table === "public_policy_drive_config") {
        return Response.json([{
          google_client_id: "c",
          google_client_secret: "s",
          google_refresh_token: "r",
        }]);
      }
      if (table === "app_documents") {
        if (method === "GET") {
          const d =
            o.documents?.[Math.min(docReads++, o.documents.length - 1)] ??
              { id: "doc-1", workspace_id: "ws-1", file_id: "file-1" };
          return Response.json(d === "missing" ? [] : [d]);
        }
        if (o.docDeleteStatus) {
          return Response.json({ message: "delete unavailable" }, {
            status: o.docDeleteStatus,
          });
        }
        return init.headers?.Prefer === "return=representation"
          ? Response.json(o.docDeleteEmpty ? [] : [{ id: "doc-1" }])
          : new Response(null, { status: 204 });
      }
      if (table === "app_drive_download_tokens") {
        return o.tokenDeleteStatus
          ? Response.json({ message: "delete unavailable" }, {
            status: o.tokenDeleteStatus,
          })
          : new Response(null, { status: 204 });
      }
      let rows;
      const workspace = (u.searchParams.get("workspace_id") || "").replace(
        /^eq\./,
        "",
      );
      if (table === "app_workspace_members") {
        const role = o.roles
          ? o.roles[Math.min(memberReads++, o.roles.length - 1)]
          : o.role;
        rows = u.searchParams.has("workspace_id")
          ? (role ? [{ role }] : [])
          : o.owned.map((workspace_id) => ({ workspace_id, role: "owner" }));
      }
      if (table === "app_notes") rows = o.notes[workspace] || [];
      if (table === "app_drive_settings") {
        rows = o.settings[workspace]
          ? [{ basket_folder_id: o.settings[workspace] }]
          : [];
      }
      if (rows) {
        if (o.dbStatus?.[table]) {
          return Response.json({ message: "read unavailable" }, {
            status: o.dbStatus[table],
          });
        }
        const range = new Headers(init.headers).get("Range");
        if (!range) return Response.json(rows);
        const [start, end] = range.split("-").map(Number);
        const page = rows.slice(
          start,
          Math.min(end + 1, start + (o.pageCap || 100)),
        );
        const value = rows.length
          ? `${start}-${start + page.length - 1}/${rows.length}`
          : "*/0";
        if(table === "app_notes" && o.notesResponse) return o.notesResponse(page,value);
        return Response.json(o.malformedRows?.[table] ?? page, {
          headers: o.noRange
            ? {}
            : { "Content-Range": o.rangeOverride || value },
        });
      }
    }
    if (u.pathname === "/drive/v3/files") {
      if (o.rootStatus) return Response.json({}, { status: o.rootStatus });
      return Response.json(
        o.rootPages?.[Math.min(rootReads++, o.rootPages.length - 1)] ||
          o.rootBody || { files: o.folders },
      );
    }
    if (u.pathname.startsWith("/drive/v3/files/")) {
      const id = decodeURIComponent(u.pathname.split("/").at(-1));
      if (method === "PATCH") {
        return Response.json({ trashed: true }, { status: o.patchStatus });
      }
      if (id === "file-1") {
        return Response.json(
          o.fileBody ||
            {
              id,
              trashed: o.trashed,
              parents: o.parents || ["library-1"],
              ownedByMe: true,
            },
          { status: o.getStatus },
        );
      }
      const f = o.folderBodies?.[id] || o.folders.find((f) => f.id === id);
      return Response.json(f || {}, { status: f ? 200 : 404 });
    }
    throw Error(`Unexpected ${method} ${u.pathname}`);
  };
  const Deno = {
    env: {
      get: (key) =>
        ({
          SUPABASE_URL: "https://sb.example",
          SUPABASE_SERVICE_ROLE_KEY: "service",
        })[key],
    },
    serve: (fn) => {
      handler = fn;
    },
  };
  new Function("Deno", "fetch", "console", "inspectBasketOriginal", "readBoundedJson", "createHwpEdit", "HwpEditError", "createDocumentText", source)(
    Deno,
    fetchMock,
    { error() {} },
    inspectBasketOriginal,
    readBoundedJson,
    createHwpEdit,
    HwpEditError,
  );
  return {
    calls,
    send: async (body = {}) => {
      const r = await handler(
        new Request("https://sb.example/functions/v1/document-actions", {
          method: "POST",
          headers: { Authorization: "Bearer user-token" },
          body: JSON.stringify({
            action: "delete",
            document_id: "doc-1",
            ...body,
          }),
        }),
      );
      return { status: r.status, body: await r.json() };
    },
  };
}
export const driveWrites = (calls) =>
  calls.filter((c) => c.path.includes("/drive/v3/") && c.method !== "GET");
export const recordDeletes = (calls) =>
  calls.filter((c) => c.method === "DELETE" && c.path.includes("/rest/v1/"));
