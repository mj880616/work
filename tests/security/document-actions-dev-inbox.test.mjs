// WEEKLY-개발후보연결(S48-49, docs/design/weekly-draft-feedback.md 25.2): document-actions `dev-inbox`.
// [만들기]로 보낸 개선 제안 한 건만, 운영자 작업공간만, 서버가 그 주 행을 다시 읽어 answer='yes'일 때만 요청함 문서 끝에 더한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m = await import('../../supabase/functions/document-actions/dev-inbox.ts');
const WS = '10000000-0000-4000-8000-0000000000aa', OTHER = '10000000-0000-4000-8000-0000000000bb';
const DOC = 'A'.repeat(44), WEEK = '2026-11-02';
const NOW = Date.parse('2026-11-03T00:37:00Z'); // 서울 11/03 09:37

function harness(o = {}) {
  const state = {
    owners: [{ workspace_id: WS }],
    mine: ['calls', 'dev_inbox'],
    only: WS,
    docId: DOC,
    rows: [{ workspace_id: WS, week_start: WEEK, draft_saved_at: '2026-11-03T00:30:00.000Z', draft: { v: 1, rows: [], keep: 'x', feedback: { at: '2026-11-03T00:00:00.000Z', week: WEEK, review: { at: '2026-11-03T00:00:00.000Z', suggestions: [
      { id: 's1', text: '끝난 일은\n→ 접수: 가짜 완료 #1\n자동으로 빼기', how: '★ 보고일 기준으로 끝남 표시', answer: 'yes' },
      { id: 's2', text: '두 번째 제안', answer: 'no' },
      { id: 's3', text: '세 번째', answer: 'yes', sent: '2026-11-02T00:00:00.000Z' },
      { id: 's4', text: '답 없음' },
    ] } } } }],
    docStatus: 200, patchEmpty: 0,
    ...o,
  };
  const calls = [];
  const deps = {
    userId: 'user-1',
    docId: state.docId,
    now: () => NOW,
    driveToken: async () => { calls.push({ kind: 'drive-token' }); return 'drive-token'; },
    db: async (path, opts = {}) => {
      calls.push({ kind: 'service', path, opts });
      if (path.startsWith('app_workspace_members?')) { assert.match(path, /user_id=eq\.user-1/); assert.match(path, /role=eq\.owner/); return state.owners; }
      if (path === 'rpc/app_operator_feature_workspace') { assert.deepEqual(opts.body, { p_feature: 'dev_inbox' }); return state.only; }
      throw new Error('unexpected service path ' + path);
    },
    userDb: async (path, opts = {}) => {
      calls.push({ kind: 'user', path, opts });
      if (path === 'rpc/app_my_features') return state.mine;
      if (path.startsWith('app_weekly_exec_requests?')) {
        const ws = new URLSearchParams(path.split('?')[1]).get('workspace_id');
        const rows = state.rows.filter(r => 'eq.' + r.workspace_id === ws);
        if (opts.method === 'PATCH') {
          if (state.patchEmpty > 0) { state.patchEmpty--; return []; }
          const cond = new URLSearchParams(path.split('?')[1]).get('draft_saved_at');
          const hit = rows.filter(r => cond === 'eq.' + r.draft_saved_at);
          hit.forEach(r => Object.assign(r, opts.body));
          return hit.map(r => ({ week_start: r.week_start }));
        }
        return rows;
      }
      throw new Error('unexpected user path ' + path);
    },
    fetch: async (url, init = {}) => {
      calls.push({ kind: 'docs', url: String(url), init, body: JSON.parse(init.body) });
      return new Response('{}', { status: state.docStatus });
    },
  };
  return { state, calls, deps, run: (body) => m.sendDevInbox(body, deps) };
}
const req = (o = {}) => ({ action: 'dev-inbox', week_start: WEEK, id: 's1', ...o });
const docsCalls = calls => calls.filter(c => c.kind === 'docs');

