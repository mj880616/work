import test from 'node:test';
import assert from 'node:assert/strict';

// Real basket-files handler + shared Drive code. Only the Supabase SDK and the Google HTTP boundary are modeled; no production access.
// JOURNAL-일기사진정리: photo-prune (trash the Drive original of a photo taken out of a diary) and photo-orphans (read-only candidate list).
const WS='10000000-0000-4000-8000-000000000001';
const FOLDER='synthetic-folder';
const OLD='2026-10-01T00:00:00.000Z';
const att=id=>({drive_file_id:id,file_name:id+'.jpg',mime_type:'image/jpeg',size_bytes:3});
const file=(id,extra={})=>({id,name:id+'.jpg',mimeType:'image/jpeg',ownedByMe:true,trashed:false,parents:[FOLDER],size:'3',createdTime:OLD,...extra});

function harness(options={}){
  const calls={admin:[],drive:[],logs:[]};
  const state={notes:structuredClone(options.notes??[]),documents:structuredClone(options.documents??[]),
    files:new Map((options.files??[]).map(f=>[f.id,structuredClone(f)]))};
  const folder={id:FOLDER,name:'Web2 바구니',mimeType:'application/vnd.google-apps.folder',ownedByMe:true,trashed:false,parents:['synthetic-root'],permissions:[{type:'user',role:'owner'}]};
  const admin={auth:{getUser:async()=>options.auth||{data:{user:{id:'synthetic-owner'}},error:null}},from:table=>{
    const q={table,filters:[],mutation:null,range:null,limit:null};calls.admin.push(q);
    const b={select:()=>b,eq:(k,v)=>{q.filters.push(['eq',k,v]);return b;},in:(k,v)=>{q.filters.push(['in',k,v]);return b;},
      contains:(k,v)=>{q.filters.push(['contains',k,v]);return b;},order:()=>b,limit:n=>{q.limit=n;return b;},range:(a,z)=>{q.range=[a,z];return b;},
      is:()=>b,update:()=>{q.mutation='update';return b;},insert:()=>{q.mutation='insert';return b;},upsert:()=>{q.mutation='upsert';return b;},delete:()=>{q.mutation='delete';return b;},
      maybeSingle:async()=>exec(),single:async()=>exec(),then:(r,e)=>exec().then(r,e)};
    async function exec(){
      if(table==='app_workspace_members')return {data:options.role===null?null:{workspace_id:WS,role:options.role||'owner'},error:null};
      if(table==='public_policy_drive_config')return options.tokenMissing?{data:null,error:{message:'x'}}:{data:{google_client_id:'c',google_client_secret:'s',google_refresh_token:'r'},error:null};
      if(table==='app_drive_settings')return {data:options.noFolderSetting?{basket_folder_id:null}:{basket_folder_id:FOLDER},error:null};
      if(table==='app_notes'||table==='app_documents'){
        if(q.mutation)throw new Error('prune must not write '+table);
        if(options.readError?.includes(table))return {data:null,error:{message:'synthetic-secret'}};
        let rows=table==='app_notes'?state.notes:state.documents;
        for(const [op,k,v] of q.filters)rows=rows.filter(r=>op==='eq'?r[k]===v:op==='in'?v.includes(r[k]):(r[k]||[]).some(a=>a.drive_file_id===v[0].drive_file_id));
        if(q.range)rows=rows.slice(q.range[0],q.range[1]+1);
        if(q.limit)rows=rows.slice(0,q.limit);
        return {data:structuredClone(rows),error:null};
      }
      throw new Error('admin must not touch '+table);
    }
    return b;
  }};
  const fetch=async(url,init={})=>{
    const u=new URL(url),method=init.method||'GET';calls.drive.push({method,path:u.pathname,search:u.search,body:init.body});
    const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(u.hostname==='oauth2.googleapis.com')return send({access_token:'synthetic-drive-token'});
    if(u.pathname==='/drive/v3/files'&&method==='GET'){
      const q=u.searchParams.get('q')||'';
      if(options.listFails)return send({error:'x'},500);
      if(q.includes("name = 'Web2 바구니'"))return send({files:[folder]});
      const list=[...state.files.values()].filter(f=>!f.trashed);
      const start=Number(u.searchParams.get('pageToken')||0),size=Number(u.searchParams.get('pageSize'));
      const slice=list.slice(start,start+size);
      return send({files:slice,...(start+size<list.length?{nextPageToken:String(start+size)}:{})});
    }
    const id=decodeURIComponent(u.pathname.split('/').at(-1));
    if(id===FOLDER&&method==='GET')return send(folder);
    if(method==='GET'){const f=state.files.get(id);return f?send(f):send({error:'notFound'},404);}
    if(method==='PATCH'){
      const outcome=options.patch?.[id];
      if(outcome==='throw')throw new Error('net');
      if(typeof outcome==='number')return send({error:'synthetic-secret'},outcome);
      const f=state.files.get(id);f.trashed=JSON.parse(init.body).trashed;return send({id,trashed:f.trashed});
    }
    return send({error:'unexpected'},500);
  };
  return {calls,state,fetch,admin};
}
async function run(options={},body,{auth='Bearer synthetic-user-token',query,raw,method='POST'}={}){
  const h=harness(options);
  const {createBasketHandler}=await import('../../supabase/functions/basket-files/handler.ts');
  const handler=createBasketHandler(h.admin,{fetch:h.fetch,log:c=>h.calls.logs.push(c)});
  const action=body?.action??'photo-prune';
  const response=await handler(new Request('https://synthetic.invalid/functions/v1/basket-files'+(query??`?action=${action}`),{method,
    headers:{...(auth?{Authorization:auth}:{}),'Content-Type':'application/json'},body:raw??JSON.stringify(body)}));
  return {...h,status:response.status,body:await response.json()};
}
const patches=calls=>calls.drive.filter(c=>c.method==='PATCH');
const prune=(ids,options)=>run(options,{action:'photo-prune',file_ids:ids});
const orphans=options=>run(options,{action:'photo-orphans',dry_run:true});

