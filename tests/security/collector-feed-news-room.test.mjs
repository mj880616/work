import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// NEWS-모두에게열기 ②: collector-feed ?action=telegram이 뉴스방 글에서 기사 주소만 뽑아 서버 전용 DB 함수 app_news_room_take로 보낸다.
// 지어낸 Supabase로 실제 handler를 돌린다(네트워크·AI 없음 — AI 열쇠가 없어 주소 단계 뒤 503 AI_NOT_CONFIGURED로 멈춘다).
// 방·사람·주소는 모두 지어낸 것이다. 원문·방 이름·보낸 사람이 공용 표 쪽 호출에 실리지 않는지(거절 시험)를 본다.
const {createCollectorFeedHandler,newsRoomItems,NEWS_ROOM_FN,NEWS_ROOM_CHUNK,FAMILY_TABLE}=await import('../../supabase/functions/collector-feed/handler.ts');

const SB='https://synthetic.supabase.test';
const FN=`${SB}/functions/v1/collector-feed`;
const WS='a0000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-10-24T03:00:00Z');
const TODAY='2026-10-24';
const SECRET='synthetic-collector-feed-secret-0123456789';
const RAW='가상원문표식',LABEL='가상 업무방 이름표식';
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

// take: app_news_room_take 응답을 정하는 함수(인자 → {status, body}). 기본은 '뉴스방 아님'.
function harness({take=()=>({status:200,body:{ok:true,news:false,taken:0,dup:0,widened:0,refused:0}}),articles=[],family=false}={}){
  const calls={take:[],oldInserts:[],articleGets:[],maps:[],sharedWrites:[],logs:[],openai:0,family:0};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET';
    if(url.origin!==SB){calls.openai++;return respond({},500);}
    const path=url.pathname.replace('/rest/v1/','');
    if(path==='rpc/app_operator_feature_workspace')return respond(JSON.stringify(WS));
    if(path===`rpc/${NEWS_ROOM_FN}`){const args=JSON.parse(init.body);calls.take.push(args);const r=take(args,calls.take.length);return respond(r.body,r.status);}
    if(path.startsWith('rpc/'))return respond({ok:true});
    if(path===FAMILY_TABLE){calls.family++;return respond(family?[{source_ref:'fam:tg:x:1'}]:[]);}
    if(path==='app_news_articles'&&method==='GET'){calls.articleGets.push(decodeURIComponent(url.search));return respond(articles);}
    if(path==='app_news_items'&&method==='POST'){calls.oldInserts.push(JSON.parse(init.body));return respond('',201);}
    if(path==='app_news_id_map'&&method==='POST'){calls.maps.push(JSON.parse(init.body));return respond('',201);}
    // 공용 쪽 표(기사·본문·표시·사람별 새 표)에 직접 쓰는 호출은 모두 기록(거절 시험: 뉴스방이 아니면 0).
    if(/^app_news_(articles|article_bodies|marks|reads|now_details|now_signals)$/.test(path)&&method!=='GET'){calls.sharedWrites.push(path);return respond('',201);}
    if(method==='GET')return respond([]);
    return respond('',201);
  };
  const handler=createCollectorFeedHandler({
    env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role-key',COLLECTOR_FEED_SECRET:SECRET})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push(JSON.stringify({code,...(detail||{})})),
  });
  const send=body=>handler(new Request(`${FN}?action=telegram`,{method:'POST',headers:{'Content-Type':'application/json','x-collector-feed-secret':SECRET},body:JSON.stringify(body)}));
  return {send,calls};
}
const msg=(ref,text,sender='A')=>({ref,at:'2026-10-24T00:10:00Z',sender,text});
const body=(o={})=>({day:TODAY,room_key:'-100777',room_label:LABEL,total:3,chat_kind:'channel',messages:[
  msg('1',`오늘 기사 https://news.example.com/a/1?utm_source=tg 입니다 ${RAW}`),
  msg('2','회의 자료 https://docs.google.com/document/d/abc/edit 그리고 https://news.example.org/b/2.'),
  msg('3','초대 https://t.me/+secretinvite 와 http://insecure.example.com/x'),
],...o});

