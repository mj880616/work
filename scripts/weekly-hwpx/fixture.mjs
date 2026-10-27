// WEEKLY-한글초안 시제품: 공개 저장소용 "가짜 주간보고" .hwpx 만들기.
// 실제 노조 양식 파일은 저장소에 넣지 않으므로(docs/hwp-style-map.md 1절), 저장소에 이미 있는 rhwp 빈 문서
// (tests/fixtures/hwp-lab/sample.hwpx)에 docs/hwp-style-map.md 2절의 스타일 이름·글자 크기와 같은 스타일 표를 얹고,
// 상집보고와 같은 차례·표 구성(열 이름·병합)에 자리표시 글만 넣는다. 시험과 시연은 이 파일 → 빈 서식 → 보고서 순서로 돈다.
import {el, clone, kid, kids, walk} from '../../app/weekly-hwpx/xml.mjs';
import {readXml, setXml, clonePkg} from '../../app/weekly-hwpx/hwpx.mjs';
import {renumber} from '../../app/weekly-hwpx/template.mjs';

// docs/hwp-style-map.md 2절(스타일 이름·글자 크기) + 문단 왼쪽 여백. 줄간격은 양식 기본값(%).
export const STYLE_TABLE = Object.freeze([
  ['바탕글', 'Normal', 1300, {line: 180}],
  ['안건제목', 'middle title', 3600, {line: 160}],
  ['큰 제목', 'Outline 1', 1800, {line: 180}],
  ['중간 제목', 'Outline 2', 1600, {line: 180}],
  ['작은 제목', 'Outline 3', 1450, {line: 180, bold: true}],
  ['최하위 제목[강조]', 'Outline 4', 1350, {line: 180}],
  ['세부 참고사항', '', 1100, {line: 160, left: 4000}],
  ['표내부', 'quote', 1000, {line: 150}],
  ['(기타)의결주문', 'ect01', 1300, {line: 180}],
  ['중간대제목', 'etc02', 2800, {line: 160, bold: true}],
  ['문서표지제목', 'bigtitle', 4400, {line: 160}],
  ['쪽 번호', 'Page Number', 1400, {line: 160}],
  ['각주', 'Footnote', 950, {line: 130}],
]);

function setList(head, listName, itemName, items) {
  const list = [...walk(head)].find(n => n.name === listName);
  list.children = items;
  if (list.attrs.itemCnt !== undefined) list.attrs.itemCnt = String(items.filter(c => c.name === itemName).length);
}

function charPr(base, id, height, {bold = false, color = '#000000'} = {}) {
  const c = clone(base);
  c.attrs = {...c.attrs, id: String(id), height: String(height), textColor: color};
  c.children = c.children.filter(k => k.name !== 'hh:bold');
  if (bold) c.children.splice(c.children.findIndex(k => k.name === 'hh:underline'), 0, el('hh:bold'));
  return c;
}
function paraPr(base, id, {line = 160, left = 0, center = false} = {}) {
  const p = clone(base);
  p.attrs.id = String(id);
  for (const n of walk(p)) {
    if (n.name === 'hh:lineSpacing') n.attrs.value = String(line);
    if (n.name === 'hc:left') n.attrs.value = String(left);
    if (n.name === 'hh:align' && center) n.attrs.horizontal = 'CENTER';
  }
  return p;
}
function border(id, {line = 'SOLID', fill = null} = {}) {
  const side = name => el(name, {type: line, width: '0.12 mm', color: '#000000'});
  const b = el('hh:borderFill', {id: String(id), threeD: '0', shadow: '0', centerLine: 'NONE', breakCellSeparateLine: '0'}, [
    el('hh:slash', {type: 'NONE', Crooked: '0', isCounter: '0'}), el('hh:backSlash', {type: 'NONE', Crooked: '0', isCounter: '0'}),
    side('hh:leftBorder'), side('hh:rightBorder'), side('hh:topBorder'), side('hh:bottomBorder'),
    el('hh:diagonal', {type: 'SOLID', width: '0.1 mm', color: '#000000'}),
  ]);
  if (fill) b.children.push(el('hc:fillBrush', {}, [el('hc:winBrush', {faceColor: fill, hatchColor: 'none', alpha: '0'})]));
  return b;
}

