// APP-폰알림 N3: Edge phone-push(입구 두 개·owner·기기 등록·시험 알림·예약 정리) + _shared/fcm-send.ts.
// 네트워크 없음: Supabase·구글 OAuth·FCM은 모두 지어낸 응답이다. 서비스 계정 키는 시험 안에서 새로 만든 RSA 키.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,createVerify} from 'node:crypto';

const H=await import('../../supabase/functions/phone-push/handler.ts');
const F=await import('../../supabase/functions/_shared/fcm-send.ts');

const NOW=Date.parse('2026-11-01T03:00:00Z');
const SB='https://synthetic.supabase.test';
const SERVICE='synthetic-service-role-key';
const SECRET='synthetic-phone-push-cron-secret-0123456789';
const WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002';
const USER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002',NOBODY='b0000000-0000-4000-8000-000000000003';
const JWT_OK='synthetic.user.jwt-owner-0001',JWT_STRANGER='synthetic.user.jwt-stranger-01',JWT_NOBODY='synthetic.user.jwt-nobody-0001';
const FN='https://synthetic.supabase.test/functions/v1/phone-push';
const TOKEN_A='devTokenAAAA_bbbb:cccc-000111',TOKEN_B='devTokenBBBB_cccc:dddd-222333';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const SA=JSON.stringify({type:'service_account',project_id:'web2-phone-test',client_email:'push-sender@web2-phone-test.iam.gserviceaccount.com',
  private_key:privateKey.export({type:'pkcs8',format:'pem'}),token_uri:'https://evil.example/token'});

const reply=(status,body)=>new Response(body===undefined?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

function harness({devices=[],env={},fcm=()=>reply(200,{name:'projects/x/messages/1'}),oauth=()=>reply(200,{access_token:'ya29.synthetic-access-token'})}={}){
 const state={devices:devices.map(d=>({...d})),log:[],calls:{rest:[],auth:0,oauth:[],fcm:[],other:[]}};
 const fetcher=async(url,init={})=>{
  const u=new URL(url),method=init.method??'GET';
  if(u.origin===SB&&u.pathname==='/auth/v1/user'){
   state.calls.auth++;
   const a=init.headers?.Authorization;
   if(a===`Bearer ${JWT_OK}`)return reply(200,{id:USER});
   if(a===`Bearer ${JWT_STRANGER}`)return reply(200,{id:STRANGER});
   if(a===`Bearer ${JWT_NOBODY}`)return reply(200,{id:NOBODY});
   return reply(401,{msg:'bad'});
  }
  if(u.origin===SB&&u.pathname.startsWith('/rest/v1/')){
   assert.equal(init.headers.apikey,SERVICE);
   const table=u.pathname.slice('/rest/v1/'.length),q=u.searchParams,body=init.body?JSON.parse(init.body):undefined;
   state.calls.rest.push({method,table,query:u.search,body});
   assert.ok(['app_workspace_members','app_push_devices','app_push_log'].includes(table),'only its own tables + owner lookup: '+table);
   if(table==='app_workspace_members'){
    assert.equal(method,'GET');
    const uid=q.get('user_id').replace('eq.','');
    return reply(200,uid===USER?[{workspace_id:WS}]:uid===STRANGER?[{workspace_id:WS2}]:[]);
   }
   if(table==='app_push_devices'){
    const ws=q.get('workspace_id')?.replace('eq.','');
    if(method==='GET'){
     let rows=state.devices.filter(d=>(!ws||d.workspace_id===ws)&&(q.get('revoked_at')!=='is.null'||!d.revoked_at));
     return reply(200,rows);
    }
    if(method==='POST'){
     assert.equal(q.get('on_conflict'),'fcm_token');
     let row=state.devices.find(d=>d.fcm_token===body.fcm_token);
     if(row)Object.assign(row,body);else{row={id:`c0000000-0000-4000-8000-00000000000${state.devices.length+1}`,created_at:'2026-11-01T00:00:00Z',...body};state.devices.push(row);}
     return reply(201,[{id:row.id,last_seen_at:row.last_seen_at}]);
    }
    if(method==='DELETE'){
     const id=q.get('id')?.replace('eq.',''),tok=q.get('fcm_token')?.replace('eq.','');
     const hit=state.devices.filter(d=>d.workspace_id===ws&&(id?d.id===id:d.fcm_token===tok));
     state.devices=state.devices.filter(d=>!hit.includes(d));
     return reply(200,hit.map(d=>({id:d.id})));
    }
    if(method==='PATCH'){
     const id=q.get('id').replace('eq.','');for(const d of state.devices)if(d.id===id)Object.assign(d,body);
     return new Response(null,{status:204});
    }
   }
   if(table==='app_push_log'){
    if(method==='POST'){state.log.push(body);return new Response(null,{status:201,headers:{'content-length':'0'}});}
    if(method==='DELETE'){assert.match(q.get('sent_at'),/^lt\.2026-10-02T03:00:00/);return reply(200,[{day:'2026-09-30'},{day:'2026-09-29'}]);}
   }
   throw new Error('unexpected rest call '+method+' '+table);
  }
  if(url===F.GOOGLE_TOKEN_URL){state.calls.oauth.push(init);return oauth(init);}
  if(u.origin==='https://fcm.googleapis.com'){state.calls.fcm.push({url,init,body:JSON.parse(init.body)});return fcm(JSON.parse(init.body));}
  state.calls.other.push(url);throw new Error('unexpected fetch '+url);
 };
 const logs=[];
 const handler=H.createPhonePushHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,PHONE_PUSH_CRON_SECRET:SECRET,FCM_SERVICE_ACCOUNT_JSON:SA,...env})[n],fetch:fetcher,now:()=>NOW,log:(c,d)=>logs.push({c,d})});
 const call=(query,{headers={},body={},method='POST'}={})=>handler(new Request(`${FN}?${query}`,{method,headers:{'Content-Type':'application/json',...headers},body:method==='POST'?(typeof body==='string'?body:JSON.stringify(body)):undefined}));
 return {state,logs,
  user:(action,body={},jwt=JWT_OK,extra={})=>call(`action=${action}`,{headers:{Authorization:`Bearer ${jwt}`,...extra},body}),
  cron:(slot,body={},secret=SECRET,extra={})=>call(`action=run&slot=${slot}`,{headers:{'x-phone-push-cron-secret':secret,...extra},body}),
  raw:call};
}
const dev=(id,ws,token,extra={})=>({id,workspace_id:ws,user_id:ws===WS?USER:STRANGER,fcm_token:token,app_version:'0.5.0',created_at:'2026-10-31T00:00:00Z',last_seen_at:'2026-10-31T00:00:00Z',revoked_at:null,...extra});
const D1='c0000000-0000-4000-8000-0000000000a1',D2='c0000000-0000-4000-8000-0000000000a2';

