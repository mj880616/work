import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {makeFakeReport} from '../scripts/weekly-hwpx/fixture.mjs';
import {openHwpx, packHwpx, validateHwpx, readXml, setXml, headerStyles} from '../app/weekly-hwpx/hwpx.mjs';
import {walk, kid, kids, textOf} from '../app/weekly-hwpx/xml.mjs';
import {extractBlankTemplate} from '../app/weekly-hwpx/template.mjs';
import {buildReport, readReport, findTables, paraNumbering, CELL_STYLE} from '../app/weekly-hwpx/report.mjs';
import {personalReportFromTeam, reportOrgOrder} from '../app/weekly-hwpx/delta.mjs';

// WEEKLY-출력정리 (2026-10-23 사용자 지적 12:25): 주간보고 한글 파일 출력 ① 표 칸 문단 자동 번호 없음 + 표내부(Ctrl+8) ② 산하조직 표는
// 내 담당 조직 전부를 조직보고 순서로(내용 없으면 빈 칸) ③ 5. 주요 일정은 '공공운수노조' 달력만(journal-weekly.test.mjs). 가짜 내용만.
const fake = () => makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib));
const sectionOf = pkg => readXml(pkg, 'Contents/section0.xml');

// 팀 확정본에서 칸 첫 문단이 한글 "문단 번호"(paraPr hh:heading type=NUMBER)였던 경우를 만든다: 문단 모양 6번에 번호를 달고, 모든 표의
// 내용 칸 첫 문단과 '바탕글' 문단 하나를 그 모양으로 바꾼다.
function numberedConfirmed() {
  const pkg = fake();
  const header = readXml(pkg, 'Contents/header.xml');
  for (const n of walk(header.root)) if (n.name === 'hh:paraPr' && n.attrs.id === '6') for (const h of walk(n)) if (h.name === 'hh:heading') Object.assign(h.attrs, {type: 'NUMBER', idRef: '1', level: '0'});
  setXml(pkg, 'Contents/header.xml', header);
  const sec = sectionOf(pkg);
  for (const tbl of [...walk(sec.root)].filter(n => n.name === 'hp:tbl')) for (const tr of kids(tbl, 'hp:tr').slice(1)) for (const tc of kids(tr, 'hp:tc')) {
    const p = kids(kid(tc, 'hp:subList'), 'hp:p')[0];
    if (p) p.attrs.paraPrIDRef = '6';
  }
  const body = kids(sec.root, 'hp:p').find(p => p.attrs.styleIDRef === '0' && !textOf(p).trim());
  body.attrs.paraPrIDRef = '6';
  setXml(pkg, 'Contents/section0.xml', sec);
  return pkg;
}
const SITE_LINES = ['1. 개요', '- 2026년 가짜 투쟁 경과', '2. 주요 경과', '- 9/29~10/1 가짜 파업', '  (결과) 가짜 합의'];

test('① 표 칸 문단: 확정본 칸이 번호 문단이어도 출력은 번호·글머리표 없는 표내부(Ctrl+8) 문단, 글의 표시·들여쓰기는 그대로', () => {
  const source = numberedConfirmed();
  const header = readXml(source, 'Contents/header.xml');
  const numbering = paraNumbering(header);
  assert.equal(numbering.get('6'), 'NUMBER');
  const cellStyle = headerStyles(header).find(s => s.name === CELL_STYLE);
  assert.deepEqual([cellStyle.id, CELL_STYLE], ['7', '표내부']); // 통일 양식 8번째 스타일 = Ctrl+8 (docs/hwp-style-map.md 2절)
  // 고치기 전 모습: 빈 서식의 칸 견본이 번호 문단 모양을 그대로 물려받는다(그래서 칸의 모든 줄에 1. 2. 3.…이 붙었다).
  const template = extractBlankTemplate(source);
  const protoCells = [...walk(sectionOf(template).root)].filter(n => n.name === 'hp:tc' && kids(n, 'hp:subList').length && n.attrs.header !== '1');
  assert.ok(protoCells.some(tc => kids(kid(tc, 'hp:subList'), 'hp:p')[0].attrs.paraPrIDRef === '6'));
  const data = {title: '가짜 주간보고', date: '2026년 10월 26일(월)', requests: [{day: '10.28.(수)', items: [{what: '10:00 / 가짜 행사', who: ['가짜 임원 갑', '가짜 임원 을']}]}],
    summary: [{area: ['가짜영역'], rows: [{task: ['가짜과제'], progress: ['- 가짜 진행', '- 가짜 계획'], owner: ['가짜담당']}]}],
    sites: [{org: ['가짜조직 갑'], status: SITE_LINES}], orgs: [{org: ['가짜조직 갑'], status: ['- 가짜 소식 하나', '- 가짜 소식 둘']}],
    details: [{heading: '(1) 가짜 회의', box: [{label: '제목', lines: ['가짜 회의']}, {label: '내용', lines: ['1. 가짜 안건', '- 가짜 결정']}]}],
    rallies: [{when: ['10.28.(수)'], name: ['가짜 집회'], attend: ['가짜 인원']}], schedule: ['- 가짜 본부 일정'],
    calendar: [{day: '10.27.(화)', items: [{what: '10:00 / 가짜 일정', who: ['가짜담당']}]}], calendarNotes: ['※ 10.30.(금) 가짜담당 연차']};
  const {pkg} = buildReport(template, data);
  assert.deepEqual(validateHwpx(packHwpx(pkg, zlib), zlib).errors, []);
  const sec = sectionOf(pkg);
  const cells = [...walk(sec.root)].filter(n => n.name === 'hp:tc');
  const cellParas = cells.flatMap(tc => kids(kid(tc, 'hp:subList'), 'hp:p'));
  assert.ok(cellParas.length > 20);
  for (const p of cellParas) {
    assert.equal(p.attrs.styleIDRef, cellStyle.id, '표 칸 문단 스타일 = 표내부');
    assert.equal(numbering.get(p.attrs.paraPrIDRef) ?? 'NONE', 'NONE', '표 칸 문단에 자동 번호 없음');
  }
  // 표 밖 문단도 번호 문단 모양을 쓰지 않는다.
  for (const p of [...walk(sec.root)].filter(n => n.name === 'hp:p')) assert.equal(numbering.get(p.attrs.paraPrIDRef) ?? 'NONE', 'NONE');
  // 글은 쓴 그대로(자기 표시 '1.'·'-'·들여쓰기 공백), 한 줄 = 한 문단.
  const site = findTables(pkg).site;
  assert.deepEqual(site.rows[0][1].lines, SITE_LINES);
  assert.deepEqual(readReport(pkg).sites[0].status, SITE_LINES);
});

