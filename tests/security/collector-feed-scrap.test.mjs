import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// NEWS-클리핑 B2: collector-feed ?action=scrap(구독 채널 기사 줄 → app_news_items 대기 줄).
// 지어낸 Supabase(PostgREST)로 실제 handler를 돌린다. 네트워크·AI 없음. 주소는 모두 지어낸 example 주소다.
const {createCollectorFeedHandler,parseScrapBody,scrapUrl,scrapAt,SCRAP_MAX_ITEMS,SCRAP_DAILY_REQUESTS}=await import('../../supabase/functions/collector-feed/handler.ts');
const newsFeedFetch=await import('../../supabase/functions/_shared/feed-fetch.ts');
const newsUrl=await import('../../supabase/functions/_shared/news-url.ts');

const SB='https://synthetic.supabase.test';
const FN=`${SB}/functions/v1/collector-feed`;
const WS='a0000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-11-01T03:00:00Z');
const SECRET='synthetic-collector-feed-secret-0123456789';
const A='https://news.example.com/article/1001';
const ID_SHARED='b0000000-0000-4000-8000-0000000000aa';

const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

// 들어올 때 제목 읽기(S69 NEWS-제목늘읽기): 받은 기사 주소 한 장(지어낸 example 쪽)만 읽는다. page(url) → Response, 기본은 og:title이 있는 쪽.
const PAGE=u=>new Response(`<html><head><meta property="og:title" content="합성 제목 ${u.pathname}"><meta property="og:site_name" content="합성일보"><title>다른 제목</title></head><body></body></html>`,{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}});
function harness({ws=JSON.stringify(WS),existing=[],insertStatus=201,shared=[],sharedStatus=201,takenIds=[],page=PAGE}={}){
  const calls={feature:[],inserts:[],articles:[],maps:[],other:[],outside:0,peeks:[],patches:[],logs:[]};
  const keys=new Set(existing);
  const ids=new Set(takenIds);
  // 공용 기사(app_news_articles): url_key 전체 유일. shared = 이미 있는 [url_key, id].
  const art=new Map(shared);
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input));
    if(url.origin!==SB){
      calls.outside++;
      // 바깥은 받은 기사 주소의 GET 한 번만(robots.txt·다른 쪽 없음). 지어낸 example 호스트만 답한다.
      if((init.method||'GET')!=='GET'||!/(^|\.)example\.com$/.test(url.hostname))throw new Error('바깥 호출 없음');
      calls.peeks.push(url.href);return page(url);
    }
    if(init.method==='PATCH'){calls.patches.push({path:decodeURIComponent(url.pathname.replace('/rest/v1/','')+url.search),body:JSON.parse(init.body)});return respond([{}]);}
    const path=url.pathname.replace('/rest/v1/','');
    if(path==='rpc/app_operator_feature_workspace'){calls.feature.push(JSON.parse(init.body));return respond(ws);}
    if(path==='app_news_articles'&&init.method==='POST'){
      const row=JSON.parse(init.body);calls.articles.push(row);
      if(sharedStatus!==201)return respond({},sharedStatus);
      if(art.has(row.url_key))return respond({code:'23505'},409);
      art.set(row.url_key,row.id);return respond('',201);
    }
    if(path==='app_news_articles'&&(init.method||'GET')==='GET'){
      const k=decodeURIComponent((url.search.match(/url_key=eq\.([^&]*)/)||[])[1]||'');
      return respond(art.has(k)?[{id:art.get(k)}]:[]);
    }
    if(path==='app_news_items'&&init.method==='POST'){
      const row=JSON.parse(init.body);calls.inserts.push(row);
      if(insertStatus!==201)return respond({},insertStatus);
      const k=`${row.workspace_id}|${row.url_key}`;
      if(keys.has(k)||(row.id&&ids.has(row.id)))return respond({code:'23505'},409);
      keys.add(k);if(row.id)ids.add(row.id);return respond('',201);
    }
    if(path==='app_news_items'&&(init.method||'GET')==='GET'){
      const k=decodeURIComponent((url.search.match(/url_key=eq\.([^&]*)/)||[])[1]||'');
      return respond(keys.has(`${WS}|${k}`)?[{id:'x'}]:[]);
    }
    // NEWS-모두에게열기 E2: 옛 줄을 넣으면 같은 주소 공용 기사로 지도 1줄.
    if(path==='app_news_id_map'&&init.method==='POST'){calls.maps.push(JSON.parse(init.body));return respond('',201);}
    calls.other.push(`${init.method||'GET'} ${path}`);
    return respond([]);
  };
  const handler=createCollectorFeedHandler({
    env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role-key',COLLECTOR_FEED_SECRET:SECRET,WEB2_OPENAI_API_KEY:'synthetic-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push(JSON.stringify({code,...(detail||{})})),
  });
  const send=(body,{secret=SECRET,headers={},action='scrap'}={})=>handler(new Request(`${FN}?action=${action}`,{method:'POST',
    headers:{'Content-Type':'application/json',...(secret?{'x-collector-feed-secret':secret}:{}),...headers},body:JSON.stringify(body)}));
  return {send,calls};
}

