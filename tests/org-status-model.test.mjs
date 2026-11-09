import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dayLabel, periodLabel, validEnd, nextOrder, overviewRows, overviewOlder, cleanBody, sortRows, splitRows, weeklyLines, siteLinesFromTable, SHOWN, ROWS_MAX} from '../app/org-status-model.mjs';

// DESK-현황표: 담당조직 [현황 표]와 주간보고 '3. 2) 투쟁 사업장 현황' 그 조직 칸이 같은 판정을 쓴다.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const R = (id, day, body, sort_order, source = 'user', evidence = []) => ({id, day, body, sort_order, source, evidence});

test('날짜 표기와 글 다듬기(DB 검사와 같은 200자·제어문자 없음)', () => {
  assert.equal(dayLabel('2026-10-29'), '10.29.(목)');
  assert.equal(dayLabel('2026-10-26'), '10.26.(월)');
  assert.equal(dayLabel('2026-02-30'), '');
  assert.equal(cleanBody('  지노위\n2차\t조정 '), '지노위 2차 조정');
  assert.equal([...cleanBody('가'.repeat(250))].length, 200);
});

test('순서(DESK-현황오름차순): 시작일 오름차순, 같은 날은 sort_order 적은 순 · 가장 최근 4줄이 보이고 주간보고 칸도 같은 4줄(오름차순)', () => {
  const rows = [R('a', '2026-10-01', '옛 일', 5), R('b', '2026-10-29', '지노위 2차 조정회의 — 조정 종료(쟁의권 확보)', 0), R('c', '2026-10-26', '조합원 총력 결의대회', 1),
    R('d', '2026-10-20', '교섭 결렬', 2), R('e', '2026-10-15', '쟁의 결의', 2), R('f', '2026-10-10', '조정 신청', 3), R('g', '2026-10-26', '같은 날 두 번째', 0)];
  assert.deepEqual(sortRows(rows).map(r => r.id), ['a', 'f', 'e', 'd', 'g', 'c', 'b']);
  const {shown, older} = splitRows(rows);
  assert.equal(shown.length, SHOWN);
  assert.deepEqual(shown.map(r => r.id), ['d', 'g', 'c', 'b'], '가장 오래된 줄이 아니라 가장 최근 줄이 보인다');
  assert.deepEqual(older.map(r => r.id), ['a', 'f', 'e']);
  assert.deepEqual(weeklyLines(rows), ['- 10.20.(화) 교섭 결렬', '- 10.26.(월) 같은 날 두 번째', '- 10.26.(월) 조합원 총력 결의대회', '- 10.29.(목) 지노위 2차 조정회의 — 조정 종료(쟁의권 확보)']);
  assert.deepEqual(weeklyLines([]), []);
  // 전체 표: 가장 최근 3줄을 오름차순으로, 그 앞 줄은 older(철도노조 예: 10.15 → 10.29 → 11.11)
  const rail = [R('x', '2026-11-11', 'C', 0), R('y', '2026-10-15', 'A', 0), R('z', '2026-10-29', 'B', 0), R('w', '2026-09-01', '옛', 0)];
  assert.deepEqual(overviewRows(rail, 3).map(r => r.id), ['y', 'z', 'x']);
  assert.deepEqual(overviewOlder(rail, 3).map(r => r.id), ['w']);
  assert.deepEqual(overviewRows([R('q', '2026-10-01', 'Q', 0)], 3).map(r => r.id), ['q']);
  assert.deepEqual(overviewOlder([R('q', '2026-10-01', 'Q', 0)], 3), []);
});

test('날짜 표기 한 곳(DESK-일정기간): 하루 / 같은 달 기간 / 달 넘는 기간 / 끝이 비었거나 같으면 하루 · 끝나는 날 판정', () => {
  assert.equal(periodLabel('2026-11-02', null), '11.2.(월)');
  assert.equal(periodLabel('2026-11-02', ''), '11.2.(월)');
  assert.equal(periodLabel('2026-11-02', '2026-11-02'), '11.2.(월)');
  assert.equal(periodLabel('2026-11-02', '2026-11-05'), '11.2.~11.5.');
  assert.equal(periodLabel('2026-10-30', '2026-11-02'), '10.30.~11.2.');
  assert.equal(periodLabel('2026-12-30', '2027-01-02'), '2026.12.30.~2027.1.2.');
  assert.equal(periodLabel('bad', '2026-11-05'), '');
  assert.ok(validEnd('2026-11-02', null) && validEnd('2026-11-02', '') && validEnd('2026-11-02', '2026-11-02') && validEnd('2026-11-02', '2026-11-05'));
  assert.ok(!validEnd('2026-11-02', '2026-11-01') && !validEnd('2026-11-02', '2026-02-30') && !validEnd('2026-11-02', 'x'));
  assert.deepEqual(weeklyLines([{id: 'a', day: '2026-11-02', end_day: '2026-11-05', body: '파업 찬반투표', sort_order: 0}]), ['- 11.2.~11.5. 파업 찬반투표']);
});

test('새 줄 번호: 지금 가장 큰 번호 다음(같은 날은 넣은 순서), 1000을 넘지 않음', () => {
  assert.equal(nextOrder([]), 0);
  assert.equal(nextOrder([R('a', '2026-10-29', 'A', 3), R('b', '2026-10-26', 'B', 1)]), 4);
  assert.equal(nextOrder([R('a', '2026-10-29', 'A', 1000)]), 1000);
});

