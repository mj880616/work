import {testOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openBasketMore,openClassification,requestClassification,handoffLine} from './helpers/basket-more.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',n='10000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001',o='20000000-0000-4000-8000-000000000002',stamp='2026-10-11T01:02:03.123456Z';
const data=()=>({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'project',target_id:p,reason:'진행 근거 <img src=x onerror=alert(1)> https://example.org'},{kind:'organization',target_id:o,reason:'조직 근거'},{kind:'google_task',reason:'후속 작업'}]}]});
async function fixture(page){
 const f=await openHome(page),errors=[],rpc=[],events=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const note={id:n,workspace_id:'w',raw_text:' 현재 DB 원문\n둘째 줄  ',updated_at:stamp,occurred_at:stamp,ai_export_allowed:true,attachments:[]},links=[];
 await page.route(SB+'/rest/v1/app_notes?**',r=>r.fulfill({json:[note]}));
 await page.route(SB+'/rest/v1/app_record_links?**',r=>r.fulfill({json:links}));
 await page.route(SB+'/rest/v1/app_spaces?**',r=>r.fulfill({json:[{id:p,workspace_id:'w',owner_id:'home-test',name:'현재 프로젝트',metadata:{project_system:'v2'},status:'active'}]}));
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:[{id:o,workspace_id:'w',name:'현재 조직'}]}));
 let missing=false,rejected=null;
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{
 const body=r.request().postDataJSON();rpc.push(body);
 if(missing)return r.fulfill({status:404,json:{message:'Could not find the function public.app_basket_confirm_links in the schema cache'}});
 if(rejected)return r.fulfill({json:{ok:false,error:rejected,created:0,existing:0}});
 let created=0,existing=0;for(const t of body.p_targets){const key=t.kind==='project'?'project_id':'organization_id';if(links.some(l=>l[key]===t.target_id))existing++;else{created++;links.push({note_id:n,status:'confirmed',[key]:t.target_id,[t.kind]:{name:t.kind==='project'?'현재 프로젝트':'현재 조직'}});}}
 return r.fulfill({json:{ok:true,created,existing}});
 });
 await page.evaluate(()=>{window.__basketSaved=[];window.addEventListener('kptu:api-saved',e=>window.__basketSaved.push(e.detail));});
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(1);await openBasketMore(page);
 return {...f,note,links,rpc,errors,events,setMissing:v=>missing=v,setRejected:v=>rejected=v};
}
async function open(page){await openClassification(page);}
async function preview(page,proposal=data()){await page.locator('[data-classification-input]').fill('```json\n'+JSON.stringify(proposal,null,2)+'\n```');await page.locator('[data-classification-preview]').click();await expect(page.locator('[data-classification-note]')).toHaveCount(proposal.items.length);}
for(const width of [390,1280])test(`record summary editing is independent, preserved and explicitly submitted ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page);await open(page);await preview(page);
 const project=page.locator('[data-classification-summary="0:0"]'),org=page.locator('[data-classification-summary="0:1"]');
 await expect(project).toHaveValue(data().items[0].destinations[0].reason);await expect(org).toHaveValue('조직 근거');
 await project.fill('승인 프로젝트 😀');await org.fill('승인 조직 요약');
 await page.locator('[data-classification-choice="0:1"]').uncheck();const choice=page.locator('[data-classification-choice="0:0"]');await choice.check();await choice.uncheck();await choice.check();await expect(project).toHaveValue('승인 프로젝트 😀');
 await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('1개 연결했어요');
 expect(f.rpc[0].p_targets[0]).toEqual({...data().items[0].destinations[0],summary:'승인 프로젝트 😀'});
 await expect(org).toHaveValue('승인 조직 요약');await page.locator('[data-classification-choice="0:1"]').check();await page.locator('[data-classification-confirm]').click();
 await expect.poll(()=>f.rpc.length).toBe(2);expect(f.rpc[1].p_targets[0].summary).toBe('승인 조직 요약');expect(f.errors).toEqual([]);
});
test('record summary validation counts code points, focuses invalid input and retains all drafts',async({page})=>{
 const f=await fixture(page);await open(page);await preview(page);await page.locator('[data-classification-choice="0:0"]').check();await page.locator('[data-classification-choice="0:1"]').check();
 const project=page.locator('[data-classification-summary="0:0"]'),org=page.locator('[data-classification-summary="0:1"]');await org.fill('다른 목적지 초안');
 for(const value of ['', '\u0085\u00a0\u3000\ufeff', '😀'.repeat(2001)]){
  await project.fill(value);await page.locator('[data-classification-confirm]').click();await expect(project).toBeFocused();expect(f.rpc).toHaveLength(0);await expect(org).toHaveValue('다른 목적지 초안');
 }
 await project.fill('😀'.repeat(2000));await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('2개 연결했어요');expect([...f.rpc[0].p_targets[0].summary]).toHaveLength(2000);expect(f.errors).toEqual([]);
});
test('record summary uncertain confirmation keeps draft and requires current-link recheck',async({page})=>{
 const f=await fixture(page);await open(page);await preview(page);const org=page.locator('[data-classification-summary="0:1"]');await org.fill('통신 후 유지할 초안');await page.locator('[data-classification-choice="0:1"]').check();
 await page.evaluate(()=>{const rt=window.KPTURuntime,api=rt.api;rt.api=async(path,...args)=>{if(path.endsWith('/app_basket_confirm_links'))throw Error('synthetic transport');return api(path,...args);};});
 await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('결과를 확인하지 못했어요');await expect(page.locator('[data-classification-confirm]')).toBeDisabled();
 await page.locator('[data-classification-preview]').click();await expect(org).toHaveValue('통신 후 유지할 초안');expect(f.rpc).toHaveLength(0);
});
test('record summary mixed created and concurrently existing destinations display exact saved values',async({page})=>{
 const f=await fixture(page);await open(page);await preview(page);await page.locator('[data-classification-summary="0:0"]').fill('새 프로젝트 요약');await page.locator('[data-classification-choice="0:0"]').check();await page.locator('[data-classification-choice="0:1"]').check();
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{const body=r.request().postDataJSON();f.rpc.push(body);f.links.push({note_id:n,status:'confirmed',organization_id:o,summary:'이미 저장된 조직 요약'});f.links.push({note_id:n,status:'confirmed',project_id:p,summary:body.p_targets.find(t=>t.kind==='project').summary});return r.fulfill({json:{ok:true,created:1,existing:1}});});
 await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('1개는 이미 연결돼 있어요');await expect(page.locator('[data-classification-rows]')).toContainText('새 프로젝트 요약');await expect(page.locator('[data-classification-rows]')).toContainText('이미 저장된 조직 요약');expect(f.links[0].summary).toBe('이미 저장된 조직 요약');expect(f.rpc).toHaveLength(1);
});
test('record summary late confirmation cannot restore drafts after leaving basket and invalidates same-scope records',async({page})=>{
 const f=await fixture(page);await open(page);await preview(page);await page.locator('[data-classification-summary="0:1"]').fill('승인 후 화면 전환');await page.locator('[data-classification-choice="0:1"]').check();
 let release,started=false;const held=new Promise(resolve=>release=resolve);await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',async route=>{started=true;await held;await route.fallback();});
 await page.evaluate(()=>{window.__linkRefreshCount=0;window.addEventListener('kptu:basket-links-changed',()=>window.__linkRefreshCount++);});await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-confirm]')).toBeDisabled();await expect.poll(()=>started).toBe(true);await page.evaluate(()=>KPTURouter.go('home'));
 await expect(page.locator('[data-classification-input]')).toHaveValue('');await expect(page.locator('[data-classification-summary]')).toHaveCount(0);release();await expect.poll(()=>f.rpc.length).toBe(1);await expect.poll(()=>page.evaluate(()=>window.__linkRefreshCount)).toBeGreaterThan(0);await expect(page.locator('[data-classification-panel]')).toBeHidden();expect(f.errors).toEqual([]);
});
for(const width of [390,1280]){
 test(`classification paste preview errors selected confirm and copy notification ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page);await page.context().grantPermissions(['clipboard-read','clipboard-write']);await expect(page.locator('#basketMoreMenu [data-handoff-copy]')).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('[data-classification-input]')).toBeFocused();
 await page.screenshot({path:info.outputPath(`paste-${width}.png`),fullPage:true});
 await page.locator('[data-classification-input]').fill('説明\n'+JSON.stringify(data()));await page.locator('[data-classification-preview]').click();await expect(page.locator('[data-classification-status]')).toContainText('AI 답 전체나, 답 속 복사용 블록만 넣어 주세요');await expect(page.locator('[data-classification-confirm]')).toBeDisabled();
 f.note.updated_at='2026-10-11T01:02:03.123457Z';await preview(page);await expect(page.locator('[data-classification-note]')).toContainText('업데이트가 바뀌었어요');await expect(page.locator('[data-classification-choice]:enabled')).toHaveCount(0);await page.screenshot({path:info.outputPath(`preview-error-${width}.png`),fullPage:true});
 f.note.updated_at=stamp;await preview(page);await expect(page.locator('[data-classification-note]')).toContainText(f.note.raw_text.trim());await expect(page.locator('[data-classification-note]')).toContainText('현재 프로젝트');await expect(page.locator('[data-classification-note]')).toContainText('아직 지원하지 않는 항목');await expect(page.locator('[data-classification-note] img,[data-classification-note] a')).toHaveCount(0);
 await page.locator('[data-classification-choice="0:1"]').uncheck();const check=page.locator('[data-classification-choice]:enabled').first();await check.uncheck();await check.focus();await page.keyboard.press('Space');await expect(check).toBeChecked();await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('1개 연결했어요');
 expect(f.rpc[0].p_targets).toHaveLength(1);expect(f.rpc[0].p_targets[0].kind).toBe('project');expect(Object.keys(f.rpc[0])).toEqual(['p_note_id','p_note_updated_at','p_targets']);await expect(page.locator('[data-basket-row]')).toHaveCount(0);await expect(page.locator('[data-classification-note]')).toContainText('연결 완료');
 await page.locator('[data-classification-close]').click();await page.locator('[data-basket-filter="classified"]').click();await expect(page.locator('[data-basket-row]')).toContainText('분류 완료');await expect(page.locator('[data-basket-row-item]')).toContainText('현재 프로젝트');await page.screenshot({path:info.outputPath(`confirmed-${width}.png`),fullPage:true});
 expect(await page.evaluate(()=>window.__basketSaved.some(e=>e.path==='/rest/v1/rpc/app_basket_confirm_links'))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(f.errors).toEqual([]);
 });
 test(`classification function unavailable isolated and stale revalidation ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page);await open(page);await preview(page);f.setMissing(true);await page.locator('[data-classification-choice]:enabled').first().check();await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('연결 기능 준비 중');expect(f.links).toHaveLength(0);
 await page.locator('[data-classification-close]').click();await page.locator('[data-basket-row]').click();await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);await page.keyboard.press('Escape');await open(page);f.setMissing(false);await preview(page);await page.locator('[data-classification-choice]:enabled').first().check();f.setRejected('NOTE_CHANGED');await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('업데이트가 바뀌었어요');await expect(page.locator('[data-classification-choice]:enabled')).toHaveCount(0);
 expect(f.errors).toEqual(['Failed to load resource: the server responded with a status of 404 (Not Found)']);
 });
}
test('classification input changes invalidate selection; cleared session context removes private proposal',async({page})=>{
 const f=await fixture(page);await open(page);await preview(page);await page.locator('[data-classification-choice]:enabled').first().check();await page.locator('[data-classification-input]').fill('PRIVATE_PROPOSAL_DRAFT');await expect(page.locator('[data-classification-confirm]')).toBeDisabled();await expect(page.locator('[data-classification-choice]')).toHaveCount(0);
 const cdp=await page.context().newCDPSession(page);const stored=JSON.stringify(await Promise.all([true,false].map(isLocalStorage=>cdp.send('DOMStorage.getDOMStorageItems',{storageId:{securityOrigin:testOrigin,isLocalStorage}}))));expect(stored).not.toContain('PRIVATE_PROPOSAL_DRAFT');
 await page.evaluate(()=>{const rt=window.KPTURuntime,c=rt.context.read();rt.context.clear();window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:rt.session.read()}}));});await expect(page.locator('[data-classification-input]')).toHaveValue('');await expect(page.locator('[data-classification-panel]')).toBeHidden();expect(f.rpc).toHaveLength(0);
});

test('classification pending preview cannot restore private content after workspace changes',async({page})=>{
 await fixture(page);await open(page);let release;const held=new Promise(r=>release=r);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await held;await r.fallback();});
 await page.locator('[data-classification-input]').fill('```json\n'+JSON.stringify(data())+'\n```');await page.locator('[data-classification-preview]').click();await expect(page.locator('[data-classification-preview]')).toBeDisabled();
 await page.evaluate(()=>{const rt=window.KPTURuntime,c=rt.context.read();rt.context.set({...c,workspace:{...c.workspace,id:'other-workspace'}});window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:rt.session.read()}}));});release();
 await expect(page.locator('[data-classification-input]')).toHaveValue('');await expect(page.locator('[data-classification-note]')).toHaveCount(0);await expect(page.locator('[data-classification-panel]')).toBeHidden();
});
test('classification touch selection and busy duplicate press sends one confirmation',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const f=await fixture(page);await open(page);await preview(page);await page.locator('[data-classification-choice="0:1"]').uncheck();const choice=page.locator('[data-classification-choice]:enabled').first();await choice.uncheck();await choice.scrollIntoViewIfNeeded();const box=await choice.boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await expect(choice).toBeChecked();
 let release;const held=new Promise(r=>release=r);await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',async r=>{await held;await r.fallback();});
 await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-confirm]')).toBeDisabled();await page.locator('[data-classification-confirm]').dispatchEvent('click');release();await expect(page.locator('[data-classification-status]')).toContainText('1개 연결했어요');expect(f.rpc).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const width of [390,1280]){
 test(`AI handoff copy full reply safe errors and connection ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page);
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  f.note.attachments=[{file_name:'합성 첨부.pdf',mime_type:'application/pdf',drive_file_id:'synthetic-attachment',size_bytes:12,body:'BODY_SECRET',private_extra:'OCR_SECRET'}];
  await page.evaluate(()=>{window.__handoffWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__handoffWrites.push(text)}});});
  const destinationReads=[];page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/app_spaces'))destinationReads.push(request.url());});
  await requestClassification(page,{keyboard:true});
  await expect(handoffLine(page)).toHaveText('미분류 업데이트 1개 AI 분류 요청을 복사했어요. ChatGPT에 붙여 넣고, 받은 답을 아래 [분류 결과 입력]에 붙여 넣으세요.');await expect(page.locator('[data-classification-input]')).toBeFocused();
  const copied=await page.evaluate(()=>window.__handoffWrites[0]);
  for(const value of [f.note.raw_text,n,stamp,'현재 조직','현재 프로젝트','담당조직 목록 (ID · 이름)','프로젝트 목록 (ID · 이름)','synthetic-attachment','application/pdf'])expect(copied).toContain(value);
  expect(copied).not.toMatch(/BODY_SECRET|OCR_SECRET|google_task|library|write_request_candidate/);expect(f.rpc).toHaveLength(0);expect(destinationReads).toHaveLength(1);expect(new URL(destinationReads[0]).searchParams.get('owner_id')).toBe('eq.home-test');
  await page.screenshot({path:info.outputPath(`handoff-copied-${width}.png`),fullPage:true});
  await open(page);await page.screenshot({path:info.outputPath(`handoff-paste-${width}.png`),fullPage:true});
  for(const text of ['설명만','```json\n'+JSON.stringify(data())+'\n```\n```\n'+JSON.stringify(data())+'\n```']){
   await page.locator('[data-classification-input]').fill(text);await page.locator('[data-classification-preview]').click();
   await expect(page.locator('[data-classification-status]')).toHaveText('AI 답 전체나, 답 속 복사용 블록만 넣어 주세요');await expect(page.locator('[data-classification-note]')).toHaveCount(0);
  }
  const answer=data();answer.items[0].destinations=answer.items[0].destinations.slice(0,2);
  const full='<script>window.__outsideExecuted=true</script>\n<img src=x onerror="window.__outsideExecuted=true">\n메모 첫 줄 → 현재 프로젝트 · 관련 업무\n```json\n'+JSON.stringify(answer,null,2)+'\n```\n끝 설명';
  f.note.updated_at='2026-10-11T01:02:03.123457Z';
  await page.locator('[data-classification-input]').fill(full);await page.locator('[data-classification-preview]').click();
  await expect(page.locator('[data-classification-note]')).toHaveCount(1);await expect(page.locator('.basket-classification-error')).toContainText(['업데이트가 바뀌었어요']);
  await page.screenshot({path:info.outputPath(`handoff-error-${width}.png`),fullPage:true});
  f.note.updated_at=stamp;await page.locator('[data-classification-preview]').click();await expect(page.locator('[data-classification-choice]:enabled')).toHaveCount(2);
  expect(await page.evaluate(()=>window.__outsideExecuted)).toBeUndefined();await expect(page.locator('[data-classification-rows] script,[data-classification-rows] img')).toHaveCount(0);
  await page.locator('[data-classification-choice="0:1"]').uncheck();const choice=page.locator('[data-classification-choice]:enabled').first();await choice.uncheck();await choice.scrollIntoViewIfNeeded();const box=await choice.boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toHaveText('1개 연결했어요 · 0개 요약 저장했어요 · 0개는 이미 연결돼 있어요');
  expect(f.rpc[0].p_targets[0].kind).toBe('project');expect(f.links[0].project_id).toBe(p);
  await page.screenshot({path:info.outputPath(`handoff-connected-${width}.png`),fullPage:true});
  expect(await page.locator('[data-classification-host]').innerText()).not.toMatch(/JSON|schema|UUID|workspace|\(행 \d|열 \d|4b/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(f.errors).toEqual([]);
 });
 test(`AI handoff clipboard fallback and zero notes ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page);await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('permission denied');}}});});
  await requestClassification(page);await expect(page.locator('[data-handoff-status]')).toHaveText("아래 '복사하기'를 눌러 주세요");await expect(page.locator('[data-classification-panel]')).toBeHidden();
  const text=page.locator('[data-handoff-text]');await expect(text).toBeVisible();await expect(text).toHaveAttribute('readonly','');await expect(text).toBeFocused();expect(await text.inputValue()).toContain(f.note.raw_text);
  expect(await text.evaluate(el=>el.selectionStart===0&&el.selectionEnd===el.value.length)).toBe(true);
  // 복사할 메모가 없어도 창은 열린다(앞서 복사한 답을 붙여 넣을 수 있게). 알림은 한 줄.
  f.note.ai_export_allowed=false;await requestClassification(page);await expect(handoffLine(page)).toHaveText('분류 요청할 업데이트가 없어요');await expect(page.locator('[data-classification-panel]')).toBeVisible();await expect(text).toBeHidden();await expect(text).toHaveValue('');expect(f.rpc).toHaveLength(0);expect(f.errors).toEqual([]);
 });
}
test('AI handoff cannot copy or restore late private content after workspace changes',async({page})=>{
 await fixture(page);await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
 await page.evaluate(()=>{window.__handoffWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__handoffWrites.push(text)}});});
 let release;const held=new Promise(r=>release=r);await page.route(SB+'/rest/v1/app_notes?**',async r=>{await held;await r.fallback();});
 await requestClassification(page);await expect(page.locator('[data-handoff-copy]')).toBeDisabled();
 await page.evaluate(()=>{const rt=window.KPTURuntime,c=rt.context.read();rt.context.set({...c,workspace:{...c.workspace,id:'other-workspace'}});window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:rt.session.read()}}));});release();
 await expect(page.locator('[data-handoff-copy]')).toBeEnabled();await expect(page.locator('[data-handoff-text]')).toHaveValue('');await expect(page.locator('[data-handoff-status]')).toBeEmpty();expect(await page.evaluate(()=>window.__handoffWrites)).toEqual([]);
});
test('classification hides arbitrary server diagnostics during preview and confirm',async({page})=>{
 const f=await fixture(page);await open(page);
 await page.locator('[data-classification-input]').fill('```json\n'+JSON.stringify(data())+'\n```');
 await page.evaluate(()=>{const rt=window.KPTURuntime,api=rt.api;rt.api=async(path,...args)=>{if(path.includes('app_notes'))throw Error('JSON schema UUID workspace (행 1, 열 1) SECRET');return api(path,...args);};});
 await page.locator('[data-classification-preview]').click();await expect(page.locator('[data-classification-status]')).toHaveText('업데이트와 연결할 곳을 확인하지 못했어요. 다시 눌러 주세요.');
 expect(await page.locator('[data-classification-status]').innerText()).not.toMatch(/JSON|schema|UUID|workspace|SECRET|행 1/);expect(f.errors).toEqual([]);
});
test('AI handoff writes the complete text to the native Chromium clipboard',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const f=await fixture(page);await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
 await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:testOrigin});
 f.note.raw_text='합성 메모 첫 줄\n'+('긴 합성 본문 '.repeat(1000))+'\n합성 메모 마지막 줄';
 await requestClassification(page);await expect(handoffLine(page)).toHaveText('미분류 업데이트 1개 AI 분류 요청을 복사했어요. ChatGPT에 붙여 넣고, 받은 답을 아래 [분류 결과 입력]에 붙여 넣으세요.');
 const text=await page.evaluate(()=>navigator.clipboard.readText());expect(text).toContain(f.note.raw_text);expect(text).toContain('organization · '+o+' · 현재 조직');expect(text.trim()).toMatch(new RegExp('project · '+p+' · 현재 프로젝트$'));
 expect(f.rpc).toHaveLength(0);expect(f.errors).toEqual([]);
});

for(const width of [390,1280]){
 test(`raw copied JSON, fenced block and full reply preview; failed status stays visible ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:600});const f=await fixture(page);await open(page);
  const json=JSON.stringify(data(),null,2),input=page.locator('[data-classification-input]'),check=page.locator('[data-classification-preview]'),status=page.locator('[data-classification-status]');
  for(const text of [json,' \n'+json+'\n ','```json\n'+json+'\n```','짧은 설명\n```json\n'+json+'\n```\n끝 설명']){
   await input.fill(text);await check.click();await expect(page.locator('[data-classification-note]')).toHaveCount(1);
   await expect(page.locator('[data-classification-choice]:enabled')).toHaveCount(2);
  }
  for(const text of ['```json\n'+json+'\n```\n```json\n'+json+'\n```','```json\n'+json,'설명\n'+json,json+'\n설명']){
   await input.fill(text);
   // Put the button at the viewport bottom, with status below the fold.
   await check.evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement){if(parent.scrollHeight>parent.clientHeight&&/auto|scroll/.test(getComputedStyle(parent).overflowY)){parent.scrollTop+=el.getBoundingClientRect().bottom-parent.getBoundingClientRect().bottom+2;return;}}window.scrollBy(0,el.getBoundingClientRect().bottom-innerHeight+2);});
   await expect(check).toBeInViewport({ratio:1});await expect(page.locator('.basket-approval-footer')).toBeInViewport({ratio:1});await check.dispatchEvent('click');
   await expect(status).toHaveText('AI 답 전체나, 답 속 복사용 블록만 넣어 주세요');
   await expect(status).toBeInViewport({ratio:1});await expect(page.locator('[data-classification-note]')).toHaveCount(0);
   await expect(page.locator('[data-classification-confirm]')).toBeDisabled();
  }
  await page.screenshot({path:info.outputPath(`raw-paste-error-${width}.png`)});
  await input.fill(json);
  await page.evaluate(()=>{const rt=window.KPTURuntime,api=rt.api;rt.api=async(path,...args)=>{if(path.includes('app_notes'))throw Error('synthetic read failure');return api(path,...args);};});
  await check.evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement){if(parent.scrollHeight>parent.clientHeight&&/auto|scroll/.test(getComputedStyle(parent).overflowY)){parent.scrollTop+=el.getBoundingClientRect().bottom-parent.getBoundingClientRect().bottom+2;return;}}window.scrollBy(0,el.getBoundingClientRect().bottom-innerHeight+2);});
  await expect(check).toBeInViewport({ratio:1});await expect(page.locator('.basket-approval-footer')).toBeInViewport({ratio:1});await check.dispatchEvent('click');
  await expect(status).toHaveText('업데이트와 연결할 곳을 확인하지 못했어요. 다시 눌러 주세요.');await expect(status).toBeInViewport({ratio:1});
  expect(f.rpc).toHaveLength(0);expect(f.errors).toEqual([]);
 });
}

