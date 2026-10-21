import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {writeZip, readZip, crc32} from '../app/weekly-hwpx/zip.mjs';
import {parseXml, toXml, walk, textOf} from '../app/weekly-hwpx/xml.mjs';
import {openHwpx, packHwpx, validateHwpx, readXml, setText, headerStyles, REQUIRED_PARTS} from '../app/weekly-hwpx/hwpx.mjs';
import {extractBlankTemplate, assertBlank, FORM_LABELS, readPrototypes, PROTO_ORDER} from '../app/weekly-hwpx/template.mjs';
import {buildReport, readReport, reportTexts, lineText, isChanged} from '../app/weekly-hwpx/report.mjs';
import {personalFromTeam, personalReportFromTeam, applyPatch, applyReportPatch, diffLines, diffRows, isMine, REQUEST_CHECK_NOTE} from '../app/weekly-hwpx/delta.mjs';
import {estimateLines, layoutTable, headerMetrics} from '../app/weekly-hwpx/layout.mjs';
import {kid, kids} from '../app/weekly-hwpx/xml.mjs';
import {makeFakeReport, FAKE_TEXTS, DEMO_DATA, STYLE_TABLE} from '../scripts/weekly-hwpx/fixture.mjs';

// WEEKLY-한글초안 1단계 시제품(docs/design/weekly-hwpx-draft.md). 실제 업무 문서는 쓰지 않는다: 저장소의 rhwp 빈 문서
// (tests/fixtures/hwp-lab/sample.hwpx)로 가짜 주간보고 → 빈 서식 → 보고서 순서로 돈다.
const sample = () => openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib);
const fake = () => makeFakeReport(sample());
const roundTrip = pkg => openHwpx(packHwpx(pkg, zlib), zlib);

test('zip: mimetype은 첫 항목·압축 없이, 나머지는 deflate이고 CRC가 맞다', () => {
  const bytes = writeZip([{name: 'mimetype', data: 'application/hwp+zip', store: true}, {name: 'a/b.xml', data: '<a>가나다</a>'.repeat(50)}], zlib);
  const entries = readZip(bytes, zlib);
  assert.deepEqual(entries.map(e => [e.name, e.method]), [['mimetype', 0], ['a/b.xml', 8]]);
  assert.equal(new TextDecoder().decode(entries[1].data), '<a>가나다</a>'.repeat(50));
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const broken = new Uint8Array(bytes); broken[60] ^= 0xff;
  assert.throws(() => readZip(broken, zlib));
});

test('xml: 잘못된 XML은 거절하고 정상 XML은 그대로 다시 쓴다', () => {
  const src = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><r a="1&amp;2"><b>x &lt; y</b><c/></r>';
  const doc = parseXml(src);
  assert.equal(toXml(doc.root, doc.prolog), src);
  for (const bad of ['<r><b></r>', '<r>', '<r/><s/>', '<r a="1" a="2"/>', '<!DOCTYPE r><r/>', '<r>&nbsp;</r>']) assert.throws(() => parseXml(bad), bad);
});

test('저장소 rhwp 견본 .hwpx도 같은 규격 검사를 통과한다(검사기 기준 확인)', () => {
  const v = validateHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib);
  assert.deepEqual(v.errors, []);
});

