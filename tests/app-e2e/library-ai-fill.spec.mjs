// LIB-AI자동분류 (docs/design/library-ai-fill.md): after an upload, the screen asks the server to read the file text and fill
// the empty fields, with no button and no AI marker anywhere. The mock server applies the same rules as ai-assist
// (keep fields stay, 'user' fields stay) so the browser flow is checked end to end. No real Supabase, Drive or OpenAI.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
// LIB-토글트리: 자료실 줄은 토글 안에 있어, 누르기 전에 그 자료가 든 토글을 연다.
import {revealLibraryRow} from './helpers/library-tree.mjs';
// LIB-파일이름그대로: 가짜 library-files도 서버와 같은 공용 규칙으로 제목·날짜를 정한다(뜻 있는 이름 = 그 이름, 이름의 날짜 = 자료 날짜).
import {fileNameTitle,fileNameDate,isMeaninglessName} from '../../app/library-file-name.mjs';

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
      const row={id:DOC_ID(state.uploads.length+1),workspace_id:'workspace-1',project_id:null,title:field('title')||(isMeaninglessName(fileName)?fileName.replace(/\.[^.]+$/,''):fileNameTitle(fileName)),
        category:field('category')||'기타',source:field('source'),document_date:field('document_date')||fileNameDate(fileName),file_name:fileName,tags:[],created_at:now(),updated_at:now(),field_origin:{}};
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
async function upload(page,{name='scan_251020.hwpx',title='',source=''}={}){
  await page.locator('#newDocumentBtn').click();
  await expect(page.locator('#libraryFileInput')).toBeAttached();
  await page.locator('#libraryFileInput').setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from('PK synthetic')});
  if(title)await page.locator('#docTitle').fill(title);
  if(source)await page.locator('#docSource').fill(source);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
}
// No AI marker anywhere on the library list, rows, menu or edit dialog (사용자 결정 ③).
async function expectNoAiMarker(page){
  const text=await page.locator('#libraryView').innerText();
  expect(text).not.toMatch(/AI|자동 ?채움|자동분류됨|✨/);
  expect(await page.locator('#libraryView [data-ai], #libraryView [data-field-origin], #libraryEditModal [data-ai]').count()).toBe(0);
}

for(const width of [390,1440]){
  test(`upload fills empty fields with no button and no AI marker, keeping typed fields (${width})`,async({page})=>{
    const state=await boot(page,{width});
    await upload(page,{source:'내가 쓴 출처'});
    // Text is read first, then one fill request: the typed source is sent as keep, and so is the date in the file name
    // (scan_251020 → 2025-10-20, LIB-파일이름그대로). The name itself means nothing, so the title is left to the AI.
    await expect.poll(()=>state.fills.length).toBe(1);
    expect(state.texts).toEqual([{action:'document-text',document_id:DOC_ID(1)}]);
    expect(state.fills[0]).toEqual({kind:'library_fill',mode:'fill',document_ids:[DOC_ID(1)],keep:['document_date','source']});
    // The list refreshes by itself and shows the filled title; nothing marks it as AI.
    await expect(page.locator('.lu-row-title',{hasText:AI.title})).toHaveCount(1);
    const doc=state.docs.find(d=>d.id===DOC_ID(1));
    expect([doc.source,doc.category,doc.document_date]).toEqual(['내가 쓴 출처','교섭','2025-10-20']);
    await expectNoAiMarker(page);
    // The edit dialog shows plain values only.
    await revealLibraryRow(page,DOC_ID(1));await page.locator(`[data-lu-document="${DOC_ID(1)}"] .lu-more-trigger`).click();await page.locator('[data-lu-edit]').click();
    await expect(page.locator('#libraryEditModal')).toBeVisible();
    await expect(page.locator('#libraryEditTitle')).toHaveValue(AI.title);
    expect(await page.locator('#libraryEditModal').innerText()).not.toMatch(/AI|자동 ?채움/);
  });
}

