import test from 'node:test';
import assert from 'node:assert/strict';
import { readTaskFiles, fileLinksHtml, fileProblem, driveFileUrl, attachTaskFile, detachTaskFile, MAX_TASK_FILES } from '../app/task-files.js';

// TASK-파일붙이기: the app reads the link table with the owner's session and changes it only through the google-tasks Edge.
// UI-올리기진행표시 ②: 파일 붙이기(attach)는 공용 보내기(upload-send.mjs sendUploadApi)로 간다. 시험 환경에는 XMLHttpRequest가 없어
// fetch로 보내므로, 그 요청을 그 rt의 가짜 api가 받게 잇는다(rt마다 다른 가짜 로그인 값으로 가린다). 빼기(detach)는 지금처럼 rt.api.
const MOCK = 'https://mock.invalid', uploadRts = new Map();
globalThis.fetch = async (url, options = {}) => {
  const rt = uploadRts.get(String(options.headers?.Authorization || ''));
  if (!rt) throw Error('unexpected fetch ' + url);
  try { const data = await rt.api(String(url).replace(MOCK, ''), { method: options.method, body: options.body, upload: true }); return new Response(JSON.stringify(data ?? null), { status: 200 }); }
  catch (e) { return new Response(JSON.stringify({ message: e.message }), { status: e.status || 500 }); }
};
const viaUpload = rt => {
  const token = 'mock-' + (uploadRts.size + 1);
  uploadRts.set('Bearer ' + token, rt);
  rt.session ??= { ensure: async () => true, read: () => ({ access_token: token }), epoch: () => 0 };
  rt.config ??= { url: MOCK, key: 'mock-key' };
  return rt;
};
const fakeRt = (answer) => {
  const calls = [];
  return { calls, rt: viaUpload({ api: async (path, options = {}) => { calls.push({ path, options }); return typeof answer === 'function' ? answer(path, options) : answer; }, copyUploadFile: async f => f }) };
};

test('readTaskFiles: owner REST read in chunks of 50, attach order kept, bad rows skipped', async () => {
  const ids = Array.from({ length: 60 }, (_, i) => 't' + i).concat(['t1', 'bad/id', '']);
  const { rt, calls } = fakeRt(path => path.includes('t0,') ? [
    { google_task_id: 't1', drive_file_id: 'f1', file_name: 'a.txt', size_bytes: 3 },
    { google_task_id: 't1', drive_file_id: 'f2', file_name: 'b.pdf', size_bytes: '5' },
    { google_task_id: 't2', drive_file_id: '../x', file_name: 'evil' },
    { google_task_id: 3, drive_file_id: 'f3', file_name: 'no task' }
  ] : []);
  const map = await readTaskFiles(ids, { rt });
  assert.equal(calls.length, 2);
  assert.match(calls[0].path, /^\/rest\/v1\/app_task_attachments\?google_task_id=in\.\(t0,t1,.*t49\)&select=google_task_id,drive_file_id,file_name,size_bytes&order=created_at\.asc$/);
  assert.ok(!calls[0].path.includes('bad/id'));
  assert.match(calls[1].path, /in\.\(t50,.*t59\)/);
  assert.deepEqual([...map], [['t1', [{ drive_file_id: 'f1', file_name: 'a.txt', size_bytes: 3 }, { drive_file_id: 'f2', file_name: 'b.pdf', size_bytes: 5 }]]]);
});

test('readTaskFiles: with no tasks it still asks once (table check); a missing table throws', async () => {
  const empty = fakeRt([]);
  assert.equal((await readTaskFiles([], { rt: empty.rt })).size, 0);
  assert.equal(empty.calls.length, 1);
  assert.match(empty.calls[0].path, /^\/rest\/v1\/app_task_attachments\?limit=1&select=/);
  const missing = { api: async () => { throw Object.assign(new Error('Could not find the table'), { status: 404 }); } };
  await assert.rejects(readTaskFiles(['t1'], { rt: missing }));
  await assert.rejects(readTaskFiles(['t1'], { rt: fakeRt({ files: [] }).rt }), 'a non-array answer is not support');
});

