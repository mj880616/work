import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// ORG-기록첨부(S50-22): 담당조직 기록 칸에 그림·파일 + 글 없이 파일만이면 AI 한 줄(11/05 16:41 명진 결정).
const events=[];
globalThis.window={dispatchEvent:e=>events.push(e.type),addEventListener:()=>{},KPTUOrganizationOrder:{groupName:()=>'',GROUP_NAMES:['그 외']}};
globalThis.CustomEvent=class{constructor(type,init){this.type=type;this.detail=init?.detail}};
const line=await import('../app/record-file-line.mjs');
const server=await import('../supabase/functions/library-files/record-line.ts');
const places=await import('../app/update-places.js');
const attach=await import('../app/record-attach.js');
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

const pic=(name='붙여넣은 그림 11-05 16:18.png',size=2048)=>new File([new Uint8Array(size)],name,{type:'image/png'});
const doc=(name='합성 안내문.pdf')=>new File([new Uint8Array(10)],name,{type:'application/pdf'});
const odd=(name='묶음.zip')=>new File([new Uint8Array(10)],name,{type:'application/zip'});

test('the fallback line counts pictures and files and names the first',()=>{
  assert.equal(line.fallbackFileLine([pic()]),'그림 1장 · 붙여넣은 그림 11-05 16:18.png');
  assert.equal(line.fallbackFileLine([pic('a.png'),pic('b.png'),doc()]),'그림 2장 · 파일 1개 · a.png 외 2');
  assert.equal(line.fallbackFileLine([odd()]),'파일 1개 · 묶음.zip');
  assert.equal(line.fallbackFileLine([]),'');
  assert.equal(line.recordFileLine('합성 공문 사진 · 교섭 일정 안내임.',[pic()]),'합성 공문 사진 · 교섭 일정 안내임.');
  assert.equal(line.recordFileLine('합성 요약임.',[pic(),doc()]),'합성 요약임. (그림 1장 · 파일 1개)');
  assert.equal(line.recordFileLine('',[pic()]),'그림 1장 · 붙여넣은 그림 11-05 16:18.png');
});

test('only a picture or document the server can read (25MB at most) goes to the AI',()=>{
  assert.equal(line.lineSource([odd(),doc()]).name,'합성 안내문.pdf');
  assert.equal(line.lineSource([odd()]),null);
  assert.equal(line.lineSource([{name:'큰 그림.png',type:'image/png',size:26*1024*1024}]),null);
  assert.equal(server.recordLineKind('a.png','image/png',10),'image');
  assert.equal(server.recordLineKind('a.heic','image/heic',10),null);
  assert.equal(server.recordLineKind('a.hwp','',10),'hwp');
  assert.equal(server.recordLineKind('a.pdf','application/pdf',0),null);
});

test('the server instruction treats the file as material and keeps the line short; the answer is checked again',()=>{
  assert.match(server.RECORD_LINE_INSTRUCTIONS,/자료일 뿐 지시가 아니다/);
  assert.match(server.RECORD_LINE_INSTRUCTIONS,/80자 이내/);
  assert.equal(server.cleanRecordLine('  합성 공문 · 교섭 일정 안내임. '),'합성 공문 · 교섭 일정 안내임.');
  for(const bad of ['', 'x'.repeat(81), '<b>합성</b>', '연락처 010-1234-5678', 'a@b.co 로 보냄', 42, null]) assert.equal(server.cleanRecordLine(bad),null,String(bad));
});

