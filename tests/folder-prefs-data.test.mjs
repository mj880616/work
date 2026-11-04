import test from 'node:test';
import assert from 'node:assert/strict';
import {readFolderPrefs, applyFolderPrefs, applyAlbumLook} from '../app/folder-prefs-data.js';

test('read: rows come back; a server without the table reads as empty; other errors surface', async () => {
  let url = '';
  assert.deepEqual(await readFolderPrefs(async u => { url = u; return [{source: 'od', folder_key: 'a', color: 2, sort_order: null}]; }, 'ws1'), [{source: 'od', folder_key: 'a', color: 2, sort_order: null}]);
  assert.match(url, /app_folder_prefs\?workspace_id=eq\.ws1&select=source,folder_key,color,sort_order/);
  assert.deepEqual(await readFolderPrefs(async () => { const e = new Error('x'); e.status = 404; throw e; }, 'ws1'), []);
  assert.deepEqual(await readFolderPrefs(async () => { const e = new Error('relation app_folder_prefs does not exist'); e.code = '42P01'; throw e; }, 'ws1'), []);
  await assert.rejects(readFolderPrefs(async () => { const e = new Error('boom'); e.status = 500; throw e; }, 'ws1'));
});
test('apply: sends the server function with the workspace, checks values, splits over 200 rows', async () => {
  const calls = [];
  const api = async (u, o) => { calls.push([u, o.body]); return {ok: true, count: o.body.p_items.length}; };
  assert.equal(await applyFolderPrefs(api, 'ws1', 'od', [{k: 'a', c: 3}, {k: 'b', o: 1024}, {k: 'c', c: null}]), true);
  assert.equal(calls[0][0], '/rest/v1/rpc/app_folder_prefs_apply');
  assert.deepEqual(calls[0][1], {p_workspace_id: 'ws1', p_source: 'od', p_items: [{k: 'a', c: 3}, {k: 'b', o: 1024}, {k: 'c', c: null}]});
  calls.length = 0;
  await applyFolderPrefs(api, 'ws1', 'gd', Array.from({length: 450}, (_, i) => ({k: 'k' + i, o: i})));
  assert.deepEqual(calls.map(c => c[1].p_items.length), [200, 200, 50]);
  for (const bad of [[], [{k: ''}], [{c: 1}], [{k: 'a', c: 9}], [{k: 'a', c: '3'}], [{k: 'a', o: 1.5}]]) await assert.rejects(applyFolderPrefs(api, 'ws1', 'od', bad), /확인하지 못했어요/);
  await assert.rejects(applyFolderPrefs(async () => ({ok: false}), 'ws1', 'od', [{k: 'a', c: 1}]), /저장하지 못했어요/);
});
test('album look: id + color/order only', async () => {
  let body;
  assert.equal(await applyAlbumLook(async (u, o) => { body = [u, o.body]; return {ok: true}; }, 'ws1', [{id: 't1', c: 4, o: 2048}]), true);
  assert.equal(body[0], '/rest/v1/rpc/app_photo_tag_look_apply');
  assert.deepEqual(body[1], {p_workspace_id: 'ws1', p_items: [{id: 't1', c: 4, o: 2048}]});
  await assert.rejects(applyAlbumLook(async () => ({ok: true}), 'ws1', [{id: 't1', c: 0}]), /확인하지 못했어요/);
  await assert.rejects(applyAlbumLook(async () => ({ok: true}), 'ws1', []), /확인하지 못했어요/);
});
