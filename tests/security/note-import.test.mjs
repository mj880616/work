// S57-17 노트 '주소로 가져오기' 1단계 서버: Edge note-import의 안전 범위를 고정한다
// (로그인 owner만 · 작업공간은 서버가 정함 · https만 · 내부/사설/링크로컬/메타데이터 주소와 그리로 가는 리다이렉트 차단 ·
//  이름 풀이 뒤 주소 확인 · 크기/시간/리다이렉트/본문 글자/하루 횟수 상한 · 응답·로그에 서버 내부 정보 없음).
// 네트워크 없음: 사이트·Supabase·이름 풀이는 모두 지어낸 응답이다(example.org·synthetic 주소, 가짜 데이터만).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const G=await import('../../supabase/functions/note-import/guard.ts');
const A=await import('../../supabase/functions/note-import/article.ts');
const H=await import('../../supabase/functions/note-import/handler.ts');
const F=await import('../../supabase/functions/_shared/feed-fetch.ts');

const NOW=Date.parse('2026-11-11T03:00:00Z'),DAY='2026-11-11';
const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key-000000';
const WS='a0000000-0000-4000-8000-000000000001',WS_OTHER='a0000000-0000-4000-8000-000000000002';
const USER='b0000000-0000-4000-8000-000000000001';
const JWT='synthetic.user.jwt-owner-0001';
const FN='https://synthetic.supabase.test/functions/v1/note-import';
const PUBLIC_IP='93.184.216.34',PUBLIC_IP6='2606:2800:220:1:248:1893:25c8:1946';
const PAGE='https://example.org/news/1';
const para=i=>`노동자들은 오늘 ${i}번째 합성 기사 본문 문단을 읽는다. `.repeat(8).trim();
const ARTICLE=`<html lang="ko"><head><meta property="og:title" content="합성 기사 제목"><meta property="og:site_name" content="합성일보">
<meta property="article:published_time" content="2026-11-10T09:00:00+09:00"><meta name="description" content="공개 리드 문단.">
<script type="application/ld+json">{"@type":"NewsArticle","headline":"합성 기사 제목","author":{"@type":"Person","name":"예시 기자"}}</script></head>
<body><article><h1>합성 기사 제목</h1><p>${para(1)}</p>
<figure><img src="https://example.org/photo/1.jpg" alt="합성 사진"><figcaption>합성 사진 설명</figcaption></figure>
<h2>합성 소제목</h2><blockquote>${para(2)}</blockquote><p>${para(3)}</p></article></body></html>`;
const PAYWALL=`<html lang="ko"><head><meta property="og:title" content="유료 합성 기사"><meta name="description" content="공개 리드만 있음."></head>
<body><article><p>짧은 앞부분</p><div class="paywall">유료회원 전용 기사입니다</div></article></body></html>`;
const html=(body,extra={})=>({body,headers:{'content-type':'text/html; charset=utf-8',...extra}});

// 지어낸 세상: Supabase는 필요한 경로만, 사이트는 sites 표, 이름 풀이는 dns 표(없는 이름은 못 푼다).
function world(opts={}){
 const calls=[],resolved=[],logs=[];
 const sites=opts.sites??{[PAGE]:html(ARTICLE)};
 const dns={'example.org':[PUBLIC_IP],'www.example.org':[PUBLIC_IP],'news.example.net':[PUBLIC_IP,PUBLIC_IP6],...(opts.dns??{})};
 const members=opts.members??[{workspace_id:WS}],days=opts.days??[];
 const res=(v,s=200)=>new Response(v===null?null:JSON.stringify(v),{status:s,headers:{'content-type':'application/json'}});
 const doFetch=async(url,init={})=>{
  const u=new URL(url),method=init.method??'GET',body=init.body?JSON.parse(init.body):undefined;
  calls.push({url:u.href,method,body,headers:init.headers??{},init});
  if(u.origin===SB){
   if(u.pathname==='/auth/v1/user'){
    if(opts.authDown)return res({},500);
    return init.headers.Authorization===`Bearer ${JWT}`?res({id:USER}):res({},401);
   }
   const p=u.pathname.replace('/rest/v1/','');
   if(p==='app_workspace_members'&&method==='GET')return res(members);
   if(p==='app_news_days'&&method==='GET')return res(days);
   return res(null,204);
  }
  const site=sites[u.href]??sites[u.origin+u.pathname];
  if(site===undefined)return new Response('',{status:404});
  if(typeof site==='function')return site(u,init);
  return new Response(site.body??'',{status:site.status??200,headers:site.headers??{}});
 };
 const resolve=async host=>{resolved.push(host);const v=dns[host];if(v===undefined)throw new Error('synthetic resolver detail 10.9.8.7');if(typeof v==='function')return v();return v;};
 const env=n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE})[n];
 const handler=H.createNoteImportHandler({env,resolve,fetch:doFetch,now:()=>NOW,sleep:async()=>{},totalTimeoutMs:opts.totalTimeoutMs,
  log:(code,detail)=>logs.push(JSON.stringify({code,...(detail??{})}))});
 const supa=()=>calls.filter(c=>c.url.startsWith(SB));
 const outbound=()=>calls.filter(c=>!c.url.startsWith(SB));
 const writes=()=>supa().filter(c=>c.url.includes('/rest/')&&c.method!=='GET');
 return {handler,calls,resolved,logs,supa,outbound,writes};
}
const req=(body,headers={},method='POST')=>new Request(FN,{method,headers:{authorization:`Bearer ${JWT}`,'content-type':'application/json',...headers},
 body:method==='POST'?(typeof body==='string'?body:JSON.stringify(body)):undefined});
