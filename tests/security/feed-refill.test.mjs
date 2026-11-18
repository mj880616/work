// NEWS-전면개편 P2c(S51-15): 예약 입구 action=refill — 이미 들어온 글의 본문 블록 다시 뽑기(news-feed·outside-feed).
// 네트워크 없음. 사이트·Supabase는 지어낸 응답이다(example 모양 주소·합성 글).
import test from 'node:test';
import assert from 'node:assert/strict';

const NH=await import('../../supabase/functions/news-feed/handler.ts');
const OH=await import('../../supabase/functions/outside-feed/handler.ts');
const NC=await import('../../supabase/functions/_shared/news-catalog.ts');
const OC=await import('../../supabase/functions/_shared/outside-catalog.ts');
const E=await import('../../supabase/functions/_shared/feed-extract.ts');
const NOW=Date.parse('2026-11-06T05:00:00Z');
const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key';
const NSECRET='synthetic-news-feed-cron-secret-0123456789abc',OSECRET='synthetic-outside-feed-cron-secret-0123456789';
const WS='a0000000-0000-4000-8000-000000000001';
const LONG='노동자들은 오늘 합성 견본 기사 문단을 차례로 읽는다. 이 문단은 시험용으로 지어낸 글이다. '.repeat(5);
const BEM=n=>`https://www.beminor.com/news/articleView.html?idxno=${n}`;
const PAGE=n=>`<html><head><meta property="og:title" content="합성 기사 ${n}"></head><body><article id="article-view-content-div"><p>${LONG}</p></article></body></html>`;
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const CUR=E.ruleId('news-beminor',NC.newsSourceByKey('news-beminor').extract);

