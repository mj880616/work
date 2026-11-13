import test from 'node:test';
import {withAiMonth} from './helpers/ai-month-fake.mjs';
import assert from 'node:assert/strict';

// LIB-받는폴더나누기(S60-18): the real ai-assist handler, kind=library_sort, with a synthetic Supabase (Auth + PostgREST with owner RLS)
// and a mocked OpenAI. No network, no real key, synthetic text only.
// - The screen sends only document ids. The server reads documents, folders and folder links with the caller's token, inside the caller's workspace.
// - Another workspace's folders and documents never reach the AI or the answer. The folder the documents are in now (the receive folder) is not offered.
// - Nothing is written except the usage row (no folder, no link).
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const ls=await import('../../supabase/functions/ai-assist/library-sort.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NOW=Date.parse('2026-11-12T03:00:00Z');
const RC=id(1),GYO=id(2),HOE=id(3),FOREIGN=id(9),D1=id(101),D2=id(102),D3=id(103),FOREIGN_DOC=id(109);
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const aiText=obj=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(obj)}]}],usage:{input_tokens:900,output_tokens:60}});

function harness({openai=null,folders=null}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_documents:[
      {id:D1,workspace_id:WS,title:'가상 임금협약 잠정합의서',file_name:'a.hwp',category:'교섭',extracted_text:'가상 본문 연락 010-1234-5678',extraction_status:'ready'},
      {id:D2,workspace_id:WS,title:'',file_name:'가상 쟁대위 회의록.pdf',category:null,extracted_text:null,extraction_status:'pending'},
      {id:D3,workspace_id:WS,title:'가상 산별전환 토론회 발제문',file_name:'c.pdf',category:null,extracted_text:'',extraction_status:'ready'},
      {id:FOREIGN_DOC,workspace_id:OTHER_WS,title:'남의 자료',file_name:'x.pdf',category:null,extracted_text:'남의 본문',extraction_status:'ready'},
    ],
    app_library_folders:folders||[
      {id:RC,workspace_id:WS,parent_id:null,name:'잡동사니',sort_order:1,created_at:'2026-11-01'},
      {id:GYO,workspace_id:WS,parent_id:null,name:'교섭',sort_order:2,created_at:'2026-11-01'},
      {id:HOE,workspace_id:WS,parent_id:GYO,name:'회의',sort_order:3,created_at:'2026-11-01'},
      {id:FOREIGN,workspace_id:OTHER_WS,parent_id:null,name:'남의 폴더',sort_order:1,created_at:'2026-11-01'},
    ],
    app_library_folder_items:[{document_id:D1,folder_id:RC,workspace_id:WS},{document_id:D2,folder_id:RC,workspace_id:WS},{document_id:D3,folder_id:RC,workspace_id:WS},{document_id:FOREIGN_DOC,folder_id:FOREIGN,workspace_id:OTHER_WS}],
    app_ai_daily_usage:[],
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER},wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(v,op,val)=>op==='eq'?String(v)===val:op==='gte'?v!=null&&String(v)>=val:op==='lt'?v!=null&&String(v)<val
    :op==='is'?(val==='null'?v==null:String(v)===val):op==='in'?val.replace(/^\(|\)$/g,'').split(',').includes(String(v)):(()=>{throw new Error('op '+op)})();
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return respond(openai?openai(calls.openai.at(-1)):aiText({items:[]}));}
    assert.equal(url.origin,SB,'unexpected outbound host');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search)});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler(withAiMonth({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})}));
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const sentOf=h=>JSON.parse(h.calls.openai[0].input[1].content);

