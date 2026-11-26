import test from 'node:test';
import assert from 'node:assert/strict';
import {kindWords,tidyKey,tidyUnits,tidyGroups,retargetGroup,tidyPlan,tidyAtText,tidySummary,tidySubject,ruleReasons,receiveUnits} from '../app/library-sort-model.mjs';

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
  // S69-16: 받는 폴더·폴더 밖 자료는 본보기(이미 폴더에 든 자료·폴더 이름)로 먼저 — '교육 명단' 2개는 '교육' 폴더로,
  // '가상 합의서 3쪽'은 임금협약과 그 안 초안이 비슷하게 닮아 '고르기'(기본 그대로).
  assert.deepEqual(groups.map(g=>g.word),['가상 합의서','교육','비슷한 폴더 여럿']);
  const h=groups[0];
  assert.equal(h.total,4);
  assert.deepEqual(h.to,{folder:IM});
  assert.equal(h.stay,2);
  assert.deepEqual(h.rows.map(r=>[r.key,r.checked,r.note]),[[id(101),true,''],[id(105),true,'']]);
  assert.equal(tidyAtText(h.at,f=>f?folders.find(x=>x.id===f).name:'폴더 밖'),'지금: 임금협약 2 · 성명·보도자료 1 · 초안 1');
  const p=groups[2];
  assert.deepEqual([p.mode,p.pick,p.alt,p.rows.map(r=>[r.key,r.checked])],['keep',true,[IM,SUB],[[id(104),false]]]);
  // '가상 합의서 이행 촉구 보도자료'는 보도자료 묶음(1개뿐이라 묶음 아님).
  assert.ok(!groups.some(g=>g.rows.some(r=>r.key===id(106))));
  // 교육 명단: 잡동사니 1 · 폴더 밖 1 — 이름이 닮은 '교육' 폴더로(새 폴더 없음).
  assert.deepEqual([groups[1].to,groups[1].learn,groups[1].rows.map(r=>r.note)],[{folder:EDU},true,['폴더 이름과 닮았어요','폴더 이름과 닮았어요']]);
  assert.deepEqual(newGroups,[]);
  // '교육' 폴더가 없으면 새 폴더 '교육 명단'(맨 위).
  const noEdu=folders.filter(f=>f.id!==EDU),r2=tidyGroups(tidyUnits(docs,items,noEdu),{folders:noEdu,receiveId:RC});
  assert.deepEqual(r2.newGroups,[{gid:r2.newGroups[0].gid,name:'교육 명단',parent:null}]);
  assert.equal(tidySummary(groups),'닮은 폴더가 있는 자료 1묶음 · 흩어진 같은 자료 1묶음 · 선택할 자료 1묶음(5개)을 찾았어요. 묶음마다 선택하세요.');
  assert.equal(tidySummary([]),'흩어지거나 섞인 자료를 찾지 못했어요.');
});

test('섞인 종류·이미 이름이 맞는 폴더는 체크 풀어 둠, 같은 이름 폴더가 있으면 새로 만들지 않음',()=>{
  const fs=[...folders,{id:id(8),name:'명단',parent_id:null}];
  const ds=[doc(1,'가상 합의서'),doc(2,'가상 합의서 2'),doc(3,'가상 합의서 보도자료 합의서'),doc(4,'가상 합의서 사본'),doc(9,'교육 명단'),doc(10,'교육 명단 2차')];
  const fsx=[...fs,{id:id(9),name:'합의서 원본',parent_id:null}];
  const it=[{document_id:id(101),folder_id:IM},{document_id:id(102),folder_id:IM},{document_id:id(103),folder_id:PR},{document_id:id(104),folder_id:id(9)},{document_id:id(109),folder_id:RC}];
  const {groups,newGroups}=tidyGroups(tidyUnits(ds,it,fsx),{folders:fsx,receiveId:RC});
  const h=groups.find(g=>g.word==='가상 합의서');
  assert.deepEqual(h.rows.map(r=>[r.key,r.checked,r.note]),[[id(103),false,"이름에 '보도자료' — 체크 풀어 둠"],[id(104),false,'지금 폴더 이름과 맞아 체크 풀어 둠']]);
  assert.equal(h.mode,'keep');
  // S69-16: '교육 명단'은 '교육'·'명단' 두 폴더 이름이 다 닮아 고르기(옮기지 않음, 새 폴더도 없음).
  const m=groups.find(g=>g.pick);
  assert.deepEqual([m.mode,m.alt],['keep',[EDU,id(8)]]);assert.deepEqual(newGroups,[]);
});

