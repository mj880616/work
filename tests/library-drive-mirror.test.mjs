// S69-20 ③④⑤: 자료실 앱 폴더 = 드라이브 폴더 규칙(supabase/functions/_shared/library-mirror.mjs). 가짜 드라이브·가짜 DB, 값은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveFail, FOLDER_MIME, MIRROR_MARK, mirrorLibrary, parseMirrorBody, topDown } from '../supabase/functions/_shared/library-mirror.mjs';

const LIB = 'libraryFolder0001';
let seq = 0;
const nid = p => `${p}${String(++seq).padStart(12, '0')}`;

// 가짜 드라이브: 폴더·파일 id → {name, parents, mimeType, trashed, appProperties}. 호출을 모두 남긴다.
function fakeDrive(init = {}, { fail = () => null } = {}) {
  const items = new Map(Object.entries(init));
  const calls = [];
  const check = (op, id) => { const st = fail(op, id); if (st != null) throw new DriveFail(st); };
  return {
    items, calls,
    async get(id) { calls.push(['get', id]); check('get', id); const m = items.get(id); return m ? { id, ...m } : null; },
    async children(parent) { calls.push(['children', parent]); check('children', parent); return [...items].filter(([, m]) => !m.trashed && m.parents?.includes(parent)).map(([id, m]) => ({ id, name: m.name, mimeType: m.mimeType, parents: m.parents, appProperties: m.appProperties })); },
    async createFolder(name, parent, appProperties) { calls.push(['create', name, parent]); check('create', parent); const id = nid('newFolder'); items.set(id, { name, parents: [parent], mimeType: FOLDER_MIME, ...(appProperties ? { appProperties: { ...appProperties } } : {}) }); return id; },
    async patch(id, p) {
      calls.push(['patch', id, p]); check('patch', id);
      const m = items.get(id); if (!m) throw new DriveFail(404);
      if (p.name) m.name = p.name;
      if (p.appProperties) m.appProperties = { ...(m.appProperties || {}), ...p.appProperties };
      if (p.addParents) { const rm = String(p.removeParents || '').split(',').filter(Boolean); m.parents = [...m.parents.filter(x => !rm.includes(x)), p.addParents]; }
    },
  };
}
function fakeDb({ folders = [], items = [], documents = [] } = {}) {
  const sets = [];
  return {
    rows: folders, sets,
    async folders() { return folders.map(f => ({ ...f })); },
    async items() { return items; },
    async documents() { return documents; },
    async setDrive(id, drive, expect) {
      sets.push([id, drive, expect]);
      const f = folders.find(x => x.id === id);
      if ((f.drive_folder_id ?? null) !== (expect ?? null)) return { ok: false };
      if (folders.some(x => x.id !== id && x.drive_folder_id === drive)) return { ok: false, taken: true };
      f.drive_folder_id = drive; return { ok: true };
    },
  };
}
const folder = (name, parent, extra = {}) => ({ name, parents: [parent], mimeType: FOLDER_MIME, ...extra });
const file = (name, parent) => ({ name, parents: [parent], mimeType: 'application/pdf' });
const libMeta = aligned => ({ name: '자료실', parents: ['rootFolder000001'], mimeType: FOLDER_MIME, ...(aligned ? { appProperties: { [MIRROR_MARK]: '1' } } : {}) });
const F = n => `f0000000-0000-4000-8000-00000000000${n}`, D = n => `d0000000-0000-4000-8000-00000000000${n}`;

test('요청 모양: {mode:"auto"|"align"} 하나만', () => {
  assert.equal(parseMirrorBody({ mode: 'auto' }), 'auto');
  assert.equal(parseMirrorBody({ mode: 'align' }), null, 'S70-29: [드라이브 폴더 맞추기] 요청은 받지 않는다');
  for (const b of [null, {}, { mode: 'x' }, { mode: 'auto', folder_id: 'y' }, ['auto']]) assert.equal(parseMirrorBody(b), null);
});