test('가짜 주간보고: 노조 양식 스타일 표(hwp-style-map.md 2절)와 상집보고 차례·표 구성', () => {
  const pkg = fake();
  const bytes = packHwpx(pkg, zlib);
  assert.deepEqual(validateHwpx(bytes, zlib).errors, []);
  const header = readXml(pkg, 'Contents/header.xml');
  assert.deepEqual(headerStyles(header).map(s => s.name), STYLE_TABLE.map(([n]) => n));
  const heights = Object.fromEntries([...walk(header.root)].filter(n => n.name === 'hh:charPr').map(c => [c.attrs.id, Number(c.attrs.height)]));
  const size = name => heights[headerStyles(header).find(s => s.name === name).charPr] / 100;
  assert.deepEqual(['바탕글', '안건제목', '큰 제목', '작은 제목', '세부 참고사항', '표내부'].map(size), [13, 36, 18, 14.5, 11, 10]);
  const r = readReport(pkg);
  assert.deepEqual(r.summary.map(a => a.rows.length), [3, 2]);
  assert.equal(r.summary[0].rows[2].task, null); // 세부 과제 세로 병합
  assert.equal(r.requests.length, 2);
  // 조직보고 이후 절(상집보고 전체 구조)
  assert.deepEqual(r.details.map(d => [d.heading, d.box.map(b => b.label)]), [
    ['(1) 가짜 회의 갑', ['회의제목', '일시/장소', '참석자', '내용', '차기일정']], ['(2) 가짜 회의 을', ['제목', '일시/장소', '참석자', '회의 내용']]]);
  assert.deepEqual([r.rallies.length, r.sites.length, r.orgs.length, r.calendar.length], [1, 2, 3, 2]);
  assert.deepEqual(r.calendar[0].items.map(i => i.who), [['가짜담당 갑'], ['가짜담당 을']]);
});

test('빈 서식: 스타일·쪽 설정·표 틀만 남고 실제 글은 한 글자도 남지 않는다', () => {
  const source = fake();
  const blank = extractBlankTemplate(source);
  const bytes = packHwpx(blank, zlib);
  assert.deepEqual(validateHwpx(bytes, zlib).errors, []);
  assert.deepEqual(assertBlank(openHwpx(bytes, zlib), {forbidden: FAKE_TEXTS}), []);
  // 본문에 남은 글은 표 머리 칸 이름뿐(회의 결과 상자의 왼쪽 칸 이름도 지운다)
  const sec = readXml(blank, 'Contents/section0.xml');
  const texts = [...walk(sec.root)].filter(n => n.name === 'hp:t').map(t => textOf({name: 'x', attrs: {}, children: [t]}).trim()).filter(Boolean);
  assert.deepEqual([...new Set(texts)].sort(), [...FORM_LABELS].sort());
  assert.equal(kids(sec.root, 'hp:p').length, PROTO_ORDER.length);
  // 원본 스타일 표·글자 모양·쪽 설정은 그대로
  assert.equal(readXml(blank, 'Contents/header.xml').root.children.length, readXml(source, 'Contents/header.xml').root.children.length);
  assert.equal(new TextDecoder().decode(blank.files.get('Contents/header.xml')), new TextDecoder().decode(source.files.get('Contents/header.xml')));
  assert.ok([...walk(sec.root)].some(n => n.name === 'hp:pagePr'));
  assert.equal(new TextDecoder().decode(blank.files.get('Preview/PrvText.txt')), '');
  readPrototypes(blank); // 견본 순서·표 머리 확인
});

test('빈 서식 검사는 남은 글·그림·미리보기·문서 정보를 잡는다', () => {
  const blank = extractBlankTemplate(fake());
  const leak = roundTrip(blank);
  const sec = new TextDecoder().decode(leak.files.get('Contents/section0.xml')).replace('<hp:t>일</hp:t>', '<hp:t>일</hp:t></hp:run><hp:run charPrIDRef="0"><hp:t>가짜담당 갑</hp:t>');
  setText(leak, 'Contents/section0.xml', sec);
  assert.ok(assertBlank(leak, {forbidden: FAKE_TEXTS}).some(p => p.includes('양식 밖 글')));
  const prv = roundTrip(blank); setText(prv, 'Preview/PrvText.txt', '가짜');
  assert.ok(assertBlank(prv).some(p => p.includes('미리보기')));
  const bin = roundTrip(blank); bin.files.set('BinData/image1.bmp', new Uint8Array([1])); bin.order.push('BinData/image1.bmp');
  assert.ok(assertBlank(bin).some(p => p.includes('BinData')));
  const meta = roundTrip(blank); setText(meta, 'Contents/content.hpf', new TextDecoder().decode(meta.files.get('Contents/content.hpf')).replace('<opf:title/>', '<opf:title>가짜 제목</opf:title>'));
  assert.ok(assertBlank(meta).some(p => p.includes('제목')));
});

