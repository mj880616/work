import test from 'node:test';
import assert from 'node:assert/strict';
import {bulkBody,bulkUndoBody,bulkChoices,commonValue,bulkResultText,createBulkEditor,rangeIds} from '../app/library-bulk.js';
// LIB-폴더탐색기 ③: 일괄 수정의 순수한 부분·차례 실행. 화면·네트워크 없음.
const NOW='2026-10-26T00:00:00.000Z';
const doc=extra=>({id:'d1',title:'제목',category:'정책자료',project_id:'p1',organization_id:null,auto_classified:true,classification_note:'자동 분류',field_origin:{category:'ai',project_id:'ai'},...extra});

test('bulkBody: 바꾼 칸만, 사용자 수정 표시와 칸 기록 user, 같은 값이면 요청 없음',()=>{
  assert.deepEqual(bulkBody(doc(),'category','기타',NOW),{category:'기타',updated_at:NOW,auto_classified:false,classification_note:'사용자 수정',field_origin:{category:'user',project_id:'ai'}});
  assert.deepEqual(bulkBody(doc(),'project','p2',NOW),{project_id:'p2',updated_at:NOW,auto_classified:false,classification_note:'사용자 수정',field_origin:{category:'ai',project_id:'user'}});
  assert.equal(bulkBody(doc(),'project','p1',NOW),null);
  assert.equal(bulkBody(doc(),'category','정책자료',NOW),null);
  assert.equal(bulkBody(doc(),'category','',NOW),null,'종류는 비울 수 없다');
  assert.deepEqual(bulkBody(doc(),'project','',NOW).project_id,null,'프로젝트 없음 = null');
  // 조직 연결은 AI 기록이 있을 때만 user로 바꾼다(기록이 없는 연결은 사용자 수정 표시로 잠긴다).
  assert.deepEqual(bulkBody(doc(),'organization','o1',NOW).field_origin,{category:'ai',project_id:'ai'});
  assert.deepEqual(bulkBody(doc({field_origin:{organization_id:'ai'}}),'organization','o1',NOW).field_origin,{organization_id:'user'});
  // 칸이 없는 DB(적용 전)는 field_origin을 보내지 않는다.
  const old=doc();delete old.field_origin;assert.equal(Object.hasOwn(bulkBody(old,'category','기타',NOW),'field_origin'),false);
  assert.equal(bulkBody(doc(),'nope','x'),null);
});

test('bulkUndoBody: 바꾸기 전 값·기록으로',()=>{
  assert.deepEqual(bulkUndoBody(doc(),'project',NOW),{project_id:'p1',updated_at:NOW,auto_classified:true,classification_note:'자동 분류',field_origin:{category:'ai',project_id:'ai'}});
  assert.equal(bulkUndoBody(doc({project_id:undefined}),'project',NOW).project_id,null);
});

test('bulkChoices·commonValue·bulkResultText',()=>{
  assert.deepEqual(bulkChoices('project',{projects:[{value:'p1',label:'가',depth:1}]}),[{value:'',label:'사업영역 없음'},{value:'p1',label:'가',depth:1}]);
  assert.deepEqual(bulkChoices('organization',{organizations:[{id:'o1',name:'A'},{id:'o2'}]}).map(x=>x.label),['담당조직 없음','A','이름 없는 조직']);
  assert.deepEqual(bulkChoices('category',{categories:['기타','정책자료']}).map(x=>x.value),['기타','정책자료']);
  assert.equal(commonValue([doc(),doc({id:'d2'})],'project'),'p1');
  assert.equal(commonValue([doc(),doc({id:'d2',project_id:null})],'project'),undefined);
  assert.equal(commonValue([doc({project_id:null}),doc({id:'d2',project_id:undefined})],'project'),null);
  assert.equal(bulkResultText({label:'종류',changed:3}),'3개의 종류을(를) 바꿨어요 ·');
  assert.equal(bulkResultText({label:'종류',changed:0}),'이미 모두 같은 종류이에요.');
  assert.match(bulkResultText({label:'종류',changed:2,failed:1}),/1개는 바꾸지 못했어요/);
});

