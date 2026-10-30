import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

// Execute the deployment source in real Deno. Only the SDK import and remote providers
// are synthetic; production handler, authorization, PATCH construction and normalization run.
const source=await readFile(new URL('../../supabase/functions/google-calendar/index.ts',import.meta.url),'utf8');
const sdk=`export function createClient(){return {auth:{getUser:async()=>({data:{user:{id:'fixture-owner'}},error:null})},from:table=>{const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:async()=>table==='app_workspace_members'?{data:{workspace_id:'fixture-workspace',role:'owner'},error:null}:({data:{access_token:'synthetic-provider',token_expires_at:new Date(Date.now()+3600000).toISOString()},error:null}),then:resolve=>resolve({data:[],error:null})};return q}}}`;
const runner=`let handler;Deno.serve=fn=>{handler=fn};const calls=[];let current={id:'event-1',summary:'Existing',location:'Old venue',start:{date:'2026-10-15'},end:{date:'2026-10-16'}};
globalThis.fetch=async(raw,init={})=>{const u=new URL(raw),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({path:u.pathname,method,body});const response=x=>new Response(JSON.stringify(x));if(u.pathname.endsWith('/calendarList'))return response({items:[{id:'source',accessRole:'owner'},{id:'target',accessRole:'writer'}]});if(u.pathname.endsWith('/colors'))return response({event:{}});if(u.pathname.endsWith('/move'))return response(current);if(u.pathname.endsWith('/events/event-1')){if(method==='PATCH')current={...current,...body};return response(current)}throw Error('Unexpected provider request')};
await import('./index.ts');const mode=Deno.args[0],body={action:'update-event',calendar_id:'source',event_id:'event-1',title:'Changed',memo:'Memo',all_day:true,start_date:'2026-10-15',end_date:'2026-10-15',...(mode.startsWith('move')?{target_calendar_id:'target'}:{}),...(mode.endsWith('set')?{location:'New venue'}:mode.endsWith('clear')?{location:''}:{})};
const r=await handler(new Request('https://fixture.invalid/functions/v1/google-calendar',{method:'POST',headers:mode==='anonymous'?{}:{Authorization:'Bearer synthetic-owner'},body:JSON.stringify(body)}));console.log(JSON.stringify({status:r.status,result:await r.json(),calls}));`;
for(const mode of ['set','clear','absent','move-set','move-absent','anonymous'])test('real Deno provider location contract: '+mode,async()=>{
  const root=await mkdtemp(join(tmpdir(),'calendar-location-deno-'));
  try{
    await Promise.all([writeFile(join(root,'index.ts'),source),writeFile(join(root,'sdk.ts'),sdk),writeFile(join(root,'runner.mjs'),runner),writeFile(join(root,'imports.json'),JSON.stringify({imports:{'npm:@supabase/supabase-js@2':'./sdk.ts'}}))]);
    const run=spawnSync('deno',['run','--no-remote','--allow-read','--allow-env=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_ANON_KEY','--import-map='+join(root,'imports.json'),join(root,'runner.mjs'),mode],{encoding:'utf8',env:{...process.env,SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-public'}});
    assert.equal(run.status,0,run.stderr||String(run.error));const out=JSON.parse(run.stdout.trim());
    if(mode==='anonymous'){assert.equal(out.status,401);assert.deepEqual(out.calls,[]);return}
    assert.equal(out.status,200);assert.equal(out.result.ok,true);assert.equal(out.result.event.calendarId,mode.startsWith('move')?'target':'source');
    const patch=out.calls.find(c=>c.method==='PATCH'&&c.body.summary);assert.ok(patch);
    if(mode.endsWith('set')){assert.equal(patch.body.location,'New venue');assert.equal(out.result.event.location,'New venue')}
    else if(mode.endsWith('clear')){assert.equal(patch.body.location,'');assert.equal(out.result.event.location,'')}
    else{assert.equal(Object.hasOwn(patch.body,'location'),false);assert.equal(out.result.event.location,'Old venue')}
  }finally{await rm(root,{recursive:true,force:true})}
});