for(const width of [390,1280]){
 test(`restored project hierarchy and owner organization list copy then project confirmation ${width}`,async({page},info)=>{
  const {readFileSync}=await import('node:fs');
  const synthetic=JSON.parse(readFileSync(new URL('../fixtures/basket-project-destinations.json',import.meta.url),'utf8'));
  await page.setViewportSize({width,height:1000});const f=await fixture(page);
  await page.clock.setFixedTime(new Date(synthetic.now));
  await page.route(SB+'/rest/v1/app_spaces?**',r=>r.fulfill({json:synthetic.spaces.map(row=>({...row,workspace_id:'w',owner_id:'home-test'}))}));
  await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:synthetic.organizations.map(row=>({...row,workspace_id:'w'}))}));
  let assignments=synthetic.assignees;
  await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:assignments}));
  await page.evaluate(()=>{window.__handoffWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__handoffWrites.push(text)}});});
  for(const fallback of [false,true]){
   if(fallback)assignments=[];
   await requestClassification(page);await expect(handoffLine(page)).toHaveText(/AI 분류 요청을 복사했어요\. ChatGPT에 붙여 넣고/);
   const text=await page.evaluate(()=>window.__handoffWrites.at(-1));
   expect(text.match(/^project · /gm)).toHaveLength(6);
   for(const row of synthetic.expected_projects)expect(text).toContain(`project · ${row.id} · ${row.name}`);
   expect(text.match(/^organization · /gm)).toHaveLength(fallback?3:2);
   expect(text.includes('담당조직이 지정되지 않아 전체 조직을 싣습니다')).toBe(fallback);
   expect(text).not.toMatch(/합성 보관 상위|합성 숨김 하위|합성 완료 하위|합성 완료 표기|합성 순환|합성 비활성 조직/);
   expect(text.indexOf('담당조직 목록')).toBeLessThan(text.indexOf('프로젝트 목록'));
  }
  assignments=synthetic.assignees;
  const target=synthetic.expected_projects[1];
  const reply={schema_version:1,copied_at:synthetic.now,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'project',target_id:target.id,reason:'합성 하위 일정 검토'}]}]};
  await open(page);await page.locator('[data-classification-input]').fill(JSON.stringify(reply));await page.locator('[data-classification-preview]').click();
  await expect(page.locator('[data-classification-note]')).toContainText('합성 하위 A');await page.locator('[data-classification-choice]:enabled').check();await page.locator('[data-classification-confirm]').click();
  await expect(page.locator('[data-classification-status]')).toHaveText('1개 연결했어요 · 0개 요약 저장했어요 · 0개는 이미 연결돼 있어요');
  expect(f.rpc[0].p_targets).toEqual(reply.items[0].destinations.map(t=>({...t,summary:t.reason})));expect(f.links[0].project_id).toBe(target.id);
  await page.screenshot({path:info.outputPath(`project-restored-${width}.png`),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(f.errors).toEqual([]);
 });
}