test('주간보고 칸: 표가 있으면 [쟁의 단계 줄] + 표 줄, 없으면 null(직전 확정본 그대로)', () => {
  const stage = t => /^- 쟁의발생 결의\(/.test(t);
  const rows = [R('b', '2026-10-29', '지노위 2차 조정회의', 0)];
  assert.deepEqual(siteLinesFromTable(['- 쟁의발생 결의(10.20)', '- 지난 확정본 줄'], rows, stage), ['- 쟁의발생 결의(10.20)', '- 10.29.(목) 지노위 2차 조정회의']);
  assert.equal(siteLinesFromTable(['- 지난 확정본 줄'], [], stage), null);
});

test('ORG-기록하나로 O-5: 조직 상세의 [현황 표] 소탭·쓰기는 지웠고, 옛 표 읽기만 주간보고 옛 길이 쓴다(O-6에서 정리)', () => {
  const wd = read('app/workplace-detail.js'), st = read('app/org-status-table.js'), hw = read('app/journal-hwpx.js');
  assert.doesNotMatch(wd, /wdSubTabs|data-wd-sub=|paintStatusTable|org-status-table\.js/);
  assert.match(st, /app_org_status_rows/);assert.doesNotMatch(st, /kind: 'org_status_rows'|data-st-refill|maybeFirstFill|data-st-field/);
  assert.match(hw, /readStatusRows\(/);assert.match(hw, /siteLinesFromTable\(/);
});

test('같은 줄 판정(sameLine·similarBody): 같은 날(±1일)·비슷한 내용 — 지난주 가져오기·제안 거르기가 쓴다', async () => {
  const m = await import('../app/org-status-model.mjs');
  assert.equal(m.sameLine({day: '2026-10-29', body: '하반기 임단협 투쟁계획 승인'}, {day: '2026-10-29', body: '하반기 임단협 투쟁계획 승인함'}), true);
  assert.equal(m.sameLine({day: '2026-10-15', body: '쟁의행위 찬반투표 가결'}, {day: '2026-10-16', body: '쟁의행위 찬반투표 결과 가결'}), true);
  assert.equal(m.sameLine({day: '2026-10-29', body: '중노위 조정 신청'}, {day: '2026-10-29', body: '중노위 조정 결정'}), false);
  assert.equal(m.sameLine({day: '2026-10-29', body: '중노위 조정 신청'}, {day: '2026-11-29', body: '중노위 조정 신청'}), false);
  assert.equal(m.refillPlan, undefined, '[기록에서 다시 채우기 (AI)]는 지웠다(WEEKLY-메뉴짝짓기 P7)');
});

test('DESK-전체현황표 → ORG-기록하나로 O-4 화면 연결: 소탭 [목록|전체 표]는 org-overview.js 하나, 칸은 조직보고 창 공용 부품(record-window-view.js)이 그린다', () => {
  const ov = read('app/org-overview.js'), so = read('app/suborganizations.js'), st = read('app/org-status-table.js'), wl = read('app/weekly-org-lines.js');
  assert.match(so, /import\('\.\/org-overview\.js'\)/);
  assert.match(ov, /data-so-view="list"[^>]*>목록</);assert.match(ov, /data-so-view="table"[^>]*>전체 표</);
  assert.match(ov, /import \{[^}]*createRecordWindow[^}]*\} from '\.\/record-window-view\.js'/);
  assert.doesNotMatch(ov, /weekly-org-lines\.js/, '담당조직 표는 옛 주별 줄 부품을 쓰지 않는다');
  assert.match(ov, /import \{[^}]*weekPickHtml[^}]*\} from '\.\/week-pick\.js'/);
  assert.doesNotMatch(ov, /app_org_status_rows|app_weekly_org_lines|app_report_line_marks|app_suborganization_updates/, '표 이름은 부품 안에만');
  assert.doesNotMatch(ov, /data-oa-fill|data-oa-refill-all|AI로 채우기|모두 다시 채우기/, '[AI로 채우기]·[모두 다시 채우기 (AI)]는 없앴다(설계 3.1)');
  assert.doesNotMatch(ov + wl, /\b(?:local|session)Stor/, '브라우저 저장소를 쓰지 않는다');
  assert.match(ov, /name: 'orgall'/);
  assert.match(wl, /data-wl-toggle/);assert.match(wl, /외 \$\{parts\.older\.length\}줄/);
});

test('UI-버튼간격: 공용 간격은 토큰 하나(--ds-button-gap)이고 .btn-row가 쓰며, 나란한 버튼은 .btn-row 줄 안에 둔다(담당조직 표)', () => {
  assert.match(read('app/theme-tokens.css'), /--ds-button-gap:\s*8px/);
  assert.match(read('app/ui-standard.css'), /\.btn-row\{[^}]*gap:var\(--ds-button-gap,\s*8px\)/);
  for (const f of ['app/org-overview.js', 'app/weekly-org-lines.js', 'app/record-window-view.js']) {
    const src = read(f);
    // 템플릿 안에서 </button> 바로 뒤에 <button 또는 <span 이 붙는 줄(사이 간격 0): 같은 줄 앞쪽에 btn-row 클래스가 있어야 한다.
    const all = src.split('\n');
    for (const [i, line] of all.entries()) {
      if (/role="tablist"/.test(line)) continue; // 소탭(붙은 세그먼트)은 한 덩어리 부품
      if (!/<\/button>(?:<button|<span class="oa-empty)/.test(line) && !/<span class="oa-empty"[^>]*>[^<]*<\/span><button/.test(line)) continue;
      assert.match(all.slice(i, i + 3).join('\n'), /btn-row/, `${f}:${i + 1} 나란한 버튼이 .btn-row 밖에 있다`);
    }
  }
  // 위쪽 [주 고르기]·[복사] 줄과 제안 줄 버튼은 btn-row
  const ov = read('app/org-overview.js');
  assert.match(ov, /class="oa-bar btn-row"/);assert.match(read('app/weekly-org-lines.js'), /class="wl-btns btn-row"/);
});
