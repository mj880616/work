import test from 'node:test';
import assert from 'node:assert/strict';

// WEEKLY-환류학습: the real ai-assist handler, kind=weekly_draft / weekly_review, with a synthetic Supabase (Auth + PostgREST with owner RLS)
// and a mocked OpenAI. No network, no real key, synthetic text only (가상 글). weekly_draft reads only the feedback/rules of weeks BEFORE the
// asked week (the learning test must not see this week's answer) and stores nothing; weekly_review writes the review and rules into the
// week's own row with the draft_saved_at condition.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const wl=await import('../../supabase/functions/ai-assist/weekly-learn.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const NOW=Date.parse('2026-10-30T05:00:00Z'),WEEK='2026-10-26';
const fb=(week,extra={})=>({at:`${week}T09:00:00Z`,week,from:'confirm',counts:{kept:3,changed:1,dropped:1,added:1,proposed:5,final:5},
  changed:[{where:'요약 · 가 › 가-1',before:`${week} 바꾸기 전 줄`,after:`${week} 바꾼 뒤 줄`}],dropped:[{where:'산하조직 · A 지부',text:`${week} 뺀 줄`}],added:[{where:'요약 · 나 › 나-1',text:`${week} 더한 줄`}],...extra});

const answer=obj=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(obj)}]}],usage:{input_tokens:3000,output_tokens:400}});
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

function harness({openai=null,rows=null,patchMiss=0}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_weekly_exec_requests:rows??[
      {id:'r1',workspace_id:WS,week_start:WEEK,items:[],draft_saved_at:'2026-10-30T04:00:00.000Z',draft:{v:1,rows:[],titles:[],feedback:fb(WEEK,{changed:[{where:'요약',before:'THIS_WEEK_BEFORE',after:'THIS_WEEK_ANSWER'}]}),
        rules:{at:'2026-10-30T04:30:00Z',week:WEEK,lines:[{text:'THIS_WEEK_RULE',from:'auto'},{text:'사람이 고친 규칙',from:'edited'}]}}},
      {id:'r2',workspace_id:WS,week_start:'2026-10-19',items:[],draft_saved_at:'x',draft:{v:1,feedback:fb('2026-10-19'),rules:{at:'2026-10-23T09:00:00Z',lines:[{text:'날짜는 10.28.(화) 꼴',from:'auto'}]}}},
      {id:'r3',workspace_id:WS,week_start:'2026-10-12',items:[],draft_saved_at:'x',draft:{v:1,feedback:fb('2026-10-12')}},
      {id:'r4',workspace_id:OTHER_WS,week_start:'2026-10-19',items:[],draft_saved_at:'x',draft:{v:1,feedback:fb('2026-10-19',{added:[{where:'x',text:'FOREIGN_TEXT'}]}),rules:{at:'z',lines:['FOREIGN_RULE']}}},
    ],
    app_ai_daily_usage:[],
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER};
  const wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(cell,op,val)=>{
    if(op==='eq')return String(cell)===val;
    if(op==='gte')return cell!=null&&String(cell)>=val; if(op==='lt')return cell!=null&&String(cell)<val;
    if(op==='is')return val==='null'?cell==null:false;
    throw new Error('op '+op);
  };
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  // PostgREST select with json paths: "alias:draft->field".
  const pick=(row,select)=>{if(!select)return row;const out={};for(const part of select.split(',')){const m=/^(\w+):(\w+)->(\w+)$/.exec(part);if(m)out[m[1]]=row[m[2]]?.[m[3]]??null;else out[part]=row[part];}return out;};
  let misses=patchMiss;
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){
      calls.openai.push(JSON.parse(init.body));
      if(openai)return openai(calls.openai.at(-1));
      return respond(answer({cells:[{ref:'c1',lines:['- 가상 교섭 3차 결렬','- 가상 집회 준비']},{ref:'c2',lines:['- 가상 소식']}]}));
    }
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(headers.get('apikey'),'synthetic-anon-key','anon key only');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET'){
      let list=rows.filter(r=>visible(table,r,uid)&&matches(r,url));
      if(url.searchParams.get('order')==='week_start.desc')list=[...list].sort((a,b)=>a.week_start<b.week_start?1:-1);
      return respond(list.slice(0,Number(url.searchParams.get('limit')||1e9)).map(r=>pick(r,url.searchParams.get('select'))));
    }
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(method==='PATCH'&&table==='app_weekly_exec_requests'){
      const b=JSON.parse(init.body);
      assert.deepEqual(Object.keys(b).sort(),['draft','draft_saved_at'],'only the draft and its stamp');
      if(misses>0){misses--;const r=rows.find(x=>x.workspace_id===WS&&x.week_start===WEEK);r.draft_saved_at='2026-10-30T04:59:00.000Z';return respond([]);}
      const hit=rows.filter(r=>visible(table,r,uid)&&matches(r,url));
      for(const r of hit)Object.assign(r,b);
      return respond(hit.map(r=>({id:r.id})));
    }
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const cells=[{ref:'c1',where:'요약 · 가 › 가-1',lines:['- 가상 교섭 3차 진행'],material:['가상 교섭 3차 결렬(10/28)']},{ref:'c2',where:'산하조직 · A 지부',lines:['- 가상 소식'],material:[]}];
const draftBody=(over={})=>({kind:'weekly_draft',week_start:WEEK,mode:'test',cells,unmatched:['가상 짝 없는 기록'],...over});
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)}));
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);};

