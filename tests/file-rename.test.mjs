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

// ---- 화면 공용 부품(app/file-rename.js)과 화면 연결 ----
const ui = await import('../app/file-rename.js');

test('공용 부품: ✎·이름 칸 표시, 고친 이름 반영, 오류 안내', () => {
  const spec = { target: 'note', id: 'n1', driveId: 'F1', name: '216079.jpg' };
  assert.match(ui.renameButtonHtml(spec), /class="fr-edit" data-fr-edit data-fr-target="note" data-fr-id="n1" data-fr-drive="F1" data-fr-name="216079.jpg"/);
  assert.match(ui.renameHostAttrs(spec), /^ data-fr-host data-fr-target="note"/);
  assert.equal(ui.renameButtonHtml({ ...spec, driveId: '' }), '');
  assert.equal(ui.renameHostAttrs(null), '');
  assert.match(ui.renameButtonHtml({ ...spec, name: '"><b>x' }), /data-fr-name="&quot;&gt;&lt;b&gt;x"/);
  const note = { id: 'n1', updated_at: 'old', attachments: [{ drive_file_id: 'F1', file_name: '216079.jpg' }, { drive_file_id: 'F2', file_name: 'b.png' }] };
  assert.equal(ui.applyRenamedNote(note, { drive_file_id: 'F1', name: '명단.jpg', notes: [{ id: 'n1', updated_at: 'new' }] }), true);
  assert.equal(note.attachments[0].file_name, '명단.jpg');
  assert.equal(note.attachments[1].file_name, 'b.png');
  assert.equal(note.updated_at, 'new');
  assert.match(ui.renameErrorText({ status: 400, message: 'Unknown action' }), /아직 준비되지 않았어요/);
  assert.match(ui.renameErrorText({ status: 400, message: '이름은 120자까지예요.' }), /120자/);
  assert.match(ui.renameErrorText({ status: 503 }), /확인하지 못했어요/);
  assert.match(ui.aiNameText({ skipped: 'no_text' }), /읽어 둔 글자가 없어/);
});

test('부품: 서버에는 이름 부분만 보내고(확장자는 서버가), 자동 저장 없음(기기 저장 검사는 audit 작업)', () => {
  const src = read('../app/file-rename.js');
  assert.match(src, /action: 'rename-file', target: spec\.target, id: spec\.id, drive_file_id: spec\.driveId, base: r\.base/);
  assert.match(src, /kind: 'file_name', target: spec\.target, id: spec\.id, drive_file_id: spec\.driveId/);
  // [AI 이름]은 칸만 채운다: suggest 안에서 rename-file을 부르지 않는다.
  const suggest = src.slice(src.indexOf('const suggest = async'), src.indexOf('// 줄을 누르면 파일이 열리므로'));
  assert.doesNotMatch(suggest, /rename-file/);
  assert.match(src, /'\.\/file-rename\.css'/);
});

test('첨부 파일 줄이 있는 화면마다 같은 부품을 쓴다', () => {
  const uses = {
    'basket.js': /renameHostAttrs\(renameSpec\)[\s\S]*renameButtonHtml\(renameSpec\)/,
    'basket-notes.js': /markRenameHost\(line\.querySelector\('\.file-line-main b'\)/,
    'task-files.js': /target: 'task', id: taskId/,
    'meeting-round-detail.js': /markRenameHost\(row\.querySelector\('\.file-line-main b'\)/,
    // FILE-이름고치기연필먹통: ⋯가 있는 줄은 ✎ 없이 ⋯ 안 [이름 수정](renameMenuAttrs → menuItemsHtml {rename}).
    'workplace-detail.js': /rename:renameMenuAttrs\(rn\)/,
    'project-system-v3.js': /rename:renameMenuAttrs\(rn\)/,
    'meeting-round-detail.js#menu': /mrdTranscribeItem\(d\)\+mrdFileOwnItems\(d\),mrdRename\(d\)\)/,
    // 빠짐12: 자료실 [이름 바꾸기]·F2 — 보이는 이름이 파일 이름인 줄은 같은 부품(target document).
    'library-upload.js': /fileNameShown\(d\)\)\{[^}]*markRenameHost\(title,\{target:'document',id:d\.id,driveId:d\.file_id,name:d\.file_name\}\);openRenameEditor\(title\)/,
  };
  for (const [key, re] of Object.entries(uses)) {
    const file = key.split('#')[0], src = read('../app/' + file);
    assert.match(src, /from '\.\/file-rename\.js'/, key);
    assert.match(src, re, key);
  }
  assert.match(read('../app/google-tasks.js'), /kptu:file-renamed[\s\S]*attach\?\.renamed\?\.\(d\)/);
  assert.match(read('../app/google-tasks.js'), /taskId:task\?\.id/);
  for (const file of ['basket.js', 'basket-notes.js', 'task-files.js', 'google-tasks.js', 'project-system-v3.js']) assert.match(read('../app/' + file), /kptu:file-renamed/, file);
});

