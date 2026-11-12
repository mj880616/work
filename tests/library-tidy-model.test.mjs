import test from 'node:test';
import assert from 'node:assert/strict';
import {kindWords,tidyKey,tidyUnits,tidyGroups,retargetGroup,tidyPlan,tidyAtText,tidySummary} from '../app/library-sort-model.mjs';

// LIB-정돈제안(S61-13): 자료실 전체(또는 폴더 안)에서 같은 종류인데 폴더가 갈라진 자료 묶음 — 순수 규칙. 이름은 모두 지어낸 것.
const id=n=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const IM=id(1),PR=id(2),RC=id(3),REC=id(4),REC2=id(5),EDU=id(6),SUB=id(7);
const folders=[{id:IM,name:'임금협약',parent_id:null},{id:PR,name:'성명·보도자료',parent_id:null},{id:RC,name:'잡동사니',parent_id:null},{id:REC,name:'회의 녹음',parent_id:null},{id:REC2,name:'3월',parent_id:REC},{id:EDU,name:'교육',parent_id:null},{id:SUB,name:'초안',parent_id:IM}];
const doc=(n,title,extra={})=>({id:id(100+n),title,...extra});
const docs=[
  doc(1,'가상 철도 잠정합의서.hwp'),doc(2,'가상 버스 합의서'),doc(3,'가상 택시 합의서'),
  doc(4,'가상 합의서 3쪽'),doc(5,'가상 해운 합의서'),doc(6,'가상 합의서 이행 촉구 보도자료'),
  doc(7,'가상 회의 합의서 녹음',{file_name:'녹음.m4a',mime_type:'audio/mp4'}),doc(8,'가상 녹음 합의서'),
  doc(9,'교육 명단'),doc(10,'교육 명단 2차'),doc(11,'메모'),
];
const items=[
  {document_id:id(101),folder_id:PR},{document_id:id(102),folder_id:IM},{document_id:id(103),folder_id:IM},
  {document_id:id(104),folder_id:RC},{document_id:id(105),folder_id:SUB},{document_id:id(106),folder_id:PR},
  {document_id:id(107),folder_id:IM},{document_id:id(108),folder_id:REC2},
  {document_id:id(109),folder_id:RC},
];

test('종류 낱말: 나오는 차례, 겹치면 긴 것, 묶음 낱말은 맨 뒤 종류 낱말 또는 첫 낱말',()=>{
  assert.deepEqual(kindWords('가상 합의서 이행 촉구 보도자료'),['합의서','보도자료']);
  assert.deepEqual(kindWords('성명서 초안'),['성명서']);
  assert.equal(tidyKey('가상 철도 잠정합의서.hwp'),'합의서');
  assert.equal(tidyKey('교육 명단 2차'),'명단');
  assert.equal(tidyKey('산별 토론회'),'산별');
  assert.equal(tidyKey('12'),'');
});

test('단위: 녹음 폴더(와 하위)·소리 파일은 빼고, 폴더 밖은 from=null, 범위 폴더를 주면 그 안(하위 포함)만',()=>{
  const all=tidyUnits(docs,items,folders);
  assert.deepEqual(all.map(u=>u.key).sort(),[1,2,3,4,5,6,9,10,11].map(n=>id(100+n)).sort());
  assert.equal(all.find(u=>u.key===id(110)).from,null);
  const inIm=tidyUnits(docs,items,folders,{scopeId:IM});
  assert.deepEqual(inIm.map(u=>u.key).sort(),[id(102),id(103),id(105)].sort());
  // 사진 묶음: 안 사진이 모두 한 자리면 한 단위.
  const set={id:'photoset:m1',photoset:true,title:'가상 합의서 사진',photos:[{id:id(201)},{id:id(202)}]};
  const u=tidyUnits([set],[{document_id:id(201),folder_id:RC},{document_id:id(202),folder_id:RC}],folders);
  assert.deepEqual(u.map(x=>[x.key,x.from,x.ids.length]),[['photoset:m1',RC,2]]);
  assert.deepEqual(tidyUnits([set],[{document_id:id(201),folder_id:RC},{document_id:id(202),folder_id:IM}],folders),[]);
});

