// OUTSIDE-바깥성명 ③: Edge outside-feed(카탈로그·단체별 읽기·robots·비밀값·로그인 owner·SSRF·저장 경계).
// 네트워크 없음: 사이트·Supabase·OpenAI는 모두 지어낸 응답이다. 표본은 tests/fixtures/outside-feed/(지어낸 HTML·RSS).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const {OUTSIDE_CATALOG,OUTSIDE_SOURCE_KEYS,allowedUrl,sourceByKey,publicCatalog,prefixOf}=await import('../../supabase/functions/_shared/outside-catalog.ts');
const P=await import('../../supabase/functions/outside-feed/parse.ts');
const H=await import('../../supabase/functions/outside-feed/handler.ts');

const FX=name=>readFileSync(new URL(`../fixtures/outside-feed/${name}`,import.meta.url),'utf8');
const NOW=Date.parse('2026-10-31T03:00:00Z');
const SB='https://synthetic.supabase.test';
const SERVICE='synthetic-service-role-key';
const SECRET='synthetic-outside-feed-cron-secret-0123456789';
const WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002';
const USER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const JWT_OK='synthetic.user.jwt-owner-0001',JWT_STRANGER='synthetic.user.jwt-stranger-01';
const FN='https://synthetic.supabase.test/functions/v1/outside-feed';

// 단체 키 → 목록 표본(카탈로그 lists 순서대로).
const LISTS={kctu:['kctu.html'],kptu:['kptu.html'],laborparty:['laborparty.html'],kgreens:['kgreens-statement.html','kgreens-press.html'],
  jinboparty:['jinboparty-comment.html','jinboparty-press.html'],pssp:['pssp.html'],ws:['ws.xml'],platformc:['platformc.html'],leftall:['leftall.html'],
  socialism:['socialism.html'],socialist:['socialist.xml'],jacobin:['jacobin.xml'],labornotes:['labornotes.xml'],redpepper:['redpepper.xml'],socialistworker:['socialistworker.xml']};
// 단체별 기대: [정규화한 주소, 종류] 순서.
const EXPECT={
  kctu:[['https://nodong.org/statement/310002','statement'],['https://nodong.org/statement/310000','press']],
  kptu:[['https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=9001','statement'],['https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=9000','press']],
  laborparty:[['https://laborparty.kr/?mod=document&page_id=13642&uid=5001','comment'],['https://laborparty.kr/?mod=document&page_id=13642&uid=5000','comment']],
  kgreens:[['https://kgreens.org/statement/?bmode=view&idx=777','comment'],['https://kgreens.org/press/?bmode=view&idx=778','press']],
  jinboparty:[['https://jinboparty.com/pages/index.php?p=15&b=b_1_2&bn=3001','comment'],['https://jinboparty.com/pages/index.php?p=286&b=b_1_111&bn=4001','press']],
  pssp:[['https://pssp.org/bbs/view.php?board=statement&id=6001','statement']],
  ws:[['https://ws.or.kr/article/40001','statement'],['https://ws.or.kr/article/39999','statement']],
  platformc:[['https://platformc.kr/2026/10/fake-reading-one','article']],
  leftall:[['https://leftall.com/notice/120','statement'],['https://leftall.com/notice/118','statement']],
  socialism:[['https://socialism.jinbo.net/bbs/board.php?bo_table=news&wr_id=55','comment']],
  socialist:[['http://socialist.kr/fake-post/','article']],
  jacobin:[['https://jacobin.com/2026/10/fictional-strike-wave','article']],
  labornotes:[['https://labornotes.org/2026/10/fictional-organizing','article']],
  redpepper:[['https://www.redpepper.org.uk/fictional-red-essay/','article']],
  socialistworker:[['https://socialistworker.co.uk/news/fictional-picket-report/','article']],
};
const itemsOf=s=>LISTS[s.key].flatMap((f,i)=>s.mode==='rss'?P.parseFeed(s,FX(f),NOW):P.parseListHtml(s,FX(f),s.lists[i]));

// ---- 카탈로그 ------------------------------------------------------------------------------------------------------

test('catalog = decided sources only (Q1·Q2·Q3·Q4·Q5): no 정의당, no NLR, kptu·leftall·socialist·4 foreign', () => {
  assert.deepEqual(OUTSIDE_SOURCE_KEYS,['kctu','kptu','laborparty','kgreens','jinboparty','pssp','ws','platformc','leftall','socialism','socialist','jacobin','labornotes','redpepper','socialistworker']);
  const all=JSON.stringify(OUTSIDE_CATALOG.map(s=>[s.lists,s.hosts]));
  assert.doesNotMatch(all,/justice21|newleftreview|inthesetimes|thenation|tribunemag|spectrejournal/);
  assert.deepEqual(sourceByKey('kptu').lists,['https://www.kptu.net/board/list.aspx?mid=F686C1F3']);
  assert.deepEqual(sourceByKey('leftall').hosts.includes('leftall.com'),true);
  assert.deepEqual(OUTSIDE_CATALOG.filter(s=>s.lang==='en').map(s=>s.key),['jacobin','labornotes','redpepper','socialistworker']);
  for(const s of OUTSIDE_CATALOG){
    assert.match(s.key,/^[a-z0-9][a-z0-9-]{1,39}$/,'DB source_key check');
    for(const l of s.lists){assert.ok(allowedUrl(s,l),`${s.key} list inside its own hosts`);}
    assert.equal(!!s.allowHttp,s.key==='socialist','http only for socialist.kr (Q4)');
    if(s.mode==='html')assert.ok(s.item instanceof RegExp);
  }
  // 화면에 주는 모양에는 주소·규칙이 없다.
  assert.deepEqual(Object.keys(publicCatalog()[0]).sort(),['group','key','lang','name']);
  assert.doesNotMatch(JSON.stringify(publicCatalog()),/https?:/);
});

