// WEEKLY-내양식자유변형 ⑤-2·⑤-3(사용자 결정 11/17 '나'): 쓸 '내 양식'이 없으면 바탕 파일에서 양식을 읽어 '내 양식'에 저장하고 그것으로 연다.
// 대조 시험: 저장 전후 결과물이 같다 / 두 번째 열기에 다시 저장하지 않는다 / 기기 파일로는 저장하지 않는다 / 읽기 실패는 기본값 대신
// 한 줄 + [다시 시도] / 바탕에서 양식을 읽지 못하면 추측해 열지 않는다. 실제 조직·사람 이름은 쓰지 않는다(가짜 견본만).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {openHwpx, packHwpx} from '../app/weekly-hwpx/hwpx.mjs';
import * as draft from '../app/weekly-hwpx/draft.mjs';
import {makeFakeReport} from '../scripts/weekly-hwpx/fixture.mjs';
import {FIXTURE_FORM, FIXTURE_PROFILE, legacyShapeReport} from './fixtures/weekly-engine.mjs';
import {engineForm, baseForm, saveBaseForm, forgetSaved, ENGINE_FORM_TEXT} from '../app/weekly-engine-form.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sample = () => openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib);
const openBase = async (pkg = legacyShapeReport(sample())) => draft.openConfirmed(packHwpx(pkg, zlib));

// 서버 표(app_weekly_forms) 흉내: 작업공간마다 한 행, 두 번째 처음 넣기는 409(고유 색인). JSON 왕복으로 저장. PATCH 는 updated_at 가 맞을 때만.
function fakeRt({ws = 'ws-1', rows = [], fail = null, failPost = null} = {}) {
  const calls = [];
  const rt = {context: {read: () => ({workspace: {id: ws}})}, calls, get rows() { return rows; }, async api(path, opts = {}) {
    const method = opts.method ?? 'GET';
    calls.push({path, method, body: opts.body});
    if (fail) throw fail;
    if (method === 'GET') return JSON.parse(JSON.stringify(rows));
    if (failPost) throw failPost;
    if (method === 'POST') {
      if (rows.length) throw Object.assign(new Error('duplicate'), {status: 409});
      rows = [{id: 'f1', name: opts.body.name, source_name: opts.body.source_name, form: JSON.parse(JSON.stringify(opts.body.form)), updated_at: 't1'}];
      return JSON.parse(JSON.stringify(rows));
    }
    if (method === 'PATCH') {
      if (!rows.length || !path.includes(`updated_at=eq.${rows[0].updated_at}`)) return [];
      rows = [{...rows[0], ...opts.body, form: JSON.parse(JSON.stringify(opts.body.form)), updated_at: 't2'}];
      return JSON.parse(JSON.stringify(rows));
    }
    return [];
  }};
  return rt;
}
const writes = rt => rt.calls.filter(c => c.method !== 'GET').length;

async function fileWith(profile) {
  const {team, template} = draft.prepareConfirmed(await openBase(), {profile});
  return hash(await draft.buildHwpx(template, draft.assembleDraft(draft.startDraft(team, {me: '가짜담당 갑', date: '2000-01-03'})), undefined, {profile}));
}

test('저장된 양식 없음 → 바탕 파일에서 읽은 양식으로 열고 저장, 다시 열면 저장한 \'내 양식\'으로 돌고 결과물은 바이트까지 같다', async () => {
  forgetSaved();
  const rt = fakeRt();
  const before = await engineForm(rt);
  assert.deepEqual(before, {status: 'none', profile: null, row: null, note: ''});
  const read = baseForm(await openBase(), draft);
  assert.ok(read.profile && read.savable);
  assert.ok(read.prepared.team && read.prepared.template, '읽은 양식으로 바탕을 실제로 열어 봄');
  assert.deepEqual(await saveBaseForm({form: read.form}, rt), {status: 'saved', note: ''});
  const after = await engineForm(rt);
  assert.equal(after.status, 'own');
  assert.deepEqual(after.profile, read.profile);
  // 결과물: 바탕에서 읽어 저장한 양식 = 고정 양식(⑤-3 전 기본값)과 sha256까지 같다.
  assert.equal(await fileWith(after.profile), await fileWith(FIXTURE_PROFILE));
});

test('같은 작업공간에서 두 번 열어도 한 번만 저장하고, 다른 기기가 먼저 저장했으면 그대로 둔다', async () => {
  forgetSaved();
  const rt = fakeRt();
  const {form} = baseForm(await openBase(), draft);
  const [a, b] = await Promise.all([saveBaseForm({form}, rt), saveBaseForm({form}, rt)]);
  assert.deepEqual([a, b], [{status: 'saved', note: ''}, {status: 'saved', note: ''}]);
  await saveBaseForm({form}, rt);
  assert.equal(writes(rt), 1);
  forgetSaved();
  const other = fakeRt({rows: [{id: 'f0', name: '먼저 저장', form: FIXTURE_FORM, updated_at: 't0'}]});
  assert.deepEqual(await saveBaseForm({form}, other), {status: 'exists', note: ''});
  assert.equal(other.rows[0].name, '먼저 저장');
});

