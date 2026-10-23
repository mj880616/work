import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {makeFakeReport} from '../scripts/weekly-hwpx/fixture.mjs';
import {openHwpx, packHwpx, readXml, setXml, validateHwpx} from '../app/weekly-hwpx/hwpx.mjs';
import {writeZipAsync, readZipAsync, readZip, writeZip} from '../app/weekly-hwpx/zip.mjs';
import {clone, kid, kids, walk, el} from '../app/weekly-hwpx/xml.mjs';
import {readReport, findTables, lineText, isChanged, CHANGED_COLOR} from '../app/weekly-hwpx/report.mjs';
import {browserZlib, prepareConfirmed, openConfirmed, startDraft, editableRows, editableOrgs, weekMaterial, assembleDraft,
  buildHwpx, changedCount, reportDate, fileNameFor, orgNames, candidateLine, resolveMe} from '../app/weekly-hwpx/draft.mjs';
import {ownerNotation} from '../app/weekly-hwpx/delta.mjs';
import {selectMyOrganizations} from '../app/my-organizations.js';

// WEEKLY-한글초안 2단계: 업무일지 [주간 정리]에서 쓰는 브라우저 쪽 흐름(app/weekly-hwpx/draft.mjs). 가짜 내용만 쓴다.
const fakeBytes = () => packHwpx(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)), zlib);
const ME = '가짜담당 갑';
const ORGS = [{id: 'o1', name: '가짜조직 갑', active: true}, {id: 'o2', name: '가짜조직 을', active: true}, {id: 'o3', name: '가짜 조직병', aliases: [], active: true}];

test('브라우저 압축(CompressionStream)으로 묶고 연 .hwpx가 Node 압축과 같은 내용이고 규격 검사를 통과한다', async () => {
  const entries = [{name: 'mimetype', data: 'application/hwp+zip', store: true}, {name: 'a.xml', data: '<a>가나다</a>'.repeat(40)}];
  const bytes = await writeZipAsync(entries, browserZlib);
  assert.deepEqual(readZip(bytes, zlib).map(e => [e.name, e.method]), [['mimetype', 0], ['a.xml', 8]]);
  const back = await readZipAsync(writeZip(entries, zlib), browserZlib);
  assert.equal(new TextDecoder().decode(back[1].data), '<a>가나다</a>'.repeat(40));
  const pkg = await openConfirmed(fakeBytes());
  assert.equal(pkg.order[0], 'mimetype');
});

test('확정본 → 내 칸 바탕: 내 담당 줄만, 요청 표는 비움(그 주 요청 줄로 채움), 내 담당 조직(my-organizations.js) 줄만', async () => {
  const {team, template} = prepareConfirmed(await openConfirmed(fakeBytes()));
  assert.equal(team.title, '가짜팀 주간보고(시험용)');
  const mine = selectMyOrganizations(ORGS, [{organization_id: 'o1'}, {organization_id: 'o3'}]);
  const base = startDraft(team, {me: ME, myOrgs: orgNames(mine.organizations), date: reportDate('2026-01-05')});
  assert.equal(base.date, '2026년 1월 5일(월)');
  assert.equal(base.title, team.title);
  assert.deepEqual([base.requests, base.requestNote], [[], undefined]);
  assert.deepEqual(base.orgs.map(o => o.org), [['가짜조직 갑'], ['가짜조직 병']]); // 별칭·띄어쓰기 무시
  const rows = editableRows(base, ME);
  assert.deepEqual(rows.map(r => r.task), ['가짜과제 하나', '가짜과제 둘', '가짜과제 셋']);
  assert.deepEqual(rows[0].lines, ['- 가짜 진행 하나 완료', '- 가짜 계획 하나 예정']);
  // 남의 줄(가짜과제 둘 첫 줄 = 담당 을)은 비어 있고 고칠 줄에 없다
  assert.equal(rows.find(r => r.task === '가짜과제 둘').lines[0], '- 가짜 진행 둘의 두 번째 줄');
  assert.ok(template);
  // 담당 사업장이 없으면 모든 활성 조직(fallback) — 화면이 그렇게 알린다
  assert.equal(selectMyOrganizations(ORGS, []).fallback, true);
});

