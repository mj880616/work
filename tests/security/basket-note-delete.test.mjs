import test from 'node:test';
import assert from 'node:assert/strict';
import {containsParam,jsonbContains} from './helpers/postgrest-jsonb.mjs';

// Real basket-files handler + shared Drive code. Only the Supabase SDK and the
// Google HTTP boundary are modeled; no production access.
const WS='10000000-0000-4000-8000-000000000001';
const NOTE='20000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const T1='2026-10-14T01:00:00.000Z',T2='2026-10-14T02:00:00.000Z';
const FOLDER='synthetic-folder';
const file=(id,extra={})=>({id,mimeType:'image/jpeg',ownedByMe:true,trashed:false,parents:[FOLDER],...extra});
const attachment=id=>({drive_file_id:id,file_name:id+'.jpg',mime_type:'image/jpeg',size_bytes:3});

function harness(options={}){
  const calls={admin:[],user:[],drive:[],logs:[],userClients:[]};
  const state={notes:structuredClone(options.notes??[{id:NOTE,workspace_id:WS,updated_at:T1,attachments:[attachment('a1'),attachment('a2')]}]),
    documents:structuredClone(options.documents??[]),files:new Map((options.files??[file('a1'),file('a2')]).map(f=>[f.id,structuredClone(f)]))};
  const folder={id:FOLDER,name:'Web2 바구니',mimeType:'application/vnd.google-apps.folder',ownedByMe:true,trashed:false,parents:['synthetic-root'],permissions:[{type:'user',role:'owner'}]};
  const admin={auth:{getUser:async()=>options.auth||{data:{user:{id:'synthetic-owner'}},error:null}},from:table=>{
    const q={table,filters:[],mutation:null};calls.admin.push(q);
    const b={select:()=>b,eq:(k,v)=>{q.filters.push([k,v]);return b;},is:(k,v)=>{q.filters.push([k,v]);return b;},
      update:p=>{q.mutation='update';return b;},insert:()=>{q.mutation='insert';return b;},upsert:()=>{q.mutation='upsert';return b;},delete:()=>{q.mutation='delete';return b;},
      maybeSingle:async()=>exec(),single:async()=>exec(),then:(r,e)=>exec().then(r,e)};
    async function exec(){
      if(table==='app_workspace_members')return {data:options.role===null?null:{workspace_id:WS,role:options.role||'owner'},error:null};
      if(table==='public_policy_drive_config')return options.tokenMissing?{data:null,error:{message:'x'}}:{data:{google_client_id:'c',google_client_secret:'s',google_refresh_token:'r'},error:null};
      if(table==='app_drive_settings')return {data:options.noFolderSetting?{basket_folder_id:null}:{basket_folder_id:FOLDER},error:null};
      throw new Error('admin must not touch '+table);
    }
    return b;
  }};
  const userClient=authorization=>{
    calls.userClients.push(authorization);
    if(options.noUserClient)throw new Error('ANON key missing');
    return {rpc:async()=>({data:null,error:{message:'unused'}}),from:table=>{
      const q={table,filters:[],method:'select',limit:null};calls.user.push(q);
      const b={select:()=>b,eq:(k,v)=>{q.filters.push(['eq',k,v]);return b;},neq:(k,v)=>{q.filters.push(['neq',k,v]);return b;},
        in:(k,v)=>{q.filters.push(['in',k,v]);return b;},contains:(k,v)=>{q.filters.push(['contains',k,containsParam(v)]);return b;},limit:n=>{q.limit=n;return b;},
        delete:()=>{q.method='delete';return b;},maybeSingle:async()=>exec(true),then:(r,e)=>exec(false).then(r,e)};
      async function exec(single){
        await options.beforeUser?.(q,state);
        const rows=table==='app_notes'?state.notes:table==='app_documents'?state.documents:null;
        if(!rows)throw new Error('unexpected user table '+table);
        if(q.method==='select'&&table==='app_notes'&&options.lookupError?.(q,calls))return {data:null,error:{message:'synthetic-secret'}};
        if(q.method==='select'&&table==='app_documents'&&options.documentsError)return {data:null,error:{message:'synthetic-secret'}};
        // RLS model: the signed-in owner sees only its own workspace rows.
        let visible=rows.filter(r=>(r.workspace_id??WS)===WS&&q.filters.every(([op,k,v])=>op==='eq'?r[k]===v:op==='neq'?r[k]!==v:op==='in'?v.includes(r[k]):true));
        for(const [op,k,v] of q.filters)if(op==='contains'){const m=jsonbContains(visible,k,v);if(m.error)return {data:null,error:m.error};visible=m.rows;}
        if(q.method==='delete'){
          if(options.deleteThrows)throw new Error('lost');
          if(options.deleteError){if(options.deleteCommits)state.notes=state.notes.filter(r=>!visible.includes(r));return {data:null,error:{code:'42501',message:'synthetic-secret'}};}
          state.notes=state.notes.filter(r=>!visible.includes(r));return {data:visible.map(r=>({id:r.id})),error:null};
        }
        const out=structuredClone(q.limit?visible.slice(0,q.limit):visible);
        return {data:single?(out[0]??null):out,error:null};
      }
      return b;
    }};
  };
  const fetch=async(url,init={})=>{
    const u=new URL(url),method=init.method||'GET';calls.drive.push({method,path:u.pathname,search:u.search,body:init.body});
    const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(u.hostname==='oauth2.googleapis.com')return send({access_token:'synthetic-drive-token'});
    if(u.pathname==='/drive/v3/files'&&method==='GET')return send({files:[folder]});
    const id=decodeURIComponent(u.pathname.split('/').at(-1));
    if(id===FOLDER&&method==='GET')return send(folder);
    if(method==='GET'){if(options.getThrows?.includes(id))throw new Error('net');const f=state.files.get(id);return f?send(f):send({error:'notFound'},404);}
    if(method==='PATCH'){
      const outcome=options.patch?.[id];
      if(outcome==='throw')throw new Error('net');
      if(typeof outcome==='number')return send({error:'synthetic-secret'},outcome);
      const f=state.files.get(id);f.trashed=JSON.parse(init.body).trashed;return send({id,trashed:f.trashed});
    }
    return send({error:'unexpected'},500);
  };
  return {calls,state,fetch,admin,userClient};
}
async function run(options={},body={action:'note-delete',note_id:NOTE,note_updated_at:T1},{auth='Bearer synthetic-user-token',query='?action=note-delete',raw}={}){
  const h=harness(options);
  const {createBasketHandler}=await import('../../supabase/functions/basket-files/handler.ts');
  const handler=createBasketHandler(h.admin,{fetch:h.fetch,log:c=>h.calls.logs.push(c),userClient:h.userClient});
  const response=await handler(new Request('https://synthetic.invalid/functions/v1/basket-files'+query,{method:'POST',
    headers:{...(auth?{Authorization:auth}:{}),'Content-Type':'application/json'},body:raw??JSON.stringify(body)}));
  return {...h,status:response.status,body:await response.json()};
}
const writes=calls=>calls.drive.filter(c=>c.method!=='GET'&&!c.path.startsWith('/token')&&c.path!=='/token');
const patches=calls=>calls.drive.filter(c=>c.method==='PATCH');