test('library_sort: own folders only, the current folder is not offered, refs map back to real ids, nothing but usage is written',async()=>{
  const h=harness({openai:()=>aiText({items:[
    {ref:'d1',folder:'f1',new_name:'',new_parent:'',why:'교섭 자료'},
    {ref:'d2',folder:'',new_name:'',new_parent:'',why:''},
    {ref:'d3',folder:'',new_name:'산별전환',new_parent:'f1',why:'새 주제'},
    {ref:'d9',folder:'f1',new_name:'',new_parent:'',why:'없는 번호'},
  ]})});
  const r=await post(h.handler,{kind:'library_sort',document_ids:[D1,D2,D3]});
  assert.equal(r.status,200);
  const body=await r.json();
  const sent=sentOf(h);
  assert.deepEqual(sent.folders,[{ref:'f1',path:'교섭'},{ref:'f2',path:'교섭 › 회의'}],'receive folder and the other workspace folder are not sent');
  assert.equal(sent.documents.length,3);
  assert.equal(sent.documents[1].title,'가상 쟁대위 회의록.pdf','file name when the title is empty');
  assert.match(sent.documents[0].text,/\[전화\]/);
  const raw=JSON.stringify(h.calls.openai);
  for(const s of [RC,GYO,HOE,D1,'남의','010-1234'])assert.equal(raw.includes(s),false,s);
  assert.deepEqual(body.items,[
    {id:D1,folder_id:GYO,new:null,why:'교섭 자료'},
    {id:D3,folder_id:null,new:{name:'산별전환',parent_id:GYO},why:'새 주제'},
  ]);
  assert.deepEqual(h.calls.rest.filter(c=>c.method!=='GET').map(c=>c.table),['app_ai_daily_usage','app_ai_daily_usage']);
  assert.equal(h.db.app_ai_daily_usage[0].requests,1);
  assert.equal(DAILY_LIMITS.library_sort,30);
});

test('library_sort: another workspace document id is not read (404, no AI), a stranger never sees my folders',async()=>{
  const h=harness();
  const r=await post(h.handler,{kind:'library_sort',document_ids:[FOREIGN_DOC]});
  assert.equal(r.status,404);
  assert.equal(h.calls.openai.length,0);
  const s=harness();
  const r2=await post(s.handler,{kind:'library_sort',document_ids:[FOREIGN_DOC]},'stranger-token');
  assert.equal(r2.status,200);
  assert.equal((await r2.json()).skipped,'no_folders','the stranger has only the folder the document is in, which is excluded; my folders are not visible');
  assert.equal(s.calls.openai.length,0);
});

test('library_sort: no candidate folder → no AI call, no usage',async()=>{
  const h=harness({folders:[{id:RC,workspace_id:WS,parent_id:null,name:'잡동사니',sort_order:1,created_at:'2026-11-01'}]});
  const r=await post(h.handler,{kind:'library_sort',document_ids:[D1]});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,kind:'library_sort',items:[],skipped:'no_folders'});
  assert.equal(h.calls.openai.length,0);
  assert.equal(h.db.app_ai_daily_usage.length,0);
});

test('library_sort: request shape — ids only, 1..40, no duplicates, no extra keys (folder ids from the screen are refused)',async()=>{
  for(const body of [{kind:'library_sort',document_ids:[]},{kind:'library_sort',document_ids:Array.from({length:41},(_,i)=>id(500+i))},
    {kind:'library_sort',document_ids:[D1,D1]},{kind:'library_sort',document_ids:['x']},{kind:'library_sort',document_ids:[D1],folders:[RC]}]){
    const h=harness();const r=await post(h.handler,body);
    assert.equal(r.status,400,JSON.stringify(body).slice(0,60));
    assert.equal(h.calls.openai.length,0);
  }
});

test('library_sort answer check: bad names and unknown parent refs are dropped',()=>{
  const fref=new Map([['f1',GYO]]),dref=new Map([['d1',D1],['d2',D2],['d3',D3]]);
  const out=ls.parseLibrarySort(JSON.stringify({items:[
    {ref:'d1',folder:'',new_name:'x'.repeat(41),new_parent:'',why:''},
    {ref:'d2',folder:'',new_name:'새 폴더',new_parent:'f7',why:''},
    {ref:'d3',folder:'',new_name:'<b>나쁨</b>',new_parent:'',why:''},
  ]}),fref,dref);
  assert.deepEqual(out,[]);
  assert.equal(ls.parseLibrarySort('not json',fref,dref),null);
});
