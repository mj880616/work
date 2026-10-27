import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// OPS-수집멈춤알림: docs/ops/collector-feed.gs의 멈춤 알림(순수 함수 + 알리기 껍데기)을 node에서 돌리고,
// 만든 몸통이 서버 drive-summary(parseHeartbeat)에서 그대로 읽히는지 본다. 네트워크·Drive 없음. 값은 모두 지어낸 것이다.
const core=await import('../../supabase/functions/drive-summary/core.mjs');
const source=readFileSync(new URL('../../docs/ops/collector-feed.gs',import.meta.url),'utf8');
function load(extra={}){
  const logs=[],fetches=[],props={};
  const sandbox={module:{exports:{}},Logger:{log:m=>logs.push(String(m))},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=String(v);},deleteProperty:k=>{delete props[k];}})},
    UrlFetchApp:{fetch:(url,opts)=>{fetches.push({url,opts});return {getResponseCode:()=>200,getContentText:()=>'{}'};}},...extra};
  vm.createContext(sandbox);
  vm.runInContext(source,sandbox,{filename:'collector-feed.gs'});
  return {fn:sandbox.module.exports,sandbox,logs,fetches,props};
}
const {fn}=load();
const T0=Date.parse('2026-10-27T01:00:00Z'),H=3600000;

test('kind pick keeps the heavier outcome; 429 error code picks the limit kind', () => {
  assert.equal(fn.feedKindPick('', 'limit_day'), 'limit_day');
  assert.equal(fn.feedKindPick('limit_day', 'bad'), 'bad');
  assert.equal(fn.feedKindPick('broken', 'limit_ai'), 'broken');
  assert.equal(fn.feedKindPick('limit_ai', 'bad'), 'limit_ai');
  assert.equal(fn.feedLimitKind('AI_MONTHLY_LIMIT'), 'limit_ai');
  assert.equal(fn.feedLimitKind('DAILY_LIMIT'), 'limit_day');
  assert.equal(fn.feedLimitKind(undefined), 'limit_day');
});

test('stall next: ok run, sending moves last_at, first run sets the baseline', () => {
  const first=fn.feedStallNext(null,{test:false,kind:'',sent:false},T0);
  assert.equal(first.state,'ok'); assert.equal(first.lastAt,new Date(T0).toISOString()); assert.equal(first.base,first.lastAt);
  const idle=fn.feedStallNext({bad:0,sentAt:'',base:first.base},{test:false,kind:'',sent:false},T0+5*H);
  assert.equal(idle.lastAt,first.base,'nothing sent → last_at stays at the baseline');
  const sent=fn.feedStallNext({bad:0,sentAt:'',base:first.base},{test:false,kind:'',sent:true},T0+5*H);
  assert.equal(sent.lastAt,new Date(T0+5*H).toISOString()); assert.equal(sent.sentAt,sent.lastAt);
});

test('stall next: transient failures become failing only on the third run in a row; broken and AI cap are immediate; daily cap is not a failure', () => {
  let prev=null; const states=[];
  for(let i=0;i<4;i++){const n=fn.feedStallNext(prev,{test:false,kind:'bad',sent:false},T0+i*H);states.push(n.state);prev={bad:n.bad,sentAt:n.sentAt,base:n.base};}
  assert.deepEqual(states,['ok','ok','failing','failing']);
  const healed=fn.feedStallNext(prev,{test:false,kind:'',sent:true},T0+9*H);
  assert.equal(healed.state,'ok'); assert.equal(healed.bad,0);
  assert.equal(fn.feedStallNext(null,{test:false,kind:'broken',sent:false},T0).state,'broken');
  assert.equal(fn.feedStallNext(null,{test:false,kind:'limit_ai',sent:false},T0).state,'limit_ai');
  const day=fn.feedStallNext({bad:2,sentAt:'',base:''},{test:false,kind:'limit_day',sent:true},T0);
  assert.equal(day.state,'limit_day'); assert.equal(day.bad,0);
});

test('stall next: test mode reports test and never moves last_at', () => {
  const n=fn.feedStallNext({bad:1,sentAt:'2026-10-20T00:00:00.000Z',base:'2026-10-19T00:00:00.000Z'},{test:true,kind:'bad',sent:true},T0);
  assert.equal(n.state,'test'); assert.equal(n.lastAt,'2026-10-20T00:00:00.000Z');
});

test('stall clean drops malformed saved values', () => {
  assert.equal(fn.feedStallClean(null),null);
  assert.equal(fn.feedStallClean('x'),null);
  assert.deepEqual(JSON.parse(JSON.stringify(fn.feedStallClean({bad:-4,sentAt:'파일 이름',base:'2026-10-19T00:00:00.000Z'}))),{bad:0,sentAt:'',base:'2026-10-19T00:00:00.000Z'});
  assert.equal(fn.feedStallClean({bad:9999}).bad,99);
});