test('보고서 만들기: 빈 서식의 글자·문단 모양·테두리만 쓰고, 표 병합·바뀐 줄 표시가 맞다', () => {
  const blank = extractBlankTemplate(fake());
  const {pkg, changedCharPr} = buildReport(blank, DEMO_DATA);
  const bytes = packHwpx(pkg, zlib);
  assert.deepEqual(validateHwpx(bytes, zlib).errors, []);
  // 머리(header.xml)는 빈 서식과 한 글자도 다르지 않다 = 새 글자 모양·테두리를 만들지 않았다
  assert.equal(new TextDecoder().decode(pkg.files.get('Contents/header.xml')), new TextDecoder().decode(blank.files.get('Contents/header.xml')));
  const header = readXml(pkg, 'Contents/header.xml');
  const color = id => [...walk(header.root)].find(n => n.name === 'hh:charPr' && n.attrs.id === id).attrs.textColor;
  assert.equal(color(changedCharPr), '#0000FF');
  const back = readReport(openHwpx(bytes, zlib));
  assert.deepEqual(back.summary.map(a => [a.area, a.rows.length]), [[['가짜영역', '갑'], 2], [['가짜영역 을'], 1]]);
  assert.deepEqual(back.summary[0].rows[0].progress, DEMO_DATA.summary[0].rows[0].progress.map(lineText));
  assert.deepEqual(back.summary[0].rows[1], {task: ['가짜과제 둘'], progress: [], owner: []});
  // 바뀐 줄만 파란 글씨
  const sec = readXml(pkg, 'Contents/section0.xml');
  const blue = [...walk(sec.root)].filter(n => n.name === 'hp:run' && n.attrs.charPrIDRef === changedCharPr).map(r => textOf({name: 'x', attrs: {}, children: [r]}));
  assert.deepEqual(blue, ['- 이번 주 바뀐 가짜 줄', '- 가짜 회의 정 바뀐 내용']);
  // 모든 글이 들어갔다
  const all = textOf(sec.root);
  for (const t of reportTexts(DEMO_DATA)) assert.ok(all.includes(t), t);
  // 양식 차례(상집보고 전체 구조)
  const order = sec.root.children.filter(n => n.name === 'hp:p' && !n.children.some(c => c.name === 'hp:run' && c.children.some(k => k.name === 'hp:tbl')))
    .map(p => textOf(p)).filter(t => /^(\d\.|\d\))/.test(t));
  assert.deepEqual(order, ['1. 요청사항', '1) 집회/행사 참가 요청', '2) 주요 일정', '2. 기본․영역․의제 사업', '1) 요약', '2) 세부 내용',
    '3. 투쟁 사업', '1) 집회·농성 등', '2) 투쟁 사업장 현황', '4. 산하조직 현황', '1) 요약', '2) 참고자료', '5. 주요 일정']);
  // 3·4절 "1)"은 '중간 제목', 1·2절은 '작은 제목'
  const styleOf = text => { const id = sec.root.children.find(p => textOf(p) === text).attrs.styleIDRef; return headerStyles(header).find(x => x.id === id).name; };
  assert.deepEqual(['1) 집회/행사 참가 요청', '2) 세부 내용', '1) 집회·농성 등', '2) 참고자료'].map(styleOf), ['작은 제목', '작은 제목', '중간 제목', '중간 제목']);
  assert.deepEqual(back.details, [{heading: '(1) 가짜 회의 정', box: DEMO_DATA.details[0].box.map(b => ({label: b.label, lines: b.lines.map(lineText)}))}]);
  assert.deepEqual(back.calendar, DEMO_DATA.calendar);
  assert.deepEqual(back.orgs, DEMO_DATA.orgs);
});