const call=async(w,r)=>{const out=await w.handler(r);const text=await out.text();let body=null;try{body=JSON.parse(text);}catch{/* 몸통 없음 */}return {status:out.status,body,text,headers:out.headers};};
const imp=(w,url)=>call(w,req({url}));
const KEYS=['author','blocks','chars','lang','ok','published_at','reason','site','state','title','truncated','url'];
const untouched=w=>{assert.equal(w.resolved.length,0,'no name lookup');assert.equal(w.outbound().length,0,'no outside request');assert.equal(w.writes().length,0,'no usage write');};

// ---- 누가 ----------------------------------------------------------------------------------------------------------
test('signed-out or malformed login → 401 before anything is read (no Supabase call, no lookup, no outside request)',async()=>{
 const w=world();
 for(const r of [
  new Request(FN,{method:'POST',body:JSON.stringify({url:PAGE})}),
  new Request(FN,{method:'POST',headers:{authorization:'Basic abc'},body:JSON.stringify({url:PAGE})}),
  new Request(FN,{method:'POST',headers:{authorization:'Bearer short'},body:JSON.stringify({url:PAGE})}),
  new Request(FN,{method:'POST',headers:{apikey:'synthetic-anon-key-0000000000'},body:JSON.stringify({url:PAGE})}),
  new Request(FN,{method:'GET'}),
 ]){
  const out=await call(w,r);
  assert.equal(out.status,401);assert.deepEqual(out.body,{ok:false,error:'UNAUTHORIZED'});
 }
 assert.equal(w.calls.length,0);assert.equal(w.resolved.length,0);
});

test('a login the Auth server rejects → 401; Auth server down → 503; nothing outside is read either way',async()=>{
 const w=world();
 const bad=await call(w,req({url:PAGE},{authorization:'Bearer synthetic.user.jwt-someone-else'}));
 assert.equal(bad.status,401);assert.deepEqual(bad.body,{ok:false,error:'UNAUTHORIZED'});
 untouched(w);
 assert.deepEqual(w.supa().map(c=>new URL(c.url).pathname),['/auth/v1/user'],'no workspace lookup for a rejected login');
 const d=world({authDown:true});
 const down=await call(d,req({url:PAGE}));
 assert.equal(down.status,503);assert.deepEqual(down.body,{ok:false,error:'AUTH_UNAVAILABLE'});
 untouched(d);
});

test('only the sole owner of exactly one workspace: no owner row, or more than one → 403 and nothing is read',async()=>{
 for(const members of [[],[{workspace_id:WS},{workspace_id:WS_OTHER}],[{workspace_id:'not-a-uuid'}],[{workspace_id:null}]]){
  const w=world({members});
  const out=await imp(w,PAGE);
  assert.equal(out.status,403,JSON.stringify(members));assert.deepEqual(out.body,{ok:false,error:'FORBIDDEN'});
  untouched(w);
 }
 // owner 확인은 서버가 로그인한 사람 id와 role=owner로만 묻는다.
 const w=world();await imp(w,PAGE);
 const q=new URL(w.supa().find(c=>c.url.includes('app_workspace_members')).url).searchParams;
 assert.equal(q.get('user_id'),`eq.${USER}`);assert.equal(q.get('role'),'eq.owner');
});

test('the workspace is chosen by the server: a body naming a workspace or user is refused, usage is written only to the caller\'s own workspace',async()=>{
 for(const body of [{url:PAGE,workspace_id:WS_OTHER},{url:PAGE,workspaceId:WS_OTHER},{url:PAGE,user_id:USER},{url:PAGE,owner:USER},{workspace_id:WS_OTHER}]){
  const w=world();
  const out=await call(w,req(body));
  assert.equal(out.status,400,JSON.stringify(body));assert.deepEqual(out.body,{ok:false,error:'INVALID_BODY'});
  untouched(w);
 }
 const w=world();
 assert.equal((await imp(w,PAGE)).status,200);
 const ws=w.writes();
 assert.equal(ws.length,1);
 assert.equal(ws[0].method,'POST');assert.equal(new URL(ws[0].url).pathname,'/rest/v1/app_news_days');
 assert.equal(ws[0].body.workspace_id,WS);assert.equal(ws[0].body.day,DAY);assert.equal(ws[0].body.fetch_n,1);
 assert.ok(!JSON.stringify(w.supa().map(c=>[c.url,c.body])).includes(WS_OTHER));
});

