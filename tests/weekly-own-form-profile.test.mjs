// WEEKLY-내양식자유변형 ⑤-1: 한글 파일 엔진의 양식 글자를 '내 양식' 데이터(form-profile.mjs)에서 읽는다.
// 대조 시험: 지금 경로(기본값)와 '내 양식'(서버에 저장했다 다시 읽은 모양)으로 만든 결과물이 바이트까지 같다.
// 자유 변형 시험: 제목·표 머리 칸 이름을 바꾼 지어낸 양식도 같은 엔진으로 읽고 만든다. 실제 조직·사람 이름은 쓰지 않는다(가짜 견본만).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {openHwpx, packHwpx, readXml, setXml} from '../app/weekly-hwpx/hwpx.mjs';
import {kids, walk, el} from '../app/weekly-hwpx/xml.mjs';
import {extractBlankTemplate, assertBlank, readPrototypes, PROTO_ORDER} from '../app/weekly-hwpx/template.mjs';
import {buildReport, readReport, reportWords} from '../app/weekly-hwpx/report.mjs';
import {prepareConfirmed, openConfirmed, buildHwpx, startDraft, assembleDraft} from '../app/weekly-hwpx/draft.mjs';
import {makeFakeReport, DEMO_DATA} from '../scripts/weekly-hwpx/fixture.mjs';
import {ROLES, TABLE_ROLES, LEGACY_FORM, LEGACY_PROFILE, profileOf} from '../app/weekly-hwpx/form-profile.mjs';
import {cleanForm, renameSection, renameColumn, setFill, moveSection, FORM_MAX_BYTES, formBytes} from '../app/weekly-own-form-model.mjs';

const sample = () => openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib);
const fake = () => makeFakeReport(sample());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// 서버(app_weekly_forms.form)에 저장했다가 다시 읽은 모양: JSON 왕복 + 화면이 읽을 때 쓰는 cleanForm.
const saved = form => cleanForm(JSON.parse(JSON.stringify(form)));

test('지금 양식(옮겨 적은 기본값)은 서버 표에 그대로 저장되는 \'내 양식\' 하나다 — 자리·칸이 왕복에서 빠지지 않는다', () => {
  const back = saved(LEGACY_FORM);
  assert.equal(back.sections.length, ROLES.length);
  assert.deepEqual(back.sections.map(s => s.role), ROLES);
  assert.ok(formBytes(back) < FORM_MAX_BYTES);
  assert.deepEqual(profileOf(back), LEGACY_PROFILE);
  // 표 자리마다 칸 수는 엔진이 읽는 수와 같다.
  for (const [role, [key, n]] of Object.entries(TABLE_ROLES)) assert.equal(LEGACY_PROFILE.heads[key].length, n, role);
});

test('대조: 지금 경로와 \'내 양식\'으로 만든 빈 서식·한글 파일·읽은 내용이 바이트까지 같다', async () => {
  const profile = profileOf(saved(LEGACY_FORM));
  const src = fake();
  const blankNow = extractBlankTemplate(src), blankOwn = extractBlankTemplate(src, {profile});
  assert.equal(hash(packHwpx(blankOwn, zlib)), hash(packHwpx(blankNow, zlib)));
  assert.deepEqual(readReport(src, {profile}), readReport(src));
  for (const data of [DEMO_DATA, readReport(src), {}]) {
    assert.equal(hash(packHwpx(buildReport(blankOwn, data, {profile}).pkg, zlib)), hash(packHwpx(buildReport(blankNow, data).pkg, zlib)));
  }
  // 앱이 쓰는 흐름(확정본 열기 → 내 초안 → 한글 파일)도 같다.
  const bytes = packHwpx(src, zlib);
  const now = prepareConfirmed(await openConfirmed(bytes)), own = prepareConfirmed(await openConfirmed(bytes), {profile});
  const me = '가짜담당 갑';
  const fileNow = await buildHwpx(now.template, assembleDraft(startDraft(now.team, {me, date: '2000-01-03'})));
  const fileOwn = await buildHwpx(own.template, assembleDraft(startDraft(own.team, {me, date: '2000-01-03'})), undefined, {profile});
  assert.equal(hash(fileOwn), hash(fileNow));
  assert.deepEqual(reportWords(own.team, {profile}), reportWords(now.team));
});

