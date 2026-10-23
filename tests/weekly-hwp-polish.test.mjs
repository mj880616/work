import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {makeFakeReport} from '../scripts/weekly-hwpx/fixture.mjs';
import {openHwpx, packHwpx, validateHwpx, readXml, setXml} from '../app/weekly-hwpx/hwpx.mjs';
import {walk, kid, kids} from '../app/weekly-hwpx/xml.mjs';
import {extractBlankTemplate} from '../app/weekly-hwpx/template.mjs';
import {buildReport, readReport, findTables, requestsFromTable} from '../app/weekly-hwpx/report.mjs';
import {fileNameFor, fileNamePart, nearestTarget, dropPastPlan, pastPlanLines, lineDays, hwpKind, hwp5Header, startDraft, editableRows, editableOrgs,
  assembleDraft, buildHwpx, prepareConfirmed, openConfirmed, engineReason} from '../app/weekly-hwpx/draft.mjs';

// WEEKLY-한글파일다듬기 (2026-10-23 사용자 요청 11:35·11:38·12:02·12:12·12:43, #1034 남은 위험). 이름·조직은 가짜 또는 저장소에 이미 있는 공개 조직 이름.
const fake = () => makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib));

test('④ 파일 이름: 주간보고_보고일8자리_이름.hwpx, HWP는 같은 이름 .hwp, 이름이 없으면 날짜까지만, 파일에 못 쓰는 글자·띄어쓰기는 뺌', () => {
  assert.equal(fileNameFor('2026-10-26', '가짜 담당'), '주간보고_20261026_가짜담당.hwpx');
  assert.equal(fileNameFor('2026-10-26', '가짜담당', 'hwp'), '주간보고_20261026_가짜담당.hwp');
  assert.equal(fileNameFor('2026-10-26'), '주간보고_20261026.hwpx');
  assert.equal(fileNameFor('2026-10-26', '  '), '주간보고_20261026.hwpx');
  assert.equal(fileNamePart('가/짜:담*당?"<>|'), '가짜담당');
  assert.equal(fileNamePart('..가짜..'), '가짜');
  // 한글 이름은 NFC(맥에서 온 NFD 이름도 같은 글자로)
  assert.equal(fileNameFor('2026-10-26', '가짜'.normalize('NFD')), '주간보고_20261026_가짜.hwpx');
});

const ORG_TARGETS = ['공항철도지부', '부산지하철노조', '서울교통공사9호선지부', '서해선지부'].map((name, i) => ({value: `orgs:${i}`, names: [name], kind: 'org'}));
const ROW_TARGETS = [['기본 사업', '정책연구'], ['철도지하철', '궤도 공동투쟁 지원'], ['철도지하철', '민영화 저지'], ['조직', '신규 조직화']]
  .map((names, i) => ({value: `summary:${i}`, names, kind: 'row'}));
test('③ 붙일 줄 기본값: 목록 첫 줄이 아니라 이름이 가장 가까운 줄, 없거나 애매하면 빈 값(줄 고르기)', () => {
  // 사용자 지적 사례: 부산지하철노동조합·서울교통공사노동조합 기록이 첫 줄(공항철도지부)로 골라졌다 → 약칭(…노조)은 별칭 과제 전까지 빈 값.
  assert.equal(nearestTarget('부산지하철노동조합', ORG_TARGETS), '');
  assert.equal(nearestTarget('서울교통공사노동조합', ORG_TARGETS), '');
  // 이름을 품으면 맞음(띄어쓰기 무시)
  assert.equal(nearestTarget('부산 지하철노조', ORG_TARGETS), 'orgs:1');
  assert.equal(nearestTarget('서해선', ORG_TARGETS), 'orgs:3');
  // 철도지하철 › 궤도 공동투쟁: 첫 줄(기본 사업 › 정책연구)이 아니라 세부 과제 이름이 가까운 줄
  assert.equal(nearestTarget('철도지하철 › 궤도 공동투쟁', ROW_TARGETS), 'summary:1');
  // 사업영역만 같고 세부 과제가 다르면, 그 사업영역 줄이 둘 이상이라 애매 → 빈 값. 하나면 그 줄.
  assert.equal(nearestTarget('철도지하철 › 다른 과제', ROW_TARGETS), '');
  assert.equal(nearestTarget('조직 › 다른 과제', ROW_TARGETS), 'summary:3');
  // 짧은 낱말(2자)로는 맞추지 않음, 맞는 줄 없음 → 빈 값
  assert.equal(nearestTarget('기타 › 정책', ROW_TARGETS), '');
  assert.equal(nearestTarget('', ROW_TARGETS), '');
  assert.equal(nearestTarget('정책연구', ROW_TARGETS), 'summary:0');
});

