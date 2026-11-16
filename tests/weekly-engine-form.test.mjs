// WEEKLY-내양식자유변형 ⑤-2(명진 결정 11/16 "가" — 자동 저장): 바탕 있는 사람의 '내 양식' 옮기기.
// 대조 시험: 자동 저장 전후 결과물이 같다 / 두 번째 열기에 다시 저장하지 않는다 / 바탕 없는 계정·기기 파일로는 저장하지 않는다 /
// 자리가 깨진 양식은 기본값으로 몰래 돌지 않고 한 줄 안내. 실제 조직·사람 이름은 쓰지 않는다(가짜 견본만).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {openHwpx, packHwpx} from '../app/weekly-hwpx/hwpx.mjs';
import {prepareConfirmed, openConfirmed, buildHwpx, startDraft, assembleDraft} from '../app/weekly-hwpx/draft.mjs';
import {makeFakeReport} from '../scripts/weekly-hwpx/fixture.mjs';
import {LEGACY_FORM, LEGACY_PROFILE} from '../app/weekly-hwpx/form-profile.mjs';
import {engineForm, adoptLegacyForm, forgetAdopt, ENGINE_FORM_TEXT} from '../app/weekly-engine-form.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fakeBytes = () => packHwpx(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)), zlib);

// 서버 표(app_weekly_forms) 흉내: 작업공간마다 한 행, 두 번째 처음 넣기는 409(고유 색인). JSON 왕복으로 저장.
function fakeRt({ws = 'ws-1', rows = [], fail = null, failPost = null} = {}) {
  const calls = [];
  const rt = {context: {read: () => ({workspace: {id: ws}})}, calls, async api(path, opts = {}) {
    const method = opts.method ?? 'GET';
    calls.push({path, method});
    if (fail) throw fail;
    if (method === 'GET') return JSON.parse(JSON.stringify(rows));
    if (method === 'POST') {
      if (failPost) throw failPost;
      if (rows.length) throw Object.assign(new Error('duplicate'), {status: 409});
      rows = [{id: 'f1', name: opts.body.name, source_name: opts.body.source_name, form: JSON.parse(JSON.stringify(opts.body.form)), updated_at: 't1'}];
      return JSON.parse(JSON.stringify(rows));
    }
    return [];
  }};
  return rt;
}
const posts = rt => rt.calls.filter(c => c.method === 'POST').length;

async function fileWith(profile) {
  const {team, template} = prepareConfirmed(await openConfirmed(fakeBytes()), {profile});
  return hash(await buildHwpx(template, assembleDraft(startDraft(team, {me: '가짜담당 갑', date: '2000-01-03'})), undefined, {profile}));
}

test('저장된 양식 없음 → 기본 양식, 자동 저장 뒤 다시 열면 저장한 \'내 양식\'으로 돌고 결과물은 바이트까지 같다', async () => {
  forgetAdopt();
  const rt = fakeRt();
  const before = await engineForm(rt);
  assert.equal(before.status, 'none');
  assert.equal(before.profile, LEGACY_PROFILE);
  assert.equal(before.note, '');
  const fileBefore = await fileWith(before.profile);

  assert.deepEqual(await adoptLegacyForm(rt), {status: 'saved', note: ''});
  assert.equal(posts(rt), 1);
  const after = await engineForm(rt);
  assert.equal(after.status, 'own');
  assert.notEqual(after.profile, LEGACY_PROFILE); // 서버에서 다시 읽은 양식으로 만든 profile
  assert.deepEqual(after.profile, LEGACY_PROFILE);
  assert.equal(await fileWith(after.profile), fileBefore);
  // 기본값(아무것도 안 넘김)과도 같다.
  assert.equal(await fileWith(undefined), fileBefore);
});

test('두 번째 열기에는 다시 저장하지 않는다 — 같은 화면에서 두 번 불러도, 다른 기기가 먼저 저장했어도', async () => {
  forgetAdopt();
  const rt = fakeRt();
  const [a, b] = await Promise.all([adoptLegacyForm(rt), adoptLegacyForm(rt)]);
  assert.equal(a.status, 'saved'); assert.equal(b.status, 'saved');
  await adoptLegacyForm(rt);
  assert.equal(posts(rt), 1);
  // 두 번째 열기: 저장된 양식이 있으므로 status 'own' — 부르는 쪽은 옮기지 않는다.
  assert.equal((await engineForm(rt)).status, 'own');

  // 다른 기기가 먼저 저장(409) → 그것을 그대로 둔다.
  forgetAdopt();
  const other = fakeRt({rows: [{id: 'f9', name: '다른 기기', form: LEGACY_FORM, updated_at: 't0'}]});
  assert.deepEqual(await adoptLegacyForm(other), {status: 'exists', note: ''});
  assert.equal(other.calls.filter(c => c.method === 'PATCH').length, 0);
});