test('allowedUrl (SSRF): only catalog hosts, https (http only socialist), no userinfo/port/other hosts', () => {
  const k=sourceByKey('kctu'),s=sourceByKey('socialist');
  assert.ok(allowedUrl(k,'https://nodong.org/statement/1'));
  for(const bad of['http://nodong.org/statement/1','https://nodong.org.evil.example/x','https://evil.example/','https://user:pw@nodong.org/','https://nodong.org:8443/',
    'https://127.0.0.1/','http://169.254.169.254/latest/meta-data/','file:///etc/passwd','javascript:alert(1)','https://localhost/','not a url'])
    assert.equal(allowedUrl(k,bad),null,bad);
  assert.ok(allowedUrl(s,'http://socialist.kr/feed'));
  assert.equal(allowedUrl(s,'http://nodong.org/'),null);
});

test('title prefixes decide the kind; notices/press-call posts are dropped', () => {
  assert.equal(prefixOf('[노동자연대 성명] 제목'),'노동자연대성명');
  assert.equal(prefixOf('【논평】 제목'),'논평');
  assert.equal(prefixOf('제목만'),'');
  assert.equal(sourceByKey('kctu').kindOf('[취재요청] x',''),null);
  assert.equal(sourceByKey('leftall').kindOf('[공지] 토론회',''),null);
  assert.equal(sourceByKey('ws').kindOf('그냥 기사',''),null);
});

// ---- 단체별 읽기(표본) -------------------------------------------------------------------------------------------

for(const s of OUTSIDE_CATALOG){
  test(`read ${s.key} (${s.mode}) from the stored sample`, () => {
    const items=itemsOf(s);
    assert.deepEqual(items.map(i=>[i.url,i.kind]),EXPECT[s.key]);
    for(const i of items){
      assert.ok(allowedUrl(s,i.url),'canonical url stays inside catalog hosts');
      assert.match(i.url,/^https?:\/\/\S+$/);assert.ok(i.url.length<=2000);
      assert.ok(i.title.length>=1&&[...i.title].length<=500);assert.doesNotMatch(i.title,/[\u0000-\u001f<>]/);
    }
  });
}

test('list parsing ignores script text, other boards, http links and outside hosts; keeps the longest anchor text', () => {
  const k=sourceByKey('kctu');
  const items=P.parseListHtml(k,FX('kctu.html'),k.lists[0]);
  assert.ok(!items.some(i=>/999|evil/.test(i.url)));
  assert.equal(items[1].title,'[보도자료] 가상 총파업 결과','the "[3]" comment-count link does not replace the title');
  const lp=sourceByKey('labornotes');
  assert.equal(P.parseFeed(lp,FX('labornotes.xml'),NOW)[0].title,'Fictional Organizing & You','Atom html title unescaped');
  assert.equal(P.parseFeed(lp,FX('labornotes.xml'),NOW)[0].author,'Sam Example');
  const ws=P.parseFeed(sourceByKey('ws'),FX('ws.xml'),NOW);
  assert.ok(ws[0].content.length>200&&!/<p>/.test(ws[0].content),'content:encoded as plain text');
  assert.equal(ws[0].published_at,'2026-10-30T00:00:00.000Z');
});

test('article body: scripts/nav/footer/date lines dropped, sentences split, 500-char cap, date read after the title', () => {
  const body=P.extractBody(FX('article-ko.html'),'[성명] 가상 노동법 개악 규탄');
  assert.doesNotMatch(body,/alert|메뉴|Copyright|목록|이전글|2026-10-30/);
  assert.deepEqual(P.splitSentences(body),['가상 정부가 노동법을 바꾸려 한다.','우리는 이를 규탄한다!','가상 구조조정은 인력 감축으로 이어진다.','정원 축소를 멈춰라.','모든 노동자는 함께 싸울 것이다.']);
  assert.equal(P.pageDate(FX('article-ko.html'),'[성명] 가상 노동법 개악 규탄',NOW),'2026-10-29T15:00:00.000Z','2026-10-30 KST midnight');
  const long=P.splitSentences('가'.repeat(1201));
  assert.deepEqual(long.map(s=>s.length),[500,500,201]);
  assert.equal(P.splitSentences('가. '.repeat(4000)).length,3001,'idx 0..3000');
  assert.equal(P.textDate('2027-01-05',NOW),null,'future date');
  assert.equal(P.textDate('2026-02-30',NOW),null,'invalid date');
});