test('⑤ 지난 예정: 보고일보다 앞 날짜 줄의 \'예정\'만 뺀다(완료 붙이지 않음), 보고일 당일·뒤·날짜 없는 줄·다른 말은 그대로', () => {
  const day = '2026-10-26';
  const cases = [
    ['- 10.20.(화) 공청회 예정', '- 10.20.(화) 공청회'],
    ['- 보고서 제출 예정(10.22)', '- 보고서 제출(10.22)'],
    ['- 2026.10.21 간담회(예정)', '- 2026.10.21 간담회'],
    ['- 10월 23일 면담 예정.', '- 10월 23일 면담.'],
    ['- 10/20 제출 예정', '- 10/20 제출'],
    ['- 10.20~23 순회 예정', '- 10.20~23 순회'],
    ['- 10.20~27 순회 예정', '- 10.20~27 순회 예정'], // 기간 끝이 보고일 뒤
    ['- 10.26.(월) 상집 예정', '- 10.26.(월) 상집 예정'], // 보고일 당일
    ['- 10.27 집회 예정', '- 10.27 집회 예정'],
    ['- 날짜 없는 일 예정', '- 날짜 없는 일 예정'],
    ['- 10:00 회의 예정', '- 10:00 회의 예정'], // 시각은 날짜가 아님
    ['- 10.20 예정대로 진행', '- 10.20 예정대로 진행'],
    ['- 10.20 면담 예정임', '- 10.20 면담 예정임'],
    ['- 12.28 송년회 예정', '- 12.28 송년회 예정'], // 올해 12월(보고일에 가까운 해)
    ['- 9.30 기한 제출 예정', '- 9.30 기한 제출'],
  ];
  for (const [from, to] of cases) assert.equal(dropPastPlan(from, day), to, from);
  assert.deepEqual(lineDays('- 1.5 신년회', '2026-12-28'), ['2027-01-05']); // 해 넘김: 보고일에 가까운 해
  const r = pastPlanLines(['- 10.20 공청회 예정', '- 그대로'], day);
  assert.deepEqual(r, {lines: ['- 10.20 공청회', '- 그대로'], changed: [{from: '- 10.20 공청회 예정', to: '- 10.20 공청회'}]});
});

test('⑤ 한글 파일: \'예정\'을 뺀 줄은 바탕과 달라 파란 글씨(바뀐 줄)로 나간다', async () => {
  const {team, template} = prepareConfirmed(await openConfirmed(packHwpx(fake(), zlib)));
  const base = startDraft(team, {me: '가짜담당 갑', myOrgs: [], date: ''});
  const rows = editableRows(base, '가짜담당 갑');
  const edits = {summary: new Map([[rows[0].index, ['- 10.20 가짜 공청회 예정']]])};
  const data = assembleDraft(base, {summary: new Map([[rows[0].index, pastPlanLines(edits.summary.get(rows[0].index), '2026-10-26').lines]])});
  const back = readReport(openHwpx(await buildHwpx(template, data), zlib));
  assert.deepEqual(back.summary[0].rows[0].progress, ['- 10.20 가짜 공청회']);
});

