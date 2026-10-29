import test from 'node:test';
import assert from 'node:assert/strict';

// FEAT-1029묶음 ② 교섭·회의 전 한 장: the real ai-assist handler, kind=pre_meeting_sheet, with a synthetic Supabase (Auth + PostgREST with
// owner RLS) and a mocked OpenAI. No network, no real key, synthetic text only. The screen sends the event values and the organization id; the
// server reads the material with the caller token only (meetings, ledger, work calls, telegram summaries, key people, documents, dispute stage),
// never the personal call box, sends S2 ledger records and telegram raw text with sender display names to AI (명진 결정 변경 10/29),
// never call raw text or counterpart names, writes only app_pre_meeting_sheets (+ AI usage),
// refuses events outside the 8-day window and another workspace's organization, and keeps the record lines when AI is limited or fails.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const pm=await import('../../supabase/functions/ai-assist/pre-meeting-sheet.ts');
const ev=await import('../../supabase/functions/ai-assist/evidence.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const ORG='c0000000-0000-4000-8000-000000000001',ORG_OTHER='c0000000-0000-4000-8000-000000000002',ORG_THEIRS='c0000000-0000-4000-8000-000000000009';
const LORG='d0000000-0000-4000-8000-000000000001';
const M1='e0000000-0000-4000-8000-000000000001',M2='e0000000-0000-4000-8000-000000000002',M3='e0000000-0000-4000-8000-000000000003',M_POLICY='e0000000-0000-4000-8000-000000000004';
const R_ISSUE='f0000000-0000-4000-8000-000000000001',R_S2='f0000000-0000-4000-8000-000000000002',R_PROMISE='f0000000-0000-4000-8000-000000000003',R_DONE='f0000000-0000-4000-8000-000000000004';
const CALL='a1000000-0000-4000-8000-000000000001',TG='a1000000-0000-4000-8000-000000000002',PERSON='a2000000-0000-4000-8000-000000000001',DOC='a3000000-0000-4000-8000-000000000001';
const SA='a4000000-0000-4000-8000-000000000001',SB_SELF='a4000000-0000-4000-8000-000000000002',SX='a4000000-0000-4000-8000-000000000009';
// Thursday 10/29 18:30 KST; event Friday 10/30 14:00 KST.
const EVENING=Date.parse('2026-10-29T09:30:00Z'),AFTERNOON=Date.parse('2026-10-29T06:00:00Z');
const EVENT={event_key:'work@group.calendar.test:evt4th',title:'A 사업장 임금교섭 4차',start:'2026-10-30T14:00:00+09:00',end:'2026-10-30T16:00:00+09:00',location:'본사 회의실'};

const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=(o)=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(o)}]}],usage:{input_tokens:1200,output_tokens:150}});
const AI={top:[{text:'3차에서 남은 쟁점은 인상률 한 가지임.',refs:[1,99]},{text:'자료 회신 약속이 아직 대기임.',refs:[5]},{text:'근거 없는 줄임.',refs:[42]}],
  issues:[{text:'기본급 인상률 이견 남음.',refs:[4]}],counterpart:[{text:'사측 교섭위원 3명임.',refs:[1]}]};