test('뉴스방 함수에는 방 키(판정용)와 주소(url·url_key)만 간다 — 원문·방 이름·보낸 사람·시각 없음',async()=>{
  const h=harness();
  const r=await h.send(body());
  assert.equal(r.status,503,'AI 열쇠가 없어 주소 단계 뒤에 멈춤(소식 처리 그대로)');
  assert.equal(h.calls.take.length,1);
  const args=h.calls.take[0];
  assert.deepEqual(Object.keys(args).sort(),['p_items','p_room_key','p_workspace']);
  assert.equal(args.p_workspace,WS,'작업공간은 서버(운영자 기능)가 정한 것');
  assert.equal(args.p_room_key,'-100777');
  for(const it of args.p_items)assert.deepEqual(Object.keys(it).sort(),['url','url_key']);
  const sent=JSON.stringify(args);
  for(const bad of [RAW,LABEL,'오늘 기사','회의 자료','"A"','2026-10-24T00:10'])assert.ok(!sent.includes(bad),`실리면 안 됨: ${bad}`);
  // 열린 주소 규칙(https만)·추적 값 떼기·끝 문장 부호 떼기. 업무 문서·텔레그램 주소는 여기서는 지나가도 DB 함수가 버린다(이중 장치).
  assert.deepEqual(args.p_items.map(x=>x.url),['https://news.example.com/a/1','https://docs.google.com/document/d/abc/edit','https://news.example.org/b/2','https://t.me/+secretinvite']);
});

test('뉴스방이 아니면(함수 news:false) 옛 표·공용 표 어디에도 더 쓰지 않는다',async()=>{
  const h=harness();
  await h.send(body());
  assert.equal(h.calls.oldInserts.length,0);
  assert.equal(h.calls.articleGets.length,0);
  assert.deepEqual(h.calls.maps,[],'지도도 없음');assert.deepEqual(h.calls.sharedWrites,[],'공용·사람별 새 표 쓰기 없음');
  assert.ok(!h.calls.logs.some(l=>l.includes('news_room_taken')),'대부분의 방은 로그도 없음');
});

test('1:1·종류 모름 방은 함수를 부르지도 않는다(서버도 다시 거절 — DB 시험 news-for-all-db)',async()=>{
  for(const o of [{room_key:'123456789',chat_kind:undefined},{chat_kind:'user'},{room_key:'-100777',chat_kind:undefined}]){
    const b=body(o);if(o.chat_kind===undefined)delete b.chat_kind;
    const h=harness();await h.send(b);
    assert.equal(h.calls.take.length,0,JSON.stringify(o));
    assert.deepEqual([h.calls.oldInserts,h.calls.maps,h.calls.sharedWrites],[[],[],[]],'1:1 방 글은 옛 표·지도·공용 표 어디에도 없음');
  }
  const h=harness();await h.send(body({room_key:'-4242',chat_kind:undefined}));
  assert.equal(h.calls.take.length,1,'방 번호 모양이 그룹이면 보낸다');
});

test('가족 방은 소식 입구 자체가 400 FAMILY_ROOM — 뉴스방 함수에 가지 않는다',async()=>{
  const h=harness({family:true});
  const r=await h.send(body());
  assert.equal(r.status,400);assert.equal((await r.json()).error,'FAMILY_ROOM');
  assert.equal(h.calls.take.length,0);
  assert.deepEqual([h.calls.oldInserts,h.calls.maps,h.calls.sharedWrites],[[],[],[]],'가족 방 글은 어디에도 없음');
});