test('위에서 아래 차례, 보이지 않는 부모(휴지통 등) 아래 폴더는 뺀다', () => {
  const list = topDown([{ id: 'b', parent_id: 'a', sort_order: 1 }, { id: 'a', parent_id: null, sort_order: 2 }, { id: 'c', parent_id: null, sort_order: 1 }, { id: 'x', parent_id: 'gone' }]);
  assert.deepEqual(list.map(f => f.id), ['c', 'a', 'b']);
});

test("'auto'는 맞춤 표시가 없으면(기존 자료를 아직 맞추지 않음) 아무것도 바꾸지 않는다", async () => {
  const drive = fakeDrive({ [LIB]: libMeta(false), file0000000001: file('가.pdf', LIB) });
  const db = fakeDb({ folders: [{ id: F(1), parent_id: null, name: '교섭', sort_order: 1, drive_folder_id: null }], items: [{ document_id: D(1), folder_id: F(1) }], documents: [{ id: D(1), file_id: 'file0000000001' }] });
  const r = await mirrorLibrary({ libraryId: LIB, mode: 'auto', db, drive });
  assert.equal(r.state, 'not_aligned');
  assert.deepEqual(drive.calls.map(c => c[0]), ['get']);
  assert.deepEqual(db.sets, []);
});

test("[드라이브 폴더 맞추기]('align'): 폴더를 만들고(같은 이름은 다시 씀) 자료를 그 짝 폴더로 옮기고(파일 id 그대로) 끝나면 맞춤 표시", async () => {
  const drive = fakeDrive({
    [LIB]: libMeta(false),
    sameNameFolder01: folder('교섭', LIB),
    file0000000001: file('가.pdf', LIB), file0000000002: file('나.pdf', LIB), file0000000003: file('다.pdf', LIB),
    meetingFile00001: file('회의.pdf', 'meetingsFolder01'),
  });
  const db = fakeDb({
    folders: [{ id: F(1), parent_id: null, name: '교섭', sort_order: 1, drive_folder_id: null }, { id: F(2), parent_id: F(1), name: '2026', sort_order: 1, drive_folder_id: null }],
    items: [{ document_id: D(1), folder_id: F(1) }, { document_id: D(2), folder_id: F(2) }, { document_id: D(4), folder_id: F(1) }],
    documents: [{ id: D(1), file_id: 'file0000000001' }, { id: D(2), file_id: 'file0000000002' }, { id: D(3), file_id: 'file0000000003' }, { id: D(4), file_id: 'meetingFile00001' }],
  });
  const r = await mirrorLibrary({ libraryId: LIB, mode: 'align', db, drive });
  assert.equal(r.ok, true);
  assert.equal(r.state, 'aligned');
  assert.equal(r.folders_made, 1, "'교섭'은 같은 이름 폴더를 다시 쓰고 '2026'만 새로");
  assert.equal(db.rows[0].drive_folder_id, 'sameNameFolder01');
  const sub = db.rows[1].drive_folder_id;
  assert.deepEqual(drive.items.get(sub).parents, ['sameNameFolder01']);
  assert.deepEqual(drive.items.get('file0000000001').parents, ['sameNameFolder01']);
  assert.deepEqual(drive.items.get('file0000000002').parents, [sub]);
  assert.deepEqual(drive.items.get('file0000000003').parents, [LIB], "'폴더 밖' 자료는 자료실 폴더 그대로");
  assert.deepEqual(drive.items.get('meetingFile00001').parents, ['meetingsFolder01'], '자료실 나무 밖 파일(회의자료 등)은 건드리지 않음');
  assert.equal(r.files_moved, 2);
  assert.equal(drive.items.get(LIB).appProperties[MIRROR_MARK], '1');
  assert.ok(!drive.calls.some(c => c[0] === 'delete'), '지우기 없음');
  // 두 번째 'auto'는 바꿀 것이 없다.
  drive.calls.length = 0;
  const again = await mirrorLibrary({ libraryId: LIB, mode: 'auto', db, drive });
  assert.deepEqual([again.folders_made, again.folders_fixed, again.files_moved, again.pending], [0, 0, 0, 0]);
  assert.ok(!drive.calls.some(c => c[0] === 'patch' || c[0] === 'create'));
});

