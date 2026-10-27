import test from 'node:test';
import assert from 'node:assert/strict';
import {orgKey, orgKeys, sameOrgName, matchOrgs, matchOrg, orgAllNames} from '../app/org-name-match.mjs';
import {nearestTarget, weekMaterial, rowNames} from '../app/weekly-hwpx/draft.mjs';
import {personalReportFromTeam, isMyOrg} from '../app/weekly-hwpx/delta.mjs';

// ORG-별칭 (2026-10-23 사용자 요청 12:43 ③). 조직 이름은 저장소 app/organization-order.js 에 이미 있는 공개 조직 이름, 그 밖은 가짜.
const ORGS = [
  {name: '부산지하철노동조합'}, {name: '서울교통공사노동조합', aliases: ['서울지하철노조']}, {name: '서울교통공사9호선지부'},
  {name: '메트로9호선노동조합', aliases: ['9호선']}, {name: '서해선지부'}, {name: '지티엑스에이운영지부', aliases: ['GTX-A지부']},
];

test('자동 규칙: 노동조합↔노조, 띄어쓰기·가운뎃점·문장부호·대소문자 무시, 끝의 지부·지회는 있어도 없어도 같음', () => {
  assert.equal(sameOrgName('부산지하철노동조합', '부산지하철노조'), true);
  assert.equal(sameOrgName('부산 지하철 노조', '부산지하철노동조합'), true);
  assert.equal(sameOrgName('메트로 9호선 노동조합', '메트로9호선노조'), true);
  assert.equal(sameOrgName('서해선지부', '서해선'), true);
  assert.equal(sameOrgName('서해선 지회', '서해선지부'), true);
  assert.equal(sameOrgName('GTX·A 운영지부', 'gtx-a운영지부'), true);
  // 다른 조직은 같지 않다: 앞부분이 같아도(서울교통공사 vs 서울교통공사9호선) 접미만 다를 때만 같음
  assert.equal(sameOrgName('서울교통공사노동조합', '서울교통공사9호선지부'), false);
  assert.equal(sameOrgName('서울교통공사', '서울교통공사노동조합'), false);
  assert.equal(sameOrgName('', ''), false);
  assert.equal(sameOrgName('지부', '지회'), false);
  assert.deepEqual(orgKeys('서해선지부'), ['서해선지부', '서해선']);
  assert.equal(orgKey('A·B 노동조합'), 'a·b노조'.replace('·', ''));
});

test('별칭: 정식 이름이 아니어도 aliases 칸에 적힌 이름이면 같은 조직', () => {
  assert.equal(matchOrg('서울지하철노조', ORGS)?.name, '서울교통공사노동조합');
  assert.equal(matchOrg('서울 지하철 노동조합', ORGS)?.name, '서울교통공사노동조합'); // 별칭도 자동 규칙을 탄다
  assert.equal(matchOrg('GTX-A 지부', ORGS)?.name, '지티엑스에이운영지부');
  assert.equal(matchOrg('부산지하철노조', ORGS)?.name, '부산지하철노동조합');
  assert.equal(matchOrg('없는노조', ORGS), null);
  assert.deepEqual(orgAllNames({name: '가짜', aliases: ['가짜', '다른']}), ['가짜', '다른']);
});

test('애매하면 잇지 않음: 두 조직에 맞으면 matchOrg는 null, 정식 이름이 같은 조직이 있으면 그쪽이 앞', () => {
  const dup = [{name: '가짜조직 갑', aliases: ['공동']}, {name: '가짜조직 을', aliases: ['공동']}];
  assert.equal(matchOrgs('공동', dup).length, 2);
  assert.equal(matchOrg('공동', dup), null);
  const clash = [{name: '가짜조직 갑', aliases: ['가짜조직 을']}, {name: '가짜조직 을'}];
  assert.equal(matchOrg('가짜조직 을', clash)?.name, '가짜조직 을');
});