// 확정본 칸의 줄마다 문단 모양(왼쪽 여백)이 다른 경우를 만든다: 투쟁 사업장·산하조직·요약 칸의 둘째 줄부터 들여쓴 문단 모양(6: 왼쪽 여백 4000).
function indentedConfirmed() {
  const pkg = fake();
  const sec = readXml(pkg, 'Contents/section0.xml');
  for (const tbl of [...walk(sec.root)].filter(n => n.name === 'hp:tbl')) for (const tr of kids(tbl, 'hp:tr').slice(1)) for (const tc of kids(tr, 'hp:tc')) {
    const ps = kids(kid(tc, 'hp:subList'), 'hp:p');
    ps.slice(1).forEach(p => { p.attrs.paraPrIDRef = '6'; });
  }
  setXml(pkg, 'Contents/section0.xml', sec);
  return pkg;
}
const parasOf = (pkg, key) => findTables(pkg)[key].rows.map(r => r.map(c => c?.paras ?? null));
test('⑥ 들여쓰기: 확정본 칸 줄마다 다른 문단 모양(왼쪽 여백)이 개인본에도 줄마다 남는다, 고친 줄·새 줄은 이웃 줄 모양', async () => {
  const source = indentedConfirmed();
  const {team, template} = prepareConfirmed(await openConfirmed(packHwpx(source, zlib)));
  const me = '가짜담당 갑';
  const base = startDraft(team, {me, myOrgs: ['가짜조직 갑', '가짜조직 병'], date: ''});
  const rows = editableRows(base, me), orgs = editableOrgs(base, 'orgs');
  assert.ok(rows[0].lines.length >= 2);
  // 바탕 그대로
  const out = openHwpx(await buildHwpx(template, assembleDraft(base, {})), zlib);
  assert.deepEqual(validateHwpx(packHwpx(out, zlib), zlib).errors, []);
  const summaryParas = findTables(out).summary.rows[0][2].paras;
  assert.equal(summaryParas.length, rows[0].lines.length);
  assert.ok(summaryParas.slice(1).every(id => id === '6'), '둘째 줄부터 들여쓴 모양 그대로');
  assert.notEqual(summaryParas[0], '6');
  // 고친 줄(둘째 줄 자리)·새 줄(끝)은 이웃 줄 모양, 바탕 첫 줄은 그대로
  const lines = rows[0].lines;
  const edited = assembleDraft(base, {summary: new Map([[rows[0].index, [lines[0], `${lines[1]} 고침`, ...lines.slice(2), '- 가짜 새 줄']]]),
    orgs: new Map([[orgs[0].index, [...orgs[0].lines, '- 가짜 새 소식']]])});
  const out2 = openHwpx(await buildHwpx(template, edited), zlib);
  const p2 = findTables(out2).summary.rows[0][2].paras;
  assert.equal(p2[0], summaryParas[0]);
  assert.ok(p2.slice(1).every(id => id === '6'));
  const org = findTables(out2).org.rows.find(r => r[0].lines.join('') === '가짜조직 갑')[1];
  assert.equal(org.paras.at(-1), org.paras.length > 1 ? org.paras.at(-2) : org.paras[0]);
  // 모든 칸 문단은 여전히 표내부 스타일(#1034 ①), 번호 없음
  for (const tbl of [...walk(readXml(out2, 'Contents/section0.xml').root)].filter(n => n.name === 'hp:tc')) for (const p of kids(kid(tbl, 'hp:subList'), 'hp:p')) assert.equal(p.attrs.styleIDRef, '7');
});
test('⑥ 들여쓰기: 양식 머리에 없는 문단 모양 번호는 쓰지 않는다(견본 모양)', () => {
  const template = extractBlankTemplate(fake());
  const {pkg} = buildReport(template, {title: 't', date: 'd', orgs: [{org: ['가짜조직 갑'], status: ['- 가', '- 나'], paras: ['6', '999']}]});
  assert.deepEqual(validateHwpx(packHwpx(pkg, zlib), zlib).errors, []);
  const [, status] = findTables(pkg).org.rows[0];
  assert.equal(status.paras[0], '6');
  assert.notEqual(status.paras[1], '999');
});

