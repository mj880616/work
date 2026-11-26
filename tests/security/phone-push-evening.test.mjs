// OUTSIDE-바깥성명 ⑥(S70-55 I-11, 사용자 결정 11/25 "저녁 알림만"): 저녁 예약(slot=evening)이 Now 한 줄('새 성명 n · 새 기사 n')을
// 운영자 기능 'outside' 작업공간 폰에 알림 하나로 보낸다. 하루 한 번(열쇠 now:<서울 날짜>)·끈 사람(kinds.evening=false)·조용한 시간·
// 개수 0이면 안 보냄·알림 글에는 개수만(제목·내용 없음)을 지킨다. 네트워크 없음, 모두 지어낸 값.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
const H=await import('../../supabase/functions/phone-push/handler.ts');

const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key',SECRET='synthetic-phone-push-cron-secret-0123456789';
const OP_WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OP_USER='b0000000-0000-4000-8000-000000000001',OTHER_USER='b0000000-0000-4000-8000-000000000002';
const FN='https://synthetic.supabase.test/functions/v1/phone-push';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const SA=JSON.stringify({type:'service_account',project_id:'web2-phone-test',client_email:'push-sender@web2-phone-test.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
const reply=(status,body)=>new Response(body===undefined?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

const EVENING=Date.parse('2026-11-25T09:22:00Z'); // 18:22 KST
const NEXT_EVENING=EVENING+86400000;
const P=n=>`e0000000-0000-4000-8000-0000000000${String(n).padStart(2,'0')}`;
// 지어낸 글: 제목 칸을 일부러 넣어 둔다 — 서버가 읽지도(select=id) 싣지도 않아야 한다.
const posts=n=>Array.from({length:n},(_,i)=>({id:P(i),workspace_id:OP_WS,fetched_at:'2026-11-25T05:00:00Z',title:'가상 성명 제목'}));
const news=n=>Array.from({length:n},(_,i)=>({id:P(50+i),workspace_id:OP_WS,created_at:'2026-11-25T06:00:00Z',title:'가상 기사 제목'}));

function harness({now=EVENING,outside={posts:posts(3),news:news(5)},prefs=null,log=[],devices=true,feature=OP_WS,fcm=true}={}){
  const state={log:structuredClone(log),fcm:[],rest:[]};
  const fetcher=async(url,init={})=>{
    const u=new URL(url),method=init.method??'GET',headers=new Headers(init.headers);
    if(u.origin==='https://oauth2.googleapis.com')return reply(200,{access_token:'ya29.synthetic'});
    if(u.origin==='https://fcm.googleapis.com'){state.fcm.push(JSON.parse(init.body));return reply(200,{name:'projects/x/messages/1'});}
    assert.equal(u.origin,SB);
    assert.equal(headers.get('authorization'),'Bearer '+SERVICE);
    const table=u.pathname.slice('/rest/v1/'.length),q=u.searchParams,body=init.body?JSON.parse(init.body):undefined;
    state.rest.push({method,table,select:q.get('select'),ws:q.get('workspace_id')});
    const eq=k=>q.get(k)?.startsWith('eq.')?decodeURIComponent(q.get(k).slice(3)):null;
    if(table==='rpc/app_operator_feature_workspace'){assert.deepEqual(body,{p_feature:'outside'});return reply(200,feature);}
    if(['app_outside_seen','app_outside_posts','app_news_items'].includes(table)){
      assert.equal(method,'GET');assert.equal(q.get('select'),table==='app_outside_seen'?'seen_at':'id','개수만 — 제목·본문 안 읽음');
      if(table==='app_outside_seen')return reply(200,[]);
      return reply(200,(table==='app_outside_posts'?outside.posts:outside.news).filter(r=>r.workspace_id===eq('workspace_id')).map(r=>({id:r.id})));
    }
    if(table==='app_push_log'&&method==='DELETE')return reply(200,[]);
    if(table==='app_push_log'&&method==='GET'){
      let rows=state.log.filter(r=>r.workspace_id===eq('workspace_id'));
      if(eq('kind'))rows=rows.filter(r=>r.kind===eq('kind'));
      if(eq('ref_key'))rows=rows.filter(r=>r.ref_key===eq('ref_key'));
      return reply(200,rows);
    }
    if(table==='app_push_log'&&method==='POST'){
      for(const k of Object.keys(body))assert.ok(['workspace_id','kind','ref_key','day','status'].includes(k),'기록에는 제목·개수가 없다: '+k);
      const i=state.log.findIndex(r=>r.workspace_id===body.workspace_id&&r.kind===body.kind&&r.ref_key===body.ref_key&&r.day===body.day);
      if(i>=0)state.log[i]={...state.log[i],...body};else state.log.push(body);
      return reply(201);
    }
    if(table==='app_push_devices'&&method==='GET'){
      const all=devices?[{id:'c0000000-0000-4000-8000-0000000000a1',workspace_id:OP_WS,fcm_token:'devTokenAAAA_bbbb:cccc-000111'},{id:'c0000000-0000-4000-8000-0000000000a2',workspace_id:OTHER_WS,fcm_token:'devTokenBBBB_cccc:dddd-222333'}]:[];
      const ws=eq('workspace_id');return reply(200,ws?all.filter(d=>d.workspace_id===ws):all);
    }
    if(table==='app_workspace_members'){const ws=eq('workspace_id');return reply(200,ws===OP_WS?[{user_id:OP_USER}]:ws===OTHER_WS?[{user_id:OTHER_USER}]:[]);}
    if(table==='app_profiles')return reply(200,[{notify_prefs:prefs}]);
    throw new Error('unexpected '+method+' '+table);
  };
  const env=n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,PHONE_PUSH_CRON_SECRET:SECRET,...(fcm?{FCM_SERVICE_ACCOUNT_JSON:SA}:{})})[n];
  const handler=H.createPhonePushHandler({env,fetch:fetcher,now:()=>now,log:()=>{}});
  const cron=(slot='evening')=>handler(new Request(`${FN}?action=run&slot=${slot}`,{method:'POST',headers:{'Content-Type':'application/json','x-phone-push-cron-secret':SECRET},body:'{}'}));
  return {cron,state};
}
const titles=h=>h.state.fcm.map(f=>f.message.data.title);

test('저녁: 줄이 있으면 outside 작업공간 폰에만 1통, 알림 글은 개수만, 기록은 종류·열쇠·상태만',async()=>{
  const h=harness();
  const out=await (await h.cron()).json();
  assert.equal(out.sent,1);assert.equal(out.now_lines,1);assert.deepEqual(out.evening,{sent:1,held:0,off:0});
  assert.deepEqual(titles(h),['새 성명 3 · 새 기사 5']);
  const msg=h.state.fcm[0].message;
  assert.equal(msg.token,'devTokenAAAA_bbbb:cccc-000111','outside 작업공간 폰에만');
  assert.equal(msg.data.kind,'evening');
  assert.equal(msg.data.open,`/work/app/?view=news&notice=evening.${encodeURIComponent('now:2026-11-25')}`);
  assert.equal(msg.data.body,undefined,'본문 없음');
  assert.doesNotMatch(JSON.stringify(h.state.fcm)+JSON.stringify(h.state.log)+JSON.stringify(out),/가상|제목/,'제목·내용 없음');
  assert.doesNotMatch(JSON.stringify(out),/새 성명/,'줄 글은 응답에 없음');
  assert.deepEqual(h.state.log.map(l=>[l.workspace_id,l.kind,l.ref_key,l.day,l.status]),[[OP_WS,'evening','now:2026-11-25','2026-11-25','sent']]);
  assert.ok(h.state.rest.every(r=>!['app_outside_posts','app_news_items','app_outside_seen'].includes(r.table)||r.ws===`eq.${OP_WS}`),'다른 작업공간 글은 세지 않음');
});

test('하루 한 번: 같은 날 다시 돌아도 안 보내고, 다음 날 저녁에는 다시 보낸다',async()=>{
  const h=harness();
  await h.cron();await h.cron();
  assert.equal(h.state.fcm.length,1);
  const again=harness({log:h.state.log});
  const out=await (await again.cron()).json();
  assert.equal(again.state.fcm.length,0);assert.equal(out.now_lines,0,'이미 보낸 날은 세지도 않음');
  const next=harness({now:NEXT_EVENING,log:h.state.log});
  await next.cron();
  assert.equal(next.state.fcm.length,1);assert.equal(next.state.log.at(-1).ref_key,'now:2026-11-26');
});

test('개수 0이면 안 보내고 기록도 남기지 않는다. 한쪽만 있으면 그쪽만',async()=>{
  const zero=harness({outside:{posts:[],news:[]}});
  const out=await (await zero.cron()).json();
  assert.deepEqual(out.evening,{sent:0,held:0,off:0});assert.equal(out.now_lines,0);
  assert.equal(zero.state.fcm.length,0);assert.equal(zero.state.log.length,0);
  const one=harness({outside:{posts:[],news:news(2)}});
  await one.cron();assert.deepEqual(titles(one),['새 기사 2']);
});

test('끈 사람(kinds.evening=false)에게는 안 보내고 skipped_off 한 줄 — 같은 날 다시 안 세고, 다른 종류를 꺼도 저녁은 간다',async()=>{
  const off=harness({prefs:{kinds:{evening:false}}});
  assert.deepEqual((await (await off.cron()).json()).evening,{sent:0,held:0,off:1});
  assert.equal(off.state.fcm.length,0);assert.deepEqual(off.state.log.map(l=>l.status),['skipped_off']);
  await off.cron();assert.equal(off.state.log.length,1);
  const other=harness({prefs:{kinds:{morning:false,family:false}}});
  await other.cron();assert.equal(other.state.fcm.length,1);
});

test('조용한 시간이면 보내지 않고 held_quiet 한 줄(그날은 다시 안 보냄)',async()=>{
  const quiet=harness({prefs:{quiet:{from:'18:00',to:'08:00'}}});
  assert.deepEqual((await (await quiet.cron()).json()).evening,{sent:0,held:1,off:0});
  assert.equal(quiet.state.fcm.length,0);assert.deepEqual(quiet.state.log.map(l=>[l.ref_key,l.status]),[['now:2026-11-25','held_quiet']]);
  await quiet.cron();assert.equal(quiet.state.fcm.length,0);assert.equal(quiet.state.log.length,1);
  // 기본 조용한 시간(22~07시)은 18:22에 걸리지 않는다.
  const plain=harness({prefs:{kinds:{evening:true}}});
  await plain.cron();assert.equal(plain.state.fcm.length,1);
});

test('outside 기능 작업공간이 정해지지 않았거나 기기가 없으면 아무것도 읽거나 보내지 않는다. FCM 비밀값이 없으면 세기만',async()=>{
  for(const feature of [null,'not-a-uuid',OTHER_WS.replace('2','9')]){
    const h=harness({feature});
    const out=await (await h.cron()).json();
    assert.deepEqual(out.evening,{sent:0,held:0,off:0});
    assert.equal(h.state.fcm.length,0);
    assert.ok(h.state.rest.every(r=>!['app_outside_posts','app_news_items','app_push_log'].includes(r.table)||r.method==='DELETE'),String(feature));
  }
  const nodev=harness({devices:false});
  await nodev.cron();assert.equal(nodev.state.fcm.length,0);
  const nofcm=harness({fcm:false});
  const out=await (await nofcm.cron()).json();
  assert.equal(out.now_lines,1);assert.equal(nofcm.state.fcm.length,0);assert.equal(nofcm.state.log.length,0);
});

test('다른 예약(morning)은 저녁 알림을 보내지 않는다',async()=>{
  for(const slot of ['morning']){
    const h=harness();await h.cron(slot);
    assert.equal(h.state.fcm.length,0,slot);
    assert.ok(h.state.rest.every(r=>r.table!=='app_outside_posts'),slot);
  }
});
