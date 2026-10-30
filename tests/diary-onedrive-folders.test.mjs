import { test } from 'node:test';
import assert from 'node:assert/strict';
// JOURNAL-일기원드라이브 폴더 스위치 화면의 데이터 층: 트리 읽기·행 만들기·바뀐 것 고르기·다시 부를 때까지 기다리는 시간. 지어낸 runtime만 쓴다.
const mod = import('../app/diary-onedrive.js');
const runtime = reply => { const calls = []; return {calls, config:{url:'https://x.invalid', key:'k'}, context:{read:() => ({workspace:{id:'w'}})}, session:{ensure:async () => true, read:() => ({access_token:'t'})}, api:async (path, options = {}) => { calls.push({path, ...options}); return reply(options.body); }}; };
const tree = {top:{id:'T', name:'맨위', count:2, total:9}, folders:[
  {id:'A', name:'가', parent_id:'T', enabled:true, count:1, total:4}, {id:'A1', name:'가1', parent_id:'A', enabled:true, count:3, total:3},
  {id:'B', name:'나', parent_id:'T', enabled:false, count:5, total:5}, {id:'bad'}, {id:'C', name:'다', parent_id:'T', count:-3, total:'x'}]};

test('folders-tree keeps only well-formed folders and whole counts', async () => {
  const m = await mod, rt = runtime(() => tree);
  const t = await m.odFolderTree(rt);
  assert.deepEqual(rt.calls[0].body, {action:'folders-tree'});
  assert.deepEqual(t.folders.map(f => f.id), ['A', 'A1', 'B', 'C']);
  assert.deepEqual(t.folders.find(f => f.id === 'C'), {id:'C', name:'다', parent_id:'T', enabled:true, count:0, total:0});
  await assert.rejects(m.odFolderTree(runtime(() => ({}))), /onedrive_unavailable/);
});
test('rows: only expanded folders show their children, indented; a switched-off parent dims everything below', async () => {
  const m = await mod, t = await m.odFolderTree(runtime(() => tree));
  assert.deepEqual(m.odTreeRows(t, new Map(), new Set()).map(r => r.id), ['A', 'B', 'C']);
  const rows = m.odTreeRows(t, new Map([['A', false]]), new Set(['A']));
  assert.deepEqual(rows.map(r => [r.id, r.depth, r.on, r.dim]), [['A', 0, false, false], ['A1', 1, true, true], ['B', 0, false, false], ['C', 0, true, false]]);
  assert.equal(rows[0].hasKids, true); assert.equal(rows[0].open, true);
});
test('save sends only the folders whose switch differs from the server', async () => {
  const m = await mod, t = await m.odFolderTree(runtime(() => tree));
  assert.deepEqual(m.odTreeChanges(t, new Map([['A', true], ['B', true], ['C', false]])), [{id:'B', enabled:true}, {id:'C', enabled:false}]);
  assert.deepEqual(m.odTreeChanges(t, new Map()), []);
  const rt = runtime(() => ({})); await m.odFolderToggle(rt, 'B', true); await m.odFolderToggle(rt, 'C', 'yes');
  assert.deepEqual(rt.calls.map(c => c.body), [{action:'folder-toggle', folder_id:'B', enabled:true}, {action:'folder-toggle', folder_id:'C', enabled:false}]);
});
test('sync: reads more/indexing; waits retry_after seconds on 429 (1..120), 5 seconds on busy, stops otherwise', async () => {
  const m = await mod;
  assert.deepEqual(await m.odSync(runtime(() => ({more:true, indexing:true, junk:1}))), {more:true, indexing:true, changed:0});
  assert.deepEqual(await m.odSync(runtime(() => ({more:false, indexing:false, changed:3}))), {more:false, indexing:false, changed:3});
  assert.deepEqual(await m.odSync(runtime(() => ({changed:-1}))), {more:false, indexing:false, changed:0});
  assert.deepEqual(await m.odSync(runtime(() => ({}))), {more:false, indexing:false, changed:0});
  assert.equal(m.odSyncDelay(Object.assign(new Error('onedrive_throttled'), {status:429, retryAfter:7})), 7000);
  assert.equal(m.odSyncDelay(Object.assign(new Error('onedrive_throttled'), {status:429, retryAfter:9999})), 120000);
  assert.equal(m.odSyncDelay(Object.assign(new Error('onedrive_throttled'), {status:429})), 10000);
  assert.equal(m.odSyncDelay(Object.assign(new Error('onedrive_index_busy'), {status:409})), 5000);
  assert.equal(m.odSyncDelay(Object.assign(new Error('onedrive_auth_expired'), {status:424})), null);
});
test('new error codes have their own text; unknown ones keep the general text', async () => {
  const m = await mod;
  assert.match(m.odErrorText(new Error('onedrive_index_busy')), /이미 받고/);
  assert.match(m.odErrorText(new Error('onedrive_throttled')), /요청이 많다/);
  assert.match(m.odErrorText(new Error('weird')), /요청이 실패했어요/);
});
