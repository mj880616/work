// S69-52 ①: 자료실 폴더 ↔ 드라이브 '자료실' 폴더 1:1 맞추기 — 어긋남 찾기·맞추기·되돌리기(library-drive-check.mjs)와
// 드라이브에서 바꾼 것을 자료실이 따라가기(library-mirror.mjs decideFolder). 가짜 드라이브·가짜 DB, 값은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveFail, FOLDER_MIME, MIRROR_MARK, SYNC_HOLD, SYNC_NAME, SYNC_PARENT, decideFolder, mirrorLibrary, nameSig } from '../supabase/functions/_shared/library-mirror.mjs';
import { MARK, fixLibrary, packName, parseCheckBody, scanLibrary, undoLibrary, unpackName } from '../supabase/functions/_shared/library-drive-check.mjs';

const LIB = 'libraryFolder0001';
let seq = 0;
const nid = p => `${p}${String(++seq).padStart(12, '0')}`;
const F = n => `f0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, D = n => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

function fakeDrive(init = {}, { fail = () => null } = {}) {
  const items = new Map(Object.entries(init));
  const calls = [];
  const check = (op, id) => { const st = fail(op, id); if (st != null) throw new DriveFail(st); };
  const view = (id, m) => ({ id, name: m.name, mimeType: m.mimeType, parents: m.parents, appProperties: m.appProperties ? { ...m.appProperties } : undefined, trashed: m.trashed });
  return {
    items, calls,
    async get(id) { calls.push(['get', id]); check('get', id); const m = items.get(id); return m ? view(id, m) : null; },
    async list(ps) { calls.push(['list', ps.length]); return [...items].filter(([, m]) => !m.trashed && m.parents?.some(x => ps.includes(x))).map(([id, m]) => view(id, m)); },
    async children(p) { return this.list([p]); },
    async createFolder(name, parent, appProperties) { calls.push(['create', name, parent]); check('create', parent); const id = nid('newFolder'); items.set(id, { name, parents: [parent], mimeType: FOLDER_MIME, appProperties: { ...(appProperties || {}) } }); return id; },
    async patch(id, p) {
      calls.push(['patch', id, p]); check('patch', id);
      const m = items.get(id); if (!m) throw new DriveFail(404);
      if (p.name) m.name = p.name;
      if (p.trashed) m.trashed = true;
      if (p.appProperties) { m.appProperties = { ...(m.appProperties || {}) }; for (const [k, v] of Object.entries(p.appProperties)) if (v === null) delete m.appProperties[k]; else m.appProperties[k] = v; }
      if (p.addParents) { const rm = String(p.removeParents || '').split(',').filter(Boolean); m.parents = [...m.parents.filter(x => !rm.includes(x)), p.addParents]; }
    },
    async marked(batch) { return [...items].filter(([, m]) => !m.trashed && m.appProperties?.[MARK.batch] === batch).map(([id, m]) => view(id, m)); },
  };
}
function fakeDb({ folders = [], items = [], documents = [] } = {}) {
  const trash = [];
  let n = 50;
  return {
    rows: folders, trash, items,
    async folders() { return folders.map(f => ({ ...f })); },
    async items() { return items; },
    async documents() { return documents; },
    async setDrive(id, drive, expect) {
      const f = folders.find(x => x.id === id) || trash.find(x => x.id === id);
      if ((f.drive_folder_id ?? null) !== (expect ?? null)) return { ok: false };
      if (drive && [...folders, ...trash].some(x => x.id !== id && x.drive_folder_id === drive)) return { ok: false, taken: true };
      f.drive_folder_id = drive; return { ok: true };
    },
    async renameFolder(id, name) { folders.find(x => x.id === id).name = name; },
    async moveFolder(id, parent) {
      // 나무 검사(DB 트리거와 같은 뜻): 자기 아래로는 못 옮김
      for (let cur = parent; cur; cur = folders.find(x => x.id === cur)?.parent_id) if (cur === id) throw Object.assign(new Error('tree'), { status: 400 });
      folders.find(x => x.id === id).parent_id = parent;
    },
    async createFolder({ parent_id, name }) { const row = { id: F(++n), parent_id, name, sort_order: 99, drive_folder_id: null }; folders.push(row); return row; },
    async deleteFolder(id) { const i = folders.findIndex(x => x.id === id); trash.push(...folders.splice(i, 1)); },
  };
}
const folder = (name, parent, extra = {}) => ({ name, parents: [parent], mimeType: FOLDER_MIME, ...extra });
const file = (name, parent) => ({ name, parents: [parent], mimeType: 'application/pdf' });
const stamped = (name, parent, extra = {}) => folder(name, parent, { appProperties: { [SYNC_NAME]: nameSig(name), [SYNC_PARENT]: parent }, ...extra });
const libMeta = { name: '자료실', parents: ['rootFolder000001'], mimeType: FOLDER_MIME, appProperties: { [MIRROR_MARK]: '1' } };

// 네 가지 어긋남(+자리 다른 폴더)과 연결된 원본이 모두 있는 상태.
function world() {
  const drive = fakeDrive({
    [LIB]: libMeta,
    pairA00000000001: stamped('교섭', LIB),
    pairB00000000002: stamped('드라이브 이름', LIB, { appProperties: { [SYNC_NAME]: 'ffffffff', [SYNC_PARENT]: LIB } }), // 양쪽 다 바뀜 → 어느 쪽인지 모름
    extraX0000000003: folder('드라이브에만', LIB),
    extraY0000000004: folder('그 안', 'extraX0000000003'),
    tidyWait00000005: folder('정리 대기', LIB, { appProperties: { won_tidy_folder: 'wait' } }),
    fileA00000000001: file('가.pdf', LIB),               // 자료는 교섭 폴더 → 다른 폴더에 있는 파일
    fileB00000000002: file('나.pdf', 'pairA00000000001'), // 맞음
    linked0000000003: file('원본.hwp', 'unionFolder00001'), // 드라이브에서 가져오기로 연결한 원본(자료실 나무 밖)
    meeting000000004: file('회의.pdf', 'meetingsFolder01'), // 다른 앱 파일
  });
  const db = fakeDb({
    folders: [
      { id: F(1), parent_id: null, name: '교섭', sort_order: 1, drive_folder_id: 'pairA00000000001' },
      { id: F(2), parent_id: null, name: '자료실 이름', sort_order: 2, drive_folder_id: 'pairB00000000002' },
      { id: F(3), parent_id: null, name: '자료실에만', sort_order: 3, drive_folder_id: null },
    ],
    items: [{ document_id: D(1), folder_id: F(1) }, { document_id: D(2), folder_id: F(1) }, { document_id: D(3), folder_id: F(1) }, { document_id: D(4), folder_id: F(1) }],
    documents: [
      { id: D(1), file_id: 'fileA00000000001', title: '가' }, { id: D(2), file_id: 'fileB00000000002', title: '나' },
      { id: D(3), file_id: 'linked0000000003', title: '원본', classification_note: '드라이브에서 가져옴 · 파일명 기반 자동분류' },
      { id: D(4), file_id: 'meeting000000004', title: '회의' },
    ],
  });
  return { drive, db };
}

test('요청 모양', () => {
  assert.deepEqual(parseCheckBody({ op: 'scan' }), { op: 'scan' });
  assert.deepEqual(parseCheckBody({ op: 'fix', all: true }), { op: 'fix', all: true, lines: null, batch: null });
  assert.deepEqual(parseCheckBody({ op: 'fix', lines: [{ kind: 'name', id: F(1), to: 'drive' }], batch: 'abcdefgh1' }).lines, [{ kind: 'name', id: F(1), to: 'drive' }]);
  assert.deepEqual(parseCheckBody({ op: 'undo', batch: 'abcdefgh1' }), { op: 'undo', batch: 'abcdefgh1' });
  for (const b of [null, [], {}, { op: 'scan', x: 1 }, { op: 'fix' }, { op: 'fix', all: false }, { op: 'fix', lines: [] },
    { op: 'fix', lines: [{ kind: 'file', id: 'not-a-uuid' }] },
    { op: 'fix', lines: [{ kind: 'file', id: D(1), to: 'app' }] }, { op: 'fix', lines: [{ kind: 'name', id: F(1) }, { kind: 'name', id: F(1) }] },
    { op: 'fix', all: true, workspace_id: 'x' }, { op: 'undo', batch: 'A;drop' }, { op: 'fix', all: true, batch: "x' or 1" }]) assert.equal(parseCheckBody(b), null, JSON.stringify(b));
});

test('이름 나눠 담기·되찾기(드라이브 표식 한 칸 124바이트)', () => {
  const long = '가'.repeat(100);
  const p = packName(long);
  for (const [k, v] of Object.entries(p)) if (v !== null) assert.ok(new TextEncoder().encode(k + v).length <= 124);
  assert.equal(unpackName(p), long);
  assert.equal(packName('가'.repeat(300)), null);
});

test('어느 쪽이 바뀌었나(decideFolder)', () => {
  const base = { [SYNC_NAME]: nameSig('옛'), [SYNC_PARENT]: LIB };
  assert.equal(decideFolder({ name: '옛', parentDrive: LIB }, { name: '새', parents: [LIB], appProperties: base }).name, 'app', '드라이브만 바뀜 → 자료실이 따라감');
  assert.equal(decideFolder({ name: '새', parentDrive: LIB }, { name: '옛', parents: [LIB], appProperties: base }).name, 'drive', '자료실만 바뀜 → 드라이브를 고침');
  assert.equal(decideFolder({ name: '자', parentDrive: LIB }, { name: '드', parents: [LIB], appProperties: base }).name, 'conflict');
  assert.equal(decideFolder({ name: '자', parentDrive: LIB }, { name: '드', parents: [LIB] }).name, 'legacy');
  assert.equal(decideFolder({ name: '옛', parentDrive: LIB }, { name: '가'.repeat(41), parents: [LIB], appProperties: base }).name, 'conflict', '40자 넘는 이름은 따라갈 수 없음');
  const moved = decideFolder({ name: '옛', parentDrive: LIB }, { name: '옛', parents: ['pairA00000000001'], appProperties: base }, d => d === 'pairA00000000001' ? F(1) : undefined);
  assert.equal(moved.parent, 'app');
  assert.equal(decideFolder({ name: '옛', parentDrive: LIB }, { name: '옛', parents: ['outside00000001'], appProperties: base }, () => undefined).parent, 'conflict', '자료실 밖으로 옮김 → 따라가지 않음');
  assert.equal(decideFolder({ name: '옛', parentDrive: LIB }, { name: '옛', parents: [LIB], appProperties: { [SYNC_NAME]: SYNC_HOLD } }).name, 'same');
});

test('점검: 어긋남 네 종류(+자리) 찾기 · 연결된 원본·다른 앱 파일은 줄이 아니라 개수 · 앱 기능 폴더는 빼기 · 아무것도 바꾸지 않음', async () => {
  const { drive, db } = world();
  const r = await scanLibrary({ libraryId: LIB, db, drive });
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { missing: 1, extra: 2, name: 1, place: 0, file: 1 });
  assert.equal(r.lines.missing[0].id, F(3));
  assert.deepEqual(r.lines.extra.map(l => l.name), ['드라이브에만', '그 안'], '위 폴더부터');
  assert.equal(r.lines.extra[1].parent_ready, false);
  assert.deepEqual([r.lines.name[0].app_name, r.lines.name[0].drive_name, r.lines.name[0].suggest], ['자료실 이름', '드라이브 이름', null]);
  assert.deepEqual([r.lines.file[0].id, r.lines.file[0].to], [D(1), ['교섭']]);
  assert.equal(r.lines.file[0].file_id, undefined, '화면에 드라이브 id는 보내지 않음');
  assert.equal(r.linked, 1); assert.equal(r.outside, 1);
  assert.equal(r.total, 5);
  assert.ok(!drive.calls.some(c => c[0] === 'patch' || c[0] === 'create'));
});

test('모두 맞추기: 폴더 만들기·드라이브 폴더를 자료실로·이름은 드라이브(원본)로·파일 옮기기(복사 아님) — 연결된 원본은 그대로, 지우기 없음', async () => {
  const { drive, db } = world();
  let t = 0;
  const r = await fixLibrary({ libraryId: LIB, db, drive, all: true, now: () => t, makeBatch: () => 'batch00001' });
  assert.equal(r.ok, true); assert.equal(r.batch, 'batch00001');
  assert.equal(r.done, 5);
  const made = db.rows.find(f => f.id === F(3)).drive_folder_id;
  assert.deepEqual(drive.items.get(made).parents, [LIB]);
  assert.equal(drive.items.get(made).name, '자료실에만');
  const x = db.rows.find(f => f.drive_folder_id === 'extraX0000000003'), y = db.rows.find(f => f.drive_folder_id === 'extraY0000000004');
  assert.equal(x.name, '드라이브에만'); assert.equal(x.parent_id, null);
  assert.equal(y.parent_id, x.id, '안쪽 폴더도 같은 자리에');
  assert.equal(db.rows.find(f => f.id === F(2)).name, '드라이브 이름', '어느 쪽인지 모르면 드라이브 이름(원본)');
  assert.deepEqual(drive.items.get('fileA00000000001').parents, ['pairA00000000001']);
  assert.equal(drive.items.size, 11, '파일을 복사하지 않음(새로 생긴 것은 폴더 하나)');
  assert.deepEqual(drive.items.get('linked0000000003').parents, ['unionFolder00001'], '연결된 원본은 옮기지 않음');
  assert.deepEqual(drive.items.get('meeting000000004').parents, ['meetingsFolder01']);
  assert.ok(![...drive.items.values()].some(m => m.trashed));
  assert.equal(db.trash.length, 0);
  const again = await scanLibrary({ libraryId: LIB, db, drive });
  assert.equal(again.total, 0, '다시 보면 어긋남 없음');
  assert.equal(again.linked, 1);
});

test('줄 하나만 · 반대쪽으로(이름: 드라이브를 자료실 이름으로) · 위 폴더가 아직이면 위 폴더부터', async () => {
  const { drive, db } = world();
  const r = await fixLibrary({ libraryId: LIB, db, drive, lines: [{ kind: 'name', id: F(2), to: 'drive' }, { kind: 'extra', id: 'extraY0000000004' }], makeBatch: () => 'batch00002' });
  assert.equal(r.done, 1);
  assert.equal(r.reasons.parent_first, 1);
  assert.equal(drive.items.get('pairB00000000002').name, '자료실 이름');
  assert.equal(drive.items.get('pairB00000000002').appProperties[SYNC_NAME], nameSig('자료실 이름'));
  const s = await scanLibrary({ libraryId: LIB, db, drive });
  assert.equal(s.counts.name, 0);
  assert.equal(s.counts.missing, 1, '고르지 않은 줄은 그대로');
});

test('화면이 보낸 줄을 믿지 않음: 이미 맞은 줄·남의 id는 건너뜀', async () => {
  const { drive, db } = world();
  const r = await fixLibrary({ libraryId: LIB, db, drive, lines: [{ kind: 'file', id: D(2) }, { kind: 'file', id: D(9) }, { kind: 'missing', id: F(1) }], makeBatch: () => 'batch00003' });
  assert.equal(r.done, 0); assert.equal(r.reasons.gone, 3);
  assert.ok(!drive.calls.some(c => c[0] === 'patch' || c[0] === 'create'));
});

test('되돌리기: 마지막 맞추기 전으로(파일 자리·이름·만든 폴더) — 만든 드라이브 폴더는 휴지통까지만, 만든 자료실 폴더는 자료실 휴지통으로', async () => {
  const { drive, db } = world();
  const before = JSON.stringify([...drive.items].filter(([, m]) => m.mimeType !== FOLDER_MIME || true).map(([id, m]) => [id, m.name, m.parents]));
  await fixLibrary({ libraryId: LIB, db, drive, all: true, makeBatch: () => 'batch00004' });
  const made = db.rows.find(f => f.id === F(3)).drive_folder_id;
  const u = await undoLibrary({ libraryId: LIB, db, drive, batch: 'batch00004' });
  assert.equal(u.ok, true); assert.equal(u.left, 0);
  assert.deepEqual(drive.items.get('fileA00000000001').parents, [LIB], '파일은 원래 자리로');
  assert.equal(db.rows.find(f => f.id === F(2)).name, '자료실 이름', '자료실 폴더 이름도 원래대로');
  assert.equal(drive.items.get(made).trashed, true, '우리가 만든 빈 드라이브 폴더 → 드라이브 휴지통');
  assert.equal(db.rows.find(f => f.id === F(3)).drive_folder_id, null);
  assert.deepEqual(db.trash.map(f => f.name).sort(), ['그 안', '드라이브에만'], '우리가 만든 자료실 폴더 → 자료실 휴지통');
  assert.ok(![...drive.items.values()].some(m => m.appProperties && Object.keys(m.appProperties).some(k => k.startsWith('won_s'))), '되돌리기 표식은 모두 지움');
  assert.equal(JSON.stringify([...drive.items].filter(([id]) => id !== made).map(([id, m]) => [id, m.name, m.parents])), JSON.stringify(JSON.parse(before)));
  // 되돌린 이름 줄은 '어느 쪽인지 모름'으로 붙들려 다음 맞추기(auto)가 덮어쓰지 않는다.
  const m = await mirrorLibrary({ libraryId: LIB, mode: 'auto', db, drive });
  assert.equal(drive.items.get('pairB00000000002').name, '드라이브 이름');
  assert.equal(db.rows.find(f => f.id === F(2)).name, '자료실 이름');
  assert.ok(m.conflicts >= 1);
});

test('드라이브에서 직접 바꾼 것(이름·옮기기)은 다음 읽기(auto) 때 자료실이 따라간다(id 기준)', async () => {
  const drive = fakeDrive({
    [LIB]: libMeta,
    pairA00000000001: stamped('교섭', LIB, { name: '교섭 2026' }),     // 드라이브에서 이름 바꿈
    pairB00000000002: stamped('조직', LIB, { parents: ['pairA00000000001'] }), // 드라이브에서 교섭 안으로 옮김
    pairC00000000003: stamped('밖으로', LIB, { parents: ['elsewhere0000001'] }), // 자료실 밖으로 옮김 → 따라가지 않음
  });
  const db = fakeDb({ folders: [
    { id: F(1), parent_id: null, name: '교섭', sort_order: 1, drive_folder_id: 'pairA00000000001' },
    { id: F(2), parent_id: null, name: '조직', sort_order: 2, drive_folder_id: 'pairB00000000002' },
    { id: F(3), parent_id: null, name: '밖으로', sort_order: 3, drive_folder_id: 'pairC00000000003' },
  ] });
  const r = await mirrorLibrary({ libraryId: LIB, mode: 'auto', db, drive });
  assert.equal(db.rows[0].name, '교섭 2026');
  assert.equal(db.rows[1].parent_id, F(1));
  assert.equal(r.app_renamed, 1); assert.equal(r.app_moved, 1);
  assert.equal(r.conflicts, 1);
  assert.deepEqual(drive.items.get('pairC00000000003').parents, ['elsewhere0000001'], '자료실 밖으로 옮긴 폴더를 도로 끌어오지 않음');
  assert.equal(drive.items.get('pairA00000000001').appProperties[SYNC_NAME], nameSig('교섭 2026'), '따라간 뒤 표식도 새 모양');
  const s = await scanLibrary({ libraryId: LIB, db, drive });
  assert.equal(s.counts.place, 1, '따라갈 수 없는 것은 점검 목록에');
  assert.equal(s.lines.place[0].outside, true);
  // 자료실에서 바꾼 것은 지금처럼 드라이브가 따라간다.
  db.rows[0].name = '교섭 정리';
  await mirrorLibrary({ libraryId: LIB, mode: 'auto', db, drive });
  assert.equal(drive.items.get('pairA00000000001').name, '교섭 정리');
});

test('표식 없는 옛 짝: 이름이 같으면 표식을 붙이고, 다르면 지금까지처럼 자료실 기준', async () => {
  const drive = fakeDrive({ [LIB]: libMeta, pairA00000000001: folder('A', LIB), pairB00000000002: folder('드라이브', LIB) });
  const db = fakeDb({ folders: [{ id: F(1), parent_id: null, name: 'A', sort_order: 1, drive_folder_id: 'pairA00000000001' }, { id: F(2), parent_id: null, name: '자료실', sort_order: 2, drive_folder_id: 'pairB00000000002' }] });
  const r = await mirrorLibrary({ libraryId: LIB, mode: 'auto', db, drive });
  assert.equal(r.stamped, 1);
  assert.equal(drive.items.get('pairA00000000001').appProperties[SYNC_NAME], nameSig('A'));
  assert.equal(drive.items.get('pairB00000000002').name, '자료실');
  assert.equal(drive.items.get('pairB00000000002').appProperties[SYNC_NAME], nameSig('자료실'));
});
