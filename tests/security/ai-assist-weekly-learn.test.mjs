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
      {id:'r2',workspace_id:WS,week_start:'2026-10-19',items:[],draft_saved_at:'x',draft:{v:1,feedback:fb('2026-10-19'),rules:{v:2,at:'2026-10-23T09:00:00Z',lines:[{text:'날짜는 10.28.(화) 꼴',from:'added'}],candidates:[{text:'UNCONFIRMED_CANDIDATE'}],retired:[{text:'RETIRED_RULE'}]}}},
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
  for(const hidden of ['THIS_WEEK_ANSWER','THIS_WEEK_BEFORE','THIS_WEEK_RULE','FOREIGN_TEXT','FOREIGN_RULE','UNCONFIRMED_CANDIDATE','RETIRED_RULE',OWNER,WS])assert.ok(!material.includes(hidden),hidden+' must not be sent');
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

test('weekly_review: reads the week\'s confirmed feedback, adds only new candidates (confirmed rules untouched), retries on a moved stamp',async()=>{
  const review={candidates:['끝난 일은 결과부터','날짜는 10.28.(화) 꼴','RETIRED_RULE','THIS_WEEK_RULE'],
    suggestions:[{area:'material',text:'회의 결정 칸을 요약 끝에'},{area:'input',text:'산하조직 칸은 4주 중 3주 비움 — 처음부터 비워 두면'},{area:'bogus',text:'분류 틀림'}]};
  const {handler,calls,db}=harness({openai:()=>respond(answer(review)),patchMiss:1});
  const res=await post(handler,{kind:'weekly_review',week_start:WEEK});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.saved,true);
  // 입력창 분류가 앞에, 분류가 틀린 항목은 버린다.
  assert.deepEqual(body.review.suggestions,[{id:'s1',area:'input',text:'산하조직 칸은 4주 중 3주 비움 — 처음부터 비워 두면'},{id:'s2',area:'material',text:'회의 결정 칸을 요약 끝에'}]);
  const sent=JSON.parse(calls.openai[0].input[1].content);
  assert.equal(sent.this_week.kept_percent,60);
  assert.deepEqual(sent.past_weeks.map(p=>p.week),['2026-10-19','2026-10-12']);
  // 확정은 앞 주 v2 칸의 확정 줄만. 이 행의 옛 줄(자동 정리)은 후보로 읽혀 기다리는 후보에.
  assert.deepEqual(sent.current_rules,['날짜는 10.28.(화) 꼴']);
  assert.deepEqual(sent.pending_candidates,['UNCONFIRMED_CANDIDATE','THIS_WEEK_RULE','사람이 고친 규칙']);
  assert.deepEqual(sent.rejected_rules,['RETIRED_RULE']);
  assert.ok(Array.isArray(sent.input_patterns)&&sent.input_patterns.length>0,'input patterns sent');
  const o=calls.openai[0];
  assert.deepEqual(o.text.format.schema.properties.suggestions.items.properties.area.enum,['input','material','flow']);
  assert.match(o.input[0].content,/area=input\(입력창 모양·칸 구성\)/);
  assert.match(o.input[0].content,/빼면\/나누면\/합치면/);
  assert.match(o.input[0].content,/일상어로 쓴다/);assert.match(o.input[0].content,/확정 규칙\(current_rules\)은 사람이 정한 것이라 고치거나 다시 쓰지 않는다/);
  assert.deepEqual(o.text.format.schema.required,['candidates','suggestions']);assert.equal(o.text.format.schema.properties.rules,undefined);
  const row=()=>db.app_weekly_exec_requests.find(r=>r.id==='r1');
  assert.deepEqual(row().draft.feedback.review.candidates,['끝난 일은 결과부터']);assert.deepEqual(body.review.candidates,['끝난 일은 결과부터']);assert.equal(body.rules,undefined);
  assert.equal(row().draft.feedback.counts.kept,3,'feedback numbers kept');
  assert.equal(row().draft.feedback.review.suggestions[0].area,'input');
  // 확정·폐기는 그대로, 새 후보는 끝에(확정·폐기·기다리는 후보와 같은 줄은 버림).
  assert.deepEqual(row().draft.rules,{v:2,at:row().draft.feedback.review.at,week:WEEK,lines:[{text:'날짜는 10.28.(화) 꼴',from:'added'}],
    candidates:[{text:'UNCONFIRMED_CANDIDATE'},{text:'THIS_WEEK_RULE'},{text:'사람이 고친 규칙'},{text:'끝난 일은 결과부터'}],retired:[{text:'RETIRED_RULE'}]});
  assert.equal(row().draft.v,1);assert.deepEqual(row().draft.rows,[]);
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

test('pure: learnFromRows keeps only earlier weeks and confirmed rules; withReview keeps confirmed/retired and caps candidates at 20',()=>{
  // 옛 모양(v 없음)의 줄은 모두 후보: 확정 0줄.
  let l=wl.learnFromRows([{week_start:WEEK,feedback:fb(WEEK)},{week_start:'2026-10-19',feedback:fb('2026-10-19'),rules:{at:'a',lines:['r']}},{week_start:'bad'}],WEEK);
  assert.equal(l.weeks,1);assert.deepEqual(l.rules,[]);assert.deepEqual(l.book.candidates,['r']);
  l=wl.learnFromRows([{week_start:'2026-10-19',rules:{v:2,at:'a',lines:[{text:'확정',from:'added'},{text:'확정 ',from:'auto'}],candidates:['후보','확정'],retired:[{text:'폐기'},{text:'후보'}]}}],WEEK);
  assert.deepEqual(l.rules,['확정']);assert.deepEqual(l.book.retired,['폐기','후보']);assert.deepEqual(l.book.candidates,[]);
  assert.deepEqual(wl.readRulesCell({at:'a',lines:['옛 줄']}),[]);assert.equal(wl.readRulesCell(null),null);
  const base=wl.readRuleBook({v:2,at:'a',lines:[{text:'내 규칙',from:'added'}],candidates:Array.from({length:19},(_,i)=>({text:`후보 ${i}`})),retired:[{text:'뺀 규칙'}]});
  const d=wl.withReview({v:1,feedback:fb(WEEK)},{candidates:['새 후보 1','뺀 규칙','내 규칙','새 후보 2'],suggestions:[{area:'input',text:'s'}]},base,WEEK,'t');
  assert.deepEqual(d.rules.lines,[{text:'내 규칙',from:'added'}]);assert.deepEqual(d.rules.retired,[{text:'뺀 규칙'}]);
  assert.equal(d.rules.candidates.length,20);assert.deepEqual(d.rules.candidates.slice(-2),[{text:'새 후보 1'},{text:'새 후보 2'}]);assert.equal(d.rules.candidates[0].text,'후보 1');
  assert.deepEqual(d.feedback.review,{at:'t',candidates:['새 후보 1','뺀 규칙','내 규칙','새 후보 2'],suggestions:[{id:'s1',area:'input',text:'s'}]});
  // 바탕도 새 후보도 없으면 규칙 칸을 만들지 않는다.
  assert.equal(wl.withReview({v:1,feedback:fb(WEEK)},{candidates:[],suggestions:[]},null,WEEK,'t').rules,undefined);
  assert.deepEqual(wl.freshCandidates(base,['내 규칙','뺀 규칙','후보 3','새 것','새 것']),['새 것']);
});

// WEEKLY-환류입력창 ①: 칸별 고침 모양(매번 비워 두는 칸·늘 손으로 다시 쓰는 칸·늘 지우는 줄)을 세어 환류 보고 재료로 보낸다.
test('pure: inputPatterns counts empty / rewritten / dropped weeks per cell (cell stats, or lists for old records)',()=>{
  const cell=(where,o)=>({where,proposed:2,final:2,kept:2,changed:0,dropped:0,added:0,...o});
  const weeks=['2026-10-19','2026-10-12','2026-10-05'].map(w=>wl.readFeedbackCell({at:'a',week:w,counts:{},cells:[
    cell('산하조직 · 가상 조직',{final:0,kept:0,dropped:2}),cell('요약 · 가 › 가-1',{kept:0,changed:1,added:1}),cell('요약 · 나 › 나-1',{})]},w));
  const old=wl.readFeedbackCell({at:'a',week:'2026-09-28',counts:{},dropped:[{where:'투쟁 사업장 · B 사업장',text:'x'}]},'2026-09-28');
  const p=wl.inputPatterns([...weeks,old]);
  assert.deepEqual(p.map(x=>x.where),['산하조직 · 가상 조직','요약 · 가 › 가-1','투쟁 사업장 · B 사업장']);
  assert.deepEqual(p[0],{where:'산하조직 · 가상 조직',weeks:3,empty_weeks:3,rewritten_weeks:0,dropped_weeks:3,untouched_weeks:0});
  assert.deepEqual(p[1],{where:'요약 · 가 › 가-1',weeks:3,empty_weeks:0,rewritten_weeks:3,dropped_weeks:0,untouched_weeks:0});
  assert.equal(p[2].empty_weeks,1,'old record: only dropped lines → final 0');
  // 손대지 않은 칸은 보내지 않는다.
  assert.ok(!p.some(x=>x.where==='요약 · 나 › 나-1'));
  const material=JSON.parse(wl.weeklyReviewMaterial(weeks[0],weeks.slice(1),['r']));
  assert.equal(material.input_patterns[0].empty_weeks,3);
});

// WEEKLY-환류입력창 ②: 줄 옆 '이렇게 바꾸면?'. 학습 재료는 규칙·지난 고침 기록(같은 칸 예가 앞), 이번 주 행(개인본·고침·규칙)은 보내지 않는다. 저장 없음.
const lineBody=(over={})=>({kind:'weekly_line',week_start:WEEK,where:'요약 · 나 › 나-1',lines:[{ref:'l1',text:'- 가상 교섭 3차 진행 중'},{ref:'l2',text:'- 가상 행사'}],cell:['- 가상 교섭 3차 진행 중','- 가상 행사'],material:['가상 교섭 3차 결렬(10/28)'],...over});
test('weekly_line: rules + past edits (same cell first) are the material, this week is never sent, answer per line, nothing stored',async()=>{
  const {handler,calls,db}=harness({openai:()=>respond(answer({lines:[{ref:'l1',text:'- 가상 교섭 3차 결렬(10.28.)'},{ref:'l2',text:'- 가상 행사'},{ref:'l9',text:'없는 줄'}]}))});
  const res=await post(handler,lineBody());
  assert.equal(res.status,200);
  const body=await res.json();
  assert.deepEqual(body,{ok:true,kind:'weekly_line',week_start:WEEK,lines:[{ref:'l1',text:'- 가상 교섭 3차 결렬(10.28.)'},{ref:'l2',text:null}],learned:{weeks:2,rules:1}});
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'weekly_line');assert.equal(o.text.format.strict,true);
  const material=o.input[1].content,sent=JSON.parse(material);
  assert.deepEqual(sent.rules,['날짜는 10.28.(화) 꼴']);
  assert.equal(sent.past_edits[0].where,'요약 · 나 › 나-1','same cell example first');
  assert.ok(sent.past_edits.length>=3);
  assert.deepEqual(sent.lines,[{ref:'l1',text:'- 가상 교섭 3차 진행 중'},{ref:'l2',text:'- 가상 행사'}]);
  assert.deepEqual(sent.this_week,['가상 교섭 3차 결렬(10/28)']);
  for(const hidden of ['THIS_WEEK_ANSWER','THIS_WEEK_BEFORE','THIS_WEEK_RULE','FOREIGN_TEXT','FOREIGN_RULE','UNCONFIRMED_CANDIDATE','RETIRED_RULE',OWNER,WS])assert.ok(!material.includes(hidden),hidden+' must not be sent');
  const read=calls.rest.find(c=>c.table==='app_weekly_exec_requests');
  assert.match(read.query,/week_start=lt\.2026-10-26/);
  assert.ok(calls.rest.every(c=>c.method==='GET'||c.table==='app_ai_daily_usage'),'no write but the usage count');
  assert.equal(db.app_ai_daily_usage[0].requests,1);
  assert.ok(!/가상|교섭|규칙/.test(JSON.stringify(calls.logs)),'no text in logs');
  assert.ok(calls.logs.some(l=>l.code==='weekly_line_done'&&l.detail.asked===2&&l.detail.answered===1));
  assert.equal(DAILY_LIMITS.weekly_line,20);
});
test('weekly_line: bad requests never reach AI; untrusted answers cleaned',async()=>{
  const bad=[lineBody({lines:[]}),lineBody({lines:Array.from({length:9},(_,i)=>({ref:`l${i+1}`,text:'줄'}))}),lineBody({lines:[{ref:'l1',text:'a'},{ref:'l1',text:'b'}]}),
    lineBody({lines:[{ref:'x1',text:'a'}]}),lineBody({lines:[{ref:'l1',text:'<b>x</b>'}]}),lineBody({lines:[{ref:'l1',text:'x'.repeat(301)}]}),lineBody({cell:Array(21).fill('줄')}),
    lineBody({material:['x'.repeat(401)]}),lineBody({extra:1}),lineBody({week_start:'2026-10-27'}),lineBody({where:''})];
  for(const b of bad){const {handler,calls}=harness();await expectError(await post(handler,b),400,'invalid_request');assert.equal(calls.openai.length,0);}
  {const {handler}=harness({openai:()=>respond(answer({lines:[{ref:'l1',text:'연락 010-1234-5678'},{ref:'l2',text:'<i>가상</i> 행사 끝'}]}))});
   const body=await (await post(handler,lineBody())).json();
   assert.deepEqual(body.lines,[{ref:'l1',text:null},{ref:'l2',text:'가상 행사 끝'}]);}
  {const {handler}=harness({openai:()=>respond({status:'completed',output:[]})});await expectError(await post(handler,lineBody()),502,'ai_invalid_response');}
});

