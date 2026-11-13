// MULTI-노조사용자 ②-3(D5, S50-13): 담당조직 묶음·순서와 보고 캘린더 이름은 사람마다 내 프로필 설정(view_prefs)에 있다.
// - 운영자 값은 migration 한 곳에만 있고(화면 코드에는 없음), 시험 대역 두 곳(tests/org-order-fixture.mjs·화면 fixture용 helpers/org-order-prefs.js)이 그 값과 같다.
// - 내 프로필 '주간보고 일정 캘린더' 칸 값 검사와 조직 보고 화면 묶음 고치기(org-order-edit.mjs)가 서버 검사와 같은 모양을 만든다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {OPERATOR_ORG_ORDER, OPERATOR_REPORT_CALENDAR} from './org-order-fixture.mjs';
import {parseCalendar} from '../app/report-settings-model.mjs';
import {sectionsOf, moveOrg, moveGroup, renameGroup, ungroup, groupNameProblem, orderValue} from '../app/org-order-edit.mjs';
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

test('주간보고 일정 캘린더 값: 비우면 지움(null), 60자까지', () => {
  assert.deepEqual(parseCalendar('  업무 달력 '), {ok: true, value: '업무 달력'});
  assert.deepEqual(parseCalendar(''), {ok: true, value: null});
  assert.equal(parseCalendar('가'.repeat(61)).ok, false);
  assert.equal(summaryText(''), '미지정');
  assert.equal(summaryText(OPERATOR_REPORT_CALENDAR), `'${OPERATOR_REPORT_CALENDAR}'`);
  // 내 프로필 글자 칸(묶음·뺄 조직)은 없앴다(MULTI-다른담당자맞춤 ②).
  const src = read('app/report-settings.js');
  assert.doesNotMatch(src, /psReportGroups|psReportHidden|org_order/);
});

// MULTI-다른담당자맞춤 ②: 조직 보고 화면 묶음 고치기 규칙(org-order-edit.mjs). 값은 같은 org_order, 서버 검사와 같은 한도.
test('묶음 칸 나누기: 값 순서, 빈 묶음, 그 외 가나다순, 목록에 없는 묶음은 그리지 않음', () => {
  const list = ['전국철도노동조합', '서울교통공사노동조합', '가짜노조', '나짜지부'].map(name => ({name}));
  const s = sectionsOf(list, OPERATOR_ORG_ORDER, ['병원', '철도']);
  assert.deepEqual(s.map(x => [x.kind, x.name, x.orgs.map(o => o.name)]), [
    ['group', '철도', ['전국철도노동조합']], ['group', '지하철', ['서울교통공사노동조합']],
    ['pending', '병원', []], ['tail', '그 외', ['가짜노조', '나짜지부']]]);
  assert.deepEqual(sectionsOf(list, null, []).map(x => x.kind), ['tail']);
  assert.deepEqual(sectionsOf([{name: '전국철도노동조합'}], OPERATOR_ORG_ORDER, []).map(x => x.kind), ['group'], '빈 그 외는 칸 없음');
});

test('조직 옮기기·묶음 순서·이름 바꾸기·풀기: 새 값을 돌려주고 받은 값은 그대로, 서버 검사를 통과', () => {
  const base = plain(OPERATOR_ORG_ORDER), keep = JSON.stringify(base);
  // 같은 묶음 안 순서
  let r = moveOrg(base, '부산교통공사노동조합', {group: '지하철', before: '서울교통공사노동조합'});
  assert.equal(r.changed, true); assert.equal(r.value.groups[1].orgs[0], '부산교통공사노동조합');
  // 다른 묶음으로, 그 외로
  r = moveOrg(base, '전국철도노동조합', {group: '지하철', before: null});
  assert.equal(r.emptied, '철도'); assert.equal(r.value.groups[0].name, '지하철'); assert.ok(r.value.groups[0].orgs.includes('전국철도노동조합'));
  r = moveOrg(base, '서울교통공사노동조합', {group: null});
  assert.ok(!r.value.groups.some(g => g.orgs.includes('서울교통공사노동조합')));
  // 빈 묶음(값에 없음)으로 넣으면 그 자리에 새 묶음
  r = moveOrg(base, '가짜노조', {group: '병원'}, 1);
  assert.deepEqual(r.value.groups[1], {name: '병원', orgs: ['가짜노조']});
  for (const v of [r.value]) assert.equal(validValue('org_order', v), true);
  // 묶음 순서·이름·풀기
  assert.deepEqual(moveGroup(base, 0, 2).value.groups.map(g => g.name), ['지하철', '민자철도', '철도', '민간도시철도']);
  assert.equal(renameGroup(base, 0, '고속철도').value.groups[0].name, '고속철도');
  assert.match(renameGroup(base, 0, '지하철').error, /이미 있어요/);
  assert.match(groupNameProblem('그 외', []), /쓸 수 없어요/);
  assert.match(groupNameProblem('가'.repeat(21), []), /20자/);
  assert.deepEqual(ungroup(base, 0).value.groups.map(g => g.name), ['지하철', '민자철도', '민간도시철도']);
  assert.equal(orderValue({groups: [], hidden: []}), null);
  assert.equal(JSON.stringify(base), keep, '받은 값은 고치지 않는다');
  // 한도: 묶음 12개
  const full = {groups: Array.from({length: 12}, (_, i) => ({name: '묶음' + i, orgs: ['조직' + i]})), hidden: []};
  assert.match(moveOrg(full, '새조직', {group: '새묶음'}).error, /12개/);
});