// ---- FILE-이름고치기연필먹통: ⋯가 있는 파일 줄은 ✎ 없이 ⋯ 안 [이름 수정] ----
test('⋯ 메뉴 항목: [이름 수정] 속성(줄 정보 담김, 값 이스케이프, 정보 없으면 빈 글자)과 공용 항목 만들기', async () => {
  const spec = { target: 'document', id: 'd1', driveId: 'F1', name: '216079.jpg' };
  const attrs = ui.renameMenuAttrs(spec);
  assert.equal(attrs, ' data-fr-menu-edit data-fr-target="document" data-fr-id="d1" data-fr-drive="F1" data-fr-name="216079.jpg"');
  assert.doesNotMatch(attrs, /data-fr-edit[ =]/); // ✎ 단추(data-fr-edit)와 겹치지 않는다
  assert.equal(ui.renameMenuAttrs(null), '');
  assert.equal(ui.renameMenuAttrs({ ...spec, driveId: '' }), '');
  assert.match(ui.renameMenuAttrs({ ...spec, name: '"><b>x' }), /data-fr-name="&quot;&gt;&lt;b&gt;x"/);
  // ⋯ 칸의 공용 항목 만들기(file-actions.js): rename을 넘기면 [내려받기] 뒤 [이름 수정] 하나, 넘기지 않으면 예전 그대로.
  const {menuItemsHtml} = await import('../app/file-actions.js');
  const file = {name: '216079.jpg', mime: 'image/jpeg', driveId: 'F1', documentId: 'd1'};
  const withRename = menuItemsHtml(file, {attrs: ' data-x="1"', attr: 'data-fa-menu', rename: attrs});
  assert.match(withRename, /내려받기<\/button><button type="button" data-fr-menu-edit data-fr-target="document"[^>]*>이름 수정<\/button>$/);
  assert.equal((withRename.match(/<button/g) || []).length, 3);
  assert.equal((menuItemsHtml(file, {attrs: ' data-x="1"', attr: 'data-fa-menu'}).match(/<button/g) || []).length, 2);
  assert.doesNotMatch(menuItemsHtml(file, {attrs: '', rename: ui.renameMenuAttrs(null)}), /이름 수정/);
});