test('owner delete trashes each attachment, then deletes the note with the caller JWT',async()=>{
  const r=await run();
  assert.equal(r.status,200);
  assert.deepEqual(r.body,{action:'note-delete',note_id:NOTE,attachments_total:2,trashed:2,failed:0,unknown:0,ok:true,note_deleted:true});
  assert.deepEqual(patches(r.calls).map(c=>[c.path,JSON.parse(c.body)]),[['/drive/v3/files/a1',{trashed:true}],['/drive/v3/files/a2',{trashed:true}]]);
  assert.equal(r.state.notes.length,0);assert.equal(r.state.files.get('a1').trashed,true);
  assert.deepEqual(r.calls.userClients,['Bearer synthetic-user-token']);
  const del=r.calls.user.find(q=>q.method==='delete');
  assert.deepEqual(del.filters,[['eq','id',NOTE],['eq','workspace_id',WS],['eq','updated_at',T1]]);
  // Trash happens before the note delete.
  assert.ok(r.calls.user.indexOf(del)===r.calls.user.length-1);
});

test('the other-note reference check sends PostgREST jsonb JSON text (attachments=cs.[{...}]), not an array literal',async()=>{
  const r=await run();
  const sent=r.calls.user.filter(q=>q.table==='app_notes').flatMap(q=>q.filters.filter(f=>f[0]==='contains'));
  assert.deepEqual(sent,[['contains','attachments','cs.[{"drive_file_id":"a1"}]'],['contains','attachments','cs.[{"drive_file_id":"a2"}]']]);
  assert.equal(r.calls.logs.includes('note_delete_drive_unavailable'),false);
});

