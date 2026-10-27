import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Real library-files photo handler + shared Drive code. Only the Supabase SDK and the
// Google HTTP boundary are modeled; no production access.
const WS='10000000-0000-4000-8000-000000000001';
const DOC='30000000-0000-4000-8000-000000000001';
const PDF='30000000-0000-4000-8000-000000000002';
const NOFILE='30000000-0000-4000-8000-000000000003';
const OTHER='30000000-0000-4000-8000-000000000004';
const JPEG=new Uint8Array([0xff,0xd8,0xff,0xd9]);
const rows=()=>[
  {id:DOC,workspace_id:WS,file_id:'p1',mime_type:'image/jpeg'},
  {id:PDF,workspace_id:WS,file_id:'d1',mime_type:'application/pdf'},
  {id:NOFILE,workspace_id:WS,file_id:null,mime_type:'image/jpeg'},
  {id:OTHER,workspace_id:'other-workspace',file_id:'x1',mime_type:'image/jpeg'},
];

function harness(options={}){
  const calls={admin:[],user:[],drive:[],logs:[],userClients:[]};
  const docs=options.docs??rows();
  const files=new Map(Object.entries(options.files??{
    p1:{id:'p1',mimeType:'image/jpeg',ownedByMe:true,trashed:false,size:'3',thumbnailLink:'https://lh3.googleusercontent.com/drive-storage/synthetic=s220'},
    d1:{id:'d1',mimeType:'application/pdf',ownedByMe:true,trashed:false,size:'3'},
  }));
  const admin={auth:{getUser:async()=>({data:{user:{id:'synthetic-owner'}},error:null})},from:table=>{
    const q={table,mutation:null};calls.admin.push(q);
    const b={select:()=>b,eq:()=>b,is:()=>b,update:()=>{q.mutation='update';return b;},insert:()=>{q.mutation='insert';return b;},
      upsert:()=>{q.mutation='upsert';return b;},delete:()=>{q.mutation='delete';return b;},maybeSingle:async()=>exec(),single:async()=>exec(),then:(r,e)=>exec().then(r,e)};
    async function exec(){
      if(table==='public_policy_drive_config')return options.tokenMissing?{data:null,error:{message:'x'}}:{data:{google_client_id:'c',google_client_secret:'s',google_refresh_token:'r'},error:null};
      throw new Error('admin must not touch '+table);
    }
    return b;
  }};
  const userClient=authorization=>{
    calls.userClients.push(authorization);
    if(options.noUserClient)throw new Error('ANON key missing');
    return {from:table=>{
      const q={table,filters:[],method:'select'};calls.user.push(q);
      const b={select:()=>b,eq:(k,v)=>{q.filters.push([k,v]);return b;},delete:()=>{q.method='delete';return b;},update:()=>{q.method='update';return b;},
        maybeSingle:async()=>{
          if(table!=='app_documents')throw new Error('unexpected user table '+table);
          if(options.lookupError)return {data:null,error:{message:'synthetic-secret'}};
          // RLS model: the signed-in owner sees only its own workspace rows.
          const row=docs.find(r=>r.workspace_id===WS&&q.filters.every(([k,v])=>r[k]===v));
          return {data:row?structuredClone(row):null,error:null};
        }};
      return b;
    }};
  };
  const fetch=async(url,init={})=>{
    const u=new URL(url),method=init.method||'GET';
    calls.drive.push({method,host:u.hostname,path:u.pathname,search:u.search});
    const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(u.hostname==='oauth2.googleapis.com')return send({access_token:'synthetic-drive-token'});
    if(u.hostname==='lh3.googleusercontent.com')return new Response(JPEG,{headers:{'Content-Type':'image/jpeg'}});
    const id=decodeURIComponent(u.pathname.split('/').at(-1));
    if(method==='GET'&&u.searchParams.get('alt')==='media')return new Response(JPEG,{headers:{'Content-Type':'image/jpeg'}});
    if(method==='GET'){const f=files.get(id);return f?send(f):send({error:'notFound'},404);}
    return send({error:'unexpected'},500);
  };
  return {calls,fetch,admin,userClient};
}
async function run(options={},query={},{auth='Bearer synthetic-user-token',workspace=WS}={}){
  const h=harness(options);
  const {createLibraryPhotoHandler}=await import('../../supabase/functions/library-files/photo.ts');
  const handler=createLibraryPhotoHandler(h.admin,{fetch:h.fetch,log:c=>h.calls.logs.push(c),userClient:h.userClient});
  const params=new URLSearchParams({action:'photo',document_id:DOC,size:'small',...query});
  const response=await handler(new Request('https://synthetic.invalid/functions/v1/library-files?'+params),workspace,auth);
  const type=response.headers.get('content-type')||'';
  const body=type.startsWith('application/json')?await response.json():new Uint8Array(await response.arrayBuffer());
  return {...h,status:response.status,headers:response.headers,body};
}
const driveReads=calls=>calls.drive.filter(c=>c.host!=='oauth2.googleapis.com');