test('옮길 곳 바꾸기·계획: 그대로 묶음은 빼고, 원래 자리별로 나눠 옮김, 새 폴더는 쓰일 때만',()=>{
  const {groups,newGroups}=tidyGroups(tidyUnits(docs,items,folders),{folders,receiveId:RC});
  let [h,m]=groups;
  // 합의서를 '성명·보도자료'로 바꾸면 그 안 1개는 그대로, 임금협약 2개가 줄로.
  const h2=retargetGroup(h,{folder:PR},h.rows);
  assert.deepEqual(h2.rows.map(r=>r.key).sort(),[id(102),id(103),id(105)].sort());
  assert.equal(h2.stay,1);
  // '고르기' 묶음(groups[2])은 기본 그대로라 계획에 들지 않는다.
  const plan=tidyPlan(groups,newGroups);
  assert.equal(plan.count,4);
  assert.deepEqual(plan.create,[]);
  assert.deepEqual(plan.moves.map(x=>[x.from,x.folder||x.group,x.ids.length]),[[PR,IM,1],[SUB,IM,1],[RC,EDU,1],[null,EDU,1]]);
  const keep=tidyPlan([h,{...m,mode:'keep'}],newGroups);
  assert.equal(keep.count,2);assert.deepEqual(keep.create,[]);
  // 고르기 묶음을 [옮기기]로 바꾸면 첫 후보(임금협약)로.
  assert.deepEqual(tidyPlan([{...groups[2],mode:'move',rows:groups[2].rows.map(r=>({...r,checked:true}))}],[]).moves,[{from:RC,folder:IM,ids:[id(104)]}]);
});

// S69-12(사용자 11/24 08:09): '회의자료' 낱말 하나로 묶어 다른 단체 회의 자료까지 '집행위' 폴더로 옮겼다. 이름은 비슷하게 지어낸 것.
const MEET=['43차 본부집행위원회 회의자료','41차 본부집행위원회 회의자료','42차 본부집행위원회 회의자료','44차 본부집행위원회 회의자료',
  '가상협의회 8차대표자및9차집행위원회연석회의자료','가상협의회 6차대표자회의자료','가상협의회 3차집행위원회회의자료',
  '26-41차 가상집행국 회의자료','2026 45차 상집위원회','민간가상노조 2026 3차 정기간담회 회의자료'];
const TEAM=id(20),MEETING=id(21),EXEC=id(22),RCV=id(23),COUNCIL=id(24);
const mfolders=[{id:TEAM,name:'가상팀',parent_id:null},{id:MEETING,name:'회의',parent_id:TEAM},{id:EXEC,name:'집행위',parent_id:MEETING},{id:RCV,name:'잡동사니',parent_id:null}];
const mdocs=MEET.map((t,i)=>doc(300+i,t+'.hwp'));
const mid=i=>id(400+i);

test('임자(단체·회의체): 종류 낱말·회차·숫자를 떼고 제목에서 뽑는다(이름 목록 없음)',()=>{
  assert.deepEqual(MEET.map(tidySubject),['본부집행위원회','본부집행위원회','본부집행위원회','본부집행위원회','가상협의회','가상협의회','가상협의회','가상집행국','상집위원회','민간가상노조']);
  assert.equal(tidySubject('회의자료 가상협의회.hwp'),'가상협의회');
  assert.equal(tidySubject('제8차노사정 회의록'),'노사정');
  assert.equal(tidySubject('회의록'),'');
});

test('흩어진 묶음: 같은 종류여도 단체가 다르면 한 묶음이 아니고, 다른 단체 자료가 든 폴더로 보내지 않는다',()=>{
  // 본부 집행위 자료 3개는 '집행위'에, 1개와 다른 단체 자료는 받는 폴더·폴더 밖에 흩어져 있다.
  const it=[{document_id:mid(0),folder_id:EXEC},{document_id:mid(1),folder_id:EXEC},{document_id:mid(2),folder_id:EXEC},{document_id:mid(3),folder_id:RCV},
    {document_id:mid(4),folder_id:RCV},{document_id:mid(5),folder_id:RCV},{document_id:mid(7),folder_id:RCV},{document_id:mid(9),folder_id:RCV}];
  const ds=mdocs.map((d,i)=>({...d,id:mid(i)}));
  const {groups,newGroups}=tidyGroups(tidyUnits(ds,it,mfolders),{folders:mfolders,receiveId:RCV});
  // S69-16: 받는 폴더의 본부 집행위 자료는 본보기(집행위 안 같은 회의 자료 3개)로 집행위에.
  const exec=groups.find(g=>g.to.folder===EXEC);
  assert.deepEqual([exec.word,exec.learn],['집행위',true]);assert.deepEqual(exec.rows.map(r=>r.key),[mid(3)]);
  assert.match(exec.rows[0].note,/^닮은 자료: .*본부집행위원회 회의자료/);
  const council=groups.find(g=>g.word==='가상협의회 회의자료');
  // 가상협의회 3개(받는 폴더 2 · 폴더 밖 1)는 집행위가 아니라 새 폴더 '가상협의회 회의자료'로.
  assert.deepEqual(council.rows.map(r=>r.key).sort(),[mid(4),mid(5),mid(6)].sort());
  assert.ok(council.to.group);assert.equal(newGroups.find(g=>g.gid===council.to.group).name,'가상협의회 회의자료');
  // 어느 묶음도 다른 단체 자료를 집행위로 보내지 않는다.
  for(const g of groups)if(g.to.folder===EXEC)assert.ok(g.rows.every(r=>tidySubject(r.title)==='본부집행위원회'));
  // 한 개뿐인 단체(가상집행국·민간가상노조)는 묶음이 없다.
  assert.ok(!groups.some(g=>g.rows.some(r=>r.key===mid(7)||r.key===mid(9))));
  // 같은 단체 자료가 모인 폴더가 있으면 그리로.
  const fs2=[...mfolders,{id:COUNCIL,name:'협의회 자료',parent_id:MEETING}];
  const it2=[...it.filter(x=>x.document_id!==mid(4)&&x.document_id!==mid(5)),{document_id:mid(4),folder_id:COUNCIL},{document_id:mid(5),folder_id:COUNCIL}];
  // (S69-16: 그 폴더 자료가 본보기가 되어 '닮은 자료' 묶음으로)
  const g2=tidyGroups(tidyUnits(ds,it2,fs2),{folders:fs2,receiveId:RCV}).groups.find(g=>g.to.folder===COUNCIL);
  assert.deepEqual([g2.learn,g2.rows.map(r=>r.key)],[true,[mid(6)]]);
});

