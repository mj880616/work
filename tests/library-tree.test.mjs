// LIB-토글트리 ②: app/library-tree.js(자료실 트리 만들기·그리기, 순수 함수). 화면·네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import('../app/library-tree.js');

const sortKey=d=>String(d.document_date||d.created_at||'').slice(0,10);
const kindOf=d=>/\.pdf$/i.test(d.file_name||'')?'PDF':/\.hwpx?$/i.test(d.file_name||'')?'HWP':'파일';
const monthLabel=k=>{const x=/^(\d{4})-(\d{2})/.exec(k);return x?`${x[1]}년 ${Number(x[2])}월`:'날짜 없음'};
const categoryOf=c=>c||'기타';
const P=(id,name,parent_id=null,sort_order=0,metadata={})=>({id,name,parent_id,sort_order,metadata});
const tree=[{project:P('a','A'),depth:0},{project:P('a1','A1','a'),depth:1},{project:P('a11','A11','a1'),depth:2},{project:P('a2','A2','a'),depth:1},{project:P('b','B'),depth:0}];
const doc=(id,project_id,extra={})=>({id,project_id,title:id,file_name:id+'.pdf',created_at:'2026-10-01T00:00:00Z',...extra});
const base=extra=>({groupBy:'project',tree,kindOf,sortKey,monthLabel,categoryOf,projectName:id=>'['+id+']',...extra});
const shape=list=>list.map(n=>[n.key,n.count,n.files.map(d=>d.id),shape(n.children)]);

test('프로젝트 묶기: 3단 프로젝트, 빈 하위 숨김, 1단·프로젝트 없음은 늘 보임, 확인 불가 연결은 활성 뒤',()=>{
  const docs=[doc('d1','a'),doc('d2','a11'),doc('d3',null),doc('d4','gone')];
  const out=m.buildTree(base({docs}));
  assert.deepEqual(out.map(n=>n.key),['p:a','p:b','p:gone','p:none']);
  assert.deepEqual(shape(out)[0],['p:a',2,['d1'],[['p:a1',1,[],[['p:a11',1,['d2'],[]]]]]]);
  assert.equal(out[1].count,0);assert.equal(out[2].label,'[gone]');assert.equal(out[3].label,'프로젝트 없음');
});

test('폴더: 같은 프로젝트 틀 안 3단 폴더, 하위 프로젝트 다음·파일 앞, 빈 폴더 보임, 어긋난 연결은 프로젝트 바로 아래',()=>{
  const folders=[{id:'f1',project_id:'a',parent_id:null,name:'F1',sort_order:2048},{id:'f0',project_id:'a',parent_id:null,name:'F0',sort_order:1024},{id:'f11',project_id:'a',parent_id:'f1',name:'F11',sort_order:0},{id:'fn',project_id:null,parent_id:null,name:'없음 폴더',sort_order:0}];
  const docs=[doc('d1','a'),doc('d2','a'),doc('d3','b'),doc('d4',null)];
  const items=[{document_id:'d1',folder_id:'f11'},{document_id:'d3',folder_id:'f1'},{document_id:'d4',folder_id:'fn'}];
  const out=m.buildTree(base({docs,folders,items}));
  const a=out[0];
  // 빈 하위 프로젝트(a1·a2)는 숨고, 폴더는 sort_order 순.
  assert.deepEqual(a.children.map(n=>n.key),['f:f0','f:f1']);
  assert.deepEqual(a.files.map(d=>d.id),['d2']);
  assert.equal(a.children[1].children[0].files[0].id,'d1');
  assert.equal(a.count,2);assert.equal(a.children[0].count,0);
  assert.deepEqual(out.find(n=>n.key==='p:b').files.map(d=>d.id),['d3']);
  const none=out.at(-1);assert.equal(none.children[0].key,'f:fn');assert.equal(none.children[0].files[0].id,'d4');
});

test('폴더가 순환으로 들어와도 한 번만 그린다',()=>{
  const folders=[{id:'x',project_id:'b',parent_id:'y',name:'X'},{id:'y',project_id:'b',parent_id:'x',name:'Y'}];
  const out=m.buildTree(base({docs:[],folders}));const keys=m.keys(out);
  assert.equal(keys.filter(k=>k==='f:x').length,1);assert.equal(keys.filter(k=>k==='f:y').length,1);
});