test('owner gets the reduced Drive thumbnail of an image document, cached privately',async()=>{
  for(const [size,px] of [['small','480'],['large','1600']]){
    const r=await run({},{size});
    assert.equal(r.status,200);
    assert.equal(r.headers.get('content-type'),'image/jpeg');
    assert.equal(r.headers.get('cache-control'),'private, max-age=3600');
    assert.deepEqual([...r.body],[...JPEG]);
    assert.equal(r.calls.drive.find(c=>c.host==='lh3.googleusercontent.com').path,'/drive-storage/synthetic=s'+px);
    // The row is read with the caller JWT and the server-side owner workspace.
    assert.deepEqual(r.calls.userClients,['Bearer synthetic-user-token']);
    assert.deepEqual(r.calls.user[0].filters,[['id',DOC],['workspace_id',WS]]);
  }
});

test('a request-supplied Drive file id is never used: the id comes from the document row',async()=>{
  const r=await run({},{file_id:'d1'});
  assert.equal(r.status,200);
  assert.deepEqual(driveReads(r.calls).map(c=>c.path).filter(p=>p.startsWith('/drive/v3/files/')),['/drive/v3/files/p1']);
});

test('another workspace document, a missing document and a non-image are refused',async()=>{
  const other=await run({},{document_id:OTHER});
  assert.equal(other.status,404);assert.equal(other.body.code,'document_not_found');assert.equal(other.calls.drive.length,0);
  const missing=await run({},{document_id:'30000000-0000-4000-8000-0000000000ff'});
  assert.equal(missing.status,404);assert.equal(missing.calls.drive.length,0);
  const pdf=await run({},{document_id:PDF});
  assert.equal(pdf.status,415);assert.equal(pdf.body.code,'photo_not_image');assert.equal(pdf.calls.drive.length,0);
  const nofile=await run({},{document_id:NOFILE});
  assert.equal(nofile.status,404);assert.equal(nofile.calls.drive.length,0);
  // Row says image but Drive says otherwise (or trashed / not mine): still refused.
  for(const f of [{mimeType:'application/pdf'},{trashed:true},{ownedByMe:false}]){
    const r=await run({files:{p1:{id:'p1',mimeType:'image/jpeg',ownedByMe:true,trashed:false,size:'3',...f}}});
    assert.equal(r.status,404);assert.equal(r.body.code,'photo_not_found');
  }
});

test('bad requests are refused before any lookup',async()=>{
  for(const q of [{document_id:'not-a-uuid'},{document_id:''},{size:'huge'}]){
    const r=await run({},q);
    assert.equal(r.status,400);assert.equal(r.body.code,'photo_request_invalid');
    assert.equal(r.calls.user.length+r.calls.drive.length,0);
  }
});

test('lookup failure and missing anon configuration end before Drive; errors carry fixed codes only',async()=>{
  const lookup=await run({lookupError:true});
  assert.equal(lookup.status,503);assert.equal(lookup.calls.drive.length,0);
  assert.deepEqual(Object.keys(lookup.body).sort(),['action','code','ok']);
  assert.equal(lookup.headers.get('cache-control'),'no-store');
  const anon=await run({noUserClient:true});assert.equal(anon.status,503);assert.equal(anon.calls.drive.length,0);
  const token=await run({tokenMissing:true});assert.equal(token.status,503);
});

test('the photo view never writes: no Drive mutation, no admin document access, no DB write',async()=>{
  for(const options of [{},{lookupError:true},{noUserClient:true},{tokenMissing:true}]){
    const r=await run(options);
    assert.equal(r.calls.drive.some(c=>c.method!=='GET'&&c.host!=='oauth2.googleapis.com'),false);
    assert.equal(r.calls.admin.some(q=>q.table==='app_documents'||q.mutation),false);
    assert.equal(r.calls.user.some(q=>q.method!=='select'),false);
  }
});

test('library-files index: photo branch sits behind the same login and owner checks; other methods stay refused',async()=>{
  const src=await readFile(new URL('../../supabase/functions/library-files/index.ts',import.meta.url),'utf8');
  const serve=src.slice(src.indexOf('Deno.serve('));
  const user=serve.indexOf('await getUser(req)'),owner=serve.indexOf('await workspaceFor(user.id)'),
    view=serve.indexOf('await photoView('),post=serve.indexOf("req.method!=='POST'");
  assert.ok(user>0&&user<owner&&owner<view&&view<post,'getUser -> workspaceFor -> photoView -> POST only');
  assert.match(serve,/req\.method==='GET'&&new URL\(req\.url\)\.searchParams\.get\('action'\)==='photo'/);
  assert.match(serve,/POST only/);
  // The photo path adds no service-role read of documents and no new secret.
  assert.equal(/photoView[\s\S]{0,200}admin\.from\('app_documents'\)/.test(serve),false);
});
