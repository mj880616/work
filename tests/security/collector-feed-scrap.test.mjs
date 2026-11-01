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

const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

function harness({ws=JSON.stringify(WS),existing=[],insertStatus=201}={}){
  const calls={feature:[],inserts:[],other:[],outside:0,logs:[]};
  const keys=new Set(existing);
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input));
    if(url.origin!==SB){calls.outside++;throw new Error('바깥 호출 없음');}
    const path=url.pathname.replace('/rest/v1/','');
    if(path==='rpc/app_operator_feature_workspace'){calls.feature.push(JSON.parse(init.body));return respond(ws);}
    if(path==='app_news_items'&&init.method==='POST'){
      const row=JSON.parse(init.body);calls.inserts.push(row);
      if(insertStatus!==201)return respond({},insertStatus);
      const k=`${row.workspace_id}|${row.url_key}`;
      if(keys.has(k))return respond({code:'23505'},409);
      keys.add(k);return respond('',201);
    }
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
  assert.deepEqual(h.calls.inserts,[{workspace_id:WS,lane:'channel',url:A+'?id=7',url_key:'news.example.com/article/1001?id=7',scrapped_at:'2026-11-01T02:59:00.000Z',state:'pending'}]);
  assert.deepEqual(h.calls.other,[]);
  assert.equal(h.calls.outside,0);
  assert.ok(!h.calls.logs.join('\n').includes('example'),'로그에 주소 없음');
});

test('겹침: 같은 요청 안·이미 있는 주소(www·추적 값·끝 / 차이)는 무시하고 개수만 센다',async()=>{
  const h=harness({existing:[`${WS}|news.example.com/article/1001`]});
  const r=await h.send({items:[
    {url:'https://www.news.example.com/article/1001/?fbclid=zz'},
    {url:'https://news.example.com/article/2002',at:'2026-10-31T23:00:00+09:00'},
    {url:'https://news.example.com/article/2002?utm_campaign=a'},
  ]});
  assert.deepEqual(await r.json(),{ok:true,received:3,inserted:1,duplicate:2,rejected:0});
  assert.equal(h.calls.inserts.length,2,'요청 안 겹침은 DB에 가지 않음');
  assert.equal(h.calls.inserts[0].scrapped_at,new Date(NOW).toISOString(),'at 없으면 받은 시각');
});

test('주소 규칙: http·내부 이름·IP 숫자·포트·사용자 정보·Supabase·너무 긴 주소·틀린 시각은 버리고(rejected) 나머지는 넣는다',async()=>{
  const bad=['http://news.example.com/a','https://localhost/a','https://intranet/a','https://10.0.0.1/a','https://[::1]/a','https://news.example.com:8443/a',
    'https://u:p@news.example.com/a','https://abc.supabase.co/rest/v1/x','https://svc.internal/a','javascript:alert(1)','ftp://news.example.com/a','https://news.example.com/'+'a'.repeat(2100),'아무 글'];
  const h=harness();
  const r=await h.send({items:[...bad.map(url=>({url})),{url:A,at:'2026-11-02T03:00:00Z'},{url:A,at:'2026-07-01T00:00:00Z'},{url:A,at:'2026-11-01 12:00:00'},{url:A}]});
  assert.deepEqual(await r.json(),{ok:true,received:bad.length+4,inserted:1,duplicate:0,rejected:bad.length+3});
  assert.deepEqual(h.calls.inserts.map(x=>x.url),[A]);
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
  const line=src.split('\n').find(l=>l.includes('db.insert("app_news_items"'));
  assert.ok(line);
  for(const k of ['title','body','summary','title_ko','starred_at','folder_id','hidden_at','publisher'])assert.ok(!new RegExp(`\\b${k}:`).test(line),k);
});