// ---- 열쇠·입구 ------------------------------------------------------------------------------------------------------

test('keys first: no key, both keys, foreign secret header, wrong/short cron secret, bad bearer → 401 before any DB call',async()=>{
 const h=harness();
 const cases=[
  ()=>h.raw('action=devices'),
  ()=>h.raw('action=devices',{headers:{Authorization:`Bearer ${JWT_OK}`,'x-phone-push-cron-secret':SECRET}}),
  ()=>h.raw('action=run&slot=quarter',{headers:{Authorization:`Bearer ${JWT_OK}`,'x-phone-push-cron-secret':SECRET}}),
  ()=>h.user('devices',{},JWT_OK,{'x-outside-feed-cron-secret':'x'}),
  ()=>h.cron('quarter',{},SECRET,{'x-drive-summary-cron-secret':'x'}),
  ()=>h.cron('quarter',{},SECRET+'x'),
  ()=>h.cron('quarter',{},'short'),
  ()=>h.raw('action=devices',{headers:{Authorization:'Basic abc'}}),
  ()=>h.raw('action=devices',{headers:{Authorization:'Bearer short'}}),
 ];
 for(const c of cases){const r=await c();assert.equal(r.status,401);assert.equal((await r.json()).error,'UNAUTHORIZED');}
 assert.equal(h.state.calls.rest.length,0);assert.equal(h.state.calls.auth,0);
 // Secret not configured (or shorter than 32 chars) → cron entrance closed.
 for(const value of [undefined,'too-short-secret']){
  const g=harness({env:{PHONE_PUSH_CRON_SECRET:value}});
  assert.equal((await g.cron('quarter',{},value??SECRET)).status,401);
 }
});

test('entrances do not cross: cron key cannot call user actions, user key cannot call run; unknown action 400; GET 405; OPTIONS 204',async()=>{
 const h=harness();
 for(const a of ['register','devices','test'])assert.equal((await h.raw(`action=${a}`,{headers:{'x-phone-push-cron-secret':SECRET},body:{}})).status,400);
 assert.equal((await h.user('run',{})).status,400);
 assert.equal((await h.user('nope',{})).status,400);
 assert.equal((await h.raw('action=devices',{method:'GET',headers:{Authorization:`Bearer ${JWT_OK}`}})).status,405);
 const o=await h.raw('',{method:'OPTIONS'});assert.equal(o.status,204);
 assert.equal(h.state.calls.auth,0,'no user lookup for refused calls');
});

