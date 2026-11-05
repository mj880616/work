import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// FAMILY-잊지말기 3단계: docs/ops/collector-feed.gs의 가족 방·가족 번호 처리(순수 함수)를 node에서 돌리고,
// 만든 몸통이 서버 collector-feed(handler.ts parseFamilyTgBody·parseCallBody)에서 그대로 읽히는지 본다. 네트워크·Drive 없음.
// 방·번호·사람·글은 모두 지어낸 값이다.
const source=readFileSync(new URL('../../docs/ops/collector-feed.gs',import.meta.url),'utf8');
const sandbox={module:{exports:{}}};
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'collector-feed.gs'});
const G=sandbox.module.exports;
const {parseFamilyTgBody,parseCallBody}=await import('../../supabase/functions/collector-feed/handler.ts');
const {parseCall}=await import('../../supabase/functions/collector-feed/call-analysis.ts');
const plain=(o)=>JSON.parse(JSON.stringify(o));
const TODAY='2026-10-25';
const code=source.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm,'');

test('가족 방 지정: 한 줄이면 ok, 둘 이상이면 bad(보내지 않음)이고 적힌 방은 모두 업무에서 뺀다',()=>{
  const one=plain(G.tgFeedFamilyPick('가상 가족방'));
  assert.deepEqual(one,{list:['가상 가족방'],ok:true,bad:false});
  const two=plain(G.tgFeedFamilyPick('가상 가족방, 777'));
  assert.equal(two.ok,false);assert.equal(two.bad,true);assert.deepEqual(two.list,['가상 가족방','777']);
  assert.deepEqual(plain(G.tgFeedFamilyPick('')),{list:[],ok:false,bad:false});
  assert.deepEqual(plain(G.tgFeedFamilyPick('*')),{list:[],ok:false,bad:false},'*는 가족 방이 될 수 없다');
  // 업무 목록이 `*`이든 직접 적었든 가족 방은 빠진다(빼기 우선).
  for(const wanted of [['*'],['가상 가족방'],['555']]){
    assert.equal(G.tgFeedRoomPick('555_가상 가족방',wanted,[].concat(two.list)),'',JSON.stringify(wanted));
    assert.equal(G.tgFeedRoomPick('555_가상 가족방',wanted,[].concat(one.list)),'');
  }
  // tgFeed_rooms_는 가족 목록을 뺄 목록에 늘 더하고, 정확히 한 폴더일 때만 가족 방으로 넣는다.
  assert.match(code,/exclude = exclude\.concat\(family\.list\);/);
  assert.match(code,/if \(famState === 'ok'\) rooms\.push\(familyRooms\[0\]\);/);
});

test('가족 방 상태: 정확히 한 폴더·업무와 안 겹칠 때만 ok',()=>{
  const ok={list:['x'],ok:true,bad:false};
  const room=(k)=>({key:k});
  assert.equal(G.tgFeedFamilyState({list:['a','b'],ok:false,bad:true},[room('1')],[]),'many');
  assert.equal(G.tgFeedFamilyState({list:[],ok:false,bad:false},[],[]),'none');
  assert.equal(G.tgFeedFamilyState(ok,[room('1'),room('2')],[]),'many_folders');
  assert.equal(G.tgFeedFamilyState(ok,[],[]),'missing');
  assert.equal(G.tgFeedFamilyState(ok,[room('1')],[room('1')]),'overlap');
  assert.equal(G.tgFeedFamilyState(ok,[room('1')],[room('2')]),'ok');
  for(const s of ['ok','none','many','many_folders','missing','overlap'])assert.ok(G.tgFeedFamilyText(s));
});

test('가족 방 몸통: 방 이름·이름표·방 종류 없이 self만, 서버 parseFamilyTgBody를 통과한다',()=>{
  const parsed=[
    {id:'5001',at:'2026-10-25T00:10:00.000Z',text:'토요일에 산책 갈까?',senderId:'9001',senderName:'가상 이름',senderSelf:false},
    {id:'5002',at:'2026-10-25T00:12:00.000Z',text:'좋아',senderId:'9002',senderName:'',senderSelf:true},
  ];
  const messages=plain(G.tgFeedAssignSenders(parsed));
  const self=plain(G.tgFeedSelfLabels(parsed,messages));
  assert.deepEqual(self,['B']);
  const work=G.tgFeedBuildBody({day:TODAY,roomKey:'555',roomLabel:'가상 가족방',total:2,part:1,attempt:1,messages,senders:[{label:'A',name:'가상 이름'}],chatKind:'user'});
  const body=plain(G.tgFeedFamilyBody(work,self));
  assert.deepEqual(Object.keys(body).sort(),['day','messages','room_key','self','total']);
  assert.doesNotMatch(JSON.stringify(body),/가상 가족방|가상 이름|9001|9002/);
  const fin=parseFamilyTgBody(body,TODAY);
  assert.equal(fin.messages.length,2);assert.ok(fin.self.has('B'));
  // 묶음이 나뉘거나 다시 보낼 때의 칸도 받는다.
  assert.ok(parseFamilyTgBody(plain(G.tgFeedFamilyBody({...work,part:2,attempt:2,cont:true},[])),TODAY));
});

