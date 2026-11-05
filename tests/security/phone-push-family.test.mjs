// FAMILY-잊지말기 4단계: phone-push 15분 예약(quarter)이 잊지 말기 새 제안을 "잊지 말기 n건"만으로 알린다(본문·내용 없음).
// 종류 끄기(skipped_off)·조용한 시간(held_quiet → 끝난 뒤 보냄)·같은 제안 묶음은 한 번만. 네트워크 없음, 모두 지어낸 값.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
const H=await import('../../supabase/functions/phone-push/handler.ts');

const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key',SECRET='synthetic-phone-push-cron-secret-0123456789';
const WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002',USER='b0000000-0000-4000-8000-000000000001';
const FN='https://synthetic.supabase.test/functions/v1/phone-push';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const SA=JSON.stringify({type:'service_account',project_id:'web2-phone-test',client_email:'push-sender@web2-phone-test.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
const reply=(status,body)=>new Response(body===undefined?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const NOTE_SECRET='가상제안내용표식';

function harness({now,notes=[],prefs=null,log=[],fcm=true}={}){
  const state={log:structuredClone(log),fcm:[],rest:[]};
  const fetcher=async(url,init={})=>{
    const u=new URL(url),method=init.method??'GET';
    if(u.origin==='https://oauth2.googleapis.com')return reply(200,{access_token:'ya29.synthetic'});
    if(u.origin==='https://fcm.googleapis.com'){state.fcm.push(JSON.parse(init.body));return reply(200,{name:'projects/x/messages/1'});}
    assert.equal(u.origin,SB);
    const table=u.pathname.slice('/rest/v1/'.length),q=u.searchParams,body=init.body?JSON.parse(init.body):undefined;
    state.rest.push({method,table,select:q.get('select')});
    const ws=q.get('workspace_id')?.replace('eq.','');
    if(table==='app_push_log'&&method==='DELETE')return reply(200,[]);
    if(table==='app_push_devices'&&method==='GET'){
      const all=[{id:'c0000000-0000-4000-8000-0000000000a1',workspace_id:WS,fcm_token:'devTokenAAAA_bbbb:cccc-000111'},{id:'c0000000-0000-4000-8000-0000000000a2',workspace_id:WS2,fcm_token:'devTokenBBBB_cccc:dddd-222333'}];
      return reply(200,ws?all.filter(d=>d.workspace_id===ws):all);
    }
    if(table===H.FAMILY_TABLE){
      // service_role이 읽을 수 있는 칸만(migration 20261105100000): id·workspace_id·status·created_at 안에서.
      for(const c of q.get('select').split(','))assert.ok(['id','workspace_id','kind','body','origin_day','source_ref','status','created_at'].includes(c),c);
      assert.doesNotMatch(q.get('select'),/body|kind|said_when|drive_url/,'알림은 내용 칸을 읽지 않는다');
      assert.equal(q.get('status'),'eq.new');
      return reply(200,notes.filter(n=>n.workspace_id===ws).sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(n=>({id:n.id,created_at:n.created_at})));
    }
    if(table==='app_workspace_members')return reply(200,ws===WS?[{user_id:USER}]:[]);
    if(table==='app_profiles')return reply(200,[{notify_prefs:prefs}]);
    if(table==='app_push_log'&&method==='GET'){
      const kind=q.get('kind')?.replace('eq.',''),ref=decodeURIComponent(q.get('ref_key')?.replace('eq.','')??'');
      return reply(200,state.log.filter(r=>r.workspace_id===ws&&r.kind===kind&&r.ref_key===ref));
    }
    if(table==='app_push_log'&&method==='POST'){
      assert.deepEqual(Object.keys(body).sort(),['day','kind','ref_key','status','workspace_id'],'기록에는 제목·본문이 없다');
      const i=state.log.findIndex(r=>r.workspace_id===body.workspace_id&&r.kind===body.kind&&r.ref_key===body.ref_key&&r.day===body.day);
      if(i>=0)state.log[i]={...state.log[i],...body};else state.log.push(body);
      return reply(201);
    }
    if(table==='app_push_devices'&&method==='PATCH')return reply(204);
    throw new Error('unexpected '+method+' '+table);
  };
  const handler=H.createPhonePushHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,PHONE_PUSH_CRON_SECRET:SECRET,...(fcm?{FCM_SERVICE_ACCOUNT_JSON:SA}:{})})[n],fetch:fetcher,now:()=>now,log:()=>{}});
  const cron=slot=>handler(new Request(`${FN}?action=run&slot=${slot}`,{method:'POST',headers:{'Content-Type':'application/json','x-phone-push-cron-secret':SECRET},body:'{}'}));
  return {cron,state};
}
const note=(n,at)=>({id:`f0000000-0000-4000-8000-00000000000${n}`,workspace_id:WS,status:'new',created_at:at,body:NOTE_SECRET});
const DAY=Date.parse('2026-11-05T03:00:00Z'); // 12:00 KST
const NIGHT=Date.parse('2026-11-05T14:00:00Z'); // 23:00 KST