test('a removed photo nobody lists is sent to the Drive trash (PATCH trashed, never DELETE)',async()=>{
  const r=await prune(['p1'],{files:[file('p1')]});
  assert.equal(r.status,200);
  assert.deepEqual([r.body.ok,r.body.requested,r.body.trashed,r.body.kept,r.body.failed,r.body.unknown],[true,1,1,0,0,0]);
  assert.deepEqual(r.body.results,[{file_id:'p1',result:'trashed'}]);
  assert.deepEqual(patches(r.calls).map(c=>[c.path,JSON.parse(c.body)]),[['/drive/v3/files/p1',{trashed:true}]]);
  assert.equal(r.calls.drive.some(c=>c.method==='DELETE'),false);
  assert.equal(r.state.files.get('p1').trashed,true);
});

test('a photo another note, a trashed note or a library document still lists is kept',async()=>{
  const r=await prune(['n','t','d','free'],{
    notes:[{id:'a',workspace_id:WS,attachments:[att('n')]},{id:'b',workspace_id:WS,deleted_at:'2026-10-02T00:00:00Z',attachments:[att('t')]}],
    documents:[{workspace_id:WS,file_id:'d'}],
    files:['n','t','d','free'].map(id=>file(id))});
  assert.deepEqual([r.body.trashed,r.body.kept],[1,3]);
  assert.deepEqual(patches(r.calls).map(c=>c.path),['/drive/v3/files/free']);
});

test('only an owned image directly in the private basket folder is trashed',async()=>{
  const r=await prune(['out','dir','pdf','notmine','gone','ok'],{files:[file('out',{parents:['elsewhere']}),file('dir',{mimeType:'application/vnd.google-apps.folder'}),
    file('pdf',{mimeType:'application/pdf'}),file('notmine',{ownedByMe:false}),file('ok')]});
  assert.equal(r.status,200);
  assert.deepEqual([r.body.trashed,r.body.failed],[1,5]);
  assert.deepEqual(patches(r.calls).map(c=>c.path),['/drive/v3/files/ok']);
});

test('an unreadable reference table trashes nothing',async()=>{
  for(const table of ['app_notes','app_documents']){
    const r=await prune(['p1'],{files:[file('p1')],readError:[table]});
    assert.equal(r.status,503);assert.equal(r.body.ok,false);assert.equal(r.body.code,'photo_prune_reference_unavailable');
    assert.equal(patches(r.calls).length,0);assert.equal(JSON.stringify(r.body).includes('synthetic-secret'),false);
  }
  const noDrive=await prune(['p1'],{files:[file('p1')],tokenMissing:true});
  assert.equal(noDrive.status,503);assert.equal(patches(noDrive.calls).length,0);
});

