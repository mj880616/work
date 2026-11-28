// BRIEF-품질올리기('더 깊게', 운영자 기능 brief_plus, 설계 docs/design/brief-room.md 6-2절). 네트워크 없음: DB·AI는 메모리 가짜, 자료는 가짜 법안 글.
// - 허용 안 된 작업공간: 지시·스키마·출력 상한·부르는 모양이 지금과 똑같다(새 칸 없음).
// - 허용된 작업공간: 조각 메모에 근거 위치·원문 그대로의 숫자, 합치기는 '더 깊게'로 한 번, 결과에 짜임·쟁점·문서 안 불일치·배경 지식.
// - 문서 안 불일치: 두 값과 위치가 나온다. 원문에 없는 값·조문 번호는 서버가 뺀다.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as r from '../supabase/functions/document-actions/brief-run.mjs';
import * as m from '../supabase/functions/_shared/brief-room.mjs';

const WS = 'a0000000-0000-4000-8000-000000000001', USER = 'b0000000-0000-4000-8000-000000000002', DOC = 'c0000000-0000-4000-8000-000000000003';
const doc = { id: DOC, workspace_id: WS, file_id: 'FILE_abcdefghij', file_name: '가상 법률안.pdf', mime_type: 'application/pdf', title: '가상 공공기관 운영법 일부개정법률안' };
// 가짜 법안: 앞쪽 '주요 내용'의 시행 시기(공포 후 6개월)와 부칙 제1조의 시행 시기(공포 후 1년)가 다르다.
const PAGES = [
  '가상 공공기관 운영법 일부개정법률안\n제안 이유 및 주요 내용\n가. 기관 평가위원회를 설치함(안 제3조의2).\n나. 이 법은 공포 후 6개월이 경과한 날부터 시행함.\n' + '예시 설명 문장입니다. '.repeat(60),
  '제3조의2(평가위원회) ① 기관의 운영을 평가하기 위하여 평가위원회를 둔다.\n② 위원회는 위원장 1명을 포함한 9명 이내의 위원으로 구성한다.\n' + '예시 조문 문장입니다. '.repeat(60),
  '제7조(인건비) 총인건비 인상률은 기획예산 지침에서 정하는 범위를 넘을 수 없다.\n' + '예시 조문 문장입니다. '.repeat(60),
  '부칙\n제1조(시행일) 이 법은 공포 후 1년이 경과한 날부터 시행한다.\n제2조(경과조치) 이 법 시행 당시 위원은 남은 임기 동안 위원으로 본다.\n' + '예시 부칙 문장입니다. '.repeat(40),
];
const SOURCE = PAGES.join('\f');

function fakeDb() {
  const rows = []; let n = 0;
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
    const [, qs] = path.split('?');
    const q = [...new URLSearchParams(qs)];
    const method = opts.method ?? 'GET';
    if (method === 'GET') return rows.filter(x => match(x, q)).slice(0, 1).map(x => ({ ...x }));
    if (method === 'POST') { const row = { id: `d0000000-0000-4000-8000-00000000000${++n}`, attempts: 0, parts: [], brief: null, source_text: null, lease_until: null, ...opts.body }; rows.push(row); return [{ ...row }]; }
    if (method === 'PATCH') { const hit = rows.filter(x => match(x, q)); hit.forEach(x => Object.assign(x, structuredClone(opts.body))); return hit.map(x => ({ id: x.id })); }
    throw new Error(method);
  };
  return { db, rows };
}