// 가짜 보고서 글(자리표시). FAKE_TEXTS는 빈 서식 검사에서 "남으면 안 되는 글" 목록으로 쓴다.
export const FAKE = Object.freeze({
  title: '가짜팀 주간보고(시험용)',
  date: '2000년 1월 3일(월)',
  requests: [
    ['1.5.(수)', [['10:00 / 가짜 행사 갑 / 가짜 장소 갑', ['가짜 참석자 갑', '가짜 참석자 을']], ['18:00 / 가짜 행사 을 / 가짜 장소 을', ['가짜 참석자 갑']]]],
    ['1.6.(목)', [['14:00 / 가짜 행사 병 / 가짜 장소 병', ['가짜 참석자 을']]]],
  ],
  summary: [
    [['가짜영역', '갑'], [
      [['가짜과제 하나'], ['- 가짜 진행 하나 완료', '- 가짜 계획 하나 예정'], ['가짜담당 갑']],
      [['가짜과제 둘'], ['◦ 가짜 묶음 제목', '- 가짜 진행 둘'], ['가짜담당 을']],
      [null, ['- 가짜 진행 둘의 두 번째 줄'], ['가짜담당 갑']],
    ]],
    [['가짜영역 을'], [
      [['가짜과제 셋'], ['- 가짜 진행 셋'], ['가짜담당 갑', '가짜담당 을']],
      [['가짜과제 넷'], [], []],
    ]],
  ],
  extra: ['(1) 가짜 회의 결과 제목', '가짜 세부 내용 문단'],
  // 2) 세부 내용 상자(왼쪽 칸 이름은 양식 글자, 오른쪽은 가짜 글)
  boxes: [
    ['(1) 가짜 회의 갑', [['회의제목', ['가짜 회의 갑']], ['일시/장소', ['1.4.(화) 10시 / 가짜 장소 갑']], ['참석자', ['가짜 참석자 갑']], ['내용', ['- 가짜 회의 내용 하나', '- 가짜 회의 내용 둘']], ['차기일정', ['가짜 미정']]]],
    ['(2) 가짜 회의 을', [['제목', ['가짜 회의 을']], ['일시/장소', ['1.5.(수) 14시']], ['참석자', ['가짜 참석자 을']], ['회의 내용', ['- 가짜 회의 을 내용']]]],
  ],
  rallies: [[['1.6.(목) 가짜 광장'], ['가짜 집회 갑'], ['가짜 참석 10명']]],
  sites: [[['가짜조직 갑'], ['개요 가짜 현황 갑', '- 가짜 현황 갑 둘']], [['가짜조직 병'], ['개요 가짜 현황 병']]],
  orgs: [[['가짜조직 갑'], ['- 가짜 소식 갑']], [['가짜조직 을'], ['- 가짜 소식 을 하나', '- 가짜 소식 을 둘']], [['가짜조직 병'], ['- 가짜 소식 병']]],
  calendar: [['1.10.(월)', [['09:00 / 가짜 일정 갑 / 가짜 장소 갑', ['가짜담당 갑']], ['13:00 / 가짜 일정 을 / 가짜 장소 을', ['가짜담당 을']]]], ['1.11.(화)', [['10:00 / 가짜 일정 병', ['가짜담당 갑, 가짜담당 을']]]]],
  calendarNotes: ['※ 1.12.(수) 가짜담당 을 휴가'],
});
export const FAKE_TEXTS = Object.freeze([
  FAKE.title, FAKE.date, ...FAKE.extra,
  ...FAKE.requests.flatMap(([d, items]) => [d, ...items.flatMap(([w, who]) => [w, ...who])]),
  ...FAKE.summary.flatMap(([a, rows]) => [...a, ...rows.flatMap(([t, p, o]) => [...(t ?? []), ...p, ...o])]),
  ...FAKE.boxes.flatMap(([h, rows]) => [h, ...rows.flatMap(([, lines]) => lines)]),
  ...[...FAKE.rallies, ...FAKE.sites, ...FAKE.orgs].flat(2),
  ...FAKE.calendar.flatMap(([d, items]) => [d, ...items.flatMap(([w, who]) => [w, ...who])]), ...FAKE.calendarNotes,
]);