test('decodeBody reads euc-kr boards and utf-8', () => {
  const euc=new Uint8Array([0x3c,0x6d,0x65,0x74,0x61,0x20,0x63,0x68,0x61,0x72,0x73,0x65,0x74,0x3d,0x22,0x65,0x75,0x63,0x2d,0x6b,0x72,0x22,0x3e,0xbc,0xba,0xb8,0xed]);
  assert.match(P.decodeBody(euc,null),/성명$/);
  assert.equal(P.decodeBody(new Uint8Array([0xbc,0xba,0xb8,0xed]),'text/html; charset=EUC-KR'),'성명');
  assert.equal(P.decodeBody(new TextEncoder().encode('성명'),'text/html'),'성명');
});

test('robots.txt: our group wins over *, longest rule wins, Allow wins ties, wildcards and $', () => {
  const r='User-agent: *\nDisallow: /board/\nAllow: /board/list\n\nUser-agent: GPTBot\nDisallow: /\n';
  assert.equal(P.robotsAllows(r,'Web2OutsideFeed','/board/detail.aspx?idx=1'),false);
  assert.equal(P.robotsAllows(r,'Web2OutsideFeed','/board/list.aspx?mid=F'),true);
  assert.equal(P.robotsAllows(r,'Web2OutsideFeed','/statement'),true);
  assert.equal(P.robotsAllows('User-agent: Web2OutsideFeed\nDisallow: /\n\nUser-agent: *\nAllow: /\n','Web2OutsideFeed','/x'),false);
  assert.equal(P.robotsAllows('User-agent: *\nDisallow: /*.aspx$\n','x','/a/list.aspx'),false);
  assert.equal(P.robotsAllows('User-agent: *\nDisallow: /*.aspx$\n','x','/a/list.aspx?x=1'),true);
  assert.equal(P.robotsAllows('','x','/'),true);
  assert.equal(P.robotsAllows('User-agent: *\nDisallow:\n','x','/'),true);
});

// ---- 지어낸 Supabase·사이트·OpenAI ----------------------------------------------------------------------------------

