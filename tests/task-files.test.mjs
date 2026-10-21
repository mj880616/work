import test from 'node:test';
import assert from 'node:assert/strict';
import { readTaskFiles, fileLinksHtml, fileProblem, driveFileUrl, attachTaskFile, detachTaskFile, MAX_TASK_FILES } from '../app/task-files.js';

// TASK-파일붙이기: the app reads the link table with the owner's session and changes it only through the google-tasks Edge.
const fakeRt = (answer) => {
  const calls = [];
  return { calls, rt: { api: async (path, options = {}) => { calls.push({ path, options }); return typeof answer === 'function' ? answer(path, options) : answer; }, copyUploadFile: async f => f } };
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
  assert.equal(calls[0].options.singleFlight, false);
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.body.get('task_id'), 't1');
  assert.ok(calls[0].options.timeoutMs >= 90000);
  await detachTaskFile('t1', 'f1', { rt });
  assert.deepEqual(calls[1], { path: '/functions/v1/google-tasks?action=detach', options: { method: 'POST', body: { action: 'detach', task_id: 't1', drive_file_id: 'f1' }, singleFlight: false } });
});
