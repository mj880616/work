// TG-발언자이름 4단계: 보낸 사람 이름 입히기 순수 규칙(app/tg-sender-model.mjs). 이름·방은 모두 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanName, buildIndex, senderShown, rawRows, peopleRows, chipsOf, senderError, linkKey, dayShort, MERGE_NOTE, MERGE_BOTH_KEYED} from '../app/tg-sender-model.mjs';
import {telegramLines} from '../app/feed-model.mjs';

const S = (id, o = {}) => ({id, name:null, auto_name:null, is_self:false, keyed:false, ...o});
const raw = ['16:31 A: 하나', '16:33 B: 둘', '16:34 A: 셋', '16:35 A: 넷', '16:36 C: 다섯', '16:37 D: 여섯'].join('\n');

test('표시 순서: 손 이름 → 나 → 수집기 이름 → A 그대로', () => {
  assert.deepEqual(senderShown(S('1', {name:'홍길동', auto_name:'자동', is_self:true}), 'A'), {text:'홍길동', kind:'name'});
  assert.deepEqual(senderShown(S('1', {auto_name:'자동', is_self:true}), 'A'), {text:'나', kind:'self'});
  assert.deepEqual(senderShown(S('1', {auto_name:' 자동 '}), 'A'), {text:'자동', kind:'auto'});
  assert.deepEqual(senderShown(S('1'), 'A'), {text:'A', kind:'label'});
  assert.deepEqual(senderShown(null, 'B'), {text:'B', kind:'label'});
  assert.deepEqual(senderShown(S('1', {name:'  '}), 'A'), {text:'A', kind:'label'});
});

test('원문 줄: 이름 입히기, 같은 이름 이어서 말하면 두 번째부터 줄임, 이름 없는 라벨은 그 날 첫 줄에만 [이름 붙이기]', () => {
  const idx = buildIndex([S('p1', {name:'가상갑'}), S('p2', {is_self:true}), S('p3', {auto_name:'가상병'})],
    [{room_key:'room-a', day:'2026-10-23', label:'A', sender_id:'p1'}, {room_key:'room-a', day:'2026-10-23', label:'C', sender_id:'p2'}, {room_key:'room-a', day:'2026-10-23', label:'D', sender_id:'p3'},
     {room_key:'room-b', day:'2026-10-23', label:'B', sender_id:'p1'}]);
  const rows = rawRows(telegramLines(raw), idx, 'room-a', '2026-10-23', {canName:true});
  assert.deepEqual(rows.map(r => r.shown.text), ['가상갑', 'B', '가상갑', '가상갑', '나', '가상병']);
  assert.deepEqual(rows.map(r => r.same), [false, false, false, true, false, false]);
  assert.deepEqual(rows.map(r => r.tag), [false, true, false, false, false, false]);
  // 다른 방·다른 날의 연결은 쓰지 않는다.
  assert.equal(rawRows(telegramLines('09:00 A: x'), idx, 'room-a', '2026-10-24', {canName:true})[0].shown.text, 'A');
  assert.equal(rawRows(telegramLines('09:00 B: x'), idx, 'room-b', '2026-10-23', {canName:true})[0].shown.text, '가상갑');
});

test('이름 없는 A·B는 줄마다 그대로, [이름 붙이기]는 라벨마다 첫 줄 한 번', () => {
  const rows = rawRows(telegramLines('09:00 A: 1\n09:01 B: 2\n09:02 A: 3\n09:03 B: 4'), buildIndex([], []), 'r', '2026-10-20', {canName:true});
  assert.deepEqual(rows.map(r => r.shown.text), ['A', 'B', 'A', 'B']);
  assert.deepEqual(rows.map(r => r.tag), [true, true, false, false]);
  assert.deepEqual(rows.map(r => r.same), [false, false, false, false]);
});

test('표를 읽지 못했거나(null) 저장할 수 없으면 지금처럼 A·B만, [이름 붙이기] 없음', () => {
  assert.equal(buildIndex(null, []), null);
  assert.equal(buildIndex([], null), null);
  const rows = rawRows(telegramLines(raw), null, 'room-a', '2026-10-23', {canName:false});
  assert.deepEqual(rows.map(r => r.shown.text), ['A', 'B', 'A', 'A', 'C', 'D']);
  assert.ok(rows.every(r => !r.tag && !r.same));
  // 머리말 같은 이름 없는 줄은 건드리지 않는다.
  const head = rawRows(telegramLines('머리말\n09:00 A: x'), null, 'r', '2026-10-20', {canName:true});
  assert.equal(head[0].shown.text, ''); assert.equal(head[0].tag, false);
});