test('service role touches only the login check, the owner row and the daily usage row',async()=>{
 const w=world({days:[{workspace_id:WS,day:DAY,fetch_n:3}]});
 assert.equal((await imp(w,PAGE)).status,200);
 const seen=w.supa().map(c=>`${c.method} ${new URL(c.url).pathname}`);
 assert.deepEqual([...new Set(seen)].sort(),['GET /auth/v1/user','GET /rest/v1/app_news_days','GET /rest/v1/app_workspace_members','PATCH /rest/v1/app_news_days']);
 const patch=w.writes()[0];
 assert.equal(patch.body.fetch_n,4);
 assert.match(patch.url,new RegExp(`workspace_id=eq\\.${WS}&day=eq\\.${DAY}$`));
 const src=readFileSync('supabase/functions/note-import/handler.ts','utf8');
 assert.doesNotMatch(src,/app_notes|app_documents|app_pages|rpc\//,'no note or document table, no rpc');
});

test('method, body shape and body size are checked after login',async()=>{
 const w=world();
 assert.equal((await call(w,new Request(FN,{method:'GET',headers:{authorization:`Bearer ${JWT}`}}))).status,405);
 assert.equal((await call(w,new Request(FN,{method:'OPTIONS'}))).status,204);
 for(const body of ['not json','[]','"https://example.org/"','{}','{"url":5}','{"url":""}','{"url":"   "}','{"url":["https://example.org/"]}','{"url":null}']){
  const out=await call(w,req(body));
  assert.equal(out.status,400,body);assert.deepEqual(out.body,{ok:false,error:'INVALID_BODY'});
 }
 assert.equal((await call(w,req({url:PAGE},{'content-length':String(H.MAX_BODY_BYTES+1)}))).status,413);
 assert.equal((await call(w,req({url:'https://example.org/'+'a'.repeat(H.MAX_BODY_BYTES)}))).status,400,'stream over the cap without a declared length');
 untouched(w);
});

// ---- 주소 모양 -------------------------------------------------------------------------------------------------------
const SHAPE_BLOCKED=[
 'http://example.org/news/1','ftp://example.org/a','file:///etc/passwd','javascript:alert(1)','data:text/html,hi','//example.org/a','example.org/a',
 'https://127.0.0.1/','https://10.0.0.5/x','https://192.168.0.1/','https://172.16.0.1/','https://169.254.169.254/latest/meta-data/','https://0.0.0.0/',
 'https://2130706433/','https://0x7f.0.0.1/','https://0177.0.0.1/','https://127.1/',
 'https://[::1]/','https://[fd00:ec2::254]/latest/','https://[fe80::1]/','https://[::ffff:10.0.0.1]/',
 'https://localhost/','https://localhost./','https://intranet/','https://printer.local/','https://app.localhost/','https://db.internal/',
 'https://metadata.google.internal/computeMetadata/v1/','https://wiki.corp/','https://nas.lan/','https://router.home/','https://1.0.0.127.in-addr.arpa/',
 'https://synthetic.supabase.co/rest/v1/app_notes','https://x.supabase.in/','https://supabase.com/',
 'https://user:pw@example.org/','https://user@example.org/','https://example.org:8443/','https://example.org:80/',
 'https://example.org/'+'a'.repeat(2000),
];
test('address shape table: http, other schemes, IP literals, local/internal names, Supabase hosts, credentials and ports are never read',async()=>{
 for(const url of SHAPE_BLOCKED){
  assert.equal(G.noteImportUrl(url),null,url);
  const w=world();
  const out=await imp(w,url);
  assert.equal(out.status,200,url);
  assert.deepEqual(out.body,{ok:true,state:'failed',reason:'blocked',url:null,title:null,site:null,author:null,published_at:null,lang:null,blocks:[],chars:0,truncated:false},url);
  untouched(w);
 }
 // 받는 모양: https + 공개 이름 + 기본 포트.
 for(const url of ['https://example.org/news/1','https://www.example.org/a?b=1#c','https://example.org:443/x','https://xn--9d0bm3m.example.org/'])assert.ok(G.noteImportUrl(url),url);
 // 뉴스 채널 기사와 같은 규칙을 그대로 쓴다(두 벌 아님).
 assert.match(readFileSync('supabase/functions/note-import/guard.ts','utf8'),/import \{ openArticleUrl \} from "\.\.\/_shared\/news-url\.ts";/);
 for(const url of [...SHAPE_BLOCKED,'https://example.org/a'])assert.equal(G.noteImportUrl(url)?.href??null,F.openArticleUrl(url)?.href??null,url);
});

// ---- 이름 풀이 뒤 주소 -----------------------------------------------------------------------------------------------
const PRIVATE_IPS=['10.1.2.3','172.16.0.1','172.31.255.254','192.168.0.10','127.0.0.1','127.8.8.8','169.254.169.254','169.254.0.1','100.64.0.1','100.127.255.254',
 '0.0.0.0','0.1.2.3','192.0.0.8','192.0.2.1','198.18.0.1','198.51.100.7','203.0.113.9','224.0.0.1','240.0.0.1','255.255.255.255',
 '::','::1','fe80::1','febf::1','fc00::1','fd00:ec2::254','fec0::1','ff02::1','::ffff:10.0.0.1','::ffff:93.184.216.34','::10.0.0.1','64:ff9b::a00:1','100::1',
 '2001:db8::1','2001::1','2002:a00:1::1','3fff:0:1::1'];
const NOT_AN_IP=['','example.org','1.2.3','1.2.3.4.5','256.1.1.1','01.2.3.4','1.2.3.4 ','0x7f.0.0.1','2130706433','fe80::1%eth0','[::1]',':::1','1::2::3','12345::1','g::1',
 '1:2:3:4:5:6:7','1:2:3:4:5:6:7:8:9','::ffff:999.1.1.1'];
const PUBLIC_IPS=['93.184.216.34','1.1.1.1','8.8.8.8','172.15.255.255','172.32.0.1','100.63.255.255','100.128.0.1','169.253.0.1','192.0.1.1','198.17.0.1','198.20.0.1','223.255.255.254',
 '2606:2800:220:1:248:1893:25c8:1946','2001:4860:4860::8888','2400:cb00::1','2001:200::1','2A00:1450:4001::200E'];
test('public-address rule: private, loopback, link-local, metadata, shared, reserved and unknown shapes are not public',()=>{
 for(const ip of PRIVATE_IPS)assert.equal(G.isPublicIp(ip),false,ip);
 for(const ip of NOT_AN_IP)assert.equal(G.isPublicIp(ip),false,JSON.stringify(ip));
 for(const v of [null,undefined,5,{},['1.1.1.1']])assert.equal(G.isPublicIp(v),false);
 for(const ip of PUBLIC_IPS)assert.equal(G.isPublicIp(ip),true,ip);
});

test('a public-looking name that resolves to a non-public address is never requested (checked after name lookup)',async()=>{
 for(const ip of [...PRIVATE_IPS,'not-an-ip']){
  for(const list of [[ip],[PUBLIC_IP,ip],[ip,PUBLIC_IP6]]){
   const w=world({dns:{'rebind.example.net':list},sites:{'https://rebind.example.net/a':html(ARTICLE)}});
   const out=await imp(w,'https://rebind.example.net/a');
   assert.equal(out.status,200);assert.equal(out.body.state,'failed',ip);assert.equal(out.body.reason,'blocked',ip);
   assert.equal(w.outbound().length,0,`no request for ${list.join(',')}`);
   assert.deepEqual(w.resolved,['rebind.example.net'],'looked up once, before any request');
  }
 }
 // 못 푸는 이름·빈 답·모양이 다른 답·너무 많은 답: 요청을 보내지 않는다.
 for(const [answer,reason] of [[undefined,'unreachable'],[[],'unreachable'],['93.184.216.34','unreachable'],[[5],'blocked'],[[null],'blocked'],[Array(G.RESOLVE_MAX_ADDRESSES+1).fill(PUBLIC_IP),'blocked']]){
  const w=world({dns:answer===undefined?{}:{'odd.example.net':answer},sites:{'https://odd.example.net/a':html(ARTICLE)}});
  const out=await imp(w,'https://odd.example.net/a');
  assert.equal(out.body.state,'failed');assert.equal(out.body.reason,reason,JSON.stringify(answer));
  assert.equal(w.outbound().length,0);
 }
 // 공개 주소만 나오면 읽는다. robots.txt와 글 모두 이름 풀이 뒤에 나간다.
 const ok=world({sites:{'https://news.example.net/a':html(ARTICLE)}});
 const out=await imp(ok,'https://news.example.net/a');
 assert.equal(out.body.state,'ok');
 assert.deepEqual(ok.outbound().map(c=>c.url),['https://news.example.net/robots.txt','https://news.example.net/a']);
 assert.deepEqual(ok.resolved,['news.example.net']);
});

test('name lookup that hangs or is unavailable fails closed; the runtime resolver joins A and AAAA answers',async()=>{
 const sent=[];
 const doFetch=async url=>{sent.push(url);return new Response('ok');};
 const s1=G.newGuardState();
 await assert.rejects(G.makeGuardedFetch(doFetch,()=>new Promise(()=>{}),s1,{timeoutMs:5})('https://example.org/a'));
 assert.deepEqual(s1,{blocked:false,unresolved:true});
 const s2=G.newGuardState();
 await assert.rejects(G.makeGuardedFetch(doFetch,G.makeResolve(undefined),s2)('https://example.org/a'));
 assert.deepEqual(s2,{blocked:false,unresolved:true});
 // 감싼 읽기는 주소 모양도 스스로 다시 본다(공용 읽기의 allow와 별개).
 const s3=G.newGuardState();
 await assert.rejects(G.makeGuardedFetch(doFetch,async()=>[PUBLIC_IP],s3)('http://example.org/a'));
 await assert.rejects(G.makeGuardedFetch(doFetch,async()=>[PUBLIC_IP],s3)('https://169.254.169.254/latest/meta-data/'));
 assert.deepEqual(s3,{blocked:true,unresolved:false});
 // 전체 시간 상한이 지난 뒤에는 새 요청을 보내지 않는다.
 const stop=new AbortController();stop.abort();
 await assert.rejects(G.makeGuardedFetch(doFetch,async()=>[PUBLIC_IP],G.newGuardState(),{stop:stop.signal})('https://example.org/a'));
 assert.deepEqual(sent,[]);
 const asked=[];
 const dns=answers=>async(host,type)=>{asked.push(`${type} ${host}`);const v=answers[type];if(v instanceof Error)throw v;return v;};
 assert.deepEqual(await G.makeResolve(dns({A:[PUBLIC_IP],AAAA:[PUBLIC_IP6]}))('example.org'),[PUBLIC_IP,PUBLIC_IP6]);
 assert.deepEqual(asked,['A example.org','AAAA example.org']);
 assert.deepEqual(await G.makeResolve(dns({A:[PUBLIC_IP],AAAA:new Error('none')}))('example.org'),[PUBLIC_IP]);
 assert.deepEqual(await G.makeResolve(dns({A:new Error('none'),AAAA:['fd00::1']}))('example.org'),['fd00::1']);
 await assert.rejects(G.makeResolve(dns({A:new Error('none'),AAAA:new Error('none')}))('example.org'));
 await assert.rejects(G.makeResolve(dns({A:[],AAAA:[]}))('example.org'));
 await assert.rejects(G.makeResolve(null)('example.org'));
 // 한쪽 답에 사설 주소가 섞이면 막힌다(둘을 모두 본다).
 const s4=G.newGuardState();
 await assert.rejects(G.makeGuardedFetch(doFetch,G.makeResolve(dns({A:[PUBLIC_IP],AAAA:['fd00:ec2::254']})),s4)('https://example.org/a'));
 assert.deepEqual(s4,{blocked:true,unresolved:false});assert.deepEqual(sent,[]);
});

// ---- 리다이렉트 ------------------------------------------------------------------------------------------------------
const hop=to=>({status:302,headers:{location:to}});
test('redirects are re-checked at every step: to http, IP literals, internal names or names resolving to private addresses → blocked, never requested',async()=>{
 const targets=['http://example.org/plain','https://169.254.169.254/latest/meta-data/','https://127.0.0.1/admin','https://[::1]/','https://localhost/x',
  'https://metadata.google.internal/computeMetadata/v1/','https://synthetic.supabase.co/rest/v1/','https://example.org:8443/x','https://user:pw@example.org/x',
  'https://inside.example.net/secret','ftp://example.org/x','//10.0.0.1/x'];
 for(const to of targets){
  const w=world({dns:{'inside.example.net':['10.0.0.7']},sites:{[PAGE]:hop(to),'https://inside.example.net/secret':html(ARTICLE)}});
  const out=await imp(w,PAGE);
  assert.equal(out.body.state,'failed',to);assert.equal(out.body.reason,'blocked',to);assert.equal(out.body.url,null);
  assert.deepEqual(w.outbound().map(c=>c.url),['https://example.org/robots.txt',PAGE],`only the first site was contacted for ${to}`);
 }
 // 두 번째 단계에서 넘겨도 같다.
 const w2=world({dns:{'inside.example.net':['192.168.0.9']},sites:{[PAGE]:hop('https://www.example.org/2'),'https://www.example.org/2':hop('https://inside.example.net/secret')}});
 assert.equal((await imp(w2,PAGE)).body.reason,'blocked');
 assert.ok(!w2.outbound().some(c=>c.url.includes('inside.example.net')));
 // robots.txt가 안쪽으로 넘겨도 막힌다(글은 읽지 않음).
 const w3=world({sites:{'https://example.org/robots.txt':hop('https://169.254.169.254/robots.txt'),[PAGE]:html(ARTICLE)}});
 const r3=await imp(w3,PAGE);
 assert.equal(r3.body.state,'failed');assert.equal(r3.body.reason,'blocked');
 assert.deepEqual(w3.outbound().map(c=>c.url),['https://example.org/robots.txt']);
});

test('redirect count is capped; an allowed redirect is followed and the final address is reported',async()=>{
 const chain={};
 for(let i=0;i<=F.MAX_REDIRECTS;i++)chain[`https://example.org/r${i}`]=hop(`https://example.org/r${i+1}`);
 const w=world({sites:chain});
 const out=await imp(w,'https://example.org/r0');
 assert.equal(out.body.state,'failed');assert.equal(out.body.reason,'redirect');
 assert.equal(w.outbound().filter(c=>c.url.includes('/r')&&!c.url.endsWith('robots.txt')).length,F.MAX_REDIRECTS+1,'stops after the cap');
 const ok=world({sites:{[PAGE]:hop('https://news.example.net/final'),'https://news.example.net/final':html(ARTICLE)}});
 const got=await imp(ok,PAGE);
 assert.equal(got.body.state,'ok');assert.equal(got.body.url,'https://news.example.net/final');
 assert.deepEqual(ok.outbound().map(c=>c.url),['https://example.org/robots.txt',PAGE,'https://news.example.net/final','https://news.example.net/robots.txt']);
 // 넘어간 곳의 robots.txt가 막으면 읽은 글을 돌려주지 않는다.
 const no=world({sites:{[PAGE]:hop('https://news.example.net/final'),'https://news.example.net/final':html(ARTICLE),
  'https://news.example.net/robots.txt':{body:'User-agent: *\nDisallow: /',headers:{'content-type':'text/plain'}}}});
 const refused=await imp(no,PAGE);
 assert.equal(refused.body.state,'failed');assert.equal(refused.body.reason,'robots');assert.deepEqual(refused.body.blocks,[]);
});

// ---- 상한 ----------------------------------------------------------------------------------------------------------
test('size cap: a declared or streamed response over the cap is dropped',async()=>{
 const declared=world({sites:{[PAGE]:html('<html><body><p>작은 몸통</p></body></html>',{'content-length':String(F.FETCH_MAX_BYTES+1)})}});
 const a=await imp(declared,PAGE);
 assert.equal(a.body.state,'failed');assert.equal(a.body.reason,'too_big');
 const streamed=world({sites:{[PAGE]:()=>new Response(new Uint8Array(F.FETCH_MAX_BYTES+10).fill(97),{status:200,headers:{'content-type':'text/html'}})}});
 const b=await imp(streamed,PAGE);
 assert.equal(b.body.state,'failed');assert.equal(b.body.reason,'too_big');
 assert.equal(F.FETCH_MAX_BYTES,2*1024*1024);assert.equal(F.FETCH_TIMEOUT_MS,10000);assert.equal(F.MAX_REDIRECTS,3);
});

test('time cap: one import stops at the total time limit and reports a timeout',async()=>{
 const hang=(u,init)=>new Promise((_,reject)=>{init.signal.addEventListener('abort',()=>{const e=new Error('synthetic abort');e.name='AbortError';reject(e);});});
 const w=world({totalTimeoutMs:20,sites:{[PAGE]:hang}});
 const t=Date.now();
 const out=await imp(w,PAGE);
 assert.ok(Date.now()-t<5000,'did not wait for the per-request timeout');
 assert.equal(out.status,200);assert.equal(out.body.state,'failed');assert.equal(out.body.reason,'timeout');
 const w2=world({totalTimeoutMs:20,sites:{'https://example.org/robots.txt':hang,[PAGE]:html(ARTICLE)}});
 const out2=await imp(w2,PAGE);
 assert.equal(out2.body.reason,'timeout');
 assert.deepEqual(w2.outbound().map(c=>c.url),['https://example.org/robots.txt'],'no new request after the limit');
 assert.ok(H.TOTAL_TIMEOUT_MS<=30000);
 // 요청마다 시간 제한 신호가 붙는다.
 const w3=world();await imp(w3,PAGE);
 for(const c of w3.outbound())assert.ok(c.init.signal instanceof AbortSignal,c.url);
});

test('body cap: text is cut to the note limit, photos are left out, no markup is returned',async()=>{
 const many=Array.from({length:40},(_,i)=>`<p>${`${i}번째 합성 문단입니다. 긴 글을 지어낸다. `.repeat(40)}</p>`).join('\n');
 const w=world({sites:{[PAGE]:html(`<html lang="ko"><head><title>긴 합성 글</title></head><body><article>${many}</article></body></html>`)}});
 const out=await imp(w,PAGE);
 assert.equal(out.body.state,'ok');assert.equal(out.body.truncated,true);
 const count=s=>[...s].length;
 const total=out.body.blocks.reduce((n,b)=>n+count(b.text),0);
 assert.equal(out.body.chars,total);
 assert.ok(total+out.body.blocks.length*A.NOTE_BLOCK_OVERHEAD<=A.NOTE_BODY_MAX_CHARS,`${total} within the note limit`);
 assert.ok(total>A.NOTE_BODY_MAX_CHARS-2000,'filled close to the limit');
 assert.equal(A.NOTE_BODY_MAX_CHARS,20000);
 // 사진 블록 제외·꺾쇠 없음(1단계는 글자만).
 const art=await imp(world(),PAGE);
 assert.equal(art.body.truncated,false);
 assert.deepEqual([...new Set(art.body.blocks.map(b=>b.t))].sort(),['h','p','quote']);
 for(const b of art.body.blocks){assert.deepEqual(Object.keys(b).sort(),['t','text']);assert.doesNotMatch(b.text,/[<>]/);assert.doesNotMatch(b.text,/photo\/1\.jpg/);}
 assert.doesNotMatch(art.text,/<img|<p>|photo\/1\.jpg|합성 사진 설명/);
 // 순수 함수: 상한 바로 아래·딱 맞음·넘음.
 const blocks=[{t:'p',text:'가'.repeat(10)},{t:'img',src:'https://example.org/a.jpg'},{t:'h',text:'나'.repeat(10)},{t:'quote',text:'다'.repeat(10)}];
 assert.deepEqual(A.noteBody(blocks,1000),{blocks:[blocks[0],blocks[2],blocks[3]],chars:30,truncated:false});
 assert.deepEqual(A.noteBody(blocks,16+A.NOTE_BLOCK_OVERHEAD),{blocks:[{t:'p',text:'가'.repeat(10)}],chars:10,truncated:true});
 assert.deepEqual(A.noteBody(blocks,10+2*A.NOTE_BLOCK_OVERHEAD+4),{blocks:[blocks[0],{t:'h',text:'나'.repeat(4)}],chars:14,truncated:true});
 assert.deepEqual(A.noteBody([],1000),{blocks:[],chars:0,truncated:false});
});

test('daily cap: at the limit → 429 and nothing is read; below it the shared fetch_n counter goes up by one before reading',async()=>{
 const full=world({days:[{workspace_id:WS,day:DAY,fetch_n:H.NOTE_IMPORT_DAILY}]});
 const out=await imp(full,PAGE);
 assert.equal(out.status,429);assert.deepEqual(out.body,{ok:false,error:'DAILY_LIMIT'});
 untouched(full);
 const last=world({days:[{workspace_id:WS,day:DAY,fetch_n:H.NOTE_IMPORT_DAILY-1,translate_n:7}]});
 assert.equal((await imp(last,PAGE)).body.state,'ok');
 assert.deepEqual(last.writes().map(c=>[c.method,c.body.fetch_n,Object.keys(c.body).sort()]),[['PATCH',H.NOTE_IMPORT_DAILY,['fetch_n','updated_at']]]);
 const order=last.calls.map(c=>c.url);
 assert.ok(order.findIndex(u=>u.includes('app_news_days')&&!u.includes('select'))<order.indexOf('https://example.org/robots.txt'),'counted before the first outside request');
 // 이름 풀이에서 막힌 시도도 한 번으로 센다(막힌 주소를 되풀이해 묻는 것을 하루 횟수로 묶는다). 모양에서 막힌 주소는 세지 않는다.
 const probe=world({dns:{'rebind.example.net':['10.0.0.1']}});
 await imp(probe,'https://rebind.example.net/a');
 assert.equal(probe.writes().length,1);
 assert.ok(H.NOTE_IMPORT_DAILY>0&&H.NOTE_IMPORT_DAILY<=60);
});

// ---- 읽은 결과 -------------------------------------------------------------------------------------------------------
test('a readable article: title, site, author, date, language and text blocks; outside requests are honest and carry no credentials',async()=>{
 const w=world();
 const out=await imp(w,PAGE);
 assert.equal(out.status,200);
 assert.deepEqual(Object.keys(out.body).sort(),KEYS);
 assert.equal(out.body.ok,true);assert.equal(out.body.state,'ok');assert.equal(out.body.reason,null);
 assert.equal(out.body.url,PAGE);assert.equal(out.body.title,'합성 기사 제목');assert.equal(out.body.site,'합성일보');
 assert.equal(out.body.author,'예시 기자');assert.equal(out.body.published_at,'2026-11-10T00:00:00.000Z');assert.equal(out.body.lang,'ko');
 assert.deepEqual(out.body.blocks.map(b=>b.t),['p','h','quote','p']);
 assert.equal(out.body.blocks[1].text,'합성 소제목');
 assert.equal(out.headers.get('cache-control'),'no-store');
 assert.equal(out.headers.get('access-control-allow-origin'),null,'origin is added only by the shared CORS wrapper');
 for(const c of w.outbound()){
  assert.equal(c.method,'GET');assert.equal(c.init.redirect,'manual');assert.equal(c.init.credentials,'omit');assert.equal(c.body,undefined);
  const names=Object.keys(c.headers).map(k=>k.toLowerCase()).sort();
  assert.deepEqual(names,['accept','accept-language','user-agent']);
  assert.equal(c.headers['User-Agent'],H.USER_AGENT);
  assert.ok(!JSON.stringify(c.headers).includes(JWT)&&!JSON.stringify(c.headers).includes(SERVICE));
 }
 assert.match(H.USER_AGENT,/^Web2NoteImport\/1\.0 \(\+https:\/\/github\.com\//);
});

test('author reading: structured data first, then meta; addresses, mail and markup are not names; same as the site name → empty',async()=>{
 const ld=v=>`<script type="application/ld+json">${JSON.stringify(v)}</script>`;
 assert.equal(A.readAuthor(ld({author:'예시 기자'})),'예시 기자');
 assert.equal(A.readAuthor(ld({author:[{name:'예시 하나'},{name:'예시 둘'},{name:'예시 하나'}]})),'예시 하나, 예시 둘');
 assert.equal(A.readAuthor(ld({'@graph':[{'@type':'WebSite'},{'@type':'Article',author:{name:'  예시\n기자 '}}]})),'예시 기자');
 assert.equal(A.readAuthor(ld([{author:{name:'https://example.org/people/1'}}])+'<meta name="author" content="예시 필자">'),'예시 필자');
 assert.equal(A.readAuthor('<meta property="article:author" content="https://example.org/people/1">'),null);
 assert.equal(A.readAuthor('<meta name="author" content="someone@example.org">'),null);
 assert.equal(A.readAuthor('<meta name="author" content="&lt;b&gt;굵게&lt;/b&gt;">'),null);
 assert.equal(A.readAuthor('<script type="application/ld+json">{not json</script><p>본문</p>'),null);
 assert.equal(A.readAuthor(ld({author:{name:'가'.repeat(500)}})).length,A.AUTHOR_MAX_CHARS);
 assert.equal(A.readAuthor(''),null);assert.equal(A.readAuthor(null),null);
 const same=world({sites:{[PAGE]:html(ARTICLE.replace('예시 기자','합성일보'))}});
 assert.equal((await imp(same,PAGE)).body.author,null);
});

test('only text formats are accepted; plain text becomes paragraphs',async()=>{
 for(const type of ['image/png','application/pdf','application/octet-stream','application/json','video/mp4','application/zip','text/css','text/javascript','multipart/form-data',null]){
  assert.equal(A.textKind(type),null,String(type));
  // 형식 표시가 없는 응답은 바이트 몸통으로 만든다(글자 몸통이면 런타임이 text/plain을 붙인다).
  const w=world({sites:{[PAGE]:{body:new TextEncoder().encode(ARTICLE),headers:type?{'content-type':type}:{}}}});
  const out=await imp(w,PAGE);
  assert.equal(out.body.state,'failed',String(type));assert.equal(out.body.reason,'not_text',String(type));assert.deepEqual(out.body.blocks,[]);
 }
 assert.equal(A.textKind('text/html'),'html');assert.equal(A.textKind('Text/HTML; charset=EUC-KR'),'html');
 assert.equal(A.textKind('application/xhtml+xml'),'html');assert.equal(A.textKind('text/plain; charset=utf-8'),'plain');
 const w=world({sites:{[PAGE]:{body:'합성 성명 첫 문단입니다.\n\n합성 성명 둘째 문단입니다.',headers:{'content-type':'text/plain; charset=utf-8'}}}});
 const out=await imp(w,PAGE);
 assert.equal(out.body.state,'ok');assert.equal(out.body.title,null);
 assert.deepEqual(out.body.blocks,[{t:'p',text:'합성 성명 첫 문단입니다.'},{t:'p',text:'합성 성명 둘째 문단입니다.'}]);
});

test('robots.txt, bot-check pages and paywalls are not bypassed; http errors and missing pages fail plainly',async()=>{
 const robots=world({sites:{'https://example.org/robots.txt':{body:'User-agent: *\nDisallow: /news/',headers:{'content-type':'text/plain'}},[PAGE]:html(ARTICLE)}});
 const r=await imp(robots,PAGE);
 assert.equal(r.body.state,'failed');assert.equal(r.body.reason,'robots');
 assert.deepEqual(robots.outbound().map(c=>c.url),['https://example.org/robots.txt'],'the page itself was not requested');
 const named=world({sites:{'https://example.org/robots.txt':{body:`User-agent: ${H.ROBOTS_AGENT}\nDisallow: /`,headers:{'content-type':'text/plain'}},[PAGE]:html(ARTICLE)}});
 assert.equal((await imp(named,PAGE)).body.reason,'robots');
 const denied=world({sites:{'https://example.org/robots.txt':{status:403},[PAGE]:html(ARTICLE)}});
 assert.equal((await imp(denied,PAGE)).body.reason,'robots');
 const broken=world({sites:{'https://example.org/robots.txt':{status:500},[PAGE]:html(ARTICLE)}});
 assert.equal((await imp(broken,PAGE)).body.reason,'unreachable');
 assert.equal(broken.outbound().length,1);
 const bot=world({sites:{[PAGE]:html('<html><head><title>Just a moment...</title></head><body>Just a moment...</body></html>')}});
 const b=await imp(bot,PAGE);
 assert.equal(b.body.state,'failed');assert.equal(b.body.reason,'bot_check');assert.equal(b.body.title,null);
 const pay=world({sites:{[PAGE]:html(PAYWALL)}});
 const p=await imp(pay,PAGE);
 assert.equal(p.body.state,'lead');assert.equal(p.body.reason,'paywall');assert.equal(p.body.title,'유료 합성 기사');
 assert.deepEqual(p.body.blocks,[{t:'p',text:'공개 리드만 있음.'}]);
 assert.doesNotMatch(p.text,/짧은 앞부분|유료회원/);
 const empty=world({sites:{[PAGE]:html('<html><head><title>빈 합성 글</title></head><body><article><p>짧음</p></article></body></html>')}});
 const e=await imp(empty,PAGE);
 assert.equal(e.body.state,'failed');assert.equal(e.body.reason,'no_body');assert.equal(e.body.title,'빈 합성 글');assert.equal(e.body.url,PAGE);
 for(const [status,reason] of [[404,'not_found'],[410,'not_found'],[401,'http_error'],[403,'http_error'],[500,'http_error'],[503,'http_error']]){
  const w=world({sites:{[PAGE]:{status,body:'<html><body>synthetic upstream error page 10.9.8.7</body></html>',headers:{'content-type':'text/html'}}}});
  const out=await imp(w,PAGE);
  assert.equal(out.body.state,'failed');assert.equal(out.body.reason,reason,String(status));assert.doesNotMatch(out.text,/upstream|10\.9\.8\.7/);
 }
 const dead=world({sites:{[PAGE]:()=>{throw new Error('synthetic connect ECONNREFUSED 10.9.8.7:443');}}});
 const d=await imp(dead,PAGE);
 assert.equal(d.body.reason,'unreachable');assert.doesNotMatch(d.text,/ECONNREFUSED|10\.9\.8\.7/);
});

test('failure reason mapping: anything blocked on the way wins; then the total time limit; unknown codes are unreachable',()=>{
 const clear=G.newGuardState();
 assert.equal(H.failReason('http_404',{blocked:true,unresolved:false},false),'blocked');
 assert.equal(H.failReason('network',{blocked:true,unresolved:true},true),'blocked');
 assert.equal(H.failReason('too_large',clear,true),'timeout');
 for(const [code,reason] of [['url_outside','blocked'],['redirect_outside','blocked'],['robots','robots'],['robots_denied','robots'],['too_large','too_big'],['timeout','timeout'],
  ['redirect_loop','redirect'],['http_404','not_found'],['http_410','not_found'],['http_500','http_error'],['network','unreachable'],['robots_unreachable','unreachable'],['something_new','unreachable']]){
  assert.equal(H.failReason(code,clear,false),reason,code);
 }
 assert.equal(H.failReason('network',{blocked:false,unresolved:true},false),'unreachable');
});

// ---- 서버 내부 정보 ---------------------------------------------------------------------------------------------------
test('responses and logs carry codes and numbers only: no key, no project address, no resolved address, no error text, no page address or title in logs',async()=>{
 const secretish=[SERVICE,'synthetic.supabase.test',JWT,USER,WS,PUBLIC_IP,'10.9.8.7','10.0.0.7','ECONNREFUSED','synthetic resolver detail','stack','at file'];
 const worlds=[
  [world(),PAGE],
  [world({dns:{'rebind.example.net':['10.0.0.7']}}),'https://rebind.example.net/a'],
  [world(),'https://unknown.example.net/a'],
  [world({sites:{[PAGE]:()=>{throw new Error('synthetic connect ECONNREFUSED 10.9.8.7:443');}}}),PAGE],
  [world({sites:{[PAGE]:hop('https://169.254.169.254/latest/meta-data/')}}),PAGE],
  [world({days:[{workspace_id:WS,day:DAY,fetch_n:999}]}),PAGE],
  [world({members:[]}),PAGE],
  [world(),'http://example.org/a'],
 ];
 for(const [w,url] of worlds){
  const out=await imp(w,url);
  for(const s of secretish)assert.ok(!out.text.includes(s),`response leaks ${s}`);
  if(out.body.ok===false)assert.deepEqual(Object.keys(out.body).sort(),['error','ok']);
  else assert.deepEqual(Object.keys(out.body).sort(),KEYS);
  const logs=w.logs.join('\n');
  for(const s of [...secretish,'example.org','example.net','rebind','합성','/news/1'])assert.ok(!logs.includes(s),`log leaks ${s}`);
 }
 // 서버 설정이 빠지면 코드만.
 const bare=H.createNoteImportHandler({env:()=>undefined,resolve:async()=>[PUBLIC_IP],fetch:async()=>{throw new Error('must not be called');},log:()=>{}});
 const out=await bare(req({url:PAGE}));
 assert.equal(out.status,500);assert.deepEqual(await out.json(),{ok:false,error:'SERVER_CONFIG_MISSING'});
 // 저장소(DB)가 답하지 않으면 코드만, 바깥은 읽지 않는다.
 const w2=H.createNoteImportHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE})[n],resolve:async()=>[PUBLIC_IP],log:()=>{},
  fetch:async(url,init={})=>{const u=new URL(url);if(u.pathname==='/auth/v1/user')return new Response(JSON.stringify({id:USER}),{status:200});
   if(u.origin===SB)return new Response('{"message":"synthetic db detail relation missing"}',{status:500});throw new Error('outside must not be read');}});
 const r=await w2(req({url:PAGE}));
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,error:'STORE_UNAVAILABLE'});
});

