import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hashKey, lookupTargets, folderInfo, planSameContent, linkMoves, linksByDoc, parseSameRequest, folderName, createSameContent, SAME_FOLDER_PREFIX, APPLY_MAX,
} from '../../supabase/functions/library-files/same-content.mjs';

// S69-45 LIB-같은내용정리: 가짜 데이터만(네트워크·운영 DB 없음).
const u = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fid = s => (s + '__________').slice(0, 12);
const M1 = 'a'.repeat(32), M2 = 'b'.repeat(32);
const doc = (n, over = {}) => ({ id: u(n), workspace_id: 'w1', title: `자료${n}`, file_name: `f${n}.pdf`, file_id: fid('f' + n), file_size: 100, mime_type: 'application/pdf', created_at: `2026-11-0${(n % 9) + 1}T00:00:00Z`, meeting_id: null, organization_id: null, ...over });

test('hashKey: md5 32자 + 양의 크기만', () => {
  assert.equal(hashKey(M1, '100'), `${M1}:100`);
  assert.equal(hashKey(M1, 0), null);
  assert.equal(hashKey('xyz', 10), null);
  assert.equal(hashKey(undefined, 10), null);
});

test('lookupTargets: 크기가 같은 자료가 둘 이상인 것만 묻는다(구글 문서류·크기 하나뿐은 안 물음)', () => {
  const docs = [doc(1), doc(2), doc(3, { file_size: 999 }), doc(4, { mime_type: 'application/vnd.google-apps.document', file_size: null }), doc(5, { file_id: null })];
  assert.deepEqual(lookupTargets(docs).sort(), [fid('f1'), fid('f2')].sort());
  // 같은 드라이브 id를 가리키는 두 행은 크기가 달라 보여도 묻는다
  assert.deepEqual(lookupTargets([doc(6, { file_id: fid('same') }), doc(7, { file_id: fid('same'), file_size: 5 })]), [fid('same')]);
});

test('folderInfo: 받는 폴더·그 아래·잡동사니·폴더 밖은 분류 안 됨, 경로 글자', () => {
  const folders = [{ id: u(100), parent_id: null, name: '잡동사니' }, { id: u(101), parent_id: null, name: '교섭' }, { id: u(102), parent_id: u(101), name: '2026' }, { id: u(103), parent_id: null, name: '받기' }, { id: u(104), parent_id: u(103), name: '아래' }];
  const info = folderInfo(folders, u(103));
  assert.equal(info.unsorted(u(100)), true);
  assert.equal(info.unsorted(u(104)), true);
  assert.equal(info.unsorted(null), true);
  assert.equal(info.unsorted(u(102)), false);
  assert.equal(info.pathOf(u(102)), '교섭 › 2026');
  assert.equal(info.pathOf(null), '폴더 밖');
});

const FOLDERS = [{ id: u(100), parent_id: null, name: '잡동사니' }, { id: u(101), parent_id: null, name: '교섭' }];

test('남길 것 기준: 손으로 분류한 폴더 > 기록 연결 > 먼저 들어온 것', () => {
  const keys = new Map([[fid('f1'), `${M1}:100`], [fid('f2'), `${M1}:100`], [fid('f3'), `${M1}:100`], [fid('f4'), `${M2}:100`], [fid('f5'), `${M2}:100`], [fid('f6'), `${M2}:100`]]);
  const docs = [doc(1), doc(2, { created_at: '2026-01-01T00:00:00Z' }), doc(3), doc(4, { created_at: '2025-01-01T00:00:00Z' }), doc(5), doc(6)];
  // 묶음1: 3은 '교섭'(손 분류), 2는 가장 오래됨 → 3 남김. 묶음2: 5는 노트 연결, 4가 가장 오래됨 → 5 남김(연결이 이김)
  const items = new Map([[u(1), u(100)], [u(2), u(100)], [u(3), u(101)], [u(4), u(100)], [u(5), u(100)]]);
  const links = { records: [{ id: u(900), document_id: u(5), google_task_id: null, note_id: u(800) }] };
  const r = planSameContent({ docs, keys, items, folders: FOLDERS, links });
  const g1 = r.groups.find(g => g.key === `${M1}:100`), g2 = r.groups.find(g => g.key === `${M2}:100`);
  assert.equal(g1.keep.id, u(3)); assert.equal(g1.keep.path, '교섭');
  assert.deepEqual(g1.drop.map(d => d.id).sort(), [u(1), u(2)].sort());
  assert.equal(g2.keep.id, u(5));
  assert.deepEqual(r.totals, { groups: 2, trash: 4, skipped: 0 });
});