function world({table,rows,sites={},clockStep=0}){
 const calls=[],bodies=[];let t=NOW;
 const res=(v,s=200)=>new Response(v===null?null:JSON.stringify(v),{status:s,headers:{'content-type':'application/json'}});
 const doFetch=async(url,init={})=>{
  const u=new URL(url),method=init.method??'GET',body=init.body?JSON.parse(init.body):undefined;
  calls.push({url:u.href,method,body,prefer:init.headers?.Prefer});
  if(u.origin===SB){
   const p=u.pathname.replace('/rest/v1/','');
   if(p==='rpc/app_workspace_ai_month')return res({month:'2026-11',exempt:false,cap_krw:3000,openai_input_tokens:0,openai_output_tokens:0,gemini:[]}); // AI-사람별한도: 기본은 한도 아래
   if(p==='app_feed_bodies'&&method==='POST'){for(const b of [].concat(body))bodies.push({b,prefer:init.headers.Prefer});return res(null,201);}
   if(p===table&&method==='GET'){
    const q=u.searchParams;
    assert.match(q.get('select'),/app_feed_bodies\(state,reason,rule\)/);
    const key=q.get('source_key').slice(3);
    return res(rows.filter(r=>r.source_key===key).slice(0,Number(q.get('limit'))));
   }
   return res(null,204);
  }
  t+=clockStep;
  const site=sites[u.href];
  if(site===undefined)return new Response('',{status:404});
  return new Response(site.body,{status:site.status??200,headers:{'content-type':'text/html; charset=utf-8'}});
 };
 const env=n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,NEWS_FEED_CRON_SECRET:NSECRET,OUTSIDE_FEED_CRON_SECRET:OSECRET})[n];
 const nh=NH.createNewsFeedHandler({env,fetch:doFetch,now:()=>t,sleep:async()=>{},log:()=>{}});
 const oh=OH.createOutsideFeedHandler({env,fetch:doFetch,now:()=>t,sleep:async()=>{},log:()=>{}});
 const call=async(h,fn,header,secret,body,action='refill')=>{const r=await h(new Request(`${SB}/functions/v1/${fn}?action=${action}`,{method:'POST',headers:{[header]:secret,'content-type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,json:await r.json()};};
 return {calls,bodies,fetch:doFetch,news:(b,a)=>call(nh,'news-feed',NH.CRON_HEADER,NSECRET,b,a),outside:(b,a)=>call(oh,'outside-feed',OH.CRON_HEADER,OSECRET,b,a),unauth:(b)=>nh(new Request(`${SB}/functions/v1/news-feed?action=refill`,{method:'POST',headers:{[NH.CRON_HEADER]:'wrong-secret-value-0123456789abcdef','content-type':'application/json'},body:JSON.stringify(b)}))};
}

test('다시 뽑을 줄 고르기: 블록 없음·timeout·옛 판 실패만, 지금 판 실패·ok는 아님',()=>{
 for(const f of [NH.needsRefill,OH.needsRefill]){
  assert.equal(f(null,'k@3'),true);
  assert.equal(f({state:'failed',reason:'timeout',rule:'k@3'},'k@3'),true,'timeout은 판과 상관없이 다시');
  assert.equal(f({state:'lead',reason:'no_body',rule:'k@2'},'k@3'),true);
  assert.equal(f({state:'failed',reason:'http_4xx',rule:null},'k@3'),true,'옛 줄(판 없음)');
  assert.equal(f({state:'lead',reason:'no_body',rule:'k@3'},'k@3'),false,'지금 판으로 이미 실패 — 판이 오를 때까지 다시 안 함');
  assert.equal(f({state:'failed',reason:'robots',rule:'k@3'},'k@3'),false);
  assert.equal(f({state:'ok',reason:null,rule:'k@3'},'k@3'),false,'지금 판 ok는 다시 안 뽑음');
 }
 assert.equal(NH.needsRefill({state:'ok',reason:null,rule:'k@1'},'k@3'),false,'뉴스 쪽 ok는 그대로(범위 밖)');
 // S61-44: 바깥 소식은 판이 오른 ok 줄도 다시 뽑는다. 판이 비어 있는 ok 줄은 아님.
 assert.equal(OH.needsRefill({state:'ok',reason:null,rule:'k@1'},'k@3'),true,'판이 오른 ok 줄');
 assert.equal(OH.needsRefill({state:'ok',reason:null,rule:null},'k@3'),false,'판 없는 ok 줄은 한꺼번에 다시 읽지 않음');
 assert.equal(OH.needsRefill({state:'ok',reason:null,rule:'k@1'},null),false);
 assert.equal(NH.REFILL_PER_SOURCE,20);assert.equal(OH.REFILL_PER_SOURCE,20);assert.equal(NH.REFILL_DAYS,30);
});

test('news-feed refill: 고른 줄만 다시 읽어 merge로 고침, 사이트마다 20개 상한, 건수만 응답',async()=>{
 const rows=[];
 for(let n=1;n<=30;n++)rows.push({id:id(n),workspace_id:WS,lane:'media',source_key:'news-beminor',url:BEM(n),title:`합성 기사 ${n}`,summary:null,publisher:null,published_at:null,
  app_feed_bodies:n<=3?{state:'ok',reason:null,rule:CUR}:n<=5?{state:'lead',reason:'no_body',rule:CUR}:n<=10?{state:'failed',reason:'timeout',rule:null}:{state:'lead',reason:'paywall',rule:'news-beminor@1'}});
 rows.push({id:id(99),workspace_id:WS,lane:'media',source_key:'news-beminor',url:BEM(99),title:'합성 기사 99',summary:null,publisher:null,published_at:null,app_feed_bodies:null});
 const sites=Object.fromEntries(rows.map(r=>[r.url,{body:PAGE(1)}]));
 const w=world({table:'app_news_items',rows,sites});
 const out=await w.news({source:'news-beminor'});
 assert.equal(out.status,200);
 assert.deepEqual(out.json,{ok:true,step:'refill',source:'news-beminor',status:'ok',done:20,deferred:0,remaining:6});
 const read=w.calls.filter(c=>c.url.startsWith('https://www.beminor.com/news/')).map(c=>c.url);
 for(const n of [1,2,3,4,5])assert.ok(!read.includes(BEM(n)),`안 고를 줄 ${n}`);
 assert.ok(read.includes(BEM(6)),'timeout 줄');
 assert.ok(w.bodies.every(x=>/merge-duplicates/.test(x.prefer)),'지우지 않고 그 줄 고침');
 assert.ok(w.bodies.every(x=>x.b.rule===CUR&&x.b.state==='ok'));
 assert.ok(!w.calls.some(c=>c.url.includes('api.openai.com')),'AI 없음');
 assert.ok(!w.calls.some(c=>c.url.includes('/app_news_days')),'열기 하루 한도 안 셈');
 const q=new URL(w.calls.find(c=>c.url.includes('/app_news_items?')).url).searchParams;
 assert.equal(q.get('lane'),'eq.media');assert.match(q.get('created_at'),/^gte\.2026-10-07/);assert.equal(q.get('limit'),String(NH.REFILL_SCAN));
 assert.ok(!JSON.stringify(out.json).includes('합성'),'응답에 글자 없음');
});

test('news-feed refill: 다시 못 읽으면 그 판 이름을 적어(영구 실패) 다음에 다시 고르지 않음, timeout은 다시',async()=>{
 const rows=[{id:id(1),workspace_id:WS,lane:'media',source_key:'news-beminor',url:BEM(1),title:'t',summary:null,publisher:null,published_at:null,app_feed_bodies:null},
  {id:id(2),workspace_id:WS,lane:'media',source_key:'news-beminor',url:BEM(2),title:'t',summary:null,publisher:null,published_at:null,app_feed_bodies:null}];
 const w=world({table:'app_news_items',rows,sites:{[BEM(1)]:{body:'',status:404},[BEM(2)]:{body:'',status:503}}});
 await w.news({source:'news-beminor'});
 const by=Object.fromEntries(w.bodies.map(x=>[x.b.news_item_id,x.b]));
 assert.deepEqual([by[id(1)].state,by[id(1)].reason,by[id(1)].rule],['failed','http_4xx',CUR]);
 assert.equal(NH.needsRefill(by[id(1)],CUR),false);
 assert.equal(by[id(2)].reason,'http_5xx');
});

test('news-feed refill: 시간 예산을 넘으면 멈추고 남은 수를 돌려줌, 키 확인·몸통 모양',async()=>{
 const rows=Array.from({length:10},(_,i)=>({id:id(i+1),workspace_id:WS,lane:'media',source_key:'news-beminor',url:BEM(i+1),title:'t',summary:null,publisher:null,published_at:null,app_feed_bodies:null}));
 const w=world({table:'app_news_items',rows,sites:Object.fromEntries(rows.map(r=>[r.url,{body:PAGE(1)}])),clockStep:NH.RUN_BUDGET_MS/4});
 const out=(await w.news({source:'news-beminor'})).json;
 assert.ok(out.done>=1&&out.done<10);assert.equal(out.done+out.deferred,10);assert.equal(out.remaining,out.deferred);
 assert.equal((await w.news({source:'news-nope'})).status,400);
 assert.equal((await w.news({source:'news-beminor',url:'https://x.example/'})).status,400,'주소를 받지 않음');
 assert.equal((await w.unauth({source:'news-beminor'})).status,401);
 const off=(await w.news({source:'news-labourstart'})).json;assert.equal(off.ok,true);
});

test('outside-feed refill: 학비노조처럼 옛 판 실패 줄을 글 쪽 다시 읽어 고침, 텔레그램은 하지 않음',async()=>{
 const H=n=>`https://www.hakbi.org/board/media_reports/read/${n}`;
 const page=`<html><head><title>합성 제목</title></head><body><div class="board"><h3>합성 제목</h3><p>합성단체</p><p>6007</p><h4>공유하기</h4><ul><li>트위터</li></ul><div class="view"><p>${LONG}</p></div><p>목록보기</p></div></body></html>`;
 const cur=E.ruleId('hakbi',OC.sourceByKey('hakbi').extract);
 const rows=[{id:id(1),workspace_id:WS,source_key:'hakbi',url:H(1),title:'합성 제목',published_at:null,app_feed_bodies:{state:'failed',reason:'no_body',rule:'hakbi@2'}},
  {id:id(2),workspace_id:WS,source_key:'hakbi',url:H(2),title:'합성 제목',published_at:null,app_feed_bodies:[{state:'ok',reason:null,rule:cur}]},
  {id:id(3),workspace_id:WS,source_key:'hakbi',url:'https://other.example.com/x',title:'x',published_at:null,app_feed_bodies:null}];
 const w=world({table:'app_outside_posts',rows,sites:{[H(1)]:{body:page}}});
 const out=(await w.outside({source:'hakbi'})).json;
 assert.deepEqual(out,{ok:true,source:'hakbi',status:'ok',done:1,deferred:0,remaining:0});
 assert.equal(w.bodies.length,1);
 const b=w.bodies[0].b;
 assert.deepEqual([b.outside_post_id,b.state,b.rule],[id(1),'ok',cur]);assert.match(w.bodies[0].prefer,/merge-duplicates/);
 assert.ok(!w.calls.some(c=>c.url.startsWith('https://other.example.com')),'허용 밖 주소는 요청하지 않음');
 assert.ok(!w.calls.some(c=>c.url.includes('app_outside_sentences')||(c.url.includes('app_outside_posts')&&c.method!=='GET')),'문장 표·글 줄은 건드리지 않음');
 const tg=OC.OUTSIDE_CATALOG.find(s=>s.mode==='telegram');
 if(tg){const t=(await w.outside({source:tg.key})).json;assert.equal(t.status,'not_page');}
 assert.equal((await w.outside({source:'nope'})).status,400);
});

test('outside-feed refill: robots 예외 단체는 판이 오른 글만 한 번, 10개까지, 요청 사이 5초(명진 결정 11/13 A안)',async()=>{
 assert.equal(E.ruleId('kptu',OC.sourceByKey('kptu').extract),'kptu@2','공공운수노조 판 2(S61-37 글자 규칙)');
 const K=n=>`https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=${n}`;
 const page=`<html><head><title>합성 제목</title></head><body><div class="publishList_write"><p><span>${LONG}</span><span>13</span><span>일</span> &middot 합성</p></div></body></html>`;
 const rows=[];
 for(let n=1;n<=14;n++)rows.push({id:id(n),workspace_id:WS,source_key:'kptu',url:K(n),title:'합성 제목',published_at:null,app_feed_bodies:{state:'ok',reason:null,rule:'kptu@1'}});
 rows.push({id:id(20),workspace_id:WS,source_key:'kptu',url:K(20),title:'t',published_at:null,app_feed_bodies:null});           // 블록 없음 — 새 글 읽기 몫
 rows.push({id:id(21),workspace_id:WS,source_key:'kptu',url:K(21),title:'t',published_at:null,app_feed_bodies:{state:'failed',reason:'timeout',rule:'kptu@1'}}); // 판 오름 — 고름
 rows.push({id:id(22),workspace_id:WS,source_key:'kptu',url:K(22),title:'t',published_at:null,app_feed_bodies:{state:'ok',reason:null,rule:'kptu@2'}});  // 이미 지금 판
 rows.push({id:id(23),workspace_id:WS,source_key:'kptu',url:K(23),title:'t',published_at:null,app_feed_bodies:{state:'failed',reason:'timeout',rule:null}});  // 판 없음 timeout — 고르지 않음
 const sites=Object.fromEntries(rows.map(r=>[r.url,{body:page}]));
 sites[K(2)]={body:'',status:503}; // 못 읽음 → 옛 ok 본문 그대로
 const slept=[];
 const w=world({table:'app_outside_posts',rows,sites});
 const oh=OH.createOutsideFeedHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,OUTSIDE_FEED_CRON_SECRET:OSECRET})[n],
  fetch:(u,i)=>{if(String(u).endsWith('/robots.txt'))throw new Error('robots를 읽으면 안 됨');return w.fetch(u,i);},now:()=>NOW,sleep:async ms=>{slept.push(ms);},log:()=>{}});
 const r=await oh(new Request(`${SB}/functions/v1/outside-feed?action=refill`,{method:'POST',headers:{[OH.CRON_HEADER]:OSECRET,'content-type':'application/json'},body:JSON.stringify({source:'kptu'})}));
 const out=await r.json();
 assert.equal(OH.ROBOTS_EXEMPT_REFILL_MAX,10);
 assert.deepEqual(out,{ok:true,source:'kptu',status:'ok',done:10,deferred:0,remaining:5});
 const read=w.calls.filter(c=>c.url.startsWith('https://www.kptu.net/')).map(c=>c.url);
 assert.equal(read.length,10,'한 번에 10개까지');
 for(const n of [20,22,23])assert.ok(!read.includes(K(n)),`안 고를 줄 ${n}`);
 assert.equal(new Set(read).size,read.length,'같은 글 두 번 안 읽음');
 assert.equal(slept.filter(ms=>ms===OH.ROBOTS_EXEMPT_REFILL_GAP_MS).length,9,'요청 사이 5초');
 const by=Object.fromEntries(w.bodies.map(x=>[x.b.outside_post_id,x.b]));
 assert.equal(by[id(2)],undefined,'못 읽은 옛 ok 줄은 덮지 않음');
 const b=by[id(1)];
 assert.deepEqual([b.state,b.rule],['ok','kptu@2']);
 const text=b.blocks.map(x=>x.text).join('\n');
 assert.match(text,/13일 · 합성/);assert.doesNotMatch(text,/&middot|13 일/);
 assert.equal(OH.needsRefill(b,'kptu@2'),false,'다시 뽑힌 줄은 다음에 안 고름');
 assert.ok(w.bodies.every(x=>/merge-duplicates/.test(x.prefer)));
 // 노동당(판 그대로)은 고를 줄이 없어 사이트를 읽지 않음
 const lp=(await w.outside({source:'laborparty'})).json;
 assert.deepEqual([lp.status,lp.done],['ok',0]);
});