// sample.hwpx 묶음 → 가짜 주간보고 묶음
export function makeFakeReport(sample) {
  const pkg = clonePkg(sample);
  const header = readXml(pkg, 'Contents/header.xml');
  const head = header.root;
  const baseChar = [...walk(head)].find(n => n.name === 'hh:charPr');
  const basePara = [...walk(head)].find(n => n.name === 'hh:paraPr');
  const chars = STYLE_TABLE.map(([, , h, o], i) => charPr(baseChar, i, h, {bold: o.bold}));
  const cellChar = STYLE_TABLE.findIndex(([n]) => n === '표내부');
  chars.push(charPr(baseChar, chars.length, STYLE_TABLE[cellChar][2], {color: '#0000FF'})); // 바뀐 글(파란 글씨)
  const paras = STYLE_TABLE.map(([, , , o], i) => paraPr(basePara, i, {line: o.line, left: o.left ?? 0}));
  const centerCell = paras.length;
  paras.push(paraPr(basePara, centerCell, {line: 150, center: true}));
  setList(head, 'hh:charProperties', 'hh:charPr', chars);
  setList(head, 'hh:paraProperties', 'hh:paraPr', paras);
  const fills = [...walk(head)].find(n => n.name === 'hh:borderFills');
  const keep = kids(fills, 'hh:borderFill').slice(0, 2);
  setList(head, 'hh:borderFills', 'hh:borderFill', [...keep, border(3, {line: 'NONE'}), border(4), border(5, {fill: '#EDEDED'})]);
  setList(head, 'hh:styles', 'hh:style', STYLE_TABLE.map(([name, engName], i) => el('hh:style', {id: String(i), type: 'PARA', name, engName, paraPrIDRef: String(i), charPrIDRef: String(i), nextStyleIDRef: String(i), langID: '1042', lockForm: '0'})));
  setXml(pkg, 'Contents/header.xml', header);

  const S = Object.fromEntries(STYLE_TABLE.map(([n], i) => [n, String(i)]));
  const sec = readXml(pkg, 'Contents/section0.xml');
  const first = kids(sec.root, 'hp:p')[0];
  const secRun = kids(first, 'hp:run').find(r => r.children.some(c => c.name === 'hp:secPr'));
  const para = (style, text, extra = []) => el('hp:p', {id: '0', paraPrIDRef: S[style], styleIDRef: S[style], pageBreak: '0', columnBreak: '0', merged: '0'},
    [...extra, el('hp:run', {charPrIDRef: S[style]}, text ? [el('hp:t', {}, [{text}])] : [])]);
  const cellPara = (text, center) => el('hp:p', {id: '0', paraPrIDRef: center ? String(centerCell) : S['표내부'], styleIDRef: S['표내부'], pageBreak: '0', columnBreak: '0', merged: '0'},
    [el('hp:run', {charPrIDRef: S['표내부']}, text ? [el('hp:t', {}, [{text}])] : [])]);
  const tc = (row, col, rs, cs, w, lines, {head = false, center = false} = {}) => el('hp:tc', {name: '', header: head ? '1' : '0', hasMargin: '0', protect: '0', editable: '0', dirty: '0', borderFillIDRef: head ? '5' : '4'}, [
    el('hp:subList', {id: '', textDirection: 'HORIZONTAL', lineWrap: 'BREAK', vertAlign: 'CENTER', linkListIDRef: '0', linkListNextIDRef: '0', textWidth: '0', textHeight: '0', hasTextRef: '0', hasNumRef: '0'},
      (lines.length ? lines : ['']).map(t => cellPara(t, head || center))),
    el('hp:cellAddr', {colAddr: String(col), rowAddr: String(row)}), el('hp:cellSpan', {colSpan: String(cs), rowSpan: String(rs)}),
    el('hp:cellSz', {width: String(w), height: '1570'}), el('hp:cellMargin', {left: '0', right: '0', top: '0', bottom: '0'}),
  ]);
  const table = (rows, cols, width, trs) => el('hp:p', {id: '0', paraPrIDRef: S['작은 제목'], styleIDRef: S['작은 제목'], pageBreak: '0', columnBreak: '0', merged: '0'}, [
    el('hp:run', {charPrIDRef: S['작은 제목']}, [el('hp:tbl', {id: '1', zOrder: '0', numberingType: 'TABLE', textWrap: 'TOP_AND_BOTTOM', textFlow: 'BOTH_SIDES', lock: '0', dropcapstyle: 'None', pageBreak: 'CELL', repeatHeader: '1', rowCnt: String(rows), colCnt: String(cols), cellSpacing: '0', borderFillIDRef: '3', noAdjust: '0'}, [
      el('hp:sz', {width: String(width), widthRelTo: 'ABSOLUTE', height: String(1570 * rows), heightRelTo: 'ABSOLUTE', protect: '0'}),
      el('hp:pos', {treatAsChar: '0', affectLSpacing: '0', flowWithText: '1', allowOverlap: '0', holdAnchorAndSO: '0', vertRelTo: 'PARA', horzRelTo: 'COLUMN', vertAlign: 'TOP', horzAlign: 'LEFT', vertOffset: '0', horzOffset: '0'}),
      el('hp:outMargin', {left: '140', right: '140', top: '140', bottom: '140'}), el('hp:inMargin', {left: '285', right: '285', top: '285', bottom: '285'}),
      ...trs.map(cells => el('hp:tr', {}, cells)),
    ])]),
  ]);
  // 요청 표: 상집보고처럼 4열(날짜 칸 아래 숨은 좁은 열) + 머리 줄 '시간/내용/장소'가 두 열을 합침.
  const W = [4600, 100, 33000, 10300];
  const reqRows = [[tc(0, 0, 1, 1, W[0], ['일'], {head: true}), tc(0, 1, 1, 2, W[1] + W[2], ['시간/내용/장소'], {head: true}), tc(0, 3, 1, 1, W[3], ['참석 요청'], {head: true})]];
  let r = 1;
  for (const [day, items] of FAKE.requests) {
    items.forEach(([what, who], i) => {
      const row = [];
      if (i === 0) row.push(tc(r, 0, items.length, 2, W[0] + W[1], [day], {center: true}));
      row.push(tc(r, 2, 1, 1, W[2], [what]), tc(r, 3, 1, 1, W[3], who, {center: true}));
      reqRows.push(row);
      r++;
    });
  }
  const SW = [5200, 8500, 29500, 4900];
  const sumRows = [['사업영역', '세부 과제', '진행 상황 및 이후 계획', '담당 팀원'].map((t, i) => tc(0, i, 1, 1, SW[i], [t], {head: true}))];
  r = 1;
  for (const [area, rows] of FAKE.summary) {
    rows.forEach(([task, progress, owner], i) => {
      const row = [];
      if (i === 0) row.push(tc(r, 0, rows.length, 1, SW[0], area, {center: true}));
      if (task) { const span = 1 + rows.slice(i + 1).findIndex(x => x[0]) ; row.push(tc(r, 1, span > 0 ? span : rows.length - i, 1, SW[1], task, {center: true})); }
      row.push(tc(r, 2, 1, 1, SW[2], progress), tc(r, 3, 1, 1, SW[3], owner, {center: true}));
      sumRows.push(row);
      r++;
    });
  }
  // 2열 상자·표: 왼쪽 칸은 머리 칸(옅은 색), 오른쪽은 글 칸
  const BW = [5400, 42500];
  const box = rows => table(rows.length, 2, 47900, rows.map(([label, lines], r) => [tc(r, 0, 1, 1, BW[0], [label], {head: true}), tc(r, 1, 1, 1, BW[1], lines)]));
  const plain = (head, widths, rows) => table(rows.length + 1, head.length, widths.reduce((a, b) => a + b, 0), [
    head.map((t, i) => tc(0, i, 1, 1, widths[i], [t], {head: true})),
    ...rows.map((cells, r) => cells.map((lines, i) => tc(r + 1, i, 1, 1, widths[i], lines, {center: i === 0}))),
  ]);
  const CW = [4950, 35200, 7700];
  const calRows = [['일', '시간/내용/장소', '참석자'].map((t, i) => tc(0, i, 1, 1, CW[i], [t], {head: true}))];
  r = 1;
  for (const [day, items] of FAKE.calendar) {
    items.forEach(([what, who], i) => {
      const row = [];
      if (i === 0) row.push(tc(r, 0, items.length, 1, CW[0], [day], {center: true}));
      row.push(tc(r, 1, 1, 1, CW[1], [what]), tc(r, 2, 1, 1, CW[2], who, {center: true}));
      calRows.push(row);
      r++;
    });
  }
  const midTable = t => { t.attrs.styleIDRef = S['중간 제목']; t.attrs.paraPrIDRef = S['중간 제목']; t.children[0].attrs.charPrIDRef = S['중간 제목']; return t; };
  sec.root.children = [
    para('안건제목', FAKE.title, [clone(secRun)]),
    para('바탕글', ''), para('바탕글', `■ 일시 : ${FAKE.date}`), para('바탕글', ''),
    para('큰 제목', '1. 요청사항'), para('바탕글', ''), para('작은 제목', '1) 집회/행사 참가 요청'),
    table(reqRows.length, 4, 48000, reqRows),
    para('작은 제목', '2) 주요 일정'), para('바탕글', ''),
    para('큰 제목', '2. 기본․영역․의제 사업'), para('바탕글', ''), para('작은 제목', '1) 요약'),
    table(sumRows.length, 4, 48100, sumRows),
    para('작은 제목', '2) 세부 내용'),
    ...FAKE.boxes.flatMap(([heading, rows]) => [para('작은 제목', heading), box(rows), para('바탕글', '')]),
    para('작은 제목', FAKE.extra[0]), para('바탕글', FAKE.extra[1]),
    para('큰 제목', '3. 투쟁 사업'), para('중간 제목', '1) 집회·농성 등'),
    midTable(plain(['일시/장소', '집회/행사명', '참석현황'], [11100, 13400, 23500], FAKE.rallies)),
    para('중간 제목', '2) 투쟁 사업장 현황'),
    midTable(plain(['조직명', '현황'], [13400, 34600], FAKE.sites)),
    para('큰 제목', '4. 산하조직 현황'), para('중간 제목', '1) 요약'),
    midTable(plain(['사업장', '조직현황'], [13800, 34600], FAKE.orgs)),
    para('중간 제목', '2) 참고자료'), para('바탕글', ''),
    para('큰 제목', '5. 주요 일정'),
    table(calRows.length, 3, 47850, calRows),
    ...FAKE.calendarNotes.map(t => para('표내부', t)),
  ];
  renumber(sec.root);
  setXml(pkg, 'Contents/section0.xml', sec);
  pkg.files.set('Preview/PrvText.txt', new TextEncoder().encode(FAKE.title));
  return pkg;
}