test('no permanent Drive DELETE and no service_role note read or delete on any path',async()=>{
  for(const options of [{},{patch:{a1:500}},{patch:{a2:'throw'}},{files:[file('a1',{parents:['elsewhere']})]},{deleteError:true},{tokenMissing:true}]){
    const r=await run(options);
    assert.equal(r.calls.drive.some(c=>c.method==='DELETE'),false);
    assert.equal(r.calls.admin.some(q=>q.table==='app_notes'||q.table==='app_documents'||q.mutation==='delete'),false);
    assert.deepEqual(writes(r.calls).filter(c=>c.method!=='PATCH').map(c=>c.method),[]);
  }
});

test('non-owner, missing session and another workspace note are refused before Drive',async()=>{
  for(const [options,auth,status] of [[{role:'member'},'Bearer x',403],[{role:null},'Bearer x',403],[{},'',401],[{auth:{data:{user:null},error:{status:401}}},'Bearer bad',401]]){
    const r=await run(options,undefined,{auth});
    assert.equal(r.status,status);assert.equal(r.calls.drive.length,0);assert.equal(r.calls.user.length,0);
  }
  const other=await run({notes:[{id:NOTE,workspace_id:'other-workspace',updated_at:T1,attachments:[attachment('a1')]}]});
  assert.equal(other.status,404);assert.equal(other.body.code,'note_not_found');assert.equal(other.body.note_deleted,false);
  assert.equal(other.calls.drive.length,0);assert.equal(other.state.notes.length,1);
});

test('a file outside the basket folder, not app-visible, a folder, or referenced elsewhere is skipped and counted as failed',async()=>{
  const r=await run({
    notes:[{id:NOTE,workspace_id:WS,updated_at:T1,attachments:['in','out','gone','dir','doc','shared','owned'].map(attachment)},
      {id:OTHER,workspace_id:WS,updated_at:T1,attachments:[attachment('shared')]}],
    documents:[{workspace_id:WS,file_id:'doc'}],
    files:[file('in'),file('out',{parents:['another-folder']}),file('dir',{mimeType:'application/vnd.google-apps.folder'}),file('doc'),file('shared'),file('owned',{ownedByMe:false})],
  });
  assert.equal(r.status,200);assert.equal(r.body.note_deleted,true);
  assert.deepEqual([r.body.trashed,r.body.failed,r.body.unknown],[1,6,0]);
  assert.deepEqual(patches(r.calls).map(c=>c.path),['/drive/v3/files/in']);
  assert.deepEqual(r.state.notes.map(n=>n.id),[OTHER]);
});

test('partial trash failure still deletes the note and reports counts; unknown is never retried',async()=>{
  const r=await run({notes:[{id:NOTE,workspace_id:WS,updated_at:T1,attachments:['a1','a2','a3','a4'].map(attachment)}],
    files:['a1','a2','a3','a4'].map(id=>file(id)),patch:{a2:403,a3:'throw',a4:502}});
  assert.equal(r.status,200);assert.equal(r.body.note_deleted,true);
  assert.deepEqual([r.body.trashed,r.body.failed,r.body.unknown],[1,1,2]);
  for(const id of ['a3','a4'])assert.equal(patches(r.calls).filter(c=>c.path.endsWith('/'+id)).length,1);
  assert.equal(r.state.notes.length,0);
});

test('already trashed attachment is counted as trashed without a second PATCH',async()=>{
  const r=await run({files:[file('a1',{trashed:true}),file('a2')]});
  assert.deepEqual([r.body.trashed,r.body.failed],[2,0]);assert.deepEqual(patches(r.calls).map(c=>c.path),['/drive/v3/files/a2']);
});

test('Drive unavailable or no stored basket folder: nothing trashed, note still deleted',async()=>{
  for(const options of [{tokenMissing:true},{noFolderSetting:true},{documentsError:true}]){
    const r=await run(options);
    assert.equal(r.status,200);assert.deepEqual([r.body.trashed,r.body.failed,r.body.note_deleted],[0,2,true]);
    assert.equal(patches(r.calls).length,0);
    assert.equal(r.calls.drive.some(c=>c.method==='POST'&&c.path==='/drive/v3/files'),false);
  }
});

