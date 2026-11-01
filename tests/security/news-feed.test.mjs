// NEWS-클리핑 B: Edge news-feed(입구 열쇠·로그인 owner·열린 주소 규칙·robots·유료벽·번역 버튼·하루 한도·저장 경계).
// 네트워크 없음: 사이트·Supabase·OpenAI는 모두 지어낸 응답이다(example.org·synthetic 주소).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const F=await import('../../supabase/functions/_shared/feed-fetch.ts');
const C=await import('../../supabase/functions/_shared/news-catalog.ts');
const P=await import('../../supabase/functions/news-feed/page.ts');
const H=await import('../../supabase/functions/news-feed/handler.ts');

const NOW=Date.parse('2026-11-01T03:00:00Z');
const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key';
const SECRET='synthetic-news-feed-cron-secret-0123456789abc';
const WS='a0000000-0000-4000-8000-000000000001',USER='b0000000-0000-4000-8000-000000000001';
const JWT='synthetic.user.jwt-owner-0001';
const FN='https://synthetic.supabase.test/functions/v1/news-feed';
const ITEM='c0000000-0000-4000-8000-000000000001',ITEM_EN='c0000000-0000-4000-8000-000000000002',ITEM_G='c0000000-0000-4000-8000-000000000003';
const LONG='노동자들은 오늘 합성 기사 본문 문단을 읽는다. '.repeat(20);
const ARTICLE=`<html lang="ko"><head><meta property="og:title" content="합성 기사 제목"><meta property="og:site_name" content="합성일보">
<meta property="article:published_time" content="2026-10-31T09:00:00+09:00"><meta name="description" content="공개 리드 문단."></head>
<body><article><h1>합성 기사 제목</h1><p>${LONG}</p></article></body></html>`;
const PAYWALL=`<html lang="ko"><head><meta property="og:title" content="유료 합성 기사"><meta name="description" content="공개 리드만 있음."></head>
<body><article><p>짧은 앞부분</p><div class="paywall">유료회원 전용 기사입니다</div></article></body></html>`;

// 지어낸 Supabase: 필요한 경로만. 쓰기는 calls에 남긴다.
function fakeWorld(opts={}){
 const calls=[],sites=opts.sites??{},items=opts.items??[],days=opts.days??[];
 const ai=opts.ai??{summary:'한 문장 요약.'};
 const res=(v,s=200)=>new Response(v===null?null:JSON.stringify(v),{status:s,headers:{'content-type':'application/json'}});
 const doFetch=async(url,init={})=>{
  const u=new URL(url),method=init.method??'GET',body=init.body?JSON.parse(init.body):undefined;
  calls.push({url:u.href,method,body,headers:init.headers});
  if(u.origin===SB){
   if(u.pathname==='/auth/v1/user')return init.headers.Authorization===`Bearer ${JWT}`?res({id:USER}):res({},401);
   const p=u.pathname.replace('/rest/v1/','');
   if(p==='app_workspace_members')return res([{workspace_id:WS}]);
   if(p==='app_news_items'&&method==='GET'){
    const id=u.searchParams.get('id'),state=u.searchParams.get('state');
    if(id)return res(items.filter(i=>`eq.${i.id}`===id));
    if(u.searchParams.get('title_ko')==='is.null')return res((opts.untitled??[]).filter(i=>!u.searchParams.get('workspace_id')||`eq.${i.workspace_id}`===u.searchParams.get('workspace_id')));
    if(u.searchParams.get('translated_at'))return res(opts.todayTitles??[]);
    if(state)return res(items.filter(i=>i.state==='pending'&&i.lane==='channel'));
    if(u.searchParams.get('lane')==='eq.keyword')return res(opts.todayKeyword??[]);
    return res([]);
   }
   if(p==='app_news_days'&&method==='GET')return res(days);
   if(p==='app_outside_sources'&&method==='GET')return res(opts.sources??[]);
   if(p==='app_news_keywords'&&method==='GET')return res(opts.keywords??[]);
   if(p==='rpc/app_news_prune')return res(3);
   return res(null,204);
  }
  if(u.hostname==='api.openai.com'){
   return res({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(ai)}]}],usage:{input_tokens:100,output_tokens:20}});
  }
  const site=sites[u.href]??sites[u.origin+u.pathname];
  if(site===undefined)return new Response('',{status:404});
  if(typeof site==='function')return site(u);
  return new Response(site.body??'',{status:site.status??200,headers:site.headers??{'content-type':'text/html; charset=utf-8'}});
 };
 const env=n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,NEWS_FEED_CRON_SECRET:SECRET,WEB2_OPENAI_API_KEY:'synthetic-openai-key-000000000000'}[n]);
 const handler=H.createNewsFeedHandler({env,fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:()=>{}});
 const writes=()=>calls.filter(c=>c.url.startsWith(SB+'/rest/')&&c.method!=='GET');
 const outbound=()=>calls.filter(c=>!c.url.startsWith(SB)&&!c.url.startsWith('https://api.openai.com'));
 return {handler,calls,writes,outbound};
}
const cronReq=(action,body={},headers={})=>new Request(`${FN}?action=${action}`,{method:'POST',headers:{[H.CRON_HEADER]:SECRET,'content-type':'application/json',...headers},body:JSON.stringify(body)});
const userReq=(action,body={},headers={})=>new Request(`${FN}?action=${action}`,{method:'POST',headers:{authorization:`Bearer ${JWT}`,'content-type':'application/json',...headers},body:JSON.stringify(body)});
const call=async(w,req)=>{const r=await w.handler(req);return {status:r.status,body:await r.json().catch(()=>null)};};