test('휴지통 폴더에 든 자료는 대상에서 빠지고, 묶음이 하나뿐이면 정리 없음', () => {
  const keys = new Map([[fid('f1'), `${M1}:100`], [fid('f2'), `${M1}:100`]]);
  const r = planSameContent({ docs: [doc(1), doc(2)], keys, items: new Map([[u(2), u(555)]]), folders: FOLDERS });
  assert.deepEqual(r.totals, { groups: 0, trash: 0, skipped: 0 });
});

test('기록 연결 보호: 옮길 수 없는 연결(회의·조직이 다름, 같은 노트 연결이 이미 있음)이면 그 묶음은 건너뜀', () => {
  const keys = new Map([[fid('f1'), `${M1}:100`], [fid('f2'), `${M1}:100`]]);
  const items = new Map([[u(1), u(101)], [u(2), u(100)]]); // 1이 손 분류 → 남김, 2가 지울 대상
  const meet = planSameContent({ docs: [doc(1), doc(2, { meeting_id: u(700) })], keys, items, folders: FOLDERS });
  assert.equal(meet.groups[0].skip, 'linked'); assert.deepEqual(meet.totals, { groups: 1, trash: 0, skipped: 1 });
  const same = planSameContent({ docs: [doc(1), doc(2)], keys, items, folders: FOLDERS, links: { records: [{ id: u(901), document_id: u(1), note_id: u(800), google_task_id: null }, { id: u(902), document_id: u(2), note_id: u(800), google_task_id: null }] } });
  assert.equal(same.groups[0].skip, 'linked');
  // 옮길 수 있는 연결(다른 노트·보고 묶음)은 남길 자료로 옮길 계획
  const map = linksByDoc({ records: [{ id: u(903), document_id: u(2), note_id: u(801), google_task_id: null }], snaps: [{ id: u(904), document_id: u(2) }] });
  const mv = linkMoves(doc(1), [doc(2)], map);
  assert.equal(mv.ok, true);
  assert.deepEqual(mv.records, [{ id: u(903), from: u(2), to: u(1) }]);
  assert.deepEqual(mv.snaps, [{ id: u(904), from: u(2), to: u(1) }]);
});

test('parseSameRequest: 모양이 정확할 때만', () => {
  assert.deepEqual(parseSameRequest({ action: 'same-content-scan' }), { action: 'scan' });
  assert.equal(parseSameRequest({ action: 'same-content-scan', workspace_id: 'w' }), null);
  assert.deepEqual(parseSameRequest({ action: 'same-content-apply', groups: [{ keep: u(1), drop: [u(2)] }] }), { action: 'apply', groups: [{ keep: u(1), drop: [u(2)] }] });
  assert.equal(parseSameRequest({ action: 'same-content-apply', groups: [{ keep: u(1), drop: [u(1)] }] }), null, '겹침');
  assert.equal(parseSameRequest({ action: 'same-content-apply', groups: [{ keep: u(1), drop: [] }] }), null);
  assert.equal(parseSameRequest({ action: 'same-content-apply', groups: [{ keep: 'x', drop: [u(2)] }] }), null);
  const many = Array.from({ length: APPLY_MAX }, (_, i) => u(i + 10));
  assert.equal(parseSameRequest({ action: 'same-content-apply', groups: [{ keep: u(1), drop: many }] }), null, '한도');
  assert.ok(parseSameRequest({ action: 'same-content-undo', undo: { folder: u(1), moves: [{ d: u(2), f: null }], links: [{ t: 'r', id: u(3), from: u(2), to: u(4) }] } }));
  assert.equal(parseSameRequest({ action: 'same-content-undo', undo: { folder: u(1), moves: [{ d: u(2), f: 'x' }], links: [] } }), null);
});

test('folderName: 한국 시각, 앞말 고정, 40자 안', () => {
  const n = folderName(new Date('2026-11-24T07:05:00Z'));
  assert.equal(n, `${SAME_FOLDER_PREFIX} 11-24 16:05`);
  assert.ok(n.length <= 40);
});

