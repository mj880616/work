import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveUnits,ruleSuggestions,startRows,aiBatches,mergeAi,settleRows,renameGroup,placeGroup,usedGroups,applyPlan,sortSummary,doneText,SORT_AI_BATCH} from '../app/library-sort-model.mjs';

// LIB-받는폴더나누기(S60-18): 받는 폴더 자료 나누기 제안 규칙.
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const RC=id(1),GYO=id(2),HOE=id(3),SUB=id(4);
const folders=[{id:RC,name:'잡동사니',parent_id:null},{id:GYO,name:'교섭',parent_id:null},{id:HOE,name:'회의',parent_id:null},{id:SUB,name:'사진',parent_id:RC}];
const doc=(n,title,extra={})=>({id:id(100+n),title,category:null,project_id:null,...extra});
const docs=[doc(1,'임금협약 잠정합의서'),doc(2,'쟁대위 회의록'),doc(3,'임금협약 요구안'),doc(4,'쟁대위 자료'),doc(5,'알 수 없는 메모')];
const items=[{document_id:id(101),folder_id:RC},{document_id:id(102),folder_id:RC},{document_id:id(105),folder_id:RC},{document_id:id(103),folder_id:GYO},{document_id:id(104),folder_id:HOE}];

test('받는 폴더 바로 안 자료만 단위가 되고, 사진 묶음은 안 사진이 모두 받는 폴더일 때만 한 단위',()=>{
  const set={id:'photoset:m1',photoset:true,title:'가상 보고 사진',photos:[{id:id(201)},{id:id(202)}]};
  const half={id:'photoset:m2',photoset:true,title:'반만',photos:[{id:id(203)},{id:id(204)}]};
  const it=[...items,{document_id:id(201),folder_id:RC},{document_id:id(202),folder_id:RC},{document_id:id(203),folder_id:RC},{document_id:id(204),folder_id:GYO}];
  const u=receiveUnits([...docs,set,half],it,RC);
  assert.deepEqual(u.map(x=>x.key),[id(101),id(102),id(105),'photoset:m1']);
  assert.deepEqual(u.at(-1).ids,[id(201),id(202)]);
  assert.deepEqual(receiveUnits(docs,items,null),[]);
});

test('① 규칙 제안: 같은 첫 낱말 자료가 든 폴더, 받는 폴더 자신은 후보가 아님',()=>{
  const u=receiveUnits(docs,items,RC);
  const rule=ruleSuggestions(u,{docs,items,folders,receiveId:RC});
  assert.equal(rule.get(id(101)),GYO);
  assert.equal(rule.get(id(102)),HOE);
  assert.equal(rule.has(id(105)),false);
  const rows=startRows(u,rule);
  assert.deepEqual(rows.map(r=>[r.checked,r.wait]),[[true,false],[true,false],[false,true]]);
  assert.deepEqual(aiBatches(rows),[[id(105)]]);
});

test('AI 묶음은 40개씩',()=>{
  const rows=Array.from({length:SORT_AI_BATCH+5},(_,i)=>({wait:true,ids:[id(1000+i)]}));
  assert.deepEqual(aiBatches(rows).map(b=>b.length),[SORT_AI_BATCH,5]);
});

test('② ③ 서버 답 합치기: 고를 수 없는 폴더는 버리고, 같은 이름·자리 새 폴더는 한 묶음, 이미 있는 이름이면 그 폴더',()=>{
  const rows=[1,2,3,4,5].map(n=>({key:id(300+n),ids:[id(300+n)],title:'t',checked:false,to:null,why:'',wait:true}));
  const ans={items:[
    {id:id(301),folder_id:HOE,new:null,why:'회의 자료'},
    {id:id(302),folder_id:id(999),new:null,why:'다른 작업공간 폴더'},
    {id:id(303),folder_id:null,new:{name:'산별전환',parent_id:GYO},why:'새로'},
    {id:id(304),folder_id:null,new:{name:' 산별전환 ',parent_id:GYO},why:''},
    {id:id(305),folder_id:null,new:{name:'회의',parent_id:null},why:''},
  ]};
  const {rows:r,groups:g}=mergeAi(rows,[],ans,{folders,receiveId:RC});
  assert.deepEqual(r[0].to,{folder:HOE});
  assert.equal(r[1].wait,true,'모르는 폴더 id는 쓰지 않음');
  assert.deepEqual(r[2].to,{group:'n1'});assert.deepEqual(r[3].to,{group:'n1'});
  assert.deepEqual(g,[{gid:'n1',name:'산별전환',parent:GYO}]);
  assert.deepEqual(r[4].to,{folder:HOE},'같은 자리 같은 이름 폴더가 있으면 그 폴더');
  const rc=mergeAi(rows,[],{items:[{id:id(301),folder_id:RC}]},{folders,receiveId:RC});
  assert.equal(rc.rows[0].wait,true,'받는 폴더 자신은 고르지 않음');
  const bad=mergeAi(rows,[],{items:[{id:id(301),folder_id:null,new:{name:'x'.repeat(41),parent_id:null}}]},{folders,receiveId:RC});
  assert.equal(bad.rows[0].wait,true);
  assert.deepEqual(settleRows(r)[1],{...r[1],wait:false,checked:false,to:null});
});

test('새 폴더 이름·자리 고치기, 체크를 다 풀면 만들지 않음, 옮기기 계획',()=>{
  let groups=[{gid:'n1',name:'산별전환',parent:GYO}];
  assert.equal(renameGroup(groups,'n1','  '),null);
  groups=renameGroup(groups,'n1','산별 전환');groups=placeGroup(groups,'n1',null);
  assert.deepEqual(groups,[{gid:'n1',name:'산별 전환',parent:null}]);
  const rows=[{key:'a',ids:['a'],checked:true,to:{folder:GYO}},{key:'b',ids:['b1','b2'],checked:true,to:{folder:GYO}},{key:'c',ids:['c'],checked:false,to:{group:'n1'}},{key:'d',ids:['d'],checked:true,to:null}];
  assert.deepEqual(usedGroups(rows,groups),[]);
  assert.deepEqual(applyPlan(rows,groups),{create:[],moves:[{folder:GYO,ids:['a','b1','b2']}],count:2});
  rows[2].checked=true;
  assert.deepEqual(applyPlan(rows,groups).create,groups);
  assert.equal(applyPlan(rows,groups).count,3);
});

test('창 위 한 줄과 옮긴 뒤 한 줄',()=>{
  assert.equal(sortSummary([{to:{folder:'a'}},{to:{group:'n1'}},{to:null},{wait:true}]),'4개 중 1개는 있는 폴더, 1개는 새 폴더를 제안해요 · 그대로 둬요 1개 · 나머지 1개 찾는 중. 체크한 것만 옮겨요.');
  assert.equal(doneText(16,1),'16개를 폴더로 옮겼어요 · 새 폴더 1개 ·');
});