test('섞인 묶음: 이미 한 폴더에 섞여 든 다른 단체 자료를 그 폴더 정돈에서 단체별로 나눠 제자리 후보를 낸다(기본은 그대로)',()=>{
  const ds=mdocs.map((d,i)=>({...d,id:mid(i)}));
  const it=ds.map(d=>({document_id:d.id,folder_id:EXEC}));
  const all=tidyUnits(ds,it,mfolders);
  const {groups,newGroups}=tidyGroups(tidyUnits(ds,it,mfolders,{scopeId:EXEC}),{folders:mfolders,receiveId:RCV,scopeId:EXEC,allUnits:all});
  assert.deepEqual(groups.map(g=>[g.word,g.total,g.mode,!!g.split]),[['가상협의회',3,'keep',true],['가상집행국',1,'keep',true],['민간가상노조',1,'keep',true],['상집위원회',1,'keep',true]]);
  // 본부 집행위 자료는 집행위에 그대로(어느 줄에도 없음).
  assert.ok(groups.every(g=>g.rows.every(r=>tidySubject(r.title)!=='본부집행위원회')));
  // 새 폴더는 집행위 옆(같은 상위 '회의')에 단체 이름으로.
  assert.deepEqual(newGroups.map(g=>[g.name,g.parent]).sort(),[['가상집행국',MEETING],['가상협의회',MEETING],['민간가상노조',MEETING],['상집위원회',MEETING]]);
  assert.equal(tidySummary(groups),'다른 이름이 섞인 자료 4묶음(6개)을 찾았어요. 묶음마다 선택하세요.');
  assert.equal(tidyPlan(groups,newGroups).count,0);
  // 같은 단체 자료가 든 다른 폴더가 있으면 그리로 '옮기기'.
  const fs2=[...mfolders,{id:COUNCIL,name:'가상협의회',parent_id:MEETING}];
  const g2=tidyGroups(tidyUnits(ds,it,fs2,{scopeId:EXEC}),{folders:fs2,receiveId:RCV,scopeId:EXEC,allUnits:tidyUnits(ds,it,fs2)}).groups[0];
  assert.deepEqual([g2.word,g2.mode,g2.to],['가상협의회','move',{folder:COUNCIL}]);
  // 한 단체만 든 폴더는 섞인 묶음이 없다.
  const one=ds.slice(0,4),it1=one.map(d=>({document_id:d.id,folder_id:EXEC}));
  assert.deepEqual(tidyGroups(tidyUnits(one,it1,mfolders,{scopeId:EXEC}),{folders:mfolders,scopeId:EXEC}).groups,[]);
});

test('받는 폴더 나누기: 폴더 이름이 제목에 들었어도 그 폴더 자료와 단체가 다르면 그 폴더로 제안하지 않는다',()=>{
  const ds=mdocs.map((d,i)=>({...d,id:mid(i)}));
  const it=[{document_id:mid(0),folder_id:EXEC},{document_id:mid(1),folder_id:EXEC},{document_id:mid(2),folder_id:EXEC},{document_id:mid(3),folder_id:RCV},{document_id:mid(6),folder_id:RCV}];
  const units=receiveUnits(ds,it,RCV),r=ruleReasons(units,{docs:ds,items:it,folders:mfolders,receiveId:RCV});
  assert.equal(r.get(mid(3))?.folder,EXEC);       // 본부 집행위 자료는 집행위로
  assert.equal(r.get(mid(6))?.folder,undefined);  // '가상협의회 …집행위원회회의자료'는 집행위로 보내지 않음
});
