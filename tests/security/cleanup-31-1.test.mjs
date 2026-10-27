import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../../app/${name}`, import.meta.url), 'utf8');
function functionSource(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  let depth = 0, body = false;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') { depth++; body = true; }
    if (source[i] === '}' && --depth === 0 && body) return source.slice(start, i + 1);
  }
  throw new Error(`${name} body was not found`);
}

test('startup requests only the signed-in user profile', async () => {
  const calls = [];
  const context = vm.createContext({
    workspace: {id: 'workspace-1'}, user: {id: 'owner-1'},
    api: async path => { calls.push(path); return []; },
  });
  vm.runInContext(`${functionSource(read('team.js'), 'loadAll')}; this.loadAll=loadAll`, context);
  await context.loadAll();
  const profiles = calls.filter(path => path.startsWith('/rest/v1/app_profiles?'));
  assert.equal(profiles.length, 1);
  assert.match(profiles[0], /[?&]user_id=eq\.owner-1(?:&|$)/);
});

// TRASH-삭제휴지통 2단계: 화면은 연결 끊기 요청을 보내지 않는다(서버 트리거가 같은 일을 하거나, 휴지통은 연결을 그대로 둔다).
// 화면의 삭제는 app_spaces 한 줄 DELETE뿐이고, app_events는 건드리지 않는다.
for (const ready of [false, true]) {
  test(`project deletion sends only the project DELETE and makes no unlink or app_events request (trash ${ready ? 'ready' : 'not ready'})`, async () => {
    const calls = [], toasts = [], undo = [];
    const trash = {state: ready ? 'ready' : 'missing', rows: []};
    const context = vm.createContext({
      current: {id: 'parent-1'}, detail: {}, trash,
      TRASH_STATE: {READY: 'ready', MISSING: 'missing'}, TRASH_TEXT: {MOVED: '옮김', DELETED: '삭제함'},
      deleteDialogText: () => ({busy: '…'}),
      $: () => ({textContent: '', className: ''}),
      api: async (path, options) => { calls.push({path, method: options.method}); return []; },
      refreshTrash: async () => { if (ready) trash.rows = [{id: 'parent-1'}]; },
      offerUndoNotice: opts => undo.push(opts.text), trashRestore: async () => ({ok: true}), reloadAfterTrash: async () => {},
      closeModal: () => {}, closeDetail: () => {}, splitWanted: () => false, clearUrl: () => {}, renderGrid: async () => {}, toast: text => toasts.push(text),
    });
    const src = read('project-system-v3.js');
    vm.runInContext(`${functionSource(src, 'deleteProject')}; this.deleteProject=deleteProject`, context);
    await context.deleteProject();
    assert.equal(calls.filter(({path}) => path.includes('app_events')).length, 0);
    assert.deepEqual(calls.map(({path, method}) => `${method} ${path}`), ['DELETE /rest/v1/app_spaces?id=eq.parent-1']);
    // 휴지통 문구는 서버가 정말 휴지통에 넣은 것이 목록에서 확인될 때만 쓴다.
    assert.deepEqual(ready ? undo : toasts, [ready ? '옮김' : '삭제함']);
  });
}
