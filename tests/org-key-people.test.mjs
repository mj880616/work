// ORG-주요인물: 담당조직 [주요 인물] 탭의 고르기 규칙(org-key-people-model.mjs)과 화면 연결(작은 탭·renderer 하나·여는 길).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {personDraft, needlesOf, whoIn, collectRecords, collectOpen, onlyPerson, dday, shortDay, briefStale, normName} from '../app/org-key-people-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const KIM = {id:'p1', name:'김하나', match_names:['김하나', '김 위원장']};
const PARK = {id:'p2', name:'박둘', match_names:['박둘', 'Park Dul']};
const people = [KIM, PARK];

test('[+ 인물] 입력: 이름은 첫 찾을 이름, 2자 미만·중복·제어문자 정리, DB와 같은 한도', () => {
  assert.deepEqual(personDraft({name:' 김하나 ', matches:['김 위원장', '김하나', '  ']}), {ok:true, name:'김하나', match_names:['김하나', '김 위원장']});
  assert.equal(personDraft({name:''}).ok, false);
  assert.equal(personDraft({name:'가'.repeat(41)}).ok, false);
  assert.match(personDraft({name:'김하나', matches:['김']}).error, /2자 이상/);
  // 한 글자 이름은 이름으로는 저장되지만 찾을 이름에는 들지 않는다.
  assert.deepEqual(personDraft({name:'김', matches:['김씨네']}), {ok:true, name:'김', match_names:['김씨네']});
  assert.equal(personDraft({name:'김하나', matches:Array.from({length:20}, (_, i) => '이름' + i)}).ok, false);
  assert.deepEqual(needlesOf({name:'김', match_names:['Park Dul']}), ['parkdul']);
  assert.equal(normName(' 김 · 하나 '), '김하나');
});

test('이름 찾기: 공백·대소문자 무시, 지정 순서, 지정하지 않은 사람은 없음', () => {
  assert.deepEqual(whoIn(['철도노조 김 하나 위원장'], people), ['p1']);
  assert.deepEqual(whoIn(['PARK DUL 사무국장, 김위원장'], people), ['p1', 'p2']);
  assert.deepEqual(whoIn(['이셋 부장'], people), []);
  assert.deepEqual(whoIn([null, undefined, ''], people), []);
});

test('지난 기록: 업무·개인 통화(상대·제목), 텔레그램(이름표 방·날 묶음 + 제목), 회의(내용), 최신순', () => {
  const rows = collectRecords({
    people,
    calls:[{id:'c1', day:'2026-10-20', occurred_at:'2026-10-20T01:00:00Z', counterpart:'철도노조 김하나 위원장', title:'교섭 일정', summary:'교섭 날짜 조율'},
      {id:'c2', day:'2026-10-21', counterpart:'다른 사람', title:'무관'}, {id:'c3', day:'2026-10-22', counterpart:'김하나', hidden_at:'x'}],
    personal:[{id:'pc1', day:'2026-10-25', occurred_at:'2026-10-25T03:00:00Z', counterpart:'박둘', title:'안부', summary:'개인 안부 통화', box:'personal'}],
    telegram:[{id:'t1', room_key:'r1', room_label:'철도 지부장방', day:'2026-10-23', occurred_at:'2026-10-23T02:00:00Z', title:'집회 공지'},
      {id:'t2', room_key:'r1', room_label:'철도 지부장방', day:'2026-10-23', occurred_at:'2026-10-23T05:00:00Z', title:'장소 변경'},
      {id:'t3', room_key:'r2', room_label:'다른 방', day:'2026-10-24', title:'박둘 위원 발언 정리'},
      {id:'t4', room_key:'r3', day:'2026-10-24', title:'아무도 아님'}],
    senders:{senders:[{id:'s1', name:null, auto_name:'김하나', is_self:false}, {id:'s2', name:'나', is_self:true}], links:[{room_key:'r1', day:'2026-10-23', label:'A', sender_id:'s1'}, {room_key:'r3', day:'2026-10-24', label:'A', sender_id:'s2'}]},
    meetings:[{id:'m1', title:'정책협의', round_no:3, meeting_at:'2026-10-18T05:00:00Z', notes:'참석: 김하나, 이셋'}, {id:'m2', title:'다른 회의', meeting_at:'2026-10-19', notes:'없음'}],
  });
  assert.deepEqual(rows.map(r => r.key), ['personal:pc1', 'telegram:r2\u00002026-10-24', 'telegram:r1\u00002026-10-23', 'call:c1', 'meeting:m1']);
  const tg = rows.find(r => r.key.startsWith('telegram:r1'));
  assert.deepEqual(tg.people, ['p1']);
  assert.equal(tg.text, '철도 지부장방 · 집회 공지 / 장소 변경');
  assert.deepEqual(tg.open, {view:'telegram', room:'r1', day:'2026-10-23', item:'t2'});
  assert.deepEqual(rows.find(r => r.key === 'personal:pc1').open, {view:'calls', id:'pc1'});
  assert.equal(rows.find(r => r.key === 'meeting:m1').text, '정책협의 3차');
  assert.deepEqual(onlyPerson(rows, 'p2').map(r => r.key), ['personal:pc1', 'telegram:r2\u00002026-10-24']);
  assert.equal(onlyPerson(rows, null).length, rows.length);
  assert.deepEqual(collectRecords({people:[], calls:[{id:'c1', counterpart:'김하나'}]}), []);
});

