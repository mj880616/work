// WEEKLY-개발후보CC 2단계(S48-57, docs/design/weekly-draft-feedback.md 25.3·25.5): document-actions `dev-made`.
// CC가 요청함 덩어리 아래 '→ 접수: … 완료 #NNN'을 적으면, 서버가 그 줄을 읽어 그 주 만들기 제안에 made 번호를 남긴다.
// 운영자 작업공간만, 서버가 그 주 행을 다시 읽어 answer='yes'·sent 있음·made 없음일 때만. 화면이 보낸 번호는 받지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m = await import('../../supabase/functions/document-actions/dev-inbox.ts');
const WS = '10000000-0000-4000-8000-0000000000aa';
const DOC = 'A'.repeat(44), WEEK = '2026-11-02';
const NOW = Date.parse('2026-11-03T05:00:00Z');

const INBOX = [
  '[11/02 23:00] 다른 요청 — (w:2026-11-02/s2) 흉내',
  '→ 접수: 다른 일 — 완료 #11',
  '[11/03 09:37] 주간보고 개발 후보 (w:2026-11-02/s1) — 끝난 일은 자동으로 빼기',
  '- 어떻게: 보고일 기준',
  '[11/03 10:00 사용자 추가] 덧붙임',
  '→ 접수: WEEKLY-끝남표시 — 진행 중 #1801',
  '→ 접수: WEEKLY-끝남표시 — 완료 DB #1799·화면 #1803 (11/03)',
  '[11/03 09:40] 주간보고 개발 후보 (w:2026-11-02/s3) — 세 번째',
  '→ 대조: 완료 #1804',
  '[11/03 09:41] 주간보고 개발 후보 (w:2026-10-26/s1) — 지난 주',
  '→ 접수: 완료 #1700',
  '[2026-11-03 11:00] 다음 요청',
  '→ 접수: 완료 #1',
].join('\n') + '\n';

function harness(o = {}) {
  const state = {
    owners: [{ workspace_id: WS }], mine: ['calls', 'dev_inbox'], only: WS, docId: DOC, docStatus: 200, docText: INBOX, patchEmpty: 0,
    rows: [{ workspace_id: WS, week_start: WEEK, draft_saved_at: '2026-11-03T04:00:00.000Z', draft: { v: 1, keep: 'x', feedback: { week: WEEK, review: { suggestions: [
      { id: 's1', text: '끝난 일', answer: 'yes', sent: '2026-11-03T00:37:00.000Z' },
      { id: 's2', text: '안 보낸 것', answer: 'yes' },
      { id: 's3', text: '이미 번호', answer: 'yes', sent: '2026-11-03T00:40:00.000Z', made: 1790 },
      { id: 's4', text: '뺀 것', answer: 'no', sent: '2026-11-03T00:41:00.000Z' },
    ] } } } }],
    ...o,
  };
  const calls = [];
  const deps = {
    userId: 'user-1', docId: state.docId, now: () => NOW,
    driveToken: async () => { calls.push({ kind: 'drive-token' }); return 'drive-token'; },
    db: async (path, opts = {}) => {
      calls.push({ kind: 'service', path, opts });
      if (path.startsWith('app_workspace_members?')) return state.owners;
      if (path === 'rpc/app_operator_feature_workspace') { assert.deepEqual(opts.body, { p_feature: 'dev_inbox' }); return state.only; }
      throw new Error('unexpected ' + path);
    },
    userDb: async (path, opts = {}) => {
      calls.push({ kind: 'user', path, opts });
      if (path === 'rpc/app_my_features') return state.mine;
      if (path.startsWith('app_weekly_exec_requests?')) {
        const q = new URLSearchParams(path.split('?')[1]);
        const rows = state.rows.filter(r => 'eq.' + r.workspace_id === q.get('workspace_id') && 'eq.' + r.week_start === q.get('week_start'));
        if (opts.method === 'PATCH') {
          if (state.patchEmpty > 0) { state.patchEmpty--; return []; }
          const hit = rows.filter(r => q.get('draft_saved_at') === 'eq.' + r.draft_saved_at);
          hit.forEach(r => Object.assign(r, opts.body));
          return hit.map(r => ({ week_start: r.week_start }));
        }
        return rows;
      }
      throw new Error('unexpected ' + path);
    },
    fetch: async (url, init = {}) => {
      calls.push({ kind: 'docs', url: String(url), init });
      const chunks = state.docText.split(/(?<=\n)/);
      return new Response(JSON.stringify({ body: { content: [{ sectionBreak: {} }, ...chunks.map(t => ({ paragraph: { elements: [{ textRun: { content: t } }] } })), { table: {} }] } }), { status: state.docStatus });
    },
  };
  return { state, calls, deps, run: (body = { action: 'dev-made', week_start: WEEK }) => m.readDevMade(body, deps) };
}
const sugg = h => h.state.rows[0].draft.feedback.review.suggestions;

test('madeFromInbox: 그 주 열쇠 덩어리의 → 줄 중 완료가 든 줄의 마지막 #번호, 덧붙임 줄은 덩어리 안, 다음 머리줄에서 끝', () => {
  assert.deepEqual([...m.madeFromInbox(INBOX, WEEK)], [['s1', 1803], ['s3', 1804]]);
  assert.deepEqual([...m.madeFromInbox(INBOX, '2026-10-26')], [['s1', 1700]]);
  assert.equal(m.madeFromInbox('[11/03 09:37] 주간보고 개발 후보 (w:2026-11-02/s1) — 글 완료 #5\n- 어떻게: 완료 #6\n', WEEK).size, 0, '→ 줄이 아니면 번호로 보지 않음');
  assert.equal(m.madeFromInbox('[11/03 09:37] 주간보고 개발 후보 (w:2026-11-02/s1) — 글\n→ 접수: 대기 #1790 뒤\n', WEEK).size, 0, '완료가 없으면 없음');
  assert.equal(m.madeFromInbox('[11/03 09:37] 주간보고 개발 후보 (w:2026-11-02/s1) — 글\n→ 접수: 완료 #1234567\n', WEEK).size, 0, '100만 이상은 받지 않음');
});

