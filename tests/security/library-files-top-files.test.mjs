// S69-40 LIB-맨위파일정리: 드라이브 '자료실' 맨 위 파일 판정 7종·정리·정리 대기·되돌리기. 가짜 드라이브·가짜 기록(네트워크 없음, 값은 모두 가짜).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  judgeTopFile, suggestKey, suggestFolder, parseTopFilesRequest, createTopFiles, isJunkName, isTempFile, WAIT_FOLDER_NAME, ATTACH_FOLDER_NAMES, TIDY_MARK,
} from '../../supabase/functions/library-files/top-files.mjs';

const FM = 'application/vnd.google-apps.folder';
const LIB = 'libraryFolder0001';
const WS = 'w0000000-0000-4000-8000-000000000001';
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const md5 = n => String(n).padStart(32, '0');

// 가짜 드라이브: id → {name,mimeType,parents,size,md5Checksum,appProperties,trashed,createdTime}
function fakeDrive(init) {
  const items = new Map(Object.entries(init).map(([k, v]) => [k, { ...v }]));
  const calls = [];
  let made = 0;
  const reply = (d, status = 200) => ({ status, ok: status < 300, json: async () => d });
  const fetch = async (url, init = {}) => {
    const u = new URL(url), m = init.method || 'GET';
    calls.push([m, u.pathname.replace('/drive/v3/files', ''), u.search, init.body || '']);
    if (u.searchParams.get('alt') || u.pathname.includes('/export')) throw new Error('내용을 열면 안 됨');
    if (m === 'DELETE') throw new Error('영구 삭제 없음');
    const id = decodeURIComponent(u.pathname.split('/files/')[1] || '');
    if (m === 'GET' && !id) {
      const q = u.searchParams.get('q') || '';
      let rows = [...items].map(([k, v]) => ({ id: k, ...v }));
      const parents = [...q.matchAll(/'([A-Za-z0-9_-]+)' in parents/g)].map(x => x[1]);
      if (parents.length) rows = rows.filter(r => r.parents?.some(p => parents.includes(p)));
      const prop = q.match(/key='([a-z_]+)' and value='([a-z0-9]+)'/);
      if (prop) rows = rows.filter(r => r.appProperties?.[prop[1]] === prop[2]);
      if (/trashed = false/.test(q)) rows = rows.filter(r => !r.trashed);
      if (/mimeType != /.test(q)) rows = rows.filter(r => r.mimeType !== FM);
      return reply({ files: rows });
    }
    if (m === 'GET') { const it = items.get(id); return it ? reply({ id, ...it, webViewLink: `https://drive.google.com/file/d/${id}/view` }) : reply({}, 404); }
    if (m === 'POST') { const b = JSON.parse(init.body); const nid = `newFolder${String(++made).padStart(8, '0')}`; items.set(nid, { name: b.name, mimeType: b.mimeType, parents: b.parents, appProperties: b.appProperties }); return reply({ id: nid }); }
    if (m === 'PATCH') {
      const it = items.get(id); if (!it) return reply({}, 404);
      if (it.locked) return reply({}, 403);
      const b = JSON.parse(init.body || '{}');
      if ('trashed' in b) it.trashed = b.trashed;
      if (b.appProperties) { it.appProperties = { ...(it.appProperties || {}) }; for (const [k, v] of Object.entries(b.appProperties)) { if (v === null) delete it.appProperties[k]; else it.appProperties[k] = v; } }
      const add = u.searchParams.get('addParents'), rm = (u.searchParams.get('removeParents') || '').split(',').filter(Boolean);
      if (add) it.parents = [...it.parents.filter(p => !rm.includes(p)), add];
      return reply({ id });
    }
    throw new Error('unexpected ' + m);
  };
  return { items, calls, fetch };
}
// 가짜 supabase(테이블 → 행). select/eq/order/range/maybeSingle/insert/update만.
function fakeDb(tables, seen) {
  const from = t => {
    const st = { t, filters: [], op: 'select', body: null };
    const rows = () => (tables[t] || []).filter(r => st.filters.every(([k, v]) => r[k] === v));
    const api = {
      select() { return api; }, order() { return api; }, not() { return api; },
      eq(k, v) { st.filters.push([k, v]); return api; },
      range(a, b) { seen?.push([t, st.filters.map(f => f[0] + '=' + f[1]).join('&')]); return Promise.resolve({ data: rows().slice(a, b + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      insert(body) { st.op = 'insert'; (tables[t] ||= []).push({ id: U(900 + tables[t].length), ...body }); const row = tables[t].at(-1); return { select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }), then: (r) => r({ error: null }) }; },
      update(body) { st.op = 'update'; st.body = body; return api; },
      then(res) { if (st.op === 'update') { const hit = rows(); for (const r of hit) Object.assign(r, st.body); res({ data: hit, error: null }); } else res({ data: rows(), error: null }); },
    };
    const sel = api.select;
    api.select = (...a) => { if (st.op === 'update') return Promise.resolve({ data: rows().map(r => (Object.assign(r, st.body), r)), error: null }); return sel(...a); };
    return api;
  };
  return { from };
}

function world() {
  const drive = fakeDrive({
    [LIB]: { name: '자료실', mimeType: FM, parents: ['rootFolder000001'] },
    pairA00000000001: { name: '03. 궤도', mimeType: FM, parents: [LIB] },
    humanFolder00001: { name: '사람이 만든 폴더', mimeType: FM, parents: [LIB] },
    taskFolder000001: { name: '할 일 첨부', mimeType: FM, parents: [LIB] },
    inFolderDoc00001: { name: '수련회 발제문.hwp', mimeType: 'application/x-hwp', parents: [LIB], size: '10', md5Checksum: md5(1) },
    outsideDoc000001: { name: '폴더 밖 자료.pdf', mimeType: 'application/pdf', parents: [LIB], size: '10', md5Checksum: md5(2) },
    taskFile00000001: { name: '할 일 첨부.pdf', mimeType: 'application/pdf', parents: [LIB], size: '10', md5Checksum: md5(3) },
    noteFile00000001: { name: '노트 첨부.png', mimeType: 'image/png', parents: [LIB], size: '10', md5Checksum: md5(4) },
    oldOrig000000001: { name: '옛 판.pdf', mimeType: 'application/pdf', parents: [LIB], size: '10', md5Checksum: md5(5) },
    textTemp00000001: { name: 'Web2 글자 읽기 임시', mimeType: 'application/vnd.google-apps.document', parents: [LIB], appProperties: { web2_text_tmp: '1' } },
    thumbs0000000001: { name: 'Thumbs.db', mimeType: 'application/octet-stream', parents: [LIB], size: '10', md5Checksum: md5(6) },
    dupTop0000000001: { name: '예산요구 사본.pdf', mimeType: 'application/pdf', parents: [LIB], size: '20', md5Checksum: md5(7) },
    dupBelow00000001: { name: '예산요구.pdf', mimeType: 'application/pdf', parents: ['humanFolder00001'], size: '20', md5Checksum: md5(7) },
    stray00000000001: { name: '투쟁속보 제2호.pdf', mimeType: 'application/pdf', parents: [LIB], size: '30', md5Checksum: md5(8) },
    stray00000000002: { name: 'photo_2026-09-12_21-20.jpg', mimeType: 'image/jpeg', parents: [LIB], size: '30', md5Checksum: md5(9) },
    // 앱 기록이 가리키는데 md5가 아래 폴더 파일과 같음 → 절대 휴지통 안 감
    refDup0000000001: { name: '자료 중복.pdf', mimeType: 'application/pdf', parents: [LIB], size: '20', md5Checksum: md5(7) },
    lockedJunk000001: { name: 'desktop.ini', mimeType: 'text/plain', parents: [LIB], size: '5', locked: true },
  });
  const tables = {
    app_drive_settings: [{ workspace_id: WS, library_folder_id: LIB }],
    app_documents: [
      { id: U(1), workspace_id: WS, file_id: 'inFolderDoc00001', previous_files: [{ file_id: 'oldOrig000000001' }] },
      { id: U(2), workspace_id: WS, file_id: 'outsideDoc000001', previous_files: [] },
      { id: U(3), workspace_id: WS, file_id: 'refDup0000000001', previous_files: null },
      { id: U(4), workspace_id: 'w-other', file_id: 'stray00000000001', previous_files: [] }, // 남의 작업공간 행은 보지 않음
    ],
    app_library_folders: [
      { id: U(10), workspace_id: WS, parent_id: null, name: '03. 궤도', drive_folder_id: 'pairA00000000001' },
      { id: U(11), workspace_id: WS, parent_id: null, name: '06. 선전', drive_folder_id: null },
      { id: U(12), workspace_id: WS, parent_id: null, name: '잡동사니', drive_folder_id: null },
    ],
    app_library_folder_items: [{ document_id: U(1), folder_id: U(10), workspace_id: WS }],
    app_task_attachments: [{ workspace_id: WS, drive_file_id: 'taskFile00000001' }],
    app_notes: [{ id: U(20), workspace_id: WS, attachments: [{ drive_file_id: 'noteFile00000001', name: '안 씀' }] }],
  };
  const seen = [];
  const admin = fakeDb(tables, seen), db = fakeDb(tables, seen);
  let t = 0;
  const top = createTopFiles({ admin, db, fetch: drive.fetch, token: 't', workspaceId: WS, userId: U(99), titleFor: n => n, classify: () => ({ category: '기타', tags: [] }), now: () => t, newBatch: () => 'batch0001', log: () => {} });
  return { drive, tables, top, seen, tick: n => (t += n) };
}

test('요청 모양', () => {
  assert.deepEqual(parseTopFilesRequest({ action: 'top-files-scan' }), { action: 'scan' });
  assert.deepEqual(parseTopFilesRequest({ action: 'top-files-tidy' }), { action: 'tidy', batch: null });
  assert.deepEqual(parseTopFilesRequest({ action: 'top-files-tidy', batch: 'abc12345' }), { action: 'tidy', batch: 'abc12345' });
  assert.deepEqual(parseTopFilesRequest({ action: 'top-files-wait', file_id: 'stray00000000001', to: 'trash' }), { action: 'wait', fileId: 'stray00000000001', to: 'trash' });
  for (const bad of [{ action: 'top-files-scan', workspace_id: WS }, { action: 'top-files-tidy', batch: "x' or '1" }, { action: 'top-files-undo' },
    { action: 'top-files-wait', file_id: 'bad id', to: 'trash' }, { action: 'top-files-wait', file_id: 'stray00000000001', to: 'folder' }, null, []]) assert.equal(parseTopFilesRequest(bad), null, JSON.stringify(bad));
});

test('찌꺼기·임시 판정과 보낼 곳 제안(이름만)', () => {
  for (const n of ['Thumbs.db', 'desktop.ini', '.DS_Store', '~$보고서.docx']) assert.equal(isJunkName(n), true, n);
  assert.equal(isJunkName('보고서.docx'), false);
  assert.equal(isTempFile({ name: 'x', appProperties: { web2_ocr: '1' } }), true);
  assert.equal(isTempFile({ name: 'Web2 글자 읽기 임시' }), true);
  const cases = { '투쟁속보 제2호.pdf': '06', '261002 사후보도자료.pdf': '06', '부산발언문1.jpg': '06', '260923 37차 본부집행위원회 회의자료.pdf': '01', '7차 임시대의원대회 자료집.pdf': '01', '260811 조직도.pdf': '01',
    '공운법 개정방향.pdf': '04', 'PSO 입법청원 설명자료.hwp': '04', 'PPIP WP 철도망.pdf': '04', '2025 도시철도 예산요구.hwp': '04', '궤도 확대간부수련회 발제문.pptx': '03', '궤도협의회 하반기 공동투쟁 계획(안).hwp': '03',
    '청와대 비서실의 보고서 작성법 요약본.pdf': '05', 'photo_2026-09-12_21-20.jpg': 'misc', 'video_2026-09-12_1.mp4': 'misc', '아무거나.zip': null };
  for (const [n, k] of Object.entries(cases)) assert.equal(suggestKey(n), k, n);
  const tops = [{ id: 'a', name: '01. 노조' }, { id: 'b', name: '06. 선전' }, { id: 'c', name: '잡동사니' }];
  assert.equal(suggestFolder('06', tops), 'b'); assert.equal(suggestFolder('misc', tops), 'c'); assert.equal(suggestFolder('04', tops), null);
});

test('판정 7종(+폴더 밖 자료): 앱 기록을 먼저 보고, 기록이 가리키면 절대 휴지통 아님', () => {
  const refs = { docs: new Map([['d1', { folder_id: 'F' }], ['d2', { folder_id: null }], ['d3', { folder_id: 'GONE' }]]), old: new Set(['o1']), task: new Set(['t1']), note: new Set(['n1']), pairOf: new Map([['F', 'pairF']]), visible: new Set(['F']) };
  const dups = new Set([`${md5(7)}:20`]);
  const j = f => judgeTopFile({ size: '20', md5Checksum: md5(7), ...f }, refs, dups);
  assert.deepEqual(j({ id: 'd1' }), { kind: 'library', target: 'pairF' });
  assert.deepEqual(j({ id: 'd2' }), { kind: 'library_top' });
  assert.deepEqual(j({ id: 'd3' }), { kind: 'library_top' }, '휴지통 폴더 안 자료도 지우지 않음');
  assert.deepEqual(j({ id: 't1', name: 'Thumbs.db' }), { kind: 'attach', attach: 'task' }, '기록이 먼저');
  assert.deepEqual(j({ id: 'n1' }), { kind: 'attach', attach: 'note' });
  assert.equal(j({ id: 'x', name: 'Thumbs.db' }).kind, 'junk');
  assert.equal(j({ id: 'x', name: 'Web2 글자 읽기 임시', md5Checksum: undefined }).kind, 'temp');
  assert.equal(j({ id: 'o1' }).kind, 'old');
  assert.equal(j({ id: 'x' }).kind, 'dup');
  assert.equal(j({ id: 'x', md5Checksum: md5(1) }).kind, 'none');
});

test('scan: 숫자만·내 작업공간 기록만·폴더는 판정하지 않음·내용 안 엶', async () => {
  const w = world();
  const r = await w.top.scan();
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { library: 1, library_top: 2, attach: 2, old: 1, temp: 1, junk: 2, dup: 1, none: 2, secret: 0 });
  assert.equal(r.total, 12, '폴더 3개는 빼고 맨 위 파일만');
  assert.deepEqual(r.wait, [], '정리 대기 폴더가 아직 없음');
  assert.deepEqual(r.folders.map(f => f.name), ['03. 궤도', '06. 선전', '잡동사니']);
  assert.ok(w.seen.every(([, f]) => f.includes(`workspace_id=${WS}`)), '모든 기록 읽기는 내 작업공간만');
  assert.ok(!w.drive.calls.some(c => c[0] !== 'GET'), 'scan은 아무것도 바꾸지 않음');
});

test('tidy: 옮김·첨부로·휴지통·정리 대기, 사람 폴더·기록 파일 지키기, 되돌리기 표식, 다시 눌러도 안전, undo', async () => {
  const w = world();
  const r = await w.top.tidy(null);
  assert.deepEqual({ ...r, batch: undefined }, { ok: true, batch: undefined, moved: 1, attached: 2, trashed: 3, waiting: 3, kept: 2, need_align: 0, cant: 1, failed: 0, left: 0 });
  const it = id => w.drive.items.get(id);
  assert.deepEqual(it('inFolderDoc00001').parents, ['pairA00000000001'], '① 앱 폴더의 짝으로');
  assert.deepEqual(it('outsideDoc000001').parents, [LIB], '폴더 밖 자료는 그대로');
  assert.deepEqual(it('taskFile00000001').parents, ['taskFolder000001'], "② 있던 '할 일 첨부' 폴더와 합침");
  const noteFolder = [...w.drive.items].find(([, v]) => v.name === ATTACH_FOLDER_NAMES.note)[0];
  assert.deepEqual(it('noteFile00000001').parents, [noteFolder]);
  assert.equal(it('textTemp00000001').trashed, true); assert.equal(it('thumbs0000000001').trashed, true); assert.equal(it('dupTop0000000001').trashed, true);
  assert.notEqual(it('refDup0000000001').trashed, true, '기록이 가리키는 중복은 남김');
  assert.notEqual(it('dupBelow00000001').trashed, true, '아래 폴더 원본은 그대로');
  assert.equal(it('lockedJunk000001').trashed, undefined, '권한 없는 파일은 cant');
  const wait = [...w.drive.items].find(([, v]) => v.name === WAIT_FOLDER_NAME)[0];
  for (const id of ['oldOrig000000001', 'stray00000000001', 'stray00000000002']) assert.deepEqual(it(id).parents, [wait], id);
  assert.deepEqual(it('humanFolder00001'), { name: '사람이 만든 폴더', mimeType: FM, parents: [LIB] }, '사람이 만든 폴더는 손대지 않음');
  assert.equal(it('stray00000000001').appProperties[TIDY_MARK.from], LIB);
  assert.equal(it('stray00000000001').appProperties[TIDY_MARK.batch], 'batch0001');
  assert.ok(!w.drive.calls.some(c => c[0] === 'DELETE'));
  // 다시 눌러도 이미 한 것은 다시 하지 않음
  const before = w.drive.calls.filter(c => c[0] === 'PATCH').length;
  const again = await w.top.tidy('batch0002');
  assert.deepEqual([again.moved, again.attached, again.trashed, again.waiting, again.cant], [0, 0, 0, 0, 1]);
  assert.equal(w.drive.calls.filter(c => c[0] === 'PATCH').length - before, 1, '권한 없는 파일만 다시 시도');
  // scan: 정리 대기 목록 + 제안
  const s = await w.top.scan();
  const sug = Object.fromEntries(s.wait.map(x => [x.name, x.suggest]));
  assert.equal(sug['투쟁속보 제2호.pdf'], U(11)); assert.equal(sug['photo_2026-09-12_21-20.jpg'], U(12)); assert.equal(sug['옛 판.pdf'], null);
  // 되돌리기: 원래 자리로, 휴지통에서 꺼냄, 표식 지움
  const u = await w.top.undo('batch0001');
  assert.equal(u.restored, 9); assert.equal(u.left, 0);
  for (const id of ['inFolderDoc00001', 'taskFile00000001', 'textTemp00000001', 'stray00000000001']) { assert.deepEqual(it(id).parents, [LIB], id); assert.equal(it(id).trashed, false); assert.equal(it(id).appProperties[TIDY_MARK.batch], undefined); }
});

test('시간 한도: 남으면 left > 0, 이어서 부르면 끝', async () => {
  const w = world();
  const orig = w.drive.fetch;
  let n = 0;
  const top = createTopFiles({ admin: fakeDb(w.tables), db: fakeDb(w.tables), fetch: async (u, i = {}) => { if (i.method === 'PATCH') n++; return orig(u, i); }, token: 't', workspaceId: WS, userId: U(99), titleFor: x => x, classify: () => ({ category: '기타', tags: [] }), now: () => n * 10, budgetMs: 25, newBatch: () => 'batch0003', log: () => {} });
  const r = await top.tidy(null);
  assert.ok(r.left > 0 && r.left < 10, `남음 ${r.left}`);
  const r2 = await top.tidy(r.batch);
  const r3 = r2.left ? await top.tidy(r.batch) : r2;
  const r4 = r3.left ? await top.tidy(r.batch) : r3;
  assert.equal(r4.left, 0, '끝까지(권한 없는 파일은 cant로 세고 남기지 않음)');
});

test('정리 대기 파일: [휴지통] / [자료실에 등록 + 그 폴더로], 정리 대기 밖 파일·남의 폴더는 거절', async () => {
  const w = world();
  await w.top.tidy(null);
  const wait = [...w.drive.items].find(([, v]) => v.name === WAIT_FOLDER_NAME)[0];
  await assert.rejects(w.top.waitAct('outsideDoc000001', 'trash'), e => e.code === 'not_waiting', '정리 대기 밖 파일');
  await assert.rejects(w.top.waitAct('stray00000000001', U(77)), e => e.code === 'folder_invalid', '내 앱 폴더가 아님');
  const t = await w.top.waitAct('stray00000000002', 'trash');
  assert.equal(t.trashed, 1); assert.equal(w.drive.items.get('stray00000000002').trashed, true);
  const r = await w.top.waitAct('stray00000000001', U(10));
  assert.equal(r.ok, true); assert.equal(r.moved, true);
  const doc = w.tables.app_documents.find(d => d.file_id === 'stray00000000001' && d.workspace_id === WS);
  assert.ok(doc, '같은 드라이브 id로 자료 행 하나(복사 없음)');
  assert.equal(doc.visibility, 'private');
  assert.equal(w.tables.app_library_folder_items.find(i => i.document_id === doc.id).folder_id, U(10));
  assert.deepEqual(w.drive.items.get('stray00000000001').parents, ['pairA00000000001']);
  assert.ok(!w.drive.calls.some(c => c[0] === 'POST' && c[1].includes('/copy')), '복사 없음');
  await assert.rejects(w.top.waitAct('stray00000000001', 'trash'), e => e.code === 'not_waiting', '이미 옮긴 파일');
  void wait;
});

test('library-files index.ts: 요청 모양 검사 뒤 내 owner 작업공간·내 토큰만', () => {
  const src = readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf("input.action.startsWith('top-files-')");
  assert.ok(at > 0);
  const part = src.slice(at, at + 1600);
  assert.ok(part.indexOf('parseTopFilesRequest(input)') < part.indexOf('workspaceFor(user.id)'));
  assert.match(part, /workspaceId:wmTop\.workspace_id/);
  assert.doesNotMatch(part, /input\.workspace|input\.user/);
  assert.match(part, /global:\{headers:\{Authorization:'Bearer '/, '앱 표는 내 토큰으로');
});

test('S70-69 맨 위 파일 정리: 비밀값 파일은 옮기지도 지우지도 않고, 정리 대기 목록·등록에서도 뺀다', async () => {
  const w = world();
  w.drive.items.set('keyFile000000001', { name: 'release.keystore', mimeType: 'application/octet-stream', parents: [LIB], size: '10', md5Checksum: md5(30) });
  w.drive.items.set('pwFile0000000001', { name: '키 비밀번호.txt', mimeType: 'text/plain', parents: [LIB], size: '10', md5Checksum: md5(31) });
  const s = await w.top.scan();
  assert.equal(s.counts.secret, 2); assert.equal(s.counts.none, 2, '보통 파일은 그대로 정리 대기 후보');
  await w.top.tidy(null);
  assert.deepEqual(w.drive.items.get('keyFile000000001').parents, [LIB]); assert.notEqual(w.drive.items.get('keyFile000000001').trashed, true);
  assert.deepEqual(w.drive.items.get('pwFile0000000001').parents, [LIB]);
  // 이미 정리 대기 폴더에 들어가 있던 비밀값 파일: 목록에 안 나오고 등록·휴지통 요청은 거절
  const wait = [...w.drive.items].find(([, v]) => v.name === WAIT_FOLDER_NAME)[0];
  w.drive.items.set('keyWait000000001', { name: 'upload.jks', mimeType: 'application/octet-stream', parents: [wait], size: '10' });
  const s2 = await w.top.scan();
  assert.equal(s2.wait.some(x => x.id === 'keyWait000000001'), false);
  assert.ok(s2.wait.length > 0, '보통 정리 대기 파일은 나옴');
  await assert.rejects(w.top.waitAct('keyWait000000001', U(10)), e => e.code === 'secret_file');
  await assert.rejects(w.top.waitAct('keyWait000000001', 'trash'), e => e.code === 'secret_file');
  assert.equal(w.tables.app_documents.some(d => d.file_id === 'keyWait000000001'), false);
});