test('keys: no key, both keys, foreign secret header, wrong secret, wrong action → refused before any read',async()=>{
 const w=fakeWorld();
 assert.equal((await call(w,new Request(FN+'?action=run_plan',{method:'POST',body:'{}'}))).status,401);
 assert.equal((await call(w,cronReq('run_plan',{},{authorization:`Bearer ${JWT}`}))).status,401);
 assert.equal((await call(w,cronReq('run_plan',{},{'x-outside-feed-cron-secret':'x'}))).status,401);
 assert.equal((await call(w,cronReq('run_plan',{},{[H.CRON_HEADER]:SECRET+'x'}))).status,401);
 assert.equal((await call(w,cronReq('translate',{id:ITEM}))).status,400,'user action not on cron key');
 assert.equal((await call(w,userReq('run',{step:'prune'}))).status,400,'cron action not on user key');
 assert.equal(w.outbound().length,0);
 const opt=await w.handler(new Request(FN,{method:'OPTIONS'}));assert.equal(opt.status,204);
});

test('open article url rule: https public hosts only',()=>{
 for(const ok of ['https://example.org/a/1','https://news.example.co.kr/view?id=3'])assert.ok(F.openArticleUrl(ok),ok);
 for(const bad of ['http://example.org/a','https://localhost/a','https://127.0.0.1/a','https://[::1]/a','https://10.0.0.1/','https://0x7f000001/',
  'https://2130706433/','https://intranet/','https://a.internal/x','https://x.local/','https://abc.supabase.co/rest/v1/','https://example.org:8443/',
  'https://user:pw@example.org/','javascript:alert(1)','file:///etc/passwd','https://'+'a'.repeat(2000)+'.org/'])
  assert.equal(F.openArticleUrl(bad),null,bad);
 assert.equal(F.cleanArticleUrl('https://www.example.org/a/1/?utm_source=x&id=7&fbclid=y#top'),'https://www.example.org/a/1/?id=7');
 assert.equal(F.urlKey('https://www.example.org/a/1/?id=7'),'example.org/a/1?id=7');
});