test('user entrance: unknown login 401, non-owner 403; workspace comes from the server, never from the body',async()=>{
 const h=harness();
 assert.equal((await h.user('devices',{},'synthetic.unknown.jwt-000000')).status,401);
 assert.equal((await h.user('devices',{},JWT_NOBODY)).status,403);
 const r=await h.user('register',{token:TOKEN_A,workspace_id:WS2});
 assert.equal(r.status,400,'extra body keys (workspace/user ids) refused');
 const r2=await h.user('register',{token:TOKEN_A,user_id:STRANGER});
 assert.equal(r2.status,400);
 assert.equal(h.state.devices.length,0);
});

// ---- 기기 등록 -----------------------------------------------------------------------------------------------------

test('register: shaped token only, saved to the caller own workspace, re-register refreshes, tail only in the reply',async()=>{
 const h=harness();
 for(const bad of [{},{token:'short'},{token:'has space token 0123456789'},{token:TOKEN_A,app_version:'0.5 beta'},{token:7}])
  assert.equal((await h.user('register',bad)).status,400,JSON.stringify(bad));
 const r=await h.user('register',{token:TOKEN_A,app_version:'0.5.0'});
 assert.equal(r.status,200);const out=await r.json();
 assert.deepEqual(Object.keys(out.device).sort(),['id','tail']);assert.equal(out.device.tail,TOKEN_A.slice(-6));
 assert.doesNotMatch(JSON.stringify(out),new RegExp(TOKEN_A.slice(0,12)));
 assert.equal(h.state.devices.length,1);
 assert.equal(h.state.devices[0].workspace_id,WS);assert.equal(h.state.devices[0].user_id,USER);assert.equal(h.state.devices[0].revoked_at,null);
 assert.equal(h.state.devices[0].last_seen_at,new Date(NOW).toISOString());
 assert.equal((await h.user('register',{token:TOKEN_A})).status,200);
 assert.equal(h.state.devices.length,1,'same token → one row');
});

test('register: device cap per workspace (refresh of a known token still allowed)',async()=>{
 const devices=Array.from({length:H.MAX_DEVICES},(_,i)=>dev(`c0000000-0000-4000-8000-0000000001${String(i).padStart(2,'0')}`,WS,`capToken_${String(i).padStart(2,'0')}_0123456789ab`));
 const h=harness({devices});
 const r=await h.user('register',{token:TOKEN_B});assert.equal(r.status,409);assert.equal((await r.json()).error,'TOO_MANY_DEVICES');
 assert.equal((await h.user('register',{token:devices[0].fcm_token})).status,200);
});

test('devices and unregister: own workspace only, no full token in the list',async()=>{
 const h=harness({devices:[dev(D1,WS,TOKEN_A),dev(D2,WS2,TOKEN_B)]});
 const list=await (await h.user('devices')).json();
 assert.equal(list.devices.length,1);assert.equal(list.devices[0].id,D1);assert.equal(list.devices[0].tail,TOKEN_A.slice(-6));
 assert.ok(!('fcm_token' in list.devices[0]));assert.doesNotMatch(JSON.stringify(list),/devTokenAAAA/);
 // Stranger cannot remove the owner device (filter is the caller's server-side workspace).
 assert.equal((await (await h.user('unregister',{device_id:D1},JWT_STRANGER)).json()).removed,0);
 assert.equal((await (await h.user('unregister',{token:TOKEN_A},JWT_STRANGER)).json()).removed,0);
 assert.equal(h.state.devices.length,2);
 for(const bad of [{},{device_id:'x'},{device_id:D1,token:TOKEN_A},{token:'short'}])assert.equal((await h.user('unregister',bad)).status,400);
 assert.equal((await (await h.user('unregister',{token:TOKEN_A})).json()).removed,1);
 assert.deepEqual(h.state.devices.map(d=>d.id),[D2]);
 assert.equal((await h.user('devices',{x:1})).status,400);
});

// ---- 시험 알림·FCM ------------------------------------------------------------------------------------------------