test('file names are escaped links to Drive that open in a new tab', () => {
  assert.equal(fileLinksHtml([]), '');
  const html = fileLinksHtml([{ drive_file_id: 'f1', file_name: '<b>"x"</b>.txt' }]);
  assert.match(html, /^<div class="gt-files"><a class="gt-file" href="https:\/\/drive\.google\.com\/file\/d\/f1\/view" target="_blank" rel="noopener noreferrer"/);
  assert.ok(html.includes('&lt;b&gt;&quot;x&quot;&lt;/b&gt;.txt'));
  assert.ok(!html.includes('<b>'));
  assert.equal(driveFileUrl('a/b'), '');
});

test('limits are checked before sending', () => {
  assert.equal(fileProblem({ size: 1 }, 0), '');
  assert.match(fileProblem({ size: 1 }, MAX_TASK_FILES), /10개까지/);
  assert.match(fileProblem({ size: 0 }, 0), /빈 파일/);
  assert.match(fileProblem({ size: 100 * 1024 * 1024 + 1 }, 0), /100MB/);
});

test('attach sends one file as multipart to the Edge; detach sends only ids', async () => {
  const { rt, calls } = fakeRt({ ok: true });
  const file = new File(['abc'], '회의록.txt', { type: 'text/plain' });
  await attachTaskFile('t1', file, { rt });
  assert.equal(calls[0].path, '/functions/v1/google-tasks?action=attach');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.upload, true, '첨부는 공용 보내기 길(실제 보낸 양)로');
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.body.get('task_id'), 't1');
  await detachTaskFile('t1', 'f1', { rt });
  assert.deepEqual(calls[1], { path: '/functions/v1/google-tasks?action=detach', options: { method: 'POST', body: { action: 'detach', task_id: 't1', drive_file_id: 'f1' }, singleFlight: false } });
});

