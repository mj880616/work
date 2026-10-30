// LIB-화면끌어놓기 (2026-10-26): on PC, files dropped anywhere on the library screen upload at once, like [+ 자료 등록] with nothing set
// (same library-files request, title left to the file name, AI fill with keep=[]). Mock server only: no real Supabase, Drive or OpenAI.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const eq=(url,key)=>String(url.searchParams.get(key)||'').replace(/^eq\./,'');
const DOC_ID=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const AI={title:'2026년 임금교섭 요구안',document_date:'2026-10-20',source:'공공운수노조',category:'교섭'};

function baseState(){
  return {
    user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'자료실 관리자'}},
    workspace:{id:'workspace-1',slug:'team',name:'웹2'},
    docs:[{id:DOC_ID(90),workspace_id:'workspace-1',project_id:null,title:'기존 자료',category:'정책',source:'기존 출처',document_date:'2026-09-01',
      // Links marked as the person's (LIB-AI분류보완: an old document with an empty link would otherwise go to the background sweep).
      file_name:'old.pdf',tags:[],created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',field_origin:{project_id:'user',organization_id:'user'}}],
    uploads:[],patches:[],texts:[],fills:[],aiMode:'ok',
  };
}

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/library-files'){
      const raw=(req.postDataBuffer()||Buffer.from('')).toString('utf8');
      const field=name=>raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1]??null;
      const fileName=raw.match(/filename="([^"]*)"/)?.[1]||'file';
      state.forms=(state.forms||[]);state.forms.push([...raw.matchAll(/name="([a-z_]+)"/g)].map(m=>m[1]));
      const row={id:DOC_ID(state.uploads.length+1),workspace_id:'workspace-1',project_id:null,title:field('title')||fileName.replace(/\.[^.]+$/,''),
        category:field('category')||'기타',source:field('source'),document_date:field('document_date'),file_name:fileName,tags:[],created_at:now(),updated_at:now(),field_origin:{}};
      state.uploads.push(row);state.docs.push(row);
      return ok({ok:true,document:row});
    }
    if(path==='/functions/v1/document-actions'){state.texts.push(body);const d=state.docs.find(x=>x.id===body?.document_id);if(d)d.extraction_status='ready';return ok({ok:true,status:'ready',reason:'ok'})}
    if(path==='/functions/v1/ai-assist'){
      state.fills.push(body);
      if(state.aiMode==='fail')return ok({ok:false,error:'ai_busy',message:'x'},503);
      if(state.aiMode==='hold'){state.release=()=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,kind:'library_fill',mode:'fill',updated:0,skipped:1})});return}
      const doc=state.docs.find(d=>d.id===body.document_ids[0]);
      let updated=0;
      if(doc){
        const origin={...doc.field_origin};
        for(const f of body.keep)if(origin[f]!=='user')origin[f]='user';
        for(const [f,v] of Object.entries(AI)){if(origin[f]==='user'||body.keep.includes(f))continue;doc[f]=v;origin[f]='ai';updated=1}
        doc.field_origin=origin;doc.updated_at=now();
      }
      return ok({ok:true,kind:'library_fill',mode:'fill',updated,skipped:1-updated});
    }
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',user_id:state.user.id,role:'owner',workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'자료실 관리자',document_categories:['교섭','투쟁','교육','선전','정책','회의','기타']}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_meetings')return ok([]);
    if(path==='/rest/v1/app_documents'){
      const id=eq(url,'id');
      if(method==='GET')return ok(state.docs.filter(x=>(!id||x.id===id)&&(!url.searchParams.has('or')||!['ready','error'].includes(x.extraction_status))));
      if(method==='PATCH'){
        state.patches.push({id,body});
        const rows=state.docs.filter(row=>row.id===id);rows.forEach(row=>Object.assign(row,body||{}));
        return ok(rows);
      }
    }
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function boot(page,{width=390}={}){
  await page.setViewportSize({width,height:900});
  const state=baseState();await mockApp(page,state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('[data-lu-document]')).toHaveCount(1);
  return state;
}

// A real file drag: dispatch the drag events with a DataTransfer that carries files.
async function dragFiles(page,type,names,selector='#libraryView'){
  await page.evaluate(({type,names,selector})=>{
    const dt=new DataTransfer();
    for(const name of names)dt.items.add(new File(['PK synthetic'],name,{type:'application/octet-stream'}));
    const target=document.querySelector(selector)||document.body;
    target.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));
  },{type,names,selector});
}

test('PC: files dropped on the library screen upload at once with nothing set, and the list shows one result line',async({page})=>{
  const state=await boot(page,{width:1440});
  const overlay=page.locator('#libraryDropOverlay');
  await expect(overlay).toBeHidden();
  await dragFiles(page,'dragenter',['251020_요구안.hwpx'],'#documentSearch');
  await dragFiles(page,'dragover',['251020_요구안.hwpx'],'#documentSearch');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveText('놓으면 바로 올려요');
  await dragFiles(page,'drop',['a-요구안.hwpx','b-보도자료.pdf'],'#documentList');
  await expect(overlay).toBeHidden();
  await expect(page.locator('#libraryDropStatus')).toHaveText('2개 올렸어요');
  expect(state.uploads.map(u=>u.file_name)).toEqual(['a-요구안.hwpx','b-보도자료.pdf']);
  // Same request as an empty [+ 자료 등록]: only the file, no title / category / project fields.
  for(const names of state.forms)expect(names).toEqual(['file']);
  // The same AI fill follows. Nothing was typed; the meaningful file names keep their own titles (LIB-파일이름그대로).
  await expect.poll(()=>state.fills.length).toBe(2);
  for(const fill of state.fills)expect(fill.keep).toEqual(['title']);
  await expect(page.locator('#documentModal')).toBeHidden();
  expect(await page.locator('#libraryView').innerText()).not.toMatch(/AI|자동 ?채움|✨/);
});

test('PC: a drag that is not a file does nothing, and an open register dialog keeps its own drop area',async({page})=>{
  const state=await boot(page,{width:1440});
  await page.evaluate(()=>{const dt=new DataTransfer();dt.setData('text/plain','x');document.querySelector('#libraryView').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}))});
  await expect(page.locator('#libraryDropOverlay')).toBeHidden();
  await page.locator('#newDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeVisible();
  await dragFiles(page,'dragover',['x.pdf'],'body');
  await expect(page.locator('#libraryDropOverlay')).toBeHidden();
  await dragFiles(page,'drop',['x.pdf'],'body');
  expect(state.uploads).toHaveLength(0);
});

test('phone width: dropping does not upload (unchanged)',async({page})=>{
  const state=await boot(page,{width:390});
  await dragFiles(page,'dragover',['x.pdf'],'#documentList');
  await expect(page.locator('#libraryDropOverlay')).toBeHidden();
  await dragFiles(page,'drop',['x.pdf'],'#documentList');
  expect(state.uploads).toHaveLength(0);
});