// 시연용 보고 자료(가짜). report.mjs 자료 모양.
export const DEMO_DATA = Object.freeze({
  title: '가짜팀 주간보고(시험용)',
  date: '2000년 1월 10일(월)',
  requests: [{day: '1.12.(수)', items: [{what: '10:00 / 가짜 행사 정 / 가짜 장소 정', who: ['가짜 참석자 갑']}]}],
  schedule: ['- 가짜 일정 하나'],
  summary: [
    {area: ['가짜영역', '갑'], rows: [
      {task: ['가짜과제 하나'], progress: ['- 가짜 진행 하나 완료', {text: '- 이번 주 바뀐 가짜 줄', changed: true}], owner: ['가짜담당 갑']},
      {task: ['가짜과제 둘'], progress: [], owner: []},
    ]},
    {area: ['가짜영역 을'], rows: [{task: ['가짜과제 셋'], progress: ['- 가짜 진행 셋'], owner: ['가짜담당 갑']}]},
  ],
  details: [{heading: '(1) 가짜 회의 정', box: [{label: '회의제목', lines: ['가짜 회의 정']}, {label: '일시/장소', lines: ['1.11.(화) 10시']}, {label: '참석자', lines: ['가짜 참석자 갑']}, {label: '내용', lines: ['- 가짜 회의 정 내용', {text: '- 가짜 회의 정 바뀐 내용', changed: true}]}]}],
  rallies: [{when: ['1.13.(목) 가짜 광장'], name: ['가짜 집회 정'], attend: ['가짜 참석 5명']}],
  sites: [{org: ['가짜조직 갑'], status: ['개요 가짜 현황 정']}],
  orgs: [{org: ['가짜조직 갑'], status: ['- 가짜 소식 정']}, {org: ['가짜조직 을'], status: []}],
  orgNotes: ['- 가짜 참고 하나'],
  calendar: [{day: '1.17.(월)', items: [{what: '10:00 / 가짜 일정 정 / 가짜 장소 정', who: ['가짜담당 갑']}, {what: '14:00 / 가짜 일정 무', who: ['가짜담당 을']}]}],
  calendarNotes: ['※ 1.18.(화) 가짜담당 갑 휴가'],
});
export {kid};