// ---- 가짜 DB(로그인한 사람 토큰 모양 — 한 작업공간 표만) + 가짜 드라이브 ----
function fakeDb(tables) {
  const calls = [];
  let seq = 5000;
  const match = (row, f) => f.every(([op, k, v]) => op === 'eq' ? row[k] === v : op === 'in' ? v.includes(row[k]) : op === 'notnull' ? row[k] != null : true);
  function from(table) {
    const st = { op: 'select', f: [], body: null, sel: false };
    const rows = () => (tables[table] ||= []);
    const run = () => {
      calls.push({ table, op: st.op, f: st.f.map(x => x.slice()), body: st.body });
      if (st.op === 'insert') {
        const list = (Array.isArray(st.body) ? st.body : [st.body]).map(r => ({ id: u(seq++), ...r }));
        rows().push(...list);
        return { data: list, error: null };
      }
      const hit = rows().filter(r => match(r, st.f) && !(table === 'app_library_folders' && r.deleted_at));
      if (st.op === 'update') { hit.forEach(r => Object.assign(r, st.body)); return { data: hit.map(r => ({ ...r })), error: null }; }
      if (st.op === 'delete') {
        for (const r of hit) {
          if (table === 'app_library_folders') r.deleted_at = 'now'; // 서버 트리거 흉내: 지우기 = 휴지통 표시
          else rows().splice(rows().indexOf(r), 1);
        }
        return { data: hit, error: null };
      }
      return { data: hit.map(r => ({ ...r })), error: null };
    };
    const b = {
      select() { st.sel = true; return b; }, eq(k, v) { st.f.push(['eq', k, v]); return b; }, in(k, v) { st.f.push(['in', k, v]); return b; },
      not(k) { st.f.push(['notnull', k]); return b; }, order() { return b; }, limit() { return b; },
      insert(body) { st.op = 'insert'; st.body = body; return b; }, update(body) { st.op = 'update'; st.body = body; return b; }, delete() { st.op = 'delete'; return b; },
      range: async (a, z) => { const r = run(); return { ...r, data: r.data.slice(a, z + 1) }; },
      single: async () => { const r = run(); return { data: r.data[0] || null, error: r.data[0] ? null : { code: 'x' } }; },
      maybeSingle: async () => { const r = run(); return { data: r.data[0] || null, error: null }; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }
  const rpc = async (fn, args) => {
    calls.push({ rpc: fn, args });
    const f = (tables.app_library_folders || []).find(x => x.id === args.p_id);
    if (fn === 'app_trash_restore') { if (!f || !f.deleted_at) return { error: { message: 'TRASH_NOT_FOUND' } }; f.deleted_at = null; return { data: { ok: true }, error: null }; }
    if (fn === 'app_trash_purge') { if (f) tables.app_library_folders.splice(tables.app_library_folders.indexOf(f), 1); return { data: { ok: true }, error: null }; }
    return { error: { message: 'unknown' } };
  };
  return { db: { from, rpc }, calls };
}
function fakeDrive(meta) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    const m = String(url).match(/\/files\/([^?]+)\?fields=id,md5Checksum,size,trashed$/);
    if (!m) throw new Error('unexpected ' + url);
    const f = meta[decodeURIComponent(m[1])];
    return new Response(JSON.stringify(f || {}), { status: f ? 200 : 404 });
  };
  return { fetch, calls };
}

function world() {
  const docs = [doc(1), doc(2, { created_at: '2026-01-01T00:00:00Z' }), doc(3), doc(4, { file_size: 7 })];
  const tables = {
    app_documents: docs,
    app_library_folders: [{ id: u(100), workspace_id: 'w1', parent_id: null, name: '잡동사니' }, { id: u(101), workspace_id: 'w1', parent_id: null, name: '교섭' }],
    app_library_folder_items: [{ document_id: u(1), folder_id: u(100), workspace_id: 'w1' }, { document_id: u(3), folder_id: u(101), workspace_id: 'w1' }],
    app_profiles: [{ user_id: 'u1', library_receive_folder: u(100) }],
    app_record_links: [{ id: u(901), workspace_id: 'w1', document_id: u(1), note_id: u(800), google_task_id: null }],
    app_report_snapshots: [],
  };
  const meta = { [fid('f1')]: { md5Checksum: M1, size: '100' }, [fid('f2')]: { md5Checksum: M1, size: '100' }, [fid('f3')]: { md5Checksum: M1, size: '100' }, [fid('f4')]: { md5Checksum: M2, size: '7' } };
  return { tables, meta };
}

