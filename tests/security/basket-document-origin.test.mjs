import test from "node:test";
import assert from "node:assert/strict";
import {
  driveWrites,
  folder,
  harness,
  note,
  recordDeletes,
} from "../fixtures/document-actions-harness.mjs";
const attachment = {
  drive_file_id: "file-1",
  name: "a.png",
  mime_type: "image/png",
  size: 1,
};
for (
  const flags of [{}, { archived_at: "2026-10-13" }, {
    ai_export_allowed: false,
  }, { links: [] }]
) {
  test(`note reference protects original regardless of note flags ${JSON.stringify(flags)}`, async () => {
    const h = harness({
      notes: { "ws-1": [{ ...note("n1", [attachment]), ...flags }] },
    });
    const r = await h.send();
    assert.equal(r.status, 200);
    assert.equal(r.body.drive_preserved, true);
    assert.equal(r.body.reason, "note_reference");
    assert.equal(driveWrites(h.calls).length, 0);
    assert.equal(recordDeletes(h.calls).length, 2);
  });
}
test("other owned workspace and capped later page references protect original", async () => {
  const rows = Array.from(
    { length: 105 },
    (_, i) => note(`n${i}`, i === 104 ? [attachment] : []),
  );
  const h = harness({
    owned: ["ws-1", "ws-2"],
    pageCap: 7,
    notes: { "ws-2": rows.map((n) => ({ ...n, workspace_id: "ws-2" })) },
  });
  assert.equal((await h.send()).body.drive_preserved, true);
  assert.equal(driveWrites(h.calls).length, 0);
  assert.ok(h.calls.filter((c) => c.path.includes("/app_notes?")).length > 2);
});
test("unreferenced actual private root basket file is preserved", async () => {
  const h = harness({ parents: ["basket-1"], folders: [folder()] });
  const r = await h.send();
  assert.equal(r.status, 200);
  assert.equal(r.body.reason, "private_basket_original");
  assert.equal(driveWrites(h.calls).length, 0);
  assert.equal(
    h.calls.filter((c) =>
      c.method !== "GET" && !c.path.endsWith("/token") &&
      !c.path.includes("/rest/v1/")
    ).length,
    0,
  );
});
test("stored basket folder must be verified at own root, never adopted or created", async () => {
  const h = harness({
    parents: ["basket-1"],
    settings: { "ws-1": "basket-1" },
    folders: [folder()],
  });
  assert.equal((await h.send()).body.drive_preserved, true);
  assert.equal(driveWrites(h.calls).length, 0);
});
for (
  const o of [
    { noRange: true },
    { rangeOverride: "0-0/*" },
    { rangeOverride: "2-2/3" },
    { malformedRows: { app_notes: {} } },
    { dbStatus: { app_notes: 503 } },
    { dbStatus: { app_drive_settings: 503 } },
    { rootStatus: 503 },
    { rootBody: { files: [], incompleteSearch: true } },
    { rootBody: { files: [], nextPageToken: "repeat" } },
    { settings: { "ws-1": "missing-folder" } },
    { folders: [{ ...folder(), permissions: undefined }] },
    {
      folders: [{
        ...folder(),
        permissions: [{ type: "anyone", role: "reader" }],
      }],
    },
    { folders: [{ ...folder(), ownedByMe: false }] },
    {
      settings: { "ws-1": "basket-1" },
      folderBodies: { "basket-1": folder() },
      folders: [],
    },
    { fileBody: { id: "file-1", trashed: false } },
    { notes: { "ws-1": [note("n1", [{ other: "unknown" }])] } },
  ]
) {
  test(`incomplete origin check fails closed ${JSON.stringify(o)}`, async () => {
    const h = harness(o);
    assert.equal((await h.send()).status, 400);
    assert.equal(driveWrites(h.calls).length, 0);
    assert.equal(recordDeletes(h.calls).length, 0);
  });
}
test("client workspace/file/user/classification overrides never control origin", async () => {
  const h = harness({ notes: { "ws-1": [note("n1", [attachment])] } });
  const r = await h.send({
    workspace_id: "foreign",
    file_id: "other",
    user_id: "foreign",
    classification_note: "ordinary",
  });
  assert.equal(r.body.drive_preserved, true);
  assert.equal(driveWrites(h.calls).length, 0);
});
test("document source changes after inspection: no Drive or metadata deletion", async () => {
  const h = harness({
    documents: [{ id: "doc-1", workspace_id: "ws-1", file_id: "file-1" }, {
      id: "doc-1",
      workspace_id: "ws-1",
      file_id: "changed-file",
    }],
  });
  assert.equal((await h.send()).status, 400);
  assert.equal(driveWrites(h.calls).length, 0);
  assert.equal(recordDeletes(h.calls).length, 0);
});
test("metadata deletion unknown is distinct from confirmed success", async () => {
  const h = harness({
    notes: { "ws-1": [note("n1", [attachment])] },
    docDeleteStatus: 503,
  });
  const r = await h.send();
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "RESULT_UNKNOWN");
  assert.equal(driveWrites(h.calls).length, 0);
});
test("root folders are fully paginated before marking an unreferenced original", async () => {
  const h = harness({
    parents: ["basket-2"],
    rootPages: [{ files: [folder()], nextPageToken: "next" }, {
      files: [folder("basket-2")],
    }],
  });
  assert.equal((await h.send()).body.reason, "private_basket_original");
  assert.equal(driveWrites(h.calls).length, 0);
  assert.equal(
    h.calls.filter((c) => new URL(c.path).pathname === "/drive/v3/files")
      .length,
    2,
  );
});
test("owner workspaces on a capped later membership page are included", async () => {
  const h = harness({
    owned: Array.from({ length: 105 }, (_, i) => `ws-${i + 1}`),
    notes: {
      "ws-105": [{ ...note("n1", [attachment]), workspace_id: "ws-105" }],
    },
  });
  assert.equal((await h.send()).body.drive_preserved, true);
  assert.equal(driveWrites(h.calls).length, 0);
});
test("owner check is repeated before any destructive operation", async () => {
  const h = harness({ roles: ["owner", "member"] });
  assert.equal((await h.send()).status, 400);
  assert.equal(driveWrites(h.calls).length, 0);
  assert.equal(recordDeletes(h.calls).length, 0);
});
test("metadata-only document rebind after trash reports a partial result without deleting replacement", async () => {
  const original = { id: "doc-1", workspace_id: "ws-1", file_id: "file-1" };
  const h = harness({
    documents: [original, original, { ...original, file_id: "changed-file" }],
  });
  const r = await h.send();
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "DOCUMENT_CHANGED");
  assert.equal(r.body.drive_result, "trashed");
  assert.equal(recordDeletes(h.calls).length, 0);
});
test("uncertain document deletion preserves Drive and reports token/document phases", async () => {
  const h = harness({
    notes: { "ws-1": [note("n1", [attachment])] },
    docDeleteStatus: 503,
  });
  const r = await h.send();
  assert.equal(r.body.drive_result, "preserved");
  assert.equal(r.body.token_delete_result, "confirmed");
  assert.equal(r.body.document_delete_result, "unknown");
});
test("token deletion unknown prevents document deletion", async () => {
  const h = harness({
    notes: { "ws-1": [note("n1", [attachment])] },
    tokenDeleteStatus: 503,
  });
  const r = await h.send();
  assert.equal(r.body.code, "RESULT_UNKNOWN");
  assert.equal(r.body.token_delete_result, "unknown");
  assert.equal(r.body.document_delete_result, "not_started");
  assert.equal(recordDeletes(h.calls).length, 1);
  assert.equal(driveWrites(h.calls).length, 0);
});
test("conditional document deletion detects a late replacement/zero affected rows", async () => {
  const h = harness({
    notes: { "ws-1": [note("n1", [attachment])] },
    docDeleteEmpty: true,
  });
  const r = await h.send();
  assert.equal(r.body.code, "RESULT_UNKNOWN");
  const request = recordDeletes(h.calls).at(-1),
    params = new URL(request.path).searchParams;
  assert.equal(params.get("workspace_id"), "eq.ws-1");
  assert.equal(params.get("file_id"), "eq.file-1");
  assert.equal(driveWrites(h.calls).length, 0);
});
test("null file document keeps the metadata-only deletion contract", async () => {
  const h = harness({
    documents: [{ id: "doc-1", workspace_id: "ws-1", file_id: null }],
  });
  const r = await h.send();
  assert.equal(r.status, 200);
  assert.equal(r.body.drive_result, "no_file");
  assert.equal(driveWrites(h.calls).length, 0);
  assert.equal(recordDeletes(h.calls).length, 2);
});
test("duplicate note IDs cannot hide a pagination gap", async () => {
  const h = harness({
    pageCap: 1,
    notes: { "ws-1": [note("duplicate"), note("duplicate")] },
  });
  assert.equal((await h.send()).status, 400);
  assert.equal(driveWrites(h.calls).length, 0);
  assert.equal(recordDeletes(h.calls).length, 0);
});
for (
  const doc of [
    { id: "other-doc", workspace_id: "ws-1", file_id: "file-1" },
    { id: "doc-1", workspace_id: "ws-1", file_id: 0 },
  ]
) {
  test(`malformed server document source fails before writes ${JSON.stringify(doc)}`, async () => {
    const h = harness({ documents: [doc] });
    assert.equal((await h.send()).status, 400);
    assert.equal(driveWrites(h.calls).length, 0);
    assert.equal(recordDeletes(h.calls).length, 0);
  });
}
