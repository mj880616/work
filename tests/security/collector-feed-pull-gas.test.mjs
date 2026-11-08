import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// S52-46 FEED-최신화즉시수집: docs/ops/collector-feed.gs의 웹 앱(doPost)·1회용 실행(feedPull_run)을 node에서 돌린다.
// 네트워크·Drive 없음. 값은 모두 지어낸 것이다.
const source=readFileSync(new URL('../../docs/ops/collector-feed.gs',import.meta.url),'utf8');
const SECRET='k'.repeat(64);
function load(){
  const logs=[],props={},triggers=[],ran=[];
  const sandbox={module:{exports:{}},Logger:{log:m=>logs.push(String(m))},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=String(v);},deleteProperty:k=>{delete props[k];}})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({text:t,setMimeType(){return this;}})},
    ScriptApp:{getProjectTriggers:()=>triggers.slice(),deleteTrigger:t=>{triggers.splice(triggers.indexOf(t),1);},
      newTrigger:name=>({timeBased:()=>({after:ms=>({create:()=>{const t={name,ms,getHandlerFunction:()=>name};triggers.push(t);return t;}})})})},
    UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>'{}'})},
    Utilities:{getUuid:()=>'00000000-0000-4000-8000-000000000000'}};
  vm.createContext(sandbox);
  vm.runInContext(source,sandbox,{filename:'collector-feed.gs'});
  // 실제 보내기 대신 무엇을 돌렸는지만 적는다.
  sandbox.tgFeed_runCore_=()=>{ran.push('telegram');return null;};
  sandbox.callFeed_runCore_=()=>{ran.push('call');return null;};
  return {fn:sandbox.module.exports,sandbox,logs,props,triggers,ran};
}
const post=(g,body)=>JSON.parse(g.sandbox.doPost({postData:{contents:typeof body==='string'?body:JSON.stringify(body)}}).text);

test('pure: body shape, secret compare, state, decide, next', () => {
  const {fn}=load();
  assert.deepEqual({...fn.feedPullParse(JSON.stringify({secret:'a',source:'call'}))},{secret:'a',source:'call'});
  for(const bad of ['',null,'[]','{}',JSON.stringify({secret:'a',source:'news'}),JSON.stringify({secret:'a',source:'call',x:1}),JSON.stringify({secret:1,source:'call'}),'{"secret":"'+'a'.repeat(600)+'","source":"call"}'])
   assert.equal(fn.feedPullParse(bad),null,String(bad));
  assert.equal(fn.feedPullSecretOk(SECRET,SECRET),true);
  for(const [g,e] of [[SECRET.slice(1),SECRET],[SECRET+'k',SECRET],['x'+SECRET.slice(1),SECRET],['short','short'],['',''],[null,SECRET]])assert.equal(fn.feedPullSecretOk(g,e),false);
  const T=Date.parse('2026-11-08T01:00:00Z');
  const s0=fn.feedPullState('not json',T);assert.equal(s0.n,0);assert.equal(s0.want.length,0);
  const yday=fn.feedPullState(JSON.stringify({d:'2026-11-07',n:29,last:{call:T-1000},want:['call','x']}),T);
  assert.equal(yday.n,0,'new day resets the count');assert.equal(yday.last.call,T-1000);assert.deepEqual([...yday.want],['call']);
  const a=fn.feedPullDecide(s0,'telegram',T);assert.equal(a.take,true);assert.equal(a.state.n,1);assert.deepEqual([...a.state.want],['telegram']);
  assert.equal(fn.feedPullDecide(a.state,'telegram',T+60000).take,false,'3 minutes');
  assert.equal(fn.feedPullDecide(a.state,'call',T+60000).take,true,'other source');
  assert.equal(fn.feedPullDecide(a.state,'telegram',T+181000).take,true);
  assert.equal(fn.feedPullDecide({...a.state,n:30},'call',T).why,'daily');
  const n=fn.feedPullNext(['call','telegram']);assert.equal(n.source,'telegram');assert.deepEqual([...n.rest],['call']);
  assert.equal(fn.feedPullNext([]).source,'');
});

