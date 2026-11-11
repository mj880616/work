// LIB-받는폴더(S59-11): app/library-receive.js(서버 프로필 칸 읽기·쓰기, 보이는 받는 폴더, '폴더 밖' 자료 세기)와
// 나무 모델의 받는 폴더 표시(library-tree.js buildTree rc → treeHtml '받는 폴더'), 공용 폴더 줄의 작은 표시(folder-tree-ui.mjs tag). 화면 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import('../app/library-receive.js');
const tree=await import('../app/library-tree.js');
const {ftFolderRowHtml}=await import('../app/folder-tree-ui.mjs');

const ID='5e000000-0000-4000-8000-000000000001',ID2='5e000000-0000-4000-8000-000000000002';
const rt=(api,user='u-1')=>({context:{read:()=>({user:{id:user}})},api});
const fail=status=>{const e=new Error('x');e.status=status;return e};

test('readReceiveFolder: 내 행의 칸만 읽고, 비어 있으면 꺼짐, 칸이 없는 서버(400)는 pending, 모양이 틀리면 error',async()=>{
  const calls=[];
  assert.deepEqual(await m.readReceiveFolder(rt(async url=>{calls.push(url);return [{library_receive_folder:ID}]})),{status:'ok',id:ID});
  assert.equal(calls[0],'/rest/v1/app_profiles?user_id=eq.u-1&select=library_receive_folder&limit=1');
  assert.deepEqual(await m.readReceiveFolder(rt(async()=>[{library_receive_folder:null}])),{status:'ok',id:null});
  assert.deepEqual(await m.readReceiveFolder(rt(async()=>{throw fail(400)})),{status:'pending'});
  assert.deepEqual(await m.readReceiveFolder(rt(async()=>{throw fail(500)})),{status:'error'});
  for(const rows of [[],[{}],[{library_receive_folder:'f-1'}],[{library_receive_folder:ID.toUpperCase()}],null,[{library_receive_folder:ID},{library_receive_folder:ID}]])
    assert.deepEqual(await m.readReceiveFolder(rt(async()=>rows)),{status:'error'},JSON.stringify(rows));
  assert.deepEqual(await m.readReceiveFolder({context:{read:()=>null},api:async()=>[]}),{status:'error'},'로그인 정보 없음');
});

test('saveReceiveFolder: 내 행 PATCH 한 칸(켜기 id·끄기 null), 돌아온 값이 같아야 ok, 400은 pending, 틀린 id는 보내지 않음',async()=>{
  const calls=[];const api=async(url,opt)=>{calls.push({url,opt});return [{user_id:'u-1',library_receive_folder:opt.body.library_receive_folder}]};
  assert.deepEqual(await m.saveReceiveFolder(ID,rt(api)),{status:'ok'});
  assert.deepEqual(await m.saveReceiveFolder(null,rt(api)),{status:'ok'});
  assert.deepEqual(calls.map(c=>[c.url,c.opt.method,c.opt.body]),[['/rest/v1/app_profiles?user_id=eq.u-1','PATCH',{library_receive_folder:ID}],['/rest/v1/app_profiles?user_id=eq.u-1','PATCH',{library_receive_folder:null}]]);
  assert.deepEqual(await m.saveReceiveFolder('f-1',rt(api)),{status:'error'});assert.equal(calls.length,2,'틀린 id는 보내지 않음');
  assert.deepEqual(await m.saveReceiveFolder(ID,rt(async()=>[])),{status:'error'},'내 행이 아니면(고친 줄 없음) 실패');
  assert.deepEqual(await m.saveReceiveFolder(ID,rt(async()=>[{library_receive_folder:ID2}])),{status:'error'});
  assert.deepEqual(await m.saveReceiveFolder(ID,rt(async()=>{throw fail(400)})),{status:'pending'});
  assert.deepEqual(await m.saveReceiveFolder(ID,rt(async()=>{throw fail(409)})),{status:'error'},'없는 폴더(외래 키)');
});

