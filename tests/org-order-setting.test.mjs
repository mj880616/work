// MULTI-노조사용자 ②-3(D5, S50-13): 담당조직 묶음·순서와 보고 캘린더 이름은 사람마다 내 프로필 설정(view_prefs)에 있다.
// - 운영자 값은 migration 한 곳에만 있고(화면 코드에는 없음), 시험 대역 두 곳(tests/org-order-fixture.mjs·화면 fixture용 helpers/org-order-prefs.js)이 그 값과 같다.
// - 보고 설정 칸의 글 ↔ 값 바꾸기가 서버 검사와 같은 모양을 만든다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {OPERATOR_ORG_ORDER, OPERATOR_REPORT_CALENDAR} from './org-order-fixture.mjs';
import {formatGroups, formatHidden, parseOrgOrder, parseCalendar, unknownNames} from '../app/report-settings-model.mjs';
import {validValue} from '../app/view-prefs.js';
import {summaryText} from '../app/report-settings.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));

test('운영자 값: migration이 옮기는 값 = 시험 대역 두 곳, 화면 코드에는 이름 없음', () => {
  const sql = read('supabase/migrations/20261105131500_profile_view_prefs_org_order.sql');
  const update = sql.slice(sql.indexOf('update public.app_profiles'), sql.indexOf("where user_id in", sql.indexOf('update public.app_profiles')));
  const groups = [...update.matchAll(/jsonb_build_object\('name', '([^']+)', 'orgs', jsonb_build_array\(([^)]*)\)\)/g)]
    .map(m => ({name: m[1], orgs: [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])}));
  const hidden = [...update.match(/'hidden', jsonb_build_array\(([^)]*)\)/)[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  const calendar = update.match(/'report_calendar', '([^']+)'/)[1];
  assert.deepEqual({groups, hidden}, plain(OPERATOR_ORG_ORDER));
  assert.equal(calendar, OPERATOR_REPORT_CALENDAR);
  assert.equal(validValue('org_order', plain(OPERATOR_ORG_ORDER)), true);
  // 화면 시험 fixture 대역도 같은 값.
  const window = {};
  vm.runInNewContext(read('tests/app-e2e/helpers/org-order-prefs.js'), {window});
  assert.deepEqual(plain(window.KPTUViewPrefs.get('org_order')), plain(OPERATOR_ORG_ORDER));
  assert.equal(window.KPTUViewPrefs.get('report_calendar'), OPERATOR_REPORT_CALENDAR);
  // 화면 코드: 묶음 이름·순서와 보고 캘린더 이름을 코드에 두지 않는다(설정 한 곳에서 읽음).
  const order = read('app/organization-order.js');
  for (const g of OPERATOR_ORG_ORDER.groups) { assert.ok(!order.includes(`'${g.name}'`), g.name); for (const n of g.orgs) assert.ok(!order.includes(n), n); }
  assert.ok(!order.includes(OPERATOR_ORG_ORDER.hidden[0]));
  for (const file of ['app/journal-weekly.js', 'app/journal-hwpx.js', 'app/calendar-plus.js', 'app/project-system-v3.js']) {
    const code = read(file).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!code.includes(`'${OPERATOR_REPORT_CALENDAR}'`) && !code.includes(`"${OPERATOR_REPORT_CALENDAR}"`) && !code.includes('REPORT_CALENDAR ='), file);
  }
  assert.match(read('app/report-calendar.mjs'), /KPTUViewPrefs\?\.get\?\.\('report_calendar'\)/);
});

test('보고 설정 글 ↔ 값: 되돌려 쓰면 같은 값, 비우면 지움(null), 틀린 모양은 한 줄 안내', () => {
  const text = formatGroups(OPERATOR_ORG_ORDER), hiddenText = formatHidden(OPERATOR_ORG_ORDER);
  assert.equal(text.split('\n').length, 4);
  assert.deepEqual(parseOrgOrder(text, hiddenText), {ok: true, value: plain(OPERATOR_ORG_ORDER)});
  assert.deepEqual(parseOrgOrder('', ' '), {ok: true, value: null});
  assert.deepEqual(parseOrgOrder('', '가, 나'), {ok: true, value: {groups: [], hidden: ['가', '나']}});
  // 쓰기 편하게: 전각 쌍점·가운뎃점 나눔, 빈 줄·앞뒤 빈칸·같은 이름 겹침은 정리(앞 묶음이 이김).
  assert.deepEqual(parseOrgOrder(' 가묶음 ： 가짜노조 · 나짜지부 , 가짜노조\n\n나묶음: 가짜노조, 다짜지부', ''),
    {ok: true, value: {groups: [{name: '가묶음', orgs: ['가짜노조', '나짜지부']}, {name: '나묶음', orgs: ['다짜지부']}], hidden: []}});
  for (const [g, h] of [['쌍점 없는 줄', ''], [': 가', ''], ['가:', ''], ['가'.repeat(21) + ': 나', ''], [Array.from({length: 13}, (_, i) => `묶음${i}: 조직${i}`).join('\n'), ''],
    ['가: ' + Array.from({length: 41}, (_, i) => `조직${i}`).join(','), ''], ['가: ' + '나'.repeat(61), ''], ['', Array.from({length: 41}, (_, i) => `조직${i}`).join(',')], ['', '나'.repeat(61)]]) {
    const r = parseOrgOrder(g, h);
    assert.equal(r.ok, false, g.slice(0, 30));
    assert.match(r.error, /[가-힣]/);
  }
  assert.deepEqual(parseCalendar('  업무 달력 '), {ok: true, value: '업무 달력'});
  assert.deepEqual(parseCalendar(''), {ok: true, value: null});
  assert.equal(parseCalendar('가'.repeat(61)).ok, false);
  assert.deepEqual(unknownNames(OPERATOR_ORG_ORDER, [{name: '전국철도노동조합'}]).length, 13);
  assert.equal(summaryText(null, ''), '담당조직 묶음 없음(가나다순) · 보고 캘린더 미지정');
  assert.equal(summaryText(OPERATOR_ORG_ORDER, OPERATOR_REPORT_CALENDAR), `담당조직 묶음 4개 · 보고 캘린더 '${OPERATOR_REPORT_CALENDAR}'`);
});