test('운영자: 보낸 뒤 번호 없는 제안에만 made를 남기고(이미 번호·뺀 것·안 보낸 것 그대로), 판 번호를 올리고 다른 칸은 그대로', async () => {
  const h = harness();
  assert.deepEqual(await h.run(), { ok: true, result: 'ok', updated: 1 });
  const d = h.calls.find(c => c.kind === 'docs');
  assert.equal(d.url, `https://docs.googleapis.com/v1/documents/${DOC}?fields=${encodeURIComponent('body/content/paragraph/elements/textRun/content')}`);
  assert.equal(d.init.method, 'GET');
  assert.equal(d.init.headers.Authorization, 'Bearer drive-token');
  const s = sugg(h);
  assert.equal(s[0].made, 1803);
  assert.equal(s[1].made, undefined);
  assert.equal(s[2].made, 1790);
  assert.equal(s[3].made, undefined);
  assert.equal(h.state.rows[0].draft.keep, 'x');
  assert.equal(h.state.rows[0].draft_saved_at, new Date(NOW).toISOString());
  const patch = h.calls.find(c => c.opts?.method === 'PATCH');
  assert.match(patch.path, /draft_saved_at=eq\./);
  // 다시 불러도 이미 번호가 있어 문서를 읽지 않는다.
  const before = h.calls.length;
  assert.deepEqual(await h.run(), { ok: true, result: 'none', updated: 0 });
  assert.equal(h.calls.slice(before).filter(c => c.kind === 'docs').length, 0);
});

test('기다리는 제안이 없거나 문서에 그 줄이 없으면 쓰지 않는다', async () => {
  const h = harness();
  sugg(h)[0].sent = undefined;
  assert.deepEqual(await h.run(), { ok: true, result: 'none', updated: 0 });
  assert.equal(h.calls.filter(c => c.kind === 'docs' || c.kind === 'drive-token').length, 0);
  const h2 = harness({ docText: '[11/03 09:37] 주간보고 개발 후보 (w:2026-11-02/s1) — 글\n- 어떻게: x\n' });
  assert.deepEqual(await h2.run(), { ok: true, result: 'ok', updated: 0 });
  assert.equal(h2.calls.filter(c => c.opts?.method === 'PATCH').length, 0);
});

test('운영자 아님·owner 아님은 거절, 문서 id 없으면 not_ready — 행·문서를 읽지 않는다', async () => {
  for (const o of [{ mine: ['calls'] }, { only: 'other' }]) {
    const h = harness(o);
    await assert.rejects(h.run(), e => e.code === 'FEATURE_REQUIRED' && e.status === 403);
    assert.equal(h.calls.filter(c => c.kind === 'docs' || String(c.path || '').startsWith('app_weekly')).length, 0);
  }
  for (const owners of [[], [{ workspace_id: WS }, { workspace_id: 'x' }]]) {
    const h = harness({ owners });
    await assert.rejects(h.run(), e => e.code === 'FORBIDDEN' && e.status === 403);
  }
  const h = harness({ docId: '' });
  assert.deepEqual(await h.run(), { ok: true, result: 'not_ready', updated: 0 });
  assert.equal(h.calls.filter(c => c.kind === 'docs' || String(c.path || '').startsWith('app_weekly')).length, 0);
});

test('요청 모양: 정확히 action·week_start(월요일)만 — 화면이 번호·id를 보내면 거절', async () => {
  for (const body of [{ action: 'dev-made', week_start: WEEK, made: 5 }, { action: 'dev-made', week_start: WEEK, id: 's1' }, { action: 'dev-made', week_start: '2026-11-03' }, { action: 'dev-made' }]) {
    const h = harness();
    await assert.rejects(h.run(body), e => e.code === 'INVALID_REQUEST');
    assert.equal(h.calls.length, 0);
  }
});

test('문서 읽기 실패는 DOC_UNAVAILABLE(쓰지 않음), 그사이 바뀌면 한 번 다시 읽어 남기고 그래도 안 되면 WRITE_FAILED', async () => {
  const h = harness({ docStatus: 403 });
  await assert.rejects(h.run(), e => e.code === 'DOC_UNAVAILABLE' && e.status === 503);
  assert.equal(sugg(h)[0].made, undefined);
  const h2 = harness({ patchEmpty: 1 });
  assert.deepEqual(await h2.run(), { ok: true, result: 'ok', updated: 1 });
  assert.equal(h2.calls.filter(c => c.opts?.method === 'PATCH').length, 2);
  const h3 = harness({ patchEmpty: 5 });
  await assert.rejects(h3.run(), e => e.code === 'WRITE_FAILED');
});

test('index.ts: dev-made는 로그인 뒤에만, 같은 비밀값·내 로그인 토큰, 문서 글을 로그에 쓰지 않는다', () => {
  const src = readFileSync(new URL('../../supabase/functions/document-actions/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf("action === 'dev-made'"), user = src.indexOf('const user = await getUser(req);');
  assert.ok(at > user && user > 0);
  const block = src.slice(at, src.indexOf("action === 'register-basket-attachment'"));
  assert.match(block, /readDevMade\(body, \{ userId: user\.id,[^\n]*userDb: userDbFor\(token\)[^\n]*docId: Deno\.env\.get\('WEB2_DEV_INBOX_DOC_ID'\)/);
  assert.match(block, /console\.error\('document-actions dev-made failed', \{ code:/);
});