test('거르는 중: 맞는 자료가 없는 토글·폴더를 숨기고, 맞는 토글만 펼칠 목록',()=>{
  const folders=[{id:'f',project_id:'a',name:'F'}];
  const out=m.buildTree(base({docs:[doc('d2','a11')],folders,filtering:true}));
  assert.deepEqual(shape(out),[['p:a',1,[],[['p:a1',1,[],[['p:a11',1,['d2'],[]]]]]]]);
  assert.deepEqual([...m.matchedKeys(out)],['p:a','p:a1','p:a11']);
  assert.deepEqual(m.pathTo(out,'d2'),['p:a','p:a1','p:a11']);
});

test('담당조직·종류·월별 묶기는 파일만, 빈 묶음 숨김, 순서',()=>{
  const docs=[doc('d1',null,{organization_id:'o2',category:'교섭',document_date:'2026-09-03'}),doc('d2',null,{organization_id:null,category:'',created_at:'2026-10-02T00:00:00Z'}),doc('d3',null,{organization_id:'o1',category:'교섭',document_date:null,created_at:''})];
  const org=m.buildTree(base({groupBy:'organization',docs,organizations:[{id:'o1',name:'가'},{id:'o2',name:'나'},{id:'o3',name:'다'}]}));
  assert.deepEqual(org.map(n=>[n.label,n.files.map(d=>d.id)]),[['가',['d3']],['나',['d1']],['조직 없음',['d2']]]);
  const cat=m.buildTree(base({groupBy:'category',docs,categories:['교섭','투쟁','기타']}));
  assert.deepEqual(cat.map(n=>[n.label,n.count]),[['교섭',2],['기타',1]]);
  const month=m.buildTree(base({groupBy:'month',docs}));
  assert.deepEqual(month.map(n=>n.label),['2026년 10월','2026년 9월','날짜 없음']);
  assert.ok(org.every(n=>n.children.length===0));
});

test('파일은 날짜 최신순, 종류 점은 정해진 순서로 최대 5개',()=>{
  const docs=[doc('old','a',{document_date:'2026-01-01'}),doc('new','a',{document_date:'2026-05-01',file_name:'x.hwp'}),doc('mid','a',{document_date:null,created_at:'2026-03-01T00:00:00Z',file_name:'y.zip'})];
  const out=m.buildTree(base({docs}));
  assert.deepEqual(out[0].files.map(d=>d.id),['new','mid','old']);
  assert.deepEqual(out[0].kinds,['HWP','PDF','파일']);
});

test('그리기: details/summary, 펼침, 20개 넘으면 N건 더, 이름은 이스케이프',()=>{
  const docs=Array.from({length:23},(_,i)=>doc('d'+i,'b'));
  const out=m.buildTree(base({docs,tree:[{project:P('b','<B>'),depth:0}]}));
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const opts={isOpen:k=>k==='p:b',showAll:()=>false,fileHtml:d=>`<article data-id="${d.id}"></article>`,esc,kindKey:k=>k.toLowerCase()};
  const html=m.treeHtml(out,opts);
  assert.match(html,/<details class="lu-node" data-lu-node="p:b"[^>]* open>/);
  assert.match(html,/&lt;B&gt;/);
  assert.equal((html.match(/<article/g)||[]).length,20);
  assert.match(html,/data-lu-more="p:b">3건 더</);
  const all=m.treeHtml(out,{...opts,showAll:()=>true});
  assert.equal((all.match(/<article/g)||[]).length,23);assert.doesNotMatch(all,/건 더/);
});