function seed(){
  return {
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_suborganizations:[{id:ORG,workspace_id:WS,name:'A 사업장',deleted_at:null},{id:ORG_OTHER,workspace_id:WS,name:'B 지부',deleted_at:null},{id:ORG_THEIRS,workspace_id:OTHER_WS,name:'남의 조직',deleted_at:null}],
    app_suborganization_dispute_stages:[{organization_id:ORG,workspace_id:WS,stage_name:'조정 신청',stage_date:'2026-10-20',created_at:'2026-10-20T00:00:00Z'}],
    app_record_links:[M1,M2,M3,M_POLICY].map(id=>({workspace_id:WS,organization_id:ORG,status:'confirmed',source_meeting_id:id})),
    app_meetings:[
      {id:M1,workspace_id:WS,title:'교섭',series_name:'A 사업장 임금교섭',round_no:3,meeting_at:'2026-10-27T05:00:00Z',transcript_text:'인상률 이견. 사측 위원 3명 참석. 연락 010-1234-5678',next_plan:'근거 자료 보내기',activity_kind:'negotiation',deleted_at:null},
      {id:M2,workspace_id:WS,title:'교섭',series_name:'A 사업장 임금교섭',round_no:2,meeting_at:'2026-10-20T05:00:00Z',transcript_text:'요구안 설명',next_plan:null,activity_kind:'negotiation',deleted_at:null},
      {id:M3,workspace_id:WS,title:'지난 회의',series_name:null,round_no:null,meeting_at:'2026-10-10T05:00:00Z',transcript_text:'간담회',next_plan:null,activity_kind:'meeting',deleted_at:null},
      {id:M_POLICY,workspace_id:WS,title:'정책 토론',series_name:null,round_no:null,meeting_at:'2026-10-28T05:00:00Z',transcript_text:'정책',next_plan:null,activity_kind:'policy',deleted_at:null},
    ],
    app_ledger_organizations:[{id:LORG,workspace_id:WS,suborganization_id:ORG}],
    app_ledger_links:[R_ISSUE,R_S2,R_PROMISE,R_DONE].map(id=>({workspace_id:WS,record_id:id,target_organization_id:LORG})),
    app_ledger_records:[
      {id:R_ISSUE,workspace_id:WS,kind:'event',title:'기본급 인상률 이견',summary:'3차 교섭에서 합의 못 함',sensitivity:'S1',counterparty:'사측',commitment_status:null,follow_up_on:null,date_start:'2026-10-27',validity:'current',scope:'work',updated_at:'2026-10-27T00:00:00Z'},
      {id:R_S2,workspace_id:WS,kind:'decision',title:'전략 비공개 결정',summary:'비공개 전략 내용',sensitivity:'S2',counterparty:null,commitment_status:null,follow_up_on:null,date_start:'2026-10-25',validity:'current',scope:'work',updated_at:'2026-10-25T00:00:00Z'},
      {id:R_PROMISE,workspace_id:WS,kind:'commitment',title:'인상률 근거 자료 회신',summary:null,sensitivity:'S0',counterparty:'사측',commitment_status:'waiting',follow_up_on:'2026-11-01',date_start:'2026-10-27',validity:'current',scope:'work',updated_at:'2026-10-27T00:00:00Z'},
      {id:R_DONE,workspace_id:WS,kind:'commitment',title:'끝난 약속',summary:null,sensitivity:'S0',counterparty:null,commitment_status:'fulfilled',follow_up_on:null,date_start:'2026-10-01',validity:'current',scope:'work',updated_at:'2026-10-01T00:00:00Z'},
    ],
    app_feed_items:[
      {id:CALL,workspace_id:WS,organization_id:ORG,source:'call',day:'2026-10-28',title:'사측 실무자 통화',room_label:null,summary:'성과급 안 바꿀 수 있다고 함',hidden_at:null,counterpart:'홍길동',raw_text:'통화 원문'},
      {id:TG,workspace_id:WS,organization_id:ORG,source:'telegram',day:'2026-10-28',title:null,room_label:'A 사업장 간부방',room_key:'room-a',summary:'4차 교섭 준비 공유',hidden_at:null,counterpart:null,
        raw_text:'09:10 A: 4차 교섭 자료 다시 확인 010-2222-3333\n09:12 B (전달): 사측 답 기다림\n09:15 C: 라벨만 남는 줄'},
    ],
    app_tg_day_senders:[{workspace_id:WS,room_key:'room-a',day:'2026-10-28',label:'A',sender_id:SA},{workspace_id:WS,room_key:'room-a',day:'2026-10-28',label:'B',sender_id:SB_SELF},
      {workspace_id:OTHER_WS,room_key:'room-a',day:'2026-10-28',label:'C',sender_id:SX}],
    app_tg_senders:[{id:SA,workspace_id:WS,name:'김철수',is_self:false},{id:SB_SELF,workspace_id:WS,name:null,is_self:true},{id:SX,workspace_id:OTHER_WS,name:'남의이름',is_self:false}],
    app_org_key_people:[{id:PERSON,workspace_id:WS,organization_id:ORG,name:'김지부장',sort_order:0,created_at:'2026-10-01T00:00:00Z'}],
    app_org_key_people_briefs:[{workspace_id:WS,organization_id:ORG,day:'2026-10-29',brief:'요즘 성과급 안에 반대함.'}],
    app_documents:[{id:DOC,workspace_id:WS,organization_id:ORG,title:'2026 임금 요구안',category:'교섭·합의',document_date:'2026-10-15',created_at:'2026-10-15T00:00:00Z'}],
    app_pre_meeting_sheets:[],
    app_ai_daily_usage:[],
  };
}