test('quarter: 새 제안이 있는 작업공간에 "잊지 말기 n건" 한 번만, 내용·본문 없음, 기록은 종류·열쇠·상태만',async()=>{
  const h=harness({now:DAY,notes:[note(1,'2026-11-05T01:00:00Z'),note(2,'2026-11-05T02:00:00Z')]});
  const r=await h.cron('quarter');assert.equal(r.status,200);
  const out=await r.json();
  assert.equal(out.family.sent,1);
  assert.equal(h.state.fcm.length,1);
  const msg=JSON.stringify(h.state.fcm[0]);
  assert.match(msg,/잊지 말기 2건/);assert.doesNotMatch(msg,new RegExp(NOTE_SECRET));
  assert.equal(h.state.fcm[0].message.data.kind,'family');assert.equal(h.state.fcm[0].message.data.open,H.FAMILY_OPEN);
  assert.deepEqual(h.state.log.map(l=>[l.kind,l.ref_key,l.status]),[['family',`fam:${Math.floor(Date.parse('2026-11-05T02:00:00Z')/1000)}`,'sent']]);
  // 같은 제안 묶음이면 다시 보내지 않는다. 다른 작업공간(제안 없음)에는 보내지 않는다.
  await h.cron('quarter');assert.equal(h.state.fcm.length,1);
  // 새 제안이 생기면 한 번 더.
  const h2=harness({now:DAY,notes:[note(1,'2026-11-05T01:00:00Z'),note(3,'2026-11-05T02:30:00Z')],log:h.state.log});
  await h2.cron('quarter');assert.equal(h2.state.fcm.length,1);
});

test('조용한 시간이면 held_quiet로만 남기고, 끝난 뒤 첫 실행에서 보낸다. 끄면 skipped_off',async()=>{
  const notes=[note(1,'2026-11-05T13:30:00Z')];
  const night=harness({now:NIGHT,notes});
  await night.cron('quarter');
  assert.equal(night.state.fcm.length,0);assert.deepEqual(night.state.log.map(l=>l.status),['held_quiet']);
  const morning=harness({now:Date.parse('2026-11-05T22:30:00Z'),notes,log:night.state.log}); // 07:30 KST
  await morning.cron('quarter');
  assert.equal(morning.state.fcm.length,1);assert.deepEqual(morning.state.log.map(l=>l.status),['sent']);
  const off=harness({now:DAY,notes,prefs:{kinds:{family:false}}});
  await off.cron('quarter');
  assert.equal(off.state.fcm.length,0);assert.deepEqual(off.state.log.map(l=>l.status),['skipped_off']);
  const customQuiet=harness({now:DAY,notes,prefs:{quiet:{from:'11:00',to:'13:00'}}});
  await customQuiet.cron('quarter');assert.equal(customQuiet.state.fcm.length,0);
});

test('다른 예약·FCM 비밀값 없음이면 잊지 말기를 읽지도 보내지도 않는다',async()=>{
  for(const slot of ['morning','evening','friday']){
    const h=harness({now:DAY,notes:[note(1,'2026-11-05T01:00:00Z')]});
    await h.cron(slot);
    assert.ok(h.state.rest.every(c=>c.table!==H.FAMILY_TABLE),slot);assert.equal(h.state.fcm.length,0);
  }
  const h=harness({now:DAY,notes:[note(1,'2026-11-05T01:00:00Z')],fcm:false});
  await h.cron('quarter');assert.equal(h.state.fcm.length,0);assert.ok(h.state.rest.every(c=>c.table!==H.FAMILY_TABLE));
});

test('규칙: familyDecision·familyTitle',()=>{
  assert.equal(H.familyDecision(null,DAY),'send');
  assert.equal(H.familyDecision(null,NIGHT),'held_quiet');
  assert.equal(H.familyDecision({kinds:{family:false}},DAY),'skipped_off');
  assert.equal(H.familyDecision({kinds:{task_due:false}},DAY),'send');
  assert.equal(H.familyDecision({quiet:{from:'00:00',to:'00:00'}},NIGHT),'send');
  assert.equal(H.familyTitle(3),'잊지 말기 3건');assert.equal(H.familyTitle(120),'잊지 말기 99+건');
});