test('정상: 운영자 기능(telegram)으로 작업공간을 정하고, 채널 대기 줄 칸만 넣는다(AI·바깥 읽기·다른 표 없음)',async()=>{
  const h=harness();
  const r=await h.send({items:[{url:A+'?utm_source=tg&utm_medium=x&id=7#top',at:'2026-11-01 11:59:00'.replace(' ','T')+'+09:00'}]});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,received:1,inserted:1,duplicate:0,rejected:0});
  assert.deepEqual(h.calls.feature,[{p_feature:'telegram'}]);
  const want={lane:'channel',url:A+'?id=7',url_key:'news.example.com/article/1001?id=7',scrapped_at:'2026-11-01T02:59:00.000Z',state:'pending'};
  // NEWS-모두에게열기 ②: 공용 기사(origin tg_scrap — 운영자만 봄)와 운영자 옛 줄을 같은 id로(옮기는 동안 둘 다).
  assert.equal(h.calls.articles.length,1);
  const id=h.calls.articles[0].id;
  assert.match(id,/^[0-9a-f-]{36}$/);
  assert.deepEqual(h.calls.articles,[{id,origin:'tg_scrap',...want}]);
  assert.deepEqual(h.calls.inserts,[{id,workspace_id:WS,...want}]);
  assert.deepEqual(h.calls.maps,[{old_id:id,workspace_id:WS,article_id:id}],'지도 1줄(옛 id = 기사 id)');
  assert.deepEqual(h.calls.other,[]);
  // 들어올 때 제목 읽기: 받은 그 주소 한 장만(robots.txt·다른 쪽 없음), 제목이 빈 줄의 제목·열쇠·매체만 적는다(상태는 대기 그대로).
  assert.equal(h.calls.outside,1);
  assert.deepEqual(h.calls.peeks,[A+'?id=7']);
  assert.equal(h.calls.patches.length,2);
  const [pa,pi]=h.calls.patches;
  assert.equal(pa.path,`app_news_articles?id=eq.${id}&title=is.null`);
  assert.equal(pi.path,`app_news_items?workspace_id=eq.${WS}&url_key=eq.news.example.com/article/1001?id=7&title=is.null`);
  for(const p of [pa,pi]){
    assert.deepEqual(Object.keys(p.body).sort(),['publisher','title','title_key','updated_at']);
    assert.equal(p.body.title,'합성 제목 /article/1001');assert.equal(p.body.publisher,'합성일보');assert.ok(p.body.title_key);
  }
  assert.ok(!h.calls.logs.join('\n').includes('example'),'로그에 주소 없음');
  assert.ok(!h.calls.logs.join('\n').includes('합성 제목'),'로그에 제목 없음');
});

test('제목 읽기: 못 읽으면(404·봇 확인·제목 없음·주소뿐인 제목) 아무것도 고치지 않는다 — 줄은 대기 그대로 남아 다음 원문 읽기가 다시 읽는다',async()=>{
  const pages=[
    ()=>new Response('없음',{status:404,headers:{'Content-Type':'text/html'}}),
    ()=>new Response('<html><script src="/aes.js"></script>Just a moment...</html>',{status:200,headers:{'Content-Type':'text/html'}}),
    ()=>new Response('<html><head></head><body>글</body></html>',{status:200,headers:{'Content-Type':'text/html'}}),
    ()=>new Response('<html><head><title>news.example.com</title></head></html>',{status:200,headers:{'Content-Type':'text/html'}}),
  ];
  for(const page of pages){
    const h=harness({page});
    const r=await h.send({items:[{url:A}]});
    assert.equal(r.status,200);
    assert.equal((await r.json()).inserted,1);
    assert.equal(h.calls.peeks.length,1);
    assert.deepEqual(h.calls.patches,[],'제목을 못 얻으면 쓰지 않음');
    assert.equal(h.calls.inserts[0].state,'pending');
  }
});

test('제목 읽기: 한 번 요청에 처음 들어온 주소 TITLE_PEEK_MAX건까지만, 이미 있던 공용 기사는 읽지 않는다',async()=>{
  const {TITLE_PEEK_MAX}=await import('../../supabase/functions/collector-feed/handler.ts');
  const h=harness({shared:[['news.example.com/article/1',ID_SHARED]]});
  const items=Array.from({length:TITLE_PEEK_MAX+3},(_,i)=>({url:`https://news.example.com/article/${i+1}`}));
  const r=await h.send({items});
  assert.equal(r.status,200);
  assert.equal(h.calls.peeks.length,TITLE_PEEK_MAX);
  assert.ok(!h.calls.peeks.includes('https://news.example.com/article/1'),'이미 있던 공용 기사 주소는 읽지 않음');
});