test('① 번호 없는 확정본(지금 시험 양식)은 칸 문단 모양(가운데 맞춤 등)을 그대로 쓴다', () => {
  const template = extractBlankTemplate(fake());
  const {pkg} = buildReport(template, {title: 't', date: 'd', requests: [{day: '10.28.(수)', items: [{what: '가짜', who: ['가짜 임원']}]}]});
  const req = [...walk(sectionOf(pkg).root)].filter(n => n.name === 'hp:tbl')[0];
  const body = kids(req, 'hp:tr')[1];
  // 날짜 칸은 확정본처럼 가운데 맞춤 문단 모양(13), 내용 칸은 표내부 기본(7). 둘 다 스타일은 표내부.
  assert.deepEqual(kids(body, 'hp:tc').map(tc => [kids(kid(tc, 'hp:subList'), 'hp:p')[0].attrs.styleIDRef, kids(kid(tc, 'hp:subList'), 'hp:p')[0].attrs.paraPrIDRef]),
    [['7', '13'], ['7', '7'], ['7', '13']]);
});

// 조직보고 순서(가나다순). 아래 13개 이름은 저장소 app/organization-order.js에 이미 있는 공개 조직 이름이다.
const THIRTEEN = ['전국철도노동조합', '서울교통공사노동조합', '부산지하철노동조합', '대구교통공사노동조합', '인천교통공사노동조합', '서해선지부', '신분당선지부',
  '지티엑스에이운영지부', '공항철도지부', '메트로9호선노동조합', '서울교통공사9호선지부', '김포도시철도지부', '용인경전철지부'];
test('② 조직보고 순서: 13개 조직은 정해진 가나다순(공항철도지부 → … → 지티엑스에이운영지부)', () => {
  assert.deepEqual(reportOrgOrder(THIRTEEN.map(name => ({name}))).map(o => o.name), ['공항철도지부', '김포도시철도지부', '대구교통공사노동조합', '메트로9호선노동조합',
    '부산지하철노동조합', '서울교통공사9호선지부', '서울교통공사노동조합', '서해선지부', '신분당선지부', '용인경전철지부', '인천교통공사노동조합', '전국철도노동조합', '지티엑스에이운영지부']);
});

test('② 4. 산하조직 현황: 내 담당 조직은 확정본에 줄이 없어도 모두 조직보고 순서로, 내용이 없으면 조직명만·현황 칸 빈칸', () => {
  const team = readReport(fake());
  assert.deepEqual(team.orgs.map(o => o.org.join('')), ['가짜조직 갑', '가짜조직 을', '가짜조직 병']);
  const orgList = [{name: '가짜조직 병'}, {name: '가짜 새 조직'}, {name: '가짜조직 갑', aliases: []}, {name: '가짜조직 가'}];
  const mine = personalReportFromTeam(team, '가짜담당 갑', {myOrgs: orgList.map(o => o.name), orgList});
  assert.deepEqual(mine.orgs.map(o => [o.org.join(''), o.status.length > 0]), [
    ['가짜 새 조직', false], ['가짜조직 가', false], ['가짜조직 갑', true], ['가짜조직 병', true]]);
  // 내 담당이 아닌 조직(을)은 없다. 투쟁 사업장 표는 지금처럼 확정본의 내 담당 조직 줄만.
  assert.ok(!mine.orgs.some(o => o.org.join('') === '가짜조직 을'));
  assert.deepEqual(mine.sites.map(o => o.org.join('')), ['가짜조직 갑', '가짜조직 병']);
  // 한글 파일: 4줄 모두, 빈 조직은 현황 칸이 빈 문단 하나.
  const {pkg} = buildReport(extractBlankTemplate(fake()), mine);
  assert.deepEqual(validateHwpx(packHwpx(pkg, zlib), zlib).errors, []);
  const org = findTables(pkg).org;
  assert.deepEqual(org.rows.map(r => r[0].lines.join('')), ['가짜 새 조직', '가짜조직 가', '가짜조직 갑', '가짜조직 병']);
  assert.deepEqual(org.rows.slice(0, 2).map(r => r[1].lines), [[''], ['']]);
  // 내용을 아무것도 찾지 못한 주에도 줄 수·순서가 같다.
  const quiet = personalReportFromTeam({...team, orgs: []}, '가짜담당 갑', {orgList});
  assert.deepEqual(quiet.orgs.map(o => [o.org.join(''), o.status]), [['가짜 새 조직', []], ['가짜조직 가', []], ['가짜조직 갑', []], ['가짜조직 병', []]]);
});
