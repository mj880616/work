// CALL-상대표시정리 (2026-11-08 사용자 결정): 통화 목록 꼬리표는 이름만 한 줄, 상세는 '조직 · 이름 직책', 조직 고르기 [직접 쓰기].
// 이름·조직은 모두 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {callWho, callTopic, callTag, personName} from '../app/feed-model.mjs';
import {similarOrgs} from '../app/org-similar.mjs';

const ORG = {id:'o1', name:'예시교통공사노동조합', aliases:['예시교통노조']};
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('① 목록 꼬리표: 이름만(직책 빼고), 이름을 모르면 조직, 둘 다 없으면 없음', () => {
  assert.equal(callTag(callWho({organization:ORG, counterpart:'예시교통공사노동조합 홍길동 조직국장'})), '홍길동');
  assert.equal(callTag(callWho({counterpart:'홍길동 조직국장'})), '홍길동');
  assert.equal(callTag(callWho({counterpart:'다른지부 이나연 지부장'})), '이나연');
  assert.equal(callTag(callWho({organization:ORG, counterpart:''})), '예시교통노조');
  assert.equal(callTag(callWho({})), '');
  assert.equal(callTag(callWho({counterpart:'공공운수노조 박가상 팀장'})), '박가상');
  assert.equal(personName('김가상'), '김가상');
  assert.equal(personName(''), '');
});

test('② 상세 날짜 줄: 조직 · 이름 직책(모르는 칸은 뺌)', () => {
  assert.equal(callWho({organization:ORG, counterpart:'홍길동 위원장'}).text, '예시교통노조 · 홍길동 위원장');
  assert.equal(callWho({counterpart:'홍길동 위원장'}).text, '홍길동 위원장');
  assert.equal(callWho({organization:ORG}).text, '예시교통노조');
});

test('③ 제목 앞 조직 꼴 조각은 상대 칸의 조직으로 보이고 제목에서는 뗀다(규칙 한 곳)', () => {
  const title = '가나다노동조합 · 회의 일정 확인', counterpart = '홍길동 조직국장';
  assert.equal(callTopic(title, {counterpart}), '회의 일정 확인');
  assert.deepEqual(callWho({counterpart, title}), {org:'가나다노동조합', person:'홍길동 조직국장', name:'홍길동', text:'가나다노동조합 · 홍길동 조직국장'});
  // 연결 조직이 있으면 그것이 먼저(제목 조각은 보지 않음).
  assert.equal(callWho({organization:ORG, counterpart, title}).org, '예시교통노조');
  // 우리 쪽(공공운수) 이름은 상대 조직으로 보이지 않고, 제목에서는 뗀다.
  assert.equal(callWho({counterpart, title:'전국공공운수예시노동조합 · 회의'}).org, '');
  assert.equal(callTopic('전국공공운수예시노동조합 · 회의', {counterpart}), '회의');
  // 조직 꼴이 아닌 앞 조각은 그대로.
  assert.equal(callTopic('다른기관 · 일정 조율', {counterpart:'김가상'}), '다른기관 · 일정 조율');
  assert.equal(callWho({counterpart:'김가상', title:'다른기관 · 일정 조율'}).org, '');
  // 개인 통화는 조직이 없다.
  assert.equal(callWho({personal:true, counterpart:'김가상', title:'가나다노조 · 약속'}).org, '');
});

test('④ 비슷한 이름 조직(중복 방지): 자동 규칙·끝말 뗀 핵심', () => {
  const orgs = [ORG, {id:'o2', name:'다른지부'}, {id:'o3', name:'가나다'}];
  assert.deepEqual(similarOrgs('예시교통노조', orgs).map(o => o.id), ['o1']);
  assert.deepEqual(similarOrgs('예시교통공사', orgs).map(o => o.id), ['o1']);
  assert.deepEqual(similarOrgs('다른', orgs).map(o => o.id), ['o2']);
  assert.deepEqual(similarOrgs('라마바노동조합', orgs), []);
  assert.deepEqual(similarOrgs('', orgs), []);
});

test('목록 꼬리표 CSS: 늘 한 줄, 글자 중간에서 꺾지 않고 끝 …', () => {
  const css = read('app/feed.css');
  const rule = css.match(/\.feed-view \.feed-call \.feed-org\{([^}]*)\}/)?.[1] || '';
  for (const want of ['white-space:nowrap', 'text-overflow:ellipsis', 'overflow:hidden', 'min-width:0']) assert.ok(rule.includes(want), want);
  assert.doesNotMatch(css, /\.feed-org\{[^}]*(white-space:normal|overflow-wrap:anywhere)/);
  const now = read('app/now.css');
  assert.match(now, /\.nw-meta > :is\(\.nw-src,\.nw-tag,\.nw-badge\)\{[^}]*white-space:nowrap;[^}]*\}/);
});

test('조직 고르기 [직접 쓰기]: 공용 고르기 창 한 곳 + 통화·텔레그램 연결이 같은 만들기 경로를 쓴다', () => {
  const picker = read('app/area-org-picker.js'), link = read('app/feed-link.js'), data = read('app/feed-data.js');
  assert.match(picker, /data-aop-create-input/);
  assert.match(picker, /data-aop-create-force/);
  assert.match(link, /createMyOrganization/);
  assert.match(link, /similarOrgs/);
  // 새 조직은 담당조직 추가와 같은 표(작업공간 주인 RLS)에 만든다. 다른 표·서버 함수를 새로 만들지 않는다.
  const fn = data.slice(data.indexOf('export async function createMyOrganization'), data.indexOf('// 조직 연결 (요약 부품 통일 ②'));
  assert.match(fn, /\/rest\/v1\/app_suborganizations\?/);
  assert.match(fn, /workspace_id:ws/);
  assert.doesNotMatch(fn, /\/rpc\//);
  for (const f of ['app/call-feed.js', 'app/telegram-feed.js']) assert.match(read(f), /openOrgPicker\(/, f);
});