test('rangeIds: 마지막으로 고른 줄부터 이 줄까지(위아래 어느 쪽이든)',()=>{
  const order=['a','b','c','d','e'];
  assert.deepEqual(rangeIds(order,'b','d'),['b','c','d']);
  assert.deepEqual(rangeIds(order,'d','b'),['b','c','d']);
  assert.deepEqual(rangeIds(order,null,'c'),['c']);
  assert.deepEqual(rangeIds(order,'a','zz'),[]);
});

function fake(docs,{failOn=null,status=500}={}){
  const calls=[];let rows=docs.map(d=>structuredClone(d));
  const api=async(path,opt)=>{
    const id=decodeURIComponent(/id=eq\.([^&]+)/.exec(path)[1]);calls.push({id,body:opt.body,epoch:opt.expectedSessionEpoch});
    if(id===failOn)throw Object.assign(new Error('x'),{status});
    const row=rows.find(r=>r.id===id);Object.assign(row,opt.body);return [structuredClone(row)];
  };
  const ed=createBulkEditor({api,scope:()=>({workspace:'w1',epoch:7}),docs:()=>rows,replaceRow:row=>{rows=rows.map(r=>r.id===row.id?structuredClone(row):r)}});
  return {ed,calls,rows:()=>rows};
}

test('apply: 하나씩 차례로, 이미 같은 자료는 건너뛰고, 서버 값으로 갈아 끼움',async()=>{
  const f=fake([doc(),doc({id:'d2',project_id:'p2'}),doc({id:'d3',project_id:'p2'})]);
  const r=await f.ed.apply(['d1','d2','d3'],'project','p2');
  assert.equal(r.changed,1);assert.equal(r.same,2);assert.deepEqual(r.failed,[]);
  assert.deepEqual(f.calls.map(c=>[c.id,c.epoch]),[['d1',7]]);
  assert.equal(f.rows().find(x=>x.id==='d1').project_id,'p2');
  assert.equal(f.rows().find(x=>x.id==='d1').field_origin.project_id,'user');
});

test('apply: 한 건 실패는 그 자료만 실패, 로그인·권한 문제(401/403)면 남은 것은 요청하지 않음',async()=>{
  let f=fake([doc(),doc({id:'d2'}),doc({id:'d3'})],{failOn:'d2',status:500});
  let r=await f.ed.apply(['d1','d2','d3'],'category','기타');
  assert.deepEqual(r.done,['d1','d3']);assert.deepEqual(r.failed,['d2']);assert.equal(r.changed,2);
  f=fake([doc(),doc({id:'d2'}),doc({id:'d3'})],{failOn:'d2',status:403});
  r=await f.ed.apply(['d1','d2','d3'],'category','기타');
  assert.deepEqual(r.failed,['d2']);assert.deepEqual(r.skipped,['d3']);assert.deepEqual(f.calls.map(c=>c.id),['d1','d2']);
  assert.equal((await fake([]).ed.apply([],'category','기타')).changed,0);
});

test('apply: 로그인 확인이 안 되면 아무것도 보내지 않음',async()=>{
  const calls=[];const ed=createBulkEditor({api:async()=>{calls.push(1)},scope:()=>null,docs:()=>[doc()],replaceRow(){}});
  assert.deepEqual(await ed.apply(['d1'],'category','기타'),{error:'scope'});assert.equal(calls.length,0);
});

test('undo: 바꾼 값이 그대로인 자료만 원래 값으로, 그 사이 또 바뀐 것은 둠',async()=>{
  const f=fake([doc(),doc({id:'d2'})]);
  const r=await f.ed.apply(['d1','d2'],'category','기타');
  f.rows().find(x=>x.id==='d2').category='회의자료';
  const u=await f.ed.undo(r.before,'category','기타');
  assert.deepEqual(u,{back:1,kept:1});
  assert.equal(f.rows().find(x=>x.id==='d1').category,'정책자료');assert.deepEqual(f.rows().find(x=>x.id==='d1').field_origin,{category:'ai',project_id:'ai'});
  assert.equal(f.rows().find(x=>x.id==='d2').category,'회의자료');
});

// LIB-소분류 ②: 분류 바꾸기 목록에서 소분류는 한 칸 들여 소분류 이름만.
test('category choices indent subcategories under their parent',()=>{
  assert.deepEqual(bulkChoices('category',{categories:['선전','선전›투쟁속보','기타']}),[{value:'선전',label:'선전'},{value:'선전›투쟁속보',label:'투쟁속보',depth:1},{value:'기타',label:'기타'}]);
});