test("'auto'(맞춘 뒤 앞으로): 이름 바꾸기·옮기기(부모 바뀜)·자료 옮기기·폴더 밖으로를 드라이브도 같게, 휴지통 폴더는 그대로", async () => {
  const drive = fakeDrive({
    [LIB]: libMeta(true),
    pairA00000000001: folder('옛 이름', LIB), pairB00000000002: folder('B', LIB), pairT00000000003: folder('휴지통 간 폴더', LIB),
    file0000000001: file('가.pdf', 'pairA00000000001'), file0000000002: file('나.pdf', LIB), file0000000003: file('다.pdf', 'pairB00000000002'), file0000000004: file('라.pdf', 'pairT00000000003'),
  });
  const db = fakeDb({
    // B를 A 안으로 옮겼고 A 이름을 바꿈. 휴지통 폴더(T)는 화면 표에서 안 보인다.
    folders: [{ id: F(1), parent_id: null, name: '새 이름', sort_order: 1, drive_folder_id: 'pairA00000000001' }, { id: F(2), parent_id: F(1), name: 'B', sort_order: 1, drive_folder_id: 'pairB00000000002' }],
    items: [{ document_id: D(2), folder_id: F(2) }, { document_id: D(4), folder_id: F(3) }],
    documents: [{ id: D(1), file_id: 'file0000000001' }, { id: D(2), file_id: 'file0000000002' }, { id: D(3), file_id: 'file0000000003' }, { id: D(4), file_id: 'file0000000004' }],
  });
  const r = await mirrorLibrary({ libraryId: LIB, mode: 'auto', db, drive });
  assert.equal(r.state, 'aligned');
  assert.equal(drive.items.get('pairA00000000001').name, '새 이름');
  assert.deepEqual(drive.items.get('pairB00000000002').parents, ['pairA00000000001']);
  assert.equal(r.folders_fixed, 2);
  assert.deepEqual(drive.items.get('file0000000001').parents, [LIB], '폴더 밖으로 뺀 자료 → 자료실');
  assert.deepEqual(drive.items.get('file0000000002').parents, ['pairB00000000002'], '폴더로 넣은 자료 → 짝 폴더');
  assert.deepEqual(drive.items.get('file0000000003').parents, [LIB]);
  assert.deepEqual(drive.items.get('file0000000004').parents, ['pairT00000000003'], '휴지통 폴더 안 자료는 그대로');
  assert.deepEqual(drive.items.get('pairT00000000003').parents, [LIB], '휴지통 폴더도 드라이브에서 그대로(지우지 않음)');
  assert.equal(r.files_moved, 3);
});

test('짝 드라이브 폴더가 드라이브에서 지워졌으면 다시 만들고 짝을 바꾼다(비교-교체)', async () => {
  const drive = fakeDrive({ [LIB]: libMeta(true), goneFolder000001: folder('A', LIB, { trashed: true }) });
  const db = fakeDb({ folders: [{ id: F(1), parent_id: null, name: 'A', sort_order: 1, drive_folder_id: 'goneFolder000001' }] });
  const r = await mirrorLibrary({ libraryId: LIB, mode: 'auto', db, drive });
  assert.equal(r.folders_made, 1);
  assert.deepEqual(db.sets[0].slice(2), ['goneFolder000001']);
  assert.notEqual(db.rows[0].drive_folder_id, 'goneFolder000001');
});

