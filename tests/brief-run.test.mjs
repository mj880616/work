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
          points: has ? [{ heading: '3. 평가 지표 개편', text: '인건비 지표 배점 5점→8점(12쪽)' }, { heading: '', text: '의견 제출 11/28까지(99쪽)' }] : [],
          quotes: has ? [{ text: QUOTE, heading: '3. 평가 지표 개편', speaker: '', why: '배점이 오르면 기관이 버팀' }, ...(invent ? [{ text: '인력 충원은 전면 금지한다고 정했다.', heading: 'x', speaker: '', why: 'y' }] : [])] : [],
        }) };
      }
      return { ok: true, model: 'test-model', text: JSON.stringify({ gist: ['인건비 배점이 늘어남.'], sections: [{ title: '평가 지표 개편', items: [{ text: '인건비 배점 5점→8점', page: 12, ours: false }, { text: '예시 가지부 영향', page: 12, ours: true }] }], quotes: [{ id: 'q1' }, { id: 'q2' }] }) };
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

// S67-50(사용자 11/20 22:33): 담당 범위는 그 사람이 등록한 값만. 특정 조직·업종(철도 등)·노동조합을 전제로 두지 않는다.
// S68-56: '우리 관련'은 항목 옆 표시만(서버가 등록 이름이 든 줄만 남김), 따로 칸 없음.
const scoped = (scope, aiOver = {}) => {
  const f = fakeDb(); const inputs = []; const instr = [];
  const runner = r.createBriefRunner({
    db: f.db, now: Date.now, extract: async () => ({ text: SOURCE }), capCheck: async () => ({ ok: true }), scope,
    ai: async (name, instructions, input) => {
      inputs.push({ name, input }); instr.push(instructions);
      if (name === 'brief_chunk') return { ok: true, model: 'm', text: JSON.stringify({ lead: '요지', points: [{ heading: '', text: '예시 거래처 단가 조정(12쪽)' }], quotes: [{ text: QUOTE, heading: '', speaker: '', why: '' }] }) };
      const items = aiOver.items ?? [{ text: '철도 사업장 조직에 닿음', page: 12, ours: true }, { text: '예시거래처 단가 조정', page: 12, ours: true }, { text: '부담이 늘어남', page: 0, ours: false }];
      return { ok: true, model: 'm', text: JSON.stringify({ gist: ['요지 한 줄.'], sections: [{ title: '', items }], quotes: [{ id: 'q1' }] }) };
    },
  });
  return { f, runner, inputs, instr };
};

test('S67-50 scope: 등록한 담당 대상·프로젝트는 합치기 입력에만, 목록 밖 줄의 우리 관련 표시는 서버가 뺀다', async () => {
  const { f, runner, inputs } = scoped(async () => ({ orgs: ['예시 거래처'], areas: ['예시 프로젝트'] }));
  const { row } = await runner.start({ userId: USER, doc });
  assert.equal(await runner.run(row.id, doc), 'done');
  for (const { name, input } of inputs) {
    if (name === 'brief_merge') { assert.match(input, /내가 등록한 담당 대상: 예시 거래처/); assert.match(input, /내가 등록한 프로젝트: 예시 프로젝트/); }
    else assert.doesNotMatch(input, /내가 등록한/);
  }
  const b = f.rows[0].brief;
  assert.equal(b.v, 3);
  assert.deepEqual(b.gist, ['요지 한 줄.']);
  assert.deepEqual(b.sections, [{ title: '', items: [
    { text: '철도 사업장 조직에 닿음', page: 12 },
    { text: '예시거래처 단가 조정', page: 12, ours: true },
    { text: '부담이 늘어남', page: null },
  ] }], '목록에 없는 철도 줄은 우리 관련이 아님, 줄 자체는 요약으로 남음');
  assert.equal(b.scope, undefined);
});

test('S67-50 scope: 등록한 담당이 없으면 우리 관련 표시 없음, 입력에 없음이라고 적음', async () => {
  const { f, runner, inputs } = scoped(async () => ({ orgs: [], areas: [] }));
  const { row } = await runner.start({ userId: USER, doc });
  assert.equal(await runner.run(row.id, doc), 'done');
  assert.ok(inputs.filter(i => i.name === 'brief_merge').every(i => i.input.includes('내가 등록한 담당: 없음')));
  assert.ok(f.rows[0].brief.sections.flatMap(s => s.items).every(it => !it.ours));
});

test('S67-50 scope: 목록을 못 읽으면 우리 관련 표시 없음', async () => {
  const { f, runner, inputs } = scoped(async () => { throw new Error('down'); });
  const { row } = await runner.start({ userId: USER, doc });
  assert.equal(await runner.run(row.id, doc), 'done');
  assert.ok(inputs.filter(i => i.name === 'brief_merge').every(i => i.input.includes('확인하지 못함')));
  assert.ok(f.rows[0].brief.sections.flatMap(s => s.items).every(it => !it.ours));
});

test('S67-50 prompt: 노동조합·조합원·업종 고정 문구 없음, 목록 밖 전제 금지 규칙 있음', async () => {
  const shared = await import('../supabase/functions/_shared/brief-room.mjs');
  for (const text of [shared.CHUNK_INSTRUCTIONS, shared.MERGE_INSTRUCTIONS]) assert.doesNotMatch(text, /노동조합|노조|조합원|인력 충원|임금|노동조건/);
  assert.match(shared.MERGE_INSTRUCTIONS, /목록에 없는 조직·업종·사업장\(예: 철도·지하철\)을 이 사람의 담당으로 전제하지 않는다/);
  assert.match(shared.MERGE_INSTRUCTIONS, /목록이 "없음"이거나 애매하면 false/);
  assert.equal(shared.scopeText([], []), '내가 등록한 담당: 없음(담당 대상·프로젝트를 등록하지 않음)');
});