test('outside-feed refill: 판이 오른 ok 줄은 다시 뽑되 못 읽으면 옛 본문 그대로, 판 없는 ok 줄은 고르지 않음',async()=>{
 const H=n=>`https://www.hakbi.org/board/media_reports/read/${n}`;
 const cur=E.ruleId('hakbi',OC.sourceByKey('hakbi').extract);
 const old=cur.replace(/@\d+$/,'@0');
 const page=`<html><head><title>합성 제목</title></head><body><div class="board"><h3>합성 제목</h3><div class="view"><p>${LONG}</p></div><p>목록보기</p></div></body></html>`;
 const rows=[{id:id(1),workspace_id:WS,source_key:'hakbi',url:H(1),title:'t',published_at:null,app_feed_bodies:{state:'ok',reason:null,rule:old}},
  {id:id(2),workspace_id:WS,source_key:'hakbi',url:H(2),title:'t',published_at:null,app_feed_bodies:{state:'ok',reason:null,rule:old}},
  {id:id(3),workspace_id:WS,source_key:'hakbi',url:H(3),title:'t',published_at:null,app_feed_bodies:{state:'ok',reason:null,rule:null}}];
 const w=world({table:'app_outside_posts',rows,sites:{[H(1)]:{body:page},[H(2)]:{body:'',status:404}}});
 const out=(await w.outside({source:'hakbi'})).json;
 assert.equal(out.done,2);
 assert.deepEqual(w.bodies.map(x=>[x.b.outside_post_id,x.b.state,x.b.rule]),[[id(1),'ok',cur]]);
 assert.ok(!w.calls.some(c=>c.url===H(3)));
});