test('a failed or unclear Drive PATCH is counted and never retried',async()=>{
  const r=await prune(['a','b','c'],{files:['a','b','c'].map(id=>file(id)),patch:{a:403,b:'throw',c:502}});
  assert.equal(r.status,200);assert.deepEqual([r.body.trashed,r.body.failed,r.body.unknown],[0,1,2]);
  for(const id of ['a','b','c'])assert.equal(patches(r.calls).filter(c=>c.path.endsWith('/'+id)).length,1);
});

test('request shape: 1..20 distinct plain ids, nothing else; owner only; login required',async()=>{
  for(const ids of [[],Array.from({length:21},(_,i)=>'f'+i),['a','a'],['a/b'],[1],'a'])assert.equal((await prune(ids,{files:[file('a')]})).status,400);
  assert.equal((await run({},{action:'photo-prune',file_ids:['a'],note_id:'x'})).status,400);
  assert.equal((await run({},undefined,{raw:'not json',query:'?action=photo-prune'})).status,400);
  const big=await run({},{action:'photo-prune',file_ids:['a'],pad:'x'.repeat(9000)});assert.equal(big.status,413);
  for(const [options,auth,status] of [[{role:'member'},'Bearer x',403],[{role:null},'Bearer x',403],[{},'',401],[{auth:{data:{user:null},error:{status:401}}},'Bearer bad',401]]){
    const q=await run(options,{action:'photo-prune',file_ids:['a']},{auth});
    assert.equal(q.status,status);assert.equal(q.calls.drive.length,0);
  }
});

test('photo-orphans is a read-only list: unreferenced old images only, fresh uploads and referenced files left out',async()=>{
  const r=await orphans({
    notes:[{id:'a',workspace_id:WS,attachments:[att('used')]}],documents:[{workspace_id:WS,file_id:'doc'}],
    files:[file('used'),file('doc'),file('left1'),file('left2',{createdTime:'2026-10-02T00:00:00.000Z',name:'second.jpg'}),
      file('fresh',{createdTime:new Date().toISOString()}),file('pdf',{mimeType:'application/pdf'}),file('shared',{ownedByMe:false}),file('sub',{parents:['elsewhere']})]});
  assert.equal(r.status,200);assert.equal(r.body.dry_run,true);
  assert.deepEqual(r.body.candidates.map(c=>c.file_id),['left1','left2']);
  assert.deepEqual([r.body.candidates_total,r.body.referenced,r.body.too_new,r.body.truncated],[2,2,1,false]);
  assert.deepEqual(Object.keys(r.body.candidates[0]).sort(),['created_time','file_id','file_name','mime_type','size_bytes']);
  assert.equal(r.calls.drive.some(c=>c.method!=='GET'&&c.path!=='/token'),false);
  assert.equal(r.calls.admin.some(q=>q.mutation),false);
});

test('photo-orphans reads every page of the folder and every page of notes',async()=>{
  const files=Array.from({length:450},(_,i)=>file('f'+i)),notes=Array.from({length:1200},(_,i)=>({id:'n'+i,workspace_id:WS,attachments:i<450?[att('f'+i)]:[]}));
  const r=await orphans({files,notes});
  assert.equal(r.status,200);assert.deepEqual([r.body.drive_images,r.body.referenced,r.body.candidates_total],[450,450,0]);
  const all=await orphans({files});
  assert.equal(all.body.candidates_total,450);
});

test('photo-orphans fails closed: no list when Drive or a table cannot be read; needs dry_run:true',async()=>{
  for(const options of [{listFails:true},{readError:['app_notes']},{readError:['app_documents']},{tokenMissing:true}]){
    const r=await orphans({files:[file('x')],...options});
    assert.equal(r.status,503);assert.equal(r.body.ok,false);assert.equal(r.body.candidates,undefined);
  }
  for(const body of [{action:'photo-orphans'},{action:'photo-orphans',dry_run:false},{action:'photo-orphans',dry_run:true,x:1}]){
    const r=await run({files:[file('x')]},body);assert.equal(r.status,400);assert.equal(r.calls.drive.length,0);
  }
});
