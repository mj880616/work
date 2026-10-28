// FEAT-1029묶음 ③ 오래 연락 안 한 담당조직: '연락' 판정 규칙(명진 결정 10/29)과 홈 줄 계산. 가짜 이름만.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isQuestion, answeredBy, talkDays, lastCallDays, mergeLast, quietList, daysText, lastText, headParts, weeksOf, addDays, daysBetween, WEEK_CHOICES} from '../app/org-quiet-model.mjs';
import {telegramLines} from '../app/feed-model.mjs';
import {validValue} from '../app/view-prefs.js';

const people = [
  {id:'p1', organization_id:'o1', name:'나위원장', match_names:['나위원장', '나철수']},
  {id:'p2', organization_id:'o2', name:'다사무장', match_names:['다사무장']},
];

test('묻는 말: 물음표·묻는 말끝·궁금은 질문, 알림·전달 말투는 아님', () => {
  for (const t of ['요즘 교섭 어떻게 되고 있어요?', '자료 받으셨나요', '회의 잡혔는지요', '상황이 어떤가요~', '진행 상황 궁금합니다', '언제 됩니까', '내일 가능할까요ㅎㅎ', '혹시 결과 나왔어?'])
    assert.equal(isQuestion(t), true, t);
  for (const t of ['', '자료 보냅니다', '내일 10시 회의입니다.', '고맙습니다!', '그러니까 그렇게 해요', '확인했어요'])
    assert.equal(isQuestion(t), false, t);
});

test('묻고 답 받음: 내 질문 뒤 같은 대화에 주요 인물의 답이 있을 때만', () => {
  const who = {A:{self:true, people:[]}, B:{self:false, people:['p1']}, C:{self:false, people:[]}};
  const of = l => who[l] || null;
  const lines = raw => telegramLines(raw);
  // 묻고 → 답함
  assert.deepEqual(answeredBy(lines('09:00 A: 요즘 교섭 어떻게 돼요?\n09:10 B: 다음 주에 3차 합니다'), of), ['p1']);
  // 그쪽이 먼저 알리고 내가 답한 것(일방 정보 전달 + 내 대답)은 아님
  assert.deepEqual(answeredBy(lines('09:00 B: 다음 주 3차 교섭 공지\n09:05 A: 확인했어요'), of), []);
  // 내 질문에 답한 사람이 주요 인물이 아니면 아님, 답이 질문보다 앞이면 아님
  assert.deepEqual(answeredBy(lines('09:00 A: 상황 어때요?\n09:02 C: 잘 모르겠어요'), of), []);
  assert.deepEqual(answeredBy(lines('08:50 B: 오늘 바빠요\n09:00 A: 상황 어때요?'), of), []);
  // 전달 메시지는 질문·답 어느 쪽으로도 세지 않음
  assert.deepEqual(answeredBy(lines('09:00 A (전달): 이거 어떻게 할까요?\n09:10 B: 네'), of), []);
  assert.deepEqual(answeredBy(lines('09:00 A: 어떻게 할까요?\n09:10 B (전달): 공문 원문'), of), []);
  // 줄 순서가 섞여 들어와도 시각 순으로 본다(여러 소식의 원문을 합친 경우)
  assert.deepEqual(answeredBy([...lines('09:10 B: 다음 주요'), ...lines('09:00 A: 언제 해요?')], of), ['p1']);
  // 같은 시각이면 들어온 순서
  assert.deepEqual(answeredBy(lines('09:00 B: 공지\n09:00 A: 몇 시예요?'), of), []);
});

test('방·날 고르기: 나와 주요 인물 이름표가 함께 있는 날만, 기간 안만', () => {
  const senders = {
    senders:[{id:'s0', name:null, auto_name:'나', is_self:true}, {id:'s1', name:'나철수', auto_name:'철수', is_self:false}, {id:'s2', name:'라회원', auto_name:null, is_self:false}],
    links:[
      {room_key:'r1', day:'2026-10-20', label:'A', sender_id:'s0'}, {room_key:'r1', day:'2026-10-20', label:'B', sender_id:'s1'},
      {room_key:'r2', day:'2026-10-21', label:'A', sender_id:'s1'}, {room_key:'r2', day:'2026-10-21', label:'B', sender_id:'s2'}, // 나 없음(단체방 소식)
      {room_key:'r3', day:'2026-10-22', label:'A', sender_id:'s0'}, {room_key:'r3', day:'2026-10-22', label:'B', sender_id:'s2'}, // 주요 인물 없음
      {room_key:'r1', day:'2026-01-02', label:'A', sender_id:'s0'}, {room_key:'r1', day:'2026-01-02', label:'B', sender_id:'s1'}, // 기간 밖
    ]};
  const out = talkDays(senders, people, '2026-05-01');
  assert.deepEqual([...out.keys()], ['r1\u00002026-10-20']);
  const m = out.get('r1\u00002026-10-20');
  assert.deepEqual(m.get('A'), {self:true, people:[]});
  assert.deepEqual(m.get('B'), {self:false, people:['p1']});
  assert.equal(talkDays(null, people).size, 0);
  assert.equal(talkDays(senders, []).size, 0);
});

