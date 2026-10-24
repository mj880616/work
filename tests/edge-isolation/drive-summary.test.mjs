import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkDriveSummaryIsolation} from '../../scripts/check-drive-summary-isolation.mjs';

test('functions-only deployment copy passes Deno check and bundle for the real drive-summary graph',{timeout:120000},async()=>{
  const result=await checkDriveSummaryIsolation();
  assert.equal(result.modules,12); // 바구니 원문 제거로 9 -> 8, LIB-글자채우기야간 text-backfill.mjs·_shared/document-text.ts로 8 -> 10, LIB-스캔글자읽기 _shared/drive-ocr.ts·basket-ocr-text.mjs로 10 -> 12
  assert.ok(result.bundleBytes>0);
});

async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'drive-summary-import-probe-'));
  try{
    await mkdir(join(root,'supabase','functions','drive-summary'),{recursive:true});
    await mkdir(join(root,'app'));
    await writeFile(join(root,'app','external.mjs'),'export const external=1;\n');
    return await run(root);
  }finally{await rm(root,{recursive:true,force:true});}
}

for(const dynamic of [false,true]){
  test(`isolated deployment rejects an outside relative ${dynamic?'dynamic':'static'} import even when the repository source exists`,async()=>fixture(async root=>{
    await writeFile(join(root,'supabase','functions','drive-summary','index.ts'),dynamic?"await import('../../../app/external.mjs');\n":"import '../../../app/external.mjs';\n");
    await assert.rejects(checkDriveSummaryIsolation({root}),/Import outside supabase\/functions/);
  }));
}

test('isolated deployment rejects a copied symlink to a file outside functions',async()=>fixture(async root=>{
  const dir=join(root,'supabase','functions','drive-summary');
  await symlink(join(root,'app','external.mjs'),join(dir,'external.mjs'));
  await writeFile(join(dir,'index.ts'),"import './external.mjs';\n");
  await assert.rejects(checkDriveSummaryIsolation({root}),/Import outside supabase\/functions/);
}));


test('functions-only copy preserves valid internal relative symlinks like deployment cp -R',async()=>fixture(async root=>{
  const dir=join(root,'supabase','functions','drive-summary');
  await writeFile(join(dir,'local.mjs'),'export const local=1;\n');
  await symlink('./local.mjs',join(dir,'internal.mjs'));
  await writeFile(join(dir,'index.ts'),"import {local} from './internal.mjs'; export const value=local;\n");
  const result=await checkDriveSummaryIsolation({root});assert.ok(result.bundleBytes>0);
}));

// OPS-수집점검: the functions-only copy (as deployed) answers GET ?action=status under Deno with no network permission.
// The probe injects a fake fetcher; every Drive/DB call is recorded so the test proves the read never writes.
test('functions-only copy serves the owner status read under Deno without any write',{timeout:120000},async()=>{
  const {spawnSync}=await import('node:child_process');
  const {cp}=await import('node:fs/promises');
  const isolated=await mkdtemp(join(tmpdir(),'drive-summary-status-'));
  try{
    const functions=join(isolated,'supabase','functions');
    await mkdir(join(isolated,'supabase'),{recursive:true});
    await cp(new URL('../../supabase/functions',import.meta.url),functions,{recursive:true,verbatimSymlinks:true});
    await writeFile(join(isolated,'probe.mjs'),`
import {createHandler} from './supabase/functions/drive-summary/core.mjs';
const calls=[];
const fetcher=async(input,init={})=>{const url=new URL(input),method=init.method||'GET';calls.push(method+' '+url.hostname+url.pathname);
  const reply=d=>Response.json(d);
  if(url.pathname==='/auth/v1/user')return init.headers.Authorization==='Bearer owner'?reply({id:'u'}):Response.json({},{status:401});
  if(url.pathname.endsWith('/app_workspaces'))return reply([{id:'ws'}]);
  if(url.pathname.endsWith('/app_workspace_members'))return reply([{user_id:'u',role:'owner'}]);
  if(url.pathname.endsWith('/public_policy_drive_config'))return reply([{google_client_id:'c',google_client_secret:'s',google_refresh_token:'r'}]);
  if(url.hostname==='oauth2.googleapis.com')return reply({access_token:'a'});
  if(url.pathname.endsWith('/permissions'))return reply({permissions:[{type:'user',role:'owner'}]});
  if(url.searchParams.has('q'))return reply({files:[{id:'f',appProperties:{last_success_at:'2026-10-21T04:17:00.000Z',name:'SECRET_NAME'}}]});
  throw new Error('unexpected '+method+' '+url);};
const h=createHandler({env:{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'k'},fetcher,now:()=>new Date('2026-10-21T05:00:00Z')});
const ok=await h(new Request('https://edge.test/drive-summary?action=status',{headers:{Authorization:'Bearer owner'}}));
const anon=await h(new Request('https://edge.test/drive-summary?action=status'));
console.log(JSON.stringify({status:ok.status,body:await ok.json(),anon:anon.status,calls}));
`);
    const r=spawnSync(process.env.DENO_BIN||'deno',['run','--no-config','--no-prompt','probe.mjs'],{cwd:isolated,encoding:'utf8',timeout:60000});
    if(r.error)throw r.error;
    assert.equal(r.status,0,r.stderr);
    const out=JSON.parse(r.stdout.trim().split('\n').at(-1));
    assert.equal(out.status,200);assert.equal(out.anon,401);
    assert.deepEqual(out.body.copy,{state:'found',last_success_at:'2026-10-21T04:17:00.000Z',last_failure_at:null,last_failure_code:null});
    assert.doesNotMatch(JSON.stringify(out.body),/SECRET_NAME/);
    assert.ok(out.calls.every(c=>c.startsWith('GET ')||c==='POST oauth2.googleapis.com/token'),out.calls.join('\n'));
  }finally{await rm(isolated,{recursive:true,force:true});}
});

