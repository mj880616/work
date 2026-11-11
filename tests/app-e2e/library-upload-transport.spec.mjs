import {test,expect,devices} from '@playwright/test';
import {answerAsk} from './helpers/small-notice.mjs';
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
<section id="libraryView"><input id="documentSearch"><div id="documentProject"></div><div id="documentList"></div></section>
<div id="documentModal"><div class="modal-card"><label>자료명<input id="docTitle"></label><input id="docCategory"><input id="docSource"><input id="docDate"><input id="docTags"><select id="docProject"></select><textarea id="docDescription"></textarea><button id="saveDocumentBtn" type="button">저장</button><div id="documentStatus"></div></div></div>
<script src="/app/runtime-client.js"></script>
<script>KPTURuntime.session.write({access_token:'mock-access',refresh_token:'mock-refresh',expires_at:9999999999,user:{id:'upload-owner'}});</script>
<script type="module" src="/app/project-catalog.js"></script><script type="module" src="/app/library-upload.js?BASELINE"></script></body></html>`;

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
   if(path==='/fixture'&&url.searchParams.has('baseline'))source=source.replace('<div id="documentProject"></div>','<select id="documentProject"></select>');
   // Test-only instrumentation preserves error classification checks for module-scoped functions.
   if(path==='/app/library-upload.js')source=String(source)+`;Object.defineProperty(window,'luUploadRequest',{get:()=>luUploadRequest,set:value=>{luUploadRequest=value}});`;
   if(path.endsWith('.js'))source=String(source).replaceAll('https://xmlkxfjeagycwttklxjw.supabase.co',apiOrigin);
   res.setHeader('Content-Type',/\.m?js$/.test(path)?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(source);
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
  // UI-올리기진행표시 ②: 지금 화면은 XMLHttpRequest(실제 보낸 양)로 보낸다 — 같은 자리에서 보낸 모양·끝난 수를 본다(옛 화면은 위 fetch).
  const nativeOpen=XMLHttpRequest.prototype.open,nativeSet=XMLHttpRequest.prototype.setRequestHeader,nativeSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...rest){this.__lib=String(url).includes('/functions/v1/library-files');this.__method=method;this.__headers=[];return nativeOpen.call(this,method,url,...rest)};
  XMLHttpRequest.prototype.setRequestHeader=function(name,value){this.__headers?.push(name);return nativeSet.call(this,name,value)};
  XMLHttpRequest.prototype.send=function(body){
   if(this.__lib){window.__uploadOptions.push({xhr:true,method:this.__method,withCredentials:this.withCredentials,timeout:this.timeout,headers:[...this.__headers].sort()});this.addEventListener('loadend',()=>window.__completed++)}
   return nativeSend.call(this,body);
  };
  window.setTimeout=function(fn,ms,...args){if(ms>=90000&&ms<=600000){window.__deadlines.push(ms);if(shortTimeout&&window.__shortTimeout!==false)ms=150}return nativeTimer(fn,ms,...args)};
 },{shortTimeout});
 await page.goto(origin+'/fixture'+(baseline?'?baseline':''));
 await expect.poll(()=>page.evaluate(()=>window.__KPTU_LIBRARY_UPLOAD_READY__)).toBe(true);
 await page.evaluate(()=>{const original=window.luUploadRequest;window.luUploadRequest=async(...args)=>{try{return await original(...args)}catch(e){window.__errors.push({code:e.code,status:e.status,retryable:e.retryable,cause:e.cause?.name});throw e}}});
}
const posts=()=>requests.filter(r=>r.path==='/functions/v1/library-files'&&r.method==='POST');
const notice=page=>page.locator('#uploadDock:not([hidden]) .up-dock-text');
const select=page=>page.locator('#libraryFileInput').setInputFiles({name:'한쪽 자료.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nmock upload body')});

for(const width of [390,1280])test.describe(`native library transport ${width}px`,()=>{
 test.use(width===390?{...phone,viewport:{width,height:900}}:{viewport:{width,height:900}});
 test(`library upload sends one plain request (no cookies) and publishes one save at ${width}px`,async({page})=>{
  await open(page,{width});
  await select(page);await page.locator('#docProject').evaluate((s,id)=>{s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}))},project.id); // S52-01 ③c: 값은 숨은 <select>(전송 시험이라 고르기 창은 거치지 않음)
  await page.locator('#docTitle').fill('한글 자료');await page.locator('#docDescription').fill('설명 🙂');
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  // UX-먼저묻고뒤에처리 3차(S57-1): 창은 [저장] 뒤 바로 닫히고 올리기는 뒤에서 — 끝(자료 목록 알림)을 기다린 뒤 보낸 모양을 본다.
  await expect.poll(()=>page.evaluate(()=>window.__changed)).toBe(1);
  await expect(notice(page)).toHaveText('한쪽 자료.pdf 올렸어요');
  expect(posts()).toHaveLength(1);
  expect(requests.filter(r=>r.path==='/functions/v1/library-files'&&r.method==='OPTIONS')).toHaveLength(1);
  expect(posts()[0].raw).toContain('한글 자료');expect(posts()[0].raw).toContain('설명 🙂');
  expect(posts()[0].headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
  // 로그인 정보(쿠키)를 싣지 않고, XMLHttpRequest 자체 시간 한도 없이(한도는 아래 올리기 한도 하나), 머리글은 apikey·Authorization뿐.
  expect(await page.evaluate(()=>window.__uploadOptions)).toEqual([{xhr:true,method:'POST',withCredentials:false,timeout:0,headers:['Authorization','apikey']}]);
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
    // 424(Drive 만료)면 지금 화면은 관리자에게 다시 연결을 공용 작은 확인창으로 묻는다(옛 화면은 기본 창이라 저절로 닫힘) → 하지 않음.
    if(failure==='424'&&!baseline)await page.locator('.kptu-ask').waitFor({state:'visible',timeout:5000}).then(()=>answerAsk(page,false),()=>{});
    // 옛 화면: 실패하면 창이 열린 채 상태 줄(role=alert). 지금 화면(UX-먼저묻고뒤에처리 3차): 창은 바로 닫히고 같은 글이 공용 작은 알림(role=alert)에 뜬다.
    if(baseline)await expect(page.locator('#documentStatus')).toHaveAttribute('role','alert');
    else{await expect(page.locator('#documentModal')).toHaveClass(/hidden/);await expect(page.locator('#uploadDock:not([hidden])')).toHaveAttribute('role','alert')}
    await expect(page.locator('#saveDocumentBtn')).toBeEnabled();
    await expect(page.locator('#saveDocumentBtn')).not.toHaveAttribute('aria-busy','true');
    expect(posts()).toHaveLength(1);
    const result=await page.evaluate(baseline=>({message:baseline?document.querySelector('#documentStatus').textContent:document.querySelector('#uploadDock .up-dock-text').textContent,state:baseline?document.querySelector('[data-lu-upload-state]').textContent:'',errors:window.__errors.map(({code,status,retryable})=>({code,status,retryable})),saved:window.__saved.length,changed:window.__changed}),baseline);
    // UI-PC손맛묶음 ⑩(S56-52): 실패·없음 글귀만 해요체로 바꿨다 — 옛 화면 글자도 같은 말투로 맞춰 나머지(분류·상태·전송)를 비교한다.
    if(baseline)result.message=String(result.message).replace(/못했습니다/g,'못했어요').replace(/없습니다/g,'없어요');
    expect(result.saved).toBe(0);expect(result.changed).toBe(0);
    // STAB-E2E간헐1104: 시간 초과 시험의 짧은 제한(150ms)이 다시 보내는 성공 요청에도 남아, 느린 실행에서 성공 응답이 150ms를 넘으면 또 시간 초과가 났다(CI shard 5/8, 1280 timeout). 실패 확인이 끝나면 짧은 제한을 끄고 다시 보낸다.
    await page.evaluate(()=>{window.__shortTimeout=false});
    const again={name:'새 파일.pdf',mimeType:'application/pdf',buffer:Buffer.from('new')};
    if(baseline){
     if(failure!=='401'){
      mode='success';await page.locator('#libraryFileInput').setInputFiles(again);
      await page.locator('#saveDocumentBtn').click();await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
      expect(posts()).toHaveLength(2);
     }
    }else{
     // 지금 화면에는 파일 줄 상태 글자가 없다. 옛 글자가 가르던 것을 알림의 [다시] 동작으로 읽어 같은 이름으로 비교한다:
     // [다시] 없음 = '100MB 초과'(다시 보낼 수 없음) / [다시]가 먼저 중복 확인을 물음 = '결과 확인 필요' / [다시]가 바로 다시 보냄 = '실패 · 다시 시도'.
     if(failure!=='401')mode='success';
     const retry=page.locator('#uploadDock:not([hidden]) [data-up-act="note-act"]',{hasText:'다시'});
     if(!(await retry.count()))result.state='100MB 초과';
     else{
      await retry.click();
      const asked=await page.locator('.kptu-ask').waitFor({state:'visible',timeout:1500}).then(()=>true,()=>false);
      if(asked){expect(await answerAsk(page,false)).toContain('업로드 결과를 확인하지 못한 파일 1개');result.state='결과 확인 필요'}
      else result.state='실패 · 다시 시도';
     }
     if(failure==='401'){await page.waitForTimeout(300);expect(posts()).toHaveLength(1)} // 로그인이 풀린 채 [다시]: 서버로 보내지 않는다
     else if(result.state==='실패 · 다시 시도'){await expect.poll(()=>posts().length).toBe(2);await expect(notice(page)).toHaveText('한쪽 자료.pdf 올렸어요')} // [다시] = 그 파일만 다시
     else{
      // 결과를 모르는 파일·다시 보낼 수 없는 파일은 다시 나가지 않았다. 창은 잠겨 있지 않아 새 파일을 바로 올릴 수 있다.
      await page.waitForTimeout(200);expect(posts()).toHaveLength(1);
      await page.locator('#documentModal').evaluate(m=>m.classList.remove('hidden'));
      await page.locator('#libraryFileInput').setInputFiles(again);
      await page.locator('#saveDocumentBtn').click();await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
      await expect.poll(()=>posts().length).toBe(2);
     }
    }
    results.push(result);
    await page.close();
   }
   expect(results[1],`${failure} ${width}px: 지금 화면(results[1])과 옛 화면(results[0]) 비교`).toEqual(results[0]);
  });
 }
 test(`library keeps the existing one-time 401 refresh recovery at ${width}px`,async({page})=>{
  await open(page,{width});mode='401-refresh-success';await select(page);await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  await expect(notice(page)).toHaveText('한쪽 자료.pdf 올렸어요'); // 뒤에서 올리기가 끝남
  expect(posts()).toHaveLength(2); // Existing authenticated retry, not a network retry.
  expect(requests.filter(r=>r.path==='/auth/v1/token'&&r.method==='POST')).toHaveLength(1);
  expect(requests.filter(r=>r.path==='/auth/v1/token'&&r.method==='OPTIONS')).toHaveLength(1);
  expect(posts().map(r=>r.headers.authorization)).toEqual(['Bearer mock-access','Bearer mock-new-access']);
  expect(await page.evaluate(()=>window.__saved.length)).toBe(1);
 });
 test(`a late response after the upload deadline keeps its unknown state at ${width}px`,async({page})=>{
  await open(page,{width,shortTimeout:true});mode='timeout';await select(page);await page.locator('#saveDocumentBtn').click();
  await expect(notice(page)).toContainText('업로드 시간이 오래 걸려');
  await expect(page.locator('#saveDocumentBtn')).toBeEnabled();expect(posts()).toHaveLength(1);
  pending[0].setHeader('Content-Type','application/json');pending[0].end(JSON.stringify({ok:true,document:{id:'late-document'}}));
  await expect.poll(()=>page.evaluate(()=>window.__completed)).toBe(1);
  // 늦게 온 답이 '결과 확인 필요'를 성공으로 바꾸지 않는다: 알림은 그대로이고 [다시]는 여전히 중복 확인부터 묻는다.
  await expect(notice(page)).toContainText('업로드 시간이 오래 걸려');
  await page.evaluate(()=>{window.__shortTimeout=false});
  await page.locator('#uploadDock:not([hidden]) [data-up-act="note-act"]',{hasText:'다시'}).click();
  expect(await answerAsk(page,false)).toContain('업로드 결과를 확인하지 못한 파일 1개');
  expect(posts()).toHaveLength(1);
  expect(await page.evaluate(()=>({saved:window.__saved.length,changed:window.__changed}))).toEqual({saved:0,changed:0});
 });
 test(`an account change suppresses stale api-saved metadata at ${width}px`,async({page})=>{
  await open(page,{width});mode='hold';await select(page);await page.locator('#saveDocumentBtn').click();
  await expect.poll(()=>posts().length).toBe(1);
  await page.evaluate(()=>window.KPTURuntime.session.write({access_token:'mock-other-access',refresh_token:'mock-other-refresh',expires_at:9999999999,user:{id:'other-mock-owner'}}));
  pending[0].setHeader('Content-Type','application/json');pending[0].end(JSON.stringify({ok:true,document:{id:'old-owner-document',project_id:project.id}}));
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  await expect.poll(()=>page.evaluate(()=>window.__completed)).toBe(1);
  await page.waitForTimeout(300);
  expect(await page.evaluate(()=>window.__saved)).toEqual([]);
  // 뒤에서 올리던 일은 [저장]한 사람의 것이다: 계정이 바뀌면 끝 알림(파일 이름)·자료 목록 알림을 바뀐 사람 화면에 내지 않는다.
  expect(await page.evaluate(()=>window.__changed)).toBe(0);
  await expect(page.locator('#kptuNotice:not([hidden])')).toHaveCount(0);
  await expect(page.locator('#uploadDock:not([hidden])',{hasText:'올렸어요'})).toHaveCount(0);
 });
});