test('빈 보고 자료로도 열리는 파일을 만든다(빈 표 한 줄)', () => {
  const {pkg} = buildReport(extractBlankTemplate(fake()), {});
  assert.deepEqual(validateHwpx(packHwpx(pkg, zlib), zlib).errors, []);
});

test('개인본 바탕: 팀 최종본에서 내 담당 줄만 남기고 나머지 진행·담당 칸은 비운다(표 틀은 그대로)', () => {
  const team = readReport(fake()).summary;
  const mine = personalFromTeam(team, '가짜담당 갑');
  assert.deepEqual(mine.map(a => a.rows.length), team.map(a => a.rows.length));
  assert.deepEqual(mine[0].rows[0].progress, team[0].rows[0].progress);
  assert.deepEqual(mine[0].rows[1].progress, []); // 다른 사람 줄
  assert.deepEqual(mine[0].rows[2].progress, team[0].rows[2].progress); // 세로 병합 세부 과제 아래 내 줄
  assert.deepEqual(mine[1].rows[0].owner, ['가짜담당 갑', '가짜담당 을']); // 공동 담당
  assert.ok(isMine(['가짜담당 갑 / 가짜담당 을'], '가짜담당 을'));
});

test('바뀐 것만 고치기: 내 줄·원문이 정확할 때만 적용, 나머지는 사람 확인으로 돌려준다', () => {
  const base = personalFromTeam(readReport(fake()).summary, '가짜담당 갑');
  const at = {area: '가짜영역갑', task: '가짜과제 하나'};
  const {summary, applied, rejected} = applyPatch(base, [
    {op: 'replace', at, old: '- 가짜 계획 하나 예정', text: '- 가짜 계획 하나 완료'},
    {op: 'add', at, text: '- 가짜 새 줄'},
    {op: 'replace', at, old: '없는 줄', text: 'x'},
    {op: 'add', at: {area: '가짜영역갑', task: '가짜과제 둘'}, text: '남의 줄'},
    {op: 'remove', at: {area: '가짜영역 을', task: '가짜과제 셋'}, old: '- 가짜 진행 셋'},
    {op: 'replace', at, old: '- 가짜 계획 하나 완료', text: '두 번 고치기'},
  ], '가짜담당 갑');
  assert.equal(applied.length, 3);
  assert.deepEqual(rejected.map(r => r.reason), ['바꿀 줄 원문이 바탕에 없음', '내 담당 줄이 아님', '이번 주에 이미 고친 줄']);
  const lines = summary[0].rows[0].progress;
  assert.deepEqual(lines.map(lineText), ['- 가짜 진행 하나 완료', '- 가짜 계획 하나 완료', '- 가짜 새 줄']);
  assert.deepEqual(lines.map(isChanged), [false, true, true]);
  assert.deepEqual(summary[1].rows[0].progress, []);
  assert.deepEqual(base[0].rows[0].progress.map(lineText), ['- 가짜 진행 하나 완료', '- 가짜 계획 하나 예정']); // 바탕은 그대로
});

test('줄 비교: 같은 세부 과제에 내 줄이 여럿이어도 내용으로 짝을 찾는다', () => {
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'x', 'c']).map(l => l.op), ['same', 'remove', 'add', 'same']);
  const mk = rows => [{area: ['A'], rows: rows.map((p, i) => ({task: i ? null : ['T'], progress: p, owner: ['나']}))}];
  const d = diffRows(mk([['1', '2'], ['3', '4']]), mk([['3', '4'], ['1', '2', '5']]), '나');
  assert.deepEqual(d.map(r => r.lines.filter(l => l.op !== 'same').map(l => l.op + l.text)), [[], ['add5']]);
});

