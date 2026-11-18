// BRIEF-브리핑룸 PR ②: supabase/functions/document-actions/brief-run.mjs. 네트워크 없음: DB·Drive·AI는 메모리 가짜, 자료는 예시.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as r from '../supabase/functions/document-actions/brief-run.mjs';

const WS = 'a0000000-0000-4000-8000-000000000001', USER = 'b0000000-0000-4000-8000-000000000002', DOC = 'c0000000-0000-4000-8000-000000000003';
const doc = { id: DOC, workspace_id: WS, file_id: 'FILE_abcdefghij', file_name: '예시 편람.pdf', mime_type: 'application/pdf', title: '예시 경영평가 편람 개정안' };
// 예시 자료 30쪽(쪽마다 약 1,500자) → 조각 4개 정도.
const QUOTE = '인건비 관리의 적정성 지표 배점을 현행 5점에서 8점으로 상향하고, 총인건비 인상률 준수 여부를 감점 요소로 반영한다.';
const pages = Array.from({ length: 30 }, (_, i) => (i === 11 ? `3. 평가 지표 개편\n${QUOTE}\n` : '') + `${i + 1}쪽 예시 문단입니다. `.repeat(100));
const SOURCE = pages.join('\f');

function fakeDb() {
  const rows = []; let n = 0; const calls = [];
  const match = (row, q) => {
    for (const [k, v] of q) {
      if (['select', 'limit'].includes(k)) continue;
      if (v.startsWith('eq.')) { if (String(row[k]) !== decodeURIComponent(v.slice(3))) return false; }
      else if (v.startsWith('in.(')) { if (!v.slice(4, -1).split(',').includes(String(row[k]))) return false; }
      else throw new Error(`unsupported ${k}=${v}`);
    }
    return true;
  };
  const db = async (path, opts = {}) => {
    const [table, qs] = path.split('?'); assert.equal(table, r.BRIEF_TABLE);
    const q = [...new URLSearchParams(qs)].map(([k, v]) => [k, v]);
    const method = opts.method ?? 'GET'; calls.push(method);
    if (method === 'GET') return rows.filter(x => match(x, q)).slice(0, 1).map(x => ({ ...x }));
    if (method === 'POST') {
      for (const k of ['id', 'brief', 'source_text', 'parts']) assert.ok(!(k in opts.body), `insert ${k}`);
      const row = { id: `d0000000-0000-4000-8000-00000000000${++n}`, attempts: 0, parts: [], brief: null, source_text: null, lease_until: null, updated_at: new Date(0).toISOString(), ...opts.body };
      rows.push(row); return [{ ...row }];
    }
    if (method === 'PATCH') {
      for (const k of ['workspace_id', 'created_by', 'document_id', 'source_file_id']) assert.ok(!(k in opts.body), `update ${k}`);
      const hit = rows.filter(x => match(x, q)); hit.forEach(x => Object.assign(x, structuredClone(opts.body)));
      return hit.map(x => ({ id: x.id }));
    }
    throw new Error(method);
  };
  return { db, rows, calls };
}

function aiFake({ invent = false } = {}) {
  const seen = [];
  return {
    seen,
    ai: async (name, instructions, input, schema, max) => {
      seen.push(name);
      if (name === 'brief_chunk') {
        const has = input.includes('3. 평가 지표 개편');
        return { ok: true, model: 'test-model', text: JSON.stringify({
          lead: has ? '인건비 배점 상향(12쪽)' : '예시 문단',
          touches: has ? ['예시 가지부 영향(12쪽)'] : [], todos: has ? ['의견 제출 11/28까지(99쪽)'] : [], conflicts: [],
          quotes: has ? [{ text: QUOTE, heading: '3. 평가 지표 개편', why: '배점이 오르면 기관이 버팀' }, ...(invent ? [{ text: '인력 충원은 전면 금지한다고 정했다.', heading: 'x', why: 'y' }] : [])] : [],
        }) };
      }
      return { ok: true, model: 'test-model', text: JSON.stringify({ lead: '인건비 배점이 늘어남.', touches: ['예시 가지부 영향(12쪽)'], todos: ['의견 제출 11/28까지'], conflicts: [], quotes: [{ id: 'q1', why: '배점' }, { id: 'q2', why: '지어낸 것' }] }) };
    },
  };
}

const base = (over = {}) => {
  const f = fakeDb(); const a = aiFake(over);
  let t = 1_700_000_000_000;
  const runner = r.createBriefRunner({
    db: f.db, ai: a.ai, now: () => (t += 1000),
    extract: async () => ({ text: over.text ?? SOURCE, reason: 'ok' }),
    capCheck: async () => over.cap ?? { ok: true },
    scope: async () => ({ orgs: ['예시 가지부'], areas: ['사업영역 A'] }),
    budgetMs: over.budgetMs ?? 1e9,
  });
  return { f, a, runner };
};