test('catalog: fixed hosts, news- keys, no Naver search API, Google News search path only',()=>{
 for(const s of C.NEWS_CATALOG){assert.match(s.key,/^news-[a-z0-9-]{1,34}$/);for(const l of s.lists)assert.ok(new URL(l).protocol==='https:');}
 const src=readFileSync(new URL('../../supabase/functions/_shared/news-catalog.ts',import.meta.url),'utf8')+readFileSync(new URL('../../supabase/functions/news-feed/handler.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/openapi\.naver\.com|X-Naver-Client/i);
 assert.match(C.googleNewsUrl('철도'),/^https:\/\/news\.google\.com\/rss\/search\?q=/);
 assert.equal(C.newsSourceByKey('https://evil.example'),null);
});

test('article page: full body, paywall lead only, bot check stores nothing, language',()=>{
 const a=P.readArticlePage(ARTICLE,NOW);
 assert.equal(a.state,'ok');assert.equal(a.body_kind,'full');assert.equal(a.title,'합성 기사 제목');assert.equal(a.publisher,'합성일보');assert.equal(a.lang,'ko');
 assert.equal(a.published_at,'2026-10-31T00:00:00.000Z');
 const p=P.readArticlePage(PAYWALL,NOW);
 assert.equal(p.state,'paywall');assert.equal(p.body_kind,'lead');assert.equal(p.body,'공개 리드만 있음.');
 assert.equal(P.readArticlePage('<html><body>Checking your browser before accessing. Just a moment...</body></html>',NOW).state,'bot_check');
 assert.equal(P.guessLang('Workers strike for safe staffing in public services.'),'en');
 assert.equal(P.titleKey('[단독] 합성 기사, 제목! - 합성일보'),P.titleKey('합성 기사 제목'.replace(' 제목',', 제목')));
 assert.deepEqual(P.splitGoogleTitle('Synthetic headline - Example Times'),{title:'Synthetic headline',publisher:'Example Times'});
});

test('pending: robots allowed → body, meta and summary stored; robots blocked → state robots and page not read',async()=>{
 const items=[{id:ITEM,workspace_id:WS,lane:'channel',state:'pending',url:'https://news.example.org/a/1',title:null,summary:null}];
 const w=fakeWorld({items,sites:{'https://news.example.org/robots.txt':{body:'User-agent: *\nAllow: /',headers:{'content-type':'text/plain'}},'https://news.example.org/a/1':{body:ARTICLE}}});
 const r=await call(w,cronReq('run',{step:'pending'}));
 assert.equal(r.status,200);assert.equal(r.body.done,1);
 const patch=w.writes().find(c=>c.url.includes('app_news_items?id=eq.'+ITEM)&&c.body.state).body;
 assert.equal(patch.state,'ok');assert.equal(patch.body_kind,'full');assert.equal(patch.summary,'한 문장 요약.');assert.equal(patch.title,'합성 기사 제목');
 assert.ok(w.calls.some(c=>c.url==='https://news.example.org/a/1'&&c.headers['User-Agent']===H.USER_AGENT));
 assert.ok(!w.calls.some(c=>c.url.startsWith('https://news.example.org')&&(c.headers.Authorization||c.headers.Cookie)));

 const w2=fakeWorld({items,sites:{'https://news.example.org/robots.txt':{body:'User-agent: *\nDisallow: /a/',headers:{'content-type':'text/plain'}},'https://news.example.org/a/1':{body:ARTICLE}}});
 await call(w2,cronReq('run',{step:'pending'}));
 assert.equal(w2.writes().find(c=>c.body?.state).body.state,'robots');
 assert.ok(!w2.calls.some(c=>c.url==='https://news.example.org/a/1'),'blocked page never requested');
});

test('pending: redirect to an internal host or a non-https item is not followed',async()=>{
 const items=[{id:ITEM,workspace_id:WS,lane:'channel',state:'pending',url:'https://news.example.org/a/1'},
  {id:ITEM_EN,workspace_id:WS,lane:'channel',state:'pending',url:'http://news.example.org/plain'}];
 const w=fakeWorld({items,sites:{'https://news.example.org/robots.txt':{body:''},'https://news.example.org/a/1':{status:302,headers:{location:'https://127.0.0.1/admin'}}}});
 await call(w,cronReq('run',{step:'pending'}));
 const states=w.writes().filter(c=>c.body?.state).map(c=>c.body.state);
 assert.deepEqual(states,['blocked','blocked']);
 assert.equal(w.outbound().filter(c=>/127\.0\.0\.1|^http:/.test(c.url)).length,0);
});

test('translate: foreign only, stored once, daily limit, server writes translation',async()=>{
 const en={id:ITEM_EN,workspace_id:WS,lane:'channel',url:'https://example.org/en',title:'Synthetic headline',lang:'en',body:'Synthetic body paragraph.',body_kind:'full',translated_at:null};
 const w=fakeWorld({items:[en],ai:{title_ko:'합성 제목',body_ko:'합성 본문 문단.'}});
 const r=await call(w,userReq('translate',{id:ITEM_EN}));
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.status,'translated');
 const patch=w.writes().find(c=>c.url.includes('app_news_items?id=eq.'+ITEM_EN)).body;
 assert.equal(patch.title_ko,'합성 제목');assert.equal(patch.body_ko,'합성 본문 문단.');assert.ok(patch.translated_at);
 const stored=fakeWorld({items:[{...en,translated_at:'2026-10-31T00:00:00Z',title_ko:'x',body_ko:'y'}]});
 const s=await call(stored,userReq('translate',{id:ITEM_EN}));
 assert.equal(s.body.status,'stored');assert.ok(!stored.calls.some(c=>c.url.includes('openai')),'no second translation');
 const ko=fakeWorld({items:[{...en,lang:'ko'}]});
 assert.equal((await call(ko,userReq('translate',{id:ITEM_EN}))).status,409);
 const full=fakeWorld({items:[en],days:[{workspace_id:WS,day:'2026-11-01',translate_n:H.TRANSLATE_DAILY}]});
 assert.equal((await call(full,userReq('translate',{id:ITEM_EN}))).status,429);
 assert.ok(!full.calls.some(c=>c.url.includes('openai')));
 for(const bad of [{},{id:'not-a-uuid'},{id:ITEM_EN,url:'https://example.org'}])
  assert.equal((await call(w,userReq('translate',bad))).status,400,JSON.stringify(bad));
 assert.equal((await call(fakeWorld({items:[]}),userReq('translate',{id:ITEM_EN}))).status,404,'other workspace item not found');
});

test('translate after background title: body only, keeps title_ko and first translated_at; stored when body_ko or title-only without body',async()=>{
 const base={id:ITEM_EN,workspace_id:WS,lane:'media',url:'https://example.org/en',title:'Synthetic headline',lang:'en',body:'Synthetic body paragraph.',body_kind:'lead',title_ko:'배경 제목',translated_at:'2026-11-01T00:00:00Z',body_ko:null};
 const w=fakeWorld({items:[base],ai:{title_ko:'다른 제목',body_ko:'합성 본문.'}});
 const r=await call(w,userReq('translate',{id:ITEM_EN}));
 assert.equal(r.body.status,'translated');
 const patch=w.writes().find(c=>c.url.includes('app_news_items?id=eq.'+ITEM_EN)).body;
 assert.equal(patch.title_ko,'배경 제목');assert.equal(patch.body_ko,'합성 본문.');assert.equal(patch.translated_at,'2026-11-01T00:00:00Z');
 const done=fakeWorld({items:[{...base,body_ko:'이미'}]});
 assert.equal((await call(done,userReq('translate',{id:ITEM_EN}))).body.status,'stored');assert.ok(!done.calls.some(c=>c.url.includes('openai')));
 const noBody=fakeWorld({items:[{...base,body:null,body_kind:null}]});
 assert.equal((await call(noBody,userReq('translate',{id:ITEM_EN}))).body.status,'stored');assert.ok(!noBody.calls.some(c=>c.url.includes('openai')));
});

test('titles step: one AI call per workspace for many foreign titles, title only, daily cap, bad AI lines ignored',async()=>{
 const ids=[1,2,3].map(i=>`d0000000-0000-4000-8000-00000000000${i}`);
 const untitled=ids.map((id,k)=>({id,workspace_id:WS,title:`Synthetic headline ${k+1}`}));
 const w=fakeWorld({untitled,ai:{titles:[{i:1,ko:'합성 제목 1'},{i:3,ko:'합성 제목 3'},{i:9,ko:'범위 밖'},{i:1,ko:'중복'},{i:2,ko:''}]}});
 const r=await call(w,cronReq('run',{step:'titles'}));
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.done,2);
 const ai=w.calls.filter(c=>c.url.includes('openai'));
 assert.equal(ai.length,1,'titles batched into one AI call');
 const sent=ai[0].body.input[1].content;
 assert.ok(sent.includes('1\tSynthetic headline 1')&&sent.includes('3\tSynthetic headline 3'));
 const q=w.calls.find(c=>c.method==='GET'&&c.url.includes('title_ko=is.null'));
 assert.ok(q.url.includes('lang=neq.ko'),'foreign only');
 const patches=w.writes().filter(c=>c.method==='PATCH'&&c.url.includes('/app_news_items?id=eq.'));
 assert.equal(patches.length,2);
 for(const p of patches){assert.ok(p.url.includes('title_ko=is.null'),'never overwrites');assert.deepEqual(Object.keys(p.body).sort(),['title_ko','translated_at','updated_at']);}
 assert.equal(patches[0].body.title_ko,'합성 제목 1');
 const full=fakeWorld({untitled,todayTitles:Array.from({length:H.TITLES_DAILY},()=>({id:'x'}))});
 const r2=await call(full,cronReq('run',{step:'titles'}));
 assert.equal(r2.body.done,0);assert.equal(r2.body.deferred,3);assert.ok(!full.calls.some(c=>c.url.includes('openai')),'daily cap → no AI');
 assert.equal((await call(fakeWorld(),userReq('run',{step:'titles'}))).status,400,'cron step not on user key');
 const plan=await call(fakeWorld(),cronReq('run_plan'));
 assert.ok(plan.body.steps.includes('titles'));
});

