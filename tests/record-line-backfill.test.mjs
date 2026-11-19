import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// ORG-기록첨부 옛줄바꾸기(S67-13, 명진 11/19 '나'): 파일 이름으로 남은 기록 줄만 사진 설명 첫 줄로, ⋯ [이전 줄로 되돌리기].
const events = [];
globalThis.window = {addEventListener() {}, dispatchEvent: e => events.push(e), KPTURuntime: null};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const M = await import('../app/record-line-backfill.mjs');
const B = await import('../app/record-line-briefs.js');
const R = await import('../app/record-line-backfill.js');
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const WS = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333331', L2 = '33333333-3333-4333-8333-333333333332';
const N1 = '44444444-4444-4444-8444-444444444441', D1 = '55555555-5555-4555-8555-555555555551', D2 = '55555555-5555-4555-8555-555555555552';
const F1 = 'driveFileAAAA1111', F2 = 'driveFileBBBB2222';
const pic = (id, name) => ({drive_file_id: id, file_name: name, mime_type: 'image/png'});
const pdf = (id, name) => ({drive_file_id: id, file_name: name, mime_type: 'application/pdf'});
const one = [pic(F1, '투쟁명령 4호.png')];
const two = [pic(F1, '투쟁명령 4호.png'), pdf(F2, '공문.pdf')];

test('판정: 화면이 만든 대신 줄만 대상, 사람 글·AI 줄·어긋난 줄은 아님', () => {
  assert.equal(M.isFileNameLine('그림 1장 · 투쟁명령 4호.png', one), true);
  assert.equal(M.isFileNameLine('그림 1장 · 파일 1개 · 투쟁명령 4호.png 외 1', two), true);
  // 사람이 [요약 수정]으로 고친 줄·AI 한 줄
  assert.equal(M.isFileNameLine('투쟁명령 4호 — 전 조합원 파업 지침', one), false);
  assert.equal(M.isFileNameLine('그림 1장 · 투쟁명령 4호.png 사진 보고', one), false);
  // 첨부와 개수·이름이 어긋나면 애매 → 안 바꿈
  assert.equal(M.isFileNameLine('그림 2장 · 투쟁명령 4호.png 외 1', one), false);
  assert.equal(M.isFileNameLine('그림 1장 · 다른 이름.png', one), false);
  assert.equal(M.isFileNameLine('그림 1장 · 투쟁명령 4호.png', []), false);
  assert.equal(M.isFileNameLine(null, one), false);
  const rows = [{id: L1, line: '그림 1장 · 투쟁명령 4호.png', attachments: one}, {id: L2, line: '사람이 쓴 글', attachments: one}, {id: 'x', line: '그림 1장 · 투쟁명령 4호.png', attachments: one}];
  assert.deepEqual(M.backfillTargets(rows).map(r => r.id), [L1]);
});

test('바꿀 줄: 설명 첫 줄, 80자 상한, 꺾쇠·제어 문자 버림, 여러 파일이면 개수', () => {
  const briefs = new Map([[F1, '파업 지침 공문 사진\n둘째 줄은 안 씀']]);
  assert.equal(M.backfilledLine(one, briefs), '파업 지침 공문 사진');
  assert.equal(M.backfilledLine(two, briefs), '파업 지침 공문 사진 (그림 1장 · 파일 1개)');
  const long = '가'.repeat(120);
  const cut = M.briefLine(long);
  assert.equal([...cut].length, 80); assert.ok(cut.endsWith('…'));
  assert.equal(M.briefLine('<script>x</script>'), '');
  assert.equal(M.briefLine('a\u0007b'), '');
  assert.equal(M.backfilledLine(one, new Map()), '');
  // 첫 첨부 설명이 없으면 다음 첨부 설명
  assert.equal(M.backfilledLine(two, new Map([[F2, '공문 요약']])), '공문 요약 (그림 1장 · 파일 1개)');
  assert.deepEqual(M.picturesWithoutBrief(two, new Map()), [F1]);
  assert.deepEqual(M.picturesWithoutBrief(two, briefs), []);
});

test('되돌리기 표시: 사진 설명으로 바꾼 줄에만(AI 한 줄·사람 글·대신 줄에는 없음)', () => {
  const briefs = new Map([[F1, '파업 지침 공문 사진']]);
  assert.equal(M.canRevertLine('파업 지침 공문 사진', one, briefs), true);
  assert.equal(M.canRevertLine('AI가 올릴 때 쓴 다른 줄', one, briefs), false);
  assert.equal(M.canRevertLine('그림 1장 · 투쟁명령 4호.png', one, briefs), false);
  assert.equal(M.canRevertLine('파업 지침 공문 사진', one, new Map()), false);
  assert.equal(M.fileNameLine(one), '그림 1장 · 투쟁명령 4호.png');
});