test('scan → apply → undo: 정리 폴더로 옮겨 휴지통, 연결은 남길 자료로, 되돌리면 원래대로(드라이브는 읽기만)', async () => {
  const { tables, meta } = world();
  const { db, calls } = fakeDb(tables);
  const drive = fakeDrive(meta);
  const same = createSameContent({ db, fetch: drive.fetch, token: 't', workspaceId: 'w1', userId: 'u1', now: () => new Date('2026-11-24T07:05:00Z'), log: () => {} });
  const s = await same.scan();
  assert.equal(s.ok, true);
  assert.deepEqual(s.totals, { groups: 1, trash: 2, skipped: 0 });
  assert.equal(s.groups[0].keep.id, u(3)); // '교섭' 폴더(손 분류)
  assert.equal(drive.calls.some(c => c.url.includes(fid('f4'))), false, '크기가 하나뿐인 자료는 드라이브에 묻지 않음');
  assert.equal(calls.some(c => c.op && c.op !== 'select'), false, '미리 보기는 아무것도 바꾸지 않음');

  const r = await same.apply([{ keep: s.groups[0].keep.id, drop: s.groups[0].drop.map(d => d.id) }]);
  assert.equal(r.ok, true); assert.equal(r.trashed, 2); assert.equal(r.skipped, 0); assert.equal(r.in_trash, true);
  const dedup = tables.app_library_folders.find(f => f.name === `${SAME_FOLDER_PREFIX} 11-24 16:05`);
  assert.ok(dedup?.deleted_at, '정리 폴더는 휴지통 표시');
  assert.deepEqual(tables.app_library_folder_items.filter(i => i.folder_id === dedup.id).map(i => i.document_id).sort(), [u(1), u(2)].sort());
  assert.equal(tables.app_documents.length, 4, '자료 행은 지우지 않음');
  assert.equal(tables.app_record_links[0].document_id, u(3), '노트 연결은 남길 자료로');
  assert.equal(drive.calls.every(c => c.method === 'GET'), true, '드라이브는 메타데이터 읽기만');
  assert.equal(calls.every(c => !c.table || c.f.some(([op, k, v]) => k === 'workspace_id' && v === 'w1') || c.op === 'insert' || (c.table === 'app_profiles' && c.f.some(([, k, v]) => k === 'user_id' && v === 'u1'))), true, '모든 조회·변경은 내 작업공간 조건');

  const back = await same.undo(r.undo);
  assert.deepEqual(back, { ok: true, restored: 2, missed: 0 });
  assert.equal(tables.app_library_folder_items.find(i => i.document_id === u(1)).folder_id, u(100));
  assert.equal(tables.app_library_folder_items.some(i => i.document_id === u(2)), false, '폴더 밖이던 것은 다시 폴더 밖');
  assert.equal(tables.app_record_links[0].document_id, u(1), '연결도 되돌림');
  assert.equal(tables.app_library_folders.some(f => f.id === dedup.id), false, '비게 된 정리 폴더는 지움');
});

test('apply: 화면이 보낸 묶음이 같은 내용이 아니거나 남의 자료면 건너뜀(아무것도 안 옮김)', async () => {
  const { tables, meta } = world();
  tables.app_documents.push(doc(9, { workspace_id: 'w2' }));
  const { db } = fakeDb(tables);
  const same = createSameContent({ db, fetch: fakeDrive(meta).fetch, token: 't', workspaceId: 'w1', userId: 'u1', log: () => {} });
  const r = await same.apply([{ keep: u(3), drop: [u(4)] }, { keep: u(2), drop: [u(9)] }]);
  assert.deepEqual({ trashed: r.trashed, skipped: r.skipped, undo: r.undo }, { trashed: 0, skipped: 2, undo: null });
  assert.equal(tables.app_library_folders.some(f => String(f.name).startsWith(SAME_FOLDER_PREFIX)), false);
});

test('index.ts: 같은 내용 정리 갈래는 로그인 → 내 owner 작업공간 → 내 토큰 DB·내 구글 연결, 화면 작업공간 값을 받지 않는다', () => {
  const src = readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf("input.action.startsWith('same-content-')");
  assert.ok(at > 0);
  const part = src.slice(at, at + 1200);
  assert.match(part, /parseSameRequest\(input\)/);
  assert.match(part, /workspaceFor\(user\.id\)/);
  assert.match(part, /userDbFor\(req\)/);
  assert.match(part, /driveToken\(wmSame\.workspace_id\)/);
  assert.doesNotMatch(part, /admin/);
  assert.doesNotMatch(part, /input\.workspace_id|input\.user_id/);
});