test('겹침: 같은 요청 안·이미 있는 주소(www·추적 값·끝 / 차이)는 무시하고 개수만 센다',async()=>{
  const h=harness({existing:[`${WS}|news.example.com/article/1001`]});
  const r=await h.send({items:[
    {url:'https://www.news.example.com/article/1001/?fbclid=zz'},
    {url:'https://news.example.com/article/2002',at:'2026-10-31T23:00:00+09:00'},
    {url:'https://news.example.com/article/2002?utm_campaign=a'},
  ]});
  assert.deepEqual(await r.json(),{ok:true,received:3,inserted:1,duplicate:2,rejected:0});
  assert.equal(h.calls.articles.length,2,'요청 안 겹침은 DB에 가지 않음');
  assert.equal(h.calls.inserts[0].url_key,'news.example.com/article/1001');
  assert.equal(h.calls.inserts[0].scrapped_at,new Date(NOW).toISOString(),'at 없으면 받은 시각');
});

test('주소 규칙: http·내부 이름·IP 숫자·포트·사용자 정보·Supabase·너무 긴 주소·틀린 시각은 버리고(rejected) 나머지는 넣는다',async()=>{
  const bad=['http://news.example.com/a','https://localhost/a','https://intranet/a','https://10.0.0.1/a','https://[::1]/a','https://news.example.com:8443/a',
    'https://u:p@news.example.com/a','https://abc.supabase.co/rest/v1/x','https://svc.internal/a','javascript:alert(1)','ftp://news.example.com/a','https://news.example.com/'+'a'.repeat(2100),'아무 글'];
  const h=harness();
  const r=await h.send({items:[...bad.map(url=>({url})),{url:A,at:'2026-11-02T03:00:00Z'},{url:A,at:'2026-07-01T00:00:00Z'},{url:A,at:'2026-11-01 12:00:00'},{url:A}]});
  assert.deepEqual(await r.json(),{ok:true,received:bad.length+4,inserted:1,duplicate:0,rejected:bad.length+3});
  assert.deepEqual(h.calls.inserts.map(x=>x.url),[A]);
  assert.deepEqual(h.calls.articles.map(x=>x.url),[A],'버린 주소는 공용 표에도 안 감');
});

test('공용 기사에 같은 주소가 이미 있으면(사이트 수집분 등) 공용 쪽은 그대로, 운영자 옛 줄은 그 id로 넣는다',async()=>{
  const OLD='b0000000-0000-4000-8000-0000000000aa';
  const h=harness({shared:[['news.example.com/article/1001',OLD]]});
  const r=await h.send({items:[{url:A}]});
  assert.deepEqual(await r.json(),{ok:true,received:1,inserted:1,duplicate:0,rejected:0});
  assert.equal(h.calls.inserts.length,1);
  assert.equal(h.calls.inserts[0].id,OLD);
});

test('공용 기사 id가 이미 다른 작업공간 옛 줄에 쓰였으면 운영자 줄은 새 id로(같은 주소 줄이 없을 때만)',async()=>{
  const OLD='b0000000-0000-4000-8000-0000000000bb';
  const h=harness({shared:[['news.example.com/article/1001',OLD]],takenIds:[OLD]});
  const r=await h.send({items:[{url:A}]});
  assert.equal((await r.json()).inserted,1);
  const ids=h.calls.inserts.map(x=>x.id);
  assert.equal(ids.length,2);assert.equal(ids[0],OLD);
  assert.match(ids[1],/^[0-9a-f-]{36}$/);assert.notEqual(ids[1],OLD,'id 충돌 → 같은 주소 줄 없음 확인 → 새 id');
  assert.deepEqual(h.calls.maps,[{old_id:ids[1],workspace_id:WS,article_id:OLD}],'새 id 옛 줄도 같은 주소 공용 기사로 지도');
});

test('공용 표 쓰기가 실패해도(적용 전·일시 장애) 옛 표 쓰기는 그대로 — 화면 유지',async()=>{
  const h=harness({sharedStatus:503});
  const r=await h.send({items:[{url:A}]});
  assert.deepEqual(await r.json(),{ok:true,received:1,inserted:1,duplicate:0,rejected:0});
  assert.equal(h.calls.inserts[0].id,undefined);
  assert.deepEqual(h.calls.maps,[],'공용 기사가 없으면 지도 없음(보충 함수가 나중에)');
  assert.ok(h.calls.logs.some(l=>l.includes('news_shared_failed')));
});

