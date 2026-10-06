import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const quick=page=>page.locator('[data-home-quick]');
test('quick task starts folded and opens on focus',async({page})=>{
 await openHome(page); const q=page.locator('[data-home-quick]');
 await expect(q.locator('[data-quick-input]')).toBeVisible();
 await expect(q.locator('[data-quick-options]')).toBeHidden();
 await q.locator('[data-quick-input]').focus();
 await expect(q.locator('[data-quick-options]')).toBeVisible();
});
test('quick task KST midnight, project, IME, partial success and request lock',async({page})=>{
 const {requests}=await openHome(page); const q=quick(page),input=q.locator('[data-quick-input]');
 await input.fill('QA');await expect(q.locator('[data-quick-project] option[value="child"]')).toHaveCount(1);
 await q.locator('[data-quick-project]').selectOption('child');
 await page.clock.setFixedTime(new Date('2026-10-06T15:00:00Z'));
 await q.getByRole('button',{name:'오늘',exact:true}).click();
 await q.getByRole('button',{name:'오늘',exact:true}).click();await expect(q.getByRole('button',{name:'오늘',exact:true})).toHaveAttribute('aria-pressed','false');
 await q.getByRole('button',{name:'내일',exact:true}).click();
 const bodies=[];let release;const pending=new Promise(r=>release=r);
 await page.route(SB+'/functions/v1/google-tasks?action=create',async route=>{bodies.push(route.request().postDataJSON());await pending;await route.fulfill({json:{link_error:true,task:{id:'new'}}});});
 await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});expect(bodies).toHaveLength(0);
 const before=requests.length;await q.locator('[data-quick-save]').click();
 await expect(input).toBeDisabled();await expect(q.locator('[data-quick-mode="update"]')).toBeDisabled();
 await q.locator('[data-quick-save]').dispatchEvent('click');release();
 await expect(input).toHaveValue('');expect(bodies).toHaveLength(1);expect(bodies[0]).toMatchObject({due:'2026-10-08',links:[{project_id:'child'}]});
 await expect(q.locator('[data-quick-options]')).toBeHidden();await expect(page.locator('#toast')).toContainText('할 일은 추가됨, 프로젝트 연결 실패');
 await expect.poll(()=>requests.slice(before).filter(r=>r.action==='overview').length).toBe(1);
 expect(requests.slice(before).filter(r=>r.path.includes('google-calendar')||r.path.includes('app_project_milestones')||r.path.includes('app_suborganization_updates'))).toHaveLength(0);
});
test('quick task none/today/custom due, Enter and failure retains content',async({page})=>{
 await openHome(page);const q=quick(page),input=q.locator('[data-quick-input]'),bodies=[];
 await page.route(SB+'/functions/v1/google-tasks?action=create',async r=>{bodies.push(r.request().postDataJSON());await r.fulfill({status:500,json:{message:'QA error'}});});
 await input.fill('QA');await input.press('Enter');await expect(q.locator('[data-quick-status]')).toContainText('QA error');expect(bodies[0].due).toBeNull();await expect(input).toHaveValue('QA');
 await page.clock.setFixedTime(new Date('2026-10-06T14:59:59Z'));await q.getByRole('button',{name:'오늘',exact:true}).click();await input.press('Enter');await expect.poll(()=>bodies.length).toBe(2);expect(bodies[1].due).toBe('2026-10-06');
 await expect(input).toBeEnabled();await q.locator('[data-quick-date]').evaluate(el=>{el.value='2026-10-09';el.dispatchEvent(new Event('change',{bubbles:true}));});
 await expect(q.getByRole('button',{name:'10.9',exact:true})).toBeVisible();await input.press('Enter');await expect.poll(()=>bodies.length).toBe(3);expect(bodies[2].due).toBe('2026-10-09');
 await expect(input).toBeEnabled();await q.getByRole('button',{name:'10.9',exact:true}).click();await expect(q.getByRole('button',{name:'날짜',exact:true})).toHaveAttribute('aria-pressed','false');
 await input.fill(' ');await input.press('Enter');expect(bodies).toHaveLength(3);
});
test('quick update requires org, preserves multiline, saves and refreshes updates only',async({page})=>{
 const {requests}=await openHome(page);const q=quick(page),input=q.locator('[data-quick-input]');
 await q.locator('[data-quick-mode="update"]').click();await input.fill('1\n2\n3\n4\n5\n6\n7');await expect(input).toHaveCSS('height','146px');await input.press('Enter');await expect(input).toHaveValue('1\n2\n3\n4\n5\n6\n7\n');await input.fill('첫 줄\n둘째 줄');
 await q.locator('[data-quick-mode="task"]').click();await expect(input).toHaveValue('첫 줄\n둘째 줄');await q.locator('[data-quick-mode="update"]').click();
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText('조직');await expect(q.locator('[data-quick-org]')).toBeFocused();
 await q.locator('[data-quick-org]').selectOption('o');let fail=true,bodies=[];
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({status:fail?500:200,json:fail?{message:'QA error'}:[]});});
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText('QA error');await expect(input).toHaveValue('첫 줄\n둘째 줄');
 fail=false;const before=requests.length;await q.locator('[data-quick-save]').click();await expect(input).toHaveValue('');expect(bodies[1]).toEqual({organization_id:'o',raw_text:'첫 줄\n둘째 줄',created_by:'home-test'});
 await expect.poll(()=>requests.slice(before).filter(r=>r.path.endsWith('app_suborganization_updates')).length).toBe(1);
 expect(requests.slice(before).filter(r=>r.action==='overview'||r.path.includes('google-calendar'))).toHaveLength(0);
});
test('recent three unique organizations precede common organization order',async({page})=>{
 await openHome(page);
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:['a','b','c','d','e'].map(id=>({id,name:'QA '+id,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:['a','b','c','d'].map(organization_id=>({organization_id}))}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:['e','c','c','a','d','b'].map(organization_id=>({organization_id,occurred_at:'2026-10-06'}))}));
 await page.reload();const q=quick(page);await q.locator('[data-quick-mode="update"]').click();await q.locator('[data-quick-input]').focus();
 await expect(q.locator('[data-quick-org] optgroup[label="최근 기록"] option')).toHaveCount(3);
 expect(await q.locator('[data-quick-org] optgroup[label="최근 기록"] option').evaluateAll(xs=>xs.map(x=>x.value))).toEqual(['c','a','d']);
 expect(await q.locator('[data-quick-org] option').evaluateAll(xs=>xs.map(x=>x.value))).not.toContain('e');
});
test('mode memory failures default to task, reload guard detects hidden home draft',async({page})=>{
 await openHome(page);const q=quick(page);await q.locator('[data-quick-mode="update"]').click();await page.reload();await expect(quick(page)).toHaveAttribute('data-mode','update');
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('QA')};});await quick(page).locator('[data-quick-mode="task"]').click();await quick(page).locator('[data-quick-mode="update"]').click();await expect(quick(page)).toHaveAttribute('data-mode','task');
 await quick(page).locator('[data-quick-input]').fill('QA');expect(await page.evaluate(()=>{const detail={otherDraft:false};window.dispatchEvent(new CustomEvent('kptu:before-reload',{cancelable:true,detail}));return detail.otherDraft;})).toBe(true);
 await page.addInitScript(()=>{const read=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='kptu-home-quick-mode')throw Error('QA');return read.call(this,key);};});await page.reload();await expect(quick(page)).toHaveAttribute('data-mode','task');
});
for(const width of [390,1440])test(`quick visual measurements and snapshot ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await openHome(page);const q=quick(page);await q.locator('[data-quick-input]').fill('QA');
 await expect(q.locator('[data-quick-input]')).toHaveCSS('height','40px');await expect(q.locator('[data-quick-save]')).toHaveCSS('height','40px');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`home-${width}.png`),fullPage:true});
 if(width===390){await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>400});visualViewport.dispatchEvent(new Event('resize'));});await expect(page.locator('.mobile-tabs')).toBeHidden();const b=await q.locator('[data-quick-input]').boundingBox();expect(b.y+b.height).toBeLessThan(400);}
});
test('catalog changes clear a retired selection and refresh labels during the same visit',async({page})=>{
 await openHome(page);const q=quick(page);await q.locator('[data-quick-input]').fill('QA');await q.locator('[data-quick-project]').selectOption('child');
 await page.evaluate(()=>{const cat=window.KPTUProjectCatalog,s=cat.snapshot();cat.publish({workspaceId:s.workspaceId,userId:s.userId,spaces:s.spaces.map(p=>({...p,name:'QA renamed',status:p.id==='child'?'archived':p.status}))});});
 await expect(q.locator('[data-quick-project] option[value="child"]')).toHaveCount(0);await expect(q.locator('[data-quick-project]')).toHaveValue('');
 await expect(q.locator('[data-quick-project] option[value="p"]')).toHaveText('QA renamed');
 const bodies=[];await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({json:{task:{id:'new'}}});});
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(bodies[0].links).toEqual([]);
});
test('stale post-save refresh cannot overwrite a restarted home',async({page})=>{
 await openHome(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(SB+'/functions/v1/google-tasks?action=create',r=>r.fulfill({json:{task:{id:'new'}}}));
 let release,count=0;const pending=new Promise(r=>release=r);
 await page.route('**/functions/v1/google-tasks?action=overview*',async r=>{count++;if(count===1)await pending;return r.fulfill({json:{connected:true,authorized:true,pending_scope:'all',tasks:[]}});});
 await quick(page).locator('[data-quick-input]').fill('QA');await quick(page).locator('[data-quick-save]').click();await expect.poll(()=>count).toBe(1);
 await page.evaluate(()=>window.KPTUHome.start({freshTasks:true}));release();await expect(page.locator('[data-home-card="tasks"]')).toHaveAttribute('data-state','ready');expect(errors).toEqual([]);
});
test('stale post-save refresh after session loss has no detached-card error',async({page})=>{
 await openHome(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(SB+'/functions/v1/google-tasks?action=create',r=>r.fulfill({json:{task:{id:'new'}}}));
 let release,count=0;const pending=new Promise(r=>release=r);
 await page.route('**/functions/v1/google-tasks?action=overview*',async r=>{count++;await pending;return r.fulfill({json:{connected:true,authorized:true,pending_scope:'all',tasks:[]}});});
 await quick(page).locator('[data-quick-input]').fill('QA');await quick(page).locator('[data-quick-save]').click();await expect.poll(()=>count).toBe(1);
 await page.evaluate(()=>{window.KPTURuntime.context.clear();window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:null}}));});release();
 await expect(page.locator('[data-home-card="tasks"]')).toHaveCount(0);await expect(page).toHaveURL(/login/);expect(errors).toEqual([]);
});
test('organization detail retains the existing shared inbox save payload and failure draft',async({page})=>{
 await openHome(page);await page.locator('[data-home-org]').click();await expect(page.locator('#wdModal')).toBeVisible();
 const bodies=[];let fail=true;await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({status:fail?500:200,json:fail?{message:'QA error'}:[]});});
 await page.locator('#wdInboxText').fill('첫 줄\n둘째 줄');await page.locator('#wdInboxSave').click();await expect(page.locator('#wdInboxState')).toContainText('QA error');await expect(page.locator('#wdInboxText')).toHaveValue('첫 줄\n둘째 줄');
 fail=false;await page.locator('#wdInboxSave').click();await expect(page.locator('#wdInboxText')).toHaveValue('');expect(bodies[1]).toEqual({organization_id:'o',raw_text:'첫 줄\n둘째 줄',created_by:'home-test'});
});
test('task screen saveEditor retains shared create title notes due and links',async({page})=>{
 await openHome(page);const bodies=[];await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({json:{task:{id:'new'}}});});
 await page.locator('[data-home-card="tasks"] [data-goto="tasks"]').click();await page.locator('#newTaskBtn').click();await expect(page.locator('#gtTaskModal')).toBeVisible();
 await page.locator('#gtEditTitle').fill('QA');await page.locator('#gtEditNotes').fill('QA notes');await page.locator('#gtEditDue').fill('2026-10-09');await page.locator('[data-gt-link][value="p:child"]').check();await page.locator('#gtSaveBtn').click();
 await expect(page.locator('#gtTaskModal')).toBeHidden();expect(bodies[0]).toMatchObject({title:'QA',notes:'QA notes',due:'2026-10-09',links:[{project_id:'child'}]});
});
test('quick add and show-all link respond in the transparent 44px target',async({page})=>{
 await page.setViewportSize({width:390,height:1000});await openHome(page);const q=quick(page),bodies=[];
 await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({json:{task:{id:'new'}}});});
 await q.locator('[data-quick-input]').fill('QA');const add=await q.locator('[data-quick-save]').boundingBox();await page.mouse.click(add.x+add.width/2,add.y-1);
 await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(bodies).toHaveLength(1);
 await page.locator('[data-home-unlinked]').click();const show=page.locator('[data-gt-show-all]');await expect(show).toHaveText('전체 보기 ›');await expect(show).toHaveCSS('font-size','12px');await expect(show).toHaveCSS('font-weight','700');await expect(show).toHaveCSS('border-top-width','0px');
 const hit=await show.boundingBox();await page.mouse.click(hit.x+hit.width/2,hit.y+hit.height/2-21);await expect(show).toHaveCount(0);await expect(page.locator('[data-gt-overdue]')).toBeVisible();
});
test('recent organization paging finds three unique choices beyond repeated records',async({page})=>{
 await openHome(page);
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:['a','b','c'].map(id=>({id,name:'QA '+id,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:['a','b','c'].map(organization_id=>({organization_id}))}));
 const offsets=[];await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>{
   const url=new URL(r.request().url());if(!url.searchParams.has('created_by'))return r.fulfill({json:[]});
   const offset=Number(url.searchParams.get('offset'));offsets.push(offset);return r.fulfill({json:(offset===0?Array(100).fill('a'):['b','c']).map(organization_id=>({organization_id,occurred_at:'2026-10-06'}))});
 });
 await page.reload();const q=quick(page);await q.locator('[data-quick-input]').focus();
 await expect(q.locator('[data-quick-org] optgroup[label="최근 기록"] option')).toHaveCount(3);expect(offsets).toEqual([0,100]);
});
