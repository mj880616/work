// HELP-메뉴안쓰는법 · HELP-처음쓰는사람안내: 쓰는 법 글 한 곳(app/help-content.mjs)이 메뉴 목록·이름과 묶여 있는지, 운영자 메뉴 줄이 기능 목록으로만 생기는지,
// 공개 저장소에 실제 이름이 들어가지 않는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ITEMS} from '../app/menu-model.mjs';
import {GROUPS, TOPIC_IDS, topic, helpGroups, matchTopic, FIRST_USE, APP_GUIDE, DEVICES, deviceOf, PRIVACY_LINES} from '../app/help-content.mjs';
import {OPERATOR_ORG_ORDER} from './org-order-fixture.mjs';

test('모든 메뉴가 쓰는 법에 한 줄씩 있고, 이름은 메뉴 이름 그대로다', () => {
  const listed = GROUPS.flatMap(g => g.topics);
  assert.equal(new Set(listed).size, listed.length, '같은 줄이 두 번 나오지 않는다');
  for (const item of ITEMS) {
    assert.ok(listed.includes(item.id), `${item.label}(${item.id}) 줄이 목차에 있다`);
    assert.equal(topic(item.id).label, item.label, `${item.id} 이름은 menu-model.mjs label`);
  }
  for (const id of listed) assert.ok(TOPIC_IDS.includes(id), `${id} 글이 있다`);
});

test('줄마다 한 줄 요약·설명, 메뉴 줄은 따라하기·예시 화면·열기가 있다', () => {
  for (const id of TOPIC_IDS) {
    const t = topic(id);
    assert.ok(t.short && t.lead, `${id} 한 줄·설명`);
    if (!ITEMS.some(i => i.id === id) && id !== 'profile') continue;
    assert.ok(t.steps?.length >= 1 && t.steps.length <= 4, `${id} 따라하기 1~4줄`);
    assert.ok(t.ex?.title && t.ex.rows.length, `${id} 예시 화면`);
    assert.ok(t.open, `${id} 열기`);
  }
  assert.ok(topic('calendar').ex, '일정도 예시 화면이 있다');
});

test('운영자 기능 메뉴 줄은 서버 기능 목록에 있을 때만(못 읽으면 넣지 않음)', () => {
  const ids = gs => gs.flatMap(g => g.topics.map(t => t.id));
  const operator = ITEMS.filter(i => i.feature).map(i => i.id);
  for (const features of [null, [], ['files']]) {
    const got = ids(helpGroups(features));
    for (const id of operator) assert.ok(!got.includes(id), `${JSON.stringify(features)}: ${id} 줄 없음`);
    assert.ok(!helpGroups(features).some(g => g.id === 'operator'), '빈 운영자 묶음 없음');
  }
  const all = ids(helpGroups(operator.map(id => ITEMS.find(i => i.id === id).feature)));
  for (const id of operator) assert.ok(all.includes(id), `운영자: ${id} 줄 있음`);
  assert.deepEqual(helpGroups([])[0].topics.map(t => t.id), ['team', 'meetings', 'brief'], "맨 위 '많이 쓰는 곳'");
});

test('찾기는 이름·설명·따라하기 글에서 낱말을 모두 찾는다', () => {
  assert.ok(matchTopic(topic('team'), '전체 표'));
  assert.ok(matchTopic(topic('brief'), 'PDF 스캔'));
  assert.ok(!matchTopic(topic('team'), '스캔'));
  assert.ok(matchTopic(topic('home'), '  '));
});

test('빈 화면 안내 셋은 3단계, 앱 내려받기는 네 기기', () => {
  assert.deepEqual(Object.keys(FIRST_USE), ['team', 'meetings', 'brief']);
  for (const fu of Object.values(FIRST_USE)) { assert.equal(fu.steps.length, 3); assert.ok(fu.title && fu.sub && fu.action); }
  assert.deepEqual(DEVICES.map(d => d.id), ['android', 'iphone', 'windows', 'mac']);
  for (const d of DEVICES) assert.ok(APP_GUIDE[d.id].steps.length === 3, `${d.id} 3단계`);
  assert.equal(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'iphone');
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14; SM-F956N)'), 'android');
  assert.equal(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'mac');
  assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.deepEqual([...PRIVACY_LINES], ['내가 기록한 내용은 운영자가 볼 수 없습니다.', '운영자에게 제공되는 정보: 이메일주소, 가입일, 마지막 사용 시각.', '제공되지 않는 정보: 유저가 기록·업로드한 정보.']);
});

test('쓰는 법 글에 실제 노조·조직 이름이 없다(예시는 지어낸 이름)', () => {
  const text = readFileSync(new URL('../app/help-content.mjs', import.meta.url), 'utf8');
  const real = OPERATOR_ORG_ORDER.groups.flatMap(g => [g.name, ...g.orgs]);
  for (const name of [...real, ...OPERATOR_ORG_ORDER.hidden, '공공운수']) assert.ok(!text.includes(name), `${name} 없음`);
});
