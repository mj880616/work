// FOLDER-순서·색 ③-1(S49-47): app/library-folder-data.js — 폴더 읽기(color 칸이 없는 옛 서버면 칸 없이 다시 읽음)와 색 쓰기(서버 함수, 1~8·null만). 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readLibraryFolders,setLibraryFolderColor} from '../app/library-folder-data.js';

test('읽기: color 칸 포함으로 먼저 읽고, 칸이 없어 400이면 칸 없이 다시 읽는다. 그 밖의 오류는 그대로 던진다', async () => {
  const urls = [];
  const rows = [{id: 'a'}];
  const ok = await readLibraryFolders(async url => { urls.push(url); return [{id: 'a', color: 3}]; }, 'ws 1');
  assert.deepEqual(ok, [{id: 'a', color: 3}]);
  assert.match(urls[0], /workspace_id=eq\.ws%201&select=id,project_id,parent_id,name,sort_order,created_at,color&order=sort_order\.asc,created_at\.asc/);
  urls.length = 0;
  const old = await readLibraryFolders(async url => { urls.push(url); if (/,color/.test(url)) throw Object.assign(new Error('column does not exist'), {status: 400, code: '42703'}); return rows; }, 'w');
  assert.deepEqual(old, rows);
  assert.equal(urls.length, 2);
  assert.doesNotMatch(urls[1], /color/);
  await assert.rejects(readLibraryFolders(async () => { throw Object.assign(new Error('network down'), {status: 503}); }, 'w'), /network down/);
});

test('색 쓰기: 서버 함수 한 번(owner 판정은 서버), 1~8 또는 null만, 응답이 ok가 아니면 실패', async () => {
  const calls = [];
  const api = async (path, opt) => { calls.push({path, body: opt.body, method: opt.method, singleFlight: opt.singleFlight}); return {ok: true}; };
  assert.equal(await setLibraryFolderColor(api, 'f1', 4), 4);
  assert.equal(await setLibraryFolderColor(api, 'f1', null), null);
  assert.deepEqual(calls[0], {path: '/rest/v1/rpc/app_library_folder_set_color', body: {p_id: 'f1', p_color: 4}, method: 'POST', singleFlight: false});
  for (const bad of [0, 9, 1.5, '3', undefined, NaN]) await assert.rejects(setLibraryFolderColor(api, 'f1', bad), /폴더 색을 확인하지 못했어요/);
  assert.equal(calls.length, 2, '틀린 값은 서버로 보내지 않는다');
  await assert.rejects(setLibraryFolderColor(async () => ({ok: false}), 'f1', 2), /저장하지 못했어요/);
  await assert.rejects(setLibraryFolderColor(async () => null, 'f1', 2), /저장하지 못했어요/);
});