function harness({openai=null,usage=[],sheets=[],now=EVENING,missing=false,namesDown=false}={}){
  const calls={openai:[],rest:[],logs:[],hosts:new Set()};
  const db=seed();db.app_pre_meeting_sheets=structuredClone(sheets);db.app_ai_daily_usage=structuredClone(usage);
  const users={'owner-token':OWNER,'stranger-token':STRANGER},wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const orgWs=Object.fromEntries(db.app_suborganizations.map(o=>[o.id,o.workspace_id]));
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id??orgWs[row.organization_id]]===uid;
  const cmp=(v,op,val)=>op==='eq'?String(v)===val:op==='gte'?v!=null&&String(v)>=val:op==='lt'?v!=null&&String(v)<val
    :op==='is'?(val==='null'?v==null:String(v)===val):op==='in'?val.replace(/^\(|\)$/g,'').split(',').map(x=>x.replace(/^"|"$/g,'')).includes(String(v))
    :op==='not'?(val==='is.null'?v!=null:(()=>{throw new Error('not '+val)})()):(()=>{throw new Error('op '+op)})();
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const pick=(row,url)=>{const cols=(url.searchParams.get('select')||'*').split(',');return cols[0]==='*'?row:Object.fromEntries(cols.map(c=>[c,row[c]]));};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    calls.hosts.add(url.origin);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1)):respond(answer(AI));}
    assert.equal(url.origin,SB,'no Google or other outbound host');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null});
    if(missing&&table==='app_pre_meeting_sheets')return respond({code:'PGRST205'},404);
    if(namesDown&&table==='app_tg_day_senders')return respond({code:'XX'},500);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET'){
      let out=rows.filter(r=>visible(table,r,uid)&&matches(r,url));
      const order=url.searchParams.get('order');if(order){const [col,dir]=order.split(',')[0].split('.');out=[...out].sort((a,b)=>String(a[col]??'').localeCompare(String(b[col]??''))*(dir==='desc'?-1:1));}
      const limit=Number(url.searchParams.get('limit')||1000);
      return respond(out.slice(0,limit).map(r=>pick(r,url)));
    }
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(table==='app_pre_meeting_sheets'&&method==='POST'){
      const b=JSON.parse(init.body);
      assert.deepEqual(Object.keys(b).sort(),['ai_status','event_end','event_key','event_location','event_start','event_title','groups','made_by','organization_id','top_lines','workspace_id'],'only the eleven insert columns');
      if(!visible(table,b,uid))return respond({code:'42501'},403);
      if(orgWs[b.organization_id]!==b.workspace_id)return respond({code:'23514'},400);
      if(rows.some(r=>r.workspace_id===b.workspace_id&&r.event_key===b.event_key))return respond({code:'23505'},409);
      rows.push({...b,created_at:'now',updated_at:new Date(now).toISOString()});return respond('',201);
    }
    if(table==='app_pre_meeting_sheets'&&method==='PATCH'){
      const b=JSON.parse(init.body);
      assert.deepEqual(Object.keys(b).sort(),['ai_status','event_end','event_location','event_start','event_title','groups','made_by','organization_id','top_lines','updated_at'],'only the ten update columns');
      for(const r of rows)if(visible(table,r,uid)&&matches(r,url))Object.assign(r,b);
      return new Response(null,{status:204});
    }
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>now,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const req=(extra={},event={})=>({kind:'pre_meeting_sheet',mode:'auto',event:{...EVENT,...event},organization_id:ORG,...extra});
const onlyWrites=calls=>calls.rest.filter(c=>c.method!=='GET').map(c=>c.table);

