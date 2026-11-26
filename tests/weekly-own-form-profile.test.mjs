// WEEKLY-내양식자유변형 ⑤-1·⑤-3: 한글 파일 엔진의 양식 글자를 '내 양식' 데이터(form-profile.mjs)에서 읽는다. 코드에 기본 양식은 없다(⑤-3a).
// 대조 시험(사용자 조건 11/17 — 결과물이 지난주와 같아야 함): ⑤-3 전 기본 양식과 같은 모양의 지어낸 확정본에서 읽은 양식으로 만든 결과물이
// 고정 양식(⑤-3 전 기본 양식을 그대로 옮겨 적은 tests/fixtures/weekly-own-form-legacy-shape.json)으로 만든 결과물과 바이트(sha256)까지 같다.
// 자유 변형 시험: 제목·표 머리 칸 이름을 바꾼 지어낸 양식도 같은 엔진으로 읽고 만든다. 실제 조직·사람 이름은 쓰지 않는다(가짜 견본만).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {openHwpx, packHwpx, readXml, setXml} from '../app/weekly-hwpx/hwpx.mjs';
import {kids, walk, el} from '../app/weekly-hwpx/xml.mjs';
import {extractBlankTemplate, assertBlank, readPrototypes, PROTO_ORDER, buildReport, readReport, reportWords, findTables,
  prepareConfirmed, openConfirmed, buildHwpx, startDraft, assembleDraft, FIXTURE_FORM, FIXTURE_PROFILE, FIXTURE_TITLES, legacyShapeReport} from './fixtures/weekly-engine.mjs';
import * as engineTemplate from '../app/weekly-hwpx/template.mjs';
import * as engineReport from '../app/weekly-hwpx/report.mjs';
import * as engineDraft from '../app/weekly-hwpx/draft.mjs';
import {makeFakeReport, DEMO_DATA} from '../scripts/weekly-hwpx/fixture.mjs';
import {ROLES, TABLE_ROLES, profileOf} from '../app/weekly-hwpx/form-profile.mjs';
import {readBaseForm} from '../app/hwpx-form-read.mjs';
import {cleanForm, renameSection, renameColumn, setFill, moveSection, FORM_MAX_BYTES, formBytes} from '../app/weekly-own-form-model.mjs';

const sample = () => openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib);
const fake = () => makeFakeReport(sample());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// 서버(app_weekly_forms.form)에 저장했다가 다시 읽은 모양: JSON 왕복 + 화면이 읽을 때 쓰는 cleanForm.
const saved = form => cleanForm(JSON.parse(JSON.stringify(form)));
const LEGACY_FORM = FIXTURE_FORM, LEGACY_PROFILE = FIXTURE_PROFILE; // 아래 자유 변형 시험이 쓰는 '⑤-3 전 기본 양식과 같은 고정 양식'
// 결과물 네 가지(빈 서식·시연 자료 파일·확정본 다시 만들기·앱 흐름의 내 초안 파일) sha256.
async function outputs(src, profile) {
  const blank = extractBlankTemplate(src, {profile});
  const out = {blank: hash(packHwpx(blank, zlib)), demo: hash(packHwpx(buildReport(blank, DEMO_DATA, {profile}).pkg, zlib)),
    self: hash(packHwpx(buildReport(blank, readReport(src, {profile}), {profile}).pkg, zlib))};
  const {team, template} = prepareConfirmed(await openConfirmed(packHwpx(src, zlib)), {profile});
  out.draft = hash(await buildHwpx(template, assembleDraft(startDraft(team, {me: '가짜담당 갑', date: '2000-01-03'})), undefined, {profile}));
  return out;
}
const bodyTexts = pkg => [...walk(readXml(pkg, 'Contents/section0.xml').root)].filter(n => n.name === 'hp:t').map(n => n.children.map(c => c.text ?? '').join(''));