// BASKET-분류중복·변화반영 ②: duplicate / changed / no-basis rows (synthetic records only).
for(const width of [412,870])test(`verdict rows: duplicate starts unchecked and can be revived, changed starts with the follow-up prefix ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page);await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
 const r1='50000000-0000-4000-8000-000000000001',r2='50000000-0000-4000-8000-000000000002',other='10000000-0000-4000-8000-000000000009';
 const rec=(id,key,target)=>({id,workspace_id:'w',summary:'기존 합성 기록',note_id:other,[key]:target,status:'confirmed',note:{id:other,workspace_id:'w',occurred_at:'2026-10-10T01:00:00Z',raw_text:'합성 원문'}});
 await page.route(SB+'/rest/v1/app_record_links?**',r=>r.fulfill({json:r.request().url().includes('note.kind=eq.basket')?[rec(r1,'project_id',p),rec(r2,'organization_id',o)]:f.links}));
 await open(page);
 const proposal=data();proposal.items[0].destinations=[{kind:'project',target_id:p,reason:'같은 내용',verdict:'duplicate',compared_link_ids:[r1]},{kind:'organization',target_id:o,reason:'새 사실만',verdict:'changed',compared_link_ids:[r2]}];
 await preview(page,proposal);
 const dup=page.locator('[data-classification-choice="0:0"]'),chg=page.locator('[data-classification-choice="0:1"]');
 await expect(dup).not.toBeChecked();await expect(page.locator('[data-classification-verdict="duplicate"]')).toContainText('이미 같은 내용이 기록돼 있어요');
 await expect(chg).toBeChecked();await expect(page.locator('[data-classification-verdict="changed"]')).toContainText('달라진 점만 기록해요(후속)');
 await expect(page.locator('[data-classification-summary="0:1"]')).toHaveValue('후속: 새 사실만');
 await expect(page.locator('[data-classification-summary="0:0"]')).toHaveValue('같은 내용');
 for(const box of await page.locator('.basket-classification-target').all())expect((await box.boundingBox()).height).toBeGreaterThanOrEqual(43.5);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await dup.check();await expect(dup).toBeChecked();expect(f.rpc).toHaveLength(0);
 // A compared id that belongs to another destination is not a basis: a plain new row with a small note.
 proposal.items[0].destinations=[{kind:'project',target_id:p,reason:'근거 없는 판정',verdict:'duplicate',compared_link_ids:[r2]}];
 await preview(page,proposal);
 await expect(page.locator('[data-classification-choice="0:0"]')).toBeChecked();await expect(page.locator('[data-classification-verdict="no-basis"]')).toBeVisible();await expect(page.locator('[data-classification-verdict="duplicate"]')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});