test('가족 방이 처음이면 오늘부터(어제를 끝낸 날로, 보충 없음), 앞서 보낸 방이면 그 위치에서 이어간다',()=>{
  const state={startDay:'2026-10-01',backFrom:'2026-09-24',rooms:{}};
  const fresh=plain(G.tgFeedFamilyRoomState(state,'555',TODAY));
  assert.equal(fresh.doneDay,'2026-10-24');assert.equal(fresh.backDay,'');
  assert.deepEqual(plain(G.tgFeedPlanDays(fresh,state,TODAY,true)).map(p=>p.day),[TODAY]);
  const known={...state,rooms:{'555':{d:'2026-10-20',m:'4999',l:'2026-10-20'}}};
  const cont=plain(G.tgFeedFamilyRoomState(known,'555',TODAY));
  assert.equal(cont.doneDay,'2026-10-20');assert.equal(cont.lastId,'4999');
});

test('보내기 흐름: 가족 방은 family_tg로만, 이름표·해시를 만들지 않고, 업무 방을 먼저 보낸 뒤에 보낸다. 이름표 소급에서도 뺀다',()=>{
  assert.match(code,/var res = room\.family \? tgFeed_postAction_\('family_tg', body, secret\) : tgFeed_post_\(body, secret\);/);
  assert.match(code,/var senders = test \|\| room\.family \? \[\] :/);
  assert.match(code,/tgFeedNextRoom\(entries\.filter\(function \(x\) \{ return !x\.room\.family; \}\)\) \|\| tgFeedNextRoom\(entries\.filter\(function \(x\) \{ return x\.room\.family; \}\)\)/);
  assert.match(code,/found\.rooms = found\.rooms\.filter\(function \(r\) \{ return !r\.family; \}\);/);
  // 가족 방 이름·목록 값은 로그에 쓰지 않는다(상태 글만).
  for(const m of code.matchAll(/Logger\.log\(([\s\S]*?)\);\n/g))assert.doesNotMatch(m[1].replace(/callFeedFamilyText\(callFeedFamilyList\(props\.getProperty\(CALL_FEED_FAMILY_LIST_KEY\) \|\| ''\)\)/g,''),/family\.list|FAMILY_ROOM_KEY|FAMILY_LIST_KEY/,m[0].slice(0,120));
});

test('가족 번호 목록: 번호 하나·이름 하나까지만 한 사람, 그 이상이면 family 표시 없이 개인으로만',()=>{
  assert.equal(G.callFeedFamilyList('010-0000-0000').ok,true);
  assert.equal(G.callFeedFamilyList('010-0000-0000, 가상 가족').ok,true);
  const many=plain(G.callFeedFamilyList('010-0000-0000, 010-1234-5678'));
  assert.equal(many.ok,false);assert.equal(many.bad,true);
  assert.equal(G.callFeedFamilyList('가상 가족, 가상 친척').bad,true);
  assert.deepEqual(plain(G.callFeedFamilyList('')),{list:{numbers:[],names:[]},ok:false,bad:false});
  assert.doesNotMatch(G.callFeedFamilyText(G.callFeedFamilyList('010-0000-0000')),/010/);
  // 맞는 통화는 목록이 틀려도 개인으로 고정(familyHit → isList), family 표시는 ok일 때만.
  assert.match(code,/var isFamily = familyHit && family\.ok;\n\s*var isList = callFeedIsPersonal\(info\.contact, list\) \|\| familyHit;/);
  assert.match(code,/if \(isFamily\) \{ body\.family = true; tally\.family\+\+; \}/);
  assert.match(code,/var isList = callFeedIsPersonal\(info\.contact, list\) \|\| callFeedIsPersonal\(info\.contact, family\.list\);/,'다시 보내기도 개인으로 고정');
});

test('가족 번호 통화 몸통: family:true가 서버 parseCallBody를 통과하고, 업무 분석이어도 개인으로 읽힌다',()=>{
  const md=['---','analysis_version: "3.5"','status: "검토대기"','source_type: "통화녹음"','source_txt_id: "SRCFAKE0009zz"','source_txt_name: "통화 가상가족_261025_093000.txt"',
    'recording_datetime: "2026-10-25 09:30:00"','analysis_model: "gemini-fake"','is_work_related: true','call_title: "가상 · 주말 이야기"','---','','# 가상 · 주말 이야기','','## 핵심요약','- 주말 산책 이야기를 나눔.'].join('\n');
  const body=plain(G.callFeedBuildCallBody({ref:'SRCFAKE0009zz',analysisMd:md,transcript:'화자1: 주말에 산책 가자',contact:'가상가족',recordedAt:'2026-10-25 09:30:00',forcePersonal:true}));
  body.family=true;
  const input=parseCallBody(body);
  assert.equal(input.family,true);
  const p=parseCall(input,[],Date.parse('2026-10-25T03:00:00Z'),undefined,true);
  assert.equal(p.kind,'personal');assert.ok(p.box);
});