test('weekly_draft: learns only from weeks before the asked week (no answer leak), answer returned, nothing stored',async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,draftBody());
  assert.equal(res.status,200);
  const body=await res.json();
  assert.deepEqual(body,{ok:true,kind:'weekly_draft',week_start:WEEK,mode:'test',cells:[{ref:'c1',lines:['- 가상 교섭 3차 결렬','- 가상 집회 준비']},{ref:'c2',lines:['- 가상 소식']}],learned:{weeks:2,rules:1}});
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'weekly_draft');assert.equal(o.text.format.strict,true);
  const material=o.input[1].content,sent=JSON.parse(material);
  assert.deepEqual(sent.rules,['날짜는 10.28.(화) 꼴']);
  assert.deepEqual([...new Set(sent.past_edits.map(e=>e.week))],['2026-10-19','2026-10-12']);
  assert.deepEqual(sent.cells.map(c=>[c.ref,c.base,c.this_week]),[['c1',['- 가상 교섭 3차 진행'],['가상 교섭 3차 결렬(10/28)']],['c2',['- 가상 소식'],[]]]);
  for(const hidden of ['THIS_WEEK_ANSWER','THIS_WEEK_BEFORE','THIS_WEEK_RULE','FOREIGN_TEXT','FOREIGN_RULE',OWNER,WS])assert.ok(!material.includes(hidden),hidden+' must not be sent');
  const read=calls.rest.find(c=>c.table==='app_weekly_exec_requests');
  assert.match(read.query,/week_start=lt\.2026-10-26/);
  assert.match(read.query,/select=workspace_id,week_start,feedback:draft->feedback,rules:draft->rules/);
  assert.ok(calls.rest.every(c=>c.method==='GET'||c.table==='app_ai_daily_usage'),'no write but the usage count');
  assert.equal(db.app_ai_daily_usage[0].requests,1);
  assert.ok(!/가상|교섭|규칙/.test(JSON.stringify(calls.logs)),'no text in logs');
  assert.ok(calls.logs.some(l=>l.code==='weekly_draft_done'&&l.detail.weeks===2&&l.detail.mode==='test'));
  assert.equal(DAILY_LIMITS.weekly_draft,10);assert.equal(DAILY_LIMITS.weekly_review,5);
});

test('weekly_draft: untrusted answer lines are cleaned per line; broken answers fail; bad requests never reach AI',async()=>{
  {const {handler,calls}=harness({openai:()=>respond(answer({cells:[{ref:'c9',lines:['없는 칸']},{ref:'c1',lines:['<b>굵게</b>','연락 010-1234-5678','x'.repeat(301),'  ','정상 줄']},{ref:'c1',lines:['두 번째']},{ref:'c2',lines:['a'],extra:1}]}))});
   const body=await (await post(handler,draftBody())).json();
   assert.deepEqual(body.cells,[{ref:'c1',lines:['굵게','정상 줄']}]);
   assert.ok(calls.logs.some(l=>l.code==='weekly_draft_done'&&l.detail.dropped===6));}
  {const {handler}=harness({openai:()=>respond({status:'completed',output:[]})});await expectError(await post(handler,draftBody()),502,'ai_invalid_response');}
  const bad=[draftBody({week_start:'2026-10-27'}),draftBody({mode:'other'}),draftBody({cells:[]}),draftBody({extra:1}),draftBody({cells:[{...cells[0],ref:'c81'}]}),
    draftBody({cells:[cells[0],{...cells[1],ref:'c1'}]}),draftBody({cells:[{...cells[0],lines:['<b>x</b>']}]}),draftBody({cells:[{...cells[0],lines:Array(21).fill('줄')}]}),
    draftBody({cells:[{...cells[0],material:['x'.repeat(401)]}]}),draftBody({cells:[{...cells[0],note:'x'}]}),draftBody({unmatched:Array(41).fill('기록')}),draftBody({week_start:'2025-01-06'})];
  for(const b of bad){const {handler,calls}=harness();await expectError(await post(handler,b),400,'invalid_request');assert.equal(calls.openai.length,0);}
  // 다른 사람 토큰: 남의 작업공간 행은 읽히지 않는다(owner RLS) — 학습 재료 0주.
  {const {handler,calls}=harness();const res=await post(handler,draftBody(),'stranger-token');if(res.status===200){const sent=JSON.parse(calls.openai[0].input[1].content);assert.ok(!JSON.stringify(sent).includes('날짜는 10.28.(화) 꼴'));}}
});