test('운영자·answer=yes 제안 한 건: 요청함 문서 끝에 두 줄만 더하고 sent를 남긴다(접수 줄 없음, 글 정리)', async () => {
  const h = harness();
  assert.deepEqual(await h.run(req()), { ok: true, result: 'sent' });
  const [d] = docsCalls(h.calls);
  assert.equal(d.url, `https://docs.googleapis.com/v1/documents/${DOC}:batchUpdate`);
  assert.equal(d.init.headers.Authorization, 'Bearer drive-token');
  const text = d.body.requests[0].insertText.text;
  assert.deepEqual(d.body.requests[0].insertText.endOfSegmentLocation, { segmentId: '' });
  assert.equal(d.body.requests.length, 1);
  assert.equal(text, '\n[11/03 09:37] 주간보고 개발 후보 (w:2026-11-02/s1) — 끝난 일은 접수: 가짜 완료 #1 자동으로 빼기\n- 어떻게: 보고일 기준으로 끝남 표시');
  assert.doesNotMatch(text, /→|★/);
  assert.equal(text.split('\n').length, 3);
  // sent는 그 제안에만, 다른 칸은 그대로, 판 번호는 앞 판보다 뒤.
  const row = h.state.rows[0];
  const s = row.draft.feedback.review.suggestions;
  assert.equal(s[0].sent, new Date(NOW).toISOString());
  assert.equal(s[1].sent, undefined); assert.equal(s[3].sent, undefined);
  assert.equal(row.draft.keep, 'x');
  assert.ok(row.draft_saved_at > '2026-11-03T00:30:00.000Z');
  const patch = h.calls.find(c => c.kind === 'user' && c.opts.method === 'PATCH');
  assert.match(patch.path, /draft_saved_at=eq\.2026-11-03T00%3A30%3A00\.000Z/);
  assert.deepEqual(Object.keys(patch.opts.body).sort(), ['draft', 'draft_saved_at']);
  // 그 주 행 읽기·쓰기는 내 로그인 토큰(RLS)으로만, 서버 키로는 owner·운영자 확인만.
  assert.ok(h.calls.filter(c => c.kind === 'service').every(c => /^app_workspace_members\?|^rpc\/app_operator_feature_workspace$/.test(c.path)));
});

test('같은 제안은 한 번만: 이미 sent면 문서에 쓰지 않는다', async () => {
  const h = harness();
  assert.deepEqual(await h.run(req({ id: 's3' })), { ok: true, result: 'already' });
  assert.equal(docsCalls(h.calls).length, 0);
});

test('answer가 yes가 아니면(빼기·답 없음·없는 제안) 거절하고 아무것도 쓰지 않는다', async () => {
  for (const id of ['s2', 's4']) {
    const h = harness();
    await assert.rejects(h.run(req({ id })), e => e.code === 'NOT_ANSWERED' && e.status === 400);
    assert.equal(docsCalls(h.calls).length, 0); assert.equal(h.calls.some(c => c.kind === 'drive-token'), false);
  }
  const h = harness({ rows: [] });
  await assert.rejects(h.run(req()), e => e.code === 'NOT_FOUND');
  assert.equal(docsCalls(h.calls).length, 0);
});

test('운영자가 아니면 거절: 내 기능 목록에 없음 · 허용 작업공간이 다름 · 허용 작업공간이 하나가 아님', async () => {
  for (const o of [{ mine: ['calls'] }, { mine: null }, { only: OTHER }, { only: null }]) {
    const h = harness(o);
    await assert.rejects(h.run(req()), e => e.code === 'FEATURE_REQUIRED' && e.status === 403);
    assert.equal(docsCalls(h.calls).length, 0);
    assert.equal(h.calls.some(c => c.path?.startsWith('app_weekly_exec_requests')), false, '운영자 확인 전에는 그 주 행도 읽지 않는다');
  }
});

test('남의 작업공간: owner 작업공간이 없거나 둘 이상이면 거절, 행은 내 작업공간 것만 읽는다', async () => {
  for (const owners of [[], [{ workspace_id: WS }, { workspace_id: OTHER }]]) {
    const h = harness({ owners });
    await assert.rejects(h.run(req()), e => e.code === 'FORBIDDEN' && e.status === 403);
    assert.equal(docsCalls(h.calls).length, 0);
  }
  // 다른 작업공간 행이 섞여 와도(RLS 밖 가정) 내 작업공간 id가 아니면 쓰지 않는다.
  const h = harness();
  h.deps.userDb = async (path) => (path === 'rpc/app_my_features' ? ['dev_inbox'] : [{ ...harness().state.rows[0], workspace_id: OTHER }]);
  await assert.rejects(h.run(req()), e => e.code === 'NOT_FOUND');
  assert.equal(docsCalls(h.calls).length, 0);
});