test("드라이브 실패: 'auto'는 대기로 세고 계속(앱 동작은 그대로), 'align'은 거기서 멈추고 표시를 붙이지 않음, 권한 없는 파일은 cant", async () => {
  const base = () => ({ [LIB]: libMeta(false), file0000000001: file('가.pdf', LIB), file0000000002: file('나.pdf', LIB), notMine00000001: file('남.pdf', LIB) });
  const dbOf = () => fakeDb({
    folders: [{ id: F(1), parent_id: null, name: 'A', sort_order: 1, drive_folder_id: null }],
    items: [{ document_id: D(1), folder_id: F(1) }, { document_id: D(2), folder_id: F(1) }, { document_id: D(3), folder_id: F(1) }],
    documents: [{ id: D(3), file_id: 'notMine00000001' }, { id: D(1), file_id: 'file0000000001' }, { id: D(2), file_id: 'file0000000002' }],
  });
  const fail = (op, id) => op === 'patch' && id === 'notMine00000001' ? 403 : op === 'patch' && id === 'file0000000001' ? 429 : null;
  const drive = fakeDrive(base(), { fail });
  const r = await mirrorLibrary({ libraryId: LIB, mode: 'align', db: dbOf(), drive });
  assert.equal(r.cant, 1);
  assert.equal(r.pending, 1);
  assert.equal(r.stopped, true);
  assert.equal(r.state, 'not_aligned');
  assert.deepEqual(drive.items.get('file0000000002').parents, [LIB], '멈춘 뒤에는 더 옮기지 않음');
  assert.equal(drive.items.get(LIB).appProperties, undefined);
  // 다시 누르면(드라이브가 풀림) 이어서 끝낸다 — 이미 만든 폴더는 다시 씀.
  const db2 = dbOf(); db2.rows[0].drive_folder_id = [...drive.items].find(([, m]) => m.name === 'A')[0];
  const drive2 = fakeDrive(Object.fromEntries(drive.items), { fail: (op, id) => op === 'patch' && id === 'notMine00000001' ? 404 : null });
  const r2 = await mirrorLibrary({ libraryId: LIB, mode: 'align', db: db2, drive: drive2 });
  assert.equal(r2.folders_made, 0);
  assert.equal(r2.files_moved, 2);
  assert.equal(r2.cant, 1);
  assert.equal(r2.state, 'aligned', '옮길 수 없는 파일(cant)은 대기가 아니므로 맞춤을 막지 않음');
});

test('시간 한도: 남으면 more:true(다음 부름에서 이어서), 맞춤 표시는 붙이지 않음', async () => {
  let t = 0;
  const drive = fakeDrive({ [LIB]: libMeta(false) });
  const folders = Array.from({ length: 5 }, (_, i) => ({ id: F(i + 1), parent_id: null, name: '폴더' + i, sort_order: i, drive_folder_id: null }));
  const r = await mirrorLibrary({ libraryId: LIB, mode: 'align', db: fakeDb({ folders }), drive, now: () => (t += 10), budgetMs: 35 });
  assert.equal(r.more, true);
  assert.ok(r.folders_made > 0 && r.folders_made < 5);
  assert.equal(r.state, 'not_aligned');
});

test('자료실 폴더가 없거나 드라이브에서 지워졌으면 아무것도 하지 않는다', async () => {
  assert.equal((await mirrorLibrary({ libraryId: null, mode: 'align', db: fakeDb(), drive: fakeDrive() })).state, 'none');
  const r = await mirrorLibrary({ libraryId: LIB, mode: 'align', db: fakeDb(), drive: fakeDrive({ [LIB]: { ...libMeta(false), trashed: true } }) });
  assert.equal(r.ok, false); assert.equal(r.code, 'library_missing');
  const down = await mirrorLibrary({ libraryId: LIB, mode: 'auto', db: fakeDb(), drive: fakeDrive({}, { fail: () => 503 }) });
  assert.equal(down.ok, false); assert.equal(down.pending, 1);
});