test('⑥ 참석자만 남은 빈 일정 줄: 내용 칸이 합쳐진 줄의 참석자는 위 행사에 붙여 읽고, 만들 때 내용 없는 줄의 참석자 칸은 빈칸', () => {
  // 확정본 모양: 10.28.(수) 행사 하나(내용 칸 2줄 병합)에 참석 칸만 줄마다 따로, 그다음 날은 내용이 빈 칸.
  const t = {head: ['일', '시간/내용/장소', '참석 요청'], rows: [
    [{lines: ['10.28.(수)'], rs: 2}, {lines: ['10:00 / 가짜 행사'], rs: 2}, {lines: ['가짜 임원 갑'], rs: 1}],
    [null, null, {lines: ['가짜 임원 을'], rs: 1}],
    [{lines: ['10.29.(목)'], rs: 1}, {lines: [''], rs: 1}, {lines: ['가짜 임원 병'], rs: 1}],
  ]};
  assert.deepEqual(requestsFromTable(t), [
    {day: '10.28.(수)', items: [{what: '10:00 / 가짜 행사', who: ['가짜 임원 갑', '가짜 임원 을']}]},
    {day: '10.29.(목)', items: [{what: '', who: ['가짜 임원 병']}]},
  ]);
  const template = extractBlankTemplate(fake());
  const {pkg} = buildReport(template, {title: 't', date: 'd', requests: requestsFromTable(t), calendar: requestsFromTable(t)});
  for (const key of ['request', 'schedule']) {
    const rows = findTables(pkg)[key].rows.map(r => r.map(c => c?.lines.join('/') ?? null));
    assert.deepEqual(rows, [['10.28.(수)', '10:00 / 가짜 행사', '가짜 임원 갑/가짜 임원 을'], ['10.29.(목)', '', '']], key);
  }
});

test('② 바탕 파일 종류: 내용으로 판정(HWPX ZIP·HWP 5 OLE·HWP 3), HWP 5 머리의 암호·배포용 표시', async () => {
  const hwpx = new Uint8Array(readFileSync(new URL('./fixtures/hwp-lab/sample.hwpx', import.meta.url)));
  const hwp = new Uint8Array(readFileSync(new URL('./fixtures/hwp-lab/sample.hwp', import.meta.url)));
  assert.equal(hwpKind(hwpx), 'hwpx');
  assert.equal(hwpKind(hwp), 'hwp5');
  assert.equal(hwpKind(new TextEncoder().encode('HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05'.padEnd(64, '\0'))), 'hwp3');
  assert.equal(hwpKind(new Uint8Array(600)), null);
  assert.equal(hwpKind(new TextEncoder().encode('%PDF-1.7')), null);
  const head = hwp5Header(hwp);
  assert.deepEqual(head, {major: 5, password: false, distribution: false});
  assert.equal(hwp5Header(hwpx), null);
  // 암호 표시(속성 비트 1)를 켠 사본: FileHeader 스트림 안의 속성 값만 바꾼다.
  const locked = hwp.slice();
  const sig = new TextEncoder().encode('HWP Document File');
  let at = -1;
  for (let i = 0; i < locked.length - sig.length && at < 0; i++) if (sig.every((b, k) => locked[i + k] === b)) at = i;
  assert.ok(at > 0);
  locked[at + 36] |= 2;
  assert.equal(hwp5Header(locked).password, true);
  // 깨진 OLE는 null(엔진에 맡김)
  const broken = hwp.slice(0, 600);
  assert.equal(hwp5Header(broken), null);
});

test('② 엔진 실패 이유(짧은 말, 파일 내용 없음)', () => {
  assert.equal(engineReason(new Error('Request timeout: loadFile')), '시간 초과');
  assert.equal(engineReason(new Error('편집기를 불러오지 못했습니다.')), '변환기를 불러오지 못함');
  assert.equal(engineReason(new Error('Editor initialization timeout')), '시간 초과');
  assert.equal(engineReason(new Error('파일 로드 실패: 손상')), '파일을 열지 못함');
});