test('open: Google relay links are not read; media items only on catalog hosts',async()=>{
 const g={id:ITEM_G,workspace_id:WS,lane:'keyword',source_key:null,url:'https://news.google.com/rss/articles/synthetic',title:'t',lang:'ko',body:null,body_kind:null};
 const w=fakeWorld({items:[g]});
 const r=await call(w,userReq('open',{id:ITEM_G}));
 assert.equal(r.body.status,'original_only');assert.equal(w.outbound().length,0);
});

test('fill now and prune: daily limit counted on the server; prune via rpc',async()=>{
 const items=[{id:ITEM,workspace_id:WS,lane:'channel',state:'pending',url:'https://news.example.org/a/1'}];
 const w=fakeWorld({items,days:[{workspace_id:WS,day:'2026-11-01',fill_n:H.FILL_DAILY}]});
 assert.equal((await call(w,userReq('fill_now'))).status,429);
 const p=fakeWorld();
 const r=await call(p,cronReq('run',{step:'prune'}));
 assert.equal(r.body.removed,3);
 assert.ok(p.calls.some(c=>c.url.endsWith('/rest/v1/rpc/app_news_prune')&&c.body.p_limit===H.PRUNE_LIMIT));
});

test('keywords: daily cap per workspace (KEYWORD_ITEMS_DAILY) counted from today items; catalog shows the limits',async()=>{
 assert.equal(H.KEYWORD_ITEMS_DAILY,30);
 const rss=`<?xml version="1.0"?><rss><channel>${[1,2,3,4,5].map(i=>`<item><title>합성 키워드 기사 ${i} - 합성일보</title><link>https://news.google.com/rss/articles/synthetic-${i}</link><pubDate>Sun, 01 Nov 2026 02:00:00 GMT</pubDate><source url="https://example.org">합성일보</source></item>`).join('')}</channel></rss>`;
 const sites={[C.googleNewsUrl('합성어')]:{body:rss,headers:{'content-type':'application/rss+xml'}},'https://news.google.com/robots.txt':{body:'User-agent: *\nAllow: /\n',headers:{'content-type':'text/plain'}}};
 const near=fakeWorld({sites,keywords:[{workspace_id:WS,word:'합성어'}],todayKeyword:Array.from({length:28},()=>({workspace_id:WS}))});
 const r=await call(near,cronReq('run',{step:'keywords'}));
 assert.equal(r.status,200);assert.equal(r.body.inserted,2,'only the room left today');
 const posted=near.writes().filter(c=>c.url.includes('/app_news_items')&&c.method==='POST');
 assert.equal(posted.reduce((n,c)=>n+c.body.length,0),2);
 const full=fakeWorld({sites,keywords:[{workspace_id:WS,word:'합성어'}],todayKeyword:Array.from({length:30},()=>({workspace_id:WS}))});
 const r2=await call(full,cronReq('run',{step:'keywords'}));
 assert.equal(r2.body.inserted,0);assert.equal(full.outbound().length,0,'full today → Google News not read');
 const cat=await call(fakeWorld(),userReq('catalog'));
 assert.equal(cat.body.limits.keyword_items,30);assert.equal(cat.body.limits.translate,20);
});