test('⋯가 있는 파일 줄 전수: ✎(renameButtonHtml)를 그리지 않고 ⋯ 안에 [이름 수정]을 둔다', () => {
  // 사업 보고 결과 창 회의자료·조직 창 자료·프로젝트 자료·노트 첨부(⋯ 팝업). 이 줄들은 ✎ 단추를 따로 두지 않는다.
  for (const file of ['meeting-round-detail.js', 'workplace-detail.js', 'project-system-v3.js', 'basket-notes.js']) {
    const src = read('../app/' + file);
    assert.doesNotMatch(src, /renameButtonHtml/, file);
  }
  const mrd = read('../app/meeting-round-detail.js');
  // ⋯ 칸(fileMoreHtml)의 extra 첫머리에 [이름 수정], 덮개(.file-line-open) 앞에는 ✎ 없음.
  assert.match(mrd, /fileMoreHtml\(d,name,mrdTranscribeItem\(d\)\+mrdFileOwnItems\(d\),mrdRename\(d\)\)/);
  assert.doesNotMatch(mrd, /\$\{mrdRename\(d\)\}<button class="file-line-open"/);
  assert.match(read('../app/workplace-detail.js'), /menuItemsHtml\(fa,\{attrs:fileAttrs\(fa\),attr:'data-fa-menu',rename:renameMenuAttrs\(rn\)\}\)\}<button type="button" data-wd-doc-remove/);
  assert.match(read('../app/project-system-v3.js'), /menuItemsHtml\(fa,\{attrs:fileAttrs\(fa\),attr:'data-fa-menu',rename:renameMenuAttrs\(rn\)\}\)\}<button type="button" data-ps3-edit-doc/);
  assert.match(read('../app/meeting-columns.js'), /export function fileMoreHtml\(d,name=d\?\.file_name\|\|d\?\.title\|\|'파일',extra='',rename=''\)/);
  const notes = read('../app/basket-notes.js');
  assert.match(notes, /\['data-note-file-rename', '이름 수정'\], \['data-note-file-detach', '빼기'\]/);
  assert.match(notes, /b\.hasAttribute\('data-note-file-rename'\)[^\n]*\[data-fr-host\][^\n]*openRenameEditor\(host\)/);
  assert.match(notes, /end:link \+ more,/); // 노트 첨부 줄 끝: [Drive에서 열기]·⋯만
  // ⋯가 없는 줄(바구니 파일 카드·할 일 첨부 편집 줄)은 ✎를 그대로 둔다.
  assert.match(read('../app/basket.js'), /renameButtonHtml\(renameSpec\)/);
  assert.match(read('../app/task-files.js'), /renameButtonHtml\(rn\)/);
});

test('이름 고치기 손짓: 열기 덮개(.file-line-open) 위 이름 글자 자리도 이름 칸이 받고, 한 번 누르기는 덮개 동작', () => {
  const src = read('../app/file-rename.js');
  assert.match(src, /const OPEN_COVER = '\.file-line-open';/);
  assert.match(src, /function hostAt\(e\)/);
  // 두 번 누르기·꾹 누르기·길게 누르기 메뉴·한 번 누르기 모두 같은 판정(hostAt) — 덮개 밖에서는 예전처럼 이름 칸 안만.
  const bound = src.slice(src.indexOf('전역 한 번'));
  assert.equal((bound.match(/hostAt\(e\)/g) || []).length, 4);
  assert.doesNotMatch(bound, /e\.target\.closest\('\[data-fr-host\]'\)/);
  // 한 번 누르기: 덮개가 받았으면 지연 뒤 덮개를 다시 눌러 원래 동작(열기)으로 넘긴다.
  assert.match(bound, /const via = e\.target\.closest\(OPEN_COVER\) \|\| h;/);
  assert.match(bound, /\(via\?\.isConnected \? via : host\)\.click\(\)/);
  // ⋯ 메뉴 항목 누르기: 열린 <details>를 닫고 같은 줄의 이름 칸을 연다.
  assert.match(bound, /closest\('\[data-fr-menu-edit\]'\)[\s\S]*closest\('details\[open\]'\)\?\.removeAttribute\('open'\)[\s\S]*openRenameEditor\(host\)/);
});

test('공용 CSS: 이름 칸이 열린 덮개 줄은 칸이 눌림을 받고, 상태 글자는 한 글자씩 꺾이지 않는다', () => {
  const css = read('../app/ui-standard.css');
  assert.match(css, /\.modal \.file-line:has\(\.file-line-open\) \.fr-box\{pointer-events:auto\}/);
  assert.match(css, /\.modal \.file-line:has\(\.fr-box\) \.file-line-open\{pointer-events:none\}/);
  const state = css.match(/\n\.file-line-state\{([^}]*)\}/)?.[1] || '';
  assert.match(state, /flex:0 0 auto/);
  assert.match(state, /word-break:keep-all/);
  assert.doesNotMatch(state, /overflow-wrap:anywhere/);
});