test('사용자가 한글에서 고친 서식: 제목·일시 사이 빈 줄, 요청 표 아래 빈 줄, 칸 높이를 글 양으로 계산', () => {
  const {pkg} = buildReport(extractBlankTemplate(fake()), DEMO_DATA);
  const sec = readXml(pkg, 'Contents/section0.xml');
  const header = readXml(pkg, 'Contents/header.xml');
  const name = p => headerStyles(header).find(x => x.id === p.attrs.styleIDRef).name;
  const top = kids(sec.root, 'hp:p');
  assert.deepEqual(top.slice(0, 4).map(p => [name(p), textOf(p) ? 'text' : '']), [['안건제목', 'text'], ['바탕글', ''], ['바탕글', 'text'], ['바탕글', '']]);
  const reqAt = top.findIndex(p => [...walk(p)].some(n => n.name === 'hp:tbl'));
  assert.deepEqual([name(top[reqAt + 1]), textOf(top[reqAt + 1])], ['작은 제목', '']);
  assert.equal(textOf(top[reqAt + 2]), '2) 주요 일정');
  // 칸 높이: 표내부 10pt·150%·위아래 여백 285 → 1줄 1570, 2줄 3070. 세로 병합 칸 = 걸친 줄 높이 합. 표 높이 = 줄 높이 합.
  for (const tbl of [...walk(sec.root)].filter(n => n.name === 'hp:tbl')) {
    const cells = kids(tbl, 'hp:tr').flatMap(tr => kids(tr, 'hp:tc'));
    const rowH = [];
    for (const tc of cells) if (kid(tc, 'hp:cellSpan').attrs.rowSpan === '1') rowH[Number(kid(tc, 'hp:cellAddr').attrs.rowAddr)] = Number(kid(tc, 'hp:cellSz').attrs.height);
    for (const tc of cells) {
      const r = Number(kid(tc, 'hp:cellAddr').attrs.rowAddr), rs = Number(kid(tc, 'hp:cellSpan').attrs.rowSpan);
      assert.equal(Number(kid(tc, 'hp:cellSz').attrs.height), rowH.slice(r, r + rs).reduce((a, b) => a + b, 0));
    }
    assert.equal(Number(kid(tbl, 'hp:sz').attrs.height), rowH.reduce((a, b) => a + b, 0));
    assert.ok(rowH.every(h => h >= 1570 && h < 20000), String(rowH)); // 견본 칸 높이를 베껴 길게 늘어나지 않음
  }
  const two = [...walk(sec.root)].filter(n => n.name === 'hp:tc').find(tc => kids(kid(tc, 'hp:subList'), 'hp:p').length === 2 && textOf(tc).includes('바뀐 가짜'));
  assert.equal(kid(two, 'hp:cellSz').attrs.height, '3070');
  assert.equal(estimateLines('가'.repeat(30), 1000, 28936), 1);
  assert.equal(estimateLines('가'.repeat(40), 1000, 28936), 2);
  // 줄바꿈은 강제 줄바꿈(lineBreak)이 아니라 문단으로 나눈다(사용자 판·확정본 모두 lineBreak 0개)
  assert.ok(![...walk(sec.root)].some(n => n.name === 'hp:lineBreak'));
  // 열 너비는 빈 서식(확정본) 그대로: 요약 표 머리 칸 너비가 빈 서식과 같음
  const widths = p => kids(kids([...walk(readXml(p, 'Contents/section0.xml').root)].filter(n => n.name === 'hp:tbl')[1], 'hp:tr')[0], 'hp:tc').map(tc => kid(tc, 'hp:cellSz').attrs.width);
  assert.deepEqual(widths(pkg), widths(extractBlankTemplate(fake())));
  // 계산을 두 번 해도 같다
  const tbl = [...walk(sec.root)].filter(n => n.name === 'hp:tbl')[1];
  const before = JSON.stringify(tbl);
  layoutTable(tbl, headerMetrics(header));
  assert.equal(JSON.stringify(tbl), before);
});