// 지어낸 양식: 제목·표 머리 칸·상자 칸 이름을 모두 바꾼 것(자리는 그대로). 양식 고치기는 ③ 화면과 같은 모델 함수로.
function inventedForm() {
  let form = saved(LEGACY_FORM);
  const titles = {requests: 'Ⅰ. 바라는 일', requestTable: '가. 함께 갈 자리', schedule: '나. 큰 일정', discuss: '다. 같이 정할 일', work: 'Ⅱ. 하는 일',
    summaryTable: '가. 한눈에', details: '나. 모임 기록', struggle: 'Ⅲ. 싸우는 일', rallyTable: '가. 모임·행진', siteTable: '나. 싸우는 곳',
    orgs: 'Ⅳ. 우리 단위', orgTable: '가. 단위 소식', orgNotes: '나. 덧붙임', calendar: 'Ⅴ. 다음 주'};
  for (const s of form.sections) form = renameSection(form, s.id, titles[s.role]);
  const heads = {requestTable: ['날', '무엇·어디', '누가'], summaryTable: ['갈래', '할 일', '한 일과 할 일', '맡은 이'], rallyTable: ['때·곳', '모임 이름', '몇 명'],
    siteTable: ['곳', '소식'], orgTable: ['단위', '단위 소식'], calendar: ['날짜', '무엇', '가는 이']};
  for (const [role, names] of Object.entries(heads)) names.forEach((name, i) => { form = renameColumn(form, role, i, name); });
  const box = form.sections.find(s => s.role === 'details');
  form = cleanForm({sections: form.sections.map(s => (s === box ? {...s, columns: ['모임', '때·곳', '온 이', '이야기', '다음']} : s))});
  form = moveSection(form, 'orgs', 0); // 항목 차례를 바꿔도 엔진 자리 차례는 그대로다(엔진이 자리로 쓴다).
  form = setFill(form, 'orgNotes', 'last_week');
  return form;
}
// 기본 양식 견본(가짜 확정본)의 양식 글자를 지어낸 양식 글자로 바꾼 확정본 — 다른 팀이 자기 양식으로 쓴 확정본 흉내.
function inventedConfirmed(profile) {
  const pkg = fake();
  const sec = readXml(pkg, 'Contents/section0.xml');
  const swap = new Map();
  for (const [key, head] of Object.entries(LEGACY_PROFILE.heads)) head.forEach((h, i) => swap.set(`${key}:${h}`, profile.heads[key][i]));
  const boxSwap = new Map(LEGACY_PROFILE.boxLabels.map((label, i) => [label, profile.boxLabels[i % profile.boxLabels.length]]));
  const setCell = (tc, text) => { for (const n of walk(tc)) if (n.name === 'hp:t') n.children = [{text}]; };
  const cellText = tc => [...walk(tc)].filter(n => n.name === 'hp:t').map(n => n.children.map(c => c.text ?? '').join('')).join('').trim();
  for (const tbl of [...walk(sec.root)].filter(n => n.name === 'hp:tbl')) {
    const rows = kids(tbl, 'hp:tr');
    const head = kids(rows[0] ?? el('x'), 'hp:tc').map(cellText);
    const key = Object.keys(LEGACY_PROFILE.heads).find(k => LEGACY_PROFILE.heads[k].join('|') === head.join('|'));
    if (key) { kids(rows[0], 'hp:tc').forEach((tc, i) => setCell(tc, swap.get(`${key}:${head[i]}`))); continue; }
    for (const tr of rows) { const [label] = kids(tr, 'hp:tc'); const t = label && cellText(label); if (t && boxSwap.has(t)) setCell(label, boxSwap.get(t)); }
  }
  setXml(pkg, 'Contents/section0.xml', sec);
  return pkg;
}