test('evening before, no sheet yet: one AI call, material read with the caller token, sheet stored only in its table',async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,req());
  assert.equal(res.status,200);
  const out=await res.json();
  assert.equal(out.event_key,EVENT.event_key);assert.equal(out.sheet.ai_status,'ok');assert.equal(out.sheet.made_by,'auto');
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0],material=o.input[1].content;
  assert.equal(o.store,false);assert.equal(o.text.format.name,'pre_meeting_sheet');assert.equal(o.text.format.strict,true);
  assert.ok(o.input[0].content.includes("'~함.'·'~임.'"),'the house tone (shared AI_TONE_RULE)');
  // Material: meetings (negotiation/meeting only, newest 3), ledger issue/promise, call summary, telegram room+summary, document title.
  assert.match(material,/A 사업장 임금교섭 3차/);assert.match(material,/기본급 인상률 이견/);assert.match(material,/인상률 근거 자료 회신/);
  assert.match(material,/성과급 안 바꿀 수 있다고 함/);assert.match(material,/A 사업장 간부방 — 4차 교섭 준비 공유/);assert.match(material,/2026 임금 요구안/);
  // 결정 변경: telegram raw lines with display names (hand name → "나" for self → label as is), phones scrubbed, another workspace's names unused.
  assert.ok(material.includes('4차 교섭 준비 공유 / 원문: 09:10 김철수: 4차 교섭 자료 다시 확인 [전화] / 09:12 나 (전달): 사측 답 기다림 / 09:15 C: 라벨만 남는 줄'),material);
  assert.ok(!material.includes('남의이름')&&!material.includes('010-2222-3333'));
  assert.match(material,/쟁의 단계: 조정 신청/);
  assert.ok(!material.includes('정책 토론'),'policy reports are not negotiation material');
  assert.ok(!material.includes('끝난 약속'),'fulfilled promises are not material');
  // 결정 변경: S2 is sent to AI with its tag, and still marked on the stored line.
  assert.match(material,/② 남은 쟁점\(교섭·전략\) · 2026-10-25 · 전략 비공개 결정 — 비공개 전략 내용/);
  const s2=out.sheet.groups.find(g=>g.source_id===R_S2);assert.equal(s2.s2,true);assert.equal(s2.title,'전략 비공개 결정');
  // Calls: no counterpart name or raw text. Phone numbers are scrubbed.
  assert.ok(!/통화 원문|홍길동/.test(material),'no call counterpart names or call raw text');
  assert.ok(!material.includes('010-1234-5678'),'phone numbers are not sent');
  const feedReads=calls.rest.filter(c=>c.table==='app_feed_items');
  assert.ok(feedReads.every(c=>!/counterpart/.test(c.query)),'feed reads never select counterpart names');
  assert.ok(feedReads.filter(c=>/source=eq\.call/.test(c.query)).every(c=>!/raw_text/.test(c.query)),'call reads never select raw text');
  assert.ok(calls.rest.filter(c=>/^app_tg_/.test(c.table)).every(c=>c.method==='GET'&&c.query.includes(`workspace_id=eq.${WS}`)),'name tables: GET, my workspace only');
  // Telegram raw and names are AI material only: not stored, not in logs.
  assert.ok(!/김철수|사측 답 기다림/.test(JSON.stringify(out.sheet)+JSON.stringify(calls.logs)));
  // Key people: names and the existing brief are lines, not AI material.
  assert.ok(!material.includes('김지부장')&&!material.includes('성과급 안에 반대'),'key people are not re-sent to AI');
  assert.ok(out.sheet.groups.some(g=>g.group==='people'&&g.title==='요즘: 요즘 성과급 안에 반대함.'));
  // Evidence: refs outside the material are dropped; a line without real refs is dropped.
  const idx=i=>out.sheet.groups[i];
  assert.equal(out.sheet.top_lines.length,2);
  assert.deepEqual(out.sheet.top_lines[0],{text:AI.top[0].text,refs:[1]});
  for(const l of out.sheet.top_lines)for(const r of l.refs)assert.ok(idx(r)&&idx(r).source_kind!=='ai'&&idx(r).group!=='people'&&idx(r).group!=='stage','every top line points at a sent record line');
  assert.ok(out.sheet.groups.some(g=>g.group==='issues'&&g.source_kind==='ai'&&g.title==='기본급 인상률 이견 남음.'));
  assert.ok(out.sheet.groups.some(g=>g.group==='counterpart'&&g.source_kind==='ai'));
  assert.ok(!JSON.stringify(out.sheet.groups).includes('인상률 이견. 사측'),'meeting text is AI material only, not stored');
  // Read-only towards every source: the only writes are the sheet and the AI usage row; the personal call box is never read.
  assert.deepEqual([...new Set(onlyWrites(calls))].sort(),['app_ai_daily_usage','app_pre_meeting_sheets']);
  assert.ok(!calls.rest.some(c=>/personal|diary|app_notes/.test(c.table)),'personal call box, diary and notes are never read');
  assert.deepEqual([...calls.hosts].sort(),['https://api.openai.com',SB]);
  assert.equal(db.app_pre_meeting_sheets.length,1);assert.equal(db.app_pre_meeting_sheets[0].organization_id,ORG);
  assert.equal(db.app_pre_meeting_sheets[0].event_start,'2026-10-30T05:00:00.000Z');
  assert.equal(db.app_ai_daily_usage[0].requests,1);assert.equal(db.app_ai_daily_usage[0].input_tokens,1200);
  assert.ok(!/교섭|사업장|인상률/.test(JSON.stringify(calls.logs)),'no material in logs');
  assert.equal(DAILY_LIMITS.pre_meeting_sheet,10);
});