test('이름 검사는 서버 함수와 같다: 1~40자, 제어문자 없음', () => {
  assert.deepEqual(cleanName('  이영희 '), {ok:true, name:'이영희'});
  assert.equal(cleanName('   ').error, 'EMPTY');
  assert.equal(cleanName(null).error, 'EMPTY');
  assert.equal(cleanName('가'.repeat(41)).error, 'TOO_LONG');
  assert.equal(cleanName('가'.repeat(40)).ok, true);
  assert.equal(cleanName('가\n나').error, 'CONTROL');
});

test('이름 표 목록: 이름 없음/있음, 자동·직접·나, 방 수와 최근 날, 최근 순', () => {
  const senders = [S('a', {name:'가상갑', auto_name:'수집갑', keyed:true}), S('b', {auto_name:'가상을'}), S('c'), S('d', {is_self:true}), S('e', {name:'가상정'})];
  const links = [
    {room_key:'r1', day:'2026-10-23', label:'A', sender_id:'a'}, {room_key:'r2', day:'2026-10-22', label:'A', sender_id:'a'}, {room_key:'r1', day:'2026-10-10', label:'B', sender_id:'b'},
    {room_key:'r2', day:'2026-10-21', label:'C', sender_id:'c'}, {room_key:'r1', day:'2026-10-05', label:'D', sender_id:'d'},
  ];
  const rows = peopleRows(senders, links, k => `방${k}`);
  assert.deepEqual(rows.map(r => r.id), ['a', 'c', 'b', 'd', 'e']);
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual([by.a.source, by.a.rooms, by.a.last.day, by.a.keyed, by.a.hasName], ['직접', 2, '2026-10-23', true, true]);
  assert.deepEqual([by.b.source, by.b.unnamed, by.b.hasName], ['자동', false, false]);
  assert.deepEqual([by.c.source, by.c.unnamed, by.c.roomLabel], ['', true, '방r2']);
  assert.deepEqual([by.d.source, by.d.unnamed], ['나', false]);
  assert.equal(by.e.last, null);
  assert.deepEqual(peopleRows(null, null), []);
});

test('칩: 이름 있는 사람만, 나·자기 자신·같은 글자 제외', () => {
  const rows = peopleRows([S('a', {name:'가상갑'}), S('b', {name:'가상갑'}), S('c', {auto_name:'가상을'}), S('d', {is_self:true}), S('e')], [], k => k);
  assert.deepEqual(chipsOf(rows), [{id:'a', text:'가상갑'}, {id:'c', text:'가상을'}]);
  assert.deepEqual(chipsOf(rows, 'a').map(c => c.id), ['b', 'c']);
});

test('DB 함수 오류를 짧은 이름표로', () => {
  assert.equal(senderError({status:404, message:'{"code":"P0002","message":"TG_SENDER_NOT_FOUND"}'}), 'GONE');
  assert.equal(senderError({status:400, message:'TG_SENDER_NAME'}), 'NAME');
  assert.equal(senderError({status:400, message:'TG_SENDER_LABEL'}), 'ARGS');
  assert.equal(senderError({status:404, message:'PGRST202 Could not find the function'}), 'UNAVAILABLE');
  assert.equal(senderError({status:403, message:'x'}), 'REFUSED');
  assert.equal(senderError({status:500, message:'x'}), 'UNKNOWN');
  assert.equal(senderError(new Error('network')), 'UNKNOWN');
});

test('합치기 안내문과 짧은 날짜', () => {
  assert.match(MERGE_NOTE, /두 사람 모두 열쇠가 있으면 앞으로 새 사람이 생길 수 있어요/);
  assert.match(MERGE_BOTH_KEYED, /새 사람/);
  assert.equal(dayShort('2026-10-03'), '10. 3.'); assert.equal(dayShort(''), '');
  assert.equal(linkKey('r', '2026-10-03', 'A'), linkKey('r', '2026-10-03', 'A'));
});

test('화면 코드: 로컬 스토리지·옛 덮어쓰기 없음, 표는 읽기만(쓰기는 DB 함수), 번호·열쇠 값을 화면 상태에 두지 않음', () => {
  const data = readFileSync(new URL('../app/tg-sender-data.js', import.meta.url), 'utf8'), view = readFileSync(new URL('../app/telegram-feed.js', import.meta.url), 'utf8');
  for (const src of [data, view]) { assert.doesNotMatch(src, new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'Mutation' + 'Observer'].join('|'))); }
  assert.doesNotMatch(data, /method:\s*'(PATCH|POST|DELETE|PUT)'[^}]*app_tg_(senders|day_senders)\b/);
  assert.match(data, /app_tg_sender_set_name/); assert.match(data, /app_tg_sender_merge/); assert.match(data, /app_tg_sender_forget/);
  assert.doesNotMatch(data, /sender_key\s*:/);
});