test('stale updated_at changes nothing; a change during trashing is reported, not overwritten',async()=>{
  const stale=await run({},{action:'note-delete',note_id:NOTE,note_updated_at:T2});
  assert.equal(stale.status,409);assert.equal(stale.body.code,'note_changed');assert.equal(stale.calls.drive.length,0);
  assert.equal(stale.calls.user.some(q=>q.method==='delete'),false);
  const raced=await run({beforeUser:(q,state)=>{if(q.method==='delete')state.notes[0].updated_at=T2;}});
  assert.equal(raced.status,409);assert.deepEqual([raced.body.code,raced.body.note_deleted,raced.body.trashed],['note_changed',false,2]);
  assert.equal(raced.state.notes.length,1);
});

test('concurrent delete of the same note reports missing; delete errors are read back',async()=>{
  const concurrent=await run({beforeUser:(q,state)=>{if(q.method==='delete')state.notes=[];}});
  assert.equal(concurrent.status,404);assert.equal(concurrent.body.code,'note_not_found');assert.equal(concurrent.body.note_deleted,false);
  const committed=await run({deleteError:true,deleteCommits:true});
  assert.equal(committed.status,200);assert.equal(committed.body.note_deleted,true);
  const refused=await run({deleteError:true});
  assert.equal(refused.status,500);assert.equal(refused.body.code,'note_delete_failed');assert.equal(refused.state.notes.length,1);
  let reads=0;
  const unknown=await run({deleteThrows:true,lookupError:q=>q.table==='app_notes'&&++reads>1&&!q.limit});
  assert.equal(unknown.status,503);assert.deepEqual([unknown.body.code,unknown.body.note_deleted,unknown.body.trashed],['note_delete_result_unknown',false,2]);
});

test('input validation, unknown keys and body size limit refuse before any read',async()=>{
  for(const body of [{action:'note-delete',note_id:'bad',note_updated_at:T1},{action:'note-delete',note_id:NOTE},{action:'note-delete',note_id:NOTE,note_updated_at:T1,drive_file_id:'x'},{action:'ocr-read',note_id:NOTE,note_updated_at:T1}]){
    const r=await run({},body);assert.equal(r.status,400);assert.equal(r.body.code,'note_delete_invalid');assert.equal(r.calls.user.length,0);
  }
  const big=await run({},null,{raw:JSON.stringify({action:'note-delete',note_id:NOTE,note_updated_at:T1,pad:'x'.repeat(5000)})});
  assert.equal(big.status,413);assert.equal(big.body.code,'note_delete_request_too_large');
  const noClient=await run({noUserClient:true});
  assert.equal(noClient.status,503);assert.equal(noClient.body.code,'note_delete_unavailable');assert.equal(noClient.calls.drive.length,0);
});

test('invalid attachment state and no-attachment note',async()=>{
  const bad=await run({notes:[{id:NOTE,workspace_id:WS,updated_at:T1,attachments:[attachment('a1'),attachment('a1')]}]});
  assert.equal(bad.status,409);assert.equal(bad.body.code,'note_state_invalid');assert.equal(bad.calls.drive.length,0);
  const empty=await run({notes:[{id:NOTE,workspace_id:WS,updated_at:T1,attachments:[]}]});
  assert.equal(empty.status,200);assert.deepEqual([empty.body.attachments_total,empty.body.note_deleted],[0,true]);assert.equal(empty.calls.drive.length,0);
});

test('responses never carry folder ids, tokens or Drive error bodies',async()=>{
  for(const options of [{},{patch:{a1:500}}]){
    const r=await run(options);assert.doesNotMatch(JSON.stringify(r.body),/synthetic-folder|synthetic-drive-token|synthetic-secret/);
    assert.ok(r.calls.logs.every(c=>/^[a-z_]+$/.test(c)));
  }
});

test('JSON POST without the note-delete query still goes to OCR (old shape kept)',async()=>{
  const r=await run({},{action:'note-delete',note_id:NOTE,note_updated_at:T1},{query:''});
  assert.equal(r.status,400);assert.equal(r.body.code,'OCR_REQUEST_INVALID');assert.equal(Object.hasOwn(r.body,'action'),false);
  assert.equal(r.calls.drive.length,0);assert.equal(r.state.notes.length,1);
});
