import test from 'node:test';
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

function harness({openai=null,usage=[],details=[],interests=[],signals=[],site=null,env={}}={}){
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
    app_now_details:structuredClone(details),
    app_now_interests:structuredClone(interests),
    app_now_signals:structuredClone(signals),
    app_spaces:[{id:id(40),workspace_id:WS,owner_id:OWNER,name:'공공성 사업',sort_order:1}],
    app_suborganizations:[{id:id(41),workspace_id:WS,name:'가 지부',active:true},{id:id(42),workspace_id:OTHER_WS,name:'남의 지부',active:true}],
    app_ai_daily_usage:structuredClone(usage),
  };
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
      assert.ok({app_now_details:['POST','PATCH'],app_now_interests:['POST','PATCH'],app_now_signals:['DELETE']}[table]?.includes(method),'service key misuse '+method+' '+table);
      const rows=db[table];
      if(method==='POST'){
        const list=[].concat(JSON.parse(init.body)),out=[];
        for(const b of list){
          assert.equal(b.workspace_id,WS,'service writes stay in the caller workspace');
          if(table==='app_now_details'){
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
    if(url.pathname.startsWith('/rest/v1/rpc/'))return respond(table.endsWith('app_search_records')?{groups:[{items:[{kind:'update',id:id(70),title:'민영화 대응 회의 기록'},{kind:'note',id:id(71),title:'개인 메모'}]}]}:[{id:id(72),title:'민영화 반대 결의',sensitivity:'S1',validity:'current'},{id:id(73),title:'교섭 전략',sensitivity:'S2',validity:'current'}]);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET'){
      const visible=r=>table==='app_workspace_members'?r.user_id===uid:table==='app_spaces'?r.owner_id===uid:wsOwner[r.workspace_id]===uid;
      return respond(rows.filter(r=>visible(r)&&matches(r,url)).slice(0,Number(url.searchParams.get('limit')||1e9)));
    }
    if(method==='POST'&&table==='app_ai_daily_usage'){
      const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);
      return new Response(null,{status:201});
    }
    throw new Error('user token write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:ANON,SUPABASE_SERVICE_ROLE_KEY:SERVICE,WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key',...env})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
function defaultAnswer(body){
  const name=body.text.format.name,m=JSON.parse(body.input[1].content);
  const refs=(m.candidates??[]).map(c=>c.ref);
  const core={summary:'공공기관 민영화 저지 투쟁을 선포한 성명이다. 11월 총파업을 예고했다.',
    key_sentences:[{orig:'정부는 철도와 가스의 분할을 멈춰야 한다.',ko:''},{orig:'지어낸 문장은 저장되지 않는다.',ko:''}]};
  const ctx={relevance:{topics:['민영화','공공성 사업','없는 주제'],reason:'민영화 관심 주제와 바로 닿는다.'},implications:{kptu:'공공운수노조 공동투쟁에 힘이 된다.',labor:''},related:[...refs,'r99']};
  if(name==='now_detail')return {...core,...ctx};
  if(name==='now_basic')return core;
  if(name==='now_context')return ctx;
  if(name==='now_interests')return {candidates:[{topic:'철도 분할',reason:'별표 3건·메모 1건'},{topic:'민영화',reason:'이미 있음'},{topic:'뺀 주제',reason:'다시 만들면 안 됨'}]};
  throw new Error(name);
}
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
  assert.deepEqual(b.detail.implications,{kptu:'공공운수노조 공동투쟁에 힘이 된다.'});
  // 함께 볼 것은 서버 후보 안에서만: 다른 사회운동 글·뉴스·업데이트·원장(S0·S1). 개인 메모·S2·남의 글·지어낸 ref 없음.
  const kinds=b.detail.related.map(x=>`${x.kind}:${x.id}`);
  assert.deepEqual(kinds.sort(),[`ledger:${id(72)}`,`news:${NEWS_1}`,`outside:${id(6)}`,`update:${id(70)}`].sort());
  assert.ok(!JSON.stringify(b).includes(POST_OTHER));
  // AI 재료: 저장 본문 문장·이름·제목만.
  assert.equal(calls.openai.length,1);
  const sent=calls.openai[0];assert.equal(sent.store,false);assert.equal(sent.text.format.name,'now_detail');
  const m=JSON.parse(sent.input[1].content);
  assert.equal(m.item.material,BODY_KO);assert.deepEqual(m.interests,['민영화']);assert.deepEqual(m.work.sort(),['가 지부','공공성 사업']);
  assert.ok(!sent.input[1].content.includes('남의'),'no other workspace names');
  // 저장은 서버 열쇠로 상세 표 한 번, DB 검사 모양 그대로.
  const save=calls.service.filter(s=>s.table==='app_now_details');assert.equal(save.length,1);
  const row=db.app_now_details[0];
  assert.equal(row.outside_post_id,POST_KO);assert.equal(row.workspace_id,WS);assert.equal(row.level,'full');assert.match(row.interests_key,/^[a-z0-9]{1,64}$/);
  assert.equal(calls.site.length,0,'domestic posts never fetch the site');
  // 다시 열기: AI·저장 없음.
  const again=await (await post(handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.deepEqual(again.detail,b.detail);assert.equal(calls.openai.length,1);assert.equal(save.length,calls.service.filter(s=>s.table==='app_now_details').length);
  // 로그에는 단계·건수만.
  assert.ok(!JSON.stringify(calls.logs).includes('민영화'));
});

test('interests changed → only relevance·implications·related are remade (context_at); unchanged summary',async()=>{
  const {handler,calls,db}=harness({interests:confirmed});
  await post(handler,{kind:'now_detail',outside_post_id:POST_KO});
  db.app_now_interests.push({id:id(81),workspace_id:WS,topic:'철도',state:'confirmed',origin:'user'});
  const b=await (await post(handler,{kind:'now_detail',outside_post_id:POST_KO})).json();
  assert.equal(calls.openai.length,2);assert.equal(calls.openai[1].text.format.name,'now_context');
  const p=calls.service.find(s=>s.method==='PATCH'&&s.table==='app_now_details');
  assert.ok(p.query.includes(`workspace_id=eq.${WS}`));
  assert.deepEqual(Object.keys(p.body).sort(),['context_at','implications','interests_key','related','relevance','updated_at']);
  assert.equal(b.detail.summary,db.app_now_details[0].summary);assert.ok(b.detail.context_at);
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
  assert.ok(JSON.parse(calls.openai[0].input[1].content).item.material.includes('Unions call for more action.'));
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
  assert.match(nd,/store: false/);assert.doesNotMatch(nd,/tools\s*:/);
  assert.equal(N.NOW_DETAIL_DAILY,40);
});
