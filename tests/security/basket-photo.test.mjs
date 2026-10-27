import test from 'node:test';
import assert from 'node:assert/strict';

// Real basket-files handler + shared Drive code. Only the Supabase SDK and the
// Google HTTP boundary are modeled; no production access.
const WS='10000000-0000-4000-8000-000000000001';
const NOTE='20000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const attachment=(id,mime='image/jpeg')=>({drive_file_id:id,file_name:id+'.jpg',mime_type:mime,size_bytes:3});
const JPEG=new Uint8Array([0xff,0xd8,0xff,0xd9]);

function harness(options={}){
  const calls={admin:[],user:[],drive:[],logs:[],userClients:[]};
  const notes=options.notes??[{id:NOTE,workspace_id:WS,attachments:[attachment('p1'),attachment('d1','application/pdf')]},
    {id:OTHER,workspace_id:'other-workspace',attachments:[attachment('x1')]}];
  const files=new Map(Object.entries(options.files??{p1:{id:'p1',mimeType:'image/jpeg',ownedByMe:true,trashed:false,size:'3',thumbnailLink:'https://lh3.googleusercontent.com/drive-storage/synthetic=s220'}}));
  const admin={auth:{getUser:async()=>options.auth||{data:{user:{id:'synthetic-owner'}},error:null}},from:table=>{
    const q={table,mutation:null};calls.admin.push(q);
    const b={select:()=>b,eq:()=>b,is:()=>b,update:()=>{q.mutation='update';return b;},insert:()=>{q.mutation='insert';return b;},
      upsert:()=>{q.mutation='upsert';return b;},delete:()=>{q.mutation='delete';return b;},maybeSingle:async()=>exec(),single:async()=>exec(),then:(r,e)=>exec().then(r,e)};
    async function exec(){
      if(table==='app_workspace_members')return {data:options.role===null?null:{workspace_id:WS,role:options.role||'owner'},error:null};
      if(table==='public_policy_drive_config')return options.tokenMissing?{data:null,error:{message:'x'}}:{data:{google_client_id:'c',google_client_secret:'s',google_refresh_token:'r'},error:null};
      throw new Error('admin must not touch '+table);
    }
    return b;
  }};
  const userClient=authorization=>{
    calls.userClients.push(authorization);
    if(options.noUserClient)throw new Error('ANON key missing');
    return {rpc:async()=>{throw new Error('no rpc');},from:table=>{
      const q={table,filters:[],method:'select'};calls.user.push(q);
      const b={select:()=>b,eq:(k,v)=>{q.filters.push([k,v]);return b;},delete:()=>{q.method='delete';return b;},update:()=>{q.method='update';return b;},
        maybeSingle:async()=>{
          if(table!=='app_notes')throw new Error('unexpected user table '+table);
          if(options.lookupError)return {data:null,error:{message:'synthetic-secret'}};
          // RLS model: the signed-in owner sees only its own workspace rows.
          const row=notes.find(r=>r.workspace_id===WS&&q.filters.every(([k,v])=>r[k]===v));
          return {data:row?structuredClone(row):null,error:null};
        }};
      return b;
    }};
  };
  const fetch=async(url,init={})=>{
    const u=new URL(url),method=init.method||'GET';
    calls.drive.push({method,host:u.hostname,path:u.pathname,search:u.search,auth:init.headers?.Authorization});
    const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(u.hostname==='oauth2.googleapis.com')return send({access_token:'synthetic-drive-token'});
    if(u.hostname==='lh3.googleusercontent.com'){
      if(options.thumb==='html')return new Response('<html>',{headers:{'Content-Type':'text/html'}});
      if(typeof options.thumb==='number')return new Response('x',{status:options.thumb});
      return new Response(JPEG,{headers:{'Content-Type':'image/jpeg'}});
    }
    const id=decodeURIComponent(u.pathname.split('/').at(-1));
    if(method==='GET'&&u.searchParams.get('alt')==='media')return new Response(JPEG,{headers:{'Content-Type':'image/jpeg'}});
    if(method==='GET'){const f=files.get(id);return f?send(f):send({error:'notFound'},404);}
    return send({error:'unexpected'},500);
  };
  return {calls,fetch,admin,userClient};
}
async function run(options={},query={},{auth='Bearer synthetic-user-token',method='GET'}={}){
  const h=harness(options);
  const {createBasketHandler}=await import('../../supabase/functions/basket-files/handler.ts');
  const handler=createBasketHandler(h.admin,{fetch:h.fetch,log:c=>h.calls.logs.push(c),userClient:h.userClient});
  const params=new URLSearchParams({action:'photo',note_id:NOTE,file_id:'p1',size:'small',...query});
  const response=await handler(new Request('https://synthetic.invalid/functions/v1/basket-files?'+params,{method,
    headers:auth?{Authorization:auth}:{}}));
  const type=response.headers.get('content-type')||'';
  const body=type.startsWith('application/json')?await response.json():new Uint8Array(await response.arrayBuffer());
  return {...h,status:response.status,headers:response.headers,body};
}
const driveReads=calls=>calls.drive.filter(c=>c.host!=='oauth2.googleapis.com');

