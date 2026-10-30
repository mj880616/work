// ORG-고르기통일: 조직을 고르는 칸은 앱 전체에서 내 담당조직만(app/my-organizations.js 한 규칙, 활동 끝난 조직 제외,
// organization-order.js 순서). 예외는 내 프로필 › 담당 사업장(담당을 정하는 곳이라 전체 표시) 한 곳.
// 이 시험은 app/ 소스를 읽어, 조직 표(app_suborganizations)를 읽는 모든 파일이 그 규칙을 쓰거나 이유가 적힌 허용 목록에
// 있어야 통과한다. 새 파일이 규칙 없이 조직을 읽으면 실패한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import vm from 'node:vm';
import {selectMyOrganizations, myOrganizationIds, pickMyOrganizations} from '../app/my-organizations.js';

const ROOT = new URL('..', import.meta.url).pathname;
const APP = join(ROOT, 'app');
const READS_ORGS = /\bapp_suborganizations\b/;
// 규칙 이름: my-organizations.js의 함수들과, 정리함의 옛 별칭(selectBasketOrganizations = selectMyOrganizations).
const USES_RULE = /\b(selectMyOrganizations|pickMyOrganizations|myOrganizationIds|selectBasketOrganizations)\b/;

// 규칙을 쓰지 않아도 되는 파일과 그 이유. 고르기 칸이 없는(이름 표시·자동 판정·편집·내보내기) 곳만 둔다.
const ALLOWED = Object.freeze({
  'app/my-organizations.js': '규칙 자체',
  'app/pre-meeting-sheet.js': '교섭 전 한 장: 일정에 연결된 조직 id를 이름으로 바꾸고 제목 속 조직 이름을 맞추는 대상 판정 전용(고르기 칸 없음, 연결은 일정 창의 기존 고르기 규칙)',
  'app/organization-order.js': '순서 규칙(주석에서 표 이름만 언급)',
  'app/org-name-match.mjs': '이름 비교 규칙(주석에서 표 이름만 언급)',
  'app/profile-settings.js': '예외: 내 프로필 › 담당 사업장은 담당을 정하는 칸이라 모든 조직을 보여 준다',
  'app/workplace-detail.js': '조직 한 곳의 상세 읽기·수정(고르기 칸 아님)',
  'app/team.js': '사업 보고에 이미 연결된 조직 이름 표시',
  'app/basket-data.js': '정리함 기록에 이미 연결된 조직 이름 표시',
  'app/basket-classification.js': '정리함 AI 분류의 조직 이름 대조(다른 작업이 정리함 쪽을 고침)',
  'app/drive-summary.js': 'Drive 요약 내보내기 표 목록(고르기 칸 아님)',
  'app/home-summary.js': '홈 빠른 입력 고르기 시트의 공용 읽기(조직·담당 행)만 한다. 기록할 곳 고르기는 update-places.js가 규칙을 적용한다',
});

// 사람이 조직을 고르는 칸이 있는 파일: 반드시 규칙을 쓴다.
const PICKERS = Object.freeze({
  'app/update-places.js': '기록할 곳 고르기(홈 업데이트·크게 쓰기)',
  'app/google-tasks.js': '할 일 연결',
  'app/feed-data.js': '통화·텔레그램 소식 조직 연결(내 담당 표시)',
  'app/suborganizations.js': '일정 등록·Google 일정 수정의 관련 담당조직 체크',
  'app/library-upload.js': '자료실 일괄 바꾸기 담당조직',
  'app/basket-manual-link.js': '정리함 [연결하기]',
  'app/calendar-ref-settings.js': '내 프로필 조직 참고 캘린더의 담당조직 고르기',
});

function appFiles(dir = APP) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      // 판 번호가 붙은 외부 라이브러리 폴더는 앱 소스가 아니다.
      if (/-\d+\.\d+/.test(name) || name === 'node_modules') continue;
      out.push(...appFiles(path));
    } else if (/\.(m?js|html)$/.test(name)) out.push(path);
  }
  return out;
}
const rel = path => relative(ROOT, path).split('\\').join('/');
const source = name => readFileSync(join(ROOT, name), 'utf8');

test('조직 표를 읽는 파일은 모두 내 담당조직 규칙을 쓰거나 이유가 적힌 허용 목록에 있다', () => {
  const readers = appFiles().filter(path => READS_ORGS.test(readFileSync(path, 'utf8')));
  assert.ok(readers.length >= 10, `조직 표를 읽는 파일을 찾지 못함: ${readers.length}`);
  const bad = readers.map(rel).filter(name => !USES_RULE.test(source(name)) && !ALLOWED[name]);
  assert.deepEqual(bad, [], `규칙(my-organizations.js) 없이 조직을 읽는 파일: ${bad.join(', ')}\n고르기 칸이면 pickMyOrganizations를 쓰고, 표시 전용이면 ALLOWED에 이유를 적는다.`);
  for (const [name, why] of Object.entries(ALLOWED)) assert.ok(why.trim().length > 3, `${name}: 허용 이유가 비었음`);
});

