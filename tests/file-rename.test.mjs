// ATT-이름고치기: 첨부 파일 이름 규칙(app/file-rename-name.mjs)·Edge 사본 일치·서버 이름 바꾸기(document-actions/file-rename.ts)·AI 이름 검사(ai-assist/file-name.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const n = await import('../app/file-rename-name.mjs');
const { renameFile, parseRenameRequest } = await import('../supabase/functions/document-actions/file-rename.ts');
const fn = await import('../supabase/functions/ai-assist/file-name.ts');

test('이름 규칙: 확장자 따로, 빈 이름·못 쓰는 글자·점 끝·긴 이름 막기', () => {
  assert.deepEqual(n.splitFileName('216079.jpg'), { base: '216079', ext: '.jpg' });
  assert.deepEqual(n.splitFileName('보고서.final.HWPX'), { base: '보고서.final', ext: '.HWPX' });
  assert.deepEqual(n.splitFileName('.env'), { base: '.env', ext: '' });
  assert.deepEqual(n.splitFileName('메모'), { base: '메모', ext: '' });
  assert.equal(n.checkFileBase('  ').ok, false);
  assert.equal(n.checkFileBase('a/b').code, 'bad_char');
  assert.equal(n.checkFileBase('a:b').code, 'bad_char');
  assert.equal(n.checkFileBase('a\u0007b').code, 'bad_char');
  assert.equal(n.checkFileBase('이름.').code, 'dot_end');
  assert.equal(n.checkFileBase('가'.repeat(n.FILE_BASE_MAX + 1)).code, 'too_long');
  assert.deepEqual(n.checkFileBase('  교섭위원   명단 표 '), { ok: true, base: '교섭위원 명단 표' });
  assert.equal(n.renamedFileName('216079.jpg', '교섭위원 명단 표'), '교섭위원 명단 표.jpg');
  assert.equal(n.renamedFileName('216079.jpg', ''), null);
  assert.equal(n.tidySuggestedBase('교섭: 위원/명단.'), '교섭 위원 명단');
  assert.equal(n.tidySuggestedBase('???'), '');
});

test('Edge 사본은 화면 원본과 바이트까지 같다', () => {
  const banner = '// Source of truth: app/file-rename-name.mjs.\n// Deployment-local copy; the regression compares everything below this banner byte for byte.\n';
  const copy = read('../supabase/functions/_shared/file-rename-name.mjs');
  assert.ok(copy.startsWith(banner));
  assert.equal(copy.slice(banner.length), read('../app/file-rename-name.mjs'));
});

test('요청 모양: 정해진 칸만, 종류별 ID 모양', () => {
  const ok = { action: 'rename-file', target: 'note', id: '11111111-1111-4111-8111-111111111111', drive_file_id: 'abc_DEF-1', base: '새 이름' };
  assert.equal(parseRenameRequest(ok).target, 'note');
  assert.throws(() => parseRenameRequest({ ...ok, workspace_id: 'x' }), /확인할 수 없습니다/);
  assert.throws(() => parseRenameRequest({ ...ok, target: 'page' }));
  assert.throws(() => parseRenameRequest({ ...ok, id: 'not-uuid' }));
  assert.equal(parseRenameRequest({ ...ok, target: 'task', id: 'TaSk_1' }).id, 'TaSk_1');
  assert.throws(() => parseRenameRequest({ ...ok, drive_file_id: '../x' }));
});

