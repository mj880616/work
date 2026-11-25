import test from 'node:test';
import {withAiMonth} from './helpers/ai-month-fake.mjs';
import assert from 'node:assert/strict';

// S70-29 (2026-11-25, 명진 '다 없애 1회용 기능'): kind=journal_memorable_recheck (S54-28 쌓인 소식 한 번 다시 판정) was a one-time cleanup and is removed.
// The real ai-assist handler now rejects it as an unknown request before reading or writing anything. Synthetic Supabase
// (Auth + PostgREST that applies owner RLS per caller token + operator feature check) and a mocked OpenAI. No network, no real key, synthetic text only.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const jm=await import('../../supabase/functions/ai-assist/journal-memorable.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',MEMBER='b0000000-0000-4000-8000-000000000002',OTHER='b0000000-0000-4000-8000-000000000003';
const USERS={'owner-token':OWNER,'member-token':MEMBER,'other-token':OTHER};
const T0=Date.parse('2026-11-09T05:00:00Z'); // 한국 2026-11-09 14:00 → 최근 2주 = 2026-10-26부터
const pad=n=>String(n).padStart(12,'0');
const lid=n=>`d0000000-0000-4000-8000-${pad(n)}`,fid=n=>`c0000000-0000-4000-8000-${pad(n)}`;
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=items=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],usage:{input_tokens:900,output_tokens:120}});
// n번 옛 소식 줄(종류·이유 없음)과 그 원본 기록. day가 클수록 최근.
const line=(n,day,extra={})=>({id:lid(n),workspace_id:WS,day,source:'call',feed_item_id:fid(n),org_name:null,line:'가상 옛 줄 '+n,status:'suggested',
  final_line:null,drop_reason:null,picked_at:`${day}T01:00:00Z`,decided_at:null,...extra});
const feed=(n,extra={})=>({id:fid(n),workspace_id:WS,source:'call',title:'가상 통화 '+n,summary:'',points:[],room_label:null,hidden_at:null,...extra});

function harness({features=['calls','telegram'],memo=[],feeds=[],picks=[],cands=[],openai=null}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:WS,user_id:MEMBER,role:'member'},{workspace_id:WS2,user_id:OTHER,role:'owner'}],
    app_journal_memorable:structuredClone(memo),app_journal_memorable_picks:structuredClone(picks),app_feed_items:structuredClone(feeds),app_ai_daily_usage:[],
    app_todo_candidates:structuredClone(cands),app_suborganizations:[],app_suborganization_assignees:[],app_spaces:[]};
  const cmp=(v,op,val)=>{
    if(op==='eq')return String(v)===val;
    if(op==='is')return val==='null'?v==null:String(v)===val;
    if(op==='in')return val.slice(1,-1).split(',').includes(String(v));
    if(op==='gte')return v!=null&&String(v)>=val;
    if(op==='lt')return v!=null&&String(v)<val;
    throw new Error('op '+op);
  };
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1),calls.openai.length):respond(answer([]));}
    assert.equal(url.origin,SB);
    const user=USERS[(headers.get('Authorization')||'').replace('Bearer ','')];
    if(url.pathname==='/auth/v1/user')return user?respond({id:user}):respond({msg:'bad'},401);
    assert.ok(user,'REST only with a caller token');
    if(url.pathname==='/rest/v1/rpc/app_my_features')return respond(user===OWNER?features:[]);
    const table=url.pathname.replace('/rest/v1/','');
    calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null,user});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    // owner RLS: 호출한 사람이 owner인 작업공간 줄만 보이고 바뀐다(서비스 키 없음).
    const owned=new Set(db.app_workspace_members.filter(m=>m.user_id===user&&m.role==='owner').map(m=>m.workspace_id));
    const visible=r=>table==='app_workspace_members'||table==='app_suborganization_assignees'?r.user_id===user:owned.has(r.workspace_id);
    if(method==='GET')return respond(rows.filter(r=>visible(r)&&matches(r,url)));
    const b=init.body?JSON.parse(init.body):null;
    if(table==='app_ai_daily_usage'&&method==='POST'){const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(table==='app_journal_memorable_picks'&&method==='POST'){
      for(const x of b){assert.deepEqual(Object.keys(x).sort(),['kind','memorable_id','reason','workspace_id'],'only the pick insert columns');
        assert.ok(owned.has(x.workspace_id)&&db.app_journal_memorable.some(m=>m.id===x.memorable_id&&m.workspace_id===x.workspace_id),'pick belongs to my stored line');
        if(!rows.some(r=>r.memorable_id===x.memorable_id))rows.push({...x});}
      return respond('',201);
    }
    if(table==='app_journal_memorable_picks'&&method==='PATCH'){
      // S61-11: 다시 판정이 거꾸로 적힌 '할 일' 줄의 종류만 상대 약속으로 바꾼다(표가 허락한 kind·reason만).
      assert.deepEqual(Object.keys(b).sort(),['kind','reason'],'only kind and reason');assert.equal(b.kind,'promise');
      for(const r of rows)if(visible(r)&&matches(r,url))Object.assign(r,b);
      return new Response(null,{status:204});
    }
    if(table==='app_journal_memorable'&&method==='PATCH'){
      assert.deepEqual(Object.keys(b).sort(),['decided_at','status'],'only status and decided_at');assert.equal(b.status,'dropped');
      for(const r of rows)if(visible(r)&&matches(r,url))Object.assign(r,b);
      return new Response(null,{status:204});
    }
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler(withAiMonth({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-key'})[n],
    fetch:doFetch,now:()=>T0,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})}));
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));

const snapshot=db=>JSON.stringify([db.app_journal_memorable,db.app_journal_memorable_picks]);

test('journal_memorable_recheck is gone: preview and run are rejected (400) with no AI call and no writes',async()=>{
  const memo=[line(1,'2026-11-08'),line(2,'2026-11-07',{status:'suggested'})];
  const h=harness({memo,feeds:[feed(1),feed(2)]});
  const before=snapshot(h.db);
  for(const mode of ['preview','run']){
    const res=await post(h.handler,{kind:'journal_memorable_recheck',mode});
    assert.equal(res.status,400);
    const body=await res.json();
    assert.equal(body.ok,false);
  }
  assert.equal(h.calls.openai.length,0,'no AI call');
  assert.ok(!h.calls.rest.some(c=>c.method!=='GET'),'no writes');
  assert.equal(snapshot(h.db),before,'news tables untouched');
  assert.equal(DAILY_LIMITS.journal_memorable_recheck,undefined,'no daily limit left for the removed kind');
  for(const name of ['parseJournalMemorableRecheckRequest','recheckSplit','MEMORABLE_RECHECK_KEEP_MAX','MEMORABLE_DIRECTION_SINCE'])assert.equal(jm[name],undefined,name+' removed');
});

test('normal journal_memorable picking still caps picks at MEMORABLE_MAX_PICKS',()=>{
  const rows=[1,2,3,4,5,6,7,8].map(n=>({id:fid(n),source:'call',title:'가상 '+n,summary:'',points:[],room:null,day:'2026-11-08'}));
  const items=rows.map((_,i)=>({n:i+1,kind:'note',org:'',line:'가상 줄 '+(i+1),why:'기억',from_me:false}));
  assert.equal(jm.parseMemorable(JSON.stringify({items}),rows,99).length,jm.MEMORABLE_MAX_PICKS);
  assert.match(jm.memorableMaterial('2026-11-08',rows,{max:99}),new RegExp(`고를 수 있는 수: 최대 ${jm.MEMORABLE_MAX_PICKS}개`));
});
