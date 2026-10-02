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

test('project deletion keeps other unlink requests and makes no app_events request', async () => {
  const calls = [];
  const context = vm.createContext({
    current: {id: 'parent-1'}, detail: {},
    kids: () => [{id: 'child-1'}],
    $: () => ({textContent: '', className: ''}),
    api: async (path, options) => { calls.push({path, method: options.method}); return []; },
    closeModal: () => {}, clearUrl: () => {}, renderGrid: async () => {}, toast: () => {},
  });
  const src = read('project-system-v3.js');
  vm.runInContext(`${functionSource(src, 'unlink')}; ${functionSource(src, 'deleteProject')}; this.deleteProject=deleteProject`, context);
  await context.deleteProject();
  assert.equal(calls.filter(({path}) => path.includes('app_events')).length, 0);
  for (const id of ['child-1', 'parent-1']) {
    for (const [table, field] of [['app_meetings','project_id'], ['app_documents','project_id'], ['app_pages','space_id']]) {
      assert.ok(calls.some(({path, method}) => path === `/rest/v1/${table}?${field}=eq.${id}` && method === 'PATCH'));
    }
  }
  assert.ok(calls.some(({path, method}) => path === '/rest/v1/app_spaces?id=eq.parent-1' && method === 'DELETE'));
});