// AI 흉내: 지시·스키마·옵션을 적어 두고, '더 깊게' 지시면 새 칸을 담아 답한다.
function aiFake() {
  const sent = [];
  const ai = async (name, instructions, input, schema, max, ...rest) => {
    sent.push({ name, instructions, input, schema, max, opts: rest[0], argc: 5 + rest.length });
    const plus = !!schema.properties.facts || !!schema.properties.issues;
    if (name === 'brief_chunk') {
      const first = input.includes('제안 이유'), law = input.includes('부칙');
      return { ok: true, model: 'm', text: JSON.stringify({
        lead: '평가위원회 설치와 시행 시기',
        points: [
          { heading: '주요 내용', text: '기관 평가위원회 설치', ref: '안 제3조의2' },
          { heading: '제3조의2', text: '위원회는 9명 이내 위원으로 구성', ref: '제3조의2 제2항' },
          { heading: '', text: '지어낸 조문 번호 항목', ref: '제99조' },
        ],
        ...(plus ? { facts: [
          ...(first ? [{ what: '시행일', value: '공포 후 6개월이 경과한 날', ref: '주요 내용 나' }] : []),
          ...(law ? [{ what: '시행일', value: '공포 후 1년이 경과한 날', ref: '부칙 제1조' }] : []),
          { what: '위원 정수', value: '9명 이내', ref: '제3조의2 제2항' },
          { what: '지어낸 값', value: '공포 후 3년', ref: '부칙 제1조' },
        ] } : {}),
        quotes: [],
      }) };
    }
    const base = { gist: ['평가위원회를 새로 두고 시행 시기를 정함.'], sections: [{ title: '평가위원회', items: [
      { text: '위원회는 9명 이내 위원으로 구성', page: 2, ours: false, ...(plus ? { ref: '제3조의2 제2항' } : {}) },
      { text: '지어낸 조문 근거 항목', page: 0, ours: false, ...(plus ? { ref: '제99조' } : {}) },
    ] }], quotes: [] };
    if (!plus) return { ok: true, model: 'm', text: JSON.stringify(base) };
    return { ok: true, model: 'm', text: JSON.stringify({ ...base,
      core: '본문 개정 조문과 부칙 2개 조, 핵심은 제3조의2 평가위원회 설치',
      issues: [{ text: '평가위원회 구성에 노동자 쪽 위원 몫이 없음', why: '제3조의2는 위원 수만 정하고 추천 주체를 정하지 않음', ref: '제3조의2' }],
      mismatches: [
        { what: '시행일', a: { value: '공포 후 6개월이 경과한 날', ref: '주요 내용 나' }, b: { value: '공포 후 1년이 경과한 날', ref: '부칙 제1조' }, note: '부칙이 법적 효력이 있어 1년으로 보이나 확인 필요' },
        { what: '지어낸 불일치', a: { value: '공포 후 3년', ref: '부칙 제1조' }, b: { value: '공포 후 1년이 경과한 날', ref: '부칙 제1조' }, note: 'x' },
        { what: '같은 값', a: { value: '9명 이내', ref: '' }, b: { value: '9명 이내', ref: '' }, note: 'x' },
      ],
      background: [{ text: '공공기관 총인건비 제도는 매년 예산 지침으로 인상률 상한을 정함' }],
    }) };
  };
  return { ai, sent };
}

async function runOnce({ plus }) {
  const f = fakeDb(), a = aiFake();
  const runner = r.createBriefRunner({
    db: f.db, now: Date.now, extract: async () => ({ text: SOURCE }), capCheck: async () => ({ ok: true }), scope: async () => ({ orgs: [], areas: [] }),
    ai: a.ai, ...(plus === undefined ? {} : { plus: async () => plus }),
  });
  const { row } = await runner.start({ userId: USER, doc });
  let out = await runner.run(row.id, doc);
  while (out === 'paused') out = await runner.run(row.id, doc);
  assert.equal(out, 'done');
  return { brief: f.rows[0].brief, parts: f.rows[0].parts, sent: a.sent };
}

