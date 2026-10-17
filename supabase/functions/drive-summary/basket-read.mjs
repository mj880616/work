import { readBoundedJson } from "../_shared/bounded-json.mjs";
const HEADER_FIELDS =
  "id,workspace_id,occurred_at,created_at,updated_at,archived_at,ai_export_allowed";
const LINK_FIELDS = "id,workspace_id,note_id,status";
const CONTENT_FIELDS = `${HEADER_FIELDS},raw_text,attachments`;
const validId = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(v);
const failed = () => new Error("DB_READ_FAILED");
const date = (v) =>
  typeof v === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
const same = (a, b, fields) => fields.split(",").every((k) => a[k] === b[k]);

// Notes-only complete Range/count reads. Other tables keep the existing reader.
export function createBasketReader(
  { fetcher, baseUrl, headers, workspaceId, at },
) {
  const scope = { workspace_id: `eq.${workspaceId}` };
  const noteScope = {
    ...scope,
    // app_notes also holds notes/work lines/diary; the read-only copy takes basket rows only.
    kind: "eq.basket",
    archived_at: "is.null",
    ai_export_allowed: "eq.true",
    occurred_at: `lte.${at.toISOString()}`,
  };
  async function scan(table, fields, filters, pageSize, visit, expectedCount) {
    const seen = new Set();
    let start = 0, total;
    while (true) {
      const q = new URLSearchParams({
        ...filters,
        select: fields,
        order: "id.asc",
      });
      let response, rows;
      try {
        response = await fetcher(`${baseUrl}/rest/v1/${table}?${q}`, {
          headers: {
            ...headers,
            Prefer: "count=exact",
            Range: `${start}-${start + pageSize - 1}`,
            "Range-Unit": "items",
          },
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw failed();
        rows = await readBoundedJson(response);
      } catch {
        throw failed();
      }
      if (!Array.isArray(rows)) throw failed();
      const range = response.headers.get("Content-Range");
      if (range === "*/0" && rows.length === 0 && start === 0) {
        if (expectedCount !== undefined && expectedCount !== 0) throw failed();
        return 0;
      }
      const match = /^(\d+)-(\d+)\/(\d+)$/.exec(range || "");
      if (!match) throw failed();
      const [first, end, count] = match.slice(1).map(Number);
      if (
        ![first, end, count].every(Number.isSafeInteger) || first !== start ||
        end < first || end >= count || end > start + pageSize - 1 ||
        rows.length !== end - first + 1 ||
        (total !== undefined && count !== total) ||
        (expectedCount !== undefined && count !== expectedCount)
      ) throw failed();
      if (count >= 100000) throw new Error("DB_READ_LIMIT");
      total = count;
      for (const row of rows) {
        if (
          !row || typeof row !== "object" || Array.isArray(row) ||
          !validId(row.id) || seen.has(row.id) ||
          row.workspace_id !== workspaceId || Object.keys(row).some((k) =>
            !fields.split(",").includes(k)
          ) || fields.split(",").some((k) => !Object.hasOwn(row, k))
        ) throw failed();
        seen.add(row.id);
        if (table === "app_notes") {
          if (
            !date(row.occurred_at) || !date(row.created_at) ||
            !date(row.updated_at) || row.archived_at !== null ||
            row.ai_export_allowed !== true ||
            Date.parse(row.occurred_at) > at.getTime()
          ) throw failed();
        } else if (!validId(row.note_id) || typeof row.status !== "string") {
          throw failed();
        }
        visit(row);
      }
      start = end + 1;
      if (start === total) return total;
    }
  }
  async function snapshot() {
    const notes = new Map(), links = new Map();
    await scan(
      "app_notes",
      HEADER_FIELDS,
      noteScope,
      500,
      (r) => notes.set(r.id, r),
    );
    await scan(
      "app_record_links",
      LINK_FIELDS,
      { ...scope, note_id: "not.is.null" },
      500,
      (r) => links.set(r.id, r),
    );
    return { notes, links };
  }
  async function recheck(saved) {
    for (
      const [table, fields, filters, map] of [
        ["app_notes", HEADER_FIELDS, noteScope, saved.notes],
        [
          "app_record_links",
          LINK_FIELDS,
          { ...scope, note_id: "not.is.null" },
          saved.links,
        ],
      ]
    ) {
      await scan(table, fields, filters, 500, (r) => {
        const old = map.get(r.id);
        if (!old || !same(old, r, fields)) throw failed();
      }, map.size);
    }
  }
  async function* content(saved, selected) {
    for (let i = 0; i < selected.length; i += 5) {
      const ids = selected.slice(i, i + 5).map((r) => r.id), batch = new Map();
      if (!ids.every(validId)) throw failed();
      await scan(
        "app_notes",
        CONTENT_FIELDS,
        { ...noteScope, id: `in.(${ids.join(",")})` },
        5,
        (r) => {
          const old = saved.notes.get(r.id);
          if (
            !ids.includes(r.id) || !old || !same(old, r, HEADER_FIELDS)
          ) throw failed();
          batch.set(r.id, r);
        },
        ids.length,
      );
      for (const id of ids) yield batch.get(id);
      // The only raw/OCR objects retained by this generator are this <=5 batch.
    }
  }
  return { snapshot, recheck, content };
}
