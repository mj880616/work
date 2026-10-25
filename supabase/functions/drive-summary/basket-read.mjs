import { readBoundedJson } from "../_shared/bounded-json.mjs";
// DRIVE-바구니원문제외: only the columns needed to count unclassified memos are read. No raw_text, attachments or
// OCR text, no created_at/updated_at. journal_at: the work-journal memo mark only (metadata.journal_at, browser source
// app/update-journal.js; BASKET-일지로남기기), as its JSON value. No other metadata key is selected.
const HEADER_FIELDS =
  "id,workspace_id,occurred_at,archived_at,ai_export_allowed,journal_at:metadata->journal_at";
const LINK_FIELDS = "id,workspace_id,note_id,status";
const validId = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(v);
const failed = () => new Error("DB_READ_FAILED");
const date = (v) =>
  typeof v === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
// A select entry is "column" or "alias:expression"; the row key is the part before ':'.
const keysOf = (fields) => fields.split(",").map((f) => f.split(":")[0]);
// journal_at is a JSON value (normally a string; anything else is compared by its JSON text).
const same = (a, b, fields) =>
  keysOf(fields).every((k) =>
    a[k] === b[k] || JSON.stringify(a[k]) === JSON.stringify(b[k])
  );

// Notes-only complete Range/count reads. Other tables keep the existing reader.
export function createBasketReader(
  { fetcher, baseUrl, headers, workspaceId, at },
) {
  const scope = { workspace_id: `eq.${workspaceId}` };
  // TRASH-다른삭제 5단계: 서버 키는 RLS(휴지통 숨김 정책)를 건너뛰므로 휴지통 노트(deleted_at 있음)는 여기서 직접 뺀다.
  // 거르기는 조건일 뿐 select 칸은 그대로다(아래 칸 검사 불변). DB 적용 전에는 deleted_at 칸이 없어 PostgREST가 42703으로 거절하므로,
  // 그 거절이면 이 읽기 동안만 거르기를 끄고 처음부터 다시 읽는다(그때는 휴지통 행이 있을 수 없다).
  // 연결(app_record_links)은 거르지 않는다: 연결은 위에서 거른 노트 id로만 조회되므로 휴지통 노트의 연결은 결과에 영향이 없다(basket.mjs).
  let trashFilter = true;
  const NO_TRASH_COLUMN = Symbol("no-trash-column");
  const noteScope = {
    ...scope,
    // app_notes also holds notes/work lines/diary; the read-only copy takes basket rows only.
    kind: "eq.basket",
    archived_at: "is.null",
    ai_export_allowed: "eq.true",
    occurred_at: `lte.${at.toISOString()}`,
  };
  async function scan(table, fields, filters, pageSize, visit, expectedCount) {
    try {
      return await scanOnce(table, fields, filters, pageSize, visit, expectedCount);
    } catch (error) {
      if (error !== NO_TRASH_COLUMN) throw error;
      trashFilter = false;
      return await scanOnce(table, fields, filters, pageSize, visit, expectedCount);
    }
  }
  async function scanOnce(table, fields, filters, pageSize, visit, expectedCount) {
    const live = table === "app_notes" && trashFilter;
    if (live) filters = { ...filters, deleted_at: "is.null" };
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
        if (!response.ok) {
          if (live && response.status === 400) {
            const body = await readBoundedJson(response).catch(() => null);
            if (body?.code === "42703") throw NO_TRASH_COLUMN;
          }
          throw failed();
        }
        rows = await readBoundedJson(response);
      } catch (error) {
        throw error === NO_TRASH_COLUMN ? error : failed();
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
            !keysOf(fields).includes(k)
          ) || keysOf(fields).some((k) => !Object.hasOwn(row, k))
        ) throw failed();
        seen.add(row.id);
        if (table === "app_notes") {
          if (
            !date(row.occurred_at) || row.archived_at !== null ||
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
  return { snapshot, recheck };
}