test('허용 안 된 작업공간(키 없음·plus 없음): 지시·스키마·출력 상한·부르는 모양이 지금과 같고 새 칸이 없다', async () => {
  for (const plus of [undefined, { on: false, lens: '' }]) {
    const { brief, sent } = await runOnce({ plus });
    const chunks = sent.filter(s => s.name === 'brief_chunk'), merge = sent.find(s => s.name === 'brief_merge');
    assert.ok(chunks.length >= 1);
    for (const c of chunks) { assert.equal(c.instructions, m.CHUNK_INSTRUCTIONS); assert.equal(c.schema, r.CHUNK_SCHEMA); assert.equal(c.max, r.CHUNK_MAX_TOKENS); assert.equal(c.argc, 5); }
    assert.equal(merge.instructions, m.MERGE_INSTRUCTIONS); assert.equal(merge.schema, r.MERGE_SCHEMA); assert.equal(merge.max, r.MERGE_MAX_TOKENS); assert.equal(merge.argc, 5);
    assert.doesNotMatch(merge.input, /숫자·날짜\(원문 그대로\)/);
    assert.equal(brief.v, 3); assert.equal(brief.plus, undefined);
    for (const sec of brief.sections) for (const it of sec.items) assert.equal(it.ref, undefined);
  }
});

test('허용된 작업공간: 조각은 근거 위치·숫자 지시, 합치기는 "더 깊게" 한 번(관점 글 포함), 숫자 목록이 합치기 입력에', async () => {
  const lens = '가상 관점: 비용 늘어나는 조항';
  const { sent, parts } = await runOnce({ plus: { on: true, lens } });
  const chunks = sent.filter(s => s.name === 'brief_chunk'), merges = sent.filter(s => s.name === 'brief_merge');
  for (const c of chunks) { assert.equal(c.instructions, m.CHUNK_PLUS_INSTRUCTIONS); assert.equal(c.schema, r.CHUNK_PLUS_SCHEMA); assert.equal(c.max, r.CHUNK_PLUS_MAX_TOKENS); assert.equal(c.argc, 5, '조각은 모델·생각 수준 그대로'); }
  assert.equal(merges.length, 1);
  assert.deepEqual(merges[0].opts, { plus: true });
  assert.equal(merges[0].schema, r.MERGE_PLUS_SCHEMA);
  assert.ok(merges[0].instructions.includes(`관점: "${lens}"`));
  assert.match(merges[0].input, /숫자·날짜\(원문 그대로\):\n- \[조각 \d\] 시행일: 공포 후 6개월이 경과한 날 〈주요 내용 나〉/);
  assert.match(merges[0].input, /시행일: 공포 후 1년이 경과한 날 〈부칙 제1조〉/);
  // 원문에 없는 값은 조각 메모에서 이미 빠진다.
  const facts = parts.flatMap(p => p.facts ?? []);
  assert.ok(facts.length >= 3);
  assert.ok(!facts.some(f => f.value === '공포 후 3년'), '지어낸 값 없음');
  // 근거 위치: 원문에 있는 조문만.
  const points = parts.flatMap(p => p.points ?? []);
  assert.ok(points.some(p => p.ref === '제3조의2 제2항'));
  assert.ok(!points.some(p => p.ref === '제99조'));
});

test('허용된 작업공간: 결과에 짜임·근거 위치·쟁점·문서 안 불일치(두 값과 위치)·배경 지식(확인 필요)', async () => {
  const { brief } = await runOnce({ plus: { on: true, lens: '' } });
  assert.equal(brief.v, 3, '편집 저장 함수가 받는 v=3 그대로');
  assert.ok(brief.gist.length >= 1);
  const items = brief.sections.flatMap(s => s.items);
  assert.equal(items.find(i => i.text.startsWith('위원회는')).ref, '제3조의2 제2항');
  assert.equal(items.find(i => i.text.startsWith('지어낸')).ref, undefined, '원문에 없는 조문 번호는 뺀다');
  const p = brief.plus;
  assert.match(p.core, /제3조의2/);
  assert.equal(p.issues.length, 1); assert.equal(p.issues[0].ref, '제3조의2'); assert.ok(p.issues[0].why);
  assert.deepEqual(p.mismatches, [{ what: '시행일', a: { value: '공포 후 6개월이 경과한 날', ref: '주요 내용 나' }, b: { value: '공포 후 1년이 경과한 날', ref: '부칙 제1조' }, note: '부칙이 법적 효력이 있어 1년으로 보이나 확인 필요' }],
    '원문에 없는 값·같은 값 불일치는 서버가 뺀다');
  assert.equal(p.background.length, 1); assert.match(p.background[0].text, /\(확인 필요\)$/);
});

