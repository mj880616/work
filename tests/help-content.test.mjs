// HELP-메뉴안쓰는법 · HELP-처음쓰는사람안내: 쓰는 법 글 한 곳(app/help-content.mjs)이 메뉴 목록·이름과 묶여 있는지, 운영자 메뉴 줄이 기능 목록으로만 생기는지,
// 공개 저장소에 실제 이름이 들어가지 않는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {ITEMS} from '../app/menu-model.mjs';
import {GROUPS, TOPIC_IDS, topic, helpGroups, matchTopic, notesFor, FIRST_USE, APP_GUIDE, DEVICES, deviceOf, PRIVACY_LINES} from '../app/help-content.mjs';
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

test('줄마다 한 줄 요약·설명, 메뉴 줄은 따라하기·화면 그림·열기가 있다', () => {
  // 아스날은 경기 기록 자료에 실제 선수 이름이 있어 그림을 찍지 않는다(tests/app-e2e/help-shots/capture.mjs).
  const NO_SHOT = new Set(['arsenal']);
  for (const id of TOPIC_IDS) {
    const t = topic(id);
    assert.ok(t.short && t.lead, `${id} 한 줄·설명`);
    assert.equal(t.ex, undefined, `${id} 글자로 그린 예시 화면은 없앴다(그림으로)`);
    if (!ITEMS.some(i => i.id === id) && id !== 'profile') continue;
    assert.ok(t.steps?.length >= 1 && t.steps.length <= 4, `${id} 따라하기 1~4줄`);
    if (!NO_SHOT.has(id)) assert.ok(t.shots?.length, `${id} 화면 그림`);
    assert.ok(t.open, `${id} 열기`);
  }
  assert.ok(topic('basics').shots.length === 2, '어디서나 쓰는 동작: 줄 밀기 그림 두 장');
});

// HELP-그림(S71-33): 그림은 app/help-shots/에 있고, 줄마다 alt 글이 있고, 한 장 120KB 이하·폭 390 비율(높이 h)이다. 쓰지 않는 그림 파일은 없다.
const SHOT_DIR = new URL('../app/help-shots/', import.meta.url);
function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF'); assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return {w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff};
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return {w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1}; }
  if (kind === 'VP8X') return {w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1};
  throw new Error('모르는 webp ' + kind);
}
test('화면 그림: 파일·alt·크기 상한·비율, 남는 파일 없음', () => {
  const used = new Set();
  for (const id of TOPIC_IDS) for (const s of topic(id).shots || []) {
    assert.match(s.file, /^[a-z-]+\.webp$/, `${id} 그림 이름`);
    assert.ok(typeof s.alt === 'string' && s.alt.trim().length >= 8, `${id} ${s.file} alt 글`);
    const buf = readFileSync(new URL(s.file, SHOT_DIR));
    assert.ok(buf.length <= 120 * 1024, `${s.file} ${buf.length}바이트 — 한 장 120KB 이하`);
    const {w, h} = webpSize(buf);
    assert.ok(Math.abs(w / h - 390 / s.h) < 0.01, `${s.file} 비율 390×${s.h} (실제 ${w}×${h})`);
    used.add(s.file);
  }
  const files = readdirSync(SHOT_DIR);
  assert.deepEqual(files.filter(f => !used.has(f)), [], '쓰는 법 글에 없는 그림 파일');
  assert.ok(files.reduce((n, f) => n + statSync(new URL(f, SHOT_DIR)).size, 0) <= 600 * 1024, '그림 모두 600KB 이하');
});

test('지운 기능·옛 단추 이름은 쓰는 법에 없다', () => {
  const text = TOPIC_IDS.map(id => { const t = topic(id); return [t.label, t.short, t.lead, ...(t.when || []), ...(t.steps || []), ...(t.notes || []), ...(t.extra || []).map(x => x.text), ...(t.shots || []).map(s => s.alt)].join('\n'); }).join('\n');
  for (const gone of ['참고 묶음', '[정리', '사진 정리', '[+ 노트]', '[+ 자료]', '[자료 넣기]', '완료하거나 보관', '맨 위 입력칸', '소속(', '직책', '쓰는 법 ›', '원장', '공유 페이지 메뉴', '드라이브에서 가져오기'])
    assert.ok(!text.includes(gone), `'${gone}' 없음`);
});

test('알아 둘 것: 기능 목록에 있을 때만 보이는 줄(사진 내용 찾기)', () => {
  const photo = topic('photos');
  const line = photo.extra[0].text;
  assert.ok(!notesFor(photo, null).includes(line), '기능 목록을 못 읽으면 없음');
  assert.ok(!notesFor(photo, []).includes(line), '기능이 없으면 없음');
  assert.ok(notesFor(photo, ['photo_content']).includes(line), '기능이 있으면 있음');
  assert.deepEqual(notesFor(topic('note'), []), topic('note').notes);
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
  assert.deepEqual(helpGroups([])[1].topics.map(t => t.id), ['basics'], "다음 '어디서나'");
  assert.equal(helpGroups([]).flatMap(g => g.topics).length, 16, '운영자 기능 없는 계정 16줄');
});

test('찾기는 이름·설명·따라하기 글에서 낱말을 모두 찾는다', () => {
  assert.ok(matchTopic(topic('team'), '전체 표'));
  assert.ok(matchTopic(topic('brief'), 'PDF 스캔'));
  assert.deepEqual(TOPIC_IDS.filter(id => matchTopic(topic(id), 'PDF 스캔')), ['brief']);
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