test('몸통 모양: 칸 추가·작업공간 칸·빈 목록·51줄·글자 아닌 주소는 400이고 DB·기능 확인에 가지 않는다',async()=>{
  const many=Array.from({length:SCRAP_MAX_ITEMS+1},(_,i)=>({url:`${A}${i}`}));
  for(const b of [{},{items:[]},{items:many},{items:[{url:A}],workspace_id:WS},{items:[{url:A,workspace_id:WS}]},{items:[{url:A,title:'가짜'}]},
    {items:[{url:1}]},{items:[{url:A,at:5}]},{items:[A]},{items:'x'}]){
    const h=harness();const r=await h.send(b);
    assert.equal(r.status,400,JSON.stringify(b).slice(0,60));
    assert.equal((await r.json()).error,'INVALID_BODY');
    assert.equal(h.calls.feature.length+h.calls.inserts.length,0);
  }
  assert.equal(parseScrapBody({items:[{url:A}]}).length,1);
});

test('인증: 비밀값 없음·틀림·로그인 헤더·다른 입구 비밀 헤더는 401이고 몸통·DB에 가지 않는다',async()=>{
  for(const opt of [{secret:''},{secret:'wrong-secret-wrong-secret-wrong-secret'},{headers:{authorization:'Bearer x'}},{headers:{'x-collector-heartbeat-secret':SECRET}},{headers:{'x-drive-summary-cron-secret':SECRET}}]){
    const h=harness();const r=await h.send({items:[{url:A}]},opt);
    assert.equal(r.status,401);
    assert.equal(h.calls.feature.length+h.calls.inserts.length,0);
  }
});

test('운영자 기능: 허용 작업공간이 없거나(null) 함수가 없으면 503이고 저장하지 않는다',async()=>{
  for(const ws of ['null','"not-a-uuid"']){
    const h=harness({ws});const r=await h.send({items:[{url:A}]});
    assert.equal(r.status,503);assert.equal((await r.json()).error,'WORKSPACE_UNAVAILABLE');assert.equal(h.calls.inserts.length,0);
  }
});

test('DB 실패(표 없음 등)는 503 — 앱 스크립트가 위치를 넘기지 않고 다음에 다시 보낸다',async()=>{
  const h=harness({insertStatus:404});const r=await h.send({items:[{url:A}]});
  assert.equal(r.status,503);assert.equal((await r.json()).error,'DB_WRITE_FAILED');
});

test('하루 상한: 같은 인스턴스에서 SCRAP_DAILY_REQUESTS번 뒤에는 429',async()=>{
  const h=harness();
  for(let i=0;i<SCRAP_DAILY_REQUESTS;i++)assert.equal((await h.send({items:[{url:`${A}?n=${i}`}]})).status,200);
  const r=await h.send({items:[{url:A}]});
  assert.equal(r.status,429);assert.equal((await r.json()).error,'DAILY_LIMIT');
});

test('주소 규칙은 news-feed와 한 곳(_shared/news-url.ts): feed-fetch는 같은 함수를 다시 내보낸다(복사 없음)',()=>{
  assert.equal(newsFeedFetch.openArticleUrl,newsUrl.openArticleUrl);
  assert.equal(newsFeedFetch.cleanArticleUrl,newsUrl.cleanArticleUrl);
  assert.equal(newsFeedFetch.urlKey,newsUrl.urlKey);
  const src=readFileSync(new URL('../../supabase/functions/collector-feed/handler.ts',import.meta.url),'utf8');
  assert.match(src,/from "\.\.\/_shared\/news-url\.ts"/);
  assert.doesNotMatch(src,/TRACKING\s*=/,'추적 값 목록을 따로 두지 않음');
  assert.deepEqual(scrapUrl('https://news.example.com/a?gclid=1&q=2'),{url:'https://news.example.com/a?q=2',url_key:'news.example.com/a?q=2'});
  assert.equal(scrapAt('2026-11-01T12:20:00+09:00',NOW),null,'10분 넘게 앞섬');
  assert.equal(scrapAt('2026-11-01T12:05:00+09:00',NOW),'2026-11-01T03:05:00.000Z');
});

test('원문 주소 칸 넣기는 대기 줄 칸뿐: 제목·본문·요약·번역·별표·폴더 칸을 쓰지 않는다',()=>{
  const src=readFileSync(new URL('../../supabase/functions/collector-feed/handler.ts',import.meta.url),'utf8');
  const lines=[src.split('\n').find(l=>l.includes('const row = { workspace_id: ws, lane: "channel"')),src.split('\n').find(l=>l.includes('db.insert("app_news_articles"'))];
  for(const line of lines){
    assert.ok(line);
    for(const k of ['title','body','summary','title_ko','starred_at','folder_id','hidden_at','publisher','room','sender','text'])assert.ok(!new RegExp(`\\b${k}:`).test(line),k);
  }
});