const respond=(body,status=200,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
const html=(body,status=200,headers={})=>new Response(body,{status,headers:{'Content-Type':'text/html; charset=utf-8',...headers}});
const KEY_CHECK=/^[a-z0-9][a-z0-9-]{1,39}$/;

function harness({sources=[],posts=[],sentences=[],members=[{user_id:USER,workspace_id:WS,role:'owner'}],sites={},robots={},ai,env={},failSentences=false}={}){
  const db={app_outside_sources:sources.map(r=>({enabled:true,last_ok_at:null,last_error:null,...r})),app_outside_posts:posts.map(p=>({...p})),app_outside_sentences:sentences.map(s=>({...s})),app_workspace_members:members};
  const calls={site:[],rest:[],ai:[],auth:0,logs:[]};
  let seq=0;
  const inList=v=>{const m=/^in\.\((.*)\)$/.exec(v);if(!m)return null;const out=[];const re=/"((?:[^"\\]|\\.)*)"|([^,]+)/g;let x;while((x=re.exec(m[1])))out.push(x[1]!==undefined?x[1].replace(/\\(.)/g,'$1'):x[2]);return out;};
  const match=(row,q)=>{for(const [k,v] of q){if(['select','limit','on_conflict','or'].includes(k))continue;
    if(v.startsWith('eq.')){if(String(row[k])!==v.slice(3))return false;}
    else if(v==='is.true'){if(row[k]!==true)return false;}
    else if(v.startsWith('in.')){if(!inList(v).includes(String(row[k])))return false;}
    else throw new Error('unsupported filter '+k+'='+v);}
    const or=q.get('or');if(or){const cut=/published_at\.lt\.([^,]+),/.exec(or)[1];const t=Date.parse(cut);const at=row.published_at?Date.parse(row.published_at):null;
      if(!(at!==null?at<t:Date.parse(row.fetched_at)<t))return false;}
    return true;};
  const pick=(row,sel)=>sel&&sel!=='*'?Object.fromEntries(sel.split(',').map(c=>[c,row[c]])):row;
  function checkPost(p){
    assert.match(p.source_key,KEY_CHECK);assert.ok(['statement','comment','press','article'].includes(p.kind));assert.ok(['ko','en'].includes(p.lang));
    assert.ok(p.title.length>=1&&[...p.title].length<=500&&!/[\u0000-\u001f\u007f]/.test(p.title));
    assert.match(p.url,/^https?:\/\/\S+$/);assert.ok(p.url.length<=2000);
    assert.ok(p.summary_ko==null||([...p.summary_ko].length>=1&&[...p.summary_ko].length<=2000));
    const ks=p.key_sentences??[];assert.ok(Array.isArray(ks)&&ks.length<=3);if(p.lang!=='en')assert.equal(ks.length,0);
    for(const k of ks){assert.deepEqual(Object.keys(k).sort(),['ko','orig']);assert.ok([...k.orig].length>=1&&[...k.orig].length<=300&&[...k.ko].length>=1&&[...k.ko].length<=300);}
    if(p.lang==='en')assert.equal(p.has_body,false,'DB: foreign posts never has_body');
    assert.deepEqual(Object.keys(p).filter(k=>!['workspace_id','source_key','kind','lang','title','title_ko','author','url','published_at','summary_ko','key_sentences','has_body'].includes(k)),[]);
  }
  async function rest(url,init){
    const u=new URL(url),table=u.pathname.replace('/rest/v1/',''),q=u.searchParams,method=init?.method??'GET';
    assert.equal(init.headers.apikey,SERVICE);
    calls.rest.push(`${method} ${table}?${decodeURIComponent(u.search.slice(1))}`);
    const rows=db[table];if(!rows)throw new Error('table not allowed: '+table);
    if(table==='app_workspace_members'&&method!=='GET')throw new Error('members are read only');
    if(method==='GET'){let out=rows.filter(r=>match(r,q));if(q.get('limit'))out=out.slice(0,Number(q.get('limit')));return respond(out.map(r=>pick(r,q.get('select'))));}
    const body=init.body?JSON.parse(init.body):null;
    if(method==='POST'&&table==='app_outside_posts'){checkPost(body);
      if(rows.some(r=>r.workspace_id===body.workspace_id&&r.url===body.url))return respond([],201);
      const row={id:`c0000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,fetched_at:new Date(NOW).toISOString(),title_ko:null,author:null,key_sentences:[],...body};rows.push(row);return respond([pick(row,q.get('select'))],201);}
    if(method==='POST'&&table==='app_outside_sentences'){if(failSentences)return respond({code:'x'},400);
      for(const s of body){const post=db.app_outside_posts.find(p=>p.id===s.post_id&&p.workspace_id===s.workspace_id);
        assert.ok(post,'sentence must point to a post of the same workspace');assert.equal(post.lang,'ko','DB: no sentence rows for foreign posts');assert.equal(s.lang,'ko');
        assert.ok(s.idx>=0&&s.idx<=3000&&s.text.length>=1&&[...s.text].length<=500);rows.push(s);}return new Response(null,{status:201});}
    if(method==='PATCH'){for(const r of rows.filter(r=>match(r,q)))Object.assign(r,body);return new Response(null,{status:204});}
    if(method==='DELETE'){const keep=rows.filter(r=>!match(r,q));rows.length=0;rows.push(...keep);return new Response(null,{status:204});}
    throw new Error('unexpected '+method+' '+table);
  }
  const defaultAi=(name,input)=>{
    if(name==='outside_ko_summary')return{summary:'가상 단체가 노동법 개악 규탄 입장 밝힘.'};
    if(name==='outside_en_intro')return{title_ko:'가상 파업 물결',summary_ko:'가상 도시 노동자 파업이 번짐. 다음 단계는 총회임.',
      key_sentences:[{orig:'Workers in a fictional city walked out on Monday.',ko:'가상 도시 노동자들이 월요일 일손을 놓음.'},{orig:'This sentence is not in the article.',ko:'지어낸 문장.'},{orig:'x'.repeat(301),ko:'너무 긴 문장.'}]};
    if(name==='outside_expand')return{terms:['인력 감축','정원 축소','구조조정','감원','  ','인력 감축']};
    throw new Error('unknown ai '+name);};
  const fetcher=async(url,init={})=>{
    const u=new URL(url);
    if(u.origin===SB&&u.pathname.startsWith('/rest/v1/'))return rest(url,init);
    if(u.origin===SB&&u.pathname==='/auth/v1/user'){calls.auth++;const a=init.headers.Authorization;
      return a===`Bearer ${JWT_OK}`?respond({id:USER}):a===`Bearer ${JWT_STRANGER}`?respond({id:STRANGER}):respond({msg:'bad jwt'},401);}
    if(url==='https://api.openai.com/v1/responses'){const b=JSON.parse(init.body);const name=b.text.format.name;calls.ai.push({name,input:b.input[1].content});
      const out=(ai??defaultAi)(name,b.input[1].content);if(out instanceof Response)return out;
      return respond({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(out)}]}],usage:{input_tokens:100,output_tokens:50}});}
    // 바깥 사이트: GET만, User-Agent 필수, 리다이렉트는 직접 따라감.
    assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.match(init.headers['User-Agent'],/^Web2OutsideFeed\//);
    assert.equal(init.headers.Authorization,undefined,'never send credentials to outside sites');
    calls.site.push(url);
    if(u.pathname==='/robots.txt'){const r=robots[u.origin];return r===undefined?new Response('',{status:404}):r instanceof Response?r:new Response(r,{status:200});}
    const s=sites[url];if(s===undefined)return html('not found',404);return typeof s==='function'?s():s instanceof Response?s:html(s);
  };
  const handler=H.createOutsideFeedHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,OUTSIDE_FEED_CRON_SECRET:SECRET,WEB2_OPENAI_API_KEY:'synthetic-openai-key',...env})[n],
    fetch:fetcher,now:()=>NOW,sleep:async()=>{},log:(code,d)=>calls.logs.push({code,...d})});
  const cron=(action,body={},headers={})=>handler(new Request(`${FN}?action=${action}`,{method:'POST',headers:{'x-outside-feed-cron-secret':SECRET,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
  const user=(action,body={},jwt=JWT_OK,headers={})=>handler(new Request(`${FN}?action=${action}`,{method:'POST',headers:{Authorization:`Bearer ${jwt}`,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
  return {db,calls,handler,cron,user};
}

// ---- 입구: 비밀값·로그인·401 ------------------------------------------------------------------------------------

test('no key, wrong/short/missing secret, mixed or foreign keys → 401 before any DB or site call; OPTIONS 204', async () => {
  const h=harness();
  const r0=await h.handler(new Request(FN,{method:'OPTIONS'}));assert.equal(r0.status,204);
  const plain=await h.handler(new Request(FN,{method:'POST',body:'{}'}));assert.equal(plain.status,401,'unauthenticated POST (deploy check)');
  const get=await h.handler(new Request(`${FN}?action=run_plan`));assert.equal(get.status,401);
  assert.equal((await h.cron('run_plan',{},{'x-outside-feed-cron-secret':'wrong-secret-wrong-secret-wrong-secret'})).status,401);
  assert.equal((await h.cron('run_plan',{},{'x-outside-feed-cron-secret':SECRET.slice(0,-1)})).status,401);
  assert.equal((await h.cron('run_plan',{},{Authorization:`Bearer ${JWT_OK}`})).status,401,'cron + jwt together');
  assert.equal((await h.cron('run_plan',{},{'x-collector-feed-secret':'x'})).status,401,'foreign secret header');
  assert.equal((await h.user('catalog',{},JWT_OK,{'x-drive-summary-cron-secret':'x'})).status,401);
  assert.equal((await h.user('catalog',{},'short')).status,401,'malformed bearer');
  for(const env of[{OUTSIDE_FEED_CRON_SECRET:undefined},{OUTSIDE_FEED_CRON_SECRET:''},{OUTSIDE_FEED_CRON_SECRET:'too-short-secret'}]){
    const hh=harness({env});assert.equal((await hh.cron('run_plan')).status,401);assert.equal(hh.calls.rest.length,0);}
  assert.equal(h.calls.rest.length,0);assert.equal(h.calls.site.length,0);assert.equal(h.calls.auth,0);
  assert.equal(await H.secretMatches(SECRET,SECRET),true);assert.equal(await H.secretMatches(null,SECRET),false);
});

test('actions are split by entrance; body takes only a catalog key (no url) → no SSRF path', async () => {
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu'}]});
  assert.equal((await h.cron('catalog')).status,400,'screen action through cron entrance');
  assert.equal((await h.user('run',{source:'kctu'})).status,400,'cron action through screen entrance');
  assert.equal((await h.cron('run',{source:'kctu',url:'http://169.254.169.254/'})).status,400);
  assert.equal((await h.cron('run',{url:'https://evil.example/'})).status,400);
  const unk=await h.cron('run',{source:'evil'});assert.equal(unk.status,400);assert.equal((await unk.json()).error,'UNKNOWN_SOURCE');
  assert.equal((await h.cron('run',{source:'justice21'})).status,400,'정의당 is not in the catalog (Q1)');
  assert.equal((await h.cron('run_plan',{workspace_id:WS})).status,400,'no workspace from the caller');
  assert.equal(h.calls.site.length,0);
  const big=await h.cron('run',{source:'kctu',pad:'x'.repeat(5000)});assert.ok([400,413].includes(big.status),'body over 4 KB is refused');
});

test('screen entrance: Auth user + exactly one owner row; stranger 403; catalog has no addresses; expand is bounded', async () => {
  const h=harness();
  const bad=await h.user('catalog',{},'synthetic.user.jwt-bad-000000');assert.equal(bad.status,401);
  const s=await h.user('catalog',{},JWT_STRANGER);assert.equal(s.status,403);
  const ok=await h.user('catalog');assert.equal(ok.status,200);const c=await ok.json();
  assert.equal(c.sources.length,OUTSIDE_CATALOG.length);assert.doesNotMatch(JSON.stringify(c),/https?:/);
  assert.equal((await h.user('catalog',{workspace_id:WS2})).status,400);
  const e=await h.user('expand',{query:'구조조정'});assert.equal(e.status,200);
  assert.deepEqual((await e.json()).terms,['인력 감축','정원 축소','감원'],'original dropped, duplicates/blank dropped');
  assert.equal(h.calls.ai.at(-1).input,'구조조정');
  for(const body of[{query:''},{query:'x'.repeat(101)},{query:3},{query:'a',extra:1},{}])assert.equal((await h.user('expand',body)).status,400);
  assert.equal(h.calls.site.length,0,'screen actions never read outside sites');
  const noAi=harness({env:{WEB2_OPENAI_API_KEY:undefined}});assert.equal((await noAi.user('expand',{query:'파업'})).status,503);
});

test('expand: daily cap per user', async () => {
  const h=harness();
  for(let i=0;i<H.EXPAND_DAILY_PER_USER;i++)assert.equal((await h.user('expand',{query:'파업'})).status,200);
  assert.equal((await h.user('expand',{query:'파업'})).status,429);
});

// ---- 예약 실행 ------------------------------------------------------------------------------------------------------

const kctuSites=()=>({
  'https://nodong.org/statement':FX('kctu.html'),
  'https://nodong.org/statement/310002':FX('article-ko.html'),
  'https://nodong.org/statement/310000':FX('article-ko.html').replace('[성명] 가상 노동법 개악 규탄','[보도자료] 가상 총파업 결과').replace('2026-10-30','2023-01-02'),
});

test('run_plan lists only enabled catalog sources and prunes 2-year-old bodies (titles·summaries kept)', async () => {
  const old='2024-10-01T00:00:00.000Z';
  const h=harness({sources:[{workspace_id:WS,source_key:'jacobin'},{workspace_id:WS,source_key:'kctu'},{workspace_id:WS2,source_key:'kctu'},{workspace_id:WS,source_key:'kptu',enabled:false},{workspace_id:WS,source_key:'gone-source'}],
    posts:[{id:'c1000000-0000-4000-8000-000000000001',workspace_id:WS,lang:'ko',has_body:true,published_at:old,fetched_at:old,title:'옛 글',summary_ko:'요약'},
      {id:'c1000000-0000-4000-8000-000000000002',workspace_id:WS,lang:'ko',has_body:true,published_at:null,fetched_at:old,title:'날짜 없는 옛 글'},
      {id:'c1000000-0000-4000-8000-000000000003',workspace_id:WS,lang:'ko',has_body:true,published_at:'2026-10-01T00:00:00Z',fetched_at:old,title:'새 글'}],
    sentences:[{post_id:'c1000000-0000-4000-8000-000000000001',workspace_id:WS,lang:'ko',idx:0,text:'옛 문장'},{post_id:'c1000000-0000-4000-8000-000000000002',workspace_id:WS,lang:'ko',idx:0,text:'옛 문장2'},{post_id:'c1000000-0000-4000-8000-000000000003',workspace_id:WS,lang:'ko',idx:0,text:'새 문장'}]});
  const r=await h.cron('run_plan');assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,sources:['kctu','jacobin'],pruned:2});
  assert.deepEqual(h.db.app_outside_sentences.map(s=>s.text),['새 문장']);
  assert.deepEqual(h.db.app_outside_posts.map(p=>[p.title,p.has_body,p.summary_ko??null]),[['옛 글',false,'요약'],['날짜 없는 옛 글',false,null],['새 글',true,null]]);
  assert.equal(h.calls.site.length,0);
});

test('run (domestic): reads list + new posts once, stores per enabled workspace, sentences only for ≤2y posts, skips known urls', async () => {
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu'},{workspace_id:WS2,source_key:'kctu'}],
    posts:[{id:'c2000000-0000-4000-8000-000000000001',workspace_id:WS2,source_key:'kctu',kind:'press',lang:'ko',title:'이미 있음',url:'https://nodong.org/statement/310000',has_body:false,fetched_at:'2026-10-30T00:00:00Z'}],
    sites:kctuSites()});
  const r=await h.cron('run',{source:'kctu'});assert.equal(r.status,200);
  const out=await r.json();
  assert.deepEqual(out,{ok:true,source:'kctu',status:'ok',workspaces:2,listed:2,fresh:2,inserted:3,skipped:0,deferred:0});
  assert.doesNotMatch(JSON.stringify(out),/가상|nodong/,'response carries counts only');
  // 사이트 요청: robots 1번 + 목록 1번 + 글마다 1번(작업공간이 둘이어도 한 번).
  assert.deepEqual(h.calls.site,['https://nodong.org/robots.txt','https://nodong.org/statement','https://nodong.org/statement/310002','https://nodong.org/statement/310000']);
  assert.equal(h.calls.ai.length,2,'one AI call per post, not per workspace');
  const posts=h.db.app_outside_posts.filter(p=>p.title!=='이미 있음');
  assert.deepEqual(posts.map(p=>[p.workspace_id,p.url,p.kind,p.has_body]).sort(),[
    [WS,'https://nodong.org/statement/310000','press',false],[WS,'https://nodong.org/statement/310002','statement',true],[WS2,'https://nodong.org/statement/310002','statement',true]].sort());
  const fresh=posts.find(p=>p.workspace_id===WS&&p.has_body);
  assert.equal(fresh.published_at,'2026-10-29T15:00:00.000Z');assert.equal(fresh.summary_ko,'가상 단체가 노동법 개악 규탄 입장 밝힘.');
  assert.deepEqual(h.db.app_outside_sentences.filter(s=>s.post_id===fresh.id).map(s=>s.text),['가상 정부가 노동법을 바꾸려 한다.','우리는 이를 규탄한다!','가상 구조조정은 인력 감축으로 이어진다.','정원 축소를 멈춰라.','모든 노동자는 함께 싸울 것이다.']);
  const old=posts.find(p=>p.has_body===false);
  assert.equal(h.db.app_outside_sentences.filter(s=>s.post_id===old.id).length,0,'2-year-old post: title·summary only (Q7)');
  assert.ok(h.db.app_outside_sources.every(s=>s.last_ok_at===new Date(NOW).toISOString()&&s.last_error===null));
  // 로그에는 제목·본문·주소가 없다.
  assert.doesNotMatch(JSON.stringify(h.calls.logs),/가상|https?:/);
  // 두 번째 실행: 새 글 없음 → 글 페이지·AI 요청 없음.
  const h2site=h.calls.site.length,h2ai=h.calls.ai.length;
  const again=await (await h.cron('run',{source:'kctu'})).json();
  assert.equal(again.fresh,0);assert.equal(again.inserted,0);
  assert.equal(h.calls.site.length-h2site,2,'robots + list only');assert.equal(h.calls.ai.length,h2ai);
});

test('run: no enabled workspace → no outside request at all', async () => {
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu',enabled:false}],sites:kctuSites()});
  const out=await (await h.cron('run',{source:'kctu'})).json();
  assert.equal(out.status,'no_workspace');assert.equal(h.calls.site.length,0);
});

test('robots.txt disallow / unreachable → source skipped with last_error, nothing read (kptu case)', async () => {
  const sites={'https://www.kptu.net/board/list.aspx?mid=F686C1F3':FX('kptu.html')};
  const h=harness({sources:[{workspace_id:WS,source_key:'kptu'}],sites,robots:{'https://www.kptu.net':'User-agent: *\nDisallow: /board/\n'}});
  const out=await (await h.cron('run',{source:'kptu'})).json();
  assert.equal(out.status,'robots');assert.deepEqual(h.calls.site,['https://www.kptu.net/robots.txt']);
  assert.equal(h.db.app_outside_sources[0].last_error,'robots');assert.equal(h.db.app_outside_posts.length,0);
  const h2=harness({sources:[{workspace_id:WS,source_key:'kptu'}],sites,robots:{'https://www.kptu.net':new Response('',{status:503})}});
  assert.equal((await (await h2.cron('run',{source:'kptu'})).json()).status,'robots_unreachable');
  assert.deepEqual(h2.calls.site,['https://www.kptu.net/robots.txt']);
  // robots가 글 경로만 막으면 목록은 읽되 글은 건너뛴다.
  const h3=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites:kctuSites(),robots:{'https://nodong.org':'User-agent: Web2OutsideFeed\nDisallow: /statement/\n'}});
  const o3=await (await h3.cron('run',{source:'kctu'})).json();
  assert.equal(o3.skipped,2);assert.equal(o3.inserted,0);assert.ok(!h3.calls.site.some(u=>/statement\/\d/.test(u)));
});

test('redirects: followed only inside the same source hosts; outside redirect stops (SSRF)', async () => {
  const sites={
    'https://nodong.org/statement':()=>new Response(null,{status:302,headers:{Location:'http://169.254.169.254/latest/meta-data/'}}),
  };
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites});
  const out=await (await h.cron('run',{source:'kctu'})).json();
  assert.equal(out.status,'redirect_outside');assert.ok(!h.calls.site.some(u=>/169\.254|evil/.test(u)));
  assert.equal(h.db.app_outside_sources[0].last_error,'redirect_outside');
  const ok=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites:{...kctuSites(),'https://nodong.org/statement':()=>new Response(null,{status:301,headers:{Location:'https://www.nodong.org/statement'}}),'https://www.nodong.org/statement':FX('kctu.html')}});
  const o2=await (await ok.cron('run',{source:'kctu'})).json();
  assert.equal(o2.listed,2,'same-source host redirect is fine');
  const loop=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites:{'https://nodong.org/statement':()=>new Response(null,{status:302,headers:{Location:'/statement'}})}});
  assert.equal((await (await loop.cron('run',{source:'kctu'})).json()).status,'redirect_loop');
});

test('size cap: responses over 2 MB are not read', async () => {
  const big='<a href="/statement/1">[성명] x</a>'+' '.repeat(H.FETCH_MAX_BYTES);
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites:{'https://nodong.org/statement':big}});
  assert.equal((await (await h.cron('run',{source:'kctu'})).json()).status,'too_large');
  const h2=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites:{'https://nodong.org/statement':html('x',200,{'Content-Length':String(H.FETCH_MAX_BYTES+1)})}});
  assert.equal((await (await h2.cron('run',{source:'kctu'})).json()).status,'too_large');
});

test('run (foreign): title·Korean summary·≤3 verified key sentences only — no body, no sentence rows, no full translation', async () => {
  const h=harness({sources:[{workspace_id:WS,source_key:'jacobin'}],sites:{'https://jacobin.com/rss':FX('jacobin.xml'),'https://jacobin.com/2026/10/fictional-strike-wave':FX('article-en.html')}});
  const out=await (await h.cron('run',{source:'jacobin'})).json();
  assert.equal(out.inserted,1);
  const p=h.db.app_outside_posts[0];
  assert.equal(p.lang,'en');assert.equal(p.kind,'article');assert.equal(p.has_body,false);assert.equal(p.title_ko,'가상 파업 물결');assert.equal(p.author,'Jane Example');
  assert.deepEqual(p.key_sentences,[{orig:'Workers in a fictional city walked out on Monday.',ko:'가상 도시 노동자들이 월요일 일손을 놓음.'}],'made-up or >300-char sentences dropped');
  assert.equal(h.db.app_outside_sentences.length,0);
  assert.doesNotMatch(JSON.stringify(p),/general assembly|three fictional plants/,'article body is not stored');
  assert.match(h.calls.ai[0].input,/general assembly/,'body used only as AI material');
  // AI가 없거나 틀리면 외국 글은 넣지 않는다(다음 실행에 다시).
  const h2=harness({sources:[{workspace_id:WS,source_key:'jacobin'}],env:{WEB2_OPENAI_API_KEY:undefined},sites:{'https://jacobin.com/rss':FX('jacobin.xml'),'https://jacobin.com/2026/10/fictional-strike-wave':FX('article-en.html')}});
  const o2=await (await h2.cron('run',{source:'jacobin'})).json();
  assert.equal(o2.inserted,0);assert.equal(o2.skipped,1);
});

test('run (domestic) keeps working when AI fails (summary empty) and when sentence insert fails (has_body reset)', async () => {
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites:kctuSites(),ai:()=>respond({},500)});
  const out=await (await h.cron('run',{source:'kctu'})).json();
  assert.equal(out.inserted,2);assert.ok(h.db.app_outside_posts.every(p=>p.summary_ko===null));
  const h2=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites:kctuSites(),failSentences:true});
  await h2.cron('run',{source:'kctu'});
  assert.ok(h2.db.app_outside_posts.every(p=>p.has_body===false));
});

test('per-run cap: at most MAX_NEW_PER_RUN new posts, rest deferred to the next run', async () => {
  const many=Array.from({length:12},(_,i)=>`<a href="/statement/${400000+i}">[성명] 가상 성명 ${i}</a>`).join('');
  const sites={'https://nodong.org/statement':`<html><body>${many}</body></html>`};
  for(let i=0;i<12;i++)sites[`https://nodong.org/statement/${400000+i}`]=FX('article-ko.html').replace('가상 노동법 개악 규탄',`가상 성명 ${i}`);
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites});
  const out=await (await h.cron('run',{source:'kctu'})).json();
  assert.equal(out.inserted,H.MAX_NEW_PER_RUN);assert.equal(out.deferred,12-H.MAX_NEW_PER_RUN);
});