// WEEKLY-환류전칸 ⑤: 확정 전(고침 기록 없음)이라도 이 주 동작 기록(draft.picks)이 있으면 weekly_review 가 그것으로 정리한다.
// 재료에는 묶음·제안 종류별 셈(그대로 넣은 비율)과 고친 예·뺀 예(이유)·손으로 더한 예가 간다. 후보는 규칙 칸에만(고침 기록 칸은 만들지 않음).
// 앞 주들의 '빼면서 적은 이유'는 weekly_draft·weekly_line 재료(rejected_with_reason)로 간다. 기록에는 숫자만. 가짜 글만.
const picks=(items)=>({at:'2026-10-29T01:00:00.000Z',items,released:[]});
const pk=(o)=>({key:`k${Math.random()}`,kind:'material',from:'record',cell:'summary:가›가-1',org:'',at:'2026-10-29T01:00:00.000Z',text:'가상 제안 글',...o});
test('weekly_review: no feedback yet but this week\'s actions → reviews the actions (reasons included), saves candidates only',async()=>{
  const items=[pk({act:'take'}),pk({act:'take'}),pk({act:'drop',text:'가상 뺀 제안',why:'가상 지난주에 쓴 일'}),pk({act:'edit',text:'가상 고친 글',before:'가상 원래 제안'}),
    pk({kind:'line',from:'calendar',cell:'calendar',act:'cut',text:'10:00 / 가상 일정'}),pk({kind:'review',from:'hand',cell:'개선 제안',act:'add',text:'가상 내 생각'}),pk({act:'none'}),{kind:'BAD KIND',act:'take',text:'x'},{kind:'material',act:'zap'}];
  const rows=[{id:'r1',workspace_id:WS,week_start:WEEK,items:[],draft_saved_at:'2026-10-30T04:00:00.000Z',draft:{v:1,rows:[],titles:[],picks:picks(items)}},
    {id:'r2',workspace_id:WS,week_start:'2026-10-19',items:[],draft_saved_at:'x',draft:{v:1,feedback:fb('2026-10-19'),rules:{v:2,at:'2026-10-23T09:00:00Z',lines:[{text:'가상 확정 규칙',from:'added'}],candidates:[],retired:[]}}}];
  const {handler,calls,db}=harness({rows,openai:()=>respond(answer({candidates:['가상 실시간 후보'],suggestions:[{area:'flow',text:'가상 흐름 제안'}]}))});
  const res=await post(handler,{kind:'weekly_review',week_start:WEEK});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.saved,true);assert.deepEqual(body.review.candidates,['가상 실시간 후보']);
  const sent=JSON.parse(calls.openai[0].input[1].content);
  assert.equal(sent.this_week,null);
  assert.equal(sent.this_week_actions.total,6,'none·broken items are not counted');
  assert.deepEqual(sent.this_week_actions.counts.find(c=>c.group==='2. 사업 요약'&&c.kind==='material'),{group:'2. 사업 요약',kind:'material',take:2,edit:1,drop:1,fix:0,cut:0,add:0,kept_percent:50});
  assert.ok(sent.this_week_actions.counts.some(c=>c.group==='5. 주요 일정'&&c.cut===1));
  assert.ok(sent.this_week_actions.examples.some(e=>e.how==='뺌'&&e.why==='가상 지난주에 쓴 일'&&e.before==='가상 뺀 제안'));
  assert.ok(sent.this_week_actions.examples.some(e=>e.how==='고쳐서 넣음'&&e.before==='가상 원래 제안'&&e.after==='가상 고친 글'));
  assert.ok(sent.this_week_actions.examples.some(e=>e.how==='손으로 더함'&&e.where==='개선 제안'&&e.after==='가상 내 생각'));
  assert.match(calls.openai[0].input[0].content,/this_week_actions는/);
  const row=db.app_weekly_exec_requests.find(r=>r.id==='r1');
  assert.equal(row.draft.feedback,undefined,'no feedback cell is made before the confirm');
  assert.deepEqual(row.draft.rules.candidates,[{text:'가상 실시간 후보'}]);
  assert.deepEqual(row.draft.rules.lines,[{text:'가상 확정 규칙',from:'added'}]);
  assert.equal(row.draft.picks.items.length,items.length,'actions kept as they were');
  assert.ok(calls.logs.some(l=>l.code==='weekly_review_done'&&l.detail.actions===6&&l.detail.confirmed===false));
  assert.ok(!/가상/.test(JSON.stringify(calls.logs)),'no text in logs');
  // 동작이 'none'뿐이면(되돌린 것뿐) AI를 부르지 않는다.
  {const {handler,calls}=harness({rows:[{id:'r1',workspace_id:WS,week_start:WEEK,items:[],draft_saved_at:null,draft:{v:1,picks:picks([pk({act:'none'})])}}]});await expectError(await post(handler,{kind:'weekly_review',week_start:WEEK}),404,'not_found');assert.equal(calls.openai.length,0);}
});
test('weekly_draft·weekly_line: earlier weeks\' drop reasons go as rejected_with_reason (this week never)',async()=>{
  const rows=[{id:'r1',workspace_id:WS,week_start:WEEK,items:[],draft_saved_at:'x',draft:{v:1,picks:picks([pk({act:'drop',text:'THIS_WEEK_DROP',why:'THIS_WEEK_WHY'})])}},
    {id:'r2',workspace_id:WS,week_start:'2026-10-19',items:[],draft_saved_at:'x',draft:{v:1,feedback:fb('2026-10-19'),picks:picks([pk({act:'drop',cell:'orgs:가상 지부',text:'가상 뺀 조직 소식',why:'가상 이미 끝난 일'}),pk({act:'drop',text:'이유 없음'}),pk({act:'take'})])}},
    {id:'r4',workspace_id:OTHER_WS,week_start:'2026-10-19',items:[],draft_saved_at:'x',draft:{v:1,picks:picks([pk({act:'drop',why:'FOREIGN_WHY'})])}}];
  const {handler,calls}=harness({rows});
  assert.equal((await post(handler,draftBody())).status,200);
  const material=calls.openai[0].input[1].content,sent=JSON.parse(material);
  assert.deepEqual(sent.rejected_with_reason,[{where:'4. 산하 조직',text:'가상 뺀 조직 소식',why:'가상 이미 끝난 일'}]);
  for(const hidden of ['THIS_WEEK_WHY','THIS_WEEK_DROP','FOREIGN_WHY'])assert.ok(!material.includes(hidden),hidden);
  assert.match(calls.openai[0].input[0].content,/rejected_with_reason/);
  assert.match(calls.rest.find(c=>c.table==='app_weekly_exec_requests').query,/picks:draft->picks/);
  const pure=wl.dropReasons([{week_start:'2026-10-12',picks:picks([pk({act:'drop',why:'가'})])},{week_start:WEEK,picks:picks([pk({act:'drop',why:'나'})])}],WEEK);
  assert.deepEqual(pure.map(x=>x.why),['가']);
});
