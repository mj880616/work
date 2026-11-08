// WEEKLY-주말칸색(요청함 11/08): 주간보고 한글 파일 5. 주요 일정 표의 토·일 줄 날짜 칸만 연회색 바탕. 글은 모두 지어낸 자리표시.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {openHwpx, packHwpx, validateHwpx, readXml, setXml} from '../app/weekly-hwpx/hwpx.mjs';
import {extractBlankTemplate} from '../app/weekly-hwpx/template.mjs';
import {buildReport, isWeekendLabel, weekendFill, shadeWeekends, requestGrid, WEEKEND_FACE} from '../app/weekly-hwpx/report.mjs';
import {walk, kids, kid, textOf} from '../app/weekly-hwpx/xml.mjs';
import {makeFakeReport, DEMO_DATA} from '../scripts/weekly-hwpx/fixture.mjs';

const blank = () => extractBlankTemplate(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)));
const fills = pkg => new Map([...walk(readXml(pkg, 'Contents/header.xml').root)].filter(n => n.name === 'hh:borderFill').map(b => [b.attrs.id, b]));
const face = b => [...walk(b)].find(n => n.name === 'hc:winBrush')?.attrs.faceColor ?? null;
const sides = b => ['hh:leftBorder', 'hh:rightBorder', 'hh:topBorder', 'hh:bottomBorder'].map(n => JSON.stringify(kid(b, n)?.attrs));
// 지어낸 2주 일정(토·일 포함, 여러 날 일정 한 줄)
const CAL = [
  {day: '1.13.(금)', items: [{what: '10:00 / 가짜 일정 갑 / 가짜 장소', who: ['가짜담당 갑']}]},
  {day: '1.14.(토)', items: [{what: '', who: []}]},
  {day: '1.15.(일)', items: [{what: '14:00 / 가짜 일정 을 / 미정', who: ['가짜담당 갑']}, {what: '16:00 / 가짜 일정 병 / 미정', who: ['가짜담당 갑']}]},
  {day: '1.16.(월)', items: [{what: '', who: []}]},
  {day: '1.21.(토)', items: [{what: '', who: []}]},
  {day: '1.22.(일)', items: [{what: '', who: []}]},
  {day: '1.20.(금)~1.22.(일)', items: [{what: '종일 / 가짜 행사 정 / 미정', who: ['가짜담당 갑']}]},
  {day: '1.21.(토)~1.22.(일)', items: [{what: '종일 / 가짜 행사 무 / 미정', who: ['가짜담당 갑']}]},
];
// 만든 파일의 5. 주요 일정 표: 줄마다 [날짜 글, 칸 모양 번호들]
function scheduleRows(pkg) {
  const sec = readXml(pkg, 'Contents/section0.xml');
  const tbl = [...walk(sec.root)].filter(n => n.name === 'hp:tbl').find(t => kids(kids(t, 'hp:tr')[0], 'hp:tc').map(c => textOf(c).trim()).join('|') === '일|시간/내용/장소|참석자');
  return kids(tbl, 'hp:tr').slice(1).map(tr => kids(tr, 'hp:tc').map(tc => ({col: kid(tc, 'hp:cellAddr').attrs.colAddr, text: textOf(tc).trim(), fill: tc.attrs.borderFillIDRef})));
}

test('토·일 판정: 한 날짜는 (토)·(일)만, 여러 날 줄은 적힌 요일이 모두 토·일일 때만', () => {
  assert.equal(isWeekendLabel('11.14.(토)'), true);
  assert.equal(isWeekendLabel('11.15.(일)'), true);
  assert.equal(isWeekendLabel('11.13.(금)'), false);
  assert.equal(isWeekendLabel('11.14.(토)~11.15.(일)'), true);
  assert.equal(isWeekendLabel('11.13.(금)~11.15.(일)'), false);
  assert.equal(isWeekendLabel(''), false);
  assert.equal(isWeekendLabel('일'), false); // 머리 칸 글자 '일'은 요일이 아니다
});

