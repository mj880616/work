// S71-05: 드라이브 맞추기(_shared/library-mirror.mjs mirrorLibrary)와 자료실 열 때 따라가기(library-files drive-auto planFollow)가
// 같은 판정(followTarget)을 써서, 어느 쪽이 먼저 돌아도 끝 자리가 같은지 본다. 가짜 드라이브·가짜 DB, 값은 모두 가짜.
// 고치기 전: 맞추기가 먼저 돌면 드라이브에서 사람이 옮긴 파일을 옛 자리로 되돌렸다(아래 '드라이브에서 옮김' 시험이 실패).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLDER_MIME, MIRROR_MARK, followTarget, mirrorLibrary } from '../supabase/functions/_shared/library-mirror.mjs';
import { FOLLOW_QUIET_MS, planFollow } from '../supabase/functions/library-files/drive-auto.mjs';

const LIB = 'libraryFolder0001', PA = 'pairA00000000001', PB = 'pairB00000000002', FILE = 'fileX00000000001';
const F = n => `f0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const DOC = 'a0000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-11-26T12:00:00Z');
const OLD = new Date(NOW - FOLLOW_QUIET_MS - 60000).toISOString();
const FRESH = new Date(NOW - 60000).toISOString();

function world({ driveParent, appFolder, movedAt }) {
  const drive = new Map([
    [LIB, { name: '자료실', parents: ['rootFolder000001'], mimeType: FOLDER_MIME, appProperties: { [MIRROR_MARK]: '1' } }],
    [PA, { name: 'A', parents: [LIB], mimeType: FOLDER_MIME }],
    [PB, { name: 'B', parents: [LIB], mimeType: FOLDER_MIME }],
    [FILE, { name: 'x.pdf', parents: [driveParent], mimeType: 'application/pdf' }],
  ]);
  const folders = [
    { id: F(1), parent_id: null, name: 'A', sort_order: 1, drive_folder_id: PA },
    { id: F(2), parent_id: null, name: 'B', sort_order: 2, drive_folder_id: PB },
  ];
  const items = [{ document_id: DOC, folder_id: appFolder, moved_at: movedAt }];
  const documents = [{ id: DOC, file_id: FILE }];
  return { drive, folders, items, documents };
}
const view = (id, m) => ({ id, name: m.name, mimeType: m.mimeType, parents: [...m.parents], appProperties: m.appProperties ? { ...m.appProperties } : undefined });
async function runMirror(w) {
  const drive = {
    async get(id) { const m = w.drive.get(id); return m ? view(id, m) : null; },
    async list(ps) { return [...w.drive].filter(([, m]) => m.parents.some(p => ps.includes(p))).map(([id, m]) => view(id, m)); },
    async children(p) { return this.list([p]); },
    async createFolder() { throw new Error('no create expected'); },
    async patch(id, p) {
      const m = w.drive.get(id);
      if (p.name) m.name = p.name;
      if (p.appProperties) m.appProperties = { ...(m.appProperties || {}), ...p.appProperties };
      if (p.addParents) { const rm = String(p.removeParents || '').split(','); m.parents = [...m.parents.filter(x => !rm.includes(x)), p.addParents]; }
    },
  };
  const db = {
    async folders() { return w.folders.map(f => ({ ...f })); },
    async items() { return w.items.map(i => ({ ...i })); },
    async documents() { return w.documents; },
    async setDrive() { return { ok: true }; },
    async renameFolder() {}, async moveFolder() {},
  };
  return mirrorLibrary({ libraryId: LIB, db, drive, clock: () => NOW });
}
// 따라가기 한 번: drive-auto가 읽는 모양 그대로 planFollow에 넣고, 나온 옮기기를 DB에 적는다(DB 트리거처럼 옮긴 시각도 새로).
function runFollow(w) {
  const files = [...w.drive].filter(([, m]) => m.mimeType !== FOLDER_MIME).map(([id, m]) => ({ id, ...m }));
  const appPair = new Map(w.folders.map(f => [f.id, f.drive_folder_id]));
  const pairOf = new Map(w.folders.map(f => [f.drive_folder_id, f.id]));
  const plan = planFollow({ docs: w.documents, files, items: w.items, appPair, pairOf, libraryId: LIB, now: NOW });
  for (const m of plan.moves) { const it = w.items.find(i => i.document_id === m.docId && i.folder_id === m.from); if (it) { it.folder_id = m.to; it.moved_at = new Date(NOW).toISOString(); } }
  return plan;
}
const final = w => ({ drive: w.drive.get(FILE).parents.join(','), app: w.items[0].folder_id });

for (const [name, setup, expect] of [
  ['드라이브에서 사람이 옮김(옮긴 시각 옛날) → 자료실이 드라이브를 따라간다', { driveParent: PB, appFolder: F(1), movedAt: OLD }, { drive: PB, app: F(2) }],
  ['앱에서 막 옮김(옮긴 시각 30분 안) → 드라이브가 앱을 따라간다', { driveParent: PA, appFolder: F(2), movedAt: FRESH }, { drive: PB, app: F(2) }],
  ['드라이브에서 자료실 맨 위로 뺌 → 따라가기는 쉬고 맞추기가 앱 자리로(지금까지와 같음)', { driveParent: LIB, appFolder: F(1), movedAt: OLD }, { drive: PA, app: F(1) }],
]) {
  test(`S71-05 순서가 바뀌어도 같음: ${name}`, async () => {
    const a = world(setup), b = world(setup);
    await runMirror(a); runFollow(a); await runMirror(a); runFollow(a); // 맞추기 먼저
    runFollow(b); await runMirror(b); runFollow(b); await runMirror(b); // 따라가기 먼저
    assert.deepEqual(final(a), expect, '맞추기 먼저');
    assert.deepEqual(final(b), expect, '따라가기 먼저');
  });
}

test('S71-05 맞추기는 드라이브가 이기는 자료를 drive_wins로 세고 옮기지 않는다', async () => {
  const w = world({ driveParent: PB, appFolder: F(1), movedAt: OLD });
  const r = await runMirror(w);
  assert.equal(r.drive_wins, 1);
  assert.equal(r.files_moved, 0);
  assert.deepEqual(w.drive.get(FILE).parents, [PB], '사람이 옮긴 자리를 되돌리지 않음');
});

test('S71-05 followTarget 한 곳 규칙: 옮긴 시각을 모르면(DB 칸 없음) 드라이브가 이기지 않음 → 맞추기는 지금처럼 앱 기준', async () => {
  const appPair = new Map([[F(1), PA], [F(2), PB]]), pairOf = new Map([[PA, F(1)], [PB, F(2)]]);
  assert.deepEqual(followTarget({ item: { folder_id: F(1), moved_at: OLD }, parents: [PB], appPair, pairOf, libraryId: LIB, now: NOW }), { to: F(2) });
  assert.equal(followTarget({ item: { folder_id: F(1) }, parents: [PB], appPair, pairOf, libraryId: LIB, now: NOW }).skip, 'unknown');
  assert.equal(followTarget({ item: null, parents: [PB], appPair, pairOf, libraryId: LIB, now: NOW }).skip, 'loose');
  const w = world({ driveParent: PB, appFolder: F(1), movedAt: undefined });
  delete w.items[0].moved_at;
  await runMirror(w);
  assert.deepEqual(w.drive.get(FILE).parents, [PA]);
});
