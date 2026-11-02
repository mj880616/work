// OUTSIDE-바깥성명 ③: Edge outside-feed(카탈로그·단체별 읽기·robots·비밀값·로그인 owner·SSRF·저장 경계).
// 네트워크 없음: 사이트·Supabase·OpenAI는 모두 지어낸 응답이다. 표본은 tests/fixtures/outside-feed/(지어낸 HTML·RSS).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const {OUTSIDE_CATALOG,OUTSIDE_SOURCE_KEYS,allowedUrl,sourceByKey,publicCatalog,prefixOf}=await import('../../supabase/functions/_shared/outside-catalog.ts');
const P=await import('../../supabase/functions/outside-feed/parse.ts');
const H=await import('../../supabase/functions/outside-feed/handler.ts');
const {postView}=await import('../../app/outside-statements-model.mjs');

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
const LISTS={kctu:['kctu.html'],kptu:['kptu.html'],kmwu:['kmwu.html'],kfsu:['kfsu.html'],hakbi:['hakbi.html'],laborparty:['laborparty.html'],kgreens:['kgreens-statement.html','kgreens-press.html'],
  jinboparty:['jinboparty-comment.html','jinboparty-press.html'],pssp:['pssp.html'],ws:['ws.xml'],platformc:['platformc.html'],leftall:['leftall.html'],
  socialism:['socialism.html'],socialist:['socialist-telegram.html'],jacobin:['jacobin.xml'],labornotes:['labornotes.xml'],redpepper:['redpepper.xml'],socialistworker:['socialistworker.xml']};
// 단체별 기대: [정규화한 주소, 종류] 순서.
const EXPECT={
  kctu:[['https://nodong.org/statement/310002','statement'],['https://nodong.org/statement/310000','press']],
  kptu:[['https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=9001','statement'],['https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=9000','press']],
  kmwu:[['https://kmwu.kr/bbs/board.php?bo_table=ce_B12&wr_id=8102','statement'],['https://kmwu.kr/bbs/board.php?bo_table=ce_B12&wr_id=8101','press']],
  kfsu:[['https://kfsu.kr/%EC%84%B1%EB%AA%85-%EB%B3%B4%EB%8F%84%EC%9E%90%EB%A3%8C/?mod=document&uid=3302','press'],['https://kfsu.kr/%EC%84%B1%EB%AA%85-%EB%B3%B4%EB%8F%84%EC%9E%90%EB%A3%8C/?mod=document&uid=3301','statement']],
  hakbi:[['https://www.hakbi.org/board/media_reports/read/1205','statement'],['https://www.hakbi.org/board/media_reports/read/1203','press']],
  laborparty:[['https://laborparty.kr/?mod=document&page_id=13642&uid=5001','comment'],['https://laborparty.kr/?mod=document&page_id=13642&uid=5000','comment']],
  kgreens:[['https://kgreens.org/statement/?bmode=view&idx=777','comment'],['https://kgreens.org/press/?bmode=view&idx=778','press']],
  jinboparty:[['https://jinboparty.com/pages/?p=15&b=b_1_2&bn=3001&m=read','comment'],['https://jinboparty.com/pages/?p=286&b=b_1_111&bn=4001&m=read','press']],
  pssp:[['https://pssp.org/bbs/view.php?board=statement&nid=6001','statement']],
  ws:[['https://ws.or.kr/article/40001','statement'],['https://ws.or.kr/article/40000','article'],['https://ws.or.kr/article/39999','statement']],
  platformc:[['https://platformc.kr/2026/10/fake-reading-one','article']],
  leftall:[['https://leftall.com/notice/120','statement'],['https://leftall.com/notice/118','statement']],
  socialism:[['https://socialism.jinbo.net/bbs/board.php?bo_table=news&wr_id=55','comment']],
  socialist:[['https://t.me/ksocialist/1203','article'],['http://socialist.kr/fake-statement-1201/','statement']],
  jacobin:[['https://jacobin.com/2026/10/fictional-strike-wave','article']],
  labornotes:[['https://labornotes.org/2026/10/fictional-organizing','article']],
  redpepper:[['https://www.redpepper.org.uk/fictional-red-essay/','article']],
  socialistworker:[['https://socialistworker.co.uk/news/fictional-picket-report/','article']],
};
const itemsOf=s=>LISTS[s.key].flatMap((f,i)=>s.mode==='rss'?P.parseFeed(s,FX(f),NOW):s.mode==='telegram'?P.parseTelegram(s,FX(f),NOW):P.parseListHtml(s,FX(f),s.lists[i]));

// ---- 카탈로그 ------------------------------------------------------------------------------------------------------