test('뉴스방이면 새로 들어온 tg_room 기사만 운영자 옛 표에 같은 id로(옮기는 동안 화면 유지), 로그는 개수만',async()=>{
  const ID='c0000000-0000-4000-8000-000000000001';
  const h=harness({take:()=>({status:200,body:{ok:true,news:true,taken:1,dup:1,widened:0,refused:2}}),
    articles:[{id:ID,url:'https://news.example.com/a/1',url_key:'news.example.com/a/1',scrapped_at:'2026-10-24T03:00:00.000Z'}]});
  await h.send(body());
  assert.match(h.calls.articleGets[0],/origin=eq\.tg_room/);
  assert.deepEqual(h.calls.oldInserts,[{id:ID,workspace_id:WS,lane:'channel',url:'https://news.example.com/a/1',url_key:'news.example.com/a/1',scrapped_at:'2026-10-24T03:00:00.000Z',state:'pending'}]);
  // E2: 옛 줄마다 지도 1줄 — id 세 칸뿐(방·원문·보낸 사람 없음).
  assert.deepEqual(h.calls.maps,[{old_id:ID,workspace_id:WS,article_id:ID}]);
  assert.deepEqual(h.calls.sharedWrites,[],'공용 표 직접 쓰기 없음(넣기는 DB 함수만)');
  const log=h.calls.logs.find(l=>l.includes('news_room_taken'));
  assert.deepEqual(JSON.parse(log),{code:'news_room_taken',found:4,taken:1,dup:1,widened:0,refused:2,mirrored:1});
  assert.ok(!h.calls.logs.join('\n').includes('example'),'로그에 주소 없음');
});

test('함수 실패(적용 전 404·오류)는 소식 처리를 막지 않고 단계 코드만 남긴다',async()=>{
  for(const [status,want] of [[404,'FN_MISSING'],[400,'NEWSROOM_ARGS']]){
    const h=harness({take:()=>({status,body:{message:'NEWSROOM_ARGS'}})});
    const r=await h.send(body());
    assert.equal(r.status,503,'그 뒤 AI 단계까지 감');
    assert.ok(h.calls.logs.some(l=>l.includes('news_room_failed')&&l.includes(want)),want);
    assert.equal(h.calls.oldInserts.length,0);
  }
});

test('주소가 많으면 50개씩 나눠 보내고 200개에서 멈춘다. 뉴스방 아님이 오면 그 뒤는 보내지 않는다',async()=>{
  const many=Array.from({length:5},(_,k)=>msg(String(k+1),Array.from({length:60},(_,i)=>`https://n${k}.example.com/a/${i}`).join(' ')));
  const items=newsRoomItems(many);
  assert.equal(items.length,200);
  const h=harness({take:()=>({status:200,body:{ok:true,news:true,taken:0,dup:0,widened:0,refused:0}})});
  await h.send(body({messages:many.slice(0,4),total:4}));
  assert.deepEqual(h.calls.take.map(a=>a.p_items.length),[NEWS_ROOM_CHUNK,NEWS_ROOM_CHUNK,NEWS_ROOM_CHUNK,NEWS_ROOM_CHUNK]);
  const h2=harness();
  await h2.send(body({messages:many.slice(0,4),total:4}));
  assert.equal(h2.calls.take.length,1);
});

test('소스: 뉴스방 처리는 주소만 넘기고, 공용 표 직접 쓰기는 대기 줄 칸뿐이다',()=>{
  const src=readFileSync(new URL('../../supabase/functions/collector-feed/handler.ts',import.meta.url),'utf8');
  const fn=src.slice(src.indexOf('async function takeNewsRoom'),src.indexOf('// ---- 입구'));
  assert.match(fn,/rpcObject\(NEWS_ROOM_FN, \{ p_workspace: ws, p_room_key: input\.room_key, p_items: part \}\)/);
  assert.ok(!/room_label|sender|\.text\b|messages\[/.test(fn.replace(/\/\/.*$/gm,'').replace(/newsRoomItems\(input\.messages\)/,'')),'방 이름·보낸 사람·원문을 쓰지 않음');
  assert.ok(!/app_news_articles", \{[^}]*(text|room|sender|label)/.test(src),'공용 표 넣기에 원문·방 칸 없음');
  assert.match(src,/db\.insert\("app_news_id_map", \{ old_id: oldId, workspace_id: ws, article_id: articleId \}\)/,'지도 넣기는 id 세 칸뿐');
  assert.ok(!/app_news_(article_bodies|reads|now_details|now_signals)/.test(src.replace(/\/\/.*$/gm,'')),'수집기는 공용 본문·사람별 새 표에 직접 쓰지 않음');
});
