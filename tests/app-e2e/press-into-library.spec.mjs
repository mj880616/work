// PRESS-자료실편입 2단계(docs/design/press-into-library.md §3.2·§6): 자료실 .html 칸막이 보기 + 1회용 [옛 성명·보도자료 가져오기].
// Synthetic server only (no real Supabase, Drive, GitHub or OpenAI). The list is the repository's own press/archive.json (same site);
// bodies and attachments come from mocked GitHub raw answering with the repository files. 390 and 1280 wide.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { revealLibraryRow } from './helpers/library-tree.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const RAW='https://raw.githubusercontent.com/mj880616/work/main/';
const now=()=>new Date().toISOString();
const eq=(url,key)=>String(url.searchParams.get(key)||'').replace(/^eq\./,'');
const DOC=n=>`e1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const repoFile=path=>readFileSync(new URL(`../../${path}`,import.meta.url));
const WITH_PRESS=['교섭','투쟁','교육','선전','정책','회의','성명·보도자료','공문','기타'];
const HTML='<!doctype html><html><head><title>t</title></head><body><h1 id="press-h">합성 성명 본문</h1></body></html>';

function doc(n,over={}){
  return {id:DOC(n),workspace_id:'workspace-1',project_id:null,organization_id:null,meeting_id:null,title:'옛 성명 '+n,category:'성명·보도자료',source:'민주노총 공공운수노조',document_date:'2025-01-22',
    description:null,tags:['성명'],file_id:'driveHtml'+n,file_name:`2025-01-2${n}-sample.html`,mime_type:'text/html',file_size:4096,drive_url:'https://drive.google.com/file/d/driveHtml'+n+'/view',
    created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T00:00:00Z',field_origin:{title:'user',category:'user',source:'user',document_date:'user'},classification_note:null,
    extracted_text:null,extraction_status:'ready',previous_files:[],reclassify_needed:false,...over};
}
function baseState({docs,role='owner',categories=WITH_PRESS,htmlMode='ok'}={}){
  return {user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'자료실 관리자'}},workspace:{id:'workspace-1',slug:'team',name:'웹2'},
    role,categories,htmlMode,docs:docs||[doc(1)],uploads:[],patches:[],htmlCalls:[],ai:[],raw:[]};
}
async function mockApp(page,state){
  await page.route(`${RAW}**`,route=>{
    const path=decodeURIComponent(new URL(route.request().url()).pathname.replace('/mj880616/work/main/',''));
    state.raw.push(path);
    try{return route.fulfill({status:200,body:repoFile(path)})}catch{return route.fulfill({status:404,body:'no'})}
  });
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
      const type=raw.match(/filename="[^"]*"\r\nContent-Type: ([^\r]*)/)?.[1]||'';
      const fields={title:field('title'),category:field('category'),source:field('source'),document_date:field('document_date'),tags:field('tags')};
      state.uploads.push({fileName,type,fields,styled:raw.includes('<style>')&&!raw.includes('press-archive.css'),logo:raw.includes('data:image/svg+xml,')});
      const d=doc(100+state.uploads.length,{title:fields.title,category:fields.category,source:fields.source,document_date:fields.document_date,tags:(fields.tags||'').split(',').filter(Boolean),
        file_id:'up'+state.uploads.length,file_name:fileName,mime_type:type,field_origin:{},created_at:now()});
      state.docs.push(d);
      return ok({ok:true,document:d});
    }
    if(path==='/functions/v1/document-actions'){
      if(body?.action==='html-view'){
        state.htmlCalls.push(body);
        if(state.htmlMode==='old')return ok({error:'바구니 메모의 첨부만 화면으로 볼 수 있습니다.',code:'INVALID_REQUEST'},400);
        return ok({ok:true,file_name:'x.html',size:HTML.length,html:HTML});
      }
      return ok({ok:true,status:'ready',reason:'ok'});
    }
    if(path==='/functions/v1/ai-assist'){state.ai.push(body);return ok({ok:true,updated:0})}
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',user_id:state.user.id,role:state.role,workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'자료실 관리자',document_categories:state.categories}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_meetings')return ok([]);
    if(path==='/rest/v1/app_library_classify_attempts')return ok([]);
    if(path==='/rest/v1/app_documents'){
      const id=eq(url,'id');
      if(method==='GET')return ok(state.docs.filter(x=>(!id||x.id===id)&&(!url.searchParams.has('or')||!['ready','error'].includes(x.extraction_status))));
      if(method==='PATCH'){
        state.patches.push({id,body});
        state.docs.filter(row=>row.id===id).forEach(row=>Object.assign(row,body||{}));
        return ok([]);
      }
    }
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}
async function boot(page,{width=390,...opts}={}){
  await page.setViewportSize({width,height:900});
  const state=baseState(opts);await mockApp(page,state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('[data-lu-document]')).toHaveCount(state.docs.length);
  return state;
}

for(const width of [390,1280]){
  test(`a library .html opens inside the sandboxed frame, not as a download (${width})`,async({page})=>{
    const state=await boot(page,{width});
    const row=await revealLibraryRow(page,DOC(1));
    const downloads=[];page.on('download',d=>downloads.push(d));
    await row.click();
    const modal=page.locator('#libraryHtmlModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#libraryHtmlTitle')).toHaveText('옛 성명 1');
    const frame=modal.locator('iframe.html-frame-view');
    await expect(frame).toHaveAttribute('sandbox','allow-scripts');
    await expect(page.frameLocator('#libraryHtmlModal iframe.html-frame-view').locator('#press-h')).toHaveText('합성 성명 본문');
    expect(state.htmlCalls).toEqual([{action:'html-view',document_id:DOC(1)}]);
    // The title is not drawn twice; only [크게 보기] sits on the frame bar.
    await expect(modal.locator('.html-frame-title')).toHaveCount(0);
    const big=modal.locator('.html-frame-bar button',{hasText:'크게 보기'});
    expect((await big.boundingBox()).height).toBeLessThanOrEqual(29);
    await expect(modal.locator('.html-frame-bar button',{hasText:'다시 보기'})).toBeHidden();
    await expect(modal.locator('#libraryHtmlDrive')).toBeHidden();
    // Compact: no horizontal overflow; close returns to the list.
    expect(await modal.locator('.modal-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(modal.locator('iframe')).toHaveCount(0);
    expect(downloads).toEqual([]);
  });
}

test('before the server PR is deployed, the refusal becomes the Drive notice with a small [Drive에서 열기]',async({page,context})=>{
  const state=await boot(page,{htmlMode:'old'});
  await (await revealLibraryRow(page,DOC(1))).click();
  const modal=page.locator('#libraryHtmlModal');
  await expect(modal.locator('#libraryHtmlStatus')).toHaveText('HTML 보기 서버가 아직 준비되지 않았어요. [Drive에서 열기]로 확인해 주세요.');
  const drive=modal.locator('#libraryHtmlDrive');
  await expect(drive).toBeVisible();
  expect((await drive.boundingBox()).height).toBeLessThanOrEqual(33);
  await expect(modal.locator('iframe')).toHaveCount(0);
  expect(state.htmlCalls.length).toBe(1);
  const opened=[];
  await context.route('https://drive.google.com/**',r=>{opened.push(r.request().url());return r.fulfill({status:200,contentType:'text/html',body:'drive'})});
  await drive.click();
  await expect.poll(()=>opened).toEqual(['https://drive.google.com/file/d/driveHtml1/view']);
});

test('import refuses to start when 성명·보도자료 is not in my kind list',async({page})=>{
  const state=await boot(page,{categories:['교섭','투쟁','교육','선전','정책','회의','기타']});
  const button=page.locator('#libraryPressImport');
  await expect(button).toHaveText('옛 성명·보도자료 가져오기');
  await button.click();
  await expect(page.locator('#libraryPressImportStatus')).toContainText("종류 목록에 '성명·보도자료'가 없어 시작하지 않았어요");
  expect(state.uploads).toEqual([]);expect(state.raw).toEqual([]);
});

test('the import button is shown only to the owner',async({page})=>{
  await boot(page,{role:'editor'});
  await expect(page.locator('#libraryListCard .lu-select-row')).toBeVisible();
  await expect(page.locator('#libraryPressImport')).toHaveCount(0);
});

for(const width of [344,1280]){
  test(`import: 48 rows through library-files with mapped fields and converted pages, then a second press skips them all (${width})`,async({page})=>{
    test.setTimeout(120000);
    const state=await boot(page,{width,docs:[doc(1,{file_name:'2025-01-22-subway-fare.html'})]});
    const button=page.locator('#libraryPressImport');
    // Small text button (UI-버튼기준) on the [선택] row; nothing overflows on the phone.
    expect((await button.boundingBox()).height).toBeLessThanOrEqual(29);
    expect(await page.locator('#libraryListCard').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await button.click();
    const status=page.locator('#libraryPressImportStatus');
    await expect(status).toHaveText('가져옴 47 · 건너뜀 1 · 실패 0 (전체 48)',{timeout:90000});
    expect(state.uploads.length).toBe(47);
    expect(state.uploads.some(u=>u.fileName==='2025-01-22-subway-fare.html')).toBe(false);
    const page1=state.uploads.find(u=>u.fileName==='2026-09-14-workforce.html');
    expect(page1.fields).toEqual({title:'청년일자리 늘린다더니… ‘인력 필요하면 기존 인력부터 2% 감축’',category:'성명·보도자료',source:'이재명 정부 공공기관 인력 감축 방침 규탄 기자회견',document_date:'2026-09-11',tags:'취재요청'});
    expect(page1.type).toBe('text/html');
    expect(page1.styled).toBe(true);expect(page1.logo).toBe(true);
    const att=state.uploads.find(u=>u.fileName.endsWith('.pdf'));
    expect(att.type).toBe('application/pdf');
    expect(att.fields.category).toBe('성명·보도자료');
    // Locked as the person's (4 fields), never through AI; links untouched.
    expect(state.patches.length).toBe(47);
    for(const p of state.patches)expect(p.body.field_origin).toEqual({title:'user',source:'user',category:'user',document_date:'user'});
    expect(state.ai.filter(a=>a?.mode==='fill')).toEqual([]);
    // The list was read again and shows the new rows (a long group shows its first 20 then [더 보기]).
    expect(state.docs.length).toBe(48);
    await expect(page.locator('[data-lu-document]')).not.toHaveCount(1);
    // Second press: everything is already there.
    await button.click();
    await expect(status).toHaveText('가져옴 0 · 건너뜀 48 · 실패 0 (전체 48)');
    expect(state.uploads.length).toBe(47);
  });
}