for(const [name,opts,body,event,reason] of [
  ['auto before 18:00',{now:AFTERNOON},{},{},'not_yet'],
  ['auto for an event two days ahead',{},{},{start:'2026-10-31T14:00:00+09:00',end:null},'not_yet'],
  ['auto for a title without meeting words (결정 1)',{},{},{title:'A 사업장 창립 행사'},'not_yet'],
  ['auto when the sheet already exists',{sheets:[{workspace_id:WS,event_key:EVENT.event_key,organization_id:ORG,event_title:EVENT.title,event_start:'2026-10-30T05:00:00.000Z',top_lines:[],groups:[],ai_status:'skipped',made_by:'user'}]},{},{},'done'],
])test(`auto is skipped without AI and without writes: ${name}`,async()=>{
  const {handler,calls,db}=harness(opts);
  const res=await post(handler,req(body,event));
  assert.equal(res.status,200);
  assert.equal((await res.json()).skipped,reason);
  assert.equal(calls.openai.length,0);
  assert.deepEqual(onlyWrites(calls),[],'nothing written');
  assert.equal(db.app_ai_daily_usage.length,0);
});

test('[지금 만들기] works before 18:00 and days ahead; [다시 만들기] overwrites the same event row and can re-link the organization',async()=>{
  const early=harness({now:AFTERNOON});
  const made=await (await post(early.handler,req({mode:'user'},{start:'2026-11-05T10:00:00+09:00',end:null,location:null}))).json();
  assert.equal(made.sheet.made_by,'user');assert.equal(made.sheet.event_location,null);
  const again=harness({sheets:[{workspace_id:WS,event_key:EVENT.event_key,organization_id:ORG,event_title:'옛 제목',event_start:'2026-10-30T05:00:00.000Z',top_lines:[],groups:[],ai_status:'failed',made_by:'auto'}]});
  const r=await (await post(again.handler,req({mode:'user',organization_id:ORG_OTHER}))).json();
  assert.equal(again.db.app_pre_meeting_sheets.length,1);
  assert.equal(r.sheet.made_by,'user');assert.equal(r.sheet.event_title,EVENT.title);assert.equal(r.sheet.organization_id,ORG_OTHER);
  assert.ok(again.calls.rest.some(c=>c.method==='PATCH'),'existing row is patched, not duplicated');
  // B 지부 has no records: nothing to send, no AI call, sheet stored as skipped.
  assert.equal(r.sheet.ai_status,'skipped');assert.equal(again.calls.openai.length,0);
});