test('doPost: wrong or missing secret refused with the same short reply, no trigger', () => {
  const g=load();
  assert.deepEqual(post(g,{secret:SECRET,source:'telegram'}),{ok:false},'no secret stored yet');
  g.props.COLLECTOR_PULL_SECRET=SECRET;
  for(const body of [{secret:'wrong'.repeat(10),source:'telegram'},{secret:SECRET,source:'news'},'garbage',{secret:SECRET}])assert.deepEqual(post(g,body),{ok:false});
  assert.equal(g.triggers.length,0);
  assert.equal(g.props.FEED_PULL_STATE,undefined);
  assert.equal(g.logs.some(l=>l.includes(SECRET)),false,'secret never logged');
});

// S53-11: 거절 까닭은 실행 기록에 한 줄 — 불일치 사실만(값·길이·앞자리 단서 없음). 답은 그대로 {ok:false}.
test('doPost: secret mismatch logs one plain line without any hint; bad body logs its own line', () => {
  const g=load();
  g.props.COLLECTOR_PULL_SECRET=SECRET;
  const given='z'.repeat(40);
  assert.deepEqual(post(g,{secret:given,source:'call'}),{ok:false});
  assert.deepEqual([...g.logs],['[최신화] 비밀값이 맞지 않음']);
  g.logs.length=0;
  assert.deepEqual(post(g,'garbage'),{ok:false});
  assert.deepEqual([...g.logs],['[최신화] 몸통 모양이 다름']);
  g.logs.length=0;
  const h=load();
  assert.deepEqual(post(h,{secret:SECRET,source:'telegram'}),{ok:false},'nothing stored');
  assert.deepEqual([...h.logs],['[최신화] 비밀값이 맞지 않음']);
  for(const l of [...g.logs,...h.logs])assert.doesNotMatch(l,/\d|k{4}|z{4}/,'no length or value hint');
});

test('doPost: right secret makes one one-shot trigger; repeats within 3 minutes ignored; feedPull_run runs one source at a time', () => {
  const g=load();g.props.COLLECTOR_PULL_SECRET=SECRET;
  assert.deepEqual(post(g,{secret:SECRET,source:'telegram'}),{ok:true});
  assert.deepEqual(post(g,{secret:SECRET,source:'telegram'}),{ok:true},'second within 3 minutes: same reply, ignored');
  assert.deepEqual(post(g,{secret:SECRET,source:'call'}),{ok:true});
  assert.equal(g.triggers.length,1,'only one one-shot trigger');
  assert.equal(g.triggers[0].name,'feedPull_run');assert.equal(g.triggers[0].ms,1000);
  const st=JSON.parse(g.props.FEED_PULL_STATE);assert.equal(st.n,2);assert.deepEqual(st.want,['telegram','call']);
  g.sandbox.feedPull_run();
  assert.deepEqual(g.ran,['telegram']);
  assert.equal(g.triggers.length,1,'a new one-shot trigger for the remaining source');
  g.sandbox.feedPull_run();
  assert.deepEqual(g.ran,['telegram','call']);
  assert.equal(g.triggers.length,0,'nothing left, no trigger');
  g.sandbox.feedPull_run();
  assert.deepEqual(g.ran,['telegram','call'],'empty run does nothing');
});

test('doPost: 30 a day cap at the web app as a second guard', () => {
  const g=load();g.props.COLLECTOR_PULL_SECRET=SECRET;
  const T=Date.now();
  g.props.FEED_PULL_STATE=JSON.stringify({d:g.fn.feedPullState('',T).d,n:30,last:{},want:[]});
  assert.deepEqual(post(g,{secret:SECRET,source:'call'}),{ok:true});
  assert.equal(g.triggers.length,0);
  assert.equal(JSON.parse(g.props.FEED_PULL_STATE).n,30);
});

test('feedPull_makeSecret: makes once, never logs the value', () => {
  const g=load();
  g.sandbox.feedPull_makeSecret();
  const v=g.props.COLLECTOR_PULL_SECRET;assert.ok(v&&v.length>=32);
  g.sandbox.feedPull_makeSecret();assert.equal(g.props.COLLECTOR_PULL_SECRET,v);
  assert.equal(g.logs.some(l=>l.includes(v)),false);
});