test('a field the person corrects is recorded as user and never overwritten by a later fill',async({page})=>{
  const state=await boot(page);
  await upload(page);
  await expect(page.locator('.lu-row-title',{hasText:AI.title})).toHaveCount(1);
  await revealLibraryRow(page,DOC_ID(1));await page.locator(`[data-lu-document="${DOC_ID(1)}"] .lu-more-trigger`).click();await page.locator('[data-lu-edit]').click();
  await page.locator('#libraryEditTitle').fill('내가 고친 제목');await page.locator('#libraryEditSave').click();
  await expect(page.locator('#libraryEditModal')).toBeHidden();
  const patch=state.patches.at(-1).body;
  expect(patch.title).toBe('내가 고친 제목');
  // Only the corrected field moves to user; the other AI records stay (hidden, never rendered).
  expect(patch.field_origin).toEqual({title:'user',source:'ai',category:'ai',document_date:'user'});
  // A later fill of the same document (e.g. a repeated request) keeps the corrected title.
  await page.evaluate(async id=>{const m=await import('/app/library-ai-fill.js');await m.fillLibraryDocument(id)},DOC_ID(1));
  await expect.poll(()=>state.fills.length).toBe(2);
  expect(state.docs.find(d=>d.id===DOC_ID(1)).title).toBe('내가 고친 제목');
  await expect(page.locator('.lu-row-title',{hasText:'내가 고친 제목'})).toHaveCount(1);
  await expectNoAiMarker(page);
});

// LIB-파일이름그대로(2026-10-30 사용자 결정 A): 뜻 있는 파일 이름이면 올린 뒤 AI 자동 정리가 제목·날짜를 덮지 않는다(분류·작성 주체만 채움).
// 뜻 없는 이름(KakaoTalk_…)은 AI 제목을 그대로 받는다.
for(const width of [390,1440]){
  test(`a meaningful file name stays the title and its date stays the date after the AI fill (${width})`,async({page})=>{
    const state=await boot(page,{width});
    await upload(page,{name:'주간보고_20261102_홍길동.hwpx'});
    await expect.poll(()=>state.fills.length).toBe(1);
    expect(state.fills[0].keep).toEqual(['title','document_date']);
    const doc=state.docs.find(d=>d.id===DOC_ID(1));
    await expect.poll(()=>doc.category).toBe('교섭');
    expect([doc.title,doc.document_date,doc.source]).toEqual(['주간보고 20261102 홍길동','2026-11-02','공공운수노조']);
    await expect(page.locator('.lu-row-title',{hasText:'주간보고 20261102 홍길동'})).toHaveCount(1);
    await expect(page.locator('.lu-row-title',{hasText:AI.title})).toHaveCount(0);
  });
}

test('a meaningless file name (KakaoTalk_…) still takes the AI title, but keeps the date in its name',async({page})=>{
  const state=await boot(page);
  await upload(page,{name:'KakaoTalk_20261030_1.jpg'});
  await expect.poll(()=>state.fills.length).toBe(1);
  expect(state.fills[0].keep).toEqual(['document_date']);
  await expect(page.locator('.lu-row-title',{hasText:AI.title})).toHaveCount(1);
  expect(state.docs.find(d=>d.id===DOC_ID(1)).document_date).toBe('2026-10-30');
});

test('AI failure leaves the upload as it was: success message, row present, no error shown',async({page})=>{
  const state=await boot(page);state.aiMode='fail';
  await upload(page,{name:'회의 사진.jpg'});
  await expect.poll(()=>state.fills.length).toBe(1);
  await expect(page.locator('.lu-row-title',{hasText:'회의 사진'})).toHaveCount(1);
  await expect(page.locator('#documentStatus')).toContainText('등록 완료');
  expect(await page.locator('[role="alert"]:visible').count()).toBe(0);
  await expectNoAiMarker(page);
});

test('the upload finishes without waiting for the AI answer',async({page})=>{
  const state=await boot(page);state.aiMode='hold';
  await upload(page);
  await expect.poll(()=>state.fills.length).toBe(1);
  // The modal closed and the row is listed while the AI request is still open.
  await expect(page.locator(`[data-lu-document="${DOC_ID(1)}"]`)).toHaveCount(1);
  await expect(page.locator('#saveDocumentBtn')).toBeEnabled();
  state.release();
});