test('자유 변형: 제목·표 머리 칸 이름을 바꾼 지어낸 양식도 같은 엔진으로 읽고, 그 글자 그대로 한글 파일을 만든다', async () => {
  const form = saved(inventedForm());
  const profile = profileOf(form);
  assert.ok(profile, '자리가 모두 있고 칸 수가 맞으면 엔진 양식이 된다');
  const src = inventedConfirmed(profile);
  // 기본 양식으로는 이 확정본의 요약 표를 찾지 못한다 — 양식 글자가 코드가 아니라 '내 양식'에서 온다는 확인.
  assert.throws(() => readReport(src), /요약 표/);
  const team = readReport(src, {profile});
  assert.deepEqual(team.summary, readReport(fake()).summary);
  const {team: t2, template} = prepareConfirmed(await openConfirmed(packHwpx(src, zlib)), {profile});
  assert.deepEqual(assertBlank(template, {profile}), []);
  assert.equal(readPrototypes(template, {profile}).sec.root.children.length, PROTO_ORDER.length);
  const out = openHwpx(await buildHwpx(template, assembleDraft(startDraft(t2, {me: '가짜담당 갑', date: '2000-01-03'})), undefined, {profile}), zlib);
  const texts = [...walk(readXml(out, 'Contents/section0.xml').root)].filter(n => n.name === 'hp:t').map(n => n.children.map(c => c.text ?? '').join('')).filter(Boolean);
  for (const title of Object.values(profile.titles)) assert.ok(texts.includes(title), title);
  for (const head of Object.values(profile.heads)) for (const h of head) assert.ok(texts.includes(h), h);
  for (const title of Object.values(LEGACY_PROFILE.titles)) assert.ok(!texts.includes(title), `기본 양식 제목이 남음: ${title}`);
  // 만든 파일이 다음 주 바탕이 되어도 같은 양식으로 다시 읽힌다.
  assert.deepEqual(readReport(out, {profile}).summary.map(a => a.rows.length), team.summary.map(a => a.rows.length));
});

test('profileOf: 자리가 모자라거나 겹치거나, 표 칸 수가 엔진과 다르거나, 제목이 비면 엔진 양식이 아니다(null)', () => {
  const base = saved(LEGACY_FORM);
  const without = role => cleanForm({sections: base.sections.filter(s => s.role !== role)});
  assert.equal(profileOf(without('discuss')), null);
  assert.equal(profileOf(cleanForm({sections: [...base.sections, {...base.sections[0], id: 'twin'}]})), null);
  assert.equal(profileOf(cleanForm({sections: base.sections.map(s => (s.role === 'summaryTable' ? {...s, columns: [...s.columns, '덧붙인 칸']} : s))})), null);
  assert.equal(profileOf(cleanForm({sections: base.sections.map(s => (s.role === 'details' ? {...s, columns: []} : s))})), null);
  assert.equal(profileOf({sections: base.sections.map(s => (s.role === 'work' ? {...s, title: ' '} : s))}), null);
  assert.equal(profileOf(null), null);
  assert.equal(profileOf(cleanForm({sections: [{title: '자리 없는 항목', columns: ['가', '나']}]})), null);
});

test('내 양식 모델: 자리(role)는 열쇠 모양만 받고, 고치기(이름·칸·채울 기록·차례)에서 그대로 따라간다', () => {
  const one = cleanForm({sections: [{title: '가', role: 'summaryTable'}, {title: '나', role: '<b>x</b>'}, {title: '다', role: 7}]}).sections;
  assert.equal(one[0].role, 'summaryTable');
  assert.equal('role' in one[1], false);
  assert.equal('role' in one[2], false);
  let form = saved(LEGACY_FORM);
  form = renameSection(form, 'work', '새 이름');
  form = setFill(form, 'work', 'biz');
  form = moveSection(form, 'calendar', 0);
  assert.deepEqual([...form.sections.map(s => s.role)].sort(), [...ROLES].sort());
  assert.equal(form.sections.find(s => s.id === 'work').role, 'work');
  assert.equal(profileOf(form).titles.work, '새 이름');
});