test('열린 것: 챙길 것(요약·근거)과 기다리는 약속(상대), 마감 가까운 순, 끝난 것은 뺌', () => {
  const rows = collectOpen({people,
    todos:[{id:'d1', summary:'김하나 위원장에게 자료 보내기', due:'2026-10-31', status:'open'}, {id:'d2', summary:'무관', status:'open'}, {id:'d3', summary:'박둘 회신', status:'tasked'}, {id:'d4', summary:'정리', evidence:'박둘: 다음 주 연락', status:'open'}],
    promises:[{id:'l1', title:'인력 충원안 회신', counterparty:'김하나', commitment_status:'waiting', follow_up_on:'2026-10-30'}, {id:'l2', title:'x', counterparty:'김하나', commitment_status:'fulfilled'}]});
  assert.deepEqual(rows.map(r => r.key), ['promise:l1', 'todo:d1', 'todo:d4']);
  assert.deepEqual(rows[0].open, {view:'ledger', id:'l1'});
  assert.equal(dday('2026-10-31', '2026-10-28'), 'D-3');
  assert.equal(dday('2026-10-28', '2026-10-28'), 'D-day');
  assert.equal(dday('2026-10-26', '2026-10-28'), 'D+2');
  assert.equal(dday('', '2026-10-28'), '');
  assert.equal(shortDay('2026-10-09', '2026-10-28'), '10.9');
  assert.equal(shortDay('2025-12-31', '2026-10-28'), '25.12.31');
});

test("'요즘' 한 문장: 없거나 오늘 것이 아니거나 주요 인물이 바뀌면 새로 받는다", () => {
  assert.equal(briefStale(null, people, '2026-10-29'), true);
  assert.equal(briefStale({day:'2026-10-28', people_ids:['p1', 'p2']}, people, '2026-10-29'), true);
  assert.equal(briefStale({day:'2026-10-29', people_ids:['p2', 'p1']}, people, '2026-10-29'), false);
  assert.equal(briefStale({day:'2026-10-29', people_ids:['p1']}, people, '2026-10-29'), true);
  assert.equal(briefStale(null, [], '2026-10-29'), false);
});

test('화면 연결: 맨 아래 작은 탭 4개(주요 인물 첫 탭), renderer 하나, 표 없으면 준비 중, 기록 여는 길', () => {
  const wd = read('app/workplace-detail.js');
  const tabs = [...wd.matchAll(/role="tab"[^>]*data-wd-tab="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs, ['people', 'basic', 'aff', 'recent']);
  assert.match(wd, /data-wd-tab="people" aria-controls="wdPanel_people" aria-selected="true"/);
  assert.match(wd, /<div id="wdPeople" class="okp"><\/div>/);
  assert.doesNotMatch(wd, /<details id="wdMore"/);
  assert.match(wd, /id="wdBasicView"/);
  assert.match(wd, /data-wd-panel="recent"[^>]*hidden><div class="wd-sub" id="wdRecent">[\s\S]*id="wdReportSlot"/);
  assert.match(wd, /paintKeyPeople\(\{host:document\.querySelector\('#wdPeople'\)/);
  const ui = read('app/org-key-people.js');
  assert.match(ui, /missingTable\(e\) \? 'missing'/);
  assert.match(ui, /data-okp-preparing>준비 중이에요/);
  assert.match(ui, /KPTUCallFeed\?\.show\?\./);
  assert.match(ui, /KPTUTelegramFeed\?\.show\?\./);
  assert.match(ui, /openReport\(o\.id\)/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
  // 기존 읽기 경로 재사용: 새 통화·텔레그램 읽기 함수를 만들지 않는다.
  assert.match(ui, /from '\.\/feed-data\.js'/);
  assert.match(ui, /from '\.\/tg-sender-data\.js'/);
  assert.match(read('app/call-feed.js'), /window\.KPTUCallFeed = \{reload:\(\) => load\(\), open:openCall, show:showCall\}/);
  assert.match(read('app/telegram-feed.js'), /window\.KPTUTelegramFeed = \{reload:\(\) => load\(\), show:showDay\}/);
  assert.match(read('app/ledger-browse-model.mjs'), /export const waitingCommitmentsPath/);
});
