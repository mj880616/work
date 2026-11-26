import test from 'node:test';
import assert from 'node:assert/strict';
import {ruleReasons,noBasis,aiFailWhy,aiShouldStop,WHY_NO_BASIS,WHY_AI_NONE,receiveUnits,ruleSuggestions,startRows,aiBatches,mergeAi,settleRows,renameGroup,placeGroup,usedGroups,applyPlan,sortSummary,doneText,SORT_AI_BATCH,genericImage,textIdsFor,textsFrom,textReasons,imageHome,imageFallback,WHY_IMAGES,WHY_IMAGES_AI,IMAGE_FOLDER_NAME} from '../app/library-sort-model.mjs';

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

test('AI 묶음은 10개씩(S68-16: 40개 한 묶음이면 답이 올 때까지 모든 줄이 기다림)',()=>{
  assert.equal(SORT_AI_BATCH,10);
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
  assert.equal(sortSummary([{to:{folder:'a'}},{to:{group:'n1'}},{to:null},{wait:true}]),'4개 중 1개는 있는 폴더, 1개는 새 폴더를 제안해요 · 그대로 둬요 1개 · 나머지 1개는 AI가 보고 있어요. 체크한 것만 옮겨요.');
  assert.equal(doneText(16,1),'16개를 폴더로 옮겼어요 · 새 폴더 1개 ·');
});

