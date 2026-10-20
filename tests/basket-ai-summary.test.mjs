import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// AI-서버연동 S4: the screen side of ai-assist kind=link_summary. Synthetic IDs and text only.
const mod=await import('../app/basket-ai-summary.js');
const note='10000000-0000-4000-8000-000000000001',org='30000000-0000-4000-8000-000000000001';
const rt=(over={})=>({config:{url:'https://fixture.invalid',key:'anon-fixture'},session:{ensure:async()=>true,read:()=>({access_token:'token-fixture'})},...over});
const reply=(status,body)=>async()=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const ask=(fetcher,opts={})=>mod.requestLinkSummary({noteId:note,targetKind:'organization',targetId:org},{rt:rt(),fetcher,online:()=>true,...opts});

test('sends only kind, note_id, target_kind and target_id to ai-assist with the signed-in token',async()=>{
  const seen=[];
  const result=await ask(async(url,init)=>{seen.push({url,init});return new Response(JSON.stringify({ok:true,kind:'link_summary',summary:'합성 요약 두 문장.'}),{status:200});});
  assert.deepEqual(result,{ok:true,summary:'합성 요약 두 문장.'});
  assert.equal(seen.length,1);
  assert.equal(seen[0].url,'https://fixture.invalid/functions/v1/ai-assist');
  assert.equal(seen[0].init.method,'POST');
  assert.equal(seen[0].init.headers.Authorization,'Bearer token-fixture');
  assert.deepEqual(JSON.parse(seen[0].init.body),{kind:'link_summary',note_id:note,target_kind:'organization',target_id:org});
});

test('every server error code has a plain message, and unknown codes never leak raw text',async()=>{
  const handler=readFileSync(new URL('../supabase/functions/ai-assist/handler.ts',import.meta.url),'utf8');
  const block=handler.match(/export const MESSAGES[^{]*\{([\s\S]*?)\}\);/)[1];
  const codes=[...block.matchAll(/^\s*([a-z_]+):/gm)].map(m=>m[1]);
  assert.ok(codes.length>=15);
  for(const code of codes){
    assert.ok(mod.AI_SUMMARY_TEXT[code],code);
    const status=code==='monthly_limit'||code==='daily_limit'?429:code==='not_found'?404:503;
    const result=await ask(reply(status,{ok:false,error:code,message:'서버 문구'}));
    assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(result.message,mod.AI_SUMMARY_TEXT[code]);
  }
  const odd=await ask(reply(400,{ok:false,error:'__proto__',message:'<b>원문</b>'}));
  assert.equal(odd.code,'internal_error');assert.doesNotMatch(odd.message,/원문/);
});

test('limits and exclusions are not offered as retry; temporary failures are',async()=>{
  for(const code of ['monthly_limit','daily_limit','note_excluded','ai_not_configured','unsupported_kind'])assert.equal((await ask(reply(429,{ok:false,error:code}))).retry,false,code);
  for(const code of ['ai_busy','ai_timeout','ai_invalid_response','read_unavailable'])assert.equal((await ask(reply(503,{ok:false,error:code}))).retry,true,code);
});

test('an undeployed function (404 or a network error) reads as not ready, quietly',async()=>{
  const missing=await ask(reply(404,{code:'NOT_FOUND',message:'Requested function was not found'}));
  assert.equal(missing.code,'not_ready');assert.equal(missing.message,'AI 요약은 아직 준비 중이에요.');assert.equal(missing.retry,false);
  const blocked=await ask(async()=>{throw new TypeError('Failed to fetch');});
  assert.equal(blocked.code,'not_ready');
  const offline=await ask(async()=>{throw new TypeError('Failed to fetch');},{online:()=>false});
  assert.equal(offline.code,'offline');assert.equal(offline.retry,true);
});

test('a hung request stops at the client deadline as ai_timeout',async()=>{
  const result=await ask((url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))),{timeoutMs:20});
  assert.equal(result.code,'ai_timeout');assert.equal(result.retry,true);
});

test('a malformed or oversized success is refused as ai_invalid_response',async()=>{
  for(const body of [{ok:true,kind:'other',summary:'x'},{ok:true,kind:'link_summary',summary:'  '},{ok:true,kind:'link_summary',summary:'가'.repeat(2001)},{ok:true,kind:'link_summary'}])
    assert.equal((await ask(reply(200,body))).code,'ai_invalid_response');
  assert.equal((await ask(reply(502,'<html>bad gateway</html>'))).code,'ai_busy');
});

test('no session or bad ids never call the server',async()=>{
  let calls=0;const count=async()=>{calls++;return new Response('{}');};
  assert.equal((await mod.requestLinkSummary({noteId:note,targetKind:'organization',targetId:org},{rt:rt({session:{ensure:async()=>false,read:()=>null}}),fetcher:count})).code,'session_required');
  assert.equal((await mod.requestLinkSummary({noteId:'x',targetKind:'organization',targetId:org},{rt:rt(),fetcher:count})).code,'invalid_request');
  assert.equal((await mod.requestLinkSummary({noteId:note,targetKind:'meeting',targetId:org},{rt:rt(),fetcher:count})).code,'invalid_request');
  assert.equal(calls,0);
});

test('D11: an empty box is filled, a box with text keeps it and gets a proposal',()=>{
  assert.equal(mod.placeAiSummary('',"합성 요약").fill,'합성 요약');
  assert.equal(mod.placeAiSummary(' \n','합성 요약').fill,'합성 요약');
  const kept=mod.placeAiSummary('직접 쓴 요약','합성 요약','연결');
  assert.equal(kept.fill,null);assert.equal(kept.proposal,'합성 요약');assert.match(kept.status,/이걸로 바꾸기/);
  assert.match(mod.placeAiSummary('','합성','연결').status,/\[연결\]/);
});

test('the button is hidden for diary, archived, AI-excluded and empty notes',()=>{
  const ok={kind:'basket',archived_at:null,ai_export_allowed:true,raw_text:'합성 원문'};
  assert.equal(mod.aiSummaryAllowed(ok),true);
  assert.equal(mod.aiSummaryAllowed({...ok,kind:'note'}),true);
  for(const bad of [{...ok,kind:'diary'},{...ok,archived_at:'2026-10-01T00:00:00Z'},{...ok,ai_export_allowed:false},{...ok,ai_export_allowed:null},{...ok,raw_text:'  '},null])assert.equal(mod.aiSummaryAllowed(bad),false);
});

test('markup escapes the proposal and locks only the run button while busy',()=>{
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const busy=mod.aiSummaryMarkup({...mod.newAiState(),busy:true},'organization:'+org,'data-manual',esc);
  assert.match(busy,/data-manual-ai-run="organization:[^"]+" aria-label="AI 요약 만들기" disabled/);assert.match(busy,/요약 만드는 중…/);
  const proposal=mod.aiSummaryMarkup({...mod.newAiState(),proposal:'<img src=x onerror=alert(1)>'},'k','data-manual',esc);
  assert.doesNotMatch(proposal,/<img/);assert.match(proposal,/이걸로 바꾸기/);
  assert.match(mod.aiSummaryMarkup({...mod.newAiState(),retry:true,status:'AI가 지금 바빠요.'},'k','data-manual',esc),/>다시 시도</);
});