test('저장 실패해도 화면은 기본 양식으로 계속, 한 줄 안내 — 다음에 열 때 다시 해 본다', async () => {
  forgetAdopt();
  const rt = fakeRt({failPost: Object.assign(new Error('x'), {status: 500})});
  assert.deepEqual(await adoptLegacyForm(rt), {status: 'failed', note: ENGINE_FORM_TEXT.saveFailed});
  await adoptLegacyForm(rt);
  assert.equal(posts(rt), 2);
  // 표 준비 전(404)은 안내 없이 기본값.
  forgetAdopt();
  assert.deepEqual(await adoptLegacyForm(fakeRt({failPost: Object.assign(new Error('x'), {status: 404})})), {status: 'missing', note: ''});
  assert.deepEqual(await engineForm(fakeRt({fail: Object.assign(new Error('x'), {status: 404})})), {status: 'missing', profile: LEGACY_PROFILE, note: ''});
  // 읽기 실패 → 기본값 + 한 줄 안내(던지지 않음).
  assert.deepEqual(await engineForm(fakeRt({fail: Object.assign(new Error('x'), {status: 500})})), {status: 'readFailed', profile: LEGACY_PROFILE, note: ENGINE_FORM_TEXT.readFailed});
});

test('자리가 깨진 양식은 기본값으로 몰래 돌지 않고 한 줄 안내', async () => {
  const noRole = {v: 1, sections: [{id: 'a', level: 1, title: '가. 지어낸 항목', columns: [], fill: 'blank'}]};
  const r1 = await engineForm(fakeRt({rows: [{id: 'f1', name: 'x', form: noRole, updated_at: 't'}]}));
  assert.deepEqual(r1, {status: 'broken', profile: LEGACY_PROFILE, note: ENGINE_FORM_TEXT.broken});
  // 표 칸 수를 바꾼 양식(엔진이 칸 순서로 읽으므로 못 씀).
  const wide = {...LEGACY_FORM, sections: LEGACY_FORM.sections.map(s => s.role === 'summaryTable' ? {...s, columns: [...s.columns, '덧붙인 칸']} : s)};
  assert.equal((await engineForm(fakeRt({rows: [{id: 'f1', name: 'x', form: wide, updated_at: 't'}]}))).status, 'broken');
});

test('자동 저장은 자료실 바탕을 저장된 양식 없이 연 때만 — 바탕 없는 새 가입자·기기 파일은 저장 안 함(journal-hwpx.js)', () => {
  const src = readFileSync(new URL('../app/journal-hwpx.js', import.meta.url), 'utf8');
  const calls = src.match(/adoptLegacyForm\(/g) ?? [];
  assert.equal(calls.length, 1, '옮기기는 한 곳에서만');
  assert.match(src, /if \(form\.status === 'none' && baseInfo\?\.from === 'library'\) \{\s*const s = state;\s*void adoptLegacyForm\(rt\)/);
  // 바탕을 여는 load() 안에서만(백지 [주간 보고]·양식 올리기 길은 부르지 않음).
  const loadAt = src.indexOf('async function load('), callAt = src.indexOf('adoptLegacyForm(rt)');
  assert.ok(loadAt > 0 && callAt > loadAt && callAt < src.indexOf('async function', loadAt + 10));
  for (const other of ['journal.js', 'weekly-own-draft.js', 'weekly-own-form-edit.js', 'weekly-base.js']) {
    assert.doesNotMatch(readFileSync(new URL(`../app/${other}`, import.meta.url), 'utf8'), /adoptLegacyForm/, other);
  }
  // 같은 profile 이 엔진 호출 모두에 넘어간다(바탕 열기·팀 확정본 참고·개인 확정본 시험·한글 파일 만들기).
  assert.equal((src.match(/prepareConfirmed\([^\n]*\{profile:/g) ?? []).length, 3);
  assert.equal((src.match(/prepareConfirmed\(/g) ?? []).length, 3);
  assert.match(src, /buildHwpx\(state\.template, data, undefined, \{profile:state\.profile\}\)/);
});