test('start → run: read, chunks, merge; quote verified, page from server, text cleared', async () => {
  const { f, a, runner } = base({ invent: true });
  const { row, created } = await runner.start({ userId: USER, doc });
  assert.equal(created, true); assert.equal(row.status, 'queued');
  assert.equal((await runner.start({ userId: USER, doc })).created, false, 'one running job per document');
  assert.equal(await runner.run(row.id, doc), 'done');
  const saved = f.rows[0];
  assert.equal(saved.status, 'done'); assert.equal(saved.page_count, 30); assert.equal(saved.source_text, null);
  assert.equal(saved.brief.lead, '인건비 배점이 늘어남.');
  assert.equal(saved.brief.quotes.length, 1, 'invented quote never became a candidate');
  assert.equal(saved.brief.quotes[0].text, QUOTE); assert.equal(saved.brief.quotes[0].page, 12);
  assert.equal(a.seen.filter(x => x === 'brief_chunk').length, saved.step_total - 1);
  assert.equal(a.seen.at(-1), 'brief_merge');
  assert.equal(saved.lease_until, null);
});

test('scanned/empty file → failed no_text, no AI call', async () => {
  const { f, a, runner } = base({ text: '   \f  \f' });
  const { row } = await runner.start({ userId: USER, doc });
  assert.equal(await runner.run(row.id, doc), 'failed');
  assert.equal(f.rows[0].error_code, 'no_text'); assert.equal(a.seen.length, 0);
});

test('monthly cap: start refused; cap hit mid-way → failed ai_monthly_cap', async () => {
  const capped = base({ cap: { ok: false, status: 429, code: 'ai_monthly_cap' } });
  await assert.rejects(capped.runner.start({ userId: USER, doc }), e => e.status === 429 && e.code === 'ai_monthly_cap');
  assert.equal(capped.f.rows.length, 0);
  let calls = 0; const f = fakeDb(); const a = aiFake();
  const runner = r.createBriefRunner({ db: f.db, ai: a.ai, now: Date.now, extract: async () => ({ text: SOURCE }), scope: async () => ({ orgs: [], areas: [] }),
    capCheck: async () => (++calls <= 2 ? { ok: true } : { ok: false, status: 429, code: 'ai_monthly_cap' }) });
  const { row } = await runner.start({ userId: USER, doc });
  assert.equal(await runner.run(row.id, doc), 'failed');
  assert.equal(f.rows[0].error_code, 'ai_monthly_cap'); assert.equal(a.seen.length, 1);
});

test('budget: pauses with lease released, next run continues; busy while leased', async () => {
  const { f, runner } = base({ budgetMs: 2500 });
  const { row } = await runner.start({ userId: USER, doc });
  assert.equal(await runner.run(row.id, doc), 'paused');
  assert.equal(f.rows[0].lease_until, null); assert.equal(f.rows[0].stage, 'chunk'); assert.ok(f.rows[0].step_no < f.rows[0].step_total);
  f.rows[0].lease_until = new Date(Date.now() + 1e9).toISOString();
  assert.equal(await runner.run(row.id, doc), 'busy');
  f.rows[0].lease_until = null;
  let out; for (let i = 0; i < 20 && out !== 'done'; i++) out = await runner.run(row.id, doc);
  assert.equal(out, 'done');
});

test('AI busy → pause (not failed); too many tries → failed', async () => {
  const f = fakeDb();
  const runner = r.createBriefRunner({ db: f.db, ai: async () => ({ ok: false, code: 'ai_busy' }), now: Date.now, extract: async () => ({ text: SOURCE }),
    capCheck: async () => ({ ok: true }), scope: async () => ({ orgs: [], areas: [] }) });
  const { row } = await runner.start({ userId: USER, doc });
  assert.equal(await runner.run(row.id, doc), 'paused');
  assert.equal(f.rows[0].status, 'running');
  f.rows[0].attempts = r.BRIEF_MAX_ATTEMPTS;
  assert.equal(await runner.run(row.id, doc), 'busy');
  assert.equal(f.rows[0].status, 'failed'); assert.equal(f.rows[0].error_code, 'too_many_tries'); assert.equal(f.rows[0].source_text, null);
});

test('isStalled', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(r.isStalled({ status: 'running', lease_until: null, updated_at: '2026-11-13T09:59:00Z' }, now), true);
  assert.equal(r.isStalled({ status: 'running', lease_until: '2026-11-13T10:01:00Z', updated_at: '2026-11-13T09:59:00Z' }, now), false);
  assert.equal(r.isStalled({ status: 'done' }, now), false);
});