test('고친 줄만 파란 글씨, 바탕 그대로인 줄은 검은 글씨. 만든 파일은 규격 검사 통과·다시 읽으면 내 줄이 그대로', async () => {
  const {team, template} = prepareConfirmed(await openConfirmed(fakeBytes()));
  const base = startDraft(team, {me: ME, myOrgs: ['가짜조직 갑'], date: '2026년 1월 5일(월)'});
  const rows = editableRows(base, ME), orgs = editableOrgs(base);
  const edits = {
    summary: new Map([[rows[0].index, ['- 가짜 진행 하나 완료', '- 가짜 계획 하나 바뀜', '', '- 가짜 새 줄  ']]]),
    orgs: new Map([[orgs[0].index, ['- 가짜 소식 갑', '- 가짜 소식 갑 더함']]]),
  };
  const data = assembleDraft(base, edits);
  assert.equal(changedCount(data), 3);
  const bytes = await buildHwpx(template, data);
  assert.deepEqual(validateHwpx(bytes, zlib).errors, []);
  const pkg = openHwpx(bytes, zlib);
  const back = readReport(pkg);
  assert.deepEqual(back.summary[0].rows[0].progress, ['- 가짜 진행 하나 완료', '- 가짜 계획 하나 바뀜', '- 가짜 새 줄']);
  assert.deepEqual(back.summary[0].rows[1].progress, []); // 남의 줄은 빈칸
  assert.deepEqual(back.orgs.map(o => o.org), [['가짜조직 갑']]);
  assert.deepEqual(back.requests, []); // 요청 표는 그 주 요청 줄로만 채운다(여기서는 넣지 않음)
  // 파란 글씨: 양식 안의 바뀐 글 글자 모양만, 바탕 그대로인 줄은 표 칸 글자 모양
  const header = readXml(pkg, 'Contents/header.xml');
  const blue = new Set([...walk(header.root)].filter(n => n.name === 'hh:charPr' && n.attrs.textColor?.toUpperCase() === CHANGED_COLOR).map(n => n.attrs.id));
  const runOf = text => [...walk(readXml(pkg, 'Contents/section0.xml').root)].find(n => n.name === 'hp:run' && kids(n, 'hp:t').some(t => t.children[0]?.text === text));
  assert.ok(blue.has(runOf('- 가짜 계획 하나 바뀜').attrs.charPrIDRef));
  assert.ok(blue.has(runOf('- 가짜 소식 갑 더함').attrs.charPrIDRef));
  assert.ok(!blue.has(runOf('- 가짜 진행 하나 완료').attrs.charPrIDRef));
  // 머리(header.xml)는 빈 서식과 한 글자도 다르지 않다(새 글자 모양·테두리를 만들지 않음)
  assert.deepEqual(pkg.files.get('Contents/header.xml'), template.files.get('Contents/header.xml'));
  assert.equal(fileNameFor('2026-01-05'), '주간보고_20260105.hwpx');
});

test('요약 표가 없는 파일은 멈추고, 아무것도 만들지 않는다', async () => {
  const pkg = await openConfirmed(new Uint8Array(readFileSync(SAMPLE)));
  assert.throws(() => prepareConfirmed(pkg), e => e.code === 'no_summary');
});

test('이번 주 기록을 이름이 같은 내 줄 옆에, 안 맞는 기록은 따로(사람이 줄을 고름)', async () => {
  const {team} = prepareConfirmed(await openConfirmed(fakeBytes()));
  const base = startDraft(team, {me: ME, myOrgs: ['가짜조직 갑'], date: ''});
  const rows = editableRows(base, ME), orgs = editableOrgs(base);
  const model = {
    summary: {areas: [
      {name: '가짜영역갑', rows: [
        {task: {name: '가짜과제  하나'}, items: [{day: '2026-01-05', text: '가짜 기록 하나', label: '가짜과제 하나', issue: false}]},
        {task: {name: '가짜과제 하나'}, items: [{day: '2026-01-06', text: '가짜 사안 기록', label: '가짜과제 하나 › 가짜 사안', issue: true}]},
        {task: null, items: [{day: '2026-01-06', text: '가짜 영역 기록', label: '', issue: false}]},
        {task: {name: '없는 과제'}, items: [{day: '2026-01-07', text: '가짜 짝 없음', label: '없는 과제', issue: false}]},
      ]},
    ], others: [{name: '보관된 가짜 프로젝트', items: [{day: '2026-01-08', text: '가짜 밖 기록'}]}]},
    orgs: {sections: [{name: '가짜 조직갑', items: [{day: '2026-01-05', text: '가짜 조직 소식'}]}, {name: '가짜조직 무', items: [{day: '2026-01-05', text: '가짜 남 소식'}]}]},
  };
  const m = weekMaterial(model, rows, orgs);
  assert.deepEqual(m.byRow.get(rows[0].index).map(l => l.text), ['- 가짜 기록 하나', '- 가짜 사안: 가짜 사안 기록', '- 가짜 영역 기록']);
  assert.deepEqual(m.unmatched.map(l => l.text), ['- 가짜 짝 없음', '- 가짜 밖 기록']);
  assert.deepEqual(m.byOrg.get(orgs[0].index).map(l => l.text), ['- 가짜 조직 소식']);
  assert.deepEqual(m.orgUnmatched.map(l => l.from), ['가짜조직 무']);
  assert.equal(candidateLine({text: 'x'}), '- x');
});