test('liveReceiveFolder: 지금 보이는 폴더일 때만(휴지통·지워진 폴더면 null)',()=>{
  const folders=[{id:ID,name:'잡동사니'},{id:ID2,name:''}];
  assert.deepEqual(m.liveReceiveFolder(ID,folders),{id:ID,name:'잡동사니'});
  assert.deepEqual(m.liveReceiveFolder(ID2,folders),{id:ID2,name:'폴더'});
  assert.equal(m.liveReceiveFolder(ID,[]),null);assert.equal(m.liveReceiveFolder(null,folders),null);assert.equal(m.liveReceiveFolder('f-1',[{id:'f-1'}]),null);
});

test('outsideDocuments: 폴더 연결 줄이 없는 자료만(휴지통 폴더에 든 자료는 연결이 있어 빠짐)',()=>{
  const docs=[{id:'a'},{id:'b'},{id:'c'},{}];
  assert.deepEqual(m.outsideDocuments(docs,[{document_id:'b',folder_id:'x'},{document_id:'gone',folder_id:'y'}]).map(d=>d.id),['a','c']);
  assert.deepEqual(m.outsideDocuments(docs,null).map(d=>d.id),['a','b','c']);
  assert.deepEqual(m.outsideDocuments(null,[]),[]);
});

test('나무 모델: 받는 폴더 줄에만 표시, 폴더 보기·프로젝트 묶기 모두, 꺼지면 없음',()=>{
  const folders=[{id:ID,name:'잡동사니',project_id:null,parent_id:null,sort_order:1},{id:ID2,name:'가',project_id:null,parent_id:ID,sort_order:1}];
  const docs=[{id:'d1',title:'자료'}],items=[],sortKey=d=>d.title||'';
  const marked=list=>{const out=[];tree.walk(list,n=>{if(n.rc)out.push(n.key)});return out};
  assert.deepEqual(marked(tree.buildTree({groupBy:'folder',docs,folders,items,sortKey,receiveId:ID})),['f:'+ID]);
  assert.deepEqual(marked(tree.buildTree({groupBy:'folder',docs,folders,items,sortKey,receiveId:ID2})),['f:'+ID2]);
  assert.deepEqual(marked(tree.buildTree({groupBy:'folder',docs,folders,items,sortKey})),[]);
  assert.deepEqual(marked(tree.buildTree({groupBy:'project',docs,folders,items,sortKey,tree:[],receiveId:ID})),['f:'+ID]);
  const html=tree.treeHtml(tree.buildTree({groupBy:'folder',docs,folders,items,sortKey,receiveId:ID}),{isOpen:()=>true,showAll:()=>true,fileHtml:()=>'',esc:s=>String(s),emoji:true});
  assert.equal((html.match(/class="lu-receive-mark">받는 폴더</g)||[]).length,1);
  assert.match(html,/잡동사니(<span class="lu-chain-rest">[^<]*<\/span>)?<\/span><span class="lu-node-count"[^>]*>\d+<\/span><span class="lu-receive-mark">받는 폴더<\/span>/);
});

test('공용 폴더 줄: tag가 있으면 개수 뒤 작은 글자, 없으면 그대로(다른 화면 영향 없음)',()=>{
  const base={name:'잡동사니',count:3,countLabel:'3건'};
  assert.equal(ftFolderRowHtml(base),ftFolderRowHtml({...base,tag:''}));
  assert.doesNotMatch(ftFolderRowHtml(base),/ft-tag/);
  assert.match(ftFolderRowHtml({...base,tag:'받는 폴더'}),/<span class="ft-num"[^>]*>3<\/span><span class="ft-tag">받는 폴더<\/span>/);
  assert.match(ftFolderRowHtml({...base,tag:'<b>'}),/<span class="ft-tag">&lt;b&gt;<\/span>/);
});