// 가짜 PostgREST(내 로그인 토큰 경로) + 가짜 Drive.
function fakeWorld({ driveStatus = 200, taskInsertFails = false } = {}) {
  const WS = '22222222-2222-4222-8222-222222222222', NOTE = '11111111-1111-4111-8111-111111111111', DOC = '33333333-3333-4333-8333-333333333333';
  const state = {
    notes: [{ id: NOTE, workspace_id: WS, updated_at: 't0', attachments: [{ drive_file_id: 'F1', file_name: '216079.jpg', mime_type: 'image/jpeg', size_bytes: 3 }, { drive_file_id: 'F2', file_name: 'b.png' }] }],
    tasks: [{ workspace_id: WS, google_task_id: 'T1', drive_file_id: 'F1', file_name: '216079.jpg', mime_type: 'image/jpeg', size_bytes: 3, created_at: 'c' }],
    docs: [{ id: DOC, workspace_id: WS, file_id: 'F1', file_name: '216079.jpg', title: '216079' }],
    drive: [], calls: [],
  };
  const q = (path) => new URLSearchParams(path.split('?')[1] || '');
  const eq = (v) => v?.replace(/^eq\./, '');
  const userDb = async (path, opts = {}) => {
    const method = opts.method || 'GET', table = path.split('?')[0], p = q(path);
    state.calls.push(`${method} ${table}`);
    if (table === 'app_notes') {
      let rows = state.notes.filter((x) => (!p.get('id') || x.id === eq(p.get('id'))) && (!p.get('workspace_id') || x.workspace_id === eq(p.get('workspace_id'))));
      if (p.get('attachments')) { const want = JSON.parse(p.get('attachments').replace(/^cs\./, ''))[0].drive_file_id; rows = rows.filter((x) => x.attachments.some((a) => a.drive_file_id === want)); }
      if (method === 'PATCH') { rows = rows.filter((x) => x.updated_at === eq(p.get('updated_at'))); rows.forEach((x) => Object.assign(x, opts.body)); return rows.map((x) => ({ id: x.id, updated_at: x.updated_at })); }
      return structuredClone(rows);
    }
    if (table === 'app_task_attachments') {
      if (method === 'POST') { if (taskInsertFails && opts.body.file_name !== '216079.jpg') throw Object.assign(new Error('x'), { status: 403 }); state.tasks.push({ ...opts.body, created_at: 'n' }); return null; }
      const rows = state.tasks.filter((x) => (!p.get('google_task_id') || x.google_task_id === eq(p.get('google_task_id'))) && (!p.get('drive_file_id') || x.drive_file_id === eq(p.get('drive_file_id'))) && (!p.get('file_name') || x.file_name === eq(p.get('file_name'))));
      if (method === 'DELETE') { state.tasks = state.tasks.filter((x) => !rows.includes(x)); return rows.map((x) => ({ drive_file_id: x.drive_file_id })); }
      return structuredClone(rows);
    }
    if (table === 'app_documents') {
      const rows = state.docs.filter((x) => (!p.get('id') || x.id === eq(p.get('id'))) && (!p.get('file_id') || x.file_id === eq(p.get('file_id'))));
      if (method === 'PATCH') { rows.forEach((x) => Object.assign(x, opts.body)); return rows.map((x) => ({ id: x.id, file_name: x.file_name })); }
      return structuredClone(rows);
    }
    throw new Error('unexpected ' + path);
  };
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body); state.drive.push({ url, body });
    return new Response(JSON.stringify({ id: 'F1', name: body.name, trashed: false }), { status: driveStatus });
  };
  return { state, NOTE, DOC, deps: { userDb, fetch, driveToken: async () => 'tok', now: () => 0 } };
}

test('정리함 첨부 이름 바꾸기: Drive 원본 → 노트·할 일·자료 줄 모두 같은 새 이름(확장자 자동)', async () => {
  const w = fakeWorld();
  const out = await renameFile({ action: 'rename-file', target: 'note', id: w.NOTE, drive_file_id: 'F1', base: '교섭위원 명단 표' }, w.deps);
  assert.equal(out.name, '교섭위원 명단 표.jpg');
  assert.deepEqual(out.updated, { notes: 1, tasks: 1, documents: 1 });
  assert.deepEqual(out.notes, [{ id: w.NOTE, updated_at: new Date(0).toISOString() }]);
  assert.equal(w.state.drive.length, 1);
  assert.match(w.state.drive[0].url, /files\/F1\?/);
  assert.deepEqual(w.state.drive[0].body, { name: '교섭위원 명단 표.jpg' });
  assert.equal(w.state.notes[0].attachments[0].file_name, '교섭위원 명단 표.jpg');
  assert.equal(w.state.notes[0].attachments[1].file_name, 'b.png');
  assert.equal(w.state.tasks.length, 1);
  assert.equal(w.state.tasks[0].file_name, '교섭위원 명단 표.jpg');
  assert.equal(w.state.docs[0].file_name, '교섭위원 명단 표.jpg');
  assert.equal(w.state.docs[0].title, '교섭위원 명단 표');
  // Drive가 DB보다 먼저 바뀐다.
  assert.ok(w.state.calls.indexOf('PATCH app_notes') > 0);
});

