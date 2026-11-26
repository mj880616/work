import test from 'node:test';
import assert from 'node:assert/strict';
import {featuresOf,folderPath,learnModel,nearestFolder,learnWhy} from '../app/library-learn-model.mjs';
import {learnReasons,ruleReasons,receiveUnits,startRows,tidyUnits,tidyGroups,tidyPlan,autoMovedIds} from '../app/library-sort-model.mjs';

// S69-16 LIB-정돈본보기(사용자 11/24 08:26): 사람이 이미 폴더에 넣어 둔 자료를 본보기로 가장 닮은 폴더를 고른다. 이름은 모두 지어낸 것.
const id=n=>`e1600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// 깊은 폴더: 가상궤도 › 회의 › 대표자 / 집행위, 가상궤도 › 집행국 회의 / 민자철도 회의, 가상팀 › 회의 › 집행위 / 본부 운영위, 받는 폴더 잡동사니
const A=id(1),AM=id(2),AMR=id(3),AMX=id(4),AG=id(5),AP=id(6),B=id(7),BM=id(8),BMX=id(9),BMO=id(10),RCV=id(11);
const folders=[[A,'가상궤도',null],[AM,'회의',A],[AMR,'대표자',AM],[AMX,'집행위',AM],[AG,'집행국 회의',A],[AP,'민자철도 회의',A],
  [B,'가상팀',null],[BM,'회의',B],[BMX,'집행위',BM],[BMO,'본부 운영위',BM],[RCV,'잡동사니',null]].map(([fid,name,parent_id])=>({id:fid,name,parent_id}));
const FILED=[
  ['가상궤도협의회 제3차 대표자회의 자료.hwp',AMR],['가상궤도협의회 6차대표자회의자료 2026.10.02',AMR],['가상궤도 대표자회의 회의록',AMR],
  ['가상궤도협의회 2차집행위원회회의자료',AMX],['가상궤도 집행위 회의록 11.05',AMX],['가상궤도협의회 집행위원회 회의자료(10월)',AMX],
  ['26-41차 집행국 회의자료',AG],['집행국 회의 결과 1105',AG],['민자철도 대응 회의 자료',AP],
  ['43차 본부집행위원회 회의자료',BMX],['44차 본부집행위원회 회의자료',BMX],['가상팀 집행위 회의록',BMX],
  ['본부 운영위원회 회의자료 3차',BMO],['2026 본부운영위 회의록',BMO],
];
const NEW=[
  ['가상궤도협의회 제7차 대표자회의자료.hwp',AMR],['가상궤도협의회 5차집행위원회회의자료',AMX],['45차 본부집행위원회 회의자료',BMX],
  ['26-45차 집행국 회의자료',AG],['본부 운영위원회 회의자료 4차',BMO],
];
const docs=[...FILED.map(([title],i)=>({id:id(100+i),title})),...NEW.map(([title],i)=>({id:id(200+i),title})),
  {id:id(300),title:'집행위 회의록'},{id:id(301),title:'메모'},{id:id(302),title:'붙여넣은 그림 11-13 03:38'}];
const items=[...FILED.map(([,f],i)=>({document_id:id(100+i),folder_id:f})),...docs.filter(d=>d.id>=id(200)).map(d=>({document_id:d.id,folder_id:RCV}))];

test('특징: 날짜 꼴·회차 숫자·확장자는 빼고, 붙여 쓴 한글 이름은 두 글자 조각으로',()=>{
  const f=featuresOf('가상궤도협의회 제7차 대표자회의자료 2026.11.05.hwp');
  assert.ok(f.includes('w:가상궤도협의회')&&f.includes('w:대표자회의자료')&&f.includes('b:궤도')&&f.includes('b:대표'));
  assert.ok(!f.some(x=>/\d|hwp/.test(x)),f.join(','));
  assert.deepEqual(featuresOf('26-41차 11.05 1105'),[]);
  assert.deepEqual(folderPath(folders,AMR),['가상궤도','회의','대표자']);
});

test('본보기 → 새 자료는 맞는 깊은 폴더로, 까닭은 닮은 자료 이름 2~3개',()=>{
  const units=receiveUnits(docs,items,RCV),got=ruleReasons(units,{docs,items,folders,receiveId:RCV});
  NEW.forEach(([title,want],i)=>{const r=got.get(id(200+i));assert.equal(r?.folder,want,title);assert.ok(r.learn,title);assert.match(r.why,/^닮은 자료: /)});
  const r=got.get(id(200));
  assert.equal(r.why,learnWhy(r.like));assert.ok(r.like.length>=2&&r.like.length<=3);
  assert.ok(r.like.every(t=>/대표자/.test(t)),r.why);
  // 같은 '집행위' 이름 폴더가 둘이어도 앞 이름(가상궤도 / 본부)으로 갈린다.
  assert.equal(got.get(id(201)).folder,AMX);assert.equal(got.get(id(202)).folder,BMX);
});

test('애매하면: 닮은 폴더가 여럿이면 고르기(체크 없음·AI에도 안 보냄), 닮음이 약하면 그대로',()=>{
  const units=receiveUnits(docs,items,RCV),got=ruleReasons(units,{docs,items,folders,receiveId:RCV});
  const p=got.get(id(300));
  assert.equal(p.pick,true);assert.equal(p.folder,null);assert.deepEqual(p.alt.slice(0,2).sort(),[AMX,BMX].sort());
  assert.match(p.why,/^비슷한 폴더 여럿\(.*회의 › 집행위.*\) — 직접 선택$/);
  const rows=startRows(units,got),row=rows.find(r=>r.key===id(300));
  assert.deepEqual([row.checked,row.to,row.wait,row.pick],[false,null,false,true]);
  // '메모'·기본 이름 그림은 본보기 판정 없음(옛 규칙·AI 차례로 넘어감).
  const learned=learnReasons(units,{docs,items:items.filter(x=>x.folder_id!==RCV),folders,targets:folders.filter(f=>f.id!==RCV).map(f=>f.id)});
  assert.equal(learned.has(id(301)),false);assert.equal(learned.has(id(302)),false);
  // 폴더에 든 자료가 하나도 없으면 본보기 없음.
  assert.equal(learnReasons(units,{docs,items:[],folders}).size,0);
});

test('정돈 제안: 받는 폴더 자료를 본보기 폴더별 묶음으로, 고르기 묶음은 기본 그대로',()=>{
  const {groups}=tidyGroups(tidyUnits(docs,items,folders),{folders,receiveId:RCV});
  // (같은 폴더로 가는 흩어진 묶음이 있으면 그 묶음에 합쳐진다 — 줄 글은 그대로 '닮은 자료')
  for(const [title,want] of NEW){
    const g=groups.find(x=>!x.pick&&x.rows.some(r=>r.title===title));
    assert.equal(g?.to.folder,want,title);assert.equal(g.mode,'move');
    const r=g.rows.find(x=>x.title===title);assert.ok(r.checked&&/^닮은 자료: /.test(r.note),title);
  }
  const pick=groups.find(g=>g.pick);
  assert.deepEqual([pick.mode,pick.rows.map(r=>r.title)],['keep',['집행위 회의록']]);
  const plan=tidyPlan(groups,[]);
  assert.equal(plan.count,NEW.length);
  assert.ok(plan.moves.every(m=>m.from===RCV));
});

test('손으로 옮긴 것을 배움: 같은 자료를 다른 폴더로 옮기면 다음 제안이 따라간다',()=>{
  // 처음: '민자철도' 자료가 '집행국 회의'에 들어 있다 → 새 민자철도 자료도 집행국 회의로.
  const t0=[{id:id(400),title:'민자철도 대응 회의 결과'},{id:id(401),title:'민자철도 대응 회의 자료 2'},{id:id(402),title:'민자철도 대응 회의 3차'}];
  const fs=folders,ds=[...docs,...t0];
  const before=[...items.filter(x=>x.document_id!==id(108)),{document_id:id(108),folder_id:AG},{document_id:id(400),folder_id:AG},{document_id:id(401),folder_id:AG},{document_id:id(402),folder_id:RCV}];
  const g0=ruleReasons(receiveUnits(ds,before,RCV),{docs:ds,items:before,folders:fs,receiveId:RCV}).get(id(402));
  assert.equal(g0?.folder,AG);
  // 사람이 민자철도 자료 셋을 '민자철도 회의'로 옮긴 뒤 → 새 자료 제안도 민자철도 회의로.
  const after=before.map(x=>[id(108),id(400),id(401)].includes(x.document_id)?{...x,folder_id:AP}:x);
  const g1=ruleReasons(receiveUnits(ds,after,RCV),{docs:ds,items:after,folders:fs,receiveId:RCV}).get(id(402));
  assert.equal(g1?.folder,AP);
  assert.match(g1.why,/민자철도/);
});

test('정돈이 옮겨 두고 손대지 않은 자료는 본보기 무게가 낮고, 사람이 옮기면 다시 제 무게',()=>{
  // 다른 이름 자료 둘이 정돈 제안으로 '본부 운영위'에 잘못 옮겨졌다(옮긴 기록에 남음).
  const wrong=[{id:id(500),title:'가상궤도 대표자회의 결과'},{id:id(501),title:'가상궤도 대표자회의 메모'}];
  const ask={id:id(502),title:'가상궤도 대표자회의 정리'};
  const ds=[...docs,...wrong,ask];
  const it=[...items,{document_id:id(500),folder_id:BMO},{document_id:id(501),folder_id:BMO},{document_id:id(502),folder_id:RCV}];
  const batches=[{batch:'b1',rows:[{document_id:id(500),from:RCV,to:BMO},{document_id:id(501),from:RCV,to:BMO}]}];
  const auto=autoMovedIds(batches,it);
  assert.deepEqual([...auto].sort(),[id(500),id(501)]);
  const units=receiveUnits(ds,it,RCV);
  // 무게를 낮추지 않으면 잘못 옮긴 자료(본부 운영위)가 제안을 끌고 갈 수 있지만, 낮추면 사람이 나눠 둔 대표자 폴더로.
  assert.equal(ruleReasons(units,{docs:ds,items:it,folders,receiveId:RCV,auto}).get(id(502))?.folder,AMR);
  // 사람이 하나를 다른 곳으로 옮기면 그 자료는 더 이상 '손대지 않은 자료'가 아니다.
  assert.deepEqual([...autoMovedIds(batches,it.map(x=>x.document_id===id(500)?{...x,folder_id:AMR}:x))],[id(501)]);
  assert.deepEqual([...autoMovedIds(null,it)],[]);
});

test('계산은 낱말 목록 없이 제목·폴더 이름만으로(다른 사용자 폴더 구조에도 같은 방식)',()=>{
  const fs=[{id:'f1',name:'Clients',parent_id:null},{id:'f2',name:'Acme',parent_id:'f1'},{id:'f3',name:'Globex',parent_id:'f1'}];
  const ex=[{key:'a',title:'Acme invoice March',folder:'f2'},{key:'b',title:'Acme contract renewal',folder:'f2'},{key:'c',title:'Globex invoice April',folder:'f3'},{key:'d',title:'Globex kickoff notes',folder:'f3'}];
  const m=learnModel(ex,fs);
  assert.equal(nearestFolder(m,{title:'Acme invoice May 2026'}).folder,'f2');
  assert.equal(nearestFolder(m,{title:'Globex invoice draft'}).folder,'f3');
  assert.equal(nearestFolder(m,{title:'invoice'}).state,'pick');
  assert.equal(nearestFolder(m,{title:'holiday photos'}).state,'none');
});
