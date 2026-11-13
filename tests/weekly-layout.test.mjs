import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {makeFakeReport} from '../scripts/weekly-hwpx/fixture.mjs';
import {openHwpx, packHwpx} from '../app/weekly-hwpx/hwpx.mjs';
import {prepareConfirmed, openConfirmed, startDraft, editableRows, assembleDraft, buildHwpx} from '../app/weekly-hwpx/draft.mjs';
import {sectionXmlText, weeklyLines} from '../app/weekly-lines.mjs';
import {sectionXmlParas, layoutStats, layoutDiff, readLayout, layoutHabit, bulletOf, gapStyle, mainBullet, LAYOUT_MAX_PARAS, LAYOUT_MAX_BYTES} from '../app/weekly-layout.mjs';

// WEEKLY-자동화 ②: Web2 판 ↔ 고친 판 모양 비교. 글은 모두 지어낸 것(가 지부·나 사업장·가짜 영역). 개인정보·업무 내용 없음.
const p = t => `<hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`;
const emptyP = '<hp:p><hp:run/></hp:p>';
const xmlOf = lines => `<hs:sec>${lines.map(t => (t === '' ? emptyP : p(t))).join('')}</hs:sec>`;

const ISSUED = [
  '주간 업무 보고', '2026.10.26.',
  '2. 기본․영역․의제 사업', '1) 요약', '사업영역', '세부 과제',
  '- 가상 과제 하나 진행', '- 가상 과제 둘 준비', '- 가상 과제 셋 마무리',
  '4. 산하조직 현황', '1) 요약', '사업장', '조직현황',
  '가 지부', '- 위원회 구성 논의', '나 사업장', '- 교섭 일정 조율',
  '5. 주요 일정', '', '', '10/30 일정 표 줄은 세지 않음',
];
// 명진이 한글에서 고친 판(예시): 2절은 줄 사이를 띄우고 줄머리를 ○로, 4절은 제목 뒤 빈 줄 + 조직 사이 빈 줄.
const FINAL = [
  '주간 업무 보고', '2026.10.26.',
  '2. 기본․영역․의제 사업', '1) 요약', '사업영역', '세부 과제',
  '○ 가상 과제 하나 진행', '', '○ 가상 과제 둘 준비', '', '○ 가상 과제 셋 마무리',
  '4. 산하조직 현황', '', '1) 요약', '', '사업장', '조직현황',
  '가 지부', '- 위원회 구성 논의', '', '나 사업장', '- 교섭 일정 조율',
  '5. 주요 일정', '', '10/30 일정 표 줄은 세지 않음',
];

test('공용 사본: app/weekly-layout.mjs 와 _shared 사본이 바이트까지 같다(weekly-lines.mjs 도)', () => {
  for (const name of ['weekly-layout.mjs', 'weekly-lines.mjs']) {
    assert.equal(readFileSync(new URL(`../app/${name}`, import.meta.url), 'utf8'), readFileSync(new URL(`../supabase/functions/_shared/${name}`, import.meta.url), 'utf8'), name);
  }
});

test('문단 읽기: 빈 문단·앞 공백을 남긴다. 글자만 보면 sectionXmlText 와 같다', () => {
  const xml = `<hs:sec>${p('첫 줄')}${emptyP}${p('  들여 쓴 줄')}${p('A &amp; B')}</hs:sec>`;
  assert.deepEqual(sectionXmlParas(xml), ['첫 줄', '', '  들여 쓴 줄', 'A & B']);
  assert.equal(sectionXmlParas(xml).filter(l => l.trim()).join('\n'), sectionXmlText(xml));
  const many = `<hs:sec>${emptyP.repeat(LAYOUT_MAX_PARAS + 10)}</hs:sec>`;
  assert.equal(sectionXmlParas(many).length, LAYOUT_MAX_PARAS);
  assert.deepEqual(sectionXmlParas(''), []);
});

test('줄머리 기호와 빈 줄 꼴', () => {
  assert.equal(bulletOf('- 가'), 'dash');
  assert.equal(bulletOf('○ 가'), 'circle');
  assert.equal(bulletOf('· 가'), 'dot');
  assert.equal(bulletOf('※ 가'), 'note');
  assert.equal(bulletOf('1) 가'), 'number');
  assert.equal(bulletOf('가 지부'), 'none');
  assert.equal(gapStyle({gaps: 0, blank_gaps: 0}), null);
  assert.equal(gapStyle({gaps: 4, blank_gaps: 0}), 'tight');
  assert.equal(gapStyle({gaps: 4, blank_gaps: 3}), 'blank');
  assert.equal(gapStyle({gaps: 4, blank_gaps: 2}), 'mixed');
  assert.equal(mainBullet({dash: 2, circle: 2}), 'dash');
  assert.equal(mainBullet({}), null);
});