test('SQL Editor 부르기 파일(docs/ops/feed-refill-once.sql): 지금 판 목록이 카탈로그와 같음, 금고 값은 결과 칸에 없음, 바꾸는 문 없음',async()=>{
 const {readFileSync}=await import('node:fs');
 const sql=readFileSync(new URL('../../docs/ops/feed-refill-once.sql',import.meta.url),'utf8');
 const pairs=[...sql.matchAll(/\('([a-z0-9-]+)', '([a-z0-9-]+@\d+)'\)/g)].map(m=>[m[1],m[2]]);
 const want=[...NC.NEWS_CATALOG.filter(s=>s.extract).map(s=>[s.key,E.ruleId(s.key,s.extract)]),
  ...OC.OUTSIDE_CATALOG.filter(s=>s.extract!==false&&s.mode!=='telegram'&&!OH.ROBOTS_EXEMPT_KEYS.includes(s.key)).map(s=>[s.key,E.ruleId(s.key,s.extract||{version:1})])];
 assert.deepEqual(pairs.sort(),want.sort(),'규칙 판을 올리면 이 파일의 목록도 같은 PR에서 고친다');
 const body=sql.replace(/--.*$/gm,'');
 assert.doesNotMatch(body,/\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b|cron\.|schema_migrations/i);
 assert.doesNotMatch(body,/select\s+[^;]*decrypted_secret\s*,|select\s+k\.v|select\s+u\.v/i,'금고 값을 결과 칸으로 돌려주지 않음');
 assert.match(body,/\?action=refill/);
});