// S69-40(명진 11/24 13시: [드라이브 폴더 맞추기]가 늘 "폴더 0개 만들고 자료 0개 옮겼어요"): 앱 폴더가 많고 자료가 수백 개면
// 옛 방식(폴더마다 get·children)은 한 번 부를 때 한도를 읽기에만 다 써서 한 개도 옮기지 못했다. 지금은 부모 여러 개를 한 번에 읽고(list), 꼭 몇 개씩 옮긴다.
test('S69-40 자료 수백 개·폴더 수십 개: 부를 때마다 옮기고(left가 줄어듦), 이어 부르면 끝까지, 두 번 눌러도 안전', async () => {
  const init = { [LIB]: libMeta(false) };
  const folders = [], items = [], documents = [];
  for (let i = 0; i < 60; i++) { const pid = `pairFolder${String(i).padStart(6, '0')}`; init[pid] = folder('폴더' + i, LIB); folders.push({ id: `f${i}`, parent_id: null, name: '폴더' + i, sort_order: i, drive_folder_id: pid }); }
  for (let i = 0; i < 300; i++) { const fid = `topFile${String(i).padStart(8, '0')}`; init[fid] = file(i + '.pdf', LIB); documents.push({ id: `d${i}`, file_id: fid }); items.push({ document_id: `d${i}`, folder_id: `f${i % 60}` }); }
  const drive = fakeDrive(init);
  // 드라이브 부름 하나 = 1틱. 한도 50틱.
  let t = 0; const tick = () => t;
  const slow = { ...drive, get: async id => { t++; return drive.get(id); }, children: async p => { t++; return drive.children(p); }, patch: async (id, p) => { t++; return drive.patch(id, p); },
    list: async ps => { t++; drive.calls.push(['list', ps.length]); return [...drive.items].filter(([, m]) => !m.trashed && m.parents?.some(x => ps.includes(x))).map(([id, m]) => ({ id, name: m.name, mimeType: m.mimeType, parents: m.parents })); } };
  const db = fakeDb({ folders, items, documents });
  const first = await mirrorLibrary({ libraryId: LIB, mode: 'align', db, drive: slow, now: tick, budgetMs: 50 });
  assert.equal(first.more, true);
  assert.ok(first.files_moved >= 40, `한 번에 여러 개 옮김(${first.files_moved})`);
  assert.equal(first.left, 300 - first.files_moved);
  assert.ok(!drive.calls.some(c => c[0] === 'get' && c[1] !== LIB), '짝 폴더를 하나씩 get하지 않음');
  let moved = first.files_moved, r = first, rounds = 1;
  while (r.more && rounds < 20) { t = 0; r = await mirrorLibrary({ libraryId: LIB, mode: 'align', db, drive: slow, now: tick, budgetMs: 50 }); moved += r.files_moved; rounds++; }
  assert.equal(moved, 300);
  assert.equal(r.state, 'aligned');
  assert.equal(r.left, 0);
  for (let i = 0; i < 300; i++) assert.deepEqual(drive.items.get(`topFile${String(i).padStart(8, '0')}`).parents, [`pairFolder${String(i % 60).padStart(6, '0')}`]);
  t = 0;
  const again = await mirrorLibrary({ libraryId: LIB, mode: 'align', db, drive: slow, now: tick, budgetMs: 50 });
  assert.deepEqual([again.files_moved, again.folders_made, again.left, again.more], [0, 0, 0, false], '다시 눌러도 이미 맞춘 것은 그대로');
});

test('S69-40 멈춘 단계(stage)를 돌려준다', async () => {
  const down = await mirrorLibrary({ libraryId: LIB, mode: 'align', db: fakeDb(), drive: fakeDrive({}, { fail: () => 503 }) });
  assert.equal(down.stage, 'library');
  const drive = fakeDrive({ [LIB]: libMeta(false), file0000000001: file('가.pdf', LIB) }, { fail: (op, id) => op === 'patch' && id === 'file0000000001' ? 500 : null });
  const r = await mirrorLibrary({ libraryId: LIB, mode: 'align', db: fakeDb({ folders: [{ id: F(1), parent_id: null, name: 'A', sort_order: 1, drive_folder_id: null }], items: [{ document_id: D(1), folder_id: F(1) }], documents: [{ id: D(1), file_id: 'file0000000001' }] }), drive });
  assert.equal(r.stopped, true); assert.equal(r.stage, 'files'); assert.equal(r.left, 1);
});
