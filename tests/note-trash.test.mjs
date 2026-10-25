import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// TRASH-다른삭제 4단계: 노트·업데이트 [지우기]의 휴지통 흐름(deleteNoteOriginal {trash:true}). 서버는 가짜 runtime으로 흉내 낸다. 내용은 모두 가짜다.
const events = [];
globalThis.window = {dispatchEvent: (event) => events.push(event.type)};
globalThis.document = undefined;
const mod = await import('../app/basket-record-delete.js');
const ctx = {user: {id: 'owner'}, workspace: {id: 'ws1'}};
const withConfirm = async (answer, fn) => {
  const calls = [];
  globalThis.confirm = (text) => { calls.push(text); return answer; };
  try { return {result: await fn(), calls}; } finally { delete globalThis.confirm; }
};
// mode.old = DB 적용 전(옛 함수는 TRASH_KIND_UNKNOWN), mode.land = DELETE가 휴지통에 넣음(기본 true), mode.listFails = 목록 일시 실패
function fake(mode = {}) {
  const trash = [];
  const calls = [];
  const note = {id: 'n1', updated_at: '2026-10-26T00:00:00Z', attachments: mode.attachments ?? [{}, {}]};
  let present = true;
  const rt = {
    config: {url: 'https://sb.invalid', key: 'anon'}, context: {read: () => ctx},
    session: {epoch: () => 3, ensure: async () => true, read: () => ({access_token: 'jwt', user: ctx.user})},
    api: async (path, options = {}) => {
      const method = options.method || 'GET';
      calls.push({path, method, body: options.body});
      if (path.endsWith('app_trash_list')) {
        if (mode.old) throw Object.assign(new Error('TRASH_KIND_UNKNOWN'), {status: 400, code: '22023'});
        if (mode.listFails) throw Object.assign(new Error('boom'), {status: 500});
        return trash.map((id) => ({kind: 'note', id, note_kind: 'basket', preview: '합성', deleted_at: '2026-10-26T01:00:00Z'}));
      }
      if (path.endsWith('app_trash_restore')) {
        if (mode.restoreFails) throw Object.assign(new Error('TRASH_NOT_FOUND'), {status: 404});
        trash.splice(0); present = true; return {ok: true};
      }
      if (path.startsWith('/rest/v1/app_record_links')) return [{id: 'l1', organization_id: 'o'}, {id: 'l2', meeting_id: 'm'}];
      if (path.startsWith('/rest/v1/app_notes') && method === 'DELETE') {
        if (mode.land !== false) { trash.push('n1'); present = false; }
        if (mode.deleteThrows) throw Object.assign(new Error('응답 유실'), {status: 0});
        return mode.deleteRows ?? [];
      }
      if (path.startsWith('/rest/v1/app_notes')) return present ? [note] : [];
      throw new Error('unexpected ' + path);
    },
  };
  return {rt, calls, trash};
}
const deletes = (f) => f.calls.filter((c) => c.method === 'DELETE');
const flow = (f, answer = true, extra = {}) => withConfirm(answer, () => mod.deleteNoteOriginal('n1', {rt: f.rt, trash: true, label: '업데이트', ...extra}));

test('DB 적용 전(옛 함수): 준비 중을 알리고 확인창도 DELETE도 없다', async () => {
  const f = fake({old: true});
  const {result, calls} = await flow(f);
  assert.equal(result.status, 'blocked');
  assert.match(result.message, /노트·업데이트 휴지통은 준비 중입니다/);
  assert.deepEqual(calls, []);
  assert.deepEqual(deletes(f), []);
});

test('목록을 읽지 못하면(일시 실패) 삭제하지 않고 다시 시도하라고 알린다', async () => {
  const f = fake({listFails: true});
  const {result, calls} = await flow(f);
  assert.equal(result.status, 'blocked');
  assert.match(result.message, /확인하지 못해 삭제하지 않았습니다/);
  assert.deepEqual(calls, []);
  assert.deepEqual(deletes(f), []);
});

test('확인창은 연결·첨부를 알리고, 취소하면 DELETE가 없다', async () => {
  const f = fake();
  const {result, calls} = await flow(f, false);
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(calls, ['업데이트를 휴지통으로 옮깁니다. 연결된 조직·프로젝트 1곳과 사업 보고·자료실 연결 1곳은 지워지지 않고, 휴지통에 있는 동안 보이지 않습니다. 첨부 파일 2개는 Drive에 그대로 남습니다. 휴지통에서 되돌릴 수 있습니다.']);
  assert.deepEqual(deletes(f), []);
});