test('owner gets the reduced Drive thumbnail of an attachment of the note, cached privately',async()=>{
  for(const [size,px] of [['small','480'],['large','1600']]){
    const r=await run({},{size});
    assert.equal(r.status,200);
    assert.equal(r.headers.get('content-type'),'image/jpeg');
    assert.equal(r.headers.get('cache-control'),'private, max-age=3600');
    assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual([...r.body],[...JPEG]);
    const thumb=r.calls.drive.find(c=>c.host==='lh3.googleusercontent.com');
    assert.equal(thumb.path,'/drive-storage/synthetic=s'+px);
    // The note is read with the caller JWT and the server-side owner workspace.
    assert.deepEqual(r.calls.userClients,['Bearer synthetic-user-token']);
    assert.deepEqual(r.calls.user[0].filters,[['id',NOTE],['workspace_id',WS]]);
  }
});

test('a fresh upload without a thumbnail falls back to the small original only',async()=>{
  const fresh={p1:{id:'p1',mimeType:'image/jpeg',ownedByMe:true,trashed:false,size:'3'}};
  const r=await run({files:fresh});
  assert.equal(r.status,200);
  assert.equal(r.calls.drive.find(c=>c.search==='?alt=media').path,'/drive/v3/files/p1');
  const big=await run({files:{p1:{...fresh.p1,size:String(6*1024*1024)}}});
  assert.equal(big.status,502);assert.equal(big.body.code,'photo_unavailable');
  assert.equal(big.calls.drive.some(c=>c.search==='?alt=media'),false);
});

test('missing session and non-owner are refused before any note or Drive read',async()=>{
  for(const [options,auth,status] of [[{},'',401],[{auth:{data:{user:null},error:{status:401}}},'Bearer bad',401],[{role:'member'},'Bearer x',403],[{role:null},'Bearer x',403]]){
    const r=await run(options,{},{auth});
    assert.equal(r.status,status);
    assert.equal(r.calls.user.length,0);assert.equal(r.calls.drive.length,0);
    assert.equal(r.headers.get('content-type')?.startsWith('image/'),false);
  }
});

test('another workspace note, a missing note and a file not in the note attachments are 404 without Drive',async()=>{
  for(const query of [{note_id:OTHER,file_id:'x1'},{note_id:'20000000-0000-4000-8000-000000000009'},{file_id:'x1'},{file_id:'zz'}]){
    const r=await run({},query);
    assert.equal(r.status,404);assert.match(r.body.code,/^(note|photo)_not_found$/);
    assert.equal(r.calls.drive.length,0);
  }
});

test('a non-image attachment, invalid input and a non-GET method are refused without Drive',async()=>{
  const pdf=await run({},{file_id:'d1'});
  assert.equal(pdf.status,415);assert.equal(pdf.body.code,'photo_not_image');assert.equal(pdf.calls.drive.length,0);
  for(const query of [{note_id:'not-a-uuid'},{file_id:'../etc'},{size:'huge'},{file_id:''}]){
    const r=await run({},query);
    assert.equal(r.status,400);assert.equal(r.body.code,'photo_request_invalid');
    assert.equal(r.calls.drive.length,0);assert.equal(r.calls.user.length,0);
  }
  // A POST with ?action=photo is not the photo view (multipart upload path rejects it).
  const post=await run({},{},{method:'POST'});
  assert.notEqual(post.status,200);assert.equal(driveReads(post.calls).length,0);
});

test('a trashed, foreign or non-image Drive file is 404 and a bad upstream image is 502',async()=>{
  const base={id:'p1',mimeType:'image/jpeg',ownedByMe:true,trashed:false,size:'3',thumbnailLink:'https://lh3.googleusercontent.com/t=s220'};
  for(const meta of [{...base,trashed:true},{...base,ownedByMe:false},{...base,mimeType:'text/html'},{...base,id:'other'}]){
    const r=await run({files:{p1:meta}});
    assert.equal(r.status,404);assert.equal(r.body.code,'photo_not_found');
    assert.equal(r.calls.drive.some(c=>c.host==='lh3.googleusercontent.com'),false);
  }
  const gone=await run({files:{}});
  assert.equal(gone.status,404);
  for(const thumb of ['html',403,500]){
    const r=await run({thumb});
    assert.equal(r.status,502);assert.equal(r.body.code,'photo_unavailable');
  }
  // A thumbnail link outside Google user content is never fetched with the Drive token.
  const odd=await run({files:{p1:{...base,size:String(6*1024*1024),thumbnailLink:'https://synthetic.example/t=s220'}}});
  assert.equal(odd.status,502);assert.equal(odd.calls.drive.some(c=>c.host==='synthetic.example'),false);
});

test('the photo view never writes: no Drive mutation, no admin note access, no DB write',async()=>{
  for(const options of [{},{thumb:500},{tokenMissing:true},{lookupError:true},{noUserClient:true}]){
    const r=await run(options);
    assert.equal(r.calls.drive.some(c=>c.method!=='GET'&&c.host!=='oauth2.googleapis.com'),false);
    assert.equal(r.calls.admin.some(q=>q.table==='app_notes'||q.table==='app_documents'||q.mutation),false);
    assert.equal(r.calls.user.some(q=>q.method!=='select'),false);
  }
  const lookup=await run({lookupError:true});assert.equal(lookup.status,503);assert.equal(lookup.calls.drive.length,0);
  const anon=await run({noUserClient:true});assert.equal(anon.status,503);assert.equal(anon.calls.drive.length,0);
  const token=await run({tokenMissing:true});assert.equal(token.status,503);
  // Errors carry fixed codes only: no Drive ids, tokens or upstream bodies.
  assert.deepEqual(Object.keys(token.body).sort(),['action','code','ok']);
  assert.equal(token.headers.get('cache-control'),'no-store');
});