test('폴더 편집 규칙: 깊이·옮길 곳(자기 아래·100단 초과·다른 틀 제외)·위로/아래로·이름·오류 문구',()=>{
  const F=[{id:'a',project_id:'p',parent_id:null,sort_order:1024},{id:'b',project_id:'p',parent_id:'a',sort_order:0},{id:'c',project_id:'p',parent_id:'b',sort_order:0},{id:'d',project_id:'p',parent_id:null,sort_order:2048},{id:'e',project_id:null,parent_id:null,sort_order:0}];
  assert.equal(m.folderDepth(F,'c'),3);assert.equal(m.folderHeight(F,'a'),3);
  assert.equal(m.canAddChild(F,'c'),true,'LIB-폴더100단: 3단 아래도 만든다');assert.equal(m.canAddChild(F,'b'),true);assert.equal(m.canAddChild(F,null),true);
  assert.deepEqual(m.folderMoveTargets(F,'b'),[null,'d']);
  assert.deepEqual(m.folderMoveTargets(F,'a'),['d'],'3단 묶음도 다른 폴더 안으로(합쳐 4단)');
  assert.deepEqual(m.folderMoveTargets(F,'d'),['a','b','c']);
  assert.deepEqual(m.folderReorderPlan(F,'d','up'),[{id:'d',sort_order:1024},{id:'a',sort_order:2048}]);
  assert.deepEqual(m.folderReorderPlan(F,'a','up'),[]);
  const same=[{id:'x',project_id:null,parent_id:null,sort_order:0,created_at:'1'},{id:'y',project_id:null,parent_id:null,sort_order:0,created_at:'2'}];
  assert.deepEqual(m.folderReorderPlan(same,'y','up'),[{id:'y',sort_order:1024},{id:'x',sort_order:2048}]);
  assert.equal(m.nextSortOrder([]),1024);assert.equal(m.nextSortOrder([{sort_order:2048}]),3072);
  // 휴지통으로 가는 묶음: 아래 폴더 전부와 그 안 자료를 센다(a > b > c).
  assert.deepEqual(m.folderTrashCounts(F,[{document_id:'1',folder_id:'a'},{document_id:'2',folder_id:'c'},{document_id:'3',folder_id:'d'}],'a'),{folders:2,files:2});
  assert.deepEqual(m.folderTrashCounts(F,[],'d'),{folders:0,files:0});
  // 휴지통 폴더에 든 자료는 자료실 목록에서만 숨긴다: 연결된 폴더가 보이는 목록에 없을 때. 목록을 못 읽었으면 숨기지 않는다.
  const shown=F.filter(f=>f.id!=='a'&&f.id!=='b'&&f.id!=='c'),links=[{document_id:'1',folder_id:'a'},{document_id:'2',folder_id:'c'},{document_id:'3',folder_id:'d'},{document_id:'4',folder_id:null}];
  assert.deepEqual([...m.documentsInTrashedFolders(shown,links)].sort(),['1','2']);
  assert.deepEqual([...m.documentsInTrashedFolders(F,links)],[]);
  assert.deepEqual([...m.documentsInTrashedFolders([],links,false)],[]);
  assert.equal(m.cleanFolderName('  가 \n'),'가');assert.equal(m.cleanFolderName('   '),null);assert.equal(m.cleanFolderName('가'.repeat(41)),null);
  assert.equal(m.folderErrorText({message:'LIB_FOLDER_CYCLE: x'}),'폴더를 자기 안으로 옮길 수 없어요.');
  assert.equal(m.folderErrorText({message:'LIB_FOLDER_DEPTH: x'}),'폴더는 100단까지만 만들 수 있어요.');
  // DB 적용 전 서버가 3단으로 거절하면 그 숫자 그대로 알린다.
  assert.equal(m.folderErrorText({message:'LIB_FOLDER_DEPTH: folders are limited to 3 levels'}),'폴더는 3단까지만 만들 수 있어요.');
});

// LIB-그림형식: 그림(JPG·JPEG·PNG·GIF·WEBP·HEIC·BMP, image/*)도 한 종류. 접힌 줄 색 점 순서는 PPT 다음, 파일 앞.
test('파일 형식: 확장자를 먼저, 없으면 mime. 그림은 확장자 일곱 가지와 image/*',()=>{
  for(const name of ['a.jpg','a.JPEG','a.png','a.gif','a.webp','a.heic','a.bmp'])assert.equal(m.fileKindOf(name,null),'그림',name);
  assert.equal(m.fileKindOf('사진','image/jpeg'),'그림');
  assert.equal(m.fileKindOf('a.hwpx',''),'HWP');assert.equal(m.fileKindOf('a.docx',''),'DOC');
  assert.equal(m.fileKindOf('집계','application/vnd.google-apps.spreadsheet'),'XLS');
  assert.equal(m.fileKindOf('a.zip','application/zip'),'파일');assert.equal(m.fileKindOf('noext',''),'파일');
  // 확장자가 알려진 문서면 mime이 image여도 문서가 먼저.
  assert.equal(m.fileKindOf('a.pdf','image/png'),'PDF');
  assert.deepEqual([...m.KIND_ORDER],['HWP','PDF','XLS','DOC','PPT','그림','파일']);
});

test('접힌 줄 색 점: 그림이 든 토글은 그림 점이 PPT 뒤에 나온다',()=>{
  const k=d=>m.fileKindOf(d.file_name,d.mime_type);
  const out=m.buildTree(base({docs:[doc('x1','b',{file_name:'x1.png'}),doc('x2','b',{file_name:'x2.hwp'}),doc('x3','b',{file_name:'x3.zip'})],kindOf:k}));
  assert.deepEqual(out.find(n=>n.key==='p:b').kinds,['HWP','그림','파일']);
});