const STATES=['ok','test','limit_day','limit_ai','failing','broken'];   // drive-summary core.mjs COLLECTOR_SEND_STATES와 같은 목록
test('the report body carries only source, last_at and state, and every state the script can produce is on the list', () => {
  for(const source of ['telegram_send','call_send'])for(const state of STATES){
    const body=fn.feedReportBody(source,'2026-10-27T01:00:00.000Z',state);
    assert.deepEqual(Object.keys(body).sort(),['last_at','source','state']);
  }
  const seen=new Set();
  for(const kind of ['','limit_day','bad','limit_ai','broken'])for(const bad of [0,1,2])for(const test of [false,true])
    seen.add(fn.feedStallNext({bad,sentAt:'',base:''},{test,kind,sent:false},T0).state);
  for(const s of seen)assert.ok(STATES.includes(s),s);
});
// 서버(drive-summary) 쪽 목록은 Edge PR(OPS-수집멈춤알림 1단계)이 main에 들어온 뒤부터 이 시험이 켜진다.
test('the server accepts the report body for every state and source', {skip:!core.COLLECTOR_SEND_STATES&&'Edge PR 합치기 전'}, () => {
  assert.deepEqual([...core.COLLECTOR_SEND_STATES],STATES);
  for(const source of ['telegram_send','call_send'])for(const state of STATES)
    assert.ok(core.parseHeartbeat(JSON.stringify(fn.feedReportBody(source,'2026-10-27T01:00:00.000Z',state)),new Date('2026-10-27T01:05:00Z')),`${source} ${state}`);
});

test('report: no secret means no request; with a secret one POST with the header and the closed body', () => {
  const none=load();
  none.sandbox.feedReport_({source:'call_send',lastAt:'2026-10-27T01:00:00.000Z',state:'ok'});
  assert.equal(none.fetches.length,0); assert.match(none.logs.join('\n'),/알리지 않았습니다/);
  const withSecret=load(); withSecret.props.COLLECTOR_HEARTBEAT_SECRET='s'.repeat(40);
  withSecret.sandbox.feedReport_({source:'call_send',lastAt:'2026-10-27T01:00:00.000Z',state:'limit_ai'});
  assert.equal(withSecret.fetches.length,1);
  const f=withSecret.fetches[0];
  assert.match(f.url,/drive-summary\?action=heartbeat$/); assert.equal(f.opts.method,'post');
  assert.deepEqual(Object.keys(f.opts.headers),['x-collector-heartbeat-secret']);
  assert.deepEqual(JSON.parse(f.opts.payload),{source:'call_send',last_at:'2026-10-27T01:00:00.000Z',state:'limit_ai'});
  assert.doesNotMatch(withSecret.logs.join('\n'),/s{40}/,'the secret is never logged');
});

test('guard: a thrown error is reported as broken and rethrown; a failed report never hides it; a normal result is reported once', () => {
  const ctx=load(); ctx.props.COLLECTOR_HEARTBEAT_SECRET='s'.repeat(40);
  assert.throws(()=>ctx.sandbox.feedGuard_('call',()=>{throw new Error('비밀값 불일치(401)');}),/비밀값 불일치/);
  assert.equal(ctx.fetches.length,1); assert.equal(JSON.parse(ctx.fetches[0].opts.payload).state,'broken'); assert.equal(JSON.parse(ctx.fetches[0].opts.payload).source,'call_send');
  const down=load({}); down.props.COLLECTOR_HEARTBEAT_SECRET='s'.repeat(40);
  down.sandbox.UrlFetchApp.fetch=()=>{throw new Error('network');};
  assert.throws(()=>down.sandbox.feedGuard_('tg',()=>{throw new Error('원래 오류');}),/원래 오류/);
  const ok=load(); ok.props.COLLECTOR_HEARTBEAT_SECRET='s'.repeat(40);
  ok.sandbox.feedGuard_('tg',()=>({source:'telegram_send',lastAt:'2026-10-27T01:00:00.000Z',state:'ok'}));
  ok.sandbox.feedGuard_('tg',()=>null);
  assert.equal(ok.fetches.length,1);
});

test('state files keep the stall record through save and load for both feeds', () => {
  const ctx=load();
  const stall={bad:2,sentAt:'2026-10-26T23:00:00.000Z',base:'2026-10-20T00:00:00.000Z'};
  ctx.sandbox.callFeed_saveState_({since:'2026-10-26T00:00:00.000Z',stall});
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.sandbox.callFeed_loadState_().stall)),stall);
  const compact=ctx.fn.tgFeedCompactState({startDay:'2026-10-20',rooms:{},attempts:{},chain:0,stall,fetch:{d:'',n:0}});
  assert.deepEqual(compact.stall,stall);
  ctx.sandbox.tgFeed_saveState_({startDay:'2026-10-20',rooms:{},attempts:{},chain:0,stall,fetch:{d:'',n:0}});
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.sandbox.tgFeed_loadState_().stall)),stall);
});