test('catalog = decided sources only (Q1·Q2·Q3·Q4·Q5): no 정의당, no NLR, kptu·leftall·socialist·4 foreign', () => {
  assert.deepEqual(OUTSIDE_SOURCE_KEYS,['kctu','kptu','kmwu','kfsu','hakbi','laborparty','kgreens','jinboparty','pssp','ws','platformc','leftall','socialism','socialist','jacobin','labornotes','redpepper','socialistworker']);
  const all=JSON.stringify(OUTSIDE_CATALOG.map(s=>[s.lists,s.hosts]));
  assert.doesNotMatch(all,/justice21|newleftreview|inthesetimes|thenation|tribunemag|spectrejournal/);
  assert.deepEqual(sourceByKey('kptu').lists,['https://www.kptu.net/board/list.aspx?mid=F686C1F3']);
  assert.deepEqual(sourceByKey('leftall').hosts.includes('leftall.com'),true);
  assert.deepEqual(OUTSIDE_CATALOG.filter(s=>s.lang==='en').map(s=>s.key),['jacobin','labornotes','redpepper','socialistworker']);
  for(const s of OUTSIDE_CATALOG){
    assert.match(s.key,/^[a-z0-9][a-z0-9-]{1,39}$/,'DB source_key check');
    for(const l of s.lists){assert.ok(allowedUrl(s,l),`${s.key} list inside its own hosts`);}
    assert.deepEqual(s.httpHosts??[],s.key==='socialist'?['socialist.kr','www.socialist.kr']:[],'http only for socialist.kr (Q4)');
    assert.equal('allowHttp' in s,false,'옛 칸(단체 전체 http 허용)은 없앰');
    assert.equal(s.hosts.includes('t.me'),s.key==='socialist','t.me는 사회주의자 채널 하나만(명진 결정 11/01 21:13)');
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
  // t.me: 이 단체 채널의 목록·글 경로만, https만.
  assert.ok(allowedUrl(s,'https://t.me/s/ksocialist'));assert.ok(allowedUrl(s,'https://t.me/ksocialist/1201'));
  for(const bad of['http://t.me/s/ksocialist','https://t.me/s/otherchannel','https://t.me/otherchannel/1','https://t.me/ksocialist','https://t.me/s/ksocialist/1',
    'https://t.me/ksocialist/1/2','https://t.me/joinchat/x','https://t.me/robots.txt','https://telegram.me/s/ksocialist','https://t.me/ksocialist/abc'])
    assert.equal(allowedUrl(s,bad),null,bad);
  for(const o of OUTSIDE_CATALOG.filter(x=>x.key!=='socialist'))assert.equal(allowedUrl({...o,hosts:[...o.hosts,'t.me']},'https://t.me/s/ksocialist'),null,`${o.key}: telegram 칸 없으면 t.me 불가`);
});

test('title prefixes decide the kind; notices/press-call posts are dropped', () => {
  assert.equal(prefixOf('[노동자연대 성명] 제목'),'노동자연대성명');
  assert.equal(prefixOf('【논평】 제목'),'논평');
  assert.equal(prefixOf('제목만'),'');
  assert.equal(sourceByKey('kctu').kindOf('[취재요청] x',''),null);
  assert.equal(sourceByKey('leftall').kindOf('[공지] 토론회',''),null);
  // 노동자연대(명진 결정 11/01 22:30): 기사도 받는다 — 성명 머리말은 statement, 나머지는 article(종류 칸 비움), 공지류 머리말은 뺀다.
  assert.equal(sourceByKey('ws').kindOf('그냥 기사',''),'article');
  assert.equal(sourceByKey('ws').kindOf('[긴 글] 가상 긴 글',''),'article');
  assert.equal(sourceByKey('ws').kindOf('[노동자연대 성명] x',''),'statement');
  assert.equal(sourceByKey('ws').kindOf('[성명] x',''),'statement');
  assert.equal(sourceByKey('ws').kindOf('노동자연대 학생그룹 성명: x',''),'statement');
  assert.equal(sourceByKey('ws').kindOf('[공지] 가상 모임',''),null);
  assert.equal(sourceByKey('ws').kindOf('[안내] 가상 행사',''),null);
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
    if(u.pathname==='/robots.txt'){const r0=robots[u.origin];const r=typeof r0==='function'?r0():r0;return r===undefined?new Response('',{status:404}):r instanceof Response?r:new Response(r,{status:200});}
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

// ---- 화면 입구 read_now(OUTSIDE-이름·바로읽기): 켠 단체 하나를 그 사람 작업공간에만 바로 한 번 ------------------------

test('read_now: owner only, catalog key only, must be enabled in own workspace; cron entrance cannot call it', async () => {
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu'},{workspace_id:WS,source_key:'kptu',enabled:false}],sites:kctuSites()});
  assert.equal((await h.user('read_now',{source:'kctu'},'synthetic.user.jwt-bad-000000')).status,401);
  assert.equal((await h.user('read_now',{source:'kctu'},JWT_STRANGER)).status,403);
  assert.equal((await h.cron('read_now',{source:'kctu'})).status,400,'screen action through cron entrance');
  assert.equal((await h.user('run',{source:'kctu'})).status,400,'cron action through screen entrance');
  for(const body of[{},{source:'justice21'},{source:'kctu',workspace_id:WS2},{source:'kctu',url:'https://evil.example/'},{source:3}])
    assert.ok([400].includes((await h.user('read_now',body)).status),JSON.stringify(body));
  const off=await h.user('read_now',{source:'kptu'});assert.equal(off.status,409);assert.equal((await off.json()).error,'NOT_ENABLED');
  assert.equal((await h.user('read_now',{source:'laborparty'})).status,409,'no row = not enabled');
  assert.equal(h.calls.site.length,0,'nothing read before the checks pass');
});

test('read_now: reads the source into the caller workspace only, counts only, then cooldown', async () => {
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu'},{workspace_id:WS2,source_key:'kctu'}],sites:kctuSites()});
  const r=await h.user('read_now',{source:'kctu'});assert.equal(r.status,200);
  const out=await r.json();
  assert.deepEqual(out,{ok:true,source:'kctu',status:'ok',inserted:2,deferred:0});
  assert.ok(h.db.app_outside_posts.every(p=>p.workspace_id===WS),'other workspace (WS2) gets nothing from a screen read');
  assert.ok(h.calls.site.every(u=>u.startsWith('https://nodong.org/')),'catalog hosts only');
  const mine=h.db.app_outside_sources.find(s=>s.workspace_id===WS),other=h.db.app_outside_sources.find(s=>s.workspace_id===WS2);
  assert.equal(mine.last_ok_at,new Date(NOW).toISOString());assert.equal(other.last_ok_at,null);
  assert.doesNotMatch(JSON.stringify(h.calls.logs),/가상|https?:/);
  // 10분 안에 다시 켜면 읽지 않는다(서버 DB 시각 기준, 인스턴스가 달라도 같음).
  const before=h.calls.site.length;
  const again=await h.user('read_now',{source:'kctu'});assert.equal(again.status,200);
  assert.deepEqual(await again.json(),{ok:true,source:'kctu',status:'recent',inserted:0});
  assert.equal(h.calls.site.length,before);
});

test('read_now: new-post cap is smaller than the scheduled run; daily cap per user', async () => {
  assert.ok(H.READ_NOW_MAX_NEW<=H.MAX_NEW_PER_RUN&&H.READ_NOW_BUDGET_MS<H.RUN_BUDGET_MS&&H.READ_NOW_COOLDOWN_MS>=60000);
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites:kctuSites()});
  for(let i=0;i<H.READ_NOW_DAILY_PER_USER;i++){
    h.db.app_outside_sources[0].last_ok_at=null;
    assert.equal((await h.user('read_now',{source:'kctu'})).status,200);
  }
  h.db.app_outside_sources[0].last_ok_at=null;
  const r=await h.user('read_now',{source:'kctu'});assert.equal(r.status,429);assert.equal((await r.json()).error,'DAILY_LIMIT');
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

test('robots.txt disallow / unreachable → source skipped with last_error, nothing read (robots를 지키는 단체)', async () => {
  const sites={'https://kgreens.org/statement':FX('kgreens-statement.html'),'https://kgreens.org/press':FX('kgreens-press.html')};
  const h=harness({sources:[{workspace_id:WS,source_key:'kgreens'}],sites,robots:{'https://kgreens.org':'User-agent: *\nDisallow: /\n'}});
  const out=await (await h.cron('run',{source:'kgreens'})).json();
  assert.equal(out.status,'robots');assert.deepEqual(h.calls.site,['https://kgreens.org/robots.txt']);
  assert.equal(h.db.app_outside_sources[0].last_error,'robots');assert.equal(h.db.app_outside_posts.length,0);
  const h2=harness({sources:[{workspace_id:WS,source_key:'kgreens'}],sites,robots:{'https://kgreens.org':new Response('',{status:503})}});
  assert.equal((await (await h2.cron('run',{source:'kgreens'})).json()).status,'robots_unreachable');
  assert.deepEqual(h2.calls.site,['https://kgreens.org/robots.txt']);
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
    // robots.txt는 그 단체 호스트의 것만(t.me는 채널 경로만 허용하므로 robots.txt는 따로 본다 — 리더가 출처 origin에서만 만든다).
    for(const u of h.calls.site)assert.ok(allowedUrl(s,u)||(new URL(u).pathname==='/robots.txt'&&new URL(u).protocol==='https:'&&s.hosts.includes(new URL(u).hostname)),`${s.key} requested only its own hosts`);
  }
});

// ---- OUTSIDE-막힌단체(S47-31): 2026-11-01 실제 목록 모양에 맞춘 표본 · 막힌 까닭 코드 ---------------------------------

const listOf=(key,file,base)=>P.parseListHtml(sourceByKey(key),FX(file),base,30);

test('진보당: javascript:js_board_view 링크를 글 주소로 바꾸고, 제목은 제목 칸만(좋아요 수·요약 빼기)', () => {
  const c=listOf('jinboparty','jinboparty-comment.html','https://jinboparty.com/pages/?p=15&b=b_1_2');
  assert.deepEqual(c.map(i=>[i.url,i.title,i.kind]),[['https://jinboparty.com/pages/?p=15&b=b_1_2&bn=3001&m=read','[가상 대변인 브리핑] 가상 예산안 논평','comment']]);
  const p=listOf('jinboparty','jinboparty-press.html','https://jinboparty.com/pages/?p=286&b=b_1_111');
  assert.deepEqual(p.map(i=>[i.url,i.title,i.kind]),[['https://jinboparty.com/pages/?p=286&b=b_1_111&bn=4001&m=read','[보도자료] 가상 기자회견 보도자료','press']]);
  // 바꾸기 규칙이 없는 단체는 javascript: 링크를 버린다. 목록 주소에 p·b가 없거나 이상하면 바꾸지 않는다.
  assert.deepEqual(listOf('kctu','jinboparty-comment.html','https://nodong.org/statement'),[]);
  assert.deepEqual(listOf('jinboparty','jinboparty-comment.html','https://jinboparty.com/pages/?p=15'),[]);
  assert.deepEqual(listOf('jinboparty','jinboparty-comment.html','https://jinboparty.com/pages/?p=15&b=../x'),[]);
});

test('사회진보연대: 글 번호 nid 링크(./view.php?board=statement&nid=…)를 읽고 다른 게시판·http 링크는 거른다', () => {
  const r=listOf('pssp','pssp.html','https://pssp.org/bbs/list.php?board=statement');
  assert.deepEqual(r.map(i=>[i.url,i.kind]),[['https://pssp.org/bbs/view.php?board=statement&nid=6001','statement']]);
});

test('플랫폼C: 첫 화면 카드 제목(h2 …__title)만 제목으로, 스크립트 속 주소는 안 읽음, 목록 주소는 2MB 아래 첫 화면', () => {
  const r=listOf('platformc','platformc.html','https://platformc.kr/');
  assert.deepEqual(r.map(i=>[i.url,i.title]),[['https://platformc.kr/2026/10/fake-reading-one','가상 읽을거리 하나']]);
  assert.deepEqual(sourceByKey('platformc').lists,['https://platformc.kr/']);
  assert.equal(H.FETCH_MAX_BYTES,2*1024*1024,'size cap unchanged');
});

test('노동자연대: 피드는 읽었지만 이번 첫 쪽에 넣을 글(성명·기사)이 없으면 고장 아님(no_match, 실패 표시 지움)', async () => {
  const feed=`<?xml version="1.0"?><rss version="2.0"><channel><item><title><![CDATA[[공지] 가상 모임 안내]]></title><link>https://ws.or.kr/article/41001</link></item><item><title><![CDATA[[안내] 가상 행사]]></title><link>https://ws.or.kr/article/41000</link></item></channel></rss>`;
  const h=harness({sources:[{workspace_id:WS,source_key:'ws',last_error:'parse_empty'}],sites:{'https://ws.or.kr/feed':new Response(feed,{status:200,headers:{'Content-Type':'application/xml'}})}});
  const out=await (await h.cron('run',{source:'ws'})).json();
  assert.equal(out.status,'no_match');assert.equal(out.listed,0);assert.equal(out.inserted,0);
  assert.equal(h.db.app_outside_sources[0].last_error,null);assert.ok(h.db.app_outside_sources[0].last_ok_at);
  assert.deepEqual(h.calls.site,['https://ws.or.kr/robots.txt','https://ws.or.kr/feed'],'no article page, no AI');assert.equal(h.calls.ai.length,0);
  // 목록에서 글을 하나도 못 찾으면 여전히 parse_empty.
  const h2=harness({sources:[{workspace_id:WS,source_key:'ws'}],sites:{'https://ws.or.kr/feed':new Response('<rss><channel></channel></rss>',{status:200})}});
  assert.equal((await (await h2.cron('run',{source:'ws'})).json()).status,'parse_empty');
});

test('로봇 확인 쪽이 오면 풀지 않고 bot_check로 남긴다(사회주의자 채널 목록 자리에 와도 같음)', async () => {
  const gate='<html><body><script type="text/javascript" src="/cupid.js" ></script><script>function toNumbers(d){var e=[];return e}var a=toNumbers("00");document.cookie="__test="+a;location.href="http://socialist.kr/feed?i=1";</script></body></html>';
  assert.equal(P.looksLikeBotCheck(gate),true);
  assert.equal(P.looksLikeBotCheck(FX('ws.xml')),false);
  assert.equal(P.looksLikeBotCheck(FX('socialist-telegram.html')),false);
  const h=harness({sources:[{workspace_id:WS,source_key:'socialist'}],sites:{'https://t.me/s/ksocialist':html(gate)}});
  const out=await (await h.cron('run',{source:'socialist'})).json();
  assert.equal(out.status,'bot_check');assert.equal(h.db.app_outside_sources[0].last_error,'bot_check');
  assert.deepEqual(h.calls.site,['https://t.me/robots.txt','https://t.me/s/ksocialist'],'the gate is not solved or retried with other requests');
});

// 사회주의자(명진 결정 11/01 21:13): 사이트는 로봇 확인 화면이라 읽지 않고, 공개 텔레그램 채널 웹 미리보기를 읽는다.
test('사회주의자: 텔레그램 공개 채널 글 — 새 글부터, 본문 안 사이트 글 주소를 원문으로(없으면 채널 글 주소), 사진뿐·다른 채널·공지 글은 뺀다', () => {
  const s=sourceByKey('socialist');
  assert.equal(s.mode,'telegram');assert.deepEqual(s.lists,['https://t.me/s/ksocialist']);assert.equal(H.robotsExempt(s),false,'robots 예외 아님');
  const stats={candidates:0};
  const items=P.parseTelegram(s,FX('socialist-telegram.html'),NOW,30,stats);
  assert.equal(stats.candidates,4,'이 채널 글 4개(다른 채널 글은 셈하지 않음)');
  assert.deepEqual(items.map(i=>[i.url,i.kind,i.title,i.published_at]),[
    ['https://t.me/ksocialist/1203','article','✊ 가상 잡지 새 호가 나왔습니다','2026-10-31T02:00:00.000Z'],
    ['http://socialist.kr/fake-statement-1201/','statement','[성명] 가상 노동법 개악을 멈춰라','2026-10-29T09:30:00.000Z']]);
  assert.match(items[1].content,/가상 국회는 개정안을 멈추고/);assert.doesNotMatch(items[1].content,/스크립트 안 글자/);
  assert.equal(items[0].author,null);
});

test('사회주의자: 채널 목록 한 번만 읽고 글 쪽·단체 사이트는 요청하지 않는다(로봇 확인 화면을 건드리지 않음), 짧은 글은 제목만', async () => {
  const h=harness({sources:[{workspace_id:WS,source_key:'socialist'}],sites:{'https://t.me/s/ksocialist':FX('socialist-telegram.html')},robots:{'https://t.me':'User-agent: *\nDisallow: /admin\n'}});
  const out=await (await h.cron('run',{source:'socialist'})).json();
  assert.equal(out.status,'ok');assert.equal(out.inserted,2);assert.equal(out.skipped,0);
  assert.deepEqual(h.calls.site,['https://t.me/robots.txt','https://t.me/s/ksocialist']);
  const st=h.db.app_outside_posts.find(p=>p.url==='http://socialist.kr/fake-statement-1201/');
  assert.equal(st.kind,'statement');assert.equal(st.has_body,true);assert.ok(st.summary_ko);
  assert.equal(h.calls.ai.length,2);
  // robots.txt가 채널 미리보기를 막으면 그대로 따른다(우회 없음).
  const r=harness({sources:[{workspace_id:WS,source_key:'socialist'}],sites:{'https://t.me/s/ksocialist':FX('socialist-telegram.html')},robots:{'https://t.me':'User-agent: *\nDisallow: /s/\n'}});
  assert.equal((await (await r.cron('run',{source:'socialist'})).json()).status,'robots');assert.deepEqual(r.calls.site,['https://t.me/robots.txt']);
  // 채널 미리보기가 다른 채널·앱 주소로 넘기면 따라가지 않는다.
  const red=harness({sources:[{workspace_id:WS,source_key:'socialist'}],sites:{'https://t.me/s/ksocialist':()=>new Response('',{status:302,headers:{location:'https://t.me/otherchannel'}})}});
  assert.equal((await (await red.cron('run',{source:'socialist'})).json()).status,'redirect_outside');
});

test('노동자연대: 성명 머리말([노동자연대 성명]·[성명]·[노동자연대 학생그룹 성명]·괄호 없는 \'노동자연대 성명:\')은 성명, 나머지 기사는 article(명진 결정 11/01 22:30)', () => {
  const k=sourceByKey('ws').kindOf;
  for(const t of['[노동자연대 성명] 가상','[성명] 가상','[노동자연대 학생그룹 성명] 가상','노동자연대 성명: 가상','노동자연대 학생그룹 성명 — 가상'])assert.equal(k(t,''),'statement',t);
  for(const t of['〈노동자 연대〉가 뽑은: 가상 10대 뉴스','가상 기사에서 성명을 다룸','노동자연대 성명서 낭독 현장 기사','[긴 글] 가상 긴 글'])assert.equal(k(t,''),'article',t);
  for(const t of['[공지] 가상 모임','[모집] 가상 기자','[알림] 가상 휴간','■ 가상 주간 홍보 일정'])assert.equal(k(t,''),null,t);
});

test('노동자연대: 기사가 하루 수십 건이어도 한 번에 MAX_NEW_PER_RUN건만, 나머지는 다음 실행 — 종류 칸은 성명만 \'성명\', 기사는 비움', async () => {
  const items=Array.from({length:20},(_,i)=>`<item><title><![CDATA[${i%5===0?'[노동자연대 성명] ':''}가상 기사 ${i}]]></title><link>https://ws.or.kr/article/${50100-i}</link><pubDate>Sun, 01 Nov 2026 0${i%10}:00:00 +0900</pubDate></item>`).join('');
  const sites={'https://ws.or.kr/feed':new Response(`<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`,{status:200,headers:{'Content-Type':'application/xml'}})};
  for(let i=0;i<20;i++)sites[`https://ws.or.kr/article/${50100-i}`]=FX('article-ko.html');
  const h=harness({sources:[{workspace_id:WS,source_key:'ws'}],sites});
  const out=await (await h.cron('run',{source:'ws'})).json();
  assert.equal(out.listed,20);assert.equal(out.inserted,H.MAX_NEW_PER_RUN);assert.equal(out.deferred,20-H.MAX_NEW_PER_RUN);
  const kinds=h.db.app_outside_posts.map(p=>p.kind);
  assert.ok(kinds.includes('statement')&&kinds.includes('article'),'성명·기사 함께');
  assert.ok(kinds.every(x=>x==='statement'||x==='article'));
  assert.equal(postView({kind:'statement'}).kind,'성명');assert.equal(postView({kind:'article'}).kind,'');
});

// 공공운수노조 robots 예외(명진 결정 11/01 16:49): 소속 노조의 공개 성명 게시판 한 곳만. 일반 robots 검사는 약하게 하지 않는다.
const KPTU_ROBOTS='User-agent: *\nDisallow: /\n\nUser-agent: Yeti\nDisallow: /adm\nDisallow: /member\n';
test('robots 예외: 예외 목록은 kptu·laborparty 두 곳뿐, 카탈로그 robotsException도 두 곳뿐(명진 결정 주석)', () => {
  assert.deepEqual([...H.ROBOTS_EXEMPT_KEYS],['kptu','laborparty']);
  assert.ok(Object.isFrozen(H.ROBOTS_EXEMPT_KEYS));
  assert.deepEqual(OUTSIDE_CATALOG.filter(s=>s.robotsException).map(s=>s.key),['kptu','laborparty']);
  assert.match(sourceByKey('kptu').robotsException,/명진 결정 11\/01 16:49/);
  assert.match(sourceByKey('laborparty').robotsException,/명진 결정 11\/01 21:08/);
  assert.ok(H.robotsExempt(sourceByKey('kptu')));assert.ok(H.robotsExempt(sourceByKey('laborparty')));
  for(const s of OUTSIDE_CATALOG.filter(s=>!['kptu','laborparty'].includes(s.key))){
    assert.equal(H.robotsExempt(s),false,s.key);
    assert.equal(H.robotsExempt({...s,robotsException:'누가 몰래 적어도'}),false,`${s.key}: 카탈로그 칸만으로는 예외가 되지 않음`);
  }
  assert.equal(H.robotsExempt({...sourceByKey('kptu'),robotsException:undefined}),false,'kptu도 결정 기록이 없으면 예외 아님');
  assert.equal(H.robotsExempt({...sourceByKey('laborparty'),robotsException:''}),false,'laborparty도 결정 기록이 없으면 예외 아님');
  assert.equal(H.robotsExempt({...sourceByKey('kctu'),key:'laborparty-x',robotsException:'x'}),false,'비슷한 이름도 아님');
  assert.equal(publicCatalog().some(s=>'robotsException' in s),false,'화면에는 싣지 않음');
});

test('공공운수노조: robots.txt가 모두 막아도(Disallow: /) 목록 한 쪽 + 새 글만 읽는다 — robots.txt는 묻지 않고, 요청 머리는 그대로', async () => {
  const sites={'https://www.kptu.net/board/list.aspx?mid=F686C1F3':FX('kptu-list-2026-11.html'),
    'https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=96558':FX('kptu-article.html'),
    'https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=96549':FX('kptu-article-image-only.html')};
  const h=harness({sources:[{workspace_id:WS,source_key:'kptu'}],sites,robots:{'https://www.kptu.net':KPTU_ROBOTS}});
  const out=await (await h.cron('run',{source:'kptu'})).json();
  assert.equal(out.status,'ok');assert.equal(out.listed,2,'[주간홍보] 공지 글은 넣지 않음');assert.equal(out.inserted,2);assert.equal(out.skipped,0);
  assert.ok(!h.calls.site.includes('https://www.kptu.net/robots.txt'));
  assert.deepEqual(h.calls.site.filter(u=>/list\.aspx/.test(u)),['https://www.kptu.net/board/list.aspx?mid=F686C1F3'],'목록은 첫 쪽 한 번만');
  const [a,b]=['96558','96549'].map(i=>h.db.app_outside_posts.find(p=>p.url.endsWith(`idx=${i}`)));
  assert.equal(a.kind,'statement');assert.equal(a.has_body,true);assert.equal(a.summary_ko,'가상 단체가 노동법 개악 규탄 입장 밝힘.');assert.equal(a.published_at,'2026-10-28T15:00:00.000Z');
  assert.ok(h.db.app_outside_sentences.some(x=>/상급심에서 바로잡을 것/.test(x.text)));
  assert.ok(!h.db.app_outside_sentences.some(x=>/\.hwp|수정|삭제|이전글/.test(x.text)),'첨부 이름·단추 글자는 본문이 아님');
  assert.equal(b.kind,'press');assert.equal(b.has_body,false);assert.equal(b.summary_ko,null,'그림뿐인 글은 제목만(요약 줄 비움)');
  assert.equal(h.calls.ai.length,1,'본문 없는 글은 AI에 보내지 않음');
  // 두 번째 예약 실행: 이미 넣은 글은 다시 읽지 않는다(새 글만).
  const again=await (await h.cron('run',{source:'kptu'})).json();
  assert.equal(again.fresh,0);assert.equal(h.calls.site.filter(u=>/detail\.aspx/.test(u)).length,2);
});

test('공공운수노조: 바로 읽기는 하지 않는다(하루 3번 예약 때만) — 바깥 요청 0', async () => {
  const h=harness({sources:[{workspace_id:WS,source_key:'kptu'}],sites:{'https://www.kptu.net/board/list.aspx?mid=F686C1F3':FX('kptu-list-2026-11.html')}});
  const r=await (await h.user('read_now',{source:'kptu'})).json();
  assert.deepEqual(r,{ok:true,source:'kptu',status:'scheduled_only',inserted:0});assert.equal(h.calls.site.length,0);
});

// 노동당 robots 예외(명진 결정 11/01 21:08): 공공운수노조 예외와 같은 조건.
test('노동당: robots.txt를 거절(403)해도 목록 한 쪽 + 새 글만 읽는다 — robots.txt는 묻지 않고, 요청 머리 그대로, 바로 읽기 없음', async () => {
  const sites={'https://laborparty.kr/?page_id=13642':FX('laborparty.html'),
    'https://laborparty.kr/?mod=document&page_id=13642&uid=5001':FX('article-ko.html'),
    'https://laborparty.kr/?mod=document&page_id=13642&uid=5000':FX('article-ko.html')};
  const h=harness({sources:[{workspace_id:WS,source_key:'laborparty'}],sites,robots:{'https://laborparty.kr':()=>new Response('<h1>403 Forbidden</h1>',{status:403})}});
  const out=await (await h.cron('run',{source:'laborparty'})).json();
  assert.equal(out.status,'ok');assert.equal(out.listed,2);
  assert.ok(!h.calls.site.some(u=>u.endsWith('/robots.txt')),'robots.txt 요청 없음');
  assert.deepEqual(h.calls.site.filter(u=>/page_id=13642$/.test(u)),['https://laborparty.kr/?page_id=13642'],'목록은 첫 쪽 한 번만');
  const again=await (await h.cron('run',{source:'laborparty'})).json();
  assert.equal(again.fresh,0,'두 번째 실행은 새 글만(없음)');
  const r=await (await h.user('read_now',{source:'laborparty'})).json();
  assert.deepEqual(r,{ok:true,source:'laborparty',status:'scheduled_only',inserted:0});
});

test('robots 예외는 kptu·laborparty 열쇠에만: 다른 단체는 같은 robots(Disallow: /)면 그대로 막힘', async () => {
  for(const key of ['kctu','leftall','socialism','pssp','kgreens','jinboparty','platformc','ws','socialist','jacobin']){
    const s=sourceByKey(key);const origin=new URL(s.lists[0]).origin;
    const h=harness({sources:[{workspace_id:WS,source_key:key}],sites:{[s.lists[0]]:'<html></html>'},robots:{[origin]:KPTU_ROBOTS}});
    const out=await (await h.cron('run',{source:key})).json();
    assert.equal(out.status,'robots',key);assert.deepEqual(h.calls.site,[`${origin}/robots.txt`],key);
  }
});

test('robots.txt를 못 읽을 때: 401·403은 robots_denied(읽지 않음), 5xx·연결 실패는 robots_unreachable, 다음 실행은 다시 읽는다', async () => {
  const sites={'https://pssp.org/bbs/list.php?board=statement':FX('pssp.html')};
  for(const status of [401,403]){
    const h=harness({sources:[{workspace_id:WS,source_key:'pssp'}],sites,robots:{'https://pssp.org':()=>new Response('<h1>403 Forbidden</h1>',{status})}});
    const out=await (await h.cron('run',{source:'pssp'})).json();
    assert.equal(out.status,'robots_denied');assert.deepEqual(h.calls.site,['https://pssp.org/robots.txt'],'list is not read when robots.txt is refused');
    assert.equal(h.db.app_outside_sources[0].last_error,'robots_denied');
  }
  let n=0;
  const h=harness({sources:[{workspace_id:WS,source_key:'pssp'}],sites,robots:{'https://pssp.org':()=>(++n===1?new Response('',{status:503}):'User-agent: *\nDisallow:\n')}});
  assert.equal((await (await h.cron('run',{source:'pssp'})).json()).status,'robots_unreachable');
  assert.equal(h.db.app_outside_sources[0].last_error,'robots_unreachable');
  const again=await (await h.cron('run',{source:'pssp'})).json();
  assert.equal(again.status,'ok','next run reads robots.txt again (memory is per run)');
  assert.equal(h.calls.site.filter(u=>u.endsWith('/robots.txt')).length,2);
  assert.equal(h.db.app_outside_sources[0].last_error,null);
});

// ---- 문서 표·index ------------------------------------------------------------------------------------------------

test('docs 5절 table: outside-feed row is verify_jwt=false and 배포 대기; index wires the handler with Deno.env only', () => {
  const doc=readFileSync('docs/web2-env6b-edge-source.md','utf8');
  const rows=doc.split('\n').filter(l=>/^\| \d+ \| `outside-feed` \|/.test(l));
  assert.equal(rows.length,1);assert.match(rows[0],/\| 배포 대기 \| 없음 \| false \|/);
  const idx=readFileSync('supabase/functions/outside-feed/index.ts','utf8');
  assert.match(idx,/Deno\.serve\(withWebCors\(createOutsideFeedHandler\(\{ env: \(name\) => Deno\.env\.get\(name\) \}\)\)\);/);
  const src=readFileSync('supabase/functions/outside-feed/handler.ts','utf8');
  assert.doesNotMatch(src,/console\.(log|info)\(/);
  assert.doesNotMatch(src,/"DELETE", `app_outside_posts/,'never deletes posts');
});

// ---- OUTSIDE-읽기고침·요약·순서(S47-34): 2026-11-01 실제 글 쪽 모양 표본 · 요약 실패 문구 ----------------------------------

test('사회주의를향한전진: 메뉴·옆 칸 링크는 빼고 성명/논평 게시판(me_code=20)만, 제목은 그림 title(전체), 날짜는 카드 날짜', () => {
  const s=sourceByKey('socialism');
  const items=P.parseListHtml(s,FX('socialism-list-2026-11.html'),s.lists[0],30,undefined,NOW);
  assert.deepEqual(items.map(i=>[i.url,i.kind,i.published_at]),[
    ['https://socialism.jinbo.net/bbs/board.php?bo_table=news&wr_id=9102','statement','2026-10-20T15:00:00.000Z'],
    ['https://socialism.jinbo.net/bbs/board.php?bo_table=news&wr_id=9098','comment','2026-09-24T15:00:00.000Z']]);
  assert.equal(items[0].title,'[성명] 가상 특별법 발의, 노동개악 흥정을 멈추고 가상 총파업을 조직하자!','줄임표로 잘린 카드 제목이 아님');
});

test('사회주의를향한전진 \'건너뜀 8\'의 까닭: 첫 <article>은 공유 단추 칸 → 본문 칸(#body_content)만 읽어 넣는다', async () => {
  const s=sourceByKey('socialism');
  assert.doesNotMatch(P.extractBody(FX('socialism-article.html'),'[성명] 가상 특별법 발의, 노동개악 흥정을 멈추고 가상 총파업을 조직하자!'),/가상 10월 20일/,'단체 본문 칸 없이 읽으면 공유 단추 칸만 나옴(옛 \'건너뜀\' 재현)');
  const body=P.extractBody(FX('socialism-article.html'),'[성명] 가상 특별법 발의, 노동개악 흥정을 멈추고 가상 총파업을 조직하자!',s.bodyClass);
  assert.match(body,/^가상 10월 20일, 가상 정당이 가상 특별법을 냈다/);assert.doesNotMatch(body,/페이스북|후원|계좌|최종편집|다른 기사/);
  const sites={[s.lists[0]]:FX('socialism-list-2026-11.html'),
    'https://socialism.jinbo.net/bbs/board.php?bo_table=news&wr_id=9102':FX('socialism-article.html'),
    'https://socialism.jinbo.net/bbs/board.php?bo_table=news&wr_id=9098':FX('socialism-article.html')};
  const h=harness({sources:[{workspace_id:WS,source_key:'socialism'}],sites,robots:{'https://socialism.jinbo.net':'User-agent: *\nAllow: /\n'}});
  const out=await (await h.cron('run',{source:'socialism'})).json();
  assert.equal(out.status,'ok');assert.equal(out.skipped,0);assert.equal(out.inserted,2);
  assert.ok(h.db.app_outside_posts.every(p=>p.has_body===true&&p.summary_ko));
  assert.equal(h.db.app_outside_posts.find(p=>p.url.endsWith('9102')).published_at,'2026-10-20T15:00:00.000Z','글 쪽 \'최종편집\' 날짜가 아니라 카드 날짜');
});

test('진보당 글 쪽: 머리 칸(작성자·등록일·좋아요)이 아니라 본문 칸(content_box)을 읽는다', () => {
  const s=sourceByKey('jinboparty');
  const body=P.extractBody(FX('jinboparty-article.html'),'[가상 대변인 브리핑] 가상 판결, 국민이 납득할 수 있습니까!',s.bodyClass);
  assert.match(body,/가상 법원은 같은 일을 두고/);assert.doesNotMatch(body,/작성자|좋아요|스크랩|목록/);
});

test('외국 글: 피드에 본문이 있으면 그것으로(글 쪽 안 읽음), 없으면 글 쪽 본문 칸 앞부분을 AI 재료로만 — 저장은 요약·핵심 문장뿐', async () => {
  // Labor Notes처럼 피드에 본문(content:encoded)이 있으면 글 쪽의 옆 칸 글자가 본문을 덮어쓰지 않는다.
  const feed=`<rss><channel><item><title>A Fictional Strike</title><link>https://labornotes.org/2026/10/fictional-organizing</link><pubDate>Thu, 29 Oct 2026 20:21:11 +0000</pubDate><description>Short teaser.</description><content:encoded><![CDATA[<p>${'Workers in a fictional city walked out on Monday. '.repeat(8)}</p>]]></content:encoded></item></channel></rss>`;
  const h=harness({sources:[{workspace_id:WS,source_key:'labornotes'}],sites:{'https://labornotes.org/feed':feed,'https://labornotes.org/2026/10/fictional-organizing':'<html><body><div>Sidebar: other stories »</div></body></html>'}});
  const out=await (await h.cron('run',{source:'labornotes'})).json();
  assert.equal(out.inserted,1);assert.ok(!h.calls.site.includes('https://labornotes.org/2026/10/fictional-organizing'));
  assert.match(h.calls.ai[0].input,/walked out on Monday/);
  // Jacobin: 피드엔 소개 글뿐 → 글 쪽 본문 칸(po-bo__content 여러 칸)만 재료로. 겹친 다른 글 카드·광고는 빼고.
  const jfeed=`<rss><channel><item><title>A Fictional War Might Get Worse</title><link>https://jacobin.com/2026/10/fictional-war</link><pubDate>Sat, 31 Oct 2026 14:43:45 +0000</pubDate><description>A short teaser line.</description></item></channel></rss>`;
  const j=harness({sources:[{workspace_id:WS,source_key:'jacobin'}],sites:{'https://jacobin.com/rss':jfeed,'https://jacobin.com/2026/10/fictional-war':FX('jacobin-article.html')}});
  const jo=await (await j.cron('run',{source:'jacobin'})).json();
  assert.equal(jo.inserted,1);
  assert.match(j.calls.ai[0].input,/widen a fictional war[\s\S]*Antiwar groups/);assert.doesNotMatch(j.calls.ai[0].input,/Settler Vanguard|Advertisement|related article/);
  assert.doesNotMatch(JSON.stringify(j.db.app_outside_posts),/widen a fictional war after/,'본문은 저장하지 않음');
});

test('요약 실패 문구: AI가 \'요약할 수 없음\'류를 쓰면 요약 칸을 비운다(국내·외국), 본문이 없으면 AI를 부르지 않고 제목만', async () => {
  for(const bad of ['본문이 제공되지 않아 요약할 수 없음.','요약 불가함.','기사 본문이 없음.','The article body was not provided, so it cannot be summarized.']){
    assert.equal(H.readKoSummary({summary:bad}),null,bad);
    const en=H.readEnIntro({title_ko:'가상 제목',summary_ko:bad,key_sentences:[{orig:'A line.',ko:'한 줄.'}]},'A line.');
    assert.deepEqual(en,{title_ko:'가상 제목',summary_ko:null,key_sentences:[]},bad);
  }
  assert.equal(H.readKoSummary({summary:'가상 정부 대책에 실질 내용이 없어 비판함.'}),'가상 정부 대책에 실질 내용이 없어 비판함.','실제 요약 속 \'내용이 없어\'는 그대로');
  assert.equal(H.readEnIntro({summary:'x'},'m'),null,'답 모양이 틀리면 AI 실패(넣지 않고 다음 실행에)');
  // 국내: AI가 실패 문구 → 넣되 요약 null.
  const h=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites:kctuSites(),ai:()=>({summary:'본문이 없어 요약할 수 없음.'})});
  const out=await (await h.cron('run',{source:'kctu'})).json();
  assert.equal(out.inserted,2);assert.ok(h.db.app_outside_posts.every(p=>p.summary_ko===null));assert.ok(h.db.app_outside_posts.some(p=>p.has_body===true),'본문 문장은 그대로 넣음');
  // 국내: 글 쪽은 읽었는데 본문 칸이 비면 → 제목만(AI 안 부름).
  const empty='<html><body><article><h1>[성명] 가상 노동법 개악 규탄</h1><p>작성자 가상</p></article></body></html>';
  const sites={...kctuSites()};for(const k of Object.keys(sites))if(/statement\/\d/.test(k))sites[k]=empty;
  const h2=harness({sources:[{workspace_id:WS,source_key:'kctu'}],sites});
  const o2=await (await h2.cron('run',{source:'kctu'})).json();
  assert.equal(o2.inserted,2);assert.equal(o2.skipped,0);assert.equal(h2.calls.ai.length,0);
  assert.ok(h2.db.app_outside_posts.every(p=>p.summary_ko===null&&p.has_body===false));
  // 외국: AI가 빈 요약 → 제목(+한국어 제목)만 넣음.
  const j=harness({sources:[{workspace_id:WS,source_key:'jacobin'}],sites:{'https://jacobin.com/rss':FX('jacobin.xml'),'https://jacobin.com/2026/10/fictional-strike-wave':FX('article-en.html')},
    ai:()=>({title_ko:'가상 파업 물결',summary_ko:'',key_sentences:[]})});
  const jo=await (await j.cron('run',{source:'jacobin'})).json();
  assert.equal(jo.inserted,1);assert.deepEqual([j.db.app_outside_posts[0].title_ko,j.db.app_outside_posts[0].summary_ko],['가상 파업 물결',null]);
});

test('안내 글은 넣지 않음: \'■ … 주간 홍보 일정\'·\'취재요청서 양식\'·[주간홍보]', () => {
  for(const key of ['kctu','kptu']){
    const s=sourceByKey(key);
    for(const t of ['■ 가상 주간 홍보 일정 (11/2~11/8)','취재요청서 양식','[주간홍보] 가상 주간 홍보 일정(11/2~11/8)'])assert.equal(s.kindOf(t,s.lists[0]),null,`${key}: ${t}`);
    assert.equal(s.kindOf('[성명] 가상 성명',s.lists[0]),'statement');
  }
});

// ---- OUTSIDE-노동묶음·정돈 1단계(S48-4, 요청 11/02 00:17·00:19): 제목 한 줄·진짜 게시 날짜·공용 정돈 함수 ------------------------

const T=await import('../../supabase/functions/_shared/outside-tidy.ts');

test('정돈 함수: 제목 한 줄 — 종류 꼬리표·단체명·날짜 꼬리 떼기, 긴 제목만 부제 나누기, 다른 머리말은 그대로', () => {
  assert.deepEqual(T.tidyTitle('[성명] 가상 노동법 개악 규탄','민주노총'),{title:'가상 노동법 개악 규탄',subtitle:null});
  assert.equal(T.tidyTitle('【보도자료】 가상 지부 출범 (2026.10.31)','공공운수노조').title,'가상 지부 출범');
  assert.equal(T.tidyTitle('[노동자연대 성명] 가상 파업을 지지한다','노동자연대').title,'가상 파업을 지지한다');
  assert.equal(T.tidyTitle('노동자연대 학생그룹 성명: 가상 등록금 인상 반대','노동자연대').title,'가상 등록금 인상 반대');
  assert.equal(T.tidyTitle('[성명] 가상 지역 공공의료를 지켜라 – 노동당','노동당').title,'가상 지역 공공의료를 지켜라','글 쪽 제목의 \' – 단체명\' 꼬리');
  assert.equal(T.tidyTitle('가상 공공부문 구조조정 반대 2026-10-31','').title,'가상 공공부문 구조조정 반대');
  assert.equal(T.tidyTitle('[단독] 가상 기사','').title,'[단독] 가상 기사','종류가 아닌 머리말은 둔다');
  assert.equal(T.tidyTitle('[주간홍보] 가상 일정','').title,'[주간홍보] 가상 일정');
  assert.equal(T.tidyTitle('가상 A - B','').title,'가상 A - B','짧은 제목의 \' - \'는 제목의 일부');
  const long=T.tidyTitle('[성명] 가상 지역 공공의료를 지켜라 - 가상 병원 폐업 결정을 철회하라 - 가상 시민의 건강권은 시장에 맡길 수 없다.','노동당');
  assert.deepEqual(long,{title:'가상 지역 공공의료를 지켜라',subtitle:'가상 병원 폐업 결정을 철회하라 - 가상 시민의 건강권은 시장에 맡길 수 없다.'});
  assert.deepEqual(T.tidyTitle('가상 제목\n가상 부제 줄\n본문','').subtitle,'가상 부제 줄');
  const noSplit=T.tidyTitle('가상 아주 긴 기사 제목이 여기에 길게 이어지고 또 이어진다 - 가상 부제처럼 보이는 말','',{split:false});
  assert.match(noSplit.title,/ - 가상 부제처럼/,'뉴스 기사 제목은 나누지 않음');
  const cutT=T.tidyTitle('가'.repeat(300),'');assert.equal([...cutT.title].length,100);assert.match(cutT.title,/…$/);
  assert.equal(T.tidyTitle('[성명]','x').title,'[성명]','꼬리표뿐이면 그대로(빈 제목 금지)');
  assert.equal(T.betterTitle('[성명] 가상 지역 공공의료를 지켜라 - 가상 병원 폐업 결정을 철회하라 - 본문',T.pageTitleFrom(FX('laborparty-article.html')),'노동당'),'가상 지역 공공의료를 지켜라');
  assert.equal(T.betterTitle('[성명] 가상 제목','노동당','노동당'),null,'사이트 이름뿐인 글 쪽 제목은 쓰지 않음');
  assert.equal(T.betterTitle('[성명] 가상 제목','다른 글 제목',''),null);
  assert.equal(T.isNoiseLine('조회 123'),true);assert.equal(T.isNoiseLine('공유하기'),true);assert.equal(T.isNoiseLine('첨부파일'),true);
  assert.equal(T.isNoiseLine('공유경제는 노동자를 보호하지 않는다는 점에서 우리는 이 법안을 반대한다.'),false,'긴 문장은 건드리지 않음');
  assert.equal(T.tidySummary('  요약: 가상 단체가\n반대함. '),'가상 단체가 반대함.');assert.equal(T.tidySummary(''),null);
  assert.equal([...T.tidySummary('가 '.repeat(300))].length<=200,true);
});

test('노동당 목록: 링크 하나에 제목·부제·본문 앞부분이 함께 있어도 제목은 첫 줄, 같은 줄 날짜 칸을 게시 날짜로(11/02 00:17)', () => {
  const s=sourceByKey('laborparty');
  const items=P.parseListHtml(s,FX('laborparty-list-2026-11.html'),s.lists[0],30,undefined,NOW);
  assert.deepEqual(items.map(i=>[i.url,i.kind,i.title,i.subtitle,i.published_at]),[
    ['https://laborparty.kr/?mod=document&page_id=13642&uid=6002','comment','[논평] 가상 노동시간 개악을 멈춰라','가상 부제: 장시간 노동은 답이 아니다','2026-10-30T15:00:00.000Z'],
    ['https://laborparty.kr/?mod=document&page_id=13642&uid=6001','statement','[성명] 가상 지역 공공의료를 지켜라 - 가상 병원 폐업 결정을 철회하라 - 가상 시민의 건강권은 시장에 맡길 수 없다. 가상 지자체는 지금 당장 폐업 결정을 거두고 공공의료 확충 계획을 내놓아야 한다.',null,null]]);
  assert.doesNotMatch(items[0].title,/개편안|2019/,'본문 앞부분이 제목에 들어가지 않음');
});

test('노동당 저장: 제목 한 줄(꼬리표 떼고, 글 쪽 og:title로 부제·본문 앞부분 떼기), 날짜는 목록 → 글 쪽, 본문에 첨부·공유 덧줄 없음', async () => {
  const s=sourceByKey('laborparty');
  const sites={[s.lists[0]]:FX('laborparty-list-2026-11.html'),
    'https://laborparty.kr/?mod=document&page_id=13642&uid=6002':FX('laborparty-article.html').replace(/지역 공공의료를 지켜라/g,'노동시간 개악을 멈춰라').replace('[성명]','[논평]'),
    'https://laborparty.kr/?mod=document&page_id=13642&uid=6001':FX('laborparty-article.html')};
  const h=harness({sources:[{workspace_id:WS,source_key:'laborparty'}],sites});
  const out=await (await h.cron('run',{source:'laborparty'})).json();
  assert.equal(out.status,'ok');assert.equal(out.inserted,2);
  const byUid=uid=>h.db.app_outside_posts.find(p=>p.url.endsWith(`uid=${uid}`));
  assert.equal(byUid(6002).title,'가상 노동시간 개악을 멈춰라');assert.equal(byUid(6002).kind,'comment');
  assert.equal(byUid(6002).published_at,'2026-10-30T15:00:00.000Z','목록 줄 날짜');
  assert.equal(byUid(6001).title,'가상 지역 공공의료를 지켜라');assert.equal(byUid(6001).kind,'statement');
  assert.equal(byUid(6001).published_at,'2026-10-26T15:00:00.000Z','목록에 날짜가 없으면 글 쪽 작성일');
  const text=h.db.app_outside_sentences.filter(x=>x.post_id===byUid(6001).id).map(x=>x.text).join(' ');
  assert.match(text,/가상 시민의 건강권은/);assert.doesNotMatch(text,/첨부파일|공유하기|페이스북|조회|\.hwp/);
  // AI 재료에도 정돈한 제목(꼬리표 없음)이 간다.
  assert.ok(h.calls.ai.every(a=>/^단체: 노동당\n제목: 가상 /.test(a.input)));
});

test('녹색당 목록: 줄마다 날짜 — 옛 선거 때 글은 그 날짜로(오늘로 묶이지 않음), 날짜 없는 글은 글 쪽에도 없으면 \'날짜 모름\'(null)', async () => {
  const s=sourceByKey('kgreens');
  const items=P.parseListHtml(s,FX('kgreens-list-2026-11.html'),s.lists[0],30,undefined,NOW);
  assert.deepEqual(items.map(i=>[i.url.replace(/^.*idx=/,''),i.published_at]),[['501','2022-02-09T15:00:00.000Z'],['903','2026-10-29T15:00:00.000Z'],['902',null]]);
  const sites={'https://kgreens.org/statement':FX('kgreens-list-2026-11.html'),'https://kgreens.org/press':'<html><body></body></html>',
    'https://kgreens.org/statement/?bmode=view&idx=501':FX('article-ko.html'),'https://kgreens.org/statement/?bmode=view&idx=903':FX('article-ko.html'),
    'https://kgreens.org/statement/?bmode=view&idx=902':FX('article-nodate.html')};
  const h=harness({sources:[{workspace_id:WS,source_key:'kgreens'}],sites});
  const out=await (await h.cron('run',{source:'kgreens'})).json();
  assert.equal(out.inserted,3);
  const at=idx=>h.db.app_outside_posts.find(p=>p.url.endsWith(`idx=${idx}`));
  assert.equal(at(501).published_at,'2022-02-09T15:00:00.000Z');
  assert.equal(at(902).published_at,null,'읽은 시각을 게시 시각으로 쓰지 않음');assert.equal(at(902).title,'가상 날짜 없는 글');
  // 화면: 날짜 모름 글은 '오늘'이 아니라 '날짜 모름' 묶음, 시각 칸도 '날짜 모름'.
  const M=await import('../../app/outside-statements-model.mjs');
  const rows=h.db.app_outside_posts.map(p=>({...p})).sort((a,b)=>(b.published_at??'').localeCompare(a.published_at??''));
  const groups=M.groupPosts(rows,NOW);
  assert.equal(groups.at(-1).label,'날짜 모름');assert.ok(!groups.some(g=>g.label==='오늘'));
  assert.equal(M.postView(at(902),NOW).time,'날짜 모름');
});

test('글 쪽 날짜: 메타(article:published_time) → 제목 뒤 날짜 → <time datetime>, 없으면 null', () => {
  assert.equal(P.pageDate('<meta property="article:published_time" content="2026-10-28T09:10:00+09:00"><h1>가상</h1><p>2020-01-01</p>','가상',NOW),'2026-10-28T00:10:00.000Z');
  assert.equal(P.pageDate('<h1>가상</h1><p>등록일 2026.10.27</p>','가상',NOW),'2026-10-26T15:00:00.000Z');
  assert.equal(P.pageDate('<h1>가상</h1><p>본문</p><time datetime="2026-10-25T01:00:00Z">어제</time>','가상',NOW),'2026-10-25T01:00:00.000Z');
  assert.equal(P.pageDate(FX('article-nodate.html'),'[논평] 가상 날짜 없는 글',NOW),null);
});

test('묶음: [노동](labor)은 민주노총·공공운수노조·금속노조·서비스연맹·학비노조(L1), 묶음은 노동·정당·사회운동·외국 넷뿐', () => {
  assert.deepEqual(OUTSIDE_CATALOG.filter(s=>s.group==='labor').map(s=>s.key),['kctu','kptu','kmwu','kfsu','hakbi']);
  assert.deepEqual([...new Set(OUTSIDE_CATALOG.map(s=>s.group))].sort(),['foreign','labor','movement','party']);
  // 뉴스 클리핑도 같은 정돈 함수만 부른다(다른 동작은 그대로).
  const news=readFileSync('supabase/functions/news-feed/handler.ts','utf8');
  assert.match(news,/from "\.\.\/_shared\/outside-tidy\.ts"/);
  const feed=readFileSync('supabase/functions/outside-feed/handler.ts','utf8');
  assert.match(feed,/tidyTitle\(/);assert.match(feed,/tidySummary\(/);
});

// ---- OUTSIDE-노동묶음·정돈 2단계(S48-4b'): [노동] 단체 추가(L1)·넣지 않은 단체(L2·L4)·공대위 표시(L3) ----------------------------

test('[노동] 추가 단체 목록 표본: 고정 공지·다른 게시판·http·쪽 번호 링크는 거르고, 줄 날짜를 게시 날짜로', () => {
  const rows=(key,file)=>{const s=sourceByKey(key);return P.parseListHtml(s,FX(file),s.lists[0],30,undefined,NOW).map(i=>[i.url,i.kind,i.title,i.published_at]);};
  assert.deepEqual(rows('kmwu','kmwu.html'),[
    ['https://kmwu.kr/bbs/board.php?bo_table=ce_B12&wr_id=8102','statement','[성명] 가상 하청노동자 교섭 거부 규탄 - 금속노조','2026-10-29T15:00:00.000Z'],
    ['https://kmwu.kr/bbs/board.php?bo_table=ce_B12&wr_id=8101','press','[보도자료] 가상 완성차 공동투쟁 결과','2026-10-28T15:00:00.000Z']]);
  assert.deepEqual(rows('kfsu','kfsu.html'),[
    ['https://kfsu.kr/%EC%84%B1%EB%AA%85-%EB%B3%B4%EB%8F%84%EC%9E%90%EB%A3%8C/?mod=document&uid=3302','press','[보도자료] 가상 돌봄노동자 처우개선 기자회견','2026-10-30T15:00:00.000Z'],
    ['https://kfsu.kr/%EC%84%B1%EB%AA%85-%EB%B3%B4%EB%8F%84%EC%9E%90%EB%A3%8C/?mod=document&uid=3301','statement','[성명] 가상 유통업 의무휴업 폐지 반대','2026-10-27T15:00:00.000Z']]);
  // 학비노조: 머리말 없는 '기자회견 개최 알림'·[취재요청]은 넣지 않는다.
  assert.deepEqual(rows('hakbi','hakbi.html'),[
    ['https://www.hakbi.org/board/media_reports/read/1205','statement','[성명] 가상 학교급식 노동자 산재 대책 촉구','2026-10-29T15:00:00.000Z'],
    ['https://www.hakbi.org/board/media_reports/read/1203','press','[보도자료] 가상 집단교섭 결렬 기자회견','2026-10-26T15:00:00.000Z']]);
});

test('[노동] 추가 단체 저장: 정돈 함수를 거쳐 제목 한 줄(꼬리표·단체명 꼬리 떼기), 목록 날짜 — robots.txt는 그대로 먼저 읽는다', async () => {
  for(const [key,file,want] of [['kmwu','kmwu.html',['가상 하청노동자 교섭 거부 규탄','가상 완성차 공동투쟁 결과']],
    ['kfsu','kfsu.html',['가상 돌봄노동자 처우개선 기자회견','가상 유통업 의무휴업 폐지 반대']],
    ['hakbi','hakbi.html',['가상 학교급식 노동자 산재 대책 촉구','가상 집단교섭 결렬 기자회견']]]){
    const s=sourceByKey(key);
    const sites={[s.lists[0]]:FX(file)};for(const [u] of EXPECT[key])sites[u]=FX('article-ko.html');
    const h=harness({sources:[{workspace_id:WS,source_key:key}],sites});
    const out=await (await h.cron('run',{source:key})).json();
    assert.equal(out.status,'ok',key);assert.equal(out.inserted,2,key);
    assert.deepEqual(EXPECT[key].map(([u])=>h.db.app_outside_posts.find(p=>p.url===u).title),want,key);
    assert.ok(h.calls.site.some(u=>new URL(u).pathname==='/robots.txt'),`${key}: robots 예외 아님 — robots.txt를 읽는다`);
  }
});

test('[노동] 추가 단체도 robots.txt가 막으면(Disallow: /) 읽지 않는다 — robots 예외는 늘리지 않음(L1·L2)', async () => {
  assert.deepEqual(H.ROBOTS_EXEMPT_KEYS,['kptu','laborparty']);
  for(const key of ['kmwu','kfsu','hakbi']){
    const s=sourceByKey(key);assert.equal(s.robotsException,undefined,key);
    const origin=new URL(s.lists[0]).origin;
    const h=harness({sources:[{workspace_id:WS,source_key:key}],sites:{[s.lists[0]]:FX(`${key}.html`)},robots:{[origin]:'User-agent: *\nDisallow: /\n'}});
    const out=await (await h.cron('run',{source:key})).json();
    assert.equal(out.status,'robots',key);assert.deepEqual(h.calls.site,[`${origin}/robots.txt`],`${key}: 목록도 읽지 않음`);
    assert.equal(h.db.app_outside_posts.length,0,key);
  }
});

test('넣지 않은 단체(L2 robots 미확인·L4): 전국공무원노조·전교조·건설노조·한국노총·공공연맹·보건의료노조·사무금융·공공노련 주소 없음', () => {
  const all=JSON.stringify(OUTSIDE_CATALOG.map(s=>[s.lists,s.hosts]));
  assert.doesNotMatch(all,/kgeu\.org|eduhope\.net|kcwu\.or\.kr|inochong\.org|publicunion\.kr|bogun\.nodong\.org|kfiu\.org/);
});

test('공대위 표시(L3): 민주노총·공공운수노조 글 중 제목·요약에 \'공대위\'·\'공동대책위원회\'가 든 글만', async () => {
  const M=await import('../../app/outside-statements-model.mjs');
  const v=p=>M.postView({lang:'ko',kind:'statement',url:'https://nodong.org/statement/1',published_at:'2026-10-30T00:00:00Z',...p},NOW).tag;
  assert.equal(v({source_key:'kctu',title:'[성명] 가상 공대위 공동성명'}),'공대위');
  assert.equal(v({source_key:'kptu',title:'[보도자료] 가상 기자회견',summary_ko:'양대노총 공공기관 노동조합 공동대책위원회가 가상 기자회견을 열었다.'}),'공대위');
  assert.equal(v({source_key:'kptu',title:'[성명] 가상 공공기관 성명',summary_ko:'가상 요약이다.'}),'');
  assert.equal(v({source_key:'kmwu',title:'[성명] 가상 공대위 이름이 든 다른 단체 글'}),'','민주노총·공공운수노조 글만');
  assert.equal(v({source_key:'laborparty',title:'[논평] 가상 공대위'}),'');
  const js=readFileSync('app/outside-statements.js','utf8');
  assert.match(js,/<span class="os-tag">\$\{esc\(v\.tag\)\}<\/span>/);
});