// OPS-수집점검 2단계: the functions-only copy takes a collector heartbeat under Deno and writes only folder properties.
test('functions-only copy records a collector heartbeat under Deno with only one folder-property PATCH',{timeout:120000},async()=>{
  const {spawnSync}=await import('node:child_process');
  const {cp}=await import('node:fs/promises');
  const isolated=await mkdtemp(join(tmpdir(),'drive-summary-heartbeat-'));
  try{
    const functions=join(isolated,'supabase','functions');
    await mkdir(join(isolated,'supabase'),{recursive:true});
    await cp(new URL('../../supabase/functions',import.meta.url),functions,{recursive:true,verbatimSymlinks:true});
    await writeFile(join(isolated,'probe.mjs'),`
import {createHandler} from './supabase/functions/drive-summary/core.mjs';
const calls=[],bodies=[];
const fetcher=async(input,init={})=>{const url=new URL(input),method=init.method||'GET';calls.push(method+' '+url.hostname+url.pathname);
  const reply=d=>Response.json(d);
  if(url.pathname.endsWith('/public_policy_drive_config'))return reply([{google_client_id:'c',google_client_secret:'s',google_refresh_token:'r'}]);
  if(url.hostname==='oauth2.googleapis.com')return reply({access_token:'a'});
  if(url.pathname.endsWith('/permissions'))return reply({permissions:[{type:'user',role:'owner'}]});
  if(url.searchParams.has('q'))return reply({files:[{id:'f',appProperties:{last_success_at:'2026-10-21T04:17:00.000Z'}}]});
  if(method==='PATCH'){bodies.push(JSON.parse(init.body));return reply({id:'f'});}
  throw new Error('unexpected '+method+' '+url);};
const h=createHandler({env:{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'k',COLLECTOR_HEARTBEAT_SECRET:'beat'},fetcher,now:()=>new Date('2026-10-21T05:00:00Z')});
const body=JSON.stringify({source:'telegram',last_at:'2026-10-21T13:30:00+09:00'});
const ok=await h(new Request('https://edge.test/drive-summary?action=heartbeat',{method:'POST',headers:{'x-collector-heartbeat-secret':'beat'},body}));
const wrong=await h(new Request('https://edge.test/drive-summary?action=heartbeat',{method:'POST',headers:{'x-collector-heartbeat-secret':'nope'},body}));
console.log(JSON.stringify({status:ok.status,body:await ok.json(),wrong:wrong.status,calls,bodies}));
`);
    const r=spawnSync(process.env.DENO_BIN||'deno',['run','--no-config','--no-prompt','probe.mjs'],{cwd:isolated,encoding:'utf8',timeout:60000});
    if(r.error)throw r.error;
    assert.equal(r.status,0,r.stderr);
    const out=JSON.parse(r.stdout.trim().split('\n').at(-1));
    assert.equal(out.status,200);assert.equal(out.wrong,401);
    assert.deepEqual(out.body,{ok:true,source:'telegram',recorded_at:'2026-10-21T05:00:00.000Z'});
    assert.deepEqual(out.bodies,[{appProperties:{collector_telegram_at:'2026-10-21T04:30:00.000Z',collector_telegram_count:null,collector_telegram_reported_at:'2026-10-21T05:00:00.000Z'}}]);
    assert.deepEqual(out.calls.filter(c=>!c.startsWith('GET ')),['POST oauth2.googleapis.com/token','PATCH www.googleapis.com/drive/v3/files/f']);
    assert.ok(!out.calls.some(c=>c.includes('/upload/')||(c.includes('db.test')&&!c.includes('public_policy_drive_config'))),out.calls.join('\n'));
  }finally{await rm(isolated,{recursive:true,force:true});}
});