test('자리가 깨진 양식(broken)은 바탕에서 읽은 양식으로 그 행을 고친다(이름·원본 이름은 그대로)', async () => {
  forgetSaved();
  const noRole = {v: 1, sections: [{id: 'a', level: 1, title: '가. 지어낸 항목', columns: [], fill: 'blank'}]};
  const rt = fakeRt({rows: [{id: 'f1', name: '내 것', source_name: '가짜.hwpx', form: noRole, updated_at: 't'}]});
  const got = await engineForm(rt);
  assert.equal(got.status, 'broken');
  assert.equal(got.profile, null);
  assert.equal(got.note, '', '바탕에서 읽어 열므로 기본값 안내 없음');
  const {form} = baseForm(await openBase(), draft);
  assert.deepEqual(await saveBaseForm({form, known: got.row}, rt), {status: 'saved', note: ''});
  assert.equal(rt.calls.filter(c => c.method === 'PATCH').length, 1);
  assert.equal(rt.rows[0].name, '내 것');
  assert.equal(rt.rows[0].source_name, '가짜.hwpx');
  assert.equal((await engineForm(rt)).status, 'own');
  // 표 칸 수를 바꾼 양식도 깨진 양식.
  const wide = {...FIXTURE_FORM, sections: FIXTURE_FORM.sections.map(s => s.role === 'summaryTable' ? {...s, columns: [...s.columns, '덧붙인 칸']} : s)};
  assert.equal((await engineForm(fakeRt({rows: [{id: 'f1', name: 'x', form: wide, updated_at: 't'}]}))).status, 'broken');
});

test('읽기 실패는 기본값 대신 한 줄(부르는 쪽이 [다시 시도]), 표 준비 전은 안내 없이 바탕에서 읽기, 저장 실패는 한 줄 + 다음에 다시', async () => {
  forgetSaved();
  assert.deepEqual(await engineForm(fakeRt({fail: Object.assign(new Error('x'), {status: 500})})), {status: 'readFailed', profile: null, row: null, note: ENGINE_FORM_TEXT.readFailed});
  assert.deepEqual(await engineForm(fakeRt({fail: Object.assign(new Error('x'), {status: 404})})), {status: 'missing', profile: null, row: null, note: ''});
  const {form} = baseForm(await openBase(), draft);
  const rt = fakeRt({failPost: Object.assign(new Error('x'), {status: 500})});
  assert.deepEqual(await saveBaseForm({form}, rt), {status: 'failed', note: ENGINE_FORM_TEXT.saveFailed});
  await saveBaseForm({form}, rt);
  assert.equal(rt.calls.filter(c => c.method === 'POST').length, 2, '실패하면 다음에 다시');
  assert.deepEqual(await saveBaseForm({form}, fakeRt({ws: 'ws-2', failPost: Object.assign(new Error('x'), {status: 404})})), {status: 'missing', note: ''});
});

test('바탕에서 양식을 읽지 못하면(자리 추측이 확실하지 않음) 추측해 열지 않고 한 줄 — 상자 없는 주는 열되 저장하지 않음', async () => {
  // 팀 확정본처럼 '3) 논의 요청' 줄이 없는 파일.
  const bad = baseForm(await openBase(makeFakeReport(sample())), draft);
  assert.equal(bad.profile, undefined);
  assert.equal(bad.note, ENGINE_FORM_TEXT.baseFailed);
  // 회의 결과 상자가 없는 주의 바탕: 열 수는 있지만 상자 칸 이름을 몰라 저장하지 않는다.
  const blankBase = draft.prepareConfirmed(await openBase(), {profile: FIXTURE_PROFILE});
  const noBox = openHwpx(await draft.buildHwpx(blankBase.template, {...draft.assembleDraft(draft.startDraft(blankBase.team, {me: '가짜담당 갑', date: '2000-01-03'})), details: []}, undefined, {profile: FIXTURE_PROFILE}), zlib);
  const read = baseForm(noBox, draft);
  assert.ok(read.profile);
  assert.equal(read.savable, false);
});

test('journal-hwpx.js: 쓸 양식이 없을 때만 바탕에서 읽고, 자료실 바탕일 때만 저장, 읽기 실패는 [다시 시도] — 기본값 길 없음', () => {
  const src = readFileSync(new URL('../app/journal-hwpx.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /adoptLegacyForm|LEGACY_/);
  assert.equal((src.match(/saveBaseForm\(/g) ?? []).length, 1, '저장은 한 곳에서만');
  assert.match(src, /if \(fromBase\?\.savable && baseInfo\?\.from === 'library' && \(form\.status === 'none' \|\| form\.status === 'broken'\)\) \{\s*const s = state;\s*void saveBaseForm\(/);
  assert.match(src, /if \(form\.status === 'readFailed'\) \{ sayRetry\(form\.note,/);
  assert.match(src, /const fromBase = form\.profile \? null : baseForm\(pkg, draft\);\s*if \(fromBase && !fromBase\.profile\) \{ say\(fromBase\.note, 'error'\); return; \}/);
  // 바탕을 여는 load() 안에서만(백지 [주간 보고]·양식 올리기 길은 부르지 않음).
  const loadAt = src.indexOf('async function load('), callAt = src.indexOf('saveBaseForm({');
  assert.ok(loadAt > 0 && callAt > loadAt && callAt < src.indexOf('async function', loadAt + 10));
  for (const other of ['journal.js', 'weekly-own-draft.js', 'weekly-own-form-edit.js', 'weekly-base.js']) {
    assert.doesNotMatch(readFileSync(new URL(`../app/${other}`, import.meta.url), 'utf8'), /saveBaseForm|adoptLegacyForm/, other);
  }
  // 같은 profile 이 엔진 호출 모두에 넘어간다(바탕 열기·팀 확정본 참고·개인 확정본 시험·한글 파일 만들기).
  assert.equal((src.match(/prepareConfirmed\([^\n]*\{profile/g) ?? []).length, 3);
  assert.equal((src.match(/prepareConfirmed\(/g) ?? []).length, 3);
  assert.match(src, /buildHwpx(?:Report)?\(state\.template, data, undefined, \{profile:state\.profile\}\)/); // S67-29: 붙인 문서 결과도 받는 buildHwpxReport
  assert.match(src, /\[data-hwpx-form-retry\]/);
});