test('고르기 칸이 있는 파일은 모두 규칙을 쓴다(허용 목록으로 빠질 수 없다)', () => {
  for (const name of Object.keys(PICKERS)) {
    assert.ok(!ALLOWED[name], `${name}은 고르기 칸이라 허용 목록에 둘 수 없음`);
    assert.match(source(name), USES_RULE, `${name}(${PICKERS[name]})이 my-organizations.js 규칙을 쓰지 않음`);
  }
  // 정리함 [연결하기]: 옛 별칭(basket-ai-handoff.js) 또는 my-organizations.js 어느 쪽이든 규칙이면 된다.
  assert.match(source('app/basket-manual-link.js'), /\b(selectBasketOrganizations|selectMyOrganizations|pickMyOrganizations)\(/);
  // 기록할 곳·할 일 연결·일정 체크는 담당이 없을 때 예전처럼 아무것도 보이지 않는다.
  assert.match(source('app/update-places.js'), /pickMyOrganizations\(os, as, \{whenNone: 'none'\}\)/);
  assert.match(source('app/google-tasks.js'), /pickMyOrganizations\(orgs\|\|\[\],assignments\|\|\[\],\{whenNone:'none'\}\)/);
  assert.match(source('app/suborganizations.js'), /import\('\.\/my-organizations\.js'\)/);
  assert.match(source('app/suborganizations.js'), /checks\('event',selected,pickerOrganizations\(\)\)/);
  assert.match(source('app/suborganizations.js'), /const mine=pickerOrganizations\(\);soGoogleHiddenOrgIds=/);
  // 자료실 일괄 바꾸기는 내 담당조직만, 묶기(이미 붙은 자료 보여 주기)는 모든 조직 이름.
  assert.match(source('app/library-upload.js'), /organizations:kind==='organization'\?luBulkOrganizations\(cur\):\[\]/);
  assert.match(source('app/library-upload.js'), /luMyOrganizations=sort\(pickMyOrganizations\(/);
});

test('통화·텔레그램 조직 고르기 창은 내 담당조직(과 지금 연결된 조직)만 보이고 "그 외" 묶음이 없다', () => {
  const link = source('app/feed-link.js');
  assert.doesNotMatch(link, /그 외/);
  assert.match(link, /\(o\.active !== false && my\?\.has\(o\.id\)\) \|\| o\.id === sel/);
  assert.match(source('app/feed-data.js'), /mine:myOrganizationIds\(rows, mine\)/);
});

test('내 프로필 › 담당 사업장은 예외로 모든 조직을 보여 준다(규칙으로 거르지 않음)', () => {
  const profile = source('app/profile-settings.js');
  assert.doesNotMatch(profile, USES_RULE);
  assert.match(profile, /app_suborganizations\?workspace_id=eq\.\$\{workspaceId\}/);
});

// ---- 규칙 동작 ----
const orgs = [
  {id: 'a', name: '서울교통공사노동조합', active: true},
  {id: 'b', name: '전국철도노동조합', active: true},
  {id: 'c', name: '끝난 조직', active: false},
  {id: 'd', name: '궤도협의회', active: true},
  {id: 'e', name: '가나다 다른 조직'},
];

test('selectMyOrganizations: 담당 행 × 활동 중 조직, 활동 끝난 조직 제외', () => {
  const r = selectMyOrganizations(orgs, [{organization_id: 'a'}, {organization_id: 'c'}, {organization_id: 'e'}, {organization_id: 'x'}]);
  assert.deepEqual(r.organizations.map(o => o.id), ['a', 'e']);
  assert.equal(r.fallback, false);
  assert.deepEqual([...myOrganizationIds(orgs, [{organization_id: 'b'}])], ['b']);
});

test('selectMyOrganizations: 담당이 없거나 담당 조직이 모두 끝났으면 활동 중 전체 + fallback:true', () => {
  for (const assignees of [[], [{organization_id: 'c'}], [{organization_id: 'x'}]]) {
    const r = selectMyOrganizations(orgs, assignees);
    assert.deepEqual(r.organizations.map(o => o.id), ['a', 'b', 'd', 'e']);
    assert.equal(r.fallback, true);
  }
});

test('pickMyOrganizations: 담당이 있으면 내 것만, 없을 때는 whenNone에 따라 전체(기본) 또는 없음', () => {
  const as = [{organization_id: 'b'}, {organization_id: 'c'}];
  assert.deepEqual(pickMyOrganizations(orgs, as).map(o => o.id), ['b']);
  assert.deepEqual(pickMyOrganizations(orgs, as, {whenNone: 'none'}).map(o => o.id), ['b']);
  assert.deepEqual(pickMyOrganizations(orgs, []).map(o => o.id), ['a', 'b', 'd', 'e']);
  assert.deepEqual(pickMyOrganizations(orgs, [], {whenNone: 'none'}), []);
  assert.deepEqual(pickMyOrganizations(null, null), []);
});

test('고르기 칸 순서: 내 담당조직을 organization-order.js 순서로, 고를 수 없는 조직은 빼고', () => {
  const sandbox = {window: {}};
  vm.runInNewContext(source('app/organization-order.js'), sandbox);
  const order = sandbox.window.KPTUOrganizationOrder;
  const mine = pickMyOrganizations(orgs, ['a', 'b', 'd', 'e'].map(organization_id => ({organization_id})));
  const list = order.forPicker(order.sort(mine));
  assert.deepEqual(Array.from(list, o => o.name), ['전국철도노동조합', '서울교통공사노동조합', '가나다 다른 조직']);
});
