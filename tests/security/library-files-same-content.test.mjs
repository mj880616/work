import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as SC from '../../supabase/functions/library-files/same-content.mjs';
const { hashKey, folderInfo, markSame, SAME_FOLDER_PREFIX } = SC;
import { createDriveImport } from '../../supabase/functions/library-files/drive-import.mjs';

// S69-45 LIB-같은내용정리: 가짜 데이터만(네트워크·운영 DB 없음).
// S70-29(2026-11-25 명진 '다 없애 1회용 기능'): 자료실 ⋯ [같은 내용 자료 정리](scan·apply·undo)는 지웠다. 같은 내용 판정은 [드라이브에서 가져오기] '이미 있음'이 계속 쓴다.
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

test('markSame: 자료실과 같은 내용이면 이미 있음(자료 이름·폴더), 목록 안 두 번째도 표시', () => {
  const items = [{ id: 'x1', name: 'a.pdf', kind: 'file' }, { id: 'x2', name: 'b.pdf', kind: 'file' }, { id: 'x3', name: 'b 사본.pdf', kind: 'file' }, { id: 'x4', name: 'memo', kind: 'link' }];
  const fileKeys = new Map([['x1', `${M1}:1`], ['x2', `${M2}:1`], ['x3', `${M2}:1`], ['x4', `${M1}:1`]]);
  const r = markSame(items, fileKeys, new Map([[`${M1}:1`, { title: '교섭안', path: '자료실 › 교섭' }]]));
  assert.deepEqual(r.items[0].same, { title: '교섭안', path: '자료실 › 교섭' });
  assert.equal(r.items[1].same, undefined);
  assert.deepEqual(r.items[2].same, { title: 'b.pdf', path: '이 목록', inList: true });
  assert.equal(r.items[3].same, undefined, '구글 문서류는 내용 비교 안 함');
  assert.equal(r.same, 2);
});

test('drive-import list: 드라이브 id가 달라도 같은 내용이면 이미 있음(같은 내용: 자료 이름·폴더)', async () => {
  const F = 'application/vnd.google-apps.folder';
  const P = fid('pick');
  const driveFiles = [
    { id: P, name: '고른 폴더', mimeType: F, parents: [fid('root')], ownedByMe: true, trashed: false },
    { id: fid('copy'), name: '교섭안 사본.pdf', mimeType: 'application/pdf', size: '100', md5Checksum: M1, parents: [P], ownedByMe: true },
    { id: fid('new'), name: '새 자료.pdf', mimeType: 'application/pdf', size: '100', md5Checksum: M2, parents: [P], ownedByMe: true },
  ];
  const regMeta = { [fid('f1')]: { md5Checksum: M1, size: '100' } };
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  const fetch = async url => {
    const s = String(url);
    if (s.startsWith('https://oauth2.googleapis.com/tokeninfo')) return json({ scope: 'https://www.googleapis.com/auth/drive' });
    if (s.startsWith('https://www.googleapis.com/drive/v3/files?')) { const q = new URL(s).searchParams.get('q'); return json({ files: driveFiles.filter(f => (f.parents || []).some(p => q.includes(`'${p}' in parents`))) }); }
    const m = s.match(/\/files\/([^?]+)\?fields=/);
    if (m) { const id = decodeURIComponent(m[1]); const f = driveFiles.find(x => x.id === id) || regMeta[id]; return f ? json(f) : json({}, 404); }
    throw new Error(s);
  };
  const docs = [doc(1)];
  const admin = { from() { const b = { select: () => b, eq: () => b, range: async () => ({ data: docs, error: null }), maybeSingle: async () => ({ data: {}, error: null }) }; return b; } };
  const { db } = fakeDb({ app_library_folders: [{ id: u(101), workspace_id: 'w1', parent_id: null, name: '교섭' }], app_library_folder_items: [{ document_id: u(1), folder_id: u(101), workspace_id: 'w1' }] });
  const imp = createDriveImport({ admin, db, fetch, token: 't', workspaceId: 'w1', userId: 'u1', titleFor: n => n, classify: () => ({}), log: () => {} });
  const r = await imp.list(P);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.find(x => x.id === fid('copy')).same, { title: '자료1', path: '자료실 › 교섭' });
  assert.equal(r.items.find(x => x.id === fid('new')).same, undefined);
  assert.equal(r.same, 1);
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


test('S70-29: [같은 내용 자료 정리] 갈래·부품이 없다(같은 내용 판정·가져오기 표시는 남음)', () => {
  for (const name of ['createSameContent', 'parseSameRequest', 'planSameContent', 'linkMoves', 'linksByDoc', 'folderName', 'lookupTargets', 'APPLY_MAX']) assert.equal(SC[name], undefined, name);
  for (const name of ['hashKey', 'fileKey', 'hashable', 'folderInfo', 'markSame', 'lookupKeys']) assert.equal(typeof SC[name], 'function', name);
  const src = readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /same-content-|createSameContent|parseSameRequest|top-files-|createTopFiles|parseTopFilesRequest/);
  assert.match(src, /if\(input\?\.action!=='previous-keep'\)throw new UploadError\('지원하지 않는 작업입니다\.'/, '지운 요청은 지원하지 않는 작업으로 거절');
});