test('묶음: 폴더가 둘 이상으로 갈라진 같은 종류만, 가장 많이 든 폴더로, 다른 종류 낱말이 섞인 자료는 체크를 풀어 둠',()=>{
  const {groups,newGroups}=tidyGroups(tidyUnits(docs,items,folders),{folders,receiveId:RC});
  assert.deepEqual(groups.map(g=>g.word),['합의서','명단']);
  const h=groups[0];
  assert.equal(h.total,5);
  assert.deepEqual(h.to,{folder:IM});
  assert.equal(h.stay,2);
  assert.deepEqual(h.rows.map(r=>[r.key,r.checked]),[[id(101),true],[id(104),true],[id(105),true]]);
  assert.equal(tidyAtText(h.at,f=>f?folders.find(x=>x.id===f).name:'폴더 밖'),'지금: 임금협약 2 · 성명·보도자료 1 · 잡동사니 1 · 초안 1');
  // '가상 합의서 이행 촉구 보도자료'는 보도자료 묶음(1개뿐이라 묶음 아님).
  assert.ok(!groups.some(g=>g.rows.some(r=>r.key===id(106))));
  // 명단: 잡동사니 1 · 폴더 밖 1 — 마땅한 폴더가 없어 새 폴더 '명단'(맨 위).
  assert.deepEqual(groups[1].to,{group:newGroups[0].gid});
  assert.deepEqual(newGroups,[{gid:newGroups[0].gid,name:'명단',parent:null}]);
  assert.equal(tidySummary(groups),'같은 종류인데 폴더가 갈라진 자료 2묶음(5개)을 찾았어요. 묶음마다 선택하세요.');
  assert.equal(tidySummary([]),'흩어진 같은 종류 자료를 찾지 못했어요.');
});

test('섞인 종류·이미 이름이 맞는 폴더는 체크 풀어 둠, 같은 이름 폴더가 있으면 새로 만들지 않음',()=>{
  const fs=[...folders,{id:id(8),name:'명단',parent_id:null}];
  const ds=[doc(1,'가상 합의서'),doc(2,'가상 합의서 2'),doc(3,'가상 합의서 보도자료 합의서'),doc(4,'가상 합의서 사본'),doc(9,'교육 명단'),doc(10,'교육 명단 2차')];
  const fsx=[...fs,{id:id(9),name:'합의서 원본',parent_id:null}];
  const it=[{document_id:id(101),folder_id:IM},{document_id:id(102),folder_id:IM},{document_id:id(103),folder_id:PR},{document_id:id(104),folder_id:id(9)},{document_id:id(109),folder_id:RC}];
  const {groups,newGroups}=tidyGroups(tidyUnits(ds,it,fsx),{folders:fsx,receiveId:RC});
  const h=groups.find(g=>g.word==='합의서');
  assert.deepEqual(h.rows.map(r=>[r.key,r.checked,r.note]),[[id(103),false,"이름에 '보도자료' — 체크 풀어 둠"],[id(104),false,'지금 폴더 이름과 맞아 체크 풀어 둠']]);
  assert.equal(h.mode,'keep');
  const m=groups.find(g=>g.word==='명단');
  assert.deepEqual(m.to,{folder:id(8)});assert.deepEqual(newGroups,[]);
});

test('옮길 곳 바꾸기·계획: 그대로 묶음은 빼고, 원래 자리별로 나눠 옮김, 새 폴더는 쓰일 때만',()=>{
  const {groups,newGroups}=tidyGroups(tidyUnits(docs,items,folders),{folders,receiveId:RC});
  let [h,m]=groups;
  // 합의서를 '성명·보도자료'로 바꾸면 그 안 1개는 그대로, 임금협약 2개가 줄로.
  const h2=retargetGroup(h,{folder:PR},h.rows);
  assert.deepEqual(h2.rows.map(r=>r.key).sort(),[id(102),id(103),id(104),id(105)].sort());
  assert.equal(h2.stay,1);
  const plan=tidyPlan([h,m],newGroups);
  assert.equal(plan.count,5);
  assert.deepEqual(plan.create.map(g=>g.name),['명단']);
  assert.deepEqual(plan.moves.map(x=>[x.from,x.folder||x.group,x.ids.length]),[[PR,IM,1],[RC,IM,1],[SUB,IM,1],[RC,newGroups[0].gid,1],[null,newGroups[0].gid,1]]);
  const keep=tidyPlan([h,{...m,mode:'keep'}],newGroups);
  assert.equal(keep.count,3);assert.deepEqual(keep.create,[]);
});
