// S69-52 ①: 드라이브에서 바꾼 것을 자료실이 따라가기(library-mirror.mjs decideFolder). S70-76: 점검 창([드라이브와 맞는지 보기])은 지웠고
// 그 시험(어긋남 찾기·맞추기·되돌리기)도 함께 지웠다. 이 파일은 늘 같게(auto)의 양쪽 판단만 본다. 가짜 드라이브·가짜 DB, 값은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveFail, FOLDER_MIME, MIRROR_MARK, SYNC_HOLD, SYNC_NAME, SYNC_PARENT, decideFolder, mirrorLibrary, nameSig } from '../supabase/functions/_shared/library-mirror.mjs';

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
      if (p.appProperties) { m.appProperties = { ...(m.appProperties || {}) }; for (const [k, v] of Object.entries(p.appProperties)) if (v === null) delete m.appProperties[k]; else m.appProperties[k] = v; }
      if (p.addParents) { const rm = String(p.removeParents || '').split(',').filter(Boolean); m.parents = [...m.parents.filter(x => !rm.includes(x)), p.addParents]; }
    },
  };
}
function fakeDb({ folders = [], items = [], documents = [] } = {}) {
  const trash = [];
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
  };
}
const folder = (name, parent, extra = {}) => ({ name, parents: [parent], mimeType: FOLDER_MIME, ...extra });
const file = (name, parent) => ({ name, parents: [parent], mimeType: 'application/pdf' });
const stamped = (name, parent, extra = {}) => folder(name, parent, { appProperties: { [SYNC_NAME]: nameSig(name), [SYNC_PARENT]: parent }, ...extra });
const libMeta = { name: '자료실', parents: ['rootFolder000001'], mimeType: FOLDER_MIME, appProperties: { [MIRROR_MARK]: '1' } };

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
  const r = await mirrorLibrary({ libraryId: LIB, db, drive });
  assert.equal(db.rows[0].name, '교섭 2026');
  assert.equal(db.rows[1].parent_id, F(1));
  assert.equal(r.app_renamed, 1); assert.equal(r.app_moved, 1);
  assert.equal(r.conflicts, 1);
  assert.deepEqual(drive.items.get('pairC00000000003').parents, ['elsewhere0000001'], '자료실 밖으로 옮긴 폴더를 도로 끌어오지 않음');
  assert.equal(drive.items.get('pairA00000000001').appProperties[SYNC_NAME], nameSig('교섭 2026'), '따라간 뒤 표식도 새 모양');
  // 자료실에서 바꾼 것은 지금처럼 드라이브가 따라간다.
  db.rows[0].name = '교섭 정리';
  await mirrorLibrary({ libraryId: LIB, db, drive });
  assert.equal(drive.items.get('pairA00000000001').name, '교섭 정리');
});

test('표식 없는 옛 짝: 이름이 같으면 표식을 붙이고, 다르면 지금까지처럼 자료실 기준', async () => {
  const drive = fakeDrive({ [LIB]: libMeta, pairA00000000001: folder('A', LIB), pairB00000000002: folder('드라이브', LIB) });
  const db = fakeDb({ folders: [{ id: F(1), parent_id: null, name: 'A', sort_order: 1, drive_folder_id: 'pairA00000000001' }, { id: F(2), parent_id: null, name: '자료실', sort_order: 2, drive_folder_id: 'pairB00000000002' }] });
  const r = await mirrorLibrary({ libraryId: LIB, db, drive });
  assert.equal(r.stamped, 1);
  assert.equal(drive.items.get('pairA00000000001').appProperties[SYNC_NAME], nameSig('A'));
  assert.equal(drive.items.get('pairB00000000002').name, '자료실');
  assert.equal(drive.items.get('pairB00000000002').appProperties[SYNC_NAME], nameSig('자료실'));
});