test('window and scope: outside 8 days or long past is refused; another workspace organization is not found; no AI call',async()=>{
  const h=harness();
  for(const start of ['2026-11-07T10:00:00+09:00','2026-10-29T08:00:00+09:00']){
    const res=await post(h.handler,req({mode:'user'},{start,end:null}));assert.equal(res.status,400,start);
  }
  assert.equal((await post(h.handler,req({mode:'user'},{start:'2026-11-06T10:00:00+09:00',end:null}))).status,200,'8 days ahead is accepted');
  const theirs=await post(h.handler,req({mode:'user',organization_id:ORG_THEIRS}));assert.equal(theirs.status,404);
  const stranger=await post(h.handler,req({mode:'user'}),'stranger-token');assert.equal(stranger.status,404,'the stranger cannot use the owner organization');
  assert.equal(h.db.app_pre_meeting_sheets.filter(s=>s.workspace_id===OTHER_WS).length,0);
  for(const body of [req({workspace_id:WS}),req({user_id:OWNER}),req({items:[]})]){const res=await post(h.handler,body);assert.equal(res.status,400);}
  const anon=await h.handler(new Request(FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req())}));
  assert.equal(anon.status,401);
});

test('AI limits and failures still store the record lines without AI lines; the per-use daily limit is 10 sheets',async()=>{
  const monthly=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-27',requests:1,input_tokens:9e9,output_tokens:9e9}]});
  let out=await (await post(monthly.handler,req())).json();
  assert.equal(out.sheet.ai_status,'limit');assert.deepEqual(out.sheet.top_lines,[]);assert.ok(out.sheet.groups.length>=8);assert.equal(monthly.calls.openai.length,0);
  const daily=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-29',requests:80,input_tokens:1,output_tokens:1}]});
  out=await (await post(daily.handler,req())).json();
  assert.equal(out.sheet.ai_status,'limit');assert.equal(daily.calls.openai.length,0);
  const ten=Array.from({length:10},(_,i)=>({workspace_id:WS,event_key:`work@group.calendar.test:other${i}`,organization_id:ORG,event_title:'다른 교섭',event_start:'2026-10-30T01:00:00.000Z',top_lines:[],groups:[],ai_status:'ok',made_by:'auto',updated_at:'2026-10-29T09:00:00.000Z'}));
  const many=harness({sheets:ten});
  out=await (await post(many.handler,req())).json();
  assert.equal(out.sheet.ai_status,'limit');assert.equal(many.calls.openai.length,0,'the 11th AI sheet of the day is not made with AI');
  const nine=harness({sheets:ten.slice(1)});
  assert.equal((await (await post(nine.handler,req())).json()).sheet.ai_status,'ok');
  const broken=harness({openai:()=>respond({error:{message:'synthetic'}},500)});
  out=await (await post(broken.handler,req())).json();
  assert.equal(out.sheet.ai_status,'failed');assert.ok(out.sheet.groups.length>=8);
  const junk=harness({openai:()=>respond(answer({top:[{text:'<b>x</b>',refs:[1]},{text:'S2 줄을 근거로 함.',refs:[6]},{text:'쟁의 단계 줄만 근거로 함.',refs:[0]}],issues:[],counterpart:[]}))});
  out=await (await post(junk.handler,req())).json();
  const s2Index=out.sheet.groups.findIndex(g=>g.s2);assert.equal(s2Index,6,'fixture: index 6 is the S2 line');
  assert.equal(out.sheet.groups[0].group,'stage','fixture: index 0 is the (unsent) dispute stage line');
  assert.equal(out.sheet.ai_status,'ok');
  assert.deepEqual(out.sheet.top_lines,[{text:'S2 줄을 근거로 함.',refs:[6]}],'S2 lines are sent now (결정 변경); lines pointing only at unsent lines are dropped');
});