// TASK-추가창파일 + BIZ-저장먼저닫기 3차(S59-18): 저장 창에서 고른 파일은 할 일이 생긴 뒤 그 할 일의 뒤 줄(taskFileLine)에서 파일마다 attach 하나로 올라간다.
// 못 보낸 것이 확실한 실패(4xx·빈 파일)는 그 파일만 남기고([다시 올리기]) 나머지는 이어 가고, 결과를 알 수 없는 실패(5xx)는 거기서 멈춘다(다시 보내지 않음).
import { pickProblem, taskFilesAvailable, sendTaskFilesBehind, taskFileLine } from '../app/task-files.js';
const ctxRt = (api) => viaUpload({ context: { read: () => ({ user: { id: 'u1' }, workspace: { id: 'w1' } }) }, api, copyUploadFile: async f => f });
test('sendTaskFilesBehind: one attach per file on the task line; a refused file stays for [다시 올리기] and the rest still go', async () => {
  const sent = [];
  const rt = ctxRt(async (path, options) => { const name = options.body.get('file').name; sent.push([path, options.body.get('task_id'), name]); if (name === 'b.txt') throw Object.assign(Error('Drive에 올리지 못했어요.'), { status: 409 }); return { ok: true, files: sent.filter(s => s[2] !== 'b.txt').map((s, i) => ({ drive_file_id: 'd' + i, file_name: s[2], size_bytes: 1 })), notes_synced: true }; });
  const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt'), new File([''], 'empty.txt'), new File(['c'], 'c.txt')];
  await sendTaskFilesBehind({ task: { id: 't1' }, files, count: 0, rt });
  assert.deepEqual(sent, [['/functions/v1/google-tasks?action=attach', 't1', 'a.txt'], ['/functions/v1/google-tasks?action=attach', 't1', 'b.txt'], ['/functions/v1/google-tasks?action=attach', 't1', 'c.txt']]);
  assert.equal(taskFileLine.has('t1', files[0]), false, '올라간 파일은 줄에서 빠진다');
  assert.equal(taskFileLine.has('t1', files[1]), true, '못 올린 파일은 [다시 올리기]를 위해 남는다');
  assert.equal(taskFileLine.has('t1', files[2]), true, '빈 파일은 보내지 않고 못 올린 것으로');
  assert.equal(taskFileLine.has('t1', files[3]), false);
});
test('sendTaskFilesBehind: an unknown result (5xx) stops the line there — nothing after it is sent; nothing goes before the task exists', async () => {
  const sent = [];
  const rt = ctxRt(async (path, options) => { const name = options.body.get('file').name; sent.push(name); if (name === 'b.txt') throw Object.assign(Error('저장 결과를 확인하지 못했습니다.'), { status: 503 }); return { ok: true, files: [], notes_synced: true }; });
  await sendTaskFilesBehind({ task: { id: 't2' }, files: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt'), new File(['c'], 'c.txt')], rt });
  assert.deepEqual(sent, ['a.txt', 'b.txt']);
  await sendTaskFilesBehind({ task: null, files: [new File(['x'], 'x.txt')], rt });
  await sendTaskFilesBehind({ task: { id: 't3' }, files: [], rt });
  assert.deepEqual(sent, ['a.txt', 'b.txt']);
});
test('sendTaskFilesBehind: a swap uploads the new file, then takes the old one off; a full task takes the old one off first', async () => {
  const calls = [];
  const rt = ctxRt(async (path, options) => { calls.push(path.includes('attach') ? 'attach:' + options.body.get('file').name : 'detach:' + options.body.drive_file_id); return { ok: true, files: [], notes_synced: true }; });
  await sendTaskFilesBehind({ task: { id: 't4' }, swaps: [{ from: { drive_file_id: 'old1', file_name: 'old.pdf', inTable: true }, file: new File(['n'], 'new.pdf') }], files: [new File(['z'], 'z.pdf')], count: 3, rt });
  assert.deepEqual(calls, ['attach:new.pdf', 'detach:old1', 'attach:z.pdf']);
  calls.length = 0;
  await sendTaskFilesBehind({ task: { id: 't5' }, swaps: [{ from: { drive_file_id: 'old2', file_name: 'o.pdf', inTable: true }, file: new File(['n'], 'n.pdf') }], count: MAX_TASK_FILES, rt });
  assert.deepEqual(calls, ['detach:old2', 'attach:n.pdf']);
});

test('pickProblem: the same limits as ⋯ → 파일 붙이기 (count, empty, size)', () => {
  const one = new File(['x'], 'x.txt');
  assert.equal(pickProblem([], [one]), '');
  assert.match(pickProblem(Array(MAX_TASK_FILES).fill(one), [one]), /10개까지/);
  assert.match(pickProblem([], [new File([''], 'e.txt')]), /^e\.txt: 빈 파일/);
});

test('taskFilesAvailable: yes only when the table answers for this owner; a no is asked again later', async () => {
  let answer = () => { throw Error('no table'); }, calls = 0;
  const rt = { context: { read: () => ({ user: { id: 'u1' } }) }, api: async () => { calls++; return answer(); } };
  assert.equal(await taskFilesAvailable({ rt }), false);
  answer = () => [];
  assert.equal(await taskFilesAvailable({ rt }), true);
  assert.equal(await taskFilesAvailable({ rt }), true);
  assert.equal(calls, 2);
  assert.equal(await taskFilesAvailable({ rt: { context: { read: () => null }, session: { read: () => null } } }), false);
});

// TASK-추가창파일: the task list's own read of the table also answers for the add windows (no second probe request).
import { taskFilesKnown, onTaskFilesReady } from '../app/task-files.js';
test('a list read that answers marks the table known for that owner and tells the add windows once', async () => {
  const heard = [];
  const stop = onTaskFilesReady(owner => heard.push(owner));
  let calls = 0;
  const rt = { context: { read: () => ({ user: { id: 'u-list' } }) }, api: async () => { calls++; return []; } };
  assert.equal(taskFilesKnown({ rt }), false);
  assert.equal(await taskFilesAvailable({ rt, ask: false }), false);
  assert.equal(calls, 0);
  await readTaskFiles(['t1'], { rt });
  assert.equal(taskFilesKnown({ rt }), true);
  assert.equal(await taskFilesAvailable({ rt, ask: false }), true);
  await readTaskFiles(['t1'], { rt });
  assert.deepEqual(heard, ['u-list']);
  assert.equal(calls, 2);
  stop();
});

// TEST-홈빠른입력안정화: windows keeping the file part's place hear a failed read too (yes=false), so they free the place.
test('a failed table read tells waiting windows no; a later answer tells yes once', async () => {
  const heard = [];
  const stop = onTaskFilesReady((owner, yes) => heard.push([owner, yes]));
  try {
    let answer = () => { throw Object.assign(Error('missing'), { status: 404 }); };
    const rt = { context: { read: () => ({ user: { id: 'm1' } }) }, api: async () => answer() };
    await assert.rejects(readTaskFiles([], { rt }));
    assert.equal(taskFilesKnown({ rt }), false);
    answer = () => [];
    await readTaskFiles([], { rt });
    await readTaskFiles([], { rt });
    assert.equal(taskFilesKnown({ rt }), true);
    assert.deepEqual(heard, [['m1', false], ['m1', true]]);
  } finally { stop(); }
});

// TASK-첨부교체: the edit window holds 교체·빼기·붙이기 until [저장], then sends the same attach / detach requests as ⋯ → 파일 붙이기.
import { taskAttachHtml, applyTaskAttachPlan, taskAttachNotice } from '../app/task-files.js';
const tf = name => new File(['abc'], name, { type: 'text/plain' });
const editRt = ({ failAttach = [], failDetach = [], start = [] } = {}) => {
  const calls = [];
  let files = start.map(f => ({ ...f }));
  let next = 1;
  const rt = {
    copyUploadFile: async f => f,
    api: async (path, options = {}) => {
      if (path.includes('action=attach')) {
        const name = options.body.get('file').name; calls.push(['attach', name]);
        if (failAttach.includes(name)) throw Object.assign(Error('올리지 못했어요.'), { status: 502 });
        if (files.length >= MAX_TASK_FILES) throw Object.assign(Error('한 할 일에는 파일을 10개까지 붙일 수 있습니다.'), { status: 400 });
        files.push({ drive_file_id: 'new' + next++, file_name: name, size_bytes: 3 });
        return { ok: true, files: [...files], task: { id: 't1', notes: 'n' }, notes_synced: true };
      }
      if (path.includes('action=detach')) {
        const id = options.body.drive_file_id; calls.push(['detach', id]);
        if (failDetach.includes(id)) throw Object.assign(Error('빼지 못했어요.'), { status: 502 });
        if (!files.some(f => f.drive_file_id === id)) throw Object.assign(Error('이미 빠진 파일입니다.'), { status: 404 });
        files = files.filter(f => f.drive_file_id !== id);
        return { ok: true, files: [...files], task: { id: 't1', notes: 'n' }, notes_synced: true };
      }
      throw Error('unexpected ' + path);
    }
  };
  viaUpload(rt);
  return { rt, calls, files: () => files };
};

test('attach box rows: 교체·빼기 on each file, held changes tagged with 되돌리기, new files with 취소, 파일 붙이기 under them', () => {
  const base = [{ drive_file_id: 'a', file_name: 'a.pdf', inTable: true }, { drive_file_id: 'b', file_name: 'b.pdf', inTable: true }, { drive_file_id: 'c', file_name: 'c.pdf', inTable: false }];
  const plain = taskAttachHtml({ base, editable: true });
  assert.equal((plain.match(/data-gt-att-swap=/g) || []).length, 3);
  assert.equal((plain.match(/data-gt-att-remove=/g) || []).length, 3);
  assert.match(plain, /data-gt-att-add[^>]*>파일 붙이기</);
  const held = taskAttachHtml({ base, editable: true, edits: new Map([['a', { kind: 'swap', file: tf('새 a.pdf') }], ['b', { kind: 'remove' }]]), added: [tf('<새>.txt')] });
  assert.match(held, /is-changed[^]*새 a\.pdf[^]*>교체<[^]*data-gt-att-undo="a"/);
  assert.match(held, /is-removed[^]*b\.pdf[^]*>뺌<[^]*data-gt-att-undo="b"/);
  assert.match(held, /is-new[^]*&lt;새&gt;\.txt[^]*data-gt-att-drop="0"/);
  assert.match(held, /저장하면 반영됩니다 · 원래 파일은 Drive에 남습니다/);
  // A changed row offers no 열기 of the old file; the unchanged one still does.
  assert.equal((held.match(/data-fa-menu="open"/g) || []).length, 1);
  // No files yet: only 첨부 [파일 붙이기].
  assert.equal(taskAttachHtml({ base: [], editable: true }).includes('gt-att-row'), false);
  assert.match(taskAttachHtml({ base: [], editable: true }), /파일 붙이기/);
  // Full: 파일 붙이기 is off; busy: every button is off.
  const ten = Array.from({ length: 10 }, (_, i) => ({ drive_file_id: 'f' + i, file_name: i + '.txt', inTable: true }));
  assert.match(taskAttachHtml({ base: ten, editable: true }), /data-gt-att-add aria-label="첨부 파일 붙이기" disabled/);
  assert.doesNotMatch(taskAttachHtml({ base, editable: true, busy: true }).replace(/data-fa-menu="(open|download)"[^>]*>/g, ''), /class="ghost gt-att-btn" data-gt-att[^>]*"(?! disabled)>/);
});

test('applyTaskAttachPlan: swap uploads first then detaches the old one; remove detaches; add uploads; Drive is never asked to delete', async () => {
  const start = [{ drive_file_id: 'a', file_name: 'a.pdf' }, { drive_file_id: 'b', file_name: 'b.pdf' }];
  const { rt, calls, files } = editRt({ start });
  const plan = { remove: [{ drive_file_id: 'b', file_name: 'b.pdf', inTable: true }, { drive_file_id: 'n', file_name: 'n.pdf', inTable: false }], swap: [{ from: { drive_file_id: 'a', file_name: 'a.pdf', inTable: true }, file: tf('a2.pdf') }], add: [tf('c.txt')], tableCount: 2 };
  const r = await applyTaskAttachPlan('t1', plan, { rt });
  assert.deepEqual(calls, [['detach', 'b'], ['attach', 'a2.pdf'], ['detach', 'a'], ['attach', 'c.txt']]);
  assert.deepEqual(r.failed, []);
  assert.deepEqual([...r.gone].sort(), ['a', 'b', 'n']);
  assert.deepEqual(files().map(f => f.file_name), ['a2.pdf', 'c.txt']);
  assert.deepEqual(r.files.map(f => f.file_name), ['a2.pdf', 'c.txt']);
  assert.equal(taskAttachNotice(r), '');
});

test('applyTaskAttachPlan: a failed upload keeps the old file; a full task takes the old one off first; failures are named', async () => {
  const one = editRt({ start: [{ drive_file_id: 'a', file_name: 'a.pdf' }], failAttach: ['a2.pdf'] });
  const r1 = await applyTaskAttachPlan('t1', { remove: [], swap: [{ from: { drive_file_id: 'a', file_name: 'a.pdf', inTable: true }, file: tf('a2.pdf') }], add: [], tableCount: 1 }, { rt: one.rt });
  assert.deepEqual(one.calls, [['attach', 'a2.pdf']]);
  assert.deepEqual(one.files().map(f => f.drive_file_id), ['a']);
  assert.equal(r1.gone.size, 0);
  assert.match(taskAttachNotice(r1), /^할 일은 저장했어요\. 첨부 1건\(a2\.pdf\)을 바꾸지 못했어요: 올리지 못했어요\./);
  const ten = Array.from({ length: 10 }, (_, i) => ({ drive_file_id: 'f' + i, file_name: i + '.txt' }));
  const full = editRt({ start: ten });
  const r2 = await applyTaskAttachPlan('t1', { remove: [], swap: [{ from: { drive_file_id: 'f3', file_name: '3.txt', inTable: true }, file: tf('3 new.txt') }], add: [], tableCount: 10 }, { rt: full.rt });
  assert.deepEqual(full.calls, [['detach', 'f3'], ['attach', '3 new.txt']]);
  assert.deepEqual(r2.failed, []);
  assert.equal(full.files().length, 10);
  const gone = editRt({ start: [] });
  const r3 = await applyTaskAttachPlan('t1', { remove: [{ drive_file_id: 'x', file_name: 'x.pdf', inTable: true }], swap: [], add: [], tableCount: 1 }, { rt: gone.rt });
  assert.deepEqual(r3.failed, []);
  assert.deepEqual([...r3.gone], ['x']);
});