// 확정본 산하조직 표는 줄마다 테두리가 다르다(조직 묶음 사이 굵은 선, 같은 조직 이어지는 줄은 위 선 없음, 바깥 왼쪽·오른쪽 굵은 선).
// 개인본은 확정본 줄의 테두리를 그대로 쓰고, 위 줄이 빠져 위 선이 없어진 줄만 양식 안의 "위 선 있는" 같은 테두리로 바꾼다.
test('산하조직 표 줄별 테두리: 확정본 줄 테두리를 따르고, 빠진 줄 아래의 "위 선 없음"은 양식 안의 테두리로 닫는다', async () => {
  const pkg = openHwpx(fakeBytes(), zlib);
  const header = readXml(pkg, 'Contents/header.xml');
  const fills = [...walk(header.root)].find(n => n.name === 'hh:borderFills');
  const four = kids(fills, 'hh:borderFill').find(b => b.attrs.id === '4');
  const noTop = clone(four); noTop.attrs.id = '6'; kid(noTop, 'hh:topBorder').attrs = {type: 'NONE', width: '0.1 mm', color: '#000000'};
  const thick = clone(four); thick.attrs.id = '7'; kid(thick, 'hh:topBorder').attrs = {type: 'SOLID', width: '0.15 mm', color: '#000000'};
  fills.children.push(noTop, thick); fills.attrs.itemCnt = String(kids(fills, 'hh:borderFill').length);
  setXml(pkg, 'Contents/header.xml', header);
  const sec = readXml(pkg, 'Contents/section0.xml');
  const orgTable = [...walk(sec.root)].filter(n => n.name === 'hp:tbl').find(t => kids(kids(t, 'hp:tr')[0], 'hp:tc').map(tc => [...walk(tc)].filter(n => n.name === 'hp:t').map(n => n.children[0]?.text).join('')).join('|') === '사업장|조직현황');
  const [, gap, eul, byeong] = kids(orgTable, 'hp:tr');
  for (const tc of kids(eul, 'hp:tc')) tc.attrs.borderFillIDRef = '7';
  for (const tc of kids(byeong, 'hp:tc')) tc.attrs.borderFillIDRef = '6';
  assert.ok(gap);
  setXml(pkg, 'Contents/section0.xml', sec);
  const bytes = packHwpx(pkg, zlib);
  const borderOf = async myOrgs => {
    const {team, template} = prepareConfirmed(await openConfirmed(bytes));
    const out = openHwpx(await buildHwpx(template, startDraft(team, {me: ME, myOrgs, date: ''})), zlib);
    const t = findTables(out).org;
    return t.rows.map(r => r.map(c => c.border));
  };
  // 갑·병: 을이 빠져 병 위 선이 없어짐 → 위 선만 다른 양식 테두리(4)로 닫는다
  assert.deepEqual(await borderOf(['가짜조직 갑', '가짜조직 병']), [['4', '4'], ['4', '4']]);
  // 을·병: 병은 바로 위 줄(을)이 있으므로 확정본 그대로(6), 을은 굵은 위 선 그대로(7)
  assert.deepEqual(await borderOf(['가짜조직 을', '가짜조직 병']), [['7', '7'], ['6', '6']]);
  // 머리 줄 테두리 견본과 다른 줄이 그대로 나오는지(줄별 차이)
  assert.deepEqual((await borderOf(['가짜조직 갑', '가짜조직 을', '가짜조직 병'])).map(r => r[0]), ['4', '7', '6']);
});

test('회의 결과 상자가 없는 주의 확정본도 빈 서식을 뽑는다(2열 표 칸으로 상자 견본, 머리 그대로)', async () => {
  const {template} = prepareConfirmed(await openConfirmed(fakeBytes()));
  const {buildReport} = await import('../app/weekly-hwpx/report.mjs');
  const team = buildReport(template, {title: '가짜팀', summary: [{area: ['가짜영역'], rows: [{task: ['가짜과제'], progress: ['- 가짜 줄'], owner: [ME]}]}]}).pkg;
  const bytes = packHwpx(team, zlib);
  const again = prepareConfirmed(await openConfirmed(bytes));
  assert.deepEqual(again.team.details, []);
  const out = await buildHwpx(again.template, assembleDraft(startDraft(again.team, {me: ME, date: ''})));
  assert.deepEqual(validateHwpx(out, zlib).errors, []);
  assert.deepEqual(openHwpx(out, zlib).files.get('Contents/header.xml'), template.files.get('Contents/header.xml'));
});

