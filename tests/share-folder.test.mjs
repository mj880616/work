// SHARE-노트로(2026-11-28 19:01 사용자 결정): 공유 노트가 들어갈 '공유한 글' 폴더 정하기(app/share-folder.js). 이름으로 찾지 않고 기억한 id로,
// 없거나 지워졌으면 한 번 만들고 그 id를 사람별 서버 화면 기억(view_prefs.share_folder)에 둔다. 서버가 기억을 거절하면 만들지 않는다(폴더 밖).
import test from 'node:test';
import assert from 'node:assert/strict';
import {shareFolder, rememberedFolder, topOrder, SHARE_FOLDER_NAME, SHARE_FOLDER_KEY} from '../app/share-folder.js';

const ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', NEW = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
function fake({folders = [], saved, ready = true, reject = false} = {}) {
  const calls = {created: [], set: [], flush: 0};
  let value = saved;
  const prefs = {
    get: key => (key === SHARE_FOLDER_KEY ? value : undefined),
    set: (key, v, options) => { calls.set.push({key, v, options}); value = v; return true; },
    flush: async () => { calls.flush++; if (reject) value = saved; },
  };
  const deps = {
    readFolders: async () => ({ready, folders}),
    createFolder: async row => { calls.created.push(row); return {...row}; },
    prefs, newId: () => NEW,
  };
  return {deps, calls};
}

test('기억한 폴더가 있으면 그 폴더(지금 이름) — 이름을 바꾸거나 옮겨도 그대로, 새로 만들지 않는다', async () => {
  const {deps, calls} = fake({saved:ID, folders:[{id:'x', name:SHARE_FOLDER_NAME, parent_id:null, sort_order:0}, {id:ID, name:'받은 것', parent_id:'x', sort_order:3}]});
  assert.deepEqual(await shareFolder({deps}), {id:ID, name:'받은 것'});
  assert.deepEqual(calls.created, []);
  assert.deepEqual(calls.set, []);
});

test('처음이면 새 id를 먼저 기억에 저장(거절 알림 칸)하고, 받은 뒤 같은 id로 맨 위 끝에 \'공유한 글\'을 만든다 — 같은 이름 폴더가 있어도 이름으로 찾지 않는다', async () => {
  const {deps, calls} = fake({folders:[{id:'a', name:SHARE_FOLDER_NAME, parent_id:null, sort_order:4}, {id:'b', name:'하위', parent_id:'a', sort_order:9}]});
  assert.deepEqual(await shareFolder({deps}), {id:NEW, name:SHARE_FOLDER_NAME});
  assert.deepEqual(calls.set, [{key:SHARE_FOLDER_KEY, v:NEW, options:{rejectable:true}}]);
  assert.equal(calls.flush, 1);
  assert.deepEqual(calls.created, [{id:NEW, name:SHARE_FOLDER_NAME, parent_id:null, sort_order:5}]);
});

test('기억한 폴더가 지워졌으면 다시 만든다', async () => {
  const {deps, calls} = fake({saved:ID, folders:[]});
  assert.deepEqual(await shareFolder({deps}), {id:NEW, name:SHARE_FOLDER_NAME});
  assert.equal(calls.created.length, 1);
});

test('서버가 기억을 거절하면(DB 적용 전) 폴더를 만들지 않고 폴더 밖(null)', async () => {
  const {deps, calls} = fake({reject:true});
  assert.equal(await shareFolder({deps}), null);
  assert.deepEqual(calls.created, []);
});

test('폴더 표를 못 읽으면 폴더 밖(null), 기억도 쓰지 않는다', async () => {
  const {deps, calls} = fake({ready:false, saved:ID});
  assert.equal(await shareFolder({deps}), null);
  assert.deepEqual(calls.set, []);
  assert.deepEqual(calls.created, []);
});

test('모양이 다른 기억 값은 무시하고, 맨 위 순서는 형제 중 큰 값 + 1', () => {
  assert.equal(rememberedFolder([{id:'ABC'}], 'ABC'), null);
  assert.equal(rememberedFolder(null, ID), null);
  assert.equal(topOrder([]), 0);
  assert.equal(topOrder([{sort_order:2}, {sort_order:7, parent_id:'p'}]), 3);
});
