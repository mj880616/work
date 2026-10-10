import {test,expect,devices} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const {defaultBrowserType,...phone}=devices['Pixel 7'];

// No route interception: count complete native HTTP requests at the mock API.
const before=execFileSync('git',['show','669c6087:app/library-upload.js'],{encoding:'utf8'});
let api,assets,origin,apiOrigin,mode,requests,documents,pending;
const user={id:'upload-owner',user_metadata:{display_name:'모의 소유자'}};
const project={id:'upload-project',workspace_id:'upload-workspace',owner_id:user.id,name:'모의 프로젝트',status:'active',visibility:'private',metadata:{project_system:'v2',management_version:2}};
const fixture=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/styles.css"><body>
<section id="libraryView"><input id="documentSearch"><select id="documentProject"></select><div id="documentList"></div></section>
<div id="documentModal"><div class="modal-card"><label>자료명<input id="docTitle"></label><input id="docCategory"><input id="docSource"><input id="docDate"><input id="docTags"><select id="docProject"></select><textarea id="docDescription"></textarea><button id="saveDocumentBtn" type="button">저장</button><div id="documentStatus"></div></div></div>
<script src="/app/runtime-client.js"></script>
<script>KPTURuntime.session.write({access_token:'mock-access',refresh_token:'mock-refresh',expires_at:9999999999,user:{id:'upload-owner'}});</script>
<script src="/app/project-catalog.js"></script><script src="/app/library-upload.js?BASELINE"></script></body></html>`;

test.beforeAll(async()=>{
 api=createServer(async(req,res)=>{
  const path=new URL(req.url,apiOrigin).pathname;
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','authorization, x-client-info, apikey, content-type');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  if(req.method==='OPTIONS'){requests.push({path,method:'OPTIONS'});res.end('ok');return}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const raw=Buffer.concat(chunks).toString();
  const field=name=>raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1]??null;
  requests.push({path,method:req.method,raw,headers:req.headers});
  let data=[];
  if(path==='/auth/v1/user')data=user;
  if(path==='/rest/v1/app_workspace_members')data=[{workspace_id:project.workspace_id,role:'owner'}];
  if(path==='/rest/v1/app_spaces')data=[project];
  if(path==='/rest/v1/app_documents')data=documents;
  if(path==='/auth/v1/token'){
   if(mode==='401-refresh-success')data={access_token:'mock-new-access',refresh_token:'mock-refresh',expires_at:9999999999,user};
   else{res.statusCode=401;data={message:'mock expired session'}}
  }
  if(path==='/functions/v1/library-files'){
   if(mode==='timeout'||mode==='hold'){pending.push(res);return}
   if(mode==='network')res.removeHeader('Access-Control-Allow-Origin');
   const status=mode==='401-refresh-success'?(req.headers.authorization==='Bearer mock-new-access'?200:401):Number(mode)||200;
   res.statusCode=status;
   if(status>=400)data={message:status===424?'Google Drive 토큰 갱신에 실패했습니다.':'raw mock failure'};
   else{const document={id:'uploaded-'+documents.length,workspace_id:project.workspace_id,project_id:field('project_id'),title:field('title')||'모의 자료',tags:[]};documents.push(document);data={ok:true,document}}
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
 });
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));apiOrigin=`http://127.0.0.1:${api.address().port}`;
 assets=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  try{
   let source=path==='/fixture'?fixture.replace('BASELINE',url.searchParams.has('baseline')?'baseline':'candidate'):path==='/app/library-upload.js'&&url.searchParams.has('baseline')?before:readFileSync('.'+path);
   if(path.endsWith('.js'))source=String(source).replaceAll('https://xmlkxfjeagycwttklxjw.supabase.co',apiOrigin);
   res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(source);
  }catch{res.statusCode=404;res.end()}
 });
 await new Promise(resolve=>assets.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${assets.address().port}`;
});
test.afterAll(async()=>{for(const server of [api,assets]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}});

async function open(page,{width,baseline=false,shortTimeout=false}={}){
 mode='success';requests=[];documents=[];pending=[];
 await page.setViewportSize({width,height:900});
 await page.addInitScript(({shortTimeout})=>{
  window.__uploadOptions=[];window.__saved=[];window.__changed=0;window.__errors=[];window.__deadlines=[];window.__completed=0;
  window.addEventListener('kptu:api-saved',e=>window.__saved.push(e.detail));
  window.addEventListener('kptu:documents-changed',()=>window.__changed++);
  const nativeFetch=window.fetch,nativeTimer=window.setTimeout;
  window.fetch=async function(url,options){
   if(String(url).includes('/functions/v1/library-files'))window.__uploadOptions.push({keys:Object.keys(options).sort(),cache:options.cache??null,signal:!!options.signal,credentials:options.credentials??'same-origin',mode:options.mode??'cors',keepalive:options.keepalive??false,headers:Object.keys(options.headers).sort()});
   const result=await nativeFetch.apply(this,arguments);
   if(String(url).includes('/functions/v1/library-files'))window.__completed++;
   return result;
  };
  window.setTimeout=function(fn,ms,...args){if(ms>=90000&&ms<=600000){window.__deadlines.push(ms);if(shortTimeout)ms=150}return nativeTimer(fn,ms,...args)};
 },{shortTimeout});
 await page.goto(origin+'/fixture'+(baseline?'?baseline':''));
 await expect.poll(()=>page.evaluate(()=>window.__KPTU_LIBRARY_UPLOAD_READY__)).toBe(true);
 await page.evaluate(()=>{const original=window.luUploadRequest;window.luUploadRequest=async(...args)=>{try{return await original(...args)}catch(e){window.__errors.push({code:e.code,status:e.status,retryable:e.retryable,cause:e.cause?.name});throw e}}});
}
const posts=()=>requests.filter(r=>r.path==='/functions/v1/library-files'&&r.method==='POST');
const select=page=>page.locator('#libraryFileInput').setInputFiles({name:'한쪽 자료.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nmock upload body')});

for(const width of [390,1280])test.describe(`native library transport ${width}px`,()=>{
 test.use(width===390?{...phone,viewport:{width,height:900}}:{viewport:{width,height:900}});
 test(`library A/B uses meeting fetch options and publishes one save at ${width}px`,async({page})=>{
  await open(page,{width});
  await select(page);await page.locator('#docProject').selectOption(project.id);
  await page.locator('#docTitle').fill('한글 자료');await page.locator('#docDescription').fill('설명 🙂');
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  expect(posts()).toHaveLength(1);
  expect(requests.filter(r=>r.path==='/functions/v1/library-files'&&r.method==='OPTIONS')).toHaveLength(1);
  expect(posts()[0].raw).toContain('한글 자료');expect(posts()[0].raw).toContain('설명 🙂');
  expect(posts()[0].headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
  expect(await page.evaluate(()=>window.__uploadOptions)).toEqual([{keys:['body','headers','method'],cache:null,signal:false,credentials:'same-origin',mode:'cors',keepalive:false,headers:['Authorization','apikey']}]);
  expect(await page.evaluate(()=>window.__saved)).toEqual([{path:'/functions/v1/library-files',method:'POST',fields:[],action:'',projectLinked:true,epoch:1}]);
  expect(await page.evaluate(()=>window.__changed)).toBe(1);
  expect(await page.evaluate(()=>window.__deadlines)).toEqual([94000]);
 });

 for(const failure of ['network','timeout','401','413','503','424','403','400','504']){
  test(`library ${failure} classification matches the previous transport at ${width}px`,async({browser})=>{
   const results=[];
   for(const baseline of [true,false]){
    const page=await browser.newPage(width===390?{...phone,viewport:{width,height:900}}:{viewport:{width,height:900}});await open(page,{width,baseline,shortTimeout:failure==='timeout'});
    mode=failure;await select(page);await page.locator('#saveDocumentBtn').click();
    await expect(page.locator('#documentStatus')).toHaveAttribute('role','alert');
    await expect(page.locator('#saveDocumentBtn')).toBeEnabled();
    await expect(page.locator('#saveDocumentBtn')).not.toHaveAttribute('aria-busy','true');
    expect(posts()).toHaveLength(1);
    const result=await page.evaluate(()=>({message:document.querySelector('#documentStatus').textContent,state:document.querySelector('[data-lu-upload-state]').textContent,errors:window.__errors.map(({code,status,retryable})=>({code,status,retryable})),saved:window.__saved.length,changed:window.__changed}));
    results.push(result);
    expect(result.saved).toBe(0);expect(result.changed).toBe(0);
    if(failure!=='401'){
     mode='success';await page.locator('#libraryFileInput').setInputFiles({name:'새 파일.pdf',mimeType:'application/pdf',buffer:Buffer.from('new')});
     await page.locator('#saveDocumentBtn').click();await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
     expect(posts()).toHaveLength(2);
    }
    await page.close();
   }
   expect(results[1]).toEqual(results[0]);
  });
 }
 test(`library keeps the existing one-time 401 refresh recovery at ${width}px`,async({page})=>{
  await open(page,{width});mode='401-refresh-success';await select(page);await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  expect(posts()).toHaveLength(2); // Existing authenticated retry, not a network retry.
  expect(requests.filter(r=>r.path==='/auth/v1/token'&&r.method==='POST')).toHaveLength(1);
  expect(requests.filter(r=>r.path==='/auth/v1/token'&&r.method==='OPTIONS')).toHaveLength(1);
  expect(posts().map(r=>r.headers.authorization)).toEqual(['Bearer mock-access','Bearer mock-new-access']);
  expect(await page.evaluate(()=>window.__saved.length)).toBe(1);
 });
 test(`a late response after the upload deadline keeps its unknown state at ${width}px`,async({page})=>{
  await open(page,{width,shortTimeout:true});mode='timeout';await select(page);await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentStatus')).toContainText('업로드 시간이 오래 걸려');
  await expect(page.locator('#saveDocumentBtn')).toBeEnabled();expect(posts()).toHaveLength(1);
  pending[0].setHeader('Content-Type','application/json');pending[0].end(JSON.stringify({ok:true,document:{id:'late-document'}}));
  await expect.poll(()=>page.evaluate(()=>window.__completed)).toBe(1);
  await expect(page.locator('[data-lu-upload-state]')).toHaveText('결과 확인 필요');
  expect(await page.evaluate(()=>({saved:window.__saved.length,changed:window.__changed}))).toEqual({saved:0,changed:0});
 });
 test(`an account change suppresses stale api-saved metadata at ${width}px`,async({page})=>{
  await open(page,{width});mode='hold';await select(page);await page.locator('#saveDocumentBtn').click();
  await expect.poll(()=>posts().length).toBe(1);
  await page.evaluate(()=>window.KPTURuntime.session.write({access_token:'mock-other-access',refresh_token:'mock-other-refresh',expires_at:9999999999,user:{id:'other-mock-owner'}}));
  pending[0].setHeader('Content-Type','application/json');pending[0].end(JSON.stringify({ok:true,document:{id:'old-owner-document',project_id:project.id}}));
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  expect(await page.evaluate(()=>window.__saved)).toEqual([]);
 });
});
