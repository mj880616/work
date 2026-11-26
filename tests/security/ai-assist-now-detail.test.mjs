import test from 'node:test';
import {withAiMonth} from './helpers/ai-month-fake.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// OUTSIDE-글상세·관심환류 PR ②: the real ai-assist handler, kind=now_detail·now_interests, with a synthetic Supabase
// (Auth + PostgREST with owner RLS for the user token, service-role writes for the three Now tables), a mocked OpenAI and
// a mocked foreign site. No network, no real key, synthetic text only (가상 단체·가상 글, 09xx ids).
const {createAiAssistHandler}=await import('../../supabase/functions/ai-assist/handler.ts');
const N=await import('../../supabase/functions/ai-assist/now-detail.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const SERVICE='synthetic-service-role-key',ANON='synthetic-anon-key';
const NOW=Date.parse('2026-11-02T10:00:00Z'); // 서울 19:00
const POST_KO=id(1),POST_EN=id(2),POST_OTHER=id(3),NEWS_1=id(4),POST_EN_BAD=id(5);
const FOREIGN_URL='https://www.socialistworker.co.uk/news/synthetic-strike-wave/';
const BODY_KO='공공기관 민영화 저지 투쟁을 선포한다. 정부는 철도와 가스의 분할을 멈춰야 한다. 우리는 11월 총파업으로 답한다.';

const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=obj=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(obj)}]}],usage:{input_tokens:3000,output_tokens:400}});

