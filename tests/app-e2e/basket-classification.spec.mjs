import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
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
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 return {...f,note,links,rpc,errors,events,setMissing:v=>missing=v,setRejected:v=>rejected=v};
}
async function open(page){await page.locator('[data-classification-open]').click();await expect(page.locator('[data-classification-input]')).toBeFocused();}
async function preview(page,proposal=data()){await page.locator('[data-classification-input]').fill(JSON.stringify(proposal,null,2));await page.locator('[data-classification-preview]').click();await expect(page.locator('[data-classification-note]')).toHaveCount(proposal.items.length);}
for(const width of [390,1280]){
 test(`classification paste preview errors selected confirm and copy notification ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page);await page.locator('[data-classification-open]').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-classification-input]')).toBeFocused();
 await page.screenshot({path:info.outputPath(`paste-${width}.png`),fullPage:true});
 await page.locator('[data-classification-input]').fill('説明\n'+JSON.stringify(data()));await page.locator('[data-classification-preview]').click();await expect(page.locator('[data-classification-status]')).toContainText('행');await expect(page.locator('[data-classification-confirm]')).toBeDisabled();
 f.note.updated_at='2026-10-11T01:02:03.123457Z';await preview(page);await expect(page.locator('[data-classification-note]')).toContainText('원문 바뀜');await expect(page.locator('[data-classification-choice]:enabled')).toHaveCount(0);await page.screenshot({path:info.outputPath(`preview-error-${width}.png`),fullPage:true});
 f.note.updated_at=stamp;await preview(page);await expect(page.locator('[data-classification-note]')).toContainText(f.note.raw_text.trim());await expect(page.locator('[data-classification-note]')).toContainText('현재 프로젝트');await expect(page.locator('[data-classification-note]')).toContainText('다음 단계에서 지원(4b)');await expect(page.locator('[data-classification-note] img,[data-classification-note] a')).toHaveCount(0);
 const check=page.locator('[data-classification-choice]:enabled').first();await check.focus();await page.keyboard.press('Space');await expect(check).toBeChecked();await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('새로 확정 1');
 expect(f.rpc[0].p_targets).toHaveLength(1);expect(f.rpc[0].p_targets[0].kind).toBe('project');expect(Object.keys(f.rpc[0])).toEqual(['p_note_id','p_note_updated_at','p_targets']);await expect(page.locator('[data-basket-row]')).toHaveCount(0);await expect(page.locator('[data-classification-note]')).toContainText('이미 확정');
 await page.locator('[data-classification-close]').click();await page.locator('[data-basket-filter="all"]').click();await expect(page.locator('[data-basket-row]')).toContainText('확정');await expect(page.locator('[data-basket-row]')).toContainText('현재 프로젝트');await page.screenshot({path:info.outputPath(`confirmed-${width}.png`),fullPage:true});
 expect(await page.evaluate(()=>window.__basketSaved.some(e=>e.path==='/rest/v1/rpc/app_basket_confirm_links'))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(f.errors).toEqual([]);
 });
 test(`classification function unavailable isolated and stale revalidation ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page);await open(page);await preview(page);f.setMissing(true);await page.locator('[data-classification-choice]:enabled').first().check();await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('확정 기능 준비 중');expect(f.links).toHaveLength(0);
 await page.locator('[data-classification-close]').click();await page.locator('[data-basket-row]').click();await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);await page.keyboard.press('Escape');await open(page);f.setMissing(false);await preview(page);await page.locator('[data-classification-choice]:enabled').first().check();f.setRejected('NOTE_CHANGED');await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('원문 바뀜');await expect(page.locator('[data-classification-choice]:enabled')).toHaveCount(0);
 expect(f.errors).toEqual(['Failed to load resource: the server responded with a status of 404 (Not Found)']);
 });
}
test('classification input changes invalidate selection; session change clears private proposal and late preview',async({page})=>{
 const f=await fixture(page);await open(page);await preview(page);await page.locator('[data-classification-choice]:enabled').first().check();await page.locator('[data-classification-input]').fill('PRIVATE_PROPOSAL_DRAFT');await expect(page.locator('[data-classification-confirm]')).toBeDisabled();await expect(page.locator('[data-classification-choice]')).toHaveCount(0);
 const cdp=await page.context().newCDPSession(page);const stored=JSON.stringify(await Promise.all([true,false].map(isLocalStorage=>cdp.send('DOMStorage.getDOMStorageItems',{storageId:{securityOrigin:'http://127.0.0.1:8123',isLocalStorage}}))));expect(stored).not.toContain('PRIVATE_PROPOSAL_DRAFT');
 await page.evaluate(()=>{const rt=window.KPTURuntime,c=rt.context.read();rt.context.set({...c,user:{...c.user,id:'different'}});window.dispatchEvent(new CustomEvent('kptu:session-changed'));});await expect(page.locator('[data-classification-input]')).toHaveValue('');await expect(page.locator('[data-classification-panel]')).toBeHidden();expect(f.rpc).toHaveLength(0);
});

test('classification pending preview cannot restore private content after workspace changes',async({page})=>{
 await fixture(page);await open(page);let release;const held=new Promise(r=>release=r);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await held;await r.fallback();});
 await page.locator('[data-classification-input]').fill(JSON.stringify(data()));await page.locator('[data-classification-preview]').click();await expect(page.locator('[data-classification-preview]')).toBeDisabled();
 await page.evaluate(()=>{const rt=window.KPTURuntime,c=rt.context.read();rt.context.set({...c,workspace:{...c.workspace,id:'other-workspace'}});window.dispatchEvent(new CustomEvent('kptu:session-changed'));});release();
 await expect(page.locator('[data-classification-input]')).toHaveValue('');await expect(page.locator('[data-classification-note]')).toHaveCount(0);await expect(page.locator('[data-classification-panel]')).toBeHidden();
});
test('classification touch selection and busy duplicate press sends one confirmation',async({page})=>{
 await page.setViewportSize({width:390,height:1000});const f=await fixture(page);await open(page);await preview(page);const choice=page.locator('[data-classification-choice]:enabled').first();await choice.scrollIntoViewIfNeeded();const box=await choice.boundingBox();await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await expect(choice).toBeChecked();
 let release;const held=new Promise(r=>release=r);await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',async r=>{await held;await r.fallback();});
 await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-confirm]')).toBeDisabled();await page.locator('[data-classification-confirm]').dispatchEvent('click');release();await expect(page.locator('[data-classification-status]')).toContainText('새로 확정 1');expect(f.rpc).toHaveLength(1);expect(f.errors).toEqual([]);
});