test('잘못된 이름·남의 줄·Drive 실패면 DB를 바꾸지 않는다', async () => {
  const w = fakeWorld();
  await assert.rejects(renameFile({ action: 'rename-file', target: 'note', id: w.NOTE, drive_file_id: 'F1', base: 'a/b' }, w.deps), (e) => e.code === 'INVALID_NAME');
  await assert.rejects(renameFile({ action: 'rename-file', target: 'note', id: '44444444-4444-4444-8444-444444444444', drive_file_id: 'F1', base: 'x' }, w.deps), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(renameFile({ action: 'rename-file', target: 'note', id: w.NOTE, drive_file_id: 'F9', base: 'x' }, w.deps), (e) => e.code === 'ATTACHMENT_NOT_FOUND');
  assert.equal(w.state.drive.length, 0);
  const d = fakeWorld({ driveStatus: 404 });
  await assert.rejects(renameFile({ action: 'rename-file', target: 'document', id: d.DOC, drive_file_id: 'F1', base: 'x' }, d.deps), (e) => e.code === 'DRIVE_FILE_MISSING');
  assert.equal(d.state.docs[0].file_name, '216079.jpg');
  assert.equal(d.state.notes[0].attachments[0].file_name, '216079.jpg');
});

test('할 일 첨부 다시 넣기가 실패하면 원래 줄을 되살리고 결과 불명으로 알린다', async () => {
  const w = fakeWorld({ taskInsertFails: true });
  await assert.rejects(renameFile({ action: 'rename-file', target: 'task', id: 'T1', drive_file_id: 'F1', base: '새 이름' }, w.deps), (e) => e.code === 'RESULT_UNKNOWN');
  assert.equal(w.state.tasks.length, 1);
  assert.equal(w.state.tasks[0].file_name, '216079.jpg');
});

test('AI 이름: 요청 모양·답 검사(한 줄·길이·못 쓰는 글자·연락처)', () => {
  assert.ok(fn.parseFileNameRequest({ kind: 'file_name', target: 'note', id: '11111111-1111-4111-8111-111111111111', drive_file_id: 'F1' }));
  assert.equal(fn.parseFileNameRequest({ kind: 'file_name', target: 'note', id: '11111111-1111-4111-8111-111111111111', drive_file_id: 'F1', text: 'x' }), null);
  assert.equal(fn.parseFileNameAnswer('{"name":"교섭위원 명단 표"}'), '교섭위원 명단 표');
  assert.equal(fn.parseFileNameAnswer('{"name":"교섭위원 명단 표.jpg"}'), '교섭위원 명단 표');
  assert.equal(fn.parseFileNameAnswer('{"name":"a\\nb"}'), null);
  assert.equal(fn.parseFileNameAnswer('{"name":"연락처 010-1234-5678"}'), null);
  assert.equal(fn.parseFileNameAnswer('{"name":""}'), null);
  assert.equal(fn.parseFileNameAnswer('{"name":"' + '가'.repeat(61) + '"}'), null);
  assert.equal(fn.noteOcrText({ ocr: { state: 'done', text: '명단' } }), '명단');
  assert.equal(fn.noteOcrText({ ocr: { state: 'unread' } }), '');
  assert.match(fn.fileNameMaterial('a.jpg', '메일 x@y.com'), /\[이메일\]/);
});

test('서버 연결: document-actions가 rename-file을 내 로그인 토큰으로, ai-assist가 file_name을 추천만', () => {
  const da = read('../supabase/functions/document-actions/index.ts');
  assert.match(da, /action === 'rename-file'/);
  assert.match(da, /userDb: userDbFor\(token\)/);
  const ai = read('../supabase/functions/ai-assist/handler.ts');
  assert.match(ai, /input\.kind === "file_name"\) return await runFileName/);
  const run = ai.slice(ai.indexOf('async function runFileName'), ai.indexOf('// ---- 사업영역 AI'));
  assert.doesNotMatch(run, /method: "PATCH"|method: "POST"/);
});