test('엔진은 profile 을 꼭 받는다 — 빠지면 다른 양식으로 몰래 돌지 않고 멈춘다(⑤-3a 기본값 삭제)', async () => {
  const src = fake();
  assert.throws(() => engineTemplate.extractBlankTemplate(src), /profile/);
  assert.throws(() => engineReport.readReport(src), /profile/);
  assert.throws(() => engineReport.buildReport(extractBlankTemplate(src), DEMO_DATA), /profile/);
  assert.throws(() => engineReport.reportWords({}), /profile/);
  assert.throws(() => engineDraft.prepareConfirmed(src), /profile/);
  await assert.rejects(engineDraft.buildHwpx(extractBlankTemplate(src), DEMO_DATA, zlib), /profile/);
  for (const name of ['form-profile.mjs', 'template.mjs', 'report.mjs', 'draft.mjs']) {
    assert.doesNotMatch(readFileSync(new URL(`../app/weekly-hwpx/${name}`, import.meta.url), 'utf8'), /LEGACY_(FORM|PROFILE)|임원 배정 요청|상집 논의 요청/, name);
  }
});

test('고정 양식(⑤-3 전 기본 양식과 같은 모양)은 서버 표에 그대로 저장되는 \'내 양식\' 하나다 — 자리·칸이 왕복에서 빠지지 않는다', () => {
  const back = saved(LEGACY_FORM);
  assert.equal(back.sections.length, ROLES.length);
  assert.deepEqual(back.sections.map(s => s.role), ROLES);
  assert.ok(formBytes(back) < FORM_MAX_BYTES);
  assert.deepEqual(profileOf(back), LEGACY_PROFILE);
  for (const [role, [key, n]] of Object.entries(TABLE_ROLES)) assert.equal(LEGACY_PROFILE.heads[key].length, n, role);
});

test('대조(사용자 조건): 같은 모양의 지어낸 확정본에서 읽은 양식 → 결과물이 고정 양식(⑤-3 전 기본값)으로 만든 것과 sha256까지 같다', async () => {
  const src = legacyShapeReport(sample());
  const read = readBaseForm(src);
  assert.ok(read.form, read.reason);
  const form = saved(read.form); // 저장했다 다시 읽은 모양으로
  const profile = profileOf(form);
  assert.ok(profile);
  // 제목·표 머리 칸 글자는 고정 양식과 같다. 상자 칸 이름은 이 파일에 나온 것만(고정 양식의 부분 집합) — 이 파일의 상자는 똑같이 찾는다.
  assert.deepEqual(profile.titles, LEGACY_PROFILE.titles);
  assert.deepEqual(profile.heads, LEGACY_PROFILE.heads);
  assert.deepEqual(profile.formLabels, LEGACY_PROFILE.formLabels);
  assert.ok(profile.boxLabels.every(l => LEGACY_PROFILE.boxLabels.includes(l)));
  assert.equal(findTables(src, {profile}).boxes.length, findTables(src, {profile: LEGACY_PROFILE}).boxes.length);
  assert.deepEqual(await outputs(src, profile), await outputs(src, LEGACY_PROFILE));
  // 회의 결과 상자의 오른쪽 본문 글·'(1) 회의 이름' 줄은 양식으로 읽지 않는다(칸 이름·항목 이름에 본문 글이 들어가지 않음).
  const all = JSON.stringify(form);
  for (const body of ['가짜 회의 갑', '가짜 회의 을', '가짜 미정', '가짜 세부 내용 문단']) assert.ok(!all.includes(body), body);
});