// 가짜 서버: 작업공간 id를 걸어 부른 것만 돌려준다(다른 작업공간 줄은 섞여 와도 화면이 다시 거른다).
function fakeRt({docs = [], index = [], links = [], biz = [], notes = [], ws = WS} = {}) {
  const calls = [], writes = [];
  const ctx = {user: {id: 'u1'}, workspace: {id: ws}};
  const rt = {context: {read: () => ctx}, calls, writes, api: async (path, opt = {}) => {
    calls.push(path);
    if (opt.method === 'PATCH') { writes.push({path, body: opt.body}); return [{id: 'b'}]; }
    if (path.startsWith('/rest/v1/rpc/app_basket_update_link_summary')) { writes.push({rpc: opt.body}); return {ok: true}; }
    if (path.startsWith('/rest/v1/app_documents')) return docs;
    if (path.startsWith('/rest/v1/app_document_ai_index')) return index;
    if (path.startsWith('/rest/v1/app_record_links')) return path.includes('offset=0') ? links : [];
    if (path.startsWith('/rest/v1/app_business_records')) return path.includes('offset=0') ? biz : [];
    if (path.startsWith('/rest/v1/app_notes')) return notes;
    return [];
  }};
  return rt;
}

test('설명 읽기: 내 작업공간 자료·b1 행만, 남의 작업공간 줄은 버림', async () => {
  const rt = fakeRt({docs: [{id: D1, workspace_id: WS, file_id: F1, mime_type: 'image/png'}, {id: D2, workspace_id: OTHER, file_id: F2, mime_type: 'image/png'}],
    index: [{document_id: D1, workspace_id: WS, content_hash: 'b1:' + 'a'.repeat(32), summary: '설명'}, {document_id: D2, workspace_id: OTHER, content_hash: 'b1:' + 'b'.repeat(32), summary: '남의 설명'}]});
  const {briefs, docs} = await B.readFileBriefs([F1, F2, 'bad id!'], rt);
  assert.equal(briefs.get(F1), '설명'); assert.equal(briefs.has(F2), false); assert.equal(docs.has(F2), false);
  assert.ok(rt.calls.every(p => p.includes(`workspace_id=eq.${WS}`)));
  assert.ok(!rt.calls.some(p => p.includes('bad')));
});

test('찾기 + 바꾸기: 대신 줄만 쓰고(읽은 옛 줄과 같을 때만), 사업 기록 줄도 같이, 사람 글은 안 건드림', async () => {
  const links = [
    {id: L1, workspace_id: WS, summary: '그림 1장 · 투쟁명령 4호.png', note_id: N1, organization_id: 'o', project_id: null, note: {id: N1, workspace_id: WS, attachments: one}},
    {id: L2, workspace_id: WS, summary: '그림 1장 사람 글', note_id: N1, organization_id: 'o', project_id: null, note: {id: N1, workspace_id: WS, attachments: one}},
    {id: L2.replace(/2$/, '9'), workspace_id: OTHER, summary: '그림 1장 · 투쟁명령 4호.png', note_id: N1, organization_id: 'o', project_id: null, note: {id: N1, workspace_id: OTHER, attachments: one}},
  ];
  const biz = [{id: L2.replace(/2$/, '7'), workspace_id: WS, body: '그림 1장 · 투쟁명령 4호.png', source_id: N1}];
  const rt = fakeRt({links, biz, notes: [{id: N1, workspace_id: WS, attachments: one}],
    docs: [{id: D1, workspace_id: WS, file_id: F1, mime_type: 'image/png'}], index: [{document_id: D1, workspace_id: WS, content_hash: 'b1:' + 'c'.repeat(32), summary: '파업 지침 공문'}]});
  const found = await R.findBackfill(rt);
  assert.deepEqual(found.links.map(r => r.id), [L1]);
  assert.equal(found.biz.length, 1);
  const progress = [];
  const r = await R.runBackfill(found, rt, {onProgress: p => progress.push(p), ask: async () => { throw new Error('설명이 이미 있으면 묻지 않음'); }});
  assert.deepEqual(r, {done: 2, total: 2, left: 0, capped: false});
  const rpc = rt.writes.find(w => w.rpc);
  assert.deepEqual(rpc.rpc, {p_link_id: L1, p_expected_summary: '그림 1장 · 투쟁명령 4호.png', p_summary: '파업 지침 공문'});
  const patch = rt.writes.find(w => w.path);
  assert.ok(patch.path.includes(`workspace_id=eq.${WS}`) && patch.path.includes('body=eq.' + encodeURIComponent('그림 1장 · 투쟁명령 4호.png')));
  assert.deepEqual(patch.body, {body: '파업 지침 공문'});
  assert.equal(progress.at(-1).done, 2);
  assert.ok(events.some(e => e.type === 'kptu:basket-links-changed'));
});