test('붙일 줄 기본값(nearestTarget): 노동조합↔노조·별칭으로 한 곳, 두 조직이 맞으면 줄 고르기, 같은 조직 줄이 여럿이면 첫 줄', () => {
  const rows = ['공항철도지부', '부산지하철노조', '서울교통공사9호선지부', '서울지하철노조', '서해선지부'];
  const targets = rows.map((r, i) => ({value: `orgs:${i}`, names: rowNames(r, ORGS), kind: 'org'}));
  assert.equal(nearestTarget('부산지하철노동조합', targets), 'orgs:1');
  assert.equal(nearestTarget('서울교통공사노동조합', targets), 'orgs:3'); // 줄 '서울지하철노조'는 별칭으로 이 조직
  assert.equal(nearestTarget('서울교통공사9호선지부', targets), 'orgs:2');
  assert.equal(nearestTarget('서해선', targets), 'orgs:4');
  assert.equal(nearestTarget('모르는노조', targets), '');
  // 확정본에 한 조직 줄이 둘(이름 표기만 다름): 기록과 표기가 같은 줄이 먼저, 둘 다 다르면 첫 줄
  const twice = ['부산지하철노조', '부산지하철노동조합'].map((r, i) => ({value: `orgs:${i}`, names: rowNames(r, ORGS), kind: 'org'}));
  assert.equal(nearestTarget('부산지하철노동조합', twice), 'orgs:1');
  assert.equal(nearestTarget('부산 지하철 노조', twice), 'orgs:0');
  // 서로 다른 두 조직 줄에 맞는 이름 → 고르지 않음
  const two = [{value: 'orgs:0', names: ['가짜조직 갑', '공동'], kind: 'org'}, {value: 'orgs:1', names: ['가짜조직 을', '공동'], kind: 'org'}];
  assert.equal(nearestTarget('공동', two), '');
});

test('주간보고 회귀: 기록의 조직 이름이 확정본 줄과 다르게 적혀도 잇고(부산 지하철), 애매하거나 없는 줄은 줄 고르기로', () => {
  const orgs = [{index: 0, org: '공항철도지부'}, {index: 1, org: '부산지하철노조'}, {index: 2, org: '서울지하철노조'}];
  const model = {orgs: {sections: [
    {name: '부산지하철노동조합', items: [{day: '2026-10-20', text: '부산 소식'}]},
    {name: '서울교통공사노동조합', items: [{day: '2026-10-20', text: '서울 소식'}]},
    {name: '공항철도지부', items: [{day: '2026-10-20', text: '공항 소식'}]},
    {name: '인천교통공사노동조합', items: [{day: '2026-10-20', text: '인천 소식'}]},
  ]}};
  const aliases = new Map([['서울교통공사노동조합', ['서울지하철노조']]]);
  const m = weekMaterial(model, [], orgs, {aliases});
  assert.deepEqual(m.byOrg.get(1).map(l => l.text), ['- 부산 소식']);
  assert.deepEqual(m.byOrg.get(2).map(l => l.text), ['- 서울 소식']);
  assert.deepEqual(m.byOrg.get(0).map(l => l.text), ['- 공항 소식']);
  assert.deepEqual(m.orgUnmatched.map(l => l.from), ['인천교통공사노동조합']);
  // 줄 하나가 두 조직(기록)에 맞으면 둘 다 잇지 않는다
  const both = weekMaterial({orgs: {sections: [{name: '가짜조직 갑', items: [{day: '', text: 'ㄱ'}]}, {name: '가짜조직 을', items: [{day: '', text: 'ㄴ'}]}]}},
    [], [{index: 0, org: '공동'}], {aliases: new Map([['가짜조직 갑', ['공동']], ['가짜조직 을', ['공동']]])});
  assert.equal(both.byOrg.get(0).length, 0);
  assert.equal(both.orgUnmatched.length, 2);
});

test('4. 산하조직 현황·내 담당 조직 줄: 확정본 줄이 약칭이어도 그 조직 자리에 둔다, 두 조직에 맞는 줄은 어느 쪽에도 잇지 않는다', () => {
  const row = (org, text) => ({org: [org], status: [text], paras: []});
  const team = {summary: [], sites: [], orgs: [row('부산지하철노조', '부산 현황'), row('서해선', '서해 현황'), row('공동', '겹침 줄')]};
  const orgList = [{name: '부산지하철노동조합'}, {name: '서해선지부'}, {name: '가짜조직 갑', aliases: ['공동']}, {name: '가짜조직 을', aliases: ['공동']}];
  const mine = personalReportFromTeam(team, '가짜담당', {myOrgs: orgList.map(o => o.name), orgList});
  const byName = Object.fromEntries(mine.orgs.map(o => [o.org.join(''), o.status.map(s => (typeof s === 'string' ? s : s.text))]));
  assert.deepEqual(byName['부산지하철노조'], ['부산 현황']);
  assert.deepEqual(byName['서해선'], ['서해 현황']);
  assert.deepEqual(byName['가짜조직 갑'], []);
  assert.deepEqual(byName['가짜조직 을'], []);
  assert.equal(isMyOrg(['부산 지하철 노조'], ['부산지하철노동조합']), true);
  assert.equal(isMyOrg(['인천교통공사노조'], ['부산지하철노동조합']), false);
});
