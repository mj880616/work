// OPS-새가입알림 ②(S62-25): phone-push가 새 가입을 운영자(dev_inbox 작업공간)에게만 알린다 — 15분 예약 폰 알림 + 알림 줄.
// 같은 가입 두 번 안 알림, 여럿이면 한 번에 묶음, 조용한 시간엔 모았다가 끝난 뒤, 끄면 skipped_off, 폰이 없으면 알림 줄만.
// 운영자가 아니면 알림 줄도 목록 읽기도 없다. 기록에는 종류·열쇠·상태만(이름 없음). 네트워크 없음, 모두 지어낸 값(가상 메일).
// S68-58(사용자 11/23 15:53): 운영자에게 가는 정보는 이메일·가입일·마지막 사용 시각뿐 — 알림 글은 '새 가입 n명'(이름·조직 없음).
//   서버 흉내도 새 모양(since = 수·가장 새 초, list = 이메일·가입·사용)이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const H=await import('../../supabase/functions/phone-push/handler.ts');
const D=await import('../../supabase/functions/phone-push/done-items.ts');

const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key',ANON='synthetic-anon-key',SECRET='synthetic-phone-push-cron-secret-0123456789';
const OP_WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OP_USER='b0000000-0000-4000-8000-000000000001',OTHER_USER='b0000000-0000-4000-8000-000000000002';
const JWT_OP='header.operatorjwtpayload.signature',JWT_OTHER='header.otherjwtpayloadxx.signature';
const FN='https://synthetic.supabase.test/functions/v1/phone-push';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const SA=JSON.stringify({type:'service_account',project_id:'web2-phone-test',client_email:'push-sender@web2-phone-test.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
const reply=(status,body)=>new Response(body===undefined?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const sec=iso=>Math.floor(Date.parse(iso)/1000);

function harness({now,people=[],prefs=null,log=[],devices=true,operator=OP_WS}={}){
  const state={log:structuredClone(log),fcm:[],rest:[],sinceArgs:[],listCalls:0};
  const fetcher=async(url,init={})=>{
    const u=new URL(url),method=init.method??'GET',headers=new Headers(init.headers);
    if(u.origin==='https://oauth2.googleapis.com')return reply(200,{access_token:'ya29.synthetic'});
    if(u.origin==='https://fcm.googleapis.com'){state.fcm.push(JSON.parse(init.body));return reply(200,{name:'projects/x/messages/1'});}
    assert.equal(u.origin,SB);
    if(u.pathname==='/auth/v1/user'){const jwt=headers.get('authorization')?.slice(7);return reply(200,{id:jwt===JWT_OP?OP_USER:OTHER_USER});}
    const table=u.pathname.slice('/rest/v1/'.length),q=u.searchParams,body=init.body?JSON.parse(init.body):undefined;
    state.rest.push({method,table,auth:headers.get('authorization'),select:q.get('select')});
    const eq=k=>q.get(k)?.startsWith('eq.')?decodeURIComponent(q.get(k).slice(3)):null;
    if(table==='rpc/app_operator_feature_workspace'){assert.equal(headers.get('authorization'),'Bearer '+SERVICE);assert.deepEqual(body,{p_feature:'dev_inbox'});return reply(200,operator);}
    if(table==='rpc/app_signup_since'){
      assert.equal(headers.get('authorization'),'Bearer '+SERVICE,'세기 함수는 service_role만');
      state.sinceArgs.push(body.p_since);
      const s=Date.parse(body.p_since)/1000,hit=people.filter(p=>sec(p.at)>s).sort((a,b)=>b.at.localeCompare(a.at));
      return reply(200,{count:hit.length,newest:hit.length?sec(hit[0].at):null});
    }
    if(table==='rpc/app_signup_list'){
      // 사용자 로그인 그대로(anon 열쇠 + 그 사람 JWT). 서버 함수가 운영자 아니면 거절(42501 → 403).
      state.listCalls++;assert.equal(method,'GET');assert.equal(headers.get('apikey'),ANON);
      if(headers.get('authorization')!=='Bearer '+JWT_OP)return reply(403,{code:'42501',message:'OPERATOR_FEATURE_REQUIRED'});
      return reply(200,people.map(p=>({email:p.email,signed_up_at:p.at,last_seen_at:null})));
    }
    if(table==='app_push_log'&&method==='DELETE')return reply(200,[]);
    if(table==='app_push_log'&&method==='GET'){
      let rows=state.log.filter(r=>r.workspace_id===eq('workspace_id'));
      if(eq('kind'))rows=rows.filter(r=>r.kind===eq('kind'));
      if(q.get('kind')?.startsWith('in.'))rows=rows.filter(r=>q.get('kind').includes(`"${r.kind}"`));
      if(eq('ref_key'))rows=rows.filter(r=>r.ref_key===eq('ref_key'));
      if(q.get('ref_key')?.startsWith('in.'))rows=rows.filter(r=>q.get('ref_key').includes(`"${r.ref_key}"`));
      if(q.get('opened_at')==='not.is.null')rows=rows.filter(r=>r.opened_at);
      return reply(200,rows);
    }
    if(table==='app_push_log'&&method==='POST'){
      for(const k of Object.keys(body))assert.ok(['workspace_id','kind','ref_key','day','status','shown_at'].includes(k),'기록에는 이름·제목이 없다: '+k);
      const i=state.log.findIndex(r=>r.workspace_id===body.workspace_id&&r.kind===body.kind&&r.ref_key===body.ref_key&&r.day===body.day);
      if(i>=0){if(!(init.headers?.Prefer||'').includes('ignore'))state.log[i]={...state.log[i],...body};}else state.log.push(body);
      return reply(201);
    }
    if(table==='app_push_log'&&method==='PATCH'){
      for(const r of state.log)if(r.workspace_id===eq('workspace_id')&&r.kind===eq('kind')&&r.ref_key===eq('ref_key')&&(!eq('day')||r.day===eq('day')))Object.assign(r,body);
      return reply(200,[{day:'x'}]);
    }
    if(table==='app_push_devices'&&method==='GET'){
      const all=devices?[{id:'c0000000-0000-4000-8000-0000000000a1',workspace_id:OP_WS,fcm_token:'devTokenAAAA_bbbb:cccc-000111'},{id:'c0000000-0000-4000-8000-0000000000a2',workspace_id:OTHER_WS,fcm_token:'devTokenBBBB_cccc:dddd-222333'}]:[];
      const ws=eq('workspace_id');return reply(200,ws?all.filter(d=>d.workspace_id===ws):all);
    }
    if(table==='app_workspace_members'){
      const ws=eq('workspace_id'),uid=eq('user_id');
      if(uid)return reply(200,[{workspace_id:uid===OP_USER?OP_WS:OTHER_WS}]);
      return reply(200,ws===OP_WS?[{user_id:OP_USER}]:ws===OTHER_WS?[{user_id:OTHER_USER}]:[]);
    }
    if(table==='app_profiles')return reply(200,[{notify_prefs:prefs}]);
    if(table===H.FAMILY_TABLE||table==='app_meeting_transcribe_jobs')return reply(200,[]);
    if(table==='app_push_devices'&&method==='PATCH')return reply(204);
    throw new Error('unexpected '+method+' '+table);
  };
  const handler=H.createPhonePushHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,SUPABASE_ANON_KEY:ANON,PHONE_PUSH_CRON_SECRET:SECRET,FCM_SERVICE_ACCOUNT_JSON:SA})[n],fetch:fetcher,now:()=>now,log:()=>{}});
  const cron=()=>handler(new Request(`${FN}?action=run&slot=quarter`,{method:'POST',headers:{'Content-Type':'application/json','x-phone-push-cron-secret':SECRET},body:'{}'}));
  const user=(jwt,action='notices',b={})=>handler(new Request(`${FN}?action=${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt},body:JSON.stringify(b)}));
  return {cron,user,state};
}
const A={email:'person-a@example.test',at:'2026-11-15T02:10:00.300Z'},B={email:'person-b@example.test',at:'2026-11-15T02:20:00Z'},C={email:'person-c@example.test',at:'2026-11-15T05:00:00Z'};
const DAY=Date.parse('2026-11-15T03:00:00Z'); // 12:00 KST
const NIGHT=Date.parse('2026-11-15T14:00:00Z'); // 23:00 KST
const MORNING=Date.parse('2026-11-15T22:30:00Z'); // 다음 날 07:30 KST
const su=out=>out.items.filter(i=>i.kind==='signup'),suLog=h=>h.state.log.filter(l=>l.kind==='signup');
const titleOf=h=>h.state.fcm.map(f=>f.message.data.title);

test('quarter: 운영자에게만 "새 가입 n명" 한 번(이름·메일 없음), 묶음, 기록은 종류·열쇠·상태만, 같은 가입 다시 안 보냄',async()=>{
  const h=harness({now:DAY,people:[A,B]});
  const out=await (await h.cron()).json();
  assert.deepEqual(out.signup,{sent:1,held:0,off:0,found:2});
  assert.deepEqual(titleOf(h),['새 가입 2명']);
  assert.doesNotMatch(JSON.stringify(h.state.fcm),/example\.test|가상/,'알림에 메일·이름 없음');
  const data=h.state.fcm[0].message.data;
  assert.equal(data.kind,'signup');assert.equal(data.open,`/work/app/?view=signups&notice=signup.${encodeURIComponent('su:'+sec(B.at))}`);
  assert.equal(h.state.fcm[0].message.token,'devTokenAAAA_bbbb:cccc-000111','운영자 폰에만');
  assert.deepEqual(h.state.log.map(l=>[l.workspace_id,l.kind,l.ref_key,l.status]),[[OP_WS,'signup','su:'+sec(B.at),'sent']]);
  assert.doesNotMatch(JSON.stringify(h.state.log),/가상|example\.test/);
  // 처음(기록 없음)은 하루 전부터 센다.
  assert.equal(h.state.sinceArgs[0],new Date((Math.floor(DAY/1000)-86400)*1000).toISOString());
  await h.cron();assert.equal(h.state.fcm.length,1,'같은 가입은 다시 안 보냄');
  // 열쇠 초 뒤만 센다(0.3초가 붙은 가입도 다시 세지 않음).
  assert.equal(h.state.sinceArgs[1],new Date(sec(B.at)*1000).toISOString());
  const h2=harness({now:DAY+3*3600000,people:[A,B,C],log:h.state.log});
  await h2.cron();assert.deepEqual(titleOf(h2),['새 가입 1명']);
});

test('알림 글은 수만: 이름을 넘겨도 싣지 않음, 이상한 수는 0',()=>{
  assert.equal(H.signupTitle(5),'새 가입 5명');
  assert.equal(H.signupTitle(5,['가','나']),'새 가입 5명');
  assert.equal(H.signupTitle(2.7),'새 가입 2명');
  assert.equal(H.signupTitle(Number.NaN),'새 가입 0명');
  assert.equal(H.signupTitle(-1),'새 가입 0명');
});

test('운영자 작업공간이 정해지지 않으면(허용 행 0개·2개) 아무에게도 안 보내고 세지도 않는다',async()=>{
  const h=harness({now:DAY,people:[A],operator:null});
  const out=await (await h.cron()).json();
  assert.deepEqual(out.signup,{sent:0,held:0,off:0,found:0});
  assert.equal(h.state.fcm.length,0);assert.equal(h.state.sinceArgs.length,0);
});

test('조용한 시간엔 기록 없이 넘기고, 끝난 뒤 첫 실행에서 그동안 가입을 묶어 한 번. 끄면 skipped_off',async()=>{
  const night=harness({now:NIGHT,people:[A,B]});
  assert.deepEqual((await (await night.cron()).json()).signup,{sent:0,held:1,off:0,found:2});
  assert.equal(night.state.fcm.length,0);assert.equal(night.state.log.length,0);
  const late={email:'person-d@example.test',at:'2026-11-15T15:00:00Z'};
  const morning=harness({now:MORNING,people:[A,B,late],log:night.state.log});
  await morning.cron();assert.deepEqual(titleOf(morning),['새 가입 3명']);
  await morning.cron();assert.equal(morning.state.fcm.length,1);
  const off=harness({now:DAY,people:[A],prefs:{kinds:{signup:false}}});
  assert.deepEqual((await (await off.cron()).json()).signup,{sent:0,held:0,off:1,found:1});
  assert.equal(off.state.fcm.length,0);assert.deepEqual(off.state.log.map(l=>l.status),['skipped_off']);
  await off.cron();assert.equal(off.state.log.length,1,'끈 가입도 다시 세지 않음');
  // 다른 종류를 꺼도 새 가입은 간다.
  const other=harness({now:DAY,people:[A],prefs:{kinds:{family:false}}});
  await other.cron();assert.equal(other.state.fcm.length,1);
});

test('폰이 없으면 보내지 않고 failed로 남겨 다시 세지 않는다(알림 줄은 따로 뜸)',async()=>{
  const h=harness({now:DAY,people:[A],devices:false});
  await h.cron();assert.equal(h.state.fcm.length,0);assert.deepEqual(h.state.log.map(l=>l.status),['failed']);
});

test('알림 줄: 운영자만 "새 가입 n명"(text, 이름·메일 없음), 연 뒤에는 그 뒤 가입만, 다른 이용자는 목록을 읽지도 않는다',async()=>{
  const h=harness({now:DAY,people:[A,B]});
  const out=await (await h.user(JWT_OP)).json();
  assert.deepEqual(su(out),[{kind:'signup',ref_key:'su:'+sec(B.at),open:`/work/app/?view=signups&notice=signup.${encodeURIComponent('su:'+sec(B.at))}`,text:'새 가입 2명'}]);
  assert.ok(h.state.rest.some(r=>r.table==='rpc/app_signup_list'&&r.auth==='Bearer '+JWT_OP),'목록은 사용자 로그인으로');
  assert.deepEqual(suLog(h).map(l=>[l.kind,l.status]),[['signup','shown']]);
  assert.doesNotMatch(JSON.stringify(h.state.log),/가상|example\.test/);
  // 누르면(opened) 다음부터 안 뜬다. 새 가입이 오면 그것만.
  assert.equal((await h.user(JWT_OP,'opened',{kind:'signup',ref_key:'su:'+sec(B.at)})).status,200);
  assert.deepEqual(su(await (await h.user(JWT_OP)).json()),[]);
  const h2=harness({now:DAY+3*3600000,people:[A,B,C],log:h.state.log});
  assert.deepEqual(su(await (await h2.user(JWT_OP)).json()).map(i=>i.text),['새 가입 1명']);
  // 연 줄은 폰으로도 보내지 않는다(같은 열쇠).
  const h3=harness({now:DAY,people:[A,B],log:h.state.log});await h3.cron();assert.equal(h3.state.fcm.length,0);
  // 운영자 아님: 줄 없음, 목록 함수 호출 없음.
  const o=harness({now:DAY,people:[A,B]});
  assert.deepEqual(su(await (await o.user(JWT_OTHER)).json()),[]);
  assert.equal(o.state.listCalls,0);
  // 허용 표가 운영자를 가리켜도 목록 함수가 거절하면(서버 이중 확인) 줄 없음.
  const p=harness({now:DAY,people:[A],operator:OTHER_WS});
  assert.deepEqual(su(await (await p.user(JWT_OTHER)).json()),[]);
  assert.equal(p.state.listCalls,1);
});

test('최근 알림·여는 자리: signup은 알림 기록 종류이고 가입자 목록으로 연다. family는 그대로 빠져 있다',async()=>{
  assert.ok(D.NOTICE_LOG_KINDS.includes('signup'));assert.ok(!D.NOTICE_LOG_KINDS.includes('family'));
  assert.equal(D.openPath('signup','su:1794700000'),'/work/app/?view=signups&notice=signup.su%3A1794700000');
  const mig=await readFile(new URL('../../supabase/migrations/20261115234500_signup_notify.sql',import.meta.url),'utf8');
  const check=/app_push_log_kind_check check \(kind in \(([\s\S]*?)\)\);/.exec(mig)[1];
  for(const k of D.NOTICE_LOG_KINDS)assert.match(check,new RegExp(`'${k}'`),k);
});