test('test push: signed service-account JWT to the fixed Google token URL (not the secret token_uri), data message only, log row',async()=>{
 const h=harness({devices:[dev(D1,WS,TOKEN_A),dev(D2,WS2,TOKEN_B)]});
 const r=await h.user('test');assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{ok:true,sent:1,failed:0,revoked:0});
 assert.equal(h.state.calls.oauth.length,1);assert.deepEqual(h.state.calls.other,[]);
 const form=new URLSearchParams(h.state.calls.oauth[0].body);
 assert.equal(form.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
 const [head,claims,sig]=form.get('assertion').split('.');
 const dec=s=>JSON.parse(Buffer.from(s,'base64url').toString());
 assert.deepEqual(dec(head),{alg:'RS256',typ:'JWT'});
 const c=dec(claims);assert.equal(c.aud,'https://oauth2.googleapis.com/token');assert.equal(c.scope,'https://www.googleapis.com/auth/firebase.messaging');
 assert.equal(c.iss,'push-sender@web2-phone-test.iam.gserviceaccount.com');assert.equal(c.exp-c.iat,3600);
 const v=createVerify('RSA-SHA256');v.update(`${head}.${claims}`);assert.ok(v.verify(publicKey,Buffer.from(sig,'base64url')),'RS256 signature');
 assert.equal(h.state.calls.fcm.length,1,'only the caller device');
 const f=h.state.calls.fcm[0];
 assert.equal(f.url,'https://fcm.googleapis.com/v1/projects/web2-phone-test/messages:send');
 assert.equal(f.init.headers.Authorization,'Bearer ya29.synthetic-access-token');
 assert.deepEqual(f.body,{message:{token:TOKEN_A,data:{kind:'test',title:'웹2 · 시험 알림',open:'/work/app/'},android:{priority:'high',ttl:'86400s'}}});
 assert.ok(!('notification' in f.body.message),'data message only (the app draws it)');
 assert.equal(h.state.log.length,1);assert.equal(h.state.log[0].workspace_id,WS);assert.equal(h.state.log[0].kind,'test');assert.equal(h.state.log[0].status,'sent');
 assert.equal(h.state.log[0].day,'2026-11-01');assert.match(h.state.log[0].ref_key,/^[A-Za-z0-9_.:-]{1,80}$/);
 assert.equal(h.logs.length,0);
});

test('test push: unregistered device is revoked; failures counted; no device 409; no secret 424; daily cap 429',async()=>{
 const h=harness({devices:[dev(D1,WS,TOKEN_A)],fcm:()=>reply(404,{error:{status:'NOT_FOUND',details:[{errorCode:'UNREGISTERED'}]}})});
 assert.deepEqual(await (await h.user('test')).json(),{ok:true,sent:0,failed:0,revoked:1});
 assert.equal(h.state.devices[0].revoked_at,new Date(NOW).toISOString());assert.equal(h.state.log[0].status,'failed');
 assert.equal((await h.user('test')).status,409,'revoked device is not active');
 const g=harness({devices:[dev(D1,WS,TOKEN_A)],fcm:()=>reply(500,{error:{status:'INTERNAL'}})});
 assert.deepEqual(await (await g.user('test')).json(),{ok:true,sent:0,failed:1,revoked:0});
 assert.equal(g.state.devices[0].revoked_at,null);
 const o=harness({devices:[dev(D1,WS,TOKEN_A)],oauth:()=>reply(400,{error:'invalid_grant'})});
 assert.deepEqual(await (await o.user('test')).json(),{ok:true,sent:0,failed:1,revoked:0});
 assert.equal(o.state.calls.fcm.length,0);
 for(const value of [undefined,'{}','not json',JSON.stringify({...JSON.parse(SA),type:'user'}),JSON.stringify({...JSON.parse(SA),client_email:'push-sender.iam.gserviceaccount.com'})]){
  const n=harness({devices:[dev(D1,WS,TOKEN_A)],env:{FCM_SERVICE_ACCOUNT_JSON:value}});
  const r=await n.user('test');assert.equal(r.status,424);assert.equal((await r.json()).error,'PUSH_NOT_CONFIGURED');
  assert.equal(n.state.calls.oauth.length,0);
 }
 const c=harness({devices:[dev(D1,WS,TOKEN_A)]});
 for(let i=0;i<H.TEST_DAILY_PER_USER;i++)assert.equal((await c.user('test')).status,200);
 assert.equal((await c.user('test')).status,429);
});

