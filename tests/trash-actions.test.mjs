import test from 'node:test';
import assert from 'node:assert/strict';
// TRASH-화면2: 담당조직·사업 보고 [삭제]의 공용 동작(trash-actions.js). 서버는 가짜 runtime으로 흉내 낸다. 이름은 모두 가짜다.
import {deleteToTrash, readTrashKind} from '../app/trash-actions.js';

function fakeRuntime({oldFunction = false, landed = true, listFails = false} = {}) {
  const calls = [];
  const rows = [];
  return {
    calls,
    rows,
    api: async (path, options = {}) => {
      calls.push({path, method: options.method || 'GET', body: options.body});
      if (path.endsWith('app_trash_list')) {
        if (listFails) throw Object.assign(new Error('boom'), {status: 500});
        if (oldFunction) throw Object.assign(new Error('TRASH_KIND_UNKNOWN'), {status: 400, code: '22023'});
        return rows.map((id) => ({kind: options.body.p_kind, id, name: '합성', deleted_at: '2026-10-25T00:00:00Z'}));
      }
      if (options.method === 'DELETE') { if (landed) rows.push('x1'); return null; }
      return {ok: true};
    },
  };
}
const deletes = (rt) => rt.calls.filter((c) => c.method === 'DELETE');

test('DB 적용 전(옛 함수): 준비 중을 알리고 확인창도 DELETE 요청도 없다', async () => {
  const rt = fakeRuntime({oldFunction: true});
  const said = []; let asked = 0;
  const result = await deleteToTrash({kind: 'organization', id: 'x1', name: '합성', rt, ask: () => { asked++; return true; }, notify: (m) => said.push(m), remove: () => rt.api('/rest/v1/app_suborganizations?id=eq.x1', {method: 'DELETE'})});
  assert.equal(result.status, 'blocked');
  assert.equal(asked, 0);
  assert.deepEqual(deletes(rt), []);
  assert.match(said[0], /담당조직 휴지통은 준비 중입니다/);
});

test('목록을 읽지 못하면(일시 실패) 삭제하지 않고 다시 시도하라고 알린다', async () => {
  const rt = fakeRuntime({listFails: true});
  const said = [];
  const result = await deleteToTrash({kind: 'report', id: 'x1', name: '합성', rt, ask: () => true, notify: (m) => said.push(m), remove: () => rt.api('/x', {method: 'DELETE'})});
  assert.equal(result.status, 'blocked');
  assert.deepEqual(deletes(rt), []);
  assert.match(said[0], /확인하지 못해 삭제하지 않았습니다/);
});

test('확인창에서 취소하면 DELETE 요청이 없다', async () => {
  const rt = fakeRuntime();
  const asks = [];
  const result = await deleteToTrash({kind: 'report', id: 'x1', name: '합성 보고', rt, ask: (t) => { asks.push(t); return false; }, remove: () => rt.api('/x', {method: 'DELETE'})});
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(deletes(rt), []);
  assert.match(asks[0], /“합성 보고” 사업 보고를 휴지통으로 옮길까요/);
});

test('휴지통에 도착한 것을 목록으로 확인한 뒤에만 moved, 그 뒤 화면 다시 읽기', async () => {
  const rt = fakeRuntime();
  const order = [];
  const result = await deleteToTrash({kind: 'organization', id: 'x1', name: '합성', rt, ask: () => true,
    remove: async () => { order.push('delete'); return rt.api('/rest/v1/app_suborganizations?id=eq.x1', {method: 'DELETE'}); },
    closeBefore: () => order.push('close'), afterChange: async () => { order.push('reload'); }});
  assert.equal(result.status, 'moved');
  assert.deepEqual(order, ['delete', 'close', 'reload']);
  assert.equal(deletes(rt).length, 1);
  const lists = rt.calls.filter((c) => c.path.endsWith('app_trash_list'));
  assert.equal(lists.length, 2, '삭제 전 확인 1번, 삭제 뒤 확인 1번');
  assert.ok(lists.every((c) => c.body.p_kind === 'organization'));
});

test('삭제 뒤 목록에 없으면 휴지통에 들어갔다고 말하지 않는다', async () => {
  const rt = fakeRuntime({landed: false});
  const said = [];
  const result = await deleteToTrash({kind: 'report', id: 'x1', name: '합성', rt, ask: () => true, notify: (m) => said.push(m), remove: () => rt.api('/x', {method: 'DELETE'})});
  assert.equal(result.status, 'unconfirmed');
  assert.match(said[0], /휴지통에서 확인하지 못했습니다/);
  assert.doesNotMatch(said.join(), /옮겼습니다/);
});

test('삭제 요청이 실패하면 failed로 알린다', async () => {
  const rt = fakeRuntime();
  const result = await deleteToTrash({kind: 'report', id: 'x1', name: '합성', rt, ask: () => true, remove: async () => { throw new Error('권한 없음'); }});
  assert.equal(result.status, 'failed');
  assert.equal(result.error.message, '권한 없음');
});

test('readTrashKind: 배열이면 ready, 종류 거절이면 missing', async () => {
  assert.equal((await readTrashKind('report', fakeRuntime())).state, 'ready');
  assert.equal((await readTrashKind('report', fakeRuntime({oldFunction: true}))).state, 'missing');
  assert.equal((await readTrashKind('report', fakeRuntime({listFails: true}))).state, 'failed');
});