// NEWS-모두에게열기 E3: 글은 공용 표(옛 줄 id = 공용 id — 운영자 줄처럼), 자세히·반응은 사람별 새 표(공용 글 id). 옛 표는 옮기는 동안 함께 적는다.
const NEW_DETAIL={outside:'app_outside_now_details',news:'app_news_now_details'};
const toShared=(r,col)=>({workspace_id:r.workspace_id,article_id:r[col],...Object.fromEntries(Object.entries(r).filter(([k])=>!['id','workspace_id','outside_post_id','news_item_id'].includes(k)))});
function harness({openai=null,usage=[],details=[],interests=[],signals=[],site=null,env={},feed=[],map=[],blocked=false}={}){
  const calls={openai:[],rest:[],service:[],site:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_outside_posts:[
      {id:POST_KO,workspace_id:WS,source_key:'kptu',kind:'statement',lang:'ko',title:'[성명] 공공기관 민영화 저지 투쟁 선포',title_ko:null,author:null,url:'https://www.kptu.net/x/1',summary_ko:null,key_sentences:[],has_body:true,fetched_at:'2026-11-02T08:00:00Z'},
      {id:POST_EN,workspace_id:WS,source_key:'socialistworker',kind:'article',lang:'en',title:'Strike wave grows',title_ko:'파업 물결 확산',author:null,url:FOREIGN_URL,summary_ko:'영국 공공부문 파업이 번지고 있다.',key_sentences:[{orig:'Workers voted to strike.',ko:'노동자들이 파업을 결의했다.'}],has_body:false,fetched_at:'2026-11-02T07:00:00Z'},
      {id:POST_EN_BAD,workspace_id:WS,source_key:'socialistworker',kind:'article',lang:'en',title:'Off-catalog link',title_ko:null,author:null,url:'https://evil.example/steal',summary_ko:'요약',key_sentences:[],has_body:false,fetched_at:'2026-11-02T07:00:00Z'},
      {id:POST_OTHER,workspace_id:OTHER_WS,source_key:'kptu',kind:'statement',lang:'ko',title:'남의 글 민영화',url:'https://www.kptu.net/x/9',key_sentences:[],has_body:false,fetched_at:'2026-11-02T08:00:00Z'},
      {id:id(6),workspace_id:WS,source_key:'kctu',kind:'statement',lang:'ko',title:'민영화 반대 공동행동',title_ko:null,url:'https://nodong.org/x/6',key_sentences:[],has_body:false,fetched_at:'2026-10-30T00:00:00Z'},
    ],
    app_outside_sentences:[
      {post_id:POST_KO,workspace_id:WS,idx:0,text:'공공기관 민영화 저지 투쟁을 선포한다.'},
      {post_id:POST_KO,workspace_id:WS,idx:1,text:'정부는 철도와 가스의 분할을 멈춰야 한다.'},
      {post_id:POST_KO,workspace_id:WS,idx:2,text:'우리는 11월 총파업으로 답한다.'},
    ],
    app_news_items:[
      {id:NEWS_1,workspace_id:WS,lane:'keyword',url:'https://news.example/a',title:'철도 민영화 논란 재점화',title_ko:null,lang:'ko',publisher:'가상일보',source_key:null,summary:'철도 분할 논의.',body:'철도 분할 논의가 다시 시작됐다.',body_ko:null,hidden_at:null,created_at:'2026-11-01T00:00:00Z'},
    ],
    app_feed_bodies:structuredClone(feed),
    app_now_details:structuredClone(details),
    app_now_interests:structuredClone(interests),
    app_now_signals:structuredClone(signals),
    app_spaces:[{id:id(40),workspace_id:WS,owner_id:OWNER,name:'공공성 사업',sort_order:1}],
    app_suborganizations:[{id:id(41),workspace_id:WS,name:'가 지부',active:true},{id:id(42),workspace_id:OTHER_WS,name:'남의 지부',active:true}],
    app_ai_daily_usage:structuredClone(usage),
  };
  const mineOnly=r=>r.workspace_id===WS;
  db.app_outside_articles=db.app_outside_posts.filter(mineOnly).map(({workspace_id,...p})=>({...p}));
  db.app_outside_article_sentences=db.app_outside_sentences.map(({post_id,workspace_id,...x})=>({article_id:post_id,...x}));
  db.app_news_articles=db.app_news_items.map(({workspace_id,hidden_at,...n})=>({...n,url_key:n.url.replace(/^https:\/\//,'')}));
  db.app_news_items.forEach(n=>{n.url_key=n.url.replace(/^https:\/\//,'');});
  db.app_news_marks=db.app_news_items.filter(n=>n.hidden_at).map(n=>({workspace_id:n.workspace_id,article_id:n.id,hidden_at:n.hidden_at}));
  db.app_outside_article_bodies=feed.filter(f=>f.workspace_id===WS&&f.outside_post_id).map(f=>({article_id:f.outside_post_id,state:f.state,blocks:f.blocks,...(f.extracted_at?{extracted_at:f.extracted_at}:{})}));
  db.app_news_article_bodies=feed.filter(f=>f.workspace_id===WS&&f.news_item_id).map(f=>({article_id:f.news_item_id,state:f.state,blocks:f.blocks}));
  db.app_outside_now_details=details.filter(d=>d.outside_post_id).map(d=>toShared(d,'outside_post_id'));
  db.app_news_now_details=details.filter(d=>d.news_item_id).map(d=>toShared(d,'news_item_id'));
  db.app_outside_now_signals=signals.filter(x=>x.outside_post_id).map(x=>toShared(x,'outside_post_id'));
  db.app_news_now_signals=signals.filter(x=>x.news_item_id).map(x=>toShared(x,'news_item_id'));
  db.app_news_id_map=map.filter(m=>m.kind==='news');db.app_outside_id_map=map.filter(m=>m.kind==='outside');
  const SHARED_READ=new Set(['app_outside_articles','app_outside_article_sentences','app_outside_article_bodies','app_news_articles','app_news_article_bodies']);
  const users={'owner-token':OWNER,'stranger-token':STRANGER};
  const wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const cmp=(cell,op,val)=>{
    if(op==='eq')return String(cell)===val;
    if(op==='gte')return cell!=null&&String(cell)>=val; if(op==='gt')return cell!=null&&String(cell)>val; if(op==='lt')return cell!=null&&String(cell)<val;
    if(op==='in')return val.slice(1,-1).split(',').includes(String(cell));
    if(op==='is')return val==='null'?cell==null:val==='true'?cell===true:cell===false;
    if(op==='ilike'){const w=val.replace(/^\*|\*$/g,'');return typeof cell==='string'&&cell.toLowerCase().includes(w.toLowerCase());}
    throw new Error('op '+op);
  };
  const cond=(row,c)=>{const [k,op,...rest]=c.split('.');return cmp(row[k],op,rest.join('.'))};
  const matches=(row,url)=>{
    for(const [k,v] of url.searchParams){
      if(['select','limit','order','on_conflict'].includes(k))continue;
      if(k==='or'){if(!v.slice(1,-1).split(',').some(c=>cond(row,c)))return false;continue}
      const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;
    }
    return true;
  };
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){
      const body=JSON.parse(init.body);calls.openai.push(body);
      return respond(openai?openai(body,calls.openai.length):answer(defaultAnswer(body)));
    }
    if(url.origin!==SB){calls.site.push(url.href);assert.ok(site,'unexpected outbound host '+url.href);return site(url);}
    const table=url.pathname.replace('/rest/v1/','');
    if(headers.get('apikey')===SERVICE){
      // 서버 열쇠: Now 세 표만, 정해진 방법만.
      calls.service.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):undefined});
      assert.ok({app_now_details:['POST','PATCH'],app_now_interests:['POST','PATCH'],app_now_signals:['DELETE'],
        app_news_now_details:['POST','PATCH'],app_outside_now_details:['POST','PATCH'],app_news_now_signals:['DELETE'],app_outside_now_signals:['DELETE']}[table]?.includes(method),'service key misuse '+method+' '+table);
      const rows=db[table];
      if(method==='POST'){
        const list=[].concat(JSON.parse(init.body)),out=[];
        for(const b of list){
          assert.equal(b.workspace_id,WS,'service writes stay in the caller workspace');
          if(table===NEW_DETAIL.outside||table===NEW_DETAIL.news){
            assert.equal(url.searchParams.get('on_conflict'),'workspace_id,article_id');
            const i=rows.findIndex(r=>r.workspace_id===b.workspace_id&&r.article_id===b.article_id);
            const row=i>=0?Object.assign(rows[i],b):(rows.push({...b}),rows.at(-1));out.push(row);
          }else if(table==='app_now_details'){
            const col=b.outside_post_id?'outside_post_id':'news_item_id';
            const i=rows.findIndex(r=>r[col]===b[col]);
            const row=i>=0?Object.assign(rows[i],b):(rows.push({id:id(900+rows.length),...b}),rows.at(-1));out.push(row);
          }else{
            if(rows.some(r=>r.workspace_id===b.workspace_id&&r.topic===b.topic))continue;
            const row={id:id(950+rows.length),...b};rows.push(row);out.push({id:row.id});
          }
        }
        return respond(out,201);
      }
      const hit=rows.filter(r=>matches(r,url));
      if(method==='PATCH'){for(const r of hit)Object.assign(r,JSON.parse(init.body));return respond(hit);}
      db[table]=rows.filter(r=>!hit.includes(r));return new Response(null,{status:204});
    }
    assert.equal(headers.get('apikey'),ANON);
    const bearer=(headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user')return users[bearer]?respond({id:users[bearer]}):respond({msg:'bad'},401);
    const uid=users[bearer];assert.ok(uid,'REST only with the caller token');
    calls.rest.push({table,method,query:decodeURIComponent(url.search)});
    const mine=db.app_workspace_members.filter(m=>m.user_id===uid&&m.role==='owner'),reader=mine.length===1&&!blocked;
    if(table==='rpc/app_news_article_of'||table==='rpc/app_outside_article_of'){
      const b=JSON.parse(init.body),m=table.includes('news')?db.app_news_id_map:db.app_outside_id_map;
      return respond(reader?m.filter(x=>b.p_old.includes(x.old_id)&&x.workspace_id===mine[0].workspace_id).map(x=>({old_id:x.old_id,article_id:x.article_id})):[]);
    }
    if(url.pathname.startsWith('/rest/v1/rpc/'))return respond(table.endsWith('app_search_records')?{groups:[{items:[{kind:'update',id:id(70),title:'민영화 대응 회의 기록'},{kind:'note',id:id(71),title:'개인 메모'}]}]}:[{id:id(72),title:'민영화 반대 결의',sensitivity:'S1',validity:'current'},{id:id(73),title:'교섭 전략',sensitivity:'S2',validity:'current'}]);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET'){
      // 공용 표: 가입자(owner 줄 1개·차단 아님) 누구나. 나머지는 owner RLS(자기 작업공간 줄만).
      const visible=r=>SHARED_READ.has(table)?reader:table==='app_workspace_members'?r.user_id===uid:table==='app_spaces'?r.owner_id===uid:wsOwner[r.workspace_id]===uid;
      return respond(rows.filter(r=>visible(r)&&matches(r,url)).slice(0,Number(url.searchParams.get('limit')||1e9)));
    }
    if(method==='POST'&&table==='app_ai_daily_usage'){
      const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);
      return new Response(null,{status:201});
    }
    throw new Error('user token write '+method+' '+table);
  };
  const handler=createAiAssistHandler(withAiMonth({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:ANON,SUPABASE_SERVICE_ROLE_KEY:SERVICE,WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key',...env})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})}));
  return {handler,calls,db};
}
function defaultAnswer(body){
  const name=body.text.format.name,m=JSON.parse(body.input[1].content);
  const refs=(m.candidates??[]).map(c=>c.ref);
  const core={summary:'공공기관 민영화 저지 투쟁을 선포한 성명이다. 11월 총파업을 예고했다.',
    key_sentences:[{orig:'정부는 철도와 가스의 분할을 멈춰야 한다.',ko:''},{orig:'지어낸 문장은 저장되지 않는다.',ko:''}]};
  const ctx={relevance:{topics:['민영화','공공성 사업','없는 주제'],reason:'민영화 관심 주제와 바로 닿는다.'},implications:{kptu:'A노조 공동투쟁에 힘이 된다.',labor:''},related:[...refs,'r99']};
  if(name==='now_detail')return {...core,...ctx};
  if(name==='now_basic')return core;
  if(name==='now_context')return ctx;
  if(name==='now_interests')return {candidates:[{topic:'철도 분할',reason:'별표 3건·메모 1건'},{topic:'민영화',reason:'이미 있음'},{topic:'뺀 주제',reason:'다시 만들면 안 됨'}]};
  throw new Error(name);
}
// S69-01: 처음 만들 때 AI 요청 둘(now_basic 요약·주요 문장 + now_context 연관·시사점)을 함께 보낸다. 글 재료는 둘 다 같다.
const sentOf=(calls,name)=>calls.openai.find(o=>o.text.format.name===name);
const materialOf=o=>{const m=JSON.parse(o.input[1].content);return (m.item??m).material;};
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const confirmed=[{id:id(80),workspace_id:WS,topic:'민영화',state:'confirmed',origin:'user',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z'}];

test('requests: only one item id, exact keys; others 400 before any read',async()=>{
  const {handler,calls}=harness();
  for(const b of [{kind:'now_detail'},{kind:'now_detail',outside_post_id:'x'},{kind:'now_detail',outside_post_id:POST_KO,news_item_id:NEWS_1},
    {kind:'now_detail',outside_post_id:POST_KO,url:'https://evil.example'},{kind:'now_detail',outside_post_id:POST_KO,workspace_id:OTHER_WS},{kind:'now_interests',force:true}]){
    const r=await post(handler,b);assert.equal(r.status,400,JSON.stringify(b));
  }
  assert.ok(calls.rest.every(c=>c.table==='app_workspace_members'));
  assert.equal(calls.openai.length,0);assert.equal(calls.service.length,0);
});

test('another workspace\'s post is 404 with no AI call and no write',async()=>{
  const {handler,calls}=harness();
  const r=await post(handler,{kind:'now_detail',outside_post_id:POST_OTHER});
  assert.equal(r.status,404);assert.equal((await r.json()).error,'not_found');
  assert.equal(calls.openai.length,0);assert.equal(calls.service.length,0);
});

test('first open makes and stores the full detail once; second open returns the stored copy without AI',async()=>{
  const {handler,calls,db}=harness({interests:confirmed});
  const r=await post(handler,{kind:'now_detail',outside_post_id:POST_KO});
  assert.equal(r.status,200);
  const b=await r.json();
  assert.equal(b.ok,true);assert.equal(b.detail.level,'full');
  // 글에 없는 문장(지어낸 인용)은 빠지고, 한국어 글이라 번역 칸은 null.
  assert.deepEqual(b.detail.key_sentences,[{orig:'정부는 철도와 가스의 분할을 멈춰야 한다.',ko:null}]);
  // 연관 주제는 확정 관심사·내 업무 이름 안에서만.
  assert.deepEqual(b.detail.relevance,{topics:['민영화','공공성 사업'],reason:'민영화 관심 주제와 바로 닿는다.'});
  assert.deepEqual(b.detail.implications,{kptu:'A노조 공동투쟁에 힘이 된다.'});
  // 함께 볼 것은 서버 후보 안에서만: 다른 사회운동 글·뉴스·업데이트·원장(S0·S1). 개인 메모·S2·남의 글·지어낸 ref 없음.
  const kinds=b.detail.related.map(x=>`${x.kind}:${x.id}`);
  assert.deepEqual(kinds.sort(),[`ledger:${id(72)}`,`news:${NEWS_1}`,`outside:${id(6)}`,`update:${id(70)}`].sort());
  assert.ok(!JSON.stringify(b).includes(POST_OTHER));
  // AI 재료: 저장 본문 문장·이름·제목만. 요청 둘(요약·주요 문장 / 연관·시사점)을 함께, 같은 글 재료로.
  assert.deepEqual(calls.openai.map(o=>o.text.format.name).sort(),['now_basic','now_context']);
  for(const o of calls.openai){assert.equal(o.store,false);assert.equal(materialOf(o),BODY_KO);assert.ok(!o.input[1].content.includes('남의'),'no other workspace names');}
  const m=JSON.parse(sentOf(calls,'now_context').input[1].content);
  assert.deepEqual(m.interests,['민영화']);assert.deepEqual(m.work.sort(),['가 지부','공공성 사업']);
  assert.equal(JSON.parse(sentOf(calls,'now_basic').input[1].content).interests,undefined,'요약 요청에는 관심 주제·업무 이름 없음');
  // 하루 한도·사용량은 한 번으로 센다(요청 둘이어도 1회), 토큰은 둘 다 더한다.
  assert.deepEqual([db.app_ai_daily_usage[0].requests,db.app_ai_daily_usage[0].input_tokens,db.app_ai_daily_usage[0].output_tokens],[1,6000,800]);
  // 저장은 서버 열쇠로 상세 표 한 번, DB 검사 모양 그대로.
  const save=calls.service.filter(s=>s.table==='app_now_details');assert.equal(save.length,1);
  // E3: 사람별 새 표(공용 글 id)에 한 줄 + 옮기는 동안 같은 작업공간 옛 줄에도 같은 줄.
  const fresh=calls.service.filter(s=>s.table==='app_outside_now_details');assert.equal(fresh.length,1);
  assert.deepEqual([db.app_outside_now_details[0].workspace_id,db.app_outside_now_details[0].article_id,db.app_outside_now_details[0].level],[WS,POST_KO,'full']);
  const row=db.app_now_details[0];
  assert.equal(row.outside_post_id,POST_KO);assert.equal(row.workspace_id,WS);assert.equal(row.level,'full');assert.match(row.interests_key,/^[a-z0-9]{1,64}$/);
  assert.equal(calls.site.length,0,'domestic posts never fetch the site');
  // 다시 열기: AI·저장 없음.
  const again=await (await post(handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.deepEqual(again.detail,b.detail);assert.equal(calls.openai.length,2);assert.equal(save.length,calls.service.filter(s=>s.table==='app_now_details').length);
  // 로그에는 단계·건수만.
  assert.ok(!JSON.stringify(calls.logs).includes('민영화'));
});

test('S69-01: interests changed → the stored detail is returned as is (no AI, no write)',async()=>{
  const {handler,calls,db}=harness({interests:confirmed});
  const first=await (await post(handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  const ai=calls.openai.length,writes=calls.service.length;
  db.app_now_interests.push({id:id(81),workspace_id:WS,topic:'철도',state:'confirmed',origin:'user'});
  const b=await (await post(handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.equal(calls.openai.length,ai,'관심 주제가 바뀌어도 AI 다시 안 부름');assert.equal(calls.service.length,writes,'쓰기 없음');
  assert.deepEqual(b.detail,first.detail);
});

test('40 a day: the 41st new detail is basic (summary·sentences only, no relevance)',async()=>{
  const today='2026-11-02T01:00:00.000Z';
  const details=Array.from({length:40},(_,i)=>({id:id(500+i),workspace_id:WS,news_item_id:id(600+i),level:'full',generated_at:today}));
  const {handler,calls}=harness({details});
  const b=await (await post(handler,{kind:'now_detail',news_item_id:NEWS_1})).json();
  assert.equal(calls.openai[0].text.format.name,'now_basic');
  assert.equal(b.detail.level,'basic');assert.equal(b.detail.relevance,null);assert.equal(b.detail.implications,null);assert.deepEqual(b.detail.related,[]);
});

test('monthly AI limit → stored summary only, saved as basic, refilled on a later day',async()=>{
  const day='2026-11-01';
  const {handler,calls,db}=harness({usage:[{workspace_id:WS,user_id:OWNER,day,requests:1,input_tokens:500000000,output_tokens:500000000}]});
  const b=await (await post(handler,{kind:'now_detail',outside_post_id:POST_EN})).json();
  assert.equal(calls.openai.length,0);
  assert.equal(b.detail.level,'basic');assert.equal(b.detail.summary,'영국 공공부문 파업이 번지고 있다.');
  assert.deepEqual(b.detail.key_sentences,[{orig:'Workers voted to strike.',ko:'노동자들이 파업을 결의했다.'}]);
  assert.equal(db.app_now_details.length,1);
  // 같은 날 다시 열면 그대로(AI 다시 안 부름).
  await post(handler,{kind:'now_detail',outside_post_id:POST_EN});assert.equal(calls.openai.length,0);
});

test('foreign post: reads robots.txt and the page on the catalog host only, uses it as material, never stores it',async()=>{
  const page='<html><body><article><h1>Strike wave grows</h1><p>Workers voted to strike across the public sector.</p><p>Unions call for more action.</p></article></body></html>';
  const site=u=>u.pathname==='/robots.txt'?new Response('User-agent: *\nAllow: /',{status:200}):new Response(page,{status:200,headers:{'Content-Type':'text/html'}});
  const {handler,calls,db}=harness({site,openai:(body)=>answer({summary:'영국에서 파업이 번진다.',key_sentences:[{orig:'Unions call for more action.',ko:'노조들은 더 많은 행동을 요구한다.'}],relevance:{topics:[],reason:''},implications:{kptu:'',labor:''},related:[]})});
  const b=await (await post(handler,{kind:'now_detail',outside_post_id:POST_EN})).json();
  assert.deepEqual(calls.site.map(u=>new URL(u).hostname),['www.socialistworker.co.uk','www.socialistworker.co.uk']);
  assert.ok(calls.openai.every(o=>materialOf(o).includes('Unions call for more action.')));
  assert.deepEqual(b.detail.key_sentences,[{orig:'Unions call for more action.',ko:'노조들은 더 많은 행동을 요구한다.'}]);
  assert.equal(b.detail.relevance,null);assert.equal(b.detail.implications,null);
  assert.ok(!JSON.stringify(db.app_now_details).includes('across the public sector'),'page text is material only');
});

test('foreign post with an off-catalog url or robots disallow: no page read',async()=>{
  const site=u=>u.pathname==='/robots.txt'?new Response('User-agent: *\nDisallow: /',{status:200}):new Response('<p>secret</p>',{status:200});
  const a=harness({site});
  await post(a.handler,{kind:'now_detail',outside_post_id:POST_EN_BAD});
  assert.equal(a.calls.site.length,0,'evil.example is never requested');
  const b=harness({site});
  await post(b.handler,{kind:'now_detail',outside_post_id:POST_EN});
  assert.deepEqual(b.calls.site.map(u=>new URL(u).pathname),['/robots.txt']);
});

test('now_interests: not due → no AI; 10 new signals → candidates (origin ai) skipping existing·dropped, old signals pruned',async()=>{
  const few=[{workspace_id:WS,outside_post_id:POST_KO,news_item_id:null,action:'star',created_at:'2026-11-02T01:00:00Z'}];
  const lastAi={id:id(82),workspace_id:WS,topic:'오늘 후보',state:'candidate',origin:'ai',created_at:'2026-11-02T01:30:00Z',updated_at:'2026-11-02T01:30:00Z'};
  const quiet=harness({signals:few,interests:[...confirmed,lastAi]});
  const q=await (await post(quiet.handler,{kind:'now_interests'})).json();
  assert.deepEqual(q,{ok:true,kind:'now_interests',ran:false,added:0});assert.equal(quiet.calls.openai.length,0);

  const many=Array.from({length:10},(_,i)=>({workspace_id:WS,outside_post_id:i%2?POST_KO:null,news_item_id:i%2?null:NEWS_1,action:i===0?'memo':'star',created_at:`2026-11-02T0${i%9}:59:00Z`}));
  const dropped={id:id(83),workspace_id:WS,topic:'뺀 주제',state:'dropped',origin:'ai',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z'};
  const old={workspace_id:WS,outside_post_id:POST_KO,news_item_id:null,action:'open',created_at:'2026-04-01T00:00:00Z'};
  const {handler,calls,db}=harness({signals:[...many,old],interests:[...confirmed,dropped]});
  const b=await (await post(handler,{kind:'now_interests'})).json();
  assert.equal(b.ran,true);assert.equal(b.added,1);
  const m=JSON.parse(calls.openai[0].input[1].content);
  assert.deepEqual(m.signals.map(s=>s.title).sort(),['[성명] 공공기관 민영화 저지 투쟁 선포','철도 민영화 논란 재점화']);
  assert.ok(m.existing.includes('뺀 주제'));
  const added=db.app_now_interests.filter(r=>r.origin==='ai'&&r.state==='candidate');
  assert.deepEqual(added.map(r=>[r.topic,r.reason]),[['철도 분할','별표 3건·메모 1건']]);
  assert.ok(calls.service.some(s=>s.table==='app_now_signals'&&s.method==='DELETE'&&s.query.includes(`workspace_id=eq.${WS}`)));
  assert.ok(!db.app_now_signals.includes(old),'180-day old signal pruned');
  for(const t of ['app_outside_now_signals','app_news_now_signals'])assert.ok(calls.service.some(s=>s.table===t&&s.method==='DELETE'&&s.query.includes(`workspace_id=eq.${WS}`)),t);
  assert.equal(db.app_outside_now_signals.filter(x=>x.created_at<'2026-05-01').length,0,'new table pruned too');
  assert.ok(calls.rest.some(c=>c.table==='app_outside_now_signals')&&calls.rest.some(c=>c.table==='app_news_now_signals'),'reactions read from the per-person new tables');
});

test('evening rule and candidate cleaning',()=>{
  const evening=Date.parse('2026-11-02T10:00:00Z'),noon=Date.parse('2026-11-02T03:00:00Z');
  assert.equal(N.interestsDue(1,null,evening),true);
  assert.equal(N.interestsDue(1,null,noon),false);
  assert.equal(N.interestsDue(1,'2026-11-02T09:30:00Z',evening),false,'already ran this evening');
  assert.equal(N.interestsDue(0,null,evening),false);
  assert.equal(N.interestsDue(10,'2026-11-02T09:30:00Z',noon),true);
  assert.deepEqual(N.cleanCandidates({candidates:[{topic:'가'.repeat(31),reason:'x'},{topic:'민 영화',reason:''},{topic:'돌봄',reason:'한 줄\n두 줄'}]},['민영화']),[{topic:'돌봄',reason:'한 줄 두 줄'}]);
});

test('source: the service key is read only in now-detail.ts svc() for three tables; handler/index never read it',()=>{
  const nd=readFileSync('supabase/functions/ai-assist/now-detail.ts','utf8');
  assert.equal((nd.match(/SUPABASE_SERVICE_ROLE_KEY/g)||[]).length,1);
  assert.match(nd,/const SERVICE_TABLES = Object\.freeze\(\{\n  app_now_details: \["POST", "PATCH"\],\n  app_now_interests: \["POST", "PATCH"\],\n  app_now_signals: \["DELETE"\],/);
  for(const f of ['handler.ts','index.ts'])assert.doesNotMatch(readFileSync(`supabase/functions/ai-assist/${f}`,'utf8'),/SERVICE_ROLE/);
  // AI 요청 몸통·재료·지시는 공용 모듈(P3b): 저장 안 함·도구 없음, 서버 열쇠·환경 변수를 읽지 않고 쓰기도 하지 않는다.
  const build=readFileSync('supabase/functions/_shared/now-detail-build.ts','utf8');
  assert.match(build,/model, store: false, max_output_tokens/);assert.doesNotMatch(build,/tools\s*:/);assert.doesNotMatch(nd,/tools\s*:/);
  assert.doesNotMatch(build,/SERVICE_ROLE|Deno\.env|method:\s*["'](POST|PATCH|DELETE|PUT)/);
  assert.match(nd,/kit\.ai\(config\.key, aiRequestBody\(/);
  assert.equal(N.NOW_DETAIL_DAILY,40);
  for(const t of [N.NOW_BASIC_INSTRUCTIONS,N.NOW_CONTEXT_INSTRUCTIONS])assert.ok(t.includes("말투: 요약·정리 문장은"),'shared tone rule');
});

// S48-66: AI가 재료 없이 쓴 '내용 없음' 문장은 요약이 아니다(저장·표시 안 함).
test('내용 없음 문장은 요약으로 받지 않는다',()=>{
  assert.equal(N.isNoContentSummary('자료에 글의 제목과 본문이 제공되지 않아 요약할 내용이 없음.'),true);
  assert.equal(N.isNoContentSummary('정부가 철도 분할을 추진하자 노조가 총파업을 예고했다.'),false);
  assert.equal(N.cleanCore({summary:'요약할 내용이 없음',key_sentences:[]},'본문',false),null);
});

// P3b: 수집 때 저장한 본문 블록(app_feed_bodies)이 있으면 그 글자를 재료로 먼저 쓴다(문장 표·원문 쪽을 다시 읽지 않음).
const FEED_KO=[{t:'h',text:'공공기관 민영화 저지'},{t:'p',text:'공공기관 민영화 저지 투쟁을 선포한다.'},{t:'img',src:'https://www.kptu.net/i/1.jpg',cap:'집회 사진'},{t:'quote',text:'정부는 철도와 가스의 분할을 멈춰야 한다.'}];
test('stored body blocks are the material first: domestic post skips the sentence table',async()=>{
  const {handler,calls}=harness({feed:[{id:id(300),workspace_id:WS,outside_post_id:POST_KO,news_item_id:null,state:'ok',blocks:FEED_KO}]});
  const b=await (await post(handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.equal(b.detail.level,'full');
  const mat=materialOf(sentOf(calls,'now_basic'));
  assert.equal(mat,'공공기관 민영화 저지\n공공기관 민영화 저지 투쟁을 선포한다.\n정부는 철도와 가스의 분할을 멈춰야 한다.');
  assert.ok(!mat.includes('집회 사진')&&!mat.includes('https://'),'photos and captions are not material');
  assert.deepEqual(b.detail.key_sentences,[{orig:'정부는 철도와 가스의 분할을 멈춰야 한다.',ko:null}]);
  assert.ok(!calls.rest.some(c=>c.table==='app_outside_article_sentences'),'no sentence-table read');
  const fb=calls.rest.find(c=>c.table==='app_outside_article_bodies');
  assert.ok(fb.query.includes(`article_id=eq.${POST_KO}`),'공용 본문 블록(글마다 한 줄)');
});

test('stored body blocks for a foreign post: no robots·page read',async()=>{
  const feed=[{id:id(301),workspace_id:WS,outside_post_id:POST_EN,news_item_id:null,state:'lead',blocks:[{t:'p',text:'Unions call for more action.'}]}];
  const {handler,calls}=harness({feed,openai:()=>answer({summary:'영국에서 파업이 번진다.',key_sentences:[{orig:'Unions call for more action.',ko:'노조들은 더 많은 행동을 요구한다.'}],relevance:{topics:[],reason:''},implications:{kptu:'',labor:''},related:[]})});
  const b=await (await post(handler,{kind:'now_detail',outside_post_id:POST_EN})).json();
  assert.equal(calls.site.length,0,'site never requested');
  assert.equal(materialOf(calls.openai[0]),'Unions call for more action.');
  assert.deepEqual(b.detail.key_sentences,[{orig:'Unions call for more action.',ko:'노조들은 더 많은 행동을 요구한다.'}]);
});

test('failed·image-only body rows and another workspace\'s row fall back to the old material',async()=>{
  const feed=[{id:id(302),workspace_id:WS,outside_post_id:null,news_item_id:NEWS_1,state:'failed',reason:'relay',blocks:[]},
    {id:id(303),workspace_id:OTHER_WS,outside_post_id:POST_KO,news_item_id:null,state:'ok',blocks:[{t:'p',text:'남의 본문'}]}];
  const {handler,calls}=harness({feed});
  await post(handler,{kind:'now_detail',news_item_id:NEWS_1});
  assert.equal(materialOf(calls.openai[0]),'철도 분할 논의가 다시 시작됐다.');
  await post(handler,{kind:'now_detail',outside_post_id:POST_KO});
  assert.equal(materialOf(calls.openai[2]),BODY_KO);
  assert.ok(!calls.openai.some(o=>o.input[1].content.includes('남의 본문')));
});

test('body table not there yet (read fails) → old material, still works',async()=>{
  const {handler,calls,db}=harness();
  delete db.app_outside_article_bodies;
  const b=await (await post(handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.equal(b.detail.level,'full');
  assert.equal(materialOf(calls.openai[0]),BODY_KO);
  assert.ok(calls.logs.some(l=>l.code==='now_read_skipped'&&l.detail?.stage==='feed_body'));
});

// ---- NEWS-모두에게열기 E3: 공용 글 id(옛 id는 지도로)·사람별 새 표·거절 ---------------------------------------------------------

const ART_NEW=id(700);
test('E3 now_detail: 옛 줄이 없는 공용 글(공용 id)도 열리고 사람별 새 표에만 저장, 옛 id는 지도로 공용 id로', async()=>{
  const h=harness({interests:confirmed});
  h.db.app_outside_articles.push({id:ART_NEW,source_key:'kptu',kind:'statement',lang:'ko',title:'[성명] 돌봄 공공성 강화',title_ko:null,author:null,url:'https://www.kptu.net/x/700',summary_ko:'돌봄 공공성 요구.',key_sentences:[],has_body:false,fetched_at:'2026-11-02T08:00:00Z'});
  const r=await post(h.handler,{kind:'now_detail',outside_post_id:ART_NEW});
  assert.equal(r.status,200);
  assert.deepEqual(h.db.app_outside_now_details.map(d=>[d.workspace_id,d.article_id]),[[WS,ART_NEW]]);
  assert.equal(h.db.app_now_details.length,0,'옛 줄이 없으면 옛 표에 쓰지 않음');
  // 옛 id(OLD) → 지도 → 공용 글 POST_KO: 새 표는 공용 id로, 옛 표는 그 옛 id로.
  const OLD=id(701);
  const m=harness({interests:confirmed,map:[{kind:'outside',old_id:OLD,workspace_id:WS,article_id:POST_KO}]});
  assert.equal((await post(m.handler,{kind:'now_detail',outside_post_id:OLD})).status,200);
  assert.deepEqual(m.db.app_outside_now_details.map(d=>d.article_id),[POST_KO]);
  assert.deepEqual(m.db.app_now_details.map(d=>d.outside_post_id),[OLD]);
});

test('E3 now_detail 거절: 차단 명단·남의 작업공간 옛 id·없는 id는 404(AI·쓰기 0), 남의 자세히는 읽지도 덮지도 않음', async()=>{
  const blocked=harness({blocked:true});
  for(const b of [{kind:'now_detail',outside_post_id:POST_KO},{kind:'now_detail',news_item_id:NEWS_1}])assert.equal((await post(blocked.handler,b)).status,404);
  assert.equal(blocked.calls.openai.length+blocked.calls.service.length,0);
  const other=harness({map:[{kind:'outside',old_id:POST_OTHER,workspace_id:OTHER_WS,article_id:POST_KO}]});
  assert.equal((await post(other.handler,{kind:'now_detail',outside_post_id:POST_OTHER})).status,404,'남의 옛 id는 지도로 안 바뀜');
  assert.equal(other.calls.openai.length+other.calls.service.length,0);
  // 다른 작업공간 사람이 같은 공용 글 자세히를 이미 가짐 → 내 것은 따로 만든다(남의 줄을 돌려주거나 고치지 않음).
  const theirs={workspace_id:OTHER_WS,outside_post_id:POST_KO,level:'full',summary:'남의 요약',key_sentences:[],related:[],interests_key:'x',generated_at:'2026-11-02T01:00:00Z'};
  const h=harness({details:[theirs]});
  const b=await (await post(h.handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.notEqual(b.detail.summary,'남의 요약');assert.equal(h.calls.openai.length,2);
  assert.equal(h.db.app_outside_now_details.find(d=>d.workspace_id===OTHER_WS).summary,'남의 요약');
  assert.ok(h.calls.service.every(s=>s.method!=='POST'||[].concat(s.body).every(x=>x.workspace_id===WS)),'쓰기는 누른 사람 작업공간만');
});

// S68-43(사용자 11/23 캡처 — 본문 없이 제목만으로 만든 요약에 'material이 비어 있어'): 재료 없는 사회운동 글은 AI를 부르지 않고, 제목만으로 만든 옛 저장본도 보이지 않는다.
test('S68-43: 본문·요약·주요 문장이 없는 사회운동 글은 no_material(AI 없음), 제목만으로 만든 옛 저장본도 버린다',async()=>{
  const fresh=harness();
  const r=await post(fresh.handler,{kind:'now_detail',outside_post_id:id(6)});
  assert.equal(r.status,422);assert.equal((await r.json()).error,'no_material');
  assert.equal(fresh.calls.openai.length,0);
  const titleOnly={workspace_id:WS,outside_post_id:id(6),level:'full',summary:'제목상 공동행동을 다룬다. 핵심 요약은 제목만 보고 썼다.',key_sentences:[],related:[],interests_key:'none',generated_at:'2026-11-02T01:00:00Z'};
  const old=harness({details:[titleOnly]});
  const r2=await post(old.handler,{kind:'now_detail',outside_post_id:id(6)});
  assert.equal(r2.status,422,'저장본이 있어도 재료가 없으면 보이지 않는다');
  assert.equal(old.calls.openai.length,0);
});
test('S68-43: 저장 본문이 저장된 요약보다 새로우면(본문을 나중에 가져옴) 새 본문으로 다시 만든다',async()=>{
  const feed=[{id:id(300),workspace_id:WS,outside_post_id:POST_KO,news_item_id:null,state:'ok',blocks:FEED_KO,extracted_at:'2026-11-02T09:00:00Z'}];
  const before={workspace_id:WS,outside_post_id:POST_KO,level:'full',summary:'예전 요약.',key_sentences:[],related:[],relevance:null,implications:null,interests_key:'none',generated_at:'2026-11-02T01:00:00Z'};
  const h=harness({feed,details:[before]});
  const b=await (await post(h.handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.equal(h.calls.openai.length,2,'다시 만듦');
  assert.notEqual(b.detail.summary,'예전 요약.');
  // 본문보다 나중에 만든 저장본은 그대로(AI 없음).
  const after={...before,generated_at:'2026-11-02T10:00:00Z'};
  const k=harness({feed,details:[after]});
  const c=await (await post(k.handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.equal(k.calls.openai.length,0);assert.equal(c.detail.summary,'예전 요약.');
});

// S69-01(사용자 11/24 "요약 시사점을 매번 다시 만드는 거 같은데 이러지마"): 다시 만드는 기준은 본문 '내용'(지문)뿐 — 본문을 뽑은 시각이 아니다.
test('S69-01: 같은 본문을 다시 뽑아 시각만 새로워지면 저장본 그대로(AI 0), 본문 글자가 바뀌면 그때만 다시 만든다',async()=>{
  const feed=[{id:id(300),workspace_id:WS,outside_post_id:POST_KO,news_item_id:null,state:'ok',blocks:FEED_KO,extracted_at:'2026-11-02T09:00:00Z'}];
  const h=harness({feed,interests:confirmed});
  const first=await (await post(h.handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.equal(h.calls.openai.length,2);
  const saved=h.db.app_outside_now_details[0];
  assert.match(saved.body_key,/^[a-f0-9]{32}$/,'본문 지문을 함께 저장');
  assert.ok(h.calls.service.filter(s=>s.table==='app_now_details').every(s=>[].concat(s.body).every(x=>!('body_key' in x))),'옛 표에는 지문 칸을 쓰지 않음');
  // 수집·다시 뽑기가 같은 본문을 새 시각으로 다시 적음(공백만 다른 것도 같은 본문).
  Object.assign(h.db.app_outside_article_bodies[0],{extracted_at:'2026-11-02T11:00:00Z',blocks:FEED_KO.map(b=>b.text?{...b,text:` ${b.text}  `}:b)});
  for(let i=0;i<3;i++){
    const again=await (await post(h.handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
    assert.deepEqual(again.detail,first.detail);
  }
  assert.equal(h.calls.openai.length,2,'세 번 더 열어도 AI 다시 안 부름');
  // 본문 글자가 실제로 바뀜 → 한 번만 다시 만든다.
  h.db.app_outside_article_bodies[0].blocks=[{t:'p',text:'공공기관 민영화 저지 투쟁을 선포한다. 12월 2차 총파업을 예고한다.'}];
  await post(h.handler,{kind:'now_detail',outside_post_id:POST_KO});
  assert.equal(h.calls.openai.length,4,'바뀐 본문으로 다시 만듦');
  await post(h.handler,{kind:'now_detail',outside_post_id:POST_KO});
  assert.equal(h.calls.openai.length,4,'그다음은 다시 저장본');
});

test('S69-01: 지문 없는 옛 저장본은 그대로 쓰고 지금 본문 지문을 한 번 적는다 — 그 뒤 시각만 새로워져도 다시 안 만듦',async()=>{
  const feed=[{id:id(300),workspace_id:WS,outside_post_id:POST_KO,news_item_id:null,state:'ok',blocks:FEED_KO,extracted_at:'2026-11-02T00:30:00Z'}];
  const legacy={workspace_id:WS,outside_post_id:POST_KO,level:'full',summary:'예전 요약.',key_sentences:[],related:[],relevance:null,implications:null,interests_key:'none',generated_at:'2026-11-02T01:00:00Z'};
  const h=harness({feed,details:[legacy]});
  const a=await (await post(h.handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.equal(a.detail.summary,'예전 요약.');assert.equal(h.calls.openai.length,0);
  const p=h.calls.service.find(s=>s.method==='PATCH'&&s.table==='app_outside_now_details');
  assert.ok(p.query.includes(`workspace_id=eq.${WS}`)&&p.query.includes('body_key=is.null'));
  assert.deepEqual(Object.keys(p.body),['body_key']);
  assert.match(h.db.app_outside_now_details[0].body_key,/^[a-f0-9]{32}$/);
  h.db.app_outside_article_bodies[0].extracted_at='2026-11-02T09:30:00Z';
  const b=await (await post(h.handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.equal(b.detail.summary,'예전 요약.');assert.equal(h.calls.openai.length,0,'지문이 같으면 시각이 새로워도 그대로');
  assert.equal(h.calls.service.filter(s=>s.method==='PATCH').length,1,'지문은 한 번만 적음');
});

test('S69-01: 걸린 시간 로그는 숫자만(글 내용 없음), 저장본 열기는 단계 숫자 hit=1',async()=>{
  const {handler,calls}=harness({interests:confirmed});
  await post(handler,{kind:'now_detail',outside_post_id:POST_KO});
  await post(handler,{kind:'now_detail',outside_post_id:POST_KO});
  const t=calls.logs.filter(l=>l.code==='now_detail_timing').map(l=>l.detail);
  assert.equal(t.length,2);
  assert.deepEqual(Object.keys(t[0]).sort(),['ai','hit','load','prep','save','total']);assert.equal(t[0].hit,0);
  assert.deepEqual(Object.keys(t[1]).sort(),['hit','load','total']);assert.equal(t[1].hit,1);
  for(const d of t)for(const v of Object.values(d))assert.equal(typeof v,'number');
});

test('S69-01: 두 AI 요청 중 하나가 실패하면 저장하지 않고 오류(사용량은 한 번 기록), 다음 열기에서 다시 만든다',async()=>{
  let fail=true;
  const {handler,calls,db}=harness({openai:(body)=>fail&&body.text.format.name==='now_context'?{error:{message:'x'}}:answer(defaultAnswer(body))});
  // 연관·시사점 요청이 모양 없는 답 → ai_invalid_response(502).
  const r=await post(handler,{kind:'now_detail',outside_post_id:POST_KO});
  assert.ok(r.status>=500,'오류');
  assert.equal(db.app_outside_now_details.length,0,'저장 없음');
  assert.equal(db.app_ai_daily_usage[0].requests,1);
  fail=false;
  const ok=await post(handler,{kind:'now_detail',outside_post_id:POST_KO});
  assert.equal(ok.status,200);assert.equal(db.app_outside_now_details.length,1);
  assert.ok(calls.openai.length>=4);
});