test('before the DB step the server answers pre_meeting_sheet_not_ready without calling AI; bad requests are refused',async()=>{
  const m=harness({missing:true});
  const r=await post(m.handler,req());
  assert.equal(r.status,503);assert.equal((await r.json()).error,'pre_meeting_sheet_not_ready');assert.equal(m.calls.openai.length,0);
  const h=harness();
  for(const body of [
    req({mode:'cron'}),req({organization_id:'not-a-uuid'}),req({},{event_key:'has space here'}),req({},{event_key:'ab'}),req({},{title:'가\n나'}),
    req({},{title:'가'.repeat(301)}),req({},{start:'2026-10-30'}),req({},{end:'2026-10-30T13:00:00+09:00'}),req({},{location:''}),
    {kind:'pre_meeting_sheet',mode:'auto',organization_id:ORG},{...req(),event:{...EVENT,calendar:'personal'}},
  ]){const res=await post(h.handler,body);assert.equal(res.status,400,JSON.stringify(body).slice(0,140));}
  assert.equal(h.calls.openai.length,0);
});

test('pure helpers: titles, clock, window, evidence check shared with next week sheet',()=>{
  for(const t of ['A 임금교섭 4차','운영위원회의','노사 간담회','단체협약 협의','지부장 면담'])assert.equal(pm.isMeetingTitle(t),true,t);
  assert.equal(pm.isMeetingTitle('창립 기념 행사'),false);
  assert.equal(pm.autoReady(EVENING,Date.parse(EVENT.start)),true);assert.equal(pm.autoReady(AFTERNOON,Date.parse(EVENT.start)),false);
  assert.equal(pm.withinWindow(EVENING,EVENING+8*86400000),true);assert.equal(pm.withinWindow(EVENING,EVENING+8*86400000+1),false);
  const sent=new Set([0,1]);
  assert.equal(pm.parsePreMeetingSheet('not json',sent),null);
  assert.equal(pm.parsePreMeetingSheet(JSON.stringify({top:[]}),sent),null,'missing arrays are a format error');
  const parsed=pm.parsePreMeetingSheet(JSON.stringify({top:Array(5).fill({text:'준비 필요함.',refs:[0]}),issues:[{text:'통화 010-1234-5678',refs:[0]}],counterpart:[{text:' 사측 위원 3명임. ',refs:[1,1,7]}]}),sent);
  assert.equal(parsed.top.length,3);assert.deepEqual(parsed.issues,[]);assert.deepEqual(parsed.counterpart,[{text:'사측 위원 3명임.',refs:[1]}]);
  assert.deepEqual(ev.groundedLines([{text:'근거 있음.',refs:[1]},{text:'근거 없음.',refs:[9]}],sent,{max:3,maxChars:80}),[{text:'근거 있음.',refs:[1]}]);
  assert.equal(ev.groundedLines('x',sent,{max:3,maxChars:80}),null);
  const mat=pm.preMeetingMaterial({...EVENT,start:'2026-10-30T05:00:00.000Z'},'A 사업장',null,[{group:'feed',title:'와이파이 비밀번호: 가상값',day:null,source_kind:'call',source_id:'x'}]);
  assert.equal(mat.text,'','secret-looking lines are not sent');
});

test('telegram raw (결정 변경): name table down falls back to labels, the sheet is still made; length cap 600',async()=>{
  const down=harness({namesDown:true});
  const out=await (await post(down.handler,req())).json();
  assert.equal(out.sheet.ai_status,'ok');
  const material=down.calls.openai[0].input[1].content;
  assert.ok(material.includes('원문: 09:10 A: 4차 교섭 자료 다시 확인 [전화]'),material);assert.ok(!material.includes('김철수'));
  const long=pm.sheetTgRaw('10:00 A: '+'가'.repeat(2000),new Map([['A','김철수']]));
  assert.ok([...long].length<=601);assert.ok(long.startsWith('10:00 김철수: '));
});