test('관점 글: 비었거나 틀리면 기본 관점, 있으면 그 글', async () => {
  const { sent } = await runOnce({ plus: { on: true, lens: '<b>꺾쇠</b>' } });
  assert.ok(sent.find(s => s.name === 'brief_merge').instructions.includes(`관점: "${m.BRIEF_DEFAULT_LENS}"`));
  assert.equal(m.lensText('  짧은   관점 '), '짧은 관점');
  assert.equal(m.lensText(''), m.BRIEF_DEFAULT_LENS);
  assert.equal(m.lensText('가'.repeat(201)), m.BRIEF_DEFAULT_LENS);
  assert.equal(m.lensText(null), m.BRIEF_DEFAULT_LENS);
});

test('"더 깊게" 판정을 못 읽으면 지금 방식(닫힌 쪽)', async () => {
  const f = fakeDb(), a = aiFake();
  const runner = r.createBriefRunner({ db: f.db, now: Date.now, extract: async () => ({ text: SOURCE }), capCheck: async () => ({ ok: true }), scope: async () => ({ orgs: [], areas: [] }),
    ai: a.ai, plus: async () => { throw new Error('down'); } });
  const { row } = await runner.start({ userId: USER, doc });
  assert.equal(await runner.run(row.id, doc), 'done');
  assert.equal(a.sent.find(s => s.name === 'brief_merge').instructions, m.MERGE_INSTRUCTIONS);
  assert.equal(f.rows[0].brief.plus, undefined);
});

test('"더 깊게" 합치기는 앞 일로 시간을 많이 쓴 부름에서 시작하지 않고 다음 부름(새 시간)에서 한다', async () => {
  const f = fakeDb(), a = aiFake();
  let clock = 1_000_000;
  const slowAi = async (...args) => { clock += 20_000; return a.ai(...args); };
  const runner = r.createBriefRunner({ db: f.db, now: () => clock, extract: async () => ({ text: SOURCE }), capCheck: async () => ({ ok: true }), scope: async () => ({ orgs: [], areas: [] }),
    ai: slowAi, plus: async () => ({ on: true, lens: '' }), budgetMs: 10 * 60 * 1000 });
  const { row } = await runner.start({ userId: USER, doc });
  assert.equal(await runner.run(row.id, doc), 'paused');
  assert.equal(f.rows[0].stage, 'merge');
  assert.equal(a.sent.filter(s => s.name === 'brief_merge').length, 0);
  assert.equal(await runner.run(row.id, doc), 'done');
  assert.equal(a.sent.filter(s => s.name === 'brief_merge').length, 1);
});

test('readBriefPlus: 서버 허용 표(app_my_features, 로그인 토큰)에 brief_plus가 있을 때만, 관점은 내 프로필에서', async () => {
  const calls = [];
  const mk = (features, prefs, { failFeatures = false, failProfile = false } = {}) => async (path, opts = {}) => {
    calls.push([path, opts.method ?? 'GET']);
    if (path === 'rpc/app_my_features') { if (failFeatures) throw new Error('x'); return features; }
    if (path.startsWith('app_profiles?')) { if (failProfile) throw new Error('x'); return [{ view_prefs: prefs }]; }
    throw new Error(path);
  };
  assert.deepEqual(await r.readBriefPlus(mk(['calls', 'mcp_write'], null), USER), { on: false, lens: '' });
  assert.deepEqual(calls.map(c => c[0]), ['rpc/app_my_features'], '키가 없으면 프로필을 읽지 않는다');
  assert.deepEqual(calls[0], ['rpc/app_my_features', 'POST']);
  calls.length = 0;
  assert.deepEqual(await r.readBriefPlus(mk(['brief_plus'], { brief_lens: '내 관점' }), USER), { on: true, lens: '내 관점' });
  assert.equal(calls[1][0], `app_profiles?user_id=eq.${USER}&select=view_prefs&limit=1`);
  assert.deepEqual(await r.readBriefPlus(mk(['brief_plus'], {}), USER), { on: true, lens: m.BRIEF_DEFAULT_LENS });
  assert.deepEqual(await r.readBriefPlus(mk(['brief_plus'], null, { failProfile: true }), USER), { on: true, lens: m.BRIEF_DEFAULT_LENS });
  assert.deepEqual(await r.readBriefPlus(mk(null, null, { failFeatures: true }), USER), { on: false, lens: '' });
  assert.deepEqual(await r.readBriefPlus(mk({ brief_plus: true }, null), USER), { on: false, lens: '' });
});