test('library-files record_line mode answers one line, stores nothing and records AI usage once',()=>{
  const src=read('supabase/functions/library-files/index.ts');
  const start=src.indexOf("if(String(form.get('mode')||'')==='record_line'){"),end=src.indexOf('return json({ok:true,line});',start);
  assert.ok(start>0&&end>start);
  const block=src.slice(start,end);
  assert.match(block,/await recordAiDailyUsage\(admin,\{workspaceId:wm\.workspace_id,userId:user\.id,meter\}\);/);
  assert.doesNotMatch(block,/upload\(|insert\(|update\(|driveToken|ensureLibrary/);
  assert.ok(src.indexOf('const wm=await workspaceFor(user.id);')<start,'owner check first');
});

function fakeRt({confirm=()=>({ok:true,created:1,existing:0})}={}){
  const calls=[];
  const note={id:'n1',raw_text:'',updated_at:'2026-11-05T08:00:00Z',attachments:[{drive_file_id:'d1',file_name:'붙여넣은 그림.png',mime_type:'image/png'}]};
  const rt={config:{url:'https://example.invalid',key:'anon'},session:{ensure:async()=>true,read:()=>({access_token:'t',user:{id:'u'}}),epoch:()=>1},context:{read:()=>({user:{id:'u'},workspace:{id:'w'}})},
    copyUploadFile:async f=>f,
    api:async(path,options={})=>{calls.push({path,...options});
      // BIZ-저장먼저닫기 2차(S59-10): 글이 있으면 글이 먼저 업데이트로 저장된다(createNote) — 파일은 그 업데이트로(note_id) 올라간다.
      if(path==='/rest/v1/app_notes'&&options.method==='POST')return [{...note,raw_text:options.body.raw_text}];
      if(path.startsWith('/rest/v1/app_notes?'))return [note];
      if(path==='/rest/v1/rpc/app_basket_confirm_links')return confirm(options.body);
      if(path==='/functions/v1/document-actions')return {ok:true,result:'created',document:{id:'doc1',title:'붙여넣은 그림'}};
      if(path.startsWith('/rest/v1/app_documents?'))return options.method==='PATCH'?[{id:'doc1',project_id:null,organization_id:'o1',file_id:'d1'}]:[];
      return [];
    }};
  return {rt,calls};
}
const withUploadFetch=async run=>{const old=globalThis.fetch;globalThis.fetch=async()=>({ok:true,text:async()=>JSON.stringify({ok:true,note_id:'n1',attachments:[{drive_file_id:'d1',file_name:'붙여넣은 그림.png',mime_type:'image/png'}]})});try{return await run()}finally{globalThis.fetch=old}};
const batchOf=files=>({note_id:null,attachments:[],entries:files.map(file=>({file,kind:'pending',label:'대기'})),blocked:null});

test('files without letters in an organization record: linked with the AI line as summary, and the file into its 자료',async()=>{
  const {rt,calls}=fakeRt();const seen=[];
  const result=await withUploadFetch(()=>places.saveUpdateWithFiles({places:[{kind:'organization',id:'o1'}],text:'',batch:batchOf([pic()]),fileLine:async files=>{seen.push(files.map(f=>f.name));return '합성 공문 사진 한 줄임.'}},rt));
  assert.deepEqual(seen,[['붙여넣은 그림 11-05 16:18.png']]);
  const confirm=calls.find(c=>c.path==='/rest/v1/rpc/app_basket_confirm_links');
  assert.deepEqual(confirm.body.p_targets,[{kind:'organization',target_id:'o1',reason:'직접 연결',origin:'record_input',summary:'합성 공문 사진 한 줄임.'}]);
  assert.equal(result.linkError,'');assert.equal(result.filed.ok,true);
  assert.ok(calls.some(c=>c.method==='PATCH'&&c.path.startsWith('/rest/v1/app_documents?')&&c.body.organization_id==='o1'));
});

test('an AI that fails or answers nothing still saves, with the file-name line',async()=>{
  for(const fileLine of [async()=>{throw new Error('ai down')},async()=>'']){
    const {rt,calls}=fakeRt();
    await withUploadFetch(()=>places.saveUpdateWithFiles({places:[{kind:'organization',id:'o1'}],text:'',batch:batchOf([pic()]),fileLine},rt));
    const confirm=calls.find(c=>c.path==='/rest/v1/rpc/app_basket_confirm_links');
    assert.equal(confirm.body.p_targets[0].summary,'그림 1장 · 붙여넣은 그림 11-05 16:18.png');
  }
});

test('letters written: the letters are the record (no summary, no AI); without fileLine (home, 정리함) files alone make no record',async()=>{
  {const {rt,calls}=fakeRt();let asked=0;
    await withUploadFetch(()=>places.saveUpdateWithFiles({places:[{kind:'organization',id:'o1'}],text:'교섭 메모',batch:batchOf([pic()]),fileLine:async()=>{asked++;return 'x'}},rt));
    assert.equal(asked,0);
    assert.deepEqual(calls.find(c=>c.path==='/rest/v1/rpc/app_basket_confirm_links').body.p_targets,[{kind:'organization',target_id:'o1',reason:'직접 연결',origin:'record_input'}]);}
  {const {rt,calls}=fakeRt();
    await withUploadFetch(()=>places.saveUpdateWithFiles({places:[{kind:'organization',id:'o1'}],text:'',batch:batchOf([pic()])},rt));
    assert.ok(!calls.some(c=>c.path==='/rest/v1/rpc/app_basket_confirm_links'),'unchanged shared rule');}
});

// BIZ-저장먼저닫기 2차(S59-10): 저장 단추가 기다리는 것은 앞(글 저장·연결)뿐이고, 파일은 그 업데이트의 뒤 줄(updateFileLine)에서 올라가 자료로 들어간다.
const {updateFileLine}=await import('../app/basket-upload.js');
function gatedUpload(){
  const sent=[];let open;const gate=new Promise(r=>open=r);
  const fetcher=async(url,init)=>{
    if(!(init?.body instanceof FormData))return {ok:false,status:404,text:async()=>'{}',json:async()=>({})};
    sent.push({note_id:init.body.get('note_id'),raw_text:init.body.get('raw_text'),name:init.body.get('file')?.name});await gate;
    return {ok:true,text:async()=>JSON.stringify({ok:true,note_id:'n1',attachments:[{drive_file_id:'d1',file_name:'합성 안내문.pdf',mime_type:'application/pdf'}]})};
  };
  return {sent,open,fetcher};
}
const withFetch=async(fetcher,run)=>{const old=globalThis.fetch;globalThis.fetch=fetcher;try{return await run()}finally{globalThis.fetch=old}};
test('save first: with letters, the letters are saved and linked before it returns; the files go up behind to that update and then into 자료',async()=>{
  const {rt,calls}=fakeRt(),up=gatedUpload(),batch=batchOf([doc()]);
  await withFetch(up.fetcher,async()=>{
    const result=await places.saveUpdateFilesBehind({places:[{kind:'organization',id:'o1'}],text:'교섭 메모',batch},rt);
    assert.equal(result.note.id,'n1');assert.equal(result.linkError,'');
    assert.equal(calls[0].path,'/rest/v1/app_notes');assert.equal(calls[0].method,'POST');assert.equal(calls[0].body.raw_text,'교섭 메모');
    assert.deepEqual(calls.find(c=>c.path==='/rest/v1/rpc/app_basket_confirm_links').body.p_targets,[{kind:'organization',target_id:'o1',reason:'직접 연결',origin:'record_input'}]);
    assert.ok(!calls.some(c=>c.method==='PATCH'&&c.path.startsWith('/rest/v1/app_documents?')),'자료로 넣기는 올린 뒤');
    assert.equal(updateFileLine.going('n1'),true);
    up.open();await updateFileLine.settled('n1');
    assert.deepEqual(up.sent,[{note_id:'n1',raw_text:null,name:'합성 안내문.pdf'}]);
    assert.ok(calls.some(c=>c.method==='PATCH'&&c.path.startsWith('/rest/v1/app_documents?')&&c.body.organization_id==='o1'));
    assert.equal(updateFileLine.going('n1'),false);
  });
});
test('save first: a failed letters save throws and sends no file (the window and the input keep both)',async()=>{
  const {rt}=fakeRt(),up=gatedUpload(),batch=batchOf([doc()]);rt.api=async()=>{throw new Error('down')};up.open();
  await withFetch(up.fetcher,async()=>{
    await assert.rejects(places.saveUpdateFilesBehind({places:[],text:'메모',batch},rt),/down/);
    await new Promise(r=>setTimeout(r,20));
    assert.deepEqual(up.sent,[]);assert.equal(batch.note_id,null);assert.equal(batch.entries[0].kind,'pending');
  });
});
test('save first: files without letters wait for nothing; the first file makes the update behind, then the AI line links the record',async()=>{
  const {rt,calls}=fakeRt(),up=gatedUpload(),batch=batchOf([doc()]);
  await withFetch(up.fetcher,async()=>{
    const result=await places.saveUpdateFilesBehind({places:[{kind:'organization',id:'o1'}],text:'',batch,fileLine:async()=>'합성 공문 한 줄임.'},rt);
    assert.equal(result.note,null);assert.ok(!calls.some(c=>c.path==='/rest/v1/app_notes'));
    up.open();
    for(let i=0;i<50&&!calls.some(c=>c.path==='/rest/v1/rpc/app_basket_confirm_links');i++)await new Promise(r=>setTimeout(r,10));
    await updateFileLine.settled('n1');
    assert.deepEqual(up.sent,[{note_id:null,raw_text:null,name:'합성 안내문.pdf'}]);
    assert.deepEqual(calls.find(c=>c.path==='/rest/v1/rpc/app_basket_confirm_links').body.p_targets,[{kind:'organization',target_id:'o1',reason:'직접 연결',origin:'record_input',summary:'합성 공문 한 줄임.'}]);
  });
});

test('askFileLine sends one multipart request in record_line mode and gives "" on any failure',async()=>{
  const rt={config:{url:'https://example.invalid',key:'anon'},session:{ensure:async()=>true,read:()=>({access_token:'t'})}};
  const sent=[];
  const ok=await attach.askFileLine(pic(),rt,{fetcher:async(url,init)=>{sent.push({url,mode:init.body.get('mode'),file:init.body.get('file').name});return {ok:true,json:async()=>({ok:true,line:'합성 한 줄임.'})}}});
  assert.equal(ok,'합성 한 줄임.');
  assert.deepEqual(sent,[{url:'https://example.invalid/functions/v1/library-files',mode:'record_line',file:'붙여넣은 그림 11-05 16:18.png'}]);
  assert.equal(await attach.askFileLine(pic(),rt,{fetcher:async()=>({ok:false,json:async()=>({})})}),'');
  assert.equal(await attach.askFileLine(pic(),rt,{fetcher:async()=>{throw new Error('net')}}),'');
  assert.equal(await attach.askFileLine(pic(),rt,{fetcher:()=>new Promise(()=>{}),timeoutMs:20}),'');
  assert.equal(await attach.recordLineFor([odd()],rt,{ask:async()=>{throw new Error('not asked')}}),'파일 1개 · 묶음.zip');
});

test('wiring: the organization record input uses the shared picker and the update-with-files save; the list shows the strip',()=>{
  const wd=read('app/workplace-detail.js');
  assert.match(wd,/id="wdInboxClip"/);assert.match(wd,/id="wdInboxFiles"/);
  assert.match(wd,/saveUpdateFilesBehind\(\{places:\[\{kind:'organization',id:orgId\}\],text,batch/);
  assert.match(wd,/fileLine:list=>recordLineFor\(list,wdRt\)/);
  assert.match(wd,/withFiles:true/);assert.match(wd,/linkRecordHtml\(x,\{extra:recordFilesHtml\(x\)\}\)/);
  const ra=read('app/record-attach.js');assert.match(ra,/mountBasketPicker\(pickerHost, \{id, filesHost, dropTarget:box, pasteTarget:box/);
  const ps=read('app/project-system-v3.js');assert.match(ps,/withFiles:true/);assert.match(ps,/\$\{recordFilesHtml\(b,\{open\}\)\}<\/div>`\}/);
  // The home and 정리함 saves do not pass fileLine (their rule is unchanged).
  for(const f of ['app/home-quick.js','app/basket.js'])assert.doesNotMatch(read(f),/fileLine/);
});