// LIB-종류표잘림: treeHtml이 파일 줄을 그릴 때 그 줄이 든 토글(node)도 넘긴다(종류로 묶은 토글에서 같은 종류 표를 빼는 데 쓴다).
test('treeHtml: fileHtml에 파일과 그 파일이 든 토글을 넘긴다',()=>{
  const out=m.buildTree(base({groupBy:'category',docs:[doc('c1',null,{category:'교섭'}),doc('c2',null,{category:'기타'})]}));
  const seen=[];
  m.treeHtml(out,{isOpen:()=>true,showAll:()=>true,esc:s=>String(s),kindKey:k=>k,fileHtml:(d,n)=>{seen.push([d.id,n.category]);return ''}});
  assert.deepEqual(seen.sort(),[['c1','교섭'],['c2','기타']]);
});

// LIB-폴더탐색기(설계 12절): 폴더 묶기는 프로젝트 틀을 보지 않고 parent_id만 따라 한 나무로 그린다. 맨 위 '폴더 밖'.
test('폴더 묶기: 맨 위 폴더 밖, 프로젝트가 달라도 parent_id를 따라 한 나무, 연결은 틀과 무관, 빈 폴더 보임',()=>{
  assert.deepEqual([...m.GROUP_BY],['project','organization','category','month','folder']);assert.equal(m.GROUP_LABELS.folder,'폴더');
  const folders=[{id:'f2',project_id:'b',parent_id:'f1',name:'F2',sort_order:0},{id:'f1',project_id:'a',parent_id:null,name:'F1',sort_order:1024},{id:'f0',project_id:null,parent_id:null,name:'F0',sort_order:0},{id:'orphan',project_id:'a',parent_id:'gone',name:'고아',sort_order:5}];
  const docs=[doc('d1','a'),doc('d2','b'),doc('d3',null),doc('d4','a')];
  const items=[{document_id:'d1',folder_id:'f2'},{document_id:'d3',folder_id:'f1'},{document_id:'d4',folder_id:'missing'}];
  const out=m.buildTree({...base({docs,folders,items}),groupBy:'folder'});
  assert.deepEqual(out.map(n=>n.key),['x:out','f:f0','f:orphan','f:f1']);
  assert.equal(out[0].label,'폴더 밖');assert.deepEqual(out[0].files.map(d=>d.id).sort(),['d2','d4']);
  assert.deepEqual(shape(out.slice(3,4)),[['f:f1',2,['d3'],[['f:f2',1,['d1'],[]]]]]);
  assert.equal(out[1].count,0,'빈 폴더도 보임');
  assert.equal(out[3].children[0].projectId,'b','폴더의 project_id는 그대로 담기지만 나무 모양은 바꾸지 않는다');
  assert.equal(out[3].depth,0);assert.equal(out[3].children[0].depth,1);
  // 거르는 중이면 맞는 파일이 없는 폴더·'폴더 밖'을 숨긴다.
  const filtered=m.buildTree({...base({docs:[doc('d1','a')],folders,items}),groupBy:'folder',filtering:true});
  assert.deepEqual(shape(filtered),[['f:f1',1,[],[['f:f2',1,['d1'],[]]]]]);
  // 폴더가 하나도 없어도 '폴더 밖'은 남아 첫 폴더를 만들 자리가 된다.
  assert.deepEqual(m.buildTree({...base({docs:[]}),groupBy:'folder'}).map(n=>n.key),['x:out']);
});

test('폴더 보기 편집 규칙(free): 형제·옮길 곳·위로/아래로가 프로젝트 틀을 보지 않는다',()=>{
  const F=[{id:'a',project_id:'p',parent_id:null,sort_order:1024},{id:'b',project_id:null,parent_id:null,sort_order:2048},{id:'c',project_id:'q',parent_id:'a',sort_order:0}];
  assert.deepEqual(m.folderSiblings(F,{projectId:'p',parentId:null}).map(f=>f.id),['a']);
  assert.deepEqual(m.folderSiblings(F,{projectId:'p',parentId:null,free:true}).map(f=>f.id),['a','b']);
  assert.deepEqual(m.folderMoveTargets(F,'b'),[]);
  assert.deepEqual(m.folderMoveTargets(F,'b',true),['a','c']);
  assert.deepEqual(m.folderMoveTargets(F,'c',true),[null,'b']);
  assert.deepEqual(m.folderReorderPlan(F,'b','up'),[]);
  assert.deepEqual(m.folderReorderPlan(F,'b','up',true),[{id:'b',sort_order:1024},{id:'a',sort_order:2048}]);
  assert.match(m.folderErrorText({message:'new row violates row-level security policy for table "app_library_folder_items"'}),/준비 중/);
  assert.match(m.folderErrorText({message:'LIB_FOLDER_SCOPE: x'}),/준비 중/);
});