test('weekly_review: reads the week\'s confirmed feedback, writes review + rules into that row (human-edited rules kept), retries on a moved stamp',async()=>{
  const review={rules:['끝난 일은 결과부터','날짜는 10.28.(화) 꼴','사람이 고친 규칙'],candidates:['끝난 일은 결과부터'],suggestions:['산하조직 칸은 그 주 업데이트가 없으면 지난 줄 유지','회의 결정 칸을 요약 끝에']};
  const {handler,calls,db}=harness({openai:()=>respond(answer(review)),patchMiss:1});
  const res=await post(handler,{kind:'weekly_review',week_start:WEEK});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.saved,true);
  assert.deepEqual(body.review.suggestions.map(s=>s.id),['s1','s2']);
  const sent=JSON.parse(calls.openai[0].input[1].content);
  assert.equal(sent.this_week.kept_percent,60);
  assert.deepEqual(sent.past_weeks.map(p=>p.week),['2026-10-19','2026-10-12']);
  assert.deepEqual(sent.current_rules,['THIS_WEEK_RULE','사람이 고친 규칙']);
  const row=db.app_weekly_exec_requests.find(r=>r.id==='r1');
  assert.deepEqual(row.draft.feedback.review.candidates,['끝난 일은 결과부터']);
  assert.equal(row.draft.feedback.counts.kept,3,'feedback numbers kept');
  assert.deepEqual(row.draft.rules.lines,[{text:'사람이 고친 규칙',from:'edited'},{text:'끝난 일은 결과부터',from:'auto'},{text:'날짜는 10.28.(화) 꼴',from:'auto'}]);
  assert.equal(row.draft.v,1);assert.deepEqual(row.draft.rows,[]);
  const patches=calls.rest.filter(c=>c.method==='PATCH');
  assert.equal(patches.length,2);
  assert.match(patches[0].query,/draft_saved_at=eq\.2026-10-30T04:00:00\.000Z/);
  assert.match(patches[1].query,/draft_saved_at=eq\.2026-10-30T04:59:00\.000Z/);
  assert.ok(!/가상|규칙|결과/.test(JSON.stringify(calls.logs)));
  // 고침 기록이 없는 주: AI를 부르지 않는다.
  {const {handler,calls}=harness({rows:[{id:'r1',workspace_id:WS,week_start:WEEK,items:[],draft_saved_at:null,draft:{v:1}}]});await expectError(await post(handler,{kind:'weekly_review',week_start:WEEK}),404,'not_found');assert.equal(calls.openai.length,0);}
  {const {handler}=harness();await expectError(await post(handler,{kind:'weekly_review',week_start:WEEK,extra:1}),400,'invalid_request');}
  // 남의 토큰: 그 주 행이 보이지 않아 not_found.
  {const {handler,calls}=harness();await expectError(await post(handler,{kind:'weekly_review',week_start:WEEK},'stranger-token'),404,'not_found');assert.equal(calls.openai.length,0);}
});

test('pure: learnFromRows keeps only earlier weeks; withReview keeps human rules first and caps at 20',()=>{
  const l=wl.learnFromRows([{week_start:WEEK,feedback:fb(WEEK)},{week_start:'2026-10-19',feedback:fb('2026-10-19'),rules:{at:'a',lines:['r']}},{week_start:'bad'}],WEEK);
  assert.equal(l.weeks,1);assert.deepEqual(l.rules,['r']);
  const d=wl.withReview({v:1,feedback:fb(WEEK)},{rules:Array.from({length:30},(_,i)=>`규칙 ${i}`),candidates:[],suggestions:['s']},{at:'a',lines:[{text:'내 규칙',from:'added'}]},WEEK,'t');
  assert.equal(d.rules.lines.length,20);assert.deepEqual(d.rules.lines[0],{text:'내 규칙',from:'added'});
  assert.deepEqual(d.feedback.review,{at:'t',candidates:[],suggestions:[{id:'s1',text:'s'}]});
});