// ---- 등록·경계(원문 확인) ---------------------------------------------------------------------------------------------
test('registration: verify_jwt true in the deploy table, CORS wrapper, shared reader reused and not copied, no AI call',()=>{
 const read=p=>readFileSync(p,'utf8');
 const rows=read('docs/web2-env6b-edge-source.md').split('\n').filter(l=>/^\| \d+ \| `note-import` \|/.test(l));
 assert.equal(rows.length,1,'registered once');
 assert.match(rows[0],/\| \*\*true\*\* \|/);assert.match(rows[0],/배포 대기/);
 const index=read('supabase/functions/note-import/index.ts');
 assert.match(index,/verify_jwt=true/);assert.match(index,/Deno\.serve\(withWebCors\(createNoteImportHandler\(/);
 const handler=read('supabase/functions/note-import/handler.ts'),guard=read('supabase/functions/note-import/guard.ts'),article=read('supabase/functions/note-import/article.ts');
 assert.match(handler,/import \{ ACCEPT_HTML, makeFeedReader, type FeedLog \} from "\.\.\/_shared\/feed-fetch\.ts";/);
 assert.match(handler,/import \{ guessLang, readArticlePage \} from "\.\.\/news-feed\/page\.ts";/);
 assert.match(handler,/const allow = \(next: string\) => \{ const u = noteImportUrl\(next\); if \(!u\) guard\.blocked = true; return u; \};/);assert.match(handler,/doFetch: makeGuardedFetch\(doFetch, deps\.resolve, guard, \{ stop: stop\.signal \}\)/);
 for(const [name,src] of [['handler',handler],['guard',guard],['article',article],['index',index]]){
  assert.doesNotMatch(src,/openai|ai-model|gemini|translate/i,`${name}: no AI or translation`);
  assert.doesNotMatch(src,/Access-Control-Allow-Origin/,`${name}: origin only through the shared wrapper`);
  assert.doesNotMatch(src,/console\.(log|error|warn)\([^)]*\b(e|err|error)\b[^)]*\)/,`${name}: no raw error logging`);
  assert.doesNotMatch(src,/rejectUnauthorized|unsafelyIgnoreCertificateErrors|redirect:\s*["']follow["']/,`${name}: no TLS or redirect shortcut`);
 }
 // 서버 키는 Supabase 호출에만 쓰인다(바깥 요청 머리에 없음 — 위 시험), 환경값은 둘만 읽는다.
 assert.deepEqual([...handler.matchAll(/deps\.env\("([A-Z_]+)"\)/g)].map(m=>m[1]).sort(),['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_URL']);
});