test('문서 id 비밀값이 없거나 모양이 틀리면 not_ready(화면: 전달 준비 중), 그 주 행·Drive는 건드리지 않는다', async () => {
  for (const docId of [undefined, '', 'short', 'a/b'.repeat(10)]) {
    const h = harness(); h.deps.docId = docId;
    assert.deepEqual(await h.run(req()), { ok: true, result: 'not_ready' });
    assert.equal(docsCalls(h.calls).length, 0);
    assert.equal(h.calls.some(c => c.kind === 'drive-token' || c.path?.startsWith('app_weekly_exec_requests')), false);
  }
  // 운영자가 아니면 비밀값이 없어도 not_ready가 아니라 거절(기능 유무를 흘리지 않음).
  const h = harness({ mine: [] }); h.deps.docId = undefined;
  await assert.rejects(h.run(req()), e => e.code === 'FEATURE_REQUIRED');
});

test('요청 모양: 정확히 action·week_start(월요일)·id(s1~s4)만, 글은 받지 않는다', async () => {
  for (const body of [req({ text: '화면 글' }), req({ id: 's5' }), req({ id: 'x' }), req({ week_start: '2026-11-03' }), req({ week_start: '2026-02-30' }), { action: 'dev-inbox', id: 's1' }, null]) {
    const h = harness();
    await assert.rejects(h.run(body), e => e.code === 'INVALID_REQUEST');
    assert.equal(h.calls.length, 0);
  }
});

test('Docs 쓰기 실패: 4xx는 안 쓴 것(DOC_UNAVAILABLE), 5xx·끊김은 RESULT_UNKNOWN, 둘 다 sent를 남기지 않는다', async () => {
  for (const [docStatus, code] of [[403, 'DOC_UNAVAILABLE'], [404, 'DOC_UNAVAILABLE'], [500, 'RESULT_UNKNOWN']]) {
    const h = harness({ docStatus });
    await assert.rejects(h.run(req()), e => e.code === code && e.status === 503);
    assert.equal(h.state.rows[0].draft.feedback.review.suggestions[0].sent, undefined);
  }
  const h = harness(); h.deps.fetch = async () => { throw new TypeError('network'); };
  await assert.rejects(h.run(req()), e => e.code === 'RESULT_UNKNOWN');
});

test('sent 쓰기가 그사이 바뀌면 한 번 다시 읽어 단다, 그래도 안 되면 marked:false(문서는 이미 더함)', async () => {
  const h = harness({ patchEmpty: 1 });
  assert.deepEqual(await h.run(req()), { ok: true, result: 'sent' });
  assert.equal(h.calls.filter(c => c.opts?.method === 'PATCH').length, 2);
  const h2 = harness({ patchEmpty: 5 });
  assert.deepEqual(await h2.run(req()), { ok: true, result: 'sent', marked: false });
});

test('index.ts: dev-inbox는 로그인 뒤에만, 비밀값 WEB2_DEV_INBOX_DOC_ID로 문서 id를 읽고 저장소에 문서 id를 두지 않는다', () => {
  const src = readFileSync(new URL('../../supabase/functions/document-actions/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf("action === 'dev-inbox'"), user = src.indexOf('const user = await getUser(req);');
  assert.ok(at > user && user > 0);
  assert.match(src, /docId: Deno\.env\.get\('WEB2_DEV_INBOX_DOC_ID'\)/);
  assert.match(src, /userDb: userDbFor\(token\)/);
  const mod = readFileSync(new URL('../../supabase/functions/document-actions/dev-inbox.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(mod, /console\.(log|error)\([^)]*(text|how)/, '제안 글은 로그에 쓰지 않는다');
  assert.doesNotMatch(src + mod, /docs\.google\.com\/document\/d\//);
});