test('fcm-send: title cut to 40 chars, open path limited to the app, odd kinds refused',async()=>{
 assert.equal(F.cutTitle('가'.repeat(60)).length,40);assert.equal(F.cutTitle(' a\n\tb '),'a b');
 for(const ok of ['/work/app/','/work/app/?view=tasks&task=abc-1'])assert.ok(F.OPEN_PATH.test(ok),ok);
 for(const bad of ['https://evil.example/','/work/app/../x','//evil.example','/work/app/?a=<b>','javascript:alert(1)','/work/app/?x=\\'])assert.ok(!F.OPEN_PATH.test(bad),bad);
 for(const bad of [{private_key:'short'},{private_key:'x'.repeat(300)},{project_id:'Bad_Project'}])assert.equal(F.readFcmConfig(JSON.stringify({...JSON.parse(SA),...bad})),null,JSON.stringify(bad).slice(0,40));
 const cfg=F.readFcmConfig(SA);assert.ok(cfg);assert.deepEqual(Object.keys(cfg).sort(),['clientEmail','privateKey','projectId']);
 let calls=0;const s=F.makeFcmSender(cfg,async()=>{calls++;return reply(200,{access_token:'ya29.synthetic-access-token'});},()=>NOW);
 assert.equal(await s.send(TOKEN_A,{kind:'test',title:'x',open:'https://evil.example/',urgent:false}),'failed');
 assert.equal(await s.send(TOKEN_A,{kind:'Bad Kind',title:'x',open:'/work/app/',urgent:false}),'failed');
 assert.equal(calls,0);
});

// ---- 예약 입구 ----------------------------------------------------------------------------------------------------

test('cron run: slot required, body must be {}, prunes 30-day log, counts workspaces, sends nothing (N3)',async()=>{
 const h=harness({devices:[dev(D1,WS,TOKEN_A),dev(D2,WS2,TOKEN_B),dev('c0000000-0000-4000-8000-0000000000a3',WS,'devTokenCCCC_dddd:eeee-444555')]});
 for(const slot of ['','hourly','QUARTER'])assert.equal((await h.cron(slot)).status,400,slot);
 assert.equal((await h.cron('quarter',{workspace_id:WS})).status,400,'no ids from the caller');
 assert.equal((await h.cron('quarter','[]')).status,400);
 for(const slot of H.SLOTS){
  const r=await h.cron(slot);assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,slot,workspaces:2,sent:0,pruned:2});
 }
 assert.equal(h.state.calls.auth,0,'cron entrance never reads user logins');
 assert.equal(h.state.calls.fcm.length+h.state.calls.oauth.length,0);
 assert.ok(h.state.calls.rest.every(c=>c.table!=='app_workspace_members'));
});

test('server errors are codes only; store failure 503',async()=>{
 const h=harness();
 const g=H.createPhonePushHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,PHONE_PUSH_CRON_SECRET:SECRET})[n],fetch:async()=>reply(500,{}),now:()=>NOW,log:()=>{}});
 const r=await g(new Request(`${FN}?action=run&slot=quarter`,{method:'POST',headers:{'x-phone-push-cron-secret':SECRET},body:'{}'}));
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,error:'STORE_UNAVAILABLE'});
 const m=H.createPhonePushHandler({env:n=>({PHONE_PUSH_CRON_SECRET:SECRET})[n],fetch:async()=>{throw new Error('x');},now:()=>NOW,log:()=>{}});
 assert.equal((await m(new Request(`${FN}?action=run&slot=quarter`,{method:'POST',headers:{'x-phone-push-cron-secret':SECRET},body:'{}'}))).status,500);
 assert.ok(h);
});

// ---- 문서 표·index·소스 ------------------------------------------------------------------------------------------

test('docs 5절 table: phone-push row is verify_jwt=false and 배포 대기; index wires the handler with Deno.env only; no token logging',()=>{
 const doc=readFileSync('docs/web2-env6b-edge-source.md','utf8');
 const section=doc.slice(doc.indexOf('## 5.'),doc.indexOf('### 5.1'));
 const rows=section.split('\n').filter(l=>/^\| \d+ \| `phone-push` \|/.test(l));
 assert.equal(rows.length,1);assert.match(rows[0],/\| 배포 대기 \| 없음 \| false \|/);
 const idx=readFileSync('supabase/functions/phone-push/index.ts','utf8');
 assert.match(idx,/Deno\.serve\(createPhonePushHandler\(\{ env: \(name\) => Deno\.env\.get\(name\) \}\)\);/);
 for(const f of ['supabase/functions/phone-push/handler.ts','supabase/functions/_shared/fcm-send.ts']){
  const src=readFileSync(f,'utf8');
  assert.doesNotMatch(src,/console\.(log|info|warn)\(/,f);
  assert.doesNotMatch(src,/log\([^)]*(fcm_token|token|title)/,f);
 }
 // 옛 함수 이름을 되살리지 않는다.
 assert.doesNotMatch(readFileSync('supabase/functions/phone-push/handler.ts','utf8'),/push-notifications/);
});
