import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// JOURNAL-조직현황AI요약: the real ai-assist handler, kind=org_summary, with a synthetic Supabase (Auth + PostgREST with owner RLS,
// app_weekly_org_summaries) and a mocked OpenAI. No network, no real key, synthetic text only (가상 이름, 09xx ids).
// The screen sends only a week and organization ids; an edited summary is never sent to the AI and never overwritten.
const {createAiAssistHandler,DAILY_TOTAL_LIMIT}=await import('../../supabase/functions/ai-assist/handler.ts');
const os=await import('../../supabase/functions/ai-assist/org-summary.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG_A='d0000000-0000-4000-8000-000000000001',ORG_B='d0000000-0000-4000-8000-000000000002',ORG_C='d0000000-0000-4000-8000-000000000003',FOREIGN_ORG='d0000000-0000-4000-8000-000000000009';
const NOW=Date.parse('2026-10-22T03:00:00Z'),WEEK='2026-10-19',PREV='2026-10-12';
const TUE='2026-10-20T01:00:00Z',WED='2026-10-21T02:00:00Z',LAST_WEEK='2026-10-14T01:00:00Z';

const answer=items=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],usage:{input_tokens:5000,output_tokens:400}});
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const refOf=(o,name)=>JSON.parse(o.input[1].content).organizations.find(x=>x.name===name).ref;

function harness({openai=null,summaries=[],usage=[],missing=false,fail={},docs=[],briefs=[],profiles=[]}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_suborganizations:[{id:ORG_A,workspace_id:WS,name:'가 지부'},{id:ORG_B,workspace_id:WS,name:'나 지회'},{id:ORG_C,workspace_id:WS,name:'다 분회'},{id:FOREIGN_ORG,workspace_id:OTHER_WS,name:'남의 조직'}],
    app_suborganization_updates:[
      {id:id(1),organization_id:ORG_A,occurred_at:TUE,raw_text:'임금교섭 3차 실무교섭 진행\n수고하셨습니다',detail_text:null},
      {id:id(2),organization_id:ORG_A,occurred_at:LAST_WEEK,raw_text:'지난주 기록 OLD_WEEK_TEXT',detail_text:null},
      {id:id(3),organization_id:FOREIGN_ORG,occurred_at:TUE,raw_text:'FOREIGN_ORG_TEXT',detail_text:null},
    ],
    app_notes:[
      {id:id(10),workspace_id:WS,kind:'basket',raw_text:'안녕하세요 위원장님\n쟁의행위 찬반투표 10.24 예정\n연락처 010-1234-5678',occurred_at:WED,archived_at:null,ai_export_allowed:true,
        attachments:[{drive_file_id:'fileA1',file_name:'투표 공고문.hwp',mime_type:'application/x-hwp',size_bytes:10}]},
      {id:id(11),workspace_id:WS,kind:'basket',raw_text:'EXCLUDED_TEXT 내보내기 금지',occurred_at:WED,archived_at:null,ai_export_allowed:false,attachments:[]},
      {id:id(12),workspace_id:WS,kind:'basket',raw_text:'ARCHIVED_TEXT',occurred_at:WED,archived_at:WED,ai_export_allowed:true,attachments:[]},
      {id:id(13),workspace_id:WS,kind:'diary',raw_text:'SECRET_DIARY',occurred_at:WED,archived_at:null,ai_export_allowed:true,attachments:[]},
      {id:id(14),workspace_id:WS,kind:'basket',raw_text:'',occurred_at:TUE,archived_at:null,ai_export_allowed:true,
        attachments:[{drive_file_id:'fileB1',file_name:'나 지회 단협안.pdf',mime_type:'application/pdf',size_bytes:10}]},
    ],
    app_record_links:[
      {id:id(20),workspace_id:WS,note_id:id(10),organization_id:ORG_A,status:'confirmed',summary:'찬반투표 일정 공지.'},
      {id:id(21),workspace_id:WS,note_id:id(11),organization_id:ORG_A,status:'confirmed',summary:null},
      {id:id(22),workspace_id:WS,note_id:id(12),organization_id:ORG_A,status:'confirmed',summary:null},
      {id:id(23),workspace_id:WS,note_id:id(13),organization_id:ORG_A,status:'confirmed',summary:null},
      // REF-참고묶음: a reference-bundle link (no organization) is never organization material.
      {id:id(24),workspace_id:WS,note_id:id(10),organization_id:null,bundle_id:'e0000000-0000-4000-8000-000000000001',status:'confirmed',summary:'REF_BUNDLE_SUMMARY'},
    ],
    app_documents:[{id:id(30),workspace_id:WS,file_id:'fileB1',organization_id:ORG_B},...structuredClone(docs)],
    app_document_ai_index:structuredClone(briefs),
    app_ai_daily_usage:structuredClone(usage),
    app_weekly_org_summaries:structuredClone(summaries),
    app_profiles:structuredClone(profiles),
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER};
  const wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const orgWs=Object.fromEntries(db.app_suborganizations.map(o=>[o.id,o.workspace_id]));
  const visible=(table,row,uid)=>table==='app_suborganization_updates'?wsOwner[orgWs[row.organization_id]]===uid
    :table==='app_workspace_members'||table==='app_profiles'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(cell,op,val)=>{
    if(op==='eq')return String(cell)===val;
    if(op==='gte')return cell!=null&&String(cell)>=val; if(op==='lt')return cell!=null&&String(cell)<val; if(op==='lte')return cell!=null&&String(cell)<=val;
    if(op==='in')return val.slice(1,-1).split(',').map(v=>v.replace(/^"|"$/g,'')).includes(String(cell));
    if(op==='is')return val==='null'?cell==null:val==='true'?cell===true:cell===false;
    throw new Error('op '+op);
  };
  const instant=(k,v)=>/_at$/.test(k)&&typeof v==='string'&&v.includes('T')?new Date(v).toISOString():v;
  // PostgREST or=(and(col.op.val,…),and(…)) — only the shape the handler sends (values hold no commas or parentheses).
  const split=v=>{const out=[];let depth=0,cur='';for(const ch of v){if(ch==='(')depth++;if(ch===')')depth--;if(ch===','&&depth===0){out.push(cur);cur='';continue}cur+=ch}if(cur)out.push(cur);return out};
  const cond=(row,c)=>{const [k,op,...rest]=c.split('.');return cmp(instant(k,row[k]),op,instant(k,rest.join('.')))};
  const matchOr=(row,v)=>split(v.slice(1,-1)).some(g=>g.startsWith('and(')?split(g.slice(4,-1)).every(c=>cond(row,c)):cond(row,g));
  const matches=(row,url)=>{
    for(const [k,v] of url.searchParams){
      if(['select','limit','order','on_conflict'].includes(k))continue;
      if(k==='or'){if(!matchOr(row,v))return false;continue}
      const i=v.indexOf('.'),op=v.slice(0,i),val=v.slice(i+1);
      if(!cmp(instant(k,row[k]),op,instant(k,val)))return false;
    }
    return true;
  };
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){
      calls.openai.push(JSON.parse(init.body));
      if(openai)return openai(calls.openai.at(-1));
      const o=calls.openai.at(-1),orgs=JSON.parse(o.input[1].content).organizations;
      return respond(answer(orgs.map(x=>({org:x.ref,lines:[`- ${x.name} 요약 줄.`,'· 쟁의행위 찬반투표 10.24.(금) 예정.','쟁의행위 찬반투표 10.24.(금) 예정']}))));
    }
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(headers.get('apikey'),'synthetic-anon-key','anon key only, never a service key');
    const bearer=(headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user')return users[bearer]?respond({id:users[bearer]}):respond({msg:'bad'},401);
    const uid=users[bearer];assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body});
    if(missing&&table==='app_weekly_org_summaries')return respond({code:'PGRST205',message:'schema cache'},404);
    if(fail[table]&&(fail[table]===true||fail[table]===method))return respond({message:'synthetic db detail'},500);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)).slice(0,Number(url.searchParams.get('limit')||1e9)));
    if(method==='POST'){
      const body=JSON.parse(init.body),list=Array.isArray(body)?body:[body],out=[];
      for(const b of list){
        if(!visible(table,b,uid))return respond({message:'rls'},403);
        if(table==='app_ai_daily_usage'){const i=rows.findIndex(r=>r.workspace_id===b.workspace_id&&r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);continue;}
        if(table==='app_weekly_org_summaries'){
          assert.deepEqual(Object.keys(b).sort(),['edited','generated_at','organization_id','summary','updated_at','week_start','workspace_id']);
          assert.equal(b.edited,false,'the AI never writes an edited summary');
          if(rows.some(r=>r.workspace_id===b.workspace_id&&r.week_start===b.week_start&&r.organization_id===b.organization_id))continue;
          const row={id:id(900+rows.length),...b};rows.push(row);out.push({id:row.id});continue;
        }
        throw new Error('unexpected insert '+table);
      }
      return respond(out,201);
    }
    if(method==='PATCH'){
      assert.equal(table,'app_weekly_org_summaries');
      assert.match(url.search,/edited=is\.false/,'every AI update is limited to unedited rows');
      const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body).sort(),['generated_at','summary','updated_at']);
      const hit=rows.filter(r=>visible(table,r,uid)&&matches(r,url));
      for(const r of hit)Object.assign(r,body);
      return respond(hit.map(r=>({id:r.id})));
    }
    throw new Error('method '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)}));