test('양식에 같은 테두리의 연회색 칸 모양이 있으면 그것을 쓰고 머리는 그대로', () => {
  const tpl = blank();
  const {pkg} = buildReport(tpl, {...DEMO_DATA, calendar: CAL});
  assert.equal(new TextDecoder().decode(pkg.files.get('Contents/header.xml')), new TextDecoder().decode(tpl.files.get('Contents/header.xml')));
  const f = fills(pkg), rows = scheduleRows(pkg);
  const dayCells = rows.map(r => r.find(c => c.col === '0')).filter(Boolean);
  const weekday = dayCells.find(c => c.text === '1.13.(금)').fill;
  const shaded = dayCells.filter(c => c.fill !== weekday).map(c => c.text);
  assert.deepEqual(shaded, ['1.14.(토)', '1.15.(일)', '1.21.(토)', '1.22.(일)', '1.21.(토)~1.22.(일)']);
  const wk = dayCells.find(c => c.text === '1.14.(토)').fill;
  assert.match(face(f.get(wk)), /^#([0-9A-F]{2})\1\1$/i);
  assert.deepEqual(sides(f.get(wk)), sides(f.get(weekday)), '테두리는 평일 날짜 칸과 같다');
  // 내용·참석자 칸은 토·일 줄도 평일과 같은 칸 모양
  const other = rows.flat().filter(c => c.col !== '0').map(c => c.fill);
  assert.equal(new Set(other).size, 1);
  assert.deepEqual(validateHwpx(packHwpx(pkg, zlib), zlib).errors, []);
});

test('양식에 연회색 칸 모양이 없으면 같은 테두리 + #F2F2F2 하나를 머리에 더한다(한 번만)', () => {
  const tpl = blank();
  // 가짜 양식에서 연회색 칸 모양을 지운다(바탕 없는 칸 모양으로)
  const header = readXml(tpl, 'Contents/header.xml');
  for (const b of [...walk(header.root)].filter(n => n.name === 'hh:borderFill')) b.children = b.children.filter(c => c.name !== 'hc:fillBrush');
  setXml(tpl, 'Contents/header.xml', header);
  const count = fills(tpl).size;
  const {pkg} = buildReport(tpl, {...DEMO_DATA, calendar: CAL});
  const f = fills(pkg);
  assert.equal(f.size, count + 1);
  const list = [...walk(readXml(pkg, 'Contents/header.xml').root)].find(n => n.name === 'hh:borderFills');
  assert.equal(list.attrs.itemCnt, String(count + 1));
  const rows = scheduleRows(pkg), dayCells = rows.map(r => r.find(c => c.col === '0')).filter(Boolean);
  const wk = dayCells.find(c => c.text === '1.22.(일)').fill, weekday = dayCells.find(c => c.text === '1.16.(월)').fill;
  assert.equal(face(f.get(wk)), WEEKEND_FACE);
  assert.equal(face(f.get(weekday)), null);
  assert.deepEqual(sides(f.get(wk)), sides(f.get(weekday)));
  assert.equal(new Set(dayCells.filter(c => /\((토|일)\)$/.test(c.text) && !c.text.includes('(금)')).map(c => c.fill)).size, 1);
  const bytes = packHwpx(pkg, zlib);
  assert.deepEqual(validateHwpx(bytes, zlib).errors, []);
  // 다시 열어도 그대로(한글이 읽는 칸 모양 번호가 머리에 있다)
  const again = openHwpx(bytes, zlib);
  assert.equal(face(fills(again).get(wk)), WEEKEND_FACE);
});

test('토·일 줄이 없으면 머리를 건드리지 않고, 1) 임원 배정 요청 표는 칠하지 않는다(확정본과 같음)', () => {
  const tpl = blank();
  const {pkg} = buildReport(tpl, {...DEMO_DATA, requests: [{day: '1.14.(토)', items: [{what: '10:00 / 가짜 행사 / 가짜 장소', who: ['가짜 참석자']}]}]});
  assert.equal(new TextDecoder().decode(pkg.files.get('Contents/header.xml')), new TextDecoder().decode(tpl.files.get('Contents/header.xml')));
  const sec = readXml(pkg, 'Contents/section0.xml');
  const req = [...walk(sec.root)].filter(n => n.name === 'hp:tbl').find(t => textOf(kids(t, 'hp:tr')[0]).includes('참석 요청'));
  const fillsUsed = kids(req, 'hp:tr').slice(1).flatMap(tr => kids(tr, 'hp:tc').map(tc => tc.attrs.borderFillIDRef));
  assert.equal(new Set(fillsUsed).size, 1);
});

test('shadeWeekends·weekendFill: 견본 칸 모양을 못 찾으면 칠하지 않는다', () => {
  const grid = requestGrid(CAL);
  assert.deepEqual(shadeWeekends(grid, null), grid);
  const header = readXml(blank(), 'Contents/header.xml');
  assert.equal(weekendFill(header, '없는번호'), null);
});