test('대조: 파일 제목 글이 고정 양식과 다르면(S46-27로 바뀐 요청 절 제목 등) 결과물의 차이는 그 제목 줄이 파일에 적힌 글 그대로인 것뿐이다', async () => {
  const fileTitle = '1) 가짜 참가 요청';
  const src = makeFakeReport(sample(), {titles: {...FIXTURE_TITLES, requestTable: fileTitle}});
  const profile = profileOf(readBaseForm(src).form);
  assert.equal(profile.titles.requestTable, fileTitle);
  const rest = {...profile.titles}; delete rest.requestTable;
  const legacyRest = {...LEGACY_PROFILE.titles}; delete legacyRest.requestTable;
  assert.deepEqual(rest, legacyRest);
  const blank = extractBlankTemplate(src, {profile});
  const mine = buildReport(blank, DEMO_DATA, {profile}).pkg, before = buildReport(blank, DEMO_DATA, {profile: LEGACY_PROFILE}).pkg;
  const a = bodyTexts(mine), b = bodyTexts(before);
  assert.equal(a.length, b.length);
  const diff = a.map((t, i) => [t, b[i]]).filter(([x, y]) => x !== y);
  assert.deepEqual(diff, [[fileTitle, LEGACY_PROFILE.titles.requestTable]]);
  // 빈 서식은 제목 줄을 담지 않으므로 바이트까지 같다.
  assert.equal(hash(packHwpx(blank, zlib)), hash(packHwpx(extractBlankTemplate(src, {profile: LEGACY_PROFILE}), zlib)));
});

test('바탕 파일에서 양식 읽기: 자리 추측이 확실하지 않으면 양식을 내지 않는다(저장하지 않고 한 줄 안내 — 몰래 틀리게 만들지 않음)', () => {
  // 팀 확정본처럼 '3) 논의 요청' 줄이 없는 파일: 그 자리 제목을 알 수 없다.
  assert.deepEqual(readBaseForm(fake()), {reason: 'items'});
  // 큰 항목이 하나 빠진 파일.
  const noBig = makeFakeReport(sample(), {titles: {...FIXTURE_TITLES, orgs: '산하조직 현황'}});
  assert.equal(readBaseForm(noBig).reason, 'groups');
  // 표 칸 수가 엔진과 다른 파일(요약 표 머리 칸 하나를 비움 → 칸 이름 없음).
  const src = legacyShapeReport(sample());
  const sec = readXml(src, 'Contents/section0.xml');
  const sumHead = [...walk(sec.root)].filter(n => n.name === 'hp:tbl').map(t => kids(kids(t, 'hp:tr')[0], 'hp:tc')).find(tcs => tcs.length === 4);
  for (const n of walk(sumHead[3])) if (n.name === 'hp:t') n.children = [];
  setXml(src, 'Contents/section0.xml', sec);
  assert.equal(readBaseForm(src).reason, 'table');
  // 회의 결과 상자가 없는 주의 파일: 양식은 읽되 상자 칸 이름이 비어 있어 저장용 양식이 아니다(profileOf null — 그 자리에서만 씀).
  const data = readReport(legacyShapeReport(sample()));
  const noBox = openHwpx(packHwpx(buildReport(extractBlankTemplate(legacyShapeReport(sample())), {...data, details: []}).pkg, zlib), zlib);
  const read = readBaseForm(noBox);
  assert.ok(read.form, read.reason);
  assert.deepEqual(read.form.sections.find(s => s.role === 'details').columns, []);
  assert.equal(profileOf(read.form), null);
  assert.ok(profileOf(read.form, {allowNoBoxes: true}));
});

test('엔진이 만든 파일(다음 주 바탕)에서도 같은 양식을 다시 읽는다', async () => {
  const src = legacyShapeReport(sample());
  const {team, template} = prepareConfirmed(await openConfirmed(packHwpx(src, zlib)), {profile: LEGACY_PROFILE});
  const out = openHwpx(await buildHwpx(template, {...assembleDraft(startDraft(team, {me: '가짜담당 갑', date: '2000-01-03'})), details: DEMO_DATA.details}, undefined, {profile: LEGACY_PROFILE}), zlib);
  const read = readBaseForm(out);
  assert.ok(read.form, read.reason);
  const profile = profileOf(read.form);
  assert.deepEqual(profile.titles, LEGACY_PROFILE.titles);
  assert.deepEqual(profile.heads, LEGACY_PROFILE.heads);
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