const run=(ids=[ORG_A,ORG_B,ORG_C])=>({kind:'org_summary',week_start:WEEK,organization_ids:ids});
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);return b;};

test('source: no service role, no tools, logs carry numbers only',()=>{
  const all=readFileSync('supabase/functions/ai-assist/handler.ts','utf8')+readFileSync('supabase/functions/ai-assist/org-summary.ts','utf8');
  assert.doesNotMatch(all,/SUPABASE_SERVICE_ROLE_KEY|service_role/);
  assert.doesNotMatch(all,/tools\s*:/);
  assert.doesNotMatch(all,/(?<!WEB2_)OPENAI_API_KEY"/);
  const logs=[...all.matchAll(/log\("([a-z_]+)"(?:,\s*(\{[^}]*\}))?\)/g)];
  for(const [,code,detail] of logs)if(detail)assert.doesNotMatch(detail,/summary|text|material|title|raw|name/,code);
});

// WEEKLY-자료요약 2단계: the week's documents linked to the organization add their checked one- or two-line summary as material.
test('WEEKLY-메뉴짝짓기 P7: org_summary 쓰임은 지웠다 — 400 unsupported_kind, OpenAI·표 읽기 없음(저장된 요약 표는 보존)',async()=>{
  for(const body of [run(),{kind:'org_summary',week_start:WEEK}]){
    const {handler,calls,db}=harness();
    await expectError(await post(handler,body),400,'unsupported_kind');
    assert.equal(calls.openai.length,0);
    assert.equal(db.app_weekly_org_summaries.length,0);
  }
  const src=readFileSync('supabase/functions/ai-assist/handler.ts','utf8');
  assert.doesNotMatch(src,/runOrgSummary|app_weekly_org_summaries/);
});
