import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';

const WS='10000000-0000-4000-8000-000000000001';
const NOTE='20000000-0000-4000-8000-000000000001';
const attachment=id=>({drive_file_id:id,file_name:'old.txt',mime_type:'text/plain',size_bytes:3});
const defaultFolder=()=>({id:'synthetic-folder',name:'Web2 바구니',mimeType:'application/vnd.google-apps.folder',
  ownedByMe:true,trashed:false,parents:['synthetic-root'],permissions:[{type:'user',role:'owner'}]});

// Real handler + shared Drive code; only Supabase SDK boundary is modeled.
async function harness(options={}) {
  const {createBasketHandler}=await import('../../supabase/functions/basket-files/handler.ts');
  const calls={tables:[],writes:[],drive:[],logs:[]};
  const state={settings:options.settings===undefined?{workspace_id:WS,basket_folder_id:'synthetic-folder'}:options.settings,
    note:options.note===undefined?null:structuredClone(options.note),folder:options.folder===undefined?defaultFolder():options.folder};
  if(state.settings)state.settings={basket_folder_id:null,...state.settings};
  let uploads=0;
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const bytes=Buffer.concat(chunks); const url=new URL(req.url,'http://local');
    calls.drive.push({method:req.method,path:url.pathname,query:url.search,bytes:bytes.length});
    const send=(data,status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(data));};
    if(url.pathname==='/token')return send(options.tokenError?{error:'invalid_grant',error_description:'secret'}:{access_token:'synthetic-drive-token'},options.tokenError?400:200);
    if(req.method==='DELETE') {if(options.cleanupError)return send({error:'synthetic-secret'},500);res.writeHead(204);return res.end();}
    if(url.pathname==='/drive/v3/files/root')return send({id:'synthetic-root'});
    if(url.pathname==='/drive/v3/files' && req.method==='GET')return send({files:state.folder?[state.folder]:[]});
    if(url.pathname.startsWith('/drive/v3/files/') && req.method==='GET')return send(state.folder||{},state.folder?200:404);
    if(url.pathname==='/drive/v3/files' && req.method==='POST'){
      const meta=JSON.parse(bytes); assert.equal(meta.name,'Web2 바구니');assert.deepEqual(meta.parents,['root']);
      state.folder=defaultFolder();return send(state.folder);
    }
    if(url.pathname==='/upload/drive/v3/files'){
      return send({},200,{location:options.badLocation||`https://www.googleapis.com/upload-session/${++uploads}`});
    }
    if(url.pathname.startsWith('/upload-session/')){
      if(options.delayPut)await options.delayPut();
      if(options.failPut===Number(url.pathname.split('/').at(-1)))return send({error:'synthetic-secret'},503);
      return send({id:options.uploadId||'synthetic-file-'+url.pathname.split('/').at(-1)});
    }
    send({error:'unexpected'},500);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const driveFetch=(url,init)=>{const u=new URL(url);return fetch(origin+u.pathname+u.search,init);};
  const admin={auth:{getUser:async()=>options.auth||{data:{user:{id:'synthetic-owner'}},error:null}},from:table=>{
    calls.tables.push(table);const filters=[];let mutation=null,returning=false,ignore=false;
    const b={select:()=>{returning=true;return b;},eq:(k,v)=>{filters.push([k,v]);return b;},is:(k,v)=>{filters.push([k,v]);return b;},
      update:payload=>{mutation={kind:'update',payload};return b;},insert:payload=>{mutation={kind:'insert',payload};return b;},
      upsert:(payload,opt)=>{mutation={kind:'upsert',payload};ignore=opt?.ignoreDuplicates;return b;},
      maybeSingle:()=>exec(true),single:()=>exec(true),then:(r,e)=>exec(false).then(r,e)};
    async function exec(single){
      if(table==='app_notes' && !mutation && options.reconcileError && calls.writes.some(w=>w.table==='app_notes'))
        return {data:null,error:{message:'synthetic-secret'}};
      let data;
      if(table==='app_workspace_members') data=options.role===null?null:{workspace_id:WS,role:options.role||'owner'};
      else if(table==='public_policy_drive_config')data={google_client_id:'synthetic-client',google_client_secret:'synthetic-secret',google_refresh_token:'synthetic-refresh'};
      else if(table==='app_drive_settings')data=state.settings;
      else if(table==='app_notes')data=state.note;
      else throw new Error('unexpected table '+table);
      const match=data&&filters.every(([k,v])=>k==='attachments'?JSON.stringify(data[k])===v:data[k]===v);
      if(mutation){
        calls.writes.push({table,...mutation,filters});
        if((table==='app_notes'&&options.saveError)||(table==='app_drive_settings'&&options.settingError))
          return {data:null,error:{message:'synthetic-secret',code:'XX000'}};
        if(table==='app_drive_settings'){
          if(mutation.kind==='upsert'){if(!state.settings || !ignore) state.settings={basket_folder_id:null,...state.settings,...mutation.payload};data=null;}
          else if(match){state.settings={...state.settings,...mutation.payload};data=state.settings;}else data=null;
        }else{
          if(mutation.kind==='insert') {state.note={id:NOTE,updated_at:'synthetic-t1',...mutation.payload};data=state.note;}
          else if(match){state.note={...state.note,...mutation.payload};data=state.note;}else data=null;
        }
      }else if(table==='app_notes'||table==='app_drive_settings')data=match?data:null;
      data=data?structuredClone(data):null;
      if(table==='app_notes' && mutation && options.savePending){state.pendingNote=state.note;state.note=null;return {data:null,error:{code:'',message:'synthetic-secret'},status:0};}
      if(table==='app_notes' && mutation && options.saveLost)return {data:null,error:{code:'',message:'synthetic-secret'},status:0};
      return {data:single?data:(returning&&data?[data]:null),error:null,status:200};
    }
    return b;
  }};
  const handler=createBasketHandler(admin,{fetch:driveFetch,log:code=>calls.logs.push(code)});
  return {handler,calls,state,close:()=>new Promise(r=>server.close(r))};
}
async function send(h,{files=[new File(['hello'],'memo.txt',{type:'text/plain'})],fields={},auth='Bearer synthetic-user-token'}={}){
  const form=new FormData();for(const f of files)form.append('file',f);for(const [k,v]of Object.entries(fields))form.append(k,v);
  const response=await h.handler(new Request('https://synthetic.invalid/functions/v1/basket-files',{
    method:'POST',headers:auth?{Authorization:auth}:{},body:form}));
  return {status:response.status,body:await response.json()};
}
async function using(options,fn){const h=await harness(options);try{await fn(h);}finally{await h.close();}}

