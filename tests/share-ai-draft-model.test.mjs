import test from 'node:test';
import assert from 'node:assert/strict';
// 빠짐32 공유 페이지 AI 초안 — 화면 쪽 순수 함수(app/share-ai-draft-model.mjs).
import {shareDraftRequest, parseShareDraftAnswer, filledKeys, draftNodes, pickKey, splitKey, meetingLine, noteLine, SHARE_AI_MAX_PICK} from '../app/share-ai-draft-model.mjs';
import {toPlain} from '../app/ed-text.mjs';

const M1='e0000000-0000-4000-8000-000000000001',N1='f0000000-0000-4000-8000-000000000001';
const answer=(extra={})=>({ok:true,kind:'share_draft',partial:false,skipped:1,
  sections:{summary:[{text:'요약 한 줄',refs:[1]}],steps:[{text:'1단계',refs:[1]},{text:'근거 없음',refs:[9]}],schedule:[],issues:[{text:'요구',refs:[2]}],updates:[]},
  checks:['날짜 확인',''],sources:[{ref:1,type:'meeting',id:M1,label:'사업 보고',title:'교섭',day:'2026-10-02'},{ref:2,type:'note',id:N1,label:'노트',title:'',day:''}],...extra});

test('request: only type + id (1~6, unique, valid), focus trimmed and optional; no text',()=>{
  const keys=[pickKey('meeting',M1),pickKey('note',N1),pickKey('note',N1),'diary:'+N1,'note:x',...Array.from({length:8},(_,i)=>`note:f0000000-0000-4000-8000-00000000010${i}`)];
  const r=shareDraftRequest(keys,'  단협   철회 ');
  assert.equal(r.kind,'share_draft');assert.equal(r.focus,'단협 철회');
  assert.equal(r.sources.length,SHARE_AI_MAX_PICK);
  assert.deepEqual(r.sources.slice(0,2),[{type:'meeting',id:M1},{type:'note',id:N1}]);
  assert.deepEqual(Object.keys(shareDraftRequest([pickKey('meeting',M1)],' ')),['kind','sources']);
  assert.deepEqual(splitKey('meeting:'+M1.toUpperCase()),{type:'meeting',id:M1});assert.equal(splitKey(null),null);
});

test('answer: refs kept only inside the sources, lines without refs dropped, empty → null',()=>{
  const d=parseShareDraftAnswer(answer());
  assert.deepEqual(d.sections.steps,[{text:'1단계',refs:[1]}]);
  assert.deepEqual(d.checks,['날짜 확인']);assert.equal(d.skipped,1);
  assert.deepEqual(filledKeys(d),['summary','steps','issues']);
  assert.equal(parseShareDraftAnswer(answer({sections:{summary:[],steps:[],schedule:[],issues:[],updates:[]}})),null);
  assert.equal(parseShareDraftAnswer({...answer(),kind:'press_draft'}),null);
  assert.equal(parseShareDraftAnswer(answer({sources:[]})),null);
});

test('nodes: chosen sections only, heading + paragraph (summary) or bullet list; no refs or checks in the text',()=>{
  const d=parseShareDraftAnswer(answer());
  const nodes=draftNodes(d,['summary','issues','schedule']);
  assert.deepEqual(nodes.map(n=>n.type),['heading','paragraph','heading','bullet_list']);
  assert.deepEqual(nodes[0],{type:'heading',attrs:{level:2},content:[{type:'text',text:'한 줄 현황'}]});
  const plain=toPlain({v:'ed1',doc:{type:'doc',content:nodes}});
  assert.match(plain,/한 줄 현황/);assert.match(plain,/쟁점·요구/);assert.match(plain,/요구/);
  assert.ok(!/진행 단계|근거|날짜 확인/.test(plain));
  assert.deepEqual(draftNodes(d,[]),[]);
});

test('pick lines: meeting name with round and kind/date; note title or first line',()=>{
  assert.deepEqual(meetingLine({id:M1,title:'3차 교섭',series_name:'가상 임단협',round_no:3,meeting_at:'2026-10-02T05:00:00Z'},()=>'교섭'),{key:'meeting:'+M1,name:'가상 임단협 3차',meta:'사업 보고 · 교섭 · 10.2'});
  assert.deepEqual(noteLine({id:N1,kind:'basket',title:'',raw_text:'\n 첫 줄 \n둘째',occurred_at:'2026-10-22T09:00:00Z'}),{key:'note:'+N1,name:'첫 줄',meta:'업데이트 · 10.22'});
  assert.equal(noteLine({id:N1,kind:'note',title:'',raw_text:''}).name,'(빈 글)');
});