test('전체 구조 개인본 바탕: 요청 표는 직전 주 그대로 + 확인 필요, 조직 줄은 내 담당만, 매주 새로 쓰는 표는 비움', () => {
  const team = readReport(fake());
  const mine = personalReportFromTeam(team, '가짜담당 갑', {myOrgs: ['가짜조직 갑', '가짜조직병'], title: 't', date: 'd'});
  assert.deepEqual(mine.requests, team.requests);
  assert.equal(mine.requestNote, REQUEST_CHECK_NOTE);
  assert.deepEqual(mine.orgs.map(o => o.org), [['가짜조직 갑'], ['가짜조직 병']]); // 띄어쓰기 차이 무시, 확정본 순서
  assert.deepEqual(mine.sites.map(o => o.org), [['가짜조직 갑'], ['가짜조직 병']]);
  assert.deepEqual([mine.details, mine.rallies, mine.calendar], [[], [], []]);
  assert.deepEqual(mine.summary, personalFromTeam(team.summary, '가짜담당 갑'));
  const {pkg} = buildReport(extractBlankTemplate(fake()), mine);
  assert.deepEqual(validateHwpx(packHwpx(pkg, zlib), zlib).errors, []);
  const sec = readXml(pkg, 'Contents/section0.xml');
  assert.ok(textOf(sec.root).includes(REQUEST_CHECK_NOTE));
  assert.ok(!textOf(sec.root).includes('가짜 소식 을')); // 남의 담당 조직 글은 들어가지 않음
  assert.ok(!textOf(sec.root).includes('가짜 회의 갑')); // 지난주 회의 결과 상자는 들어가지 않음
  // 요청 표가 비어 있던 주에는 확인 필요 줄도 없다
  assert.equal(personalReportFromTeam({...team, requests: []}, '가짜담당 갑').requestNote, undefined);
});

test('전체 구조 고칠 목록: 내 담당 조직 줄만 고치고, 일정·회의 결과는 더하기만', () => {
  const team = readReport(fake());
  const base = personalReportFromTeam(team, '가짜담당 갑', {myOrgs: ['가짜조직 갑']});
  const {report, applied, rejected} = applyReportPatch(base, [
    {op: 'replace', at: {section: 'orgs', org: '가짜조직 갑'}, old: '- 가짜 소식 갑', text: '- 가짜 소식 갑 바뀜'},
    {op: 'add', at: {section: 'orgs', org: '가짜조직 을'}, text: '남의 조직'},
    {op: 'add', at: {section: 'calendar'}, day: '1.17.(월)', what: '10:00 / 가짜 새 일정', who: ['가짜담당 갑']},
    {op: 'add', at: {section: 'details'}, heading: '(1) 가짜 새 회의', box: [{label: '제목', lines: ['가짜 새 회의']}]},
    {op: 'remove', at: {section: 'calendar'}, old: 'x'},
    {op: 'add', at: {area: '가짜영역갑', task: '가짜과제 하나'}, text: '- 가짜 요약 새 줄'},
  ], '가짜담당 갑', {myOrgs: ['가짜조직 갑']});
  assert.equal(applied.length, 4);
  assert.deepEqual(rejected.map(r => r.reason), ['그런 조직 줄이 없음', '이 칸은 더하기만 받음']);
  assert.deepEqual(report.orgs[0].status.map(lineText), ['- 가짜 소식 갑 바뀜']);
  assert.ok(isChanged(report.orgs[0].status[0]));
  assert.equal(report.calendar[0].items.length, 1);
  assert.equal(report.details[0].heading, '(1) 가짜 새 회의');
  assert.deepEqual(report.summary[0].rows[0].progress.map(lineText).slice(-1), ['- 가짜 요약 새 줄']);
  assert.deepEqual(base.orgs[0].status, ['- 가짜 소식 갑']); // 바탕은 그대로
  const {pkg} = buildReport(extractBlankTemplate(fake()), report);
  assert.deepEqual(validateHwpx(packHwpx(pkg, zlib), zlib).errors, []);
});