// JOURNAL-주간정리다듬기 ②: 담당 팀원 칸 이름 = 직전 주 확정본 표기, 없으면 프로필 이름. 여러 사람이 함께 맡은 줄은 칸 글 그대로. 이름은 가짜.
test('담당 팀원 칸 이름: 직전 확정본 표기를 그대로 가져오고, 못 찾으면 프로필 이름, 함께 맡은 줄은 그대로', async () => {
  const sum = owners => [{area: ['가짜영역'], rows: owners.map((owner, i) => ({task: [`가짜과제 ${i}`], progress: [`- 가짜 줄 ${i}`], owner}))}];
  // 띄어쓰기만 다른 표기: 확정본 표기("가짜담당  갑" → 조각 "가짜담당  갑")를 쓴다.
  assert.equal(ownerNotation(sum([['가짜담당  갑']]), '가짜담당 갑'), '가짜담당  갑');
  // 프로필이 성까지 쓴 이름, 확정본은 이름만(한쪽이 다른 쪽을 품음) → 확정본 표기.
  assert.equal(ownerNotation(sum([['담당갑'], ['가짜을']]), '가짜담당갑'), '담당갑');
  // 함께 맡은 줄의 한 조각도 찾는다(/ , · 로 나눔).
  assert.equal(ownerNotation(sum([['가짜을/가짜담당 갑']]), '가짜담당 갑'), '가짜담당 갑');
  // 후보가 둘이면(누군지 모름) 찾지 못함 → 프로필 이름.
  assert.equal(ownerNotation(sum([['담당갑'], ['가짜담당갑님']]), '가짜담당갑'), null);
  assert.equal(ownerNotation(sum([['가짜병']]), '가짜담당 갑'), null);
  assert.equal(ownerNotation(sum([['가짜병']]), ''), null);
  // 한 글자 조각은 품는 비교에 쓰지 않는다.
  assert.equal(ownerNotation(sum([['갑']]), '가짜담당갑'), null);
  assert.deepEqual(resolveMe({summary: sum([['가짜담당  갑']])}, '가짜담당 갑'), {me: '가짜담당  갑', from: 'confirmed'});
  assert.deepEqual(resolveMe({summary: sum([['가짜병']])}, ' 가짜담당 갑 '), {me: '가짜담당 갑', from: 'profile'});
  assert.deepEqual(resolveMe(null, '가짜담당 갑'), {me: '가짜담당 갑', from: 'profile'});

  // 실제 파일: 확정본 표기로 내 줄을 찾고, 담당 칸은 확정본 글 그대로(함께 맡은 줄 포함), 남의 줄은 비움.
  const {template} = prepareConfirmed(await openConfirmed(fakeBytes()));
  const {buildReport} = await import('../app/weekly-hwpx/report.mjs');
  const teamPkg = buildReport(template, {title: '가짜팀', summary: [{area: ['가짜영역'], rows: [
    {task: ['가짜과제 하나'], progress: ['- 가짜 줄 하나'], owner: ['담당갑']},
    {task: ['가짜과제 둘'], progress: ['- 가짜 줄 둘'], owner: ['가짜을/담당갑']},
    {task: ['가짜과제 셋'], progress: ['- 남의 줄'], owner: ['가짜을']}]}]}).pkg;
  const again = prepareConfirmed(await openConfirmed(packHwpx(teamPkg, zlib)));
  const who = resolveMe(again.team, '가짜담당갑');
  assert.deepEqual(who, {me: '담당갑', from: 'confirmed'});
  const base = startDraft(again.team, {me: who.me, date: ''});
  assert.deepEqual(editableRows(base, who.me).map(r => r.task), ['가짜과제 하나', '가짜과제 둘']);
  const back = readReport(openHwpx(await buildHwpx(again.template, assembleDraft(base)), zlib));
  assert.deepEqual(back.summary[0].rows.map(r => r.owner), [['담당갑'], ['가짜을/담당갑'], []]);
  assert.deepEqual(back.summary[0].rows.map(r => r.progress), [['- 가짜 줄 하나'], ['- 가짜 줄 둘'], []]);
  // 프로필 이름 그대로는 내 줄을 찾지 못한다(그래서 확정본 표기를 쓴다).
  assert.deepEqual(editableRows(startDraft(again.team, {me: '가짜담당갑', date: ''}), '가짜담당갑'), []);
});