// ---- S68-16: 폴더로 나누기 제안이 맞는 폴더를 못 찾던 까닭 재현(지어낸 폴더·자료, 사용자 11/22 캡처의 제목 모양만 따름) ----
const S68=n=>`d6800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const RECV68=S68(1);
const F68=[{id:RECV68,name:'받는 폴더',parent_id:null},{id:S68(2),name:'노사정',parent_id:null},{id:S68(3),name:'교섭',parent_id:null},{id:S68(4),name:'대의원대회',parent_id:null},{id:S68(5),name:'취재요청·보도',parent_id:null},{id:S68(6),name:'투쟁명령',parent_id:null},{id:S68(7),name:'철도',parent_id:null}];
const TITLES=[
  ['투쟁명령 4호','f.png','image/png',S68(6)],
  ['[취재요청]철도지하철3개노조 안전운행투쟁 기자회견','a.hwp','',S68(5)],
  ['20261113 철도공사 제8차노사정','b.pdf','',S68(2)],
  ['20261113 테크 제8차노사정','c.pdf','',S68(2)],
  ['20261113 유통물류 제8차노사정','c2.pdf','',S68(2)],
  ['20261113 관광네트웍스 제8차노사정','c3.pdf','',S68(2)],
  ['20261113 제8차 철도자회 통합 노사정협의체 회의','d.hwp','',S68(2)],
  ['취재요청GTX A운영지부 결의대회 취재요청 수정','e.hwp','',S68(5)],
  ['2026년11월11일7차임시대의원대회자료집','g.pdf','',S68(4)],
  ['261027_요구안_국가철도공단 교섭 의제','h.hwp','',S68(3)],
];
const PASTED=['붙여넣은 그림 11-13 03:38','붙여넣은 그림 11-13 03:38 (2)','붙여넣은 그림 11-13 03:39 (2)'];
const D68=[...TITLES.map(([title,file_name,mime_type],i)=>({id:S68(100+i),title,file_name,mime_type,category:null,project_id:null})),...PASTED.map((title,i)=>({id:S68(200+i),title,file_name:'paste.png',mime_type:'image/png',category:null,project_id:null}))];
const I68=D68.map(d=>({document_id:d.id,folder_id:RECV68}));

test('S68-16 원인: 지금까지의 첫 낱말 규칙은 폴더 이름을 보지 않아, 폴더에 같은 첫 낱말 자료가 없으면 0개',()=>{
  // 옛 규칙과 같은 비교(첫 낱말이 똑같은 자료가 든 폴더만)를 그대로 흉내: 폴더가 비어 있으면 아무것도 못 찾는다.
  const old=(t)=>String(t||'').replace(/\.[a-z0-9]{2,5}$/i,'').split(/[\s_\-·.,()[\]{}<>「」『』"'~]+/).map(w=>w.toLowerCase()).find(w=>w.length>=2&&!/^\d+$/.test(w));
  assert.deepEqual(TITLES.map(([t])=>old(t)),['투쟁명령','취재요청','철도공사','테크','유통물류','관광네트웍스','제8차','취재요청gtx','2026년11월11일7차임시대의원대회자료집','요구안']);
  // 같은 노사정 자료인데 첫 낱말이 회사 이름이라 서로 다르고, '제8차'·'취재요청gtx'·날짜가 붙은 통째 낱말은 어떤 폴더 이름과도 같지 않다.
});

test('S68-16 개선 ①: 제목 정리 + 폴더 이름 포함 찾기로 10개 모두 맞는 폴더(같은 길이면 따로 쓴 낱말이 이김)',()=>{
  const units=receiveUnits(D68,I68,RECV68);
  const got=ruleReasons(units,{docs:D68,items:I68,folders:F68,receiveId:RECV68});
  for(const [t,,,want] of TITLES){const d=D68.find(x=>x.title===t);assert.equal(got.get(d.id)?.folder,want,t)}
  assert.match(got.get(S68(102)).why,/폴더 이름 '노사정'/);
  // '국가철도공단'(낱말 안 '철도')보다 따로 쓴 '교섭'이 이긴다.
  assert.equal(got.get(S68(109)).folder,S68(3));
  // 붙여넣은 그림은 이름에 주제가 없어 규칙도 못 고른다.
  for(let i=0;i<3;i++)assert.equal(got.has(S68(200+i)),false);
});

test('S68-16 개선 ②: 근거 없는 그림은 AI에 보내지 않고 처음부터 그대로 둬요(근거 없음)',()=>{
  const units=receiveUnits(D68,I68,RECV68);
  // 폴더 이름이 하나도 맞지 않는 작업공간(규칙 0개)이라도 AI에는 근거 있는 자료만.
  const plain=[{id:RECV68,name:'받는 폴더',parent_id:null},{id:S68(9),name:'가나다',parent_id:null}];
  const rows=startRows(units,ruleReasons(units,{docs:D68,items:I68,folders:plain,receiveId:RECV68}));
  const nb=rows.filter(r=>r.nb);
  assert.deepEqual(nb.map(r=>r.title),PASTED);
  assert.ok(nb.every(r=>!r.wait&&!r.checked&&r.to===null&&r.why===WHY_NO_BASIS));
  // '투쟁명령 4호'는 그림이어도 이름에 주제가 있어 AI에 보낸다.
  assert.equal(noBasis(units.find(u=>u.title==='투쟁명령 4호')),false);
  assert.equal(noBasis({title:'IMG_20261113_0338',doc:{file_name:'IMG_20261113_0338.jpg'}}),true);
  assert.equal(noBasis({title:'스크린샷 2026-11-13 오후',doc:{file_name:'a.png'}}),false,'오후 같은 낱말이 남으면 근거 있음으로 본다(보수적으로 AI에 맡김)');
  assert.equal(noBasis({title:'붙여넣은 메모',doc:{file_name:'a.hwp'}}),false,'그림이 아니면 본문이 있을 수 있어 AI에 보냄');
  assert.equal(noBasis({title:'사진',photoset:true,doc:{}}),true);
  const batches=aiBatches(rows);
  assert.deepEqual(batches.map(b=>b.length),[10]);
  assert.equal(batches.flat().some(id=>id.startsWith('d6800000-0000-4000-8000-0000000002')),false);
  assert.match(sortSummary(rows,{done:0,total:10}),/나머지 10개는 AI가 보고 있어요\(0\/10\)/);
  assert.match(sortSummary(rows,{done:0,total:10}),/그대로 둬요 3개/);
});

test('S68-16 개선 ③: 묶음이 실패·건너뜀이면 그 묶음 줄만 바로 그대로 둬요(까닭 한 줄), 한도면 남은 묶음도',()=>{
  const rows=Array.from({length:25},(_,i)=>({key:'k'+i,ids:[S68(500+i)],title:'t',checked:false,to:null,why:'',wait:true}));
  const b=aiBatches(rows);assert.deepEqual(b.map(x=>x.length),[10,10,5]);
  let r=settleRows(rows,aiFailWhy('ai_timeout'),b[0]);
  assert.equal(r.filter(x=>x.wait).length,15);
  assert.ok(r.slice(0,10).every(x=>!x.wait&&x.to===null&&x.why==='AI 답이 늦어 건너뛰었어요 — 직접 선택'));
  assert.equal(aiShouldStop('ai_timeout',1),false,'늦음 한 번은 다음 묶음 계속');
  assert.equal(aiShouldStop('ai_busy',2),true,'두 번 잇달아 실패면 멈춤');
  assert.equal(aiShouldStop('daily_limit',1),true);
  r=settleRows(r,aiFailWhy('daily_limit'),[...b[1],...b[2]]);
  assert.equal(r.some(x=>x.wait),false,'⋯로 남는 줄 없음');
  assert.equal(r[20].why,'AI 사용 한도 — 직접 선택');
  assert.equal(aiFailWhy('skipped:no_folders'),'옮길 폴더가 없어요');
  assert.equal(WHY_AI_NONE,'AI도 맞는 폴더를 찾지 못했어요');
  // 까닭 없이 부르면 옛 모양 그대로(전부 넘김, why 그대로).
  assert.deepEqual(settleRows([{wait:true,ids:['a'],why:'x',to:null,checked:false}]),[{wait:false,ids:['a'],why:'x',to:null,checked:false}]);
});

// ---- S68-18(사용자 11/22 15:32): 그림은 그림 속 글자로 폴더를 찾고, 그래도 모르면 그림만 모으는 폴더를 제안 ----
test('S68-18 ①: 기본 이름 그림이라도 그림 글자(Drive OCR)가 있으면 근거 있음 — 글자 앞부분으로 규칙이 폴더를 찾는다',()=>{
  const units=receiveUnits(D68,I68,RECV68),pasted=units.filter(u=>PASTED.includes(u.title));
  assert.deepEqual(textIdsFor(units),pasted.map(u=>u.key),'그림 글자가 필요한 것은 기본 이름 그림뿐');
  const rows=[
    {id:S68(200),extracted_text:'투쟁명령 제5호\n전 조합원은 …',extraction_status:'ready',file_name:'paste.png'},
    {id:S68(201),extracted_text:'  ',extraction_status:'ready',file_name:'paste.png'},
    {id:S68(202),extracted_text:null,extraction_status:null,file_name:'paste.png'},
  ];
  const {texts,aiIds,read}=textsFrom(units,rows);
  assert.deepEqual([...texts.keys()],[S68(200)]);
  assert.equal(aiIds.get(S68(200)),S68(200));
  assert.deepEqual(read,[S68(202)],'아직 안 읽은 PNG만 글자 읽기를 맡긴다(빈 글자로 읽힌 것은 다시 읽지 않음)');
  assert.equal(noBasis(pasted[0],texts.get(S68(200))),false);
  assert.equal(noBasis(pasted[1],texts.get(S68(201))),true);
  const by=textReasons(units,texts,{docs:D68,items:I68,folders:F68,receiveId:RECV68});
  assert.deepEqual([...by.keys()],[S68(200)]);
  assert.equal(by.get(S68(200)).folder,S68(6));
  assert.match(by.get(S68(200)).why,/^그림 글자: 제목에 폴더 이름 '투쟁명령' 포함/);
  // 규칙이 못 찾아도 글자가 있으면 AI에 보낸다(서버 library_sort가 그 글자 앞부분을 재료로 씀).
  const plain=[{id:RECV68,name:'받는 폴더',parent_id:null},{id:S68(9),name:'가나다',parent_id:null}];
  const r2=startRows(pasted,new Map(),{texts,aiIds});
  assert.deepEqual(r2.map(r=>[r.wait,!!r.nb]),[[true,false],[false,true],[false,true]]);
  assert.deepEqual(aiBatches(r2),[[S68(200)]]);
  assert.equal(textReasons(pasted,texts,{docs:D68,items:I68,folders:plain,receiveId:RECV68}).size,0);
});

test('S68-18 ①: 사진 묶음은 글자가 든 사진을 AI에 보낸다(답도 그 사진 id로 합친다)',()=>{
  const set={key:'photoset:m',ids:[S68(300),S68(301)],title:'사진',photoset:true,doc:{}};
  const {texts,aiIds}=textsFrom([set],[{id:S68(300),extraction_status:'error'},{id:S68(301),extraction_status:'ready',extracted_text:'가상 집회 현수막'}]);
  const rows=startRows([set],new Map(),{texts,aiIds});
  assert.equal(rows[0].wait,true);
  assert.deepEqual(aiBatches(rows),[[S68(301)]]);
  const fid=S68(9),{rows:m}=mergeAi(rows,[],{items:[{id:S68(301),folder_id:fid,new:null,why:'집회'}]},{folders:[{id:fid,name:'집회',parent_id:null}],receiveId:RECV68});
  assert.deepEqual(m[0].to,{folder:fid});
  assert.equal(settleRows(rows,'x',[S68(301)])[0].wait,false);
});

test('S68-18 ③: 근거가 없으면 그림 모음 폴더 — 이름에 그림·사진이 든 기존 폴더 우선, 다음은 그림이 대부분인 폴더, 없으면 새 폴더 그림 모음(맨 위)',()=>{
  const img=(n,f)=>({id:S68(400+n),title:'p'+n,file_name:'p.png',mime_type:'image/png',f});
  const pdf=(n,f)=>({id:S68(500+n),title:'d'+n,file_name:'d.pdf',f});
  const fs=[{id:RECV68,name:'받는 폴더',parent_id:null},{id:S68(10),name:'교섭',parent_id:null},{id:S68(11),name:'현장',parent_id:null},{id:S68(12),name:'행사 사진',parent_id:null},{id:S68(13),name:'스크린샷',parent_id:null},{id:S68(14),name:'회의 녹음',parent_id:null}];
  const ds=[img(1,S68(11)),img(2,S68(11)),img(3,S68(11)),pdf(1,S68(10)),img(4,S68(13)),img(5,S68(13)),img(6,S68(12))];
  const its=ds.map(d=>({document_id:d.id,folder_id:d.f}));
  assert.equal(imageHome({docs:ds,items:its,folders:fs,receiveId:RECV68}),S68(13),'이름이 맞는 폴더 중 그림이 더 많이 든 것');
  const noNamed=fs.filter(f=>![S68(12),S68(13)].includes(f.id));
  assert.equal(imageHome({docs:ds,items:its,folders:noNamed,receiveId:RECV68}),S68(11),'그림이 3개 이상이고 대부분인 폴더');
  assert.equal(imageHome({docs:ds,items:its,folders:[...noNamed,{id:S68(15),name:'그림 모음',parent_id:RECV68}].filter(f=>f.id!==S68(11)),receiveId:RECV68}),S68(15),'받는 폴더 안 하위 폴더도 놓을 수 있다');
  assert.equal(imageHome({docs:ds,items:its,folders:[fs[0],fs[1]],receiveId:RECV68}),null);
  assert.equal(imageHome({docs:[],items:[],folders:[fs[0],{id:S68(16),name:'사진',parent_id:null}],receiveId:RECV68}),S68(16),'빈 사진 폴더도 이름으로');
  assert.equal(imageHome({docs:[],items:[],folders:[{id:RECV68,name:'사진 받는 곳',parent_id:null}],receiveId:RECV68}),null,'받는 폴더 자신은 빼고');

  const units=receiveUnits(D68,I68,RECV68).filter(u=>PASTED.includes(u.title));
  const rows=startRows(units,new Map());
  // 기존 폴더가 있으면 그 폴더(체크 꺼짐, 까닭 한 줄). '근거 없음 — 직접 선택'은 이 줄로 바뀐다.
  let out=imageFallback(rows,[],S68(13),{only:r=>r.nb});
  assert.ok(out.rows.every(r=>r.to?.folder===S68(13)&&!r.checked&&r.why===WHY_IMAGES&&r.from==='image'));
  assert.deepEqual(out.groups,[]);
  // 없으면 새 폴더 '그림 모음' 하나(맨 위)로 모두 묶는다. 체크를 켜야 만든다.
  out=imageFallback(rows,[{gid:'n1',name:'산별전환',parent:null}],null,{only:r=>r.nb});
  assert.deepEqual(out.groups.map(g=>[g.name,g.parent]),[['산별전환',null],[IMAGE_FOLDER_NAME,null]]);
  assert.equal(new Set(out.rows.map(r=>r.to.group)).size,1);
  assert.deepEqual(usedGroups(out.rows,out.groups),[]);
  const on=out.rows.map(r=>({...r,checked:true}));
  assert.deepEqual(applyPlan(on,out.groups).create.map(g=>g.name),[IMAGE_FOLDER_NAME]);
  assert.match(sortSummary(out.rows),/^3개 중 3개는 새 폴더를 제안해요\./);
  // 맨 위에 같은 이름 폴더가 이미 있으면 그 폴더로(겹치는 폴더 만들지 않음). AI가 같은 이름·자리를 제안해 둔 묶음은 함께 쓴다.
  assert.deepEqual(imageFallback(rows,[],null,{folders:[{id:S68(17),name:'그림 모음',parent_id:null}]}).rows[0].to,{folder:S68(17)});
  const withAi=imageFallback(rows,[{gid:'n1',name:'그림 모음',parent:null}],null);
  assert.deepEqual(withAi.groups.map(g=>g.gid),['n1']);
  assert.ok(withAi.rows.every(r=>r.to.group==='n1'));
  // 그림이 아닌 줄·이미 곳이 정해진 줄·기다리는 줄은 건드리지 않는다.
  const mixed=[{...rows[0],image:false},{...rows[1],to:{folder:S68(10)},why:'x'},{...rows[2],wait:true}];
  assert.deepEqual(imageFallback(mixed,[],S68(13)).rows,mixed);
  // AI도 못 고른 그림(이름 있는 그림 포함)에도 같은 제안, 까닭만 다르다.
  const named=startRows(receiveUnits(D68,I68,RECV68).filter(u=>u.title==='투쟁명령 4호'),new Map());
  const settled=settleRows(named,WHY_AI_NONE);
  const fb=imageFallback(settled,[],S68(13),{only:r=>r.why===WHY_AI_NONE,why:WHY_IMAGES_AI});
  assert.equal(fb.rows[0].why,WHY_IMAGES_AI);
  assert.deepEqual(fb.rows[0].to,{folder:S68(13)});
});

test('S68-18: 그림 글자 판정 경계 — 그림 아님·기본 이름 아님은 글자 확인 대상이 아니다',()=>{
  assert.equal(genericImage({title:'붙여넣은 메모',doc:{file_name:'a.hwp'}}),false);
  assert.equal(genericImage({title:'투쟁명령 4호',doc:{file_name:'a.png'}}),false);
  assert.equal(genericImage({title:'IMG_1234',doc:{file_name:'IMG_1234.heic'}}),true);
  // HEIC는 서버가 글자를 읽지 않으므로 읽기를 맡기지 않는다.
  assert.deepEqual(textsFrom([{key:'k',ids:['k'],title:'IMG_1234',doc:{file_name:'IMG_1234.heic'}}],[{id:'k',extraction_status:null,file_name:'IMG_1234.heic'}]).read,[]);
  assert.equal(noBasis({title:'사진',photoset:true,doc:{}},'12'),true,'숫자 두 자만 있으면 글자 근거로 보지 않음');
  assert.equal(noBasis({title:'사진',photoset:true,doc:{}},'회의'),false);
});