test('cleanRef·valueIn: 원문에 없는 조문 번호·값은 뺀다, 쪽은 범위 안만', () => {
  const folded = m.foldForMatch(SOURCE);
  assert.equal(m.cleanRef('제3조의2 제1항', folded, 4), '제3조의2 제1항');
  assert.equal(m.cleanRef('부칙 제1조', folded, 4), '부칙 제1조');
  assert.equal(m.cleanRef('제3조의9', folded, 4), '');
  assert.equal(m.cleanRef('12쪽', folded, 4), '');
  assert.equal(m.cleanRef('3쪽', folded, 4), '3쪽');
  assert.equal(m.cleanRef('그냥 글', folded, 4), '');
  assert.equal(m.cleanRef('q1 제3조의2', folded, 4), '');
  assert.equal(m.valueIn(folded, '공포 후 1년이'), '공포 후 1년이');
  assert.equal(m.valueIn(folded, '공포 후 2년'), '');
  assert.equal(m.valueIn(folded, '1'), '');
});

test('"더 깊게" 지시: 쟁점·불일치·배경 지식·근거 위치 규칙, 지어내지 말 것, 기본 지시에는 없는 낱말', () => {
  const ins = m.mergePlusInstructions(m.BRIEF_DEFAULT_LENS);
  for (const re of [/issues/, /mismatches/, /반드시 모두 맞춰 본다/, /background/, /\(확인 필요\)/, /근거 위치/, /지어내지/]) assert.match(ins, re);
  assert.match(m.CHUNK_PLUS_INSTRUCTIONS, /원문 글자 그대로/);
  assert.deepEqual(r.MERGE_PLUS_SCHEMA.required, ['core', 'gist', 'sections', 'issues', 'mismatches', 'background', 'quotes']);
  assert.deepEqual(r.CHUNK_PLUS_SCHEMA.required, ['lead', 'points', 'facts', 'quotes']);
  for (const text of [m.CHUNK_INSTRUCTIONS, m.MERGE_INSTRUCTIONS]) assert.doesNotMatch(text, /mismatches|facts|관점/);
});

test('새 칸 제목 줄 한 문장(plusLead): 쟁점은 가장 큰 것, 불일치는 대상과 두 값, 비면 빈 글', async () => {
  const { plusLead } = await import('../app/brief-room-model.mjs');
  const plus = {
    issues: [{ text: '평가 기준을 시행령에 넘김' }, { text: '위원 구성 불명확' }],
    mismatches: [{ what: '시행일', a: { value: '6개월', ref: '주요 내용' }, b: { value: '1년', ref: '부칙 제1조' } }],
    background: [{ text: '비슷한 제도 판례' }],
  };
  assert.equal(plusLead('issues', plus), '가장 큰 것: 평가 기준을 시행령에 넘김');
  assert.equal(plusLead('mismatches', plus), '시행일 두 값');
  assert.equal(plusLead('mismatches', { mismatches: [...plus.mismatches, { what: '정원', a: {}, b: {} }, { what: '시행일', a: {}, b: {} }] }), '시행일·정원 두 값씩');
  assert.equal(plusLead('background', plus), '비슷한 제도 판례');
  assert.equal(plusLead('issues', { issues: [] }), '');
  assert.equal(plusLead('issues', null), '');
});