test('절마다 모양 숫자: 큰 제목 앞·5절·표 머리 칸 이름은 세지 않는다. 글 줄 수는 weeklyLines 와 같다', () => {
  const paras = sectionXmlParas(xmlOf(FINAL));
  const st = layoutStats(paras);
  assert.deepEqual(Object.keys(st), ['work', 'orgs']);
  assert.equal(st.work.lines, 3);
  assert.equal(st.work.gaps, 2);
  assert.equal(st.work.blank_gaps, 2);
  assert.deepEqual(st.work.bullets, {circle: 3});
  assert.equal(st.orgs.headings, 2);
  assert.equal(st.orgs.heading_blank, 2);
  assert.equal(st.orgs.blank_gaps, 1);
  const counted = Object.values(st).reduce((n, s) => n + s.lines, 0);
  assert.equal(counted, weeklyLines(sectionXmlText(xmlOf(FINAL))).length);
});

test('Web2 판 ↔ 고친 판: 바뀐 모양만 changed 에, 글은 담지 않는다', () => {
  const layout = layoutDiff(sectionXmlParas(xmlOf(ISSUED)), sectionXmlParas(xmlOf(FINAL)));
  assert.deepEqual(layout.sections.work.before, {gap: 'tight', heading: 'tight', bullet: 'dash', indent: 'flat'});
  assert.deepEqual(layout.sections.work.after, {gap: 'blank', heading: 'tight', bullet: 'circle', indent: 'flat'});
  assert.deepEqual(layout.sections.work.changed, ['gap', 'bullet']);
  assert.deepEqual(layout.sections.orgs.changed, ['gap', 'heading']);
  const json = JSON.stringify(layout);
  for (const word of ['가상', '지부', '사업장', '위원회', '교섭']) assert.ok(!json.includes(word), word);
  assert.ok(new TextEncoder().encode(json).length <= LAYOUT_MAX_BYTES);
  // 같은 판끼리는 바뀐 것 없음, 견줄 절이 없으면 null
  assert.deepEqual(layoutDiff(sectionXmlParas(xmlOf(ISSUED)), sectionXmlParas(xmlOf(ISSUED))).sections.work.changed, []);
  assert.equal(layoutDiff([], sectionXmlParas(xmlOf(FINAL))), null);
});

test('저장 모양 검사: 모르는 절·값은 버리고 changed 는 다시 계산한다', () => {
  assert.equal(readLayout(null), null);
  assert.equal(readLayout({v: 2, sections: {}}), null);
  assert.equal(readLayout({v: 1, sections: {nope: {before: {}, after: {}}}}), null);
  const got = readLayout({v: 1, sections: {work: {before: {gap: 'tight', bullet: '<script>'}, after: {gap: 'blank', extra: 'x'}, changed: ['indent']}}});
  assert.deepEqual(got.sections.work, {before: {gap: 'tight', heading: null, bullet: null, indent: null}, after: {gap: 'blank', heading: null, bullet: null, indent: null}, changed: ['gap']});
});

test('습관: 같은 모양이 2주 넘게 되풀이된 항목만, 동률이면 따르지 않는다', () => {
  const week = (gap, bullet) => ({v: 1, sections: {work: {before: {gap: 'tight', bullet: 'dash'}, after: {gap, bullet}}}});
  assert.deepEqual(layoutHabit([week('blank', 'circle'), week('blank', 'dash')]), {work: {gap: 'blank'}});
  assert.deepEqual(layoutHabit([week('blank', 'circle'), week('blank', 'circle'), week('tight', 'dash')]), {work: {gap: 'blank', bullet: 'circle'}});
  assert.deepEqual(layoutHabit([week('blank', 'circle'), week('tight', 'dash')]), {});
  assert.deepEqual(layoutHabit([week('blank', 'circle'), week('blank', 'dash'), week('tight', 'dash'), week('tight', 'circle')]), {});
  assert.deepEqual(layoutHabit([]), {});
  assert.deepEqual(layoutHabit('nope'), {});
});

// 앱이 실제로 만드는 .hwpx(예시 양식, 지어낸 글) → 문단 읽기 → 같은 판끼리 견주면 바뀐 모양 없음.
const fakeBytes = () => packHwpx(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)), zlib);
test('앱이 만든 .hwpx 에서 문단을 읽어 모양을 센다', async () => {
  const {team, template} = prepareConfirmed(await openConfirmed(fakeBytes()));
  const base = startDraft(team, {me: '가짜담당 갑', myOrgs: ['가짜조직 갑'], date: '2026년 1월 5일(월)'});
  const rows = editableRows(base, '가짜담당 갑');
  const bytes = await buildHwpx(template, assembleDraft(base, {summary: new Map([[rows[0].index, ['- 가짜 진행 하나 완료', '- 새로 쓴 가짜 줄']]])}));
  const pkg = openHwpx(bytes, zlib), dec = new TextDecoder();
  const xmls = pkg.order.filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort().map(n => dec.decode(pkg.files.get(n)));
  const paras = xmls.flatMap(sectionXmlParas);
  assert.ok(paras.length > 0);
  const st = layoutStats(paras);
  assert.ok(st.work?.lines > 0);
  const layout = layoutDiff(paras, paras);
  for (const s of Object.values(layout.sections)) assert.deepEqual(s.changed, []);
});