test('설명이 없으면 서버에 4장씩 읽혀 만든 뒤 바꾸고, 읽힌 것이 없으면(상한) 멈춘다', async () => {
  const atts = [pic(F1, 'a.png')];
  const found = {links: [{kind: 'link', id: L1, line: '그림 1장 · a.png', note_id: N1, attachments: atts}], biz: []};
  let filled = false; const asked = [];
  const read = async () => ({briefs: filled ? new Map([[F1, '집회 사진']]) : new Map(), docs: new Map([[F1, {id: D1}]])});
  const wrote = [];
  const r = await R.runBackfill(found, fakeRt(), {read, ask: async ids => { asked.push(ids); filled = true; return {done: 1}; }, write: async (item, next) => { wrote.push(next); return true; }});
  assert.deepEqual(asked, [[D1]]); assert.deepEqual(wrote, ['집회 사진']); assert.equal(r.done, 1);
  // 상한: 매번 0장 → 멈추고 남은 개수를 알린다
  let n = 0;
  const many = Array.from({length: 20}, (_, i) => `driveFileCCCC${String(i).padStart(4, '0')}`);
  const found2 = {links: many.map((f, i) => ({kind: 'link', id: L1, line: `그림 1장 · p${i}.png`, attachments: [pic(f, `p${i}.png`)]})), biz: []};
  const r2 = await R.runBackfill(found2, fakeRt(), {read: async () => ({briefs: new Map(), docs: new Map(many.map((f, i) => [f, {id: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`}]))}),
    ask: async ids => { n++; assert.ok(ids.length <= 4); return {done: 0}; }, write: async () => true});
  assert.equal(n, R.EMPTY_BATCH_STOP); assert.equal(r2.done, 0); assert.equal(r2.left, 20); assert.equal(r2.capped, true);
  assert.match(M.finishText(r2), /20개는 오늘 사진 읽기 상한/);
  // 요약 행이 이미 있는 자료(서버가 건드리지 않음)는 묻지 않는다
  let askedIndexed = 0;
  await R.runBackfill(found, fakeRt(), {read: async () => ({briefs: new Map(), docs: new Map([[F1, {id: D1, indexed: true}]])}), ask: async () => { askedIndexed++; return {done: 0}; }, write: async () => true});
  assert.equal(askedIndexed, 0);
});

test('되돌리기: 바꾼 줄이면 첨부로 다시 만든 옛 줄로, 아니면 거절', async () => {
  const rt = fakeRt();
  const read = async () => ({briefs: new Map([[F1, '파업 지침 공문']]), docs: new Map()});
  const ok = await R.revertRecordLine({id: L1, note_id: N1, summary: '파업 지침 공문', attachments: one}, rt, {read});
  assert.equal(ok.ok, true);
  assert.deepEqual(rt.writes[0].rpc, {p_link_id: L1, p_expected_summary: '파업 지침 공문', p_summary: '그림 1장 · 투쟁명령 4호.png'});
  assert.ok(rt.writes[1].path.includes(`source_id=eq.${N1}`) && rt.writes[1].path.includes(`workspace_id=eq.${WS}`));
  const rt2 = fakeRt();
  const no = await R.revertRecordLine({id: L1, note_id: N1, summary: '사람이 쓴 글', attachments: one}, rt2, {read});
  assert.equal(no.ok, false); assert.equal(rt2.writes.length, 0);
});

test('목록 표시: 바꾼 줄에만 line_revert, 읽기 실패면 표시 없이', async () => {
  const rt = fakeRt({docs: [{id: D1, workspace_id: WS, file_id: F1, mime_type: 'image/png'}], index: [{document_id: D1, workspace_id: WS, content_hash: 'b1:' + 'd'.repeat(32), summary: '파업 지침 공문'}]});
  const rows = [{id: L1, summary: '파업 지침 공문', attachments: one}, {id: L2, summary: '그림 1장 · 투쟁명령 4호.png', attachments: one}, {id: 'x', summary: '다른 AI 줄', attachments: one}];
  await B.markLineRevert(rows, rt);
  assert.deepEqual(rows.map(r => !!r.line_revert), [true, false, false]);
  const bad = {context: {read: () => ({workspace: {id: WS}})}, api: async () => { throw new Error('x'); }};
  const rows2 = [{id: L1, summary: '파업 지침 공문', attachments: one}];
  await B.markLineRevert(rows2, bad);
  assert.equal(rows2[0].line_revert, undefined);
});

test('화면 연결: 조직 관리 ⋯ [옛 사진 기록 채우기], 기록 줄 ⋯ [이전 줄로 되돌리기](조직·사업), 자동 실행 없음', () => {
  const so = read('app/suborganizations.js'), links = read('app/basket-link-records.js'), ps3 = read('app/project-system-v3.js'), run = read('app/record-line-backfill.js');
  assert.match(so, /data-so-line-backfill','옛 사진 기록 채우기'/);
  assert.match(links, /data-basket-link-action="line-revert">이전 줄로 되돌리기/);
  assert.match(links, /markLineRevert\(rows,rt\)/);
  assert.match(ps3, /data-ps3-record-action="line-revert">이전 줄로 되돌리기/);
  assert.match(run, /askConfirm\(anchor/);
  // 쓰는 길은 기존 요약 쓰기(옛 줄과 같을 때만)와 owner RLS PATCH뿐, service_role·localStorage 없음
  const code = (run + read('app/record-line-briefs.js')).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /service_role|localStorage|console\.(log|info)/);
});