test('통화: 상대·제목에 주요 인물 이름이 있으면 그 조직의 연락, 지운 통화는 빼기', () => {
  const calls = [
    {id:'c1', day:'2026-10-01', counterpart:'나철수', title:'통화'},
    {id:'c2', day:'2026-10-05', counterpart:'모르는 사람', title:'다사무장 관련'},
    {id:'c3', day:'2026-10-20', counterpart:'나위원장', title:'', hidden_at:'2026-10-21'},
    {id:'c4', day:'2026-09-01', counterpart:'라회원', title:'안부'},
  ];
  assert.deepEqual([...lastCallDays(calls, people)].sort(), [['o1', '2026-10-01'], ['o2', '2026-10-05']]);
  const last = mergeLast(new Map([['o1', '2026-10-01'], ['o2', '2026-10-05']]), new Map([['o1', '2026-10-10'], ['o2', '2026-10-05']]));
  assert.deepEqual(last.get('o1'), {day:'2026-10-10', via:'telegram'});
  assert.deepEqual(last.get('o2'), {day:'2026-10-05', via:'call'}, '같은 날이면 통화');
});

test('홈 줄: 기준 이상 지난 조직만, 덜 오래된 곳부터, 이름 3곳 + 외 N곳, 주요 인물 없는 조직은 수만', () => {
  const today = '2026-10-29';
  const orgs = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'].map((id, i) => ({id, name:['가지부', '나지부', '다분회', '라지부', '마분회', '바지부'][i]}));
  const ppl = [...people, {id:'p3', organization_id:'o3', name:'가'}, {id:'p4', organization_id:'o4', name:'나나'}, {id:'p5', organization_id:'o5', name:'다다'}];
  const last = new Map([['o1', {day:addDays(today, -25), via:'call'}], ['o2', {day:addDays(today, -40), via:'telegram'}], ['o3', {day:addDays(today, -20), via:'call'}], ['o4', {day:addDays(today, -62), via:'call'}]]);
  const {rows, skipped} = quietList({orgs, people:ppl, last, unsure:new Set(), today, weeks:3});
  assert.equal(skipped, 1, '바지부(주요 인물 없음)');
  assert.deepEqual(rows.map(r => [r.name, daysText(r)]), [['가지부', '25일'], ['나지부', '40일'], ['라지부', '62일'], ['마분회', '180일+']]);
  assert.equal(lastText(rows[0], today), '마지막 · 통화 10.4');
  assert.equal(lastText(rows[1], today), '마지막 · 텔레그램 9.19');
  assert.equal(lastText(rows[3], today), '180일 안 연락 없음');
  assert.deepEqual(headParts(rows).shown.map(r => r.name), ['가지부', '나지부', '라지부']);
  assert.equal(headParts(rows).more, 1);
  // 경계: 정확히 21일이면 조용함, 20일이면 아님
  assert.equal(quietList({orgs:[orgs[0]], people:ppl, last:new Map([['o1', {day:addDays(today, -21), via:'call'}]]), today, weeks:3}).rows.length, 1);
  assert.equal(quietList({orgs:[orgs[0]], people:ppl, last:new Map([['o1', {day:addDays(today, -20), via:'call'}]]), today, weeks:3}).rows.length, 0);
  // 끄기
  assert.deepEqual(quietList({orgs, people:ppl, last, today, weeks:0}).rows, []);
  // 다 확인하지 못한 조직은 기준 일수 이상으로만
  const u = quietList({orgs:[orgs[1]], people:ppl, last, unsure:new Set(['o2']), today, weeks:4}).rows[0];
  assert.equal(daysText(u), '28일+'); assert.equal(lastText(u, today), '마지막 날 확인 못함');
  assert.equal(daysBetween('2026-10-01', '2026-10-29'), 28);
});

test('기준 주 수: 서버 값 모양은 DB 검사와 같다(정수 0~12), 기본 3주', () => {
  assert.equal(weeksOf(undefined), 3); assert.equal(weeksOf(0), 0); assert.equal(weeksOf(12), 12); assert.equal(weeksOf(13), 3); assert.equal(weeksOf(2.5), 3); assert.equal(weeksOf('3'), 3);
  for (const w of [0, 1, 3, 12]) assert.equal(validValue('quiet_weeks', w), true);
  for (const w of [-1, 13, 2.5, '3', null, true]) assert.equal(validValue('quiet_weeks', w), false);
  assert.deepEqual(WEEK_CHOICES, [2, 3, 4, 6, 0]);
});

test('화면: org-quiet.js가 줄의 유일한 renderer, 기기 저장·AI 없음, 내 담당조직 규칙', () => {
  const src = readFileSync(new URL('../app/org-quiet.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|callAiAssist|ai-assist/);
  assert.match(src, /selectMyOrganizations/);
  assert.match(src, /if \(mine\.fallback\) throw new Hide\(\)/);
  assert.doesNotMatch(src, /method:\s*'(POST|PATCH|DELETE)'/);
  const home = readFileSync(new URL('../app/home-read.js', import.meta.url), 'utf8');
  assert.equal((home.match(/data-home-card="quiet"/g) || []).length, 1);
});