test('every catalog source runs end to end from its stored sample (domestic and foreign)', async () => {
  const ko=FX('article-ko.html'),en=FX('article-en.html');
  for(const s of OUTSIDE_CATALOG){
    const sites={};s.lists.forEach((l,i)=>{sites[l]=FX(LISTS[s.key][i]);});
    for(const [url] of EXPECT[s.key])sites[url]=s.lang==='en'?en:ko;
    const h=harness({sources:[{workspace_id:WS,source_key:s.key}],sites});
    const out=await (await h.cron('run',{source:s.key})).json();
    assert.equal(out.status,'ok',s.key);assert.equal(out.listed,EXPECT[s.key].length,s.key);
    assert.equal(out.inserted+out.skipped,EXPECT[s.key].length,s.key);
    for(const u of h.calls.site)assert.ok(allowedUrl(s,u),`${s.key} requested only its own hosts`);
  }
});

// ---- 문서 표·index ------------------------------------------------------------------------------------------------

test('docs 5절 table: outside-feed row is verify_jwt=false and 배포 대기; index wires the handler with Deno.env only', () => {
  const doc=readFileSync('docs/web2-env6b-edge-source.md','utf8');
  const rows=doc.split('\n').filter(l=>/^\| \d+ \| `outside-feed` \|/.test(l));
  assert.equal(rows.length,1);assert.match(rows[0],/\| 배포 대기 \| 없음 \| false \|/);
  const idx=readFileSync('supabase/functions/outside-feed/index.ts','utf8');
  assert.match(idx,/Deno\.serve\(createOutsideFeedHandler\(\{ env: \(name\) => Deno\.env\.get\(name\) \}\)\);/);
  const src=readFileSync('supabase/functions/outside-feed/handler.ts','utf8');
  assert.doesNotMatch(src,/console\.(log|info)\(/);
  assert.doesNotMatch(src,/"DELETE", `app_outside_posts/,'never deletes posts');
});