test('JWT absence/invalid session and non-owner reject before Drive access',async()=>{
  for(const [options,auth,status]of [[{},'',401],[{},'synthetic-user-token',401],
    [{auth:{data:{user:null},error:{status:401}}},'Bearer invalid',401],
    [{auth:{data:{user:null},error:{status:500,message:'synthetic-secret'}}},'Bearer x',503],
    ...['admin','editor','member',null].map(role=>[{role},'Bearer x',403])])
    await using(options,async h=>{assert.equal((await send(h,{auth})).status,status);assert.equal(h.calls.drive.length,0);});
});
test('new attachment-only note uses server metadata and never writes documents or leaks folder ID',async()=>using({},async h=>{
  const r=await send(h,{fields:{folder_id:'untrusted-folder',drive_file_id:'untrusted-file',workspace_id:'untrusted',ai_export_allowed:'false'}});
  assert.equal(r.status,200);assert.equal(r.body.ok,true);
  assert.equal(h.state.note.workspace_id,WS);assert.equal(h.state.note.raw_text,'');
  assert.deepEqual(h.state.note.attachments,[{drive_file_id:'synthetic-file-1',file_name:'memo.txt',mime_type:'text/plain',size_bytes:5}]);
  assert.equal(h.calls.tables.includes('app_documents'),false);
  assert.equal(h.calls.writes.some(x=>Object.hasOwn(x.payload,'ai_export_allowed')),false);
  assert.doesNotMatch(JSON.stringify(r.body),/folder|untrusted/);
}));
test('new raw_text preserves whitespace and database character-count limit',async()=>using({},async h=>{
  const raw=' \r\n'+ '😀'.repeat(19996)+' ';
  assert.equal((await send(h,{fields:{raw_text:raw}})).status,200);assert.equal(h.state.note.raw_text,raw);
  assert.equal((await send(h,{fields:{raw_text:'😀'.repeat(20001)}})).status,400);
}));
test('other workspace note and unknown note are refused without uploading',async()=>{
  for(const note of [null,{id:NOTE,workspace_id:'other',attachments:[],updated_at:'old'}])await using({note},async h=>{
    assert.equal((await send(h,{fields:{note_id:NOTE,workspace_id:'other'}})).status,404);assert.equal(h.calls.drive.length,0);
  });
});
test('existing note adds attachments while preserving raw text and AI flag',async()=>using({note:{id:NOTE,workspace_id:WS,raw_text:'keep',ai_export_allowed:false,attachments:[attachment('old')],updated_at:'old'}},async h=>{
  assert.equal((await send(h,{fields:{note_id:NOTE,raw_text:'discard'}})).status,200);
  assert.equal(h.state.note.raw_text,'keep');assert.equal(h.state.note.ai_export_allowed,false);assert.equal(h.state.note.attachments.length,2);
}));
test('empty, oversized, invalid metadata, and over-count files refuse before Drive',async()=>{
  for(const files of [[],[new File([],'empty.txt')],[new File(['x'],'x'.repeat(256))],
    [new File([new Uint8Array(104857601)],'big.txt')],Array.from({length:21},()=>new File(['x'],'a.txt'))])
    await using({},async h=>{assert.ok([400,413].includes((await send(h,{files})).status));assert.equal(h.calls.drive.length,0);});
  await using({note:{id:NOTE,workspace_id:WS,attachments:Array.from({length:20},(_,i)=>attachment('old-'+i)),updated_at:'old'}},async h=>{
    assert.equal((await send(h,{fields:{note_id:NOTE}})).status,400);assert.equal(h.calls.drive.length,0);
  });
});
test('folder automatically created at root, persisted without overwriting library settings, and reused',async()=>using({settings:{workspace_id:WS,library_folder_id:'keep'},folder:null},async h=>{
  assert.equal((await send(h)).status,200);assert.equal((await send(h)).status,200);
  assert.equal(h.state.settings.library_folder_id,'keep');assert.equal(h.state.settings.basket_folder_id,'synthetic-folder');
  assert.equal(h.calls.drive.filter(x=>x.method==='POST'&&x.path==='/drive/v3/files').length,1);
  assert.equal(h.calls.drive.some(x=>x.path.includes('permissions')),false);
}));
test('existing owned root folder discovered without duplicate creation; missing settings row is initialized',async()=>using({settings:null},async h=>{
  assert.equal((await send(h)).status,200);assert.equal(h.state.settings.basket_folder_id,'synthetic-folder');
  assert.equal(h.calls.drive.filter(x=>x.method==='POST'&&x.path==='/drive/v3/files').length,0);
}));
test('shared, non-owned, moved or renamed cached folder is rejected',async()=>{
  for(const change of [{permissions:[{type:'anyone',role:'reader'}]},{ownedByMe:false},{parents:[]},
    {name:'other'},{trashed:true},{permissions:[{type:'user',role:'owner'},{type:'user',role:'reader'}]}])
    await using({folder:{...defaultFolder(),...change}},async h=>{assert.equal((await send(h)).status,409);assert.equal(h.calls.writes.length,0);});
});
test('note save failure and partial upload failure clean only newly uploaded files',async()=>{
  for(const options of [{saveError:true},{failPut:2}])await using(options,async h=>{
    const r=await send(h,{files:[new File(['a'],'a.txt'),new File(['b'],'b.txt')]});
    assert.ok(r.status>=500);
    assert.deepEqual(h.calls.drive.filter(x=>x.method==='DELETE').map(x=>x.path),
      (options.saveError?['synthetic-file-1','synthetic-file-2']:['synthetic-file-1']).map(id=>'/drive/v3/files/'+id));
    assert.doesNotMatch(JSON.stringify(r.body),/synthetic-secret/);
  });
});
test('duplicate existing/new Drive ID is refused without deleting the pre-existing attachment',async()=>using({uploadId:'old',note:{id:NOTE,workspace_id:WS,attachments:[attachment('old')],updated_at:'old'}},async h=>{
  assert.equal((await send(h,{fields:{note_id:NOTE}})).status,409);
  assert.equal(h.state.note.attachments.length,1);assert.equal(h.calls.drive.some(x=>x.method==='DELETE'),false);
}));
test('concurrent note mutation rejects append and cleans new upload instead of overwriting',async()=>{
  let h;await using({note:{id:NOTE,workspace_id:WS,attachments:[],updated_at:'old'},delayPut:async()=>{h.state.note.attachments=[attachment('concurrent')];}},async handle=>{
    h=handle;assert.equal((await send(h,{fields:{note_id:NOTE}})).status,409);
    assert.deepEqual(h.state.note.attachments,[attachment('concurrent')]);assert.equal(h.calls.drive.filter(x=>x.method==='DELETE').length,1);
  });
});
test('settings write failure prevents uploads; cleanup failure logs codes only',async()=>{
  await using({settings:null,settingError:true},async h=>{assert.equal((await send(h)).status,503);assert.equal(h.calls.drive.some(x=>x.path.startsWith('/upload')),false);});
  await using({saveError:true,cleanupError:true},async h=>{
    assert.equal((await send(h)).status,500);assert.ok(h.calls.logs.includes('orphan_cleanup_failed'));
    assert.ok(h.calls.logs.every(s=>/^[a-z_]+$/.test(s)));assert.doesNotMatch(JSON.stringify(h.calls.logs),/secret|token|synthetic/);
  });
});
test('Drive token expiration and untrusted resumable location never leak credentials',async()=>{
  for(const options of [{tokenError:true},{badLocation:'https://attacker.invalid/collect'}])await using(options,async h=>{
    const r=await send(h);assert.ok([424,503].includes(r.status));assert.equal(h.calls.drive.some(x=>x.path==='/collect'),false);
  });
});
test('lost note-save response keeps committed Drive files and verifies success by note readback',async()=>using({saveLost:true},async h=>{
  const r=await send(h);assert.equal(r.status,200);assert.equal(r.body.note_id,h.state.note.id);
  assert.equal(h.calls.drive.some(x=>x.method==='DELETE'),false);
}));
test('unknown note-save and failed readback retain files for manual reconciliation',async()=>using({saveLost:true,reconcileError:true},async h=>{
  const r=await send(h);assert.equal(r.status,503);assert.equal(r.body.code,'note_save_result_unknown');
  assert.equal(r.body.note_id,h.state.note.id);assert.equal(h.calls.drive.some(x=>x.method==='DELETE'),false);
}));
test('exactly 100 MiB and exactly 20 total attachments are accepted',async()=>{
  await using({},async h=>assert.equal((await send(h,{files:[new File([new Uint8Array(104857600)],'limit.bin')]})).status,200));
  await using({note:{id:NOTE,workspace_id:WS,attachments:Array.from({length:19},(_,i)=>attachment('old-'+i)),updated_at:'old'}},async h=>{
    assert.equal((await send(h,{fields:{note_id:NOTE}})).status,200);assert.equal(h.state.note.attachments.length,20);
  });
});
test('OPTIONS and actual unauthenticated workflow JSON probe return expected statuses',async()=>using({},async h=>{
  const response=await h.handler(new Request('https://synthetic.invalid',{method:'OPTIONS'}));assert.equal(response.status,200);
  const probe=await h.handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
  assert.equal(probe.status,401);assert.equal(h.calls.drive.length,0);
}));
test('negative readback after lost response cannot authorize DELETE before delayed DB commit',async()=>using({savePending:true},async h=>{
  const r=await send(h);assert.equal(r.status,503);assert.equal(r.body.code,'note_save_result_unknown');
  assert.equal(h.state.note,null);assert.equal(h.calls.drive.some(x=>x.method==='DELETE'),false);
  h.state.note=h.state.pendingNote;assert.equal(h.state.note.id,r.body.note_id);assert.equal(h.state.note.attachments.length,1);
}));