test('휴지통에 도착한 것을 목록으로 확인한 뒤에만 옮겼다고 말한다. 서버 첨부 삭제(note-delete) 요청은 없다', async () => {
  events.length = 0;
  const f = fake();
  const {result} = await flow(f);
  assert.equal(result.status, 'deleted');
  assert.equal(result.message, '업데이트를 휴지통으로 옮겼습니다.');
  assert.equal(deletes(f).length, 1);
  const url = new URL(deletes(f)[0].path, 'https://x.invalid');
  assert.equal(url.pathname, '/rest/v1/app_notes');
  assert.equal(url.searchParams.get('id'), 'eq.n1');
  assert.equal(url.searchParams.get('workspace_id'), 'eq.ws1');
  assert.ok(f.calls.every((c) => !/functions\/v1/.test(c.path)), 'basket-files note-delete를 부르지 않는다');
  assert.ok(f.calls.filter((c) => c.path.endsWith('app_trash_list')).every((c) => c.body.p_kind === 'note'));
  assert.deepEqual(events, ['kptu:basket-links-changed']);
});

test('응답이 유실돼도(DELETE 오류) 목록에 있으면 옮겼다고 본다', async () => {
  const f = fake({deleteThrows: true});
  const {result} = await flow(f);
  assert.equal(result.status, 'deleted');
});

test('삭제 뒤 목록에 없고 글이 그대로면 실패, 글도 안 보이면 확인 못 함', async () => {
  const kept = fake({land: false});
  assert.equal((await flow(kept)).result.status, 'failed');
  const gone = fake({land: false});
  const original = gone.rt.api;
  let deleted = false;
  gone.rt.api = async (path, options = {}) => {
    if ((options.method || 'GET') === 'DELETE') { deleted = true; return []; }
    if (deleted && path.startsWith('/rest/v1/app_notes')) return [];
    return original(path, options);
  };
  const {result} = await flow(gone);
  assert.equal(result.status, 'unknown');
  assert.match(result.message, /휴지통에서 확인하지 못했습니다/);
});

test('노트(kind=note)도 같은 흐름이고 글에 노트라고 쓴다', async () => {
  const f = fake({attachments: []});
  const {result, calls} = await flow(f, true, {label: '노트', keepFiles: true});
  assert.equal(result.status, 'deleted');
  assert.equal(result.message, '노트를 휴지통으로 옮겼습니다.');
  assert.match(calls[0], /^노트를 휴지통으로 옮깁니다\./);
  assert.doesNotMatch(calls[0], /첨부/);
});

test('일기 등 trash를 켜지 않은 호출은 지금 흐름 그대로(휴지통 목록을 읽지 않는다)', async () => {
  const f = fake({attachments: [], deleteRows: [{id: 'n1'}]});
  const {result, calls} = await withConfirm(true, () => mod.deleteNoteOriginal('n1', {rt: f.rt, describe: () => '일기를 지웁니다.', keepFiles: true}));
  assert.equal(result.status, 'deleted');
  assert.deepEqual(calls, ['일기를 지웁니다.']);
  assert.ok(f.calls.every((c) => !c.path.endsWith('app_trash_list')));
});

test('화면 코드: 네 지우기 경로가 trash 흐름을 쓰고 일기는 쓰지 않으며, 브라우저 저장소를 쓰지 않는다', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.equal((read('../app/basket.js').match(/deleteNoteOriginal\([^)]*trash:\s*true/g) || []).length, 2);
  assert.match(read('../app/basket-notes.js'), /deleteNoteOriginal\([^)]*trash:\s*true[^)]*label:\s*'노트'/);
  assert.match(read('../app/basket-link-records.js'), /deleteNoteOriginal\([^)]*trash:true/);
  assert.doesNotMatch(read('../app/diary.js'), /trash:\s*true/);
  const store = new RegExp(['local', 'session'].map((w) => w + 'Storage').concat(['indexed' + 'DB']).join('|'));
  assert.doesNotMatch(read('../app/basket-record-delete.js'), store);
});