// S68-56(사용자 11/23): 회의록·보도자료 두 종류 가짜 자료 — 고정 칸이 강요되지 않고, AI가 자료 짜임대로 정한 소제목이 그대로 남는다.
const MINUTES = ['예시 위원회 회의록\n안건 1. 예시 노선 운영 계획\n국토교통부 철도국장: 연내 운영 기준을 마련하겠습니다.\n예시 위원: 예산 재검토가 필요합니다.', '안건 2. 기타\n위원장: 다음 회의는 12월 3일에 엽니다.'.padEnd(400, ' 예시')].join('\f');
const PRESS = ['보도자료\n예시부, 예시 제도 개편안 발표\n예시부는 23일 예시 제도 개편안을 발표했다. 개편안은 신청 기간을 30일에서 60일로 늘린다.', '근거: 지난해 신청자 조사에서 기간이 짧다는 응답이 62%였다.'.padEnd(400, ' 예시')].join('\f');
const kindRun = async (source, answer) => {
  const f = fakeDb(); const sent = [];
  const runner = r.createBriefRunner({
    db: f.db, now: Date.now, extract: async () => ({ text: source }), capCheck: async () => ({ ok: true }), scope: async () => ({ orgs: [], areas: [] }),
    ai: async (name, instructions, input, schema) => {
      sent.push({ name, instructions, schema });
      if (name === 'brief_chunk') return { ok: true, model: 'm', text: JSON.stringify({ lead: '요지', points: [{ heading: '', text: '내용' }], quotes: [] }) };
      return { ok: true, model: 'm', text: JSON.stringify(answer) };
    },
  });
  const { row } = await runner.start({ userId: USER, doc });
  assert.equal(await runner.run(row.id, doc), 'done');
  return { brief: f.rows[0].brief, sent };
};
test('S68-56 회의록·보도자료: 자료 짜임대로 정한 소제목이 그대로, 고정 칸 없음, 발언자는 문장 안', async () => {
  const minutes = await kindRun(MINUTES, { gist: ['국토교통부 철도국장이 연내 운영 기준 마련을 약속함'], sections: [
    { title: '안건 1. 예시 노선 운영 계획', items: [{ text: '국토교통부 철도국장: 연내 운영 기준 마련', page: 1, ours: false }, { text: '예시 위원: 예산 재검토 요구', page: 1, ours: false }] },
    { title: '안건 2. 기타', items: [{ text: '위원장: 다음 회의 12/3', page: 2, ours: false }] },
  ], quotes: [] });
  const press = await kindRun(PRESS, { gist: ['예시부가 신청 기간을 30일→60일로 늘리는 개편안 발표'], sections: [
    { title: '주장', items: [{ text: '예시부: 신청 기간 30일→60일', page: 1, ours: false }] },
    { title: '근거', items: [{ text: '신청자 62%가 기간이 짧다고 응답', page: 2, ours: false }] },
  ], quotes: [] });
  assert.deepEqual(minutes.brief.sections.map(s => s.title), ['안건 1. 예시 노선 운영 계획', '안건 2. 기타']);
  assert.deepEqual(press.brief.sections.map(s => s.title), ['주장', '근거']);
  assert.equal(minutes.brief.sections[0].items[0].text, '국토교통부 철도국장: 연내 운영 기준 마련');
  for (const { brief, sent } of [minutes, press]) {
    assert.equal(brief.v, 3);
    for (const k of ['todos', 'orgs', 'counters', 'glance', 'touches', 'conflicts']) assert.equal(brief[k], undefined);
    const merge = sent.find(x => x.name === 'brief_merge');
    assert.deepEqual(Object.keys(merge.schema.properties), ['gist', 'sections', 'quotes'], 'AI에 고정 칸 스키마를 주지 않음');
    assert.doesNotMatch(merge.instructions, /챙길 일|대응할 것|우리 조직 관련/);
  }
});

test('S67-50 readBriefScope: 로그인 토큰 REST로 담당 대상·프로젝트 둘 다, 휴지통·보관·끝난 것 빼고, 작업공간은 서버 값', async () => {
  const { readBriefScope } = await import('../supabase/functions/document-actions/brief.ts');
  const paths = [];
  const userDb = async (path) => {
    paths.push(path);
    if (path.startsWith('app_suborganizations?')) return [{ name: '예시 거래처', active: true }, { name: '쉬는 곳', active: false }, { name: 3 }];
    if (path.startsWith('app_spaces?')) return [{ name: '예시 프로젝트', status: 'active' }];
    throw new Error(path);
  };
  assert.deepEqual(await readBriefScope(userDb, WS), { orgs: ['예시 거래처'], areas: ['예시 프로젝트'] });
  assert.equal(paths.length, 2);
  for (const p of paths) { assert.match(p, new RegExp(`workspace_id=eq\\.${WS}&deleted_at=is\\.null`)); assert.doesNotMatch(p, /select=[^&]*\bid\b/); }
  assert.match(paths[1], /status\.not\.in\.\(archived,done\)/);
  await assert.rejects(readBriefScope(userDb, 'x'), e => e.status === 404);
});
