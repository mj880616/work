import {testOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';
// BUG-바구니연결해제: the same disconnect on four screens — organization detail, project detail, basket list, note screen.
// One confirmation ("○○ 연결을 해제할까요? 메모는 남아요"), one owner-RLS row delete, then 5 seconds of [되돌리기]
// that re-links through the existing app_basket_confirm_links RPC.
test.use({hasTouch:true});
const fixture=testOrigin+'/tests/app-e2e/basket-link-detail-fixture.html',SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// Report captures go to CAPTURE_DIR when it is set (docs/review/basket-disconnect), else the test output folder.
const shot=(info,name)=>process.env.CAPTURE_DIR?`${process.env.CAPTURE_DIR}/${name}`:info.outputPath(name);
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();}
const accept=page=>{const messages=[];page.once('dialog',d=>{messages.push(d.message());d.accept();});return messages;};
const undo=page=>page.locator('[data-undo-notice]');

// ---- organization and project detail (shared detail fixture) ----
async function ready(page,kind){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(fixture);await expect.poll(()=>page.evaluate(()=>window.__detailReady===true)).toBe(true);
 await page.evaluate(kind=>{const s=window.__detailState;s.notes[0].archived_at=null;s.notes[0].updated_at='2026-10-11T01:30:00Z';window.__went=[];window.KPTURouter.go=(view,options)=>window.__went.push([view,options]);window.__linkEvents=0;addEventListener('kptu:basket-links-changed',()=>window.__linkEvents++);
  if(kind==='project')for(const row of s.links){row.project_id=s.ids.project;row.organization_id=null}},kind);
 await page.evaluate(kind=>{const s=window.__detailState;return kind==='organization'?window.KPTUWorkplace.open(s.ids.org):window.KPTUProjects.open(s.ids.project)},kind);
 const host=page.locator(kind==='organization'?'#wdUpdates':'#ps3-progress [data-ps3-records]');await expect(host.locator('[data-basket-link]')).toHaveCount(2);
 return {errors,host,ids:await page.evaluate(()=>window.__detailState.ids)};
}
const deletes=page=>page.evaluate(()=>(window.__detailState.deletes||[]).map(path=>{const u=new URL(path,'https://fixture.invalid');return {table:u.pathname.split('/').pop(),params:Object.fromEntries(u.searchParams)};}));
const confirms=page=>page.evaluate(()=>window.__detailState.confirms||[]);
const menuItems=(page,id)=>page.locator(`#${id} button`).allTextContents();

for(const width of [390,1280])test(`organization detail: line opens the note, ⋯ disconnects with one confirmation, [되돌리기] re-links ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const {errors,host,ids}=await ready(page,'organization'),row=host.locator(`[data-basket-link="${ids.link}"]`);
 const more=row.getByRole('button',{name:'정리함 기록 메뉴'});
 const box=await more.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await tap(page,more,width);await expect(page.locator('#basketLinkMenu')).toBeVisible();
 expect(await menuItems(page,'basketLinkMenu')).toEqual(['업데이트 열기','연결 해제','요약 수정','원문 삭제']);
 if(width===390)await page.screenshot({path:info.outputPath('org-menu-390.png')});
 const messages=accept(page);await tap(page,page.locator('#basketLinkMenu').getByRole('button',{name:'연결 해제'}),width);
 await expect(row).toHaveCount(0);expect(messages).toEqual(['합성 담당조직 연결을 해제할까요? 업데이트는 남아요']);
 expect(await deletes(page)).toEqual([{table:'app_record_links',params:{id:'eq.'+ids.link,workspace_id:'eq.detail-workspace',select:'id'}}]);
 expect(await page.evaluate(n=>window.__detailState.notes.some(x=>x.id===n),ids.note)).toBe(true);
 // The notice sits inside the open dialog so its focus loop reaches [되돌리기].
 const notice=page.locator('#wdModal [data-undo-notice]');await expect(notice).toBeVisible();await expect(notice).toContainText('합성 담당조직 연결을 해제했어요. 업데이트는 남아요.');
 if(width===390)await page.screenshot({path:info.outputPath('org-undo-390.png')});
 await tap(page,notice.getByRole('button',{name:'되돌리기'}),width);
 await expect(notice).toContainText('연결을 되돌렸어요.');await expect(host.locator('[data-basket-link]')).toHaveCount(2);await expect(host).toContainText('연결 요약');
 expect(await confirms(page)).toEqual([{p_note_id:ids.note,p_note_updated_at:'2026-10-11T01:30:00Z',p_targets:[{kind:'organization',target_id:ids.org,reason:'직접 연결',summary:'연결 요약'}]}]);
 expect(await page.evaluate(()=>window.__detailState.links.length)).toBe(2);expect(errors).toEqual([]);
});

test('organization detail: tapping the line (or [메모 열기]) opens the original note in the basket',async({page})=>{
 const {errors,host,ids}=await ready(page,'organization'),row=host.locator(`[data-basket-link="${ids.link}"]`);
 await expect(row.locator('a[data-basket-link-open]')).toHaveAttribute('href',`./?view=basket&note=${ids.note}`);
 await row.locator('a[data-basket-link-open]').click();await expect(page.locator('#wdModal')).toBeHidden();
 expect(await page.evaluate(()=>window.__went)).toEqual([['basket',{source:'delegated'}]]);
 await page.evaluate(()=>window.KPTUWorkplace.open(window.__detailState.ids.org));await expect(host.locator('[data-basket-link]')).toHaveCount(2);
 await host.locator(`[data-basket-link="${ids.nullLink}"]`).getByRole('button',{name:'정리함 기록 메뉴'}).click();await page.locator('#basketLinkMenu').getByRole('button',{name:'업데이트 열기'}).click();
 await expect(page.locator('#wdModal')).toBeHidden();expect(await page.evaluate(()=>window.__went.length)).toBe(2);expect(await deletes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('organization detail: cancelling the confirmation changes nothing and returns focus to ⋯',async({page})=>{
 const {errors,host,ids}=await ready(page,'organization'),row=host.locator(`[data-basket-link="${ids.link}"]`),more=row.getByRole('button',{name:'정리함 기록 메뉴'});
 page.once('dialog',d=>d.dismiss());await more.click();await page.locator('#basketLinkMenu').getByRole('button',{name:'연결 해제'}).click();
 await expect(more).toBeFocused();await expect(more).toBeEnabled();await expect(host.locator('[data-basket-link]')).toHaveCount(2);await expect(undo(page)).toHaveCount(0);
 expect(await deletes(page)).toEqual([]);expect(await page.evaluate(()=>window.__linkEvents)).toBe(0);expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`project detail: 🧺 ⋯ holds [업데이트 열기]·[연결 해제]·[요약 수정]; the notice ends after 5 seconds ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const {errors,host,ids}=await ready(page,'project'),row=host.locator(`[data-basket-link="${ids.link}"]`);
 await expect(row.locator('a[data-ps3-basket-note]')).toHaveAttribute('href',/view=basket&note=/);
 const more=row.getByRole('button',{name:'정리함 기록 메뉴'}),box=await more.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
 await expect(host.locator('[data-link-summary-edit],[data-link-note-delete]')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await tap(page,more,width);await expect(page.locator('#ps3RecordMenu')).toBeVisible();expect(await menuItems(page,'ps3RecordMenu')).toEqual(['업데이트 열기','연결 해제','요약 수정']);
 if(width===390)await page.screenshot({path:info.outputPath('project-menu-390.png')});
 const messages=accept(page);await tap(page,page.locator('#ps3RecordMenu').getByRole('button',{name:'연결 해제'}),width);
 await expect(row).toHaveCount(0);expect(messages).toEqual(['합성 프로젝트 연결을 해제할까요? 업데이트는 남아요']);await expect(host.locator('[data-basket-link]')).toHaveCount(1);
 expect(await deletes(page)).toEqual([{table:'app_record_links',params:{id:'eq.'+ids.link,workspace_id:'eq.detail-workspace',select:'id'}}]);
 const notice=page.locator('#ps3DetailModal [data-undo-notice]');await expect(notice).toBeVisible();await expect(notice).toContainText('합성 프로젝트 연결을 해제했어요.');
 if(width===390)await page.screenshot({path:info.outputPath('project-undo-390.png')});
 // No undo: after 5 seconds the notice goes away and nothing is re-linked.
 await expect(notice).toHaveCount(0,{timeout:7000});expect(await confirms(page)).toEqual([]);await expect(host.locator('[data-basket-link]')).toHaveCount(1);expect(errors).toEqual([]);
});

test('project detail: [되돌리기] re-links the same project with its summary; a cancelled confirmation sends nothing',async({page})=>{
 const {errors,host,ids}=await ready(page,'project'),row=host.locator(`[data-basket-link="${ids.link}"]`),more=row.getByRole('button',{name:'정리함 기록 메뉴'});
 page.once('dialog',d=>d.dismiss());await more.click();await page.locator('#ps3RecordMenu').getByRole('button',{name:'연결 해제'}).click();
 await expect(more).toBeFocused();expect(await deletes(page)).toEqual([]);await expect(undo(page)).toHaveCount(0);
 accept(page);await more.click();await page.locator('#ps3RecordMenu').getByRole('button',{name:'연결 해제'}).click();await expect(row).toHaveCount(0);
 await page.locator('#ps3DetailModal [data-undo-notice]').getByRole('button',{name:'되돌리기'}).click();
 await expect(page.locator('#ps3DetailModal [data-undo-notice]')).toContainText('연결을 되돌렸어요.');await expect(host.locator('[data-basket-link]')).toHaveCount(2);await expect(host).toContainText('연결 요약');
 expect(await confirms(page)).toEqual([{p_note_id:ids.note,p_note_updated_at:'2026-10-11T01:30:00Z',p_targets:[{kind:'project',target_id:ids.project,reason:'직접 연결',summary:'연결 요약'}]}]);
 // A refused undo (here: the note was archived meanwhile) is said plainly and changes nothing.
 await page.evaluate(()=>{window.__detailState.confirmError='NOTE_ARCHIVED'});const again=host.locator('[data-basket-link]').first();
 accept(page);await again.getByRole('button',{name:'정리함 기록 메뉴'}).click();await page.locator('#ps3RecordMenu').getByRole('button',{name:'연결 해제'}).click();await expect(host.locator('[data-basket-link]')).toHaveCount(1);
 await page.locator('#ps3DetailModal [data-undo-notice]').getByRole('button',{name:'되돌리기'}).click();
 await expect(page.locator('#ps3DetailModal [data-undo-notice]')).toContainText('보류한 업데이트라 연결을 되돌리지 못했어요.');await expect(host.locator('[data-basket-link]')).toHaveCount(1);
 await host.locator('a[data-ps3-basket-note]').first().click();await expect(page.locator('#ps3DetailModal')).toBeHidden();expect(await page.evaluate(()=>window.__went)).toEqual([['basket',{source:'delegated'}]]);
 expect(errors).toEqual([]);
});

// ---- basket list and note screen (real app shell, mocked API) ----
async function basket(page){
 const errors=[],deleted=[],confirmed=[];page.on('pageerror',e=>errors.push(e.message));
 const notes=[{id:'n',workspace_id:'w',raw_text:'연결된 메모\n둘째 줄',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:30:00Z',ai_export_allowed:true,attachments:[]}];
 const links=[{id:'l1',note_id:'n',workspace_id:'w',status:'confirmed',summary:'조직 요약',organization_id:'o',project_id:null,organization:{name:'합성 조직'}},
  {id:'l2',note_id:'n',workspace_id:'w',status:'confirmed',summary:null,organization_id:null,project_id:'p',project:{name:'테스트 프로젝트'}},
  {id:'l3',note_id:'n',workspace_id:'w',status:'confirmed',summary:null,meeting_id:'m',meeting:{title:'합성 회의'}}];
 await openHome(page);
 await page.route(SB+'/rest/v1/app_notes**',r=>{const req=r.request(),u=new URL(req.url()),id=u.searchParams.get('id')?.slice(3);if(req.method()==='GET')return r.fulfill({json:id?notes.filter(n=>n.id===id):notes});return r.fallback();});
 await page.route(SB+'/rest/v1/app_record_links?**',r=>{const req=r.request(),u=new URL(req.url()),q=u.searchParams.get('note_id');
  if(req.method()==='DELETE'){const id=u.searchParams.get('id')?.slice(3);deleted.push(Object.fromEntries(u.searchParams));const i=links.findIndex(l=>l.id===id);const removed=i<0?[]:links.splice(i,1);return r.fulfill({json:removed.map(l=>({id:l.id}))});}
  // Detail screens read confirmed note links with the note embedded (basket-link-records.js readLinkRecords).
  if(q==='not.is.null'){const pick=key=>{const v=u.searchParams.get(key);return v?.startsWith('in.(')?v.slice(4,-1).split(','):null;},orgs=pick('organization_id'),projects=pick('project_id');
   return r.fulfill({json:links.filter(l=>(l.organization_id||l.project_id)&&(!orgs||orgs.includes(l.organization_id))&&(!projects||projects.includes(l.project_id))).map(l=>({id:l.id,workspace_id:'w',summary:l.summary,note_id:l.note_id,organization_id:l.organization_id,project_id:l.project_id,status:l.status,note:{id:'n',workspace_id:'w',occurred_at:notes[0].occurred_at,raw_text:notes[0].raw_text}}))});}
  if(!q||!q.startsWith('in.('))return r.fallback();const wanted=q.slice(4,-1).split(',');return r.fulfill({json:links.filter(l=>wanted.includes(l.note_id))});});
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{const body=JSON.parse(r.request().postData());confirmed.push(body);const t=body.p_targets[0];
  links.push({id:'l'+(9+confirmed.length),note_id:body.p_note_id,workspace_id:'w',status:'confirmed',summary:t.summary??null,organization_id:t.kind==='organization'?t.target_id:null,project_id:t.kind==='project'?t.target_id:null,...(t.kind==='organization'?{organization:{name:'합성 조직'}}:{project:{name:'테스트 프로젝트'}})});
  return r.fulfill({json:{ok:true,created:1,existing:0}});});
 return {errors,deleted,confirmed,links};
}
async function openList(page,width){await tap(page,page.locator('#homeView [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible'),width);await page.locator('[data-basket-filter="classified"]').click();await expect(page.locator('[data-basket-row="n"]')).toBeVisible();return page.locator('[data-basket-row-item="n"]');}
// The × paints 24px but answers anywhere in a 44px square around its center.
async function hitArea(locator){return locator.evaluate(el=>{const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;return [[-21,0],[21,0],[0,-21],[0,21]].every(([dx,dy])=>el.contains(document.elementFromPoint(cx+dx,cy+dy)));});}

for(const scheme of ['light','dark'])for(const width of [390,1280])test(`basket list: organization/project chips have × (44px, "○○ 연결 해제"), one confirmation, [되돌리기] (${scheme}) ${width}`,async({page},info)=>{
 await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:900});const f=await basket(page),row=await openList(page,width);
 const orgX=row.getByRole('button',{name:'합성 조직 연결 해제'}),projectX=row.getByRole('button',{name:'테스트 프로젝트 연결 해제'});
 await expect(orgX).toBeVisible();await expect(projectX).toBeVisible();await expect(row.locator('[data-chip-kind="meeting"] button')).toHaveCount(0);await expect(row).toContainText('합성 회의');
 expect(await hitArea(orgX)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width===390)await page.screenshot({path:shot(info,`basket-list-390-${scheme}.png`)});
 const messages=accept(page);await tap(page,orgX,width);
 await expect(orgX).toHaveCount(0);expect(messages).toEqual(['합성 조직 연결을 해제할까요? 업데이트는 남아요']);await expect(projectX).toBeVisible();
 expect(f.deleted).toEqual([{id:'eq.l1',workspace_id:expect.any(String),select:'id'}]);
 const notice=undo(page);await expect(notice).toBeVisible();await expect(notice).toContainText('합성 조직 연결을 해제했어요. 업데이트는 남아요.');
 if(width===390)await page.screenshot({path:shot(info,`basket-list-undo-390-${scheme}.png`)});
 await tap(page,notice.getByRole('button',{name:'되돌리기'}),width);await expect(notice).toContainText('연결을 되돌렸어요.');
 await expect(row.getByRole('button',{name:'합성 조직 연결 해제'})).toBeVisible();
 expect(f.confirmed).toEqual([{p_note_id:'n',p_note_updated_at:'2026-10-06T01:30:00Z',p_targets:[{kind:'organization',target_id:'o',reason:'직접 연결',summary:'조직 요약'}]}]);expect(f.errors).toEqual([]);
});

test('basket list: cancelling the confirmation keeps the chip and focus on ×',async({page})=>{
 const f=await basket(page),row=await openList(page,1280),orgX=row.getByRole('button',{name:'합성 조직 연결 해제'});
 page.once('dialog',d=>d.dismiss());await orgX.click();await expect(orgX).toBeFocused();await expect(orgX).toBeEnabled();await expect(undo(page)).toHaveCount(0);
 expect(f.deleted).toEqual([]);expect(f.errors).toEqual([]);
});

for(const scheme of ['light','dark'])for(const width of [390,1280])test(`note screen: chip × disconnects, the notice ends after 5 seconds, the list matches (${scheme}) ${width}`,async({page},info)=>{
 await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:900});const f=await basket(page);await openList(page,width);
 await tap(page,page.locator('[data-basket-row="n"]'),width);const state=page.locator('[data-basket-detail] [data-basket-state]');await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 const projectX=state.getByRole('button',{name:'테스트 프로젝트 연결 해제'});await expect(projectX).toBeVisible();await expect(state.getByRole('button',{name:'합성 조직 연결 해제'})).toBeVisible();
 await expect(state.getByRole('button',{name:/테스트 프로젝트$/})).toBeVisible();expect(await hitArea(projectX)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width===390)await page.screenshot({path:shot(info,`note-chips-390-${scheme}.png`)});
 const messages=accept(page);await tap(page,projectX,width);
 await expect(projectX).toHaveCount(0);expect(messages).toEqual(['테스트 프로젝트 연결을 해제할까요? 업데이트는 남아요']);expect(f.deleted.map(d=>d.id)).toEqual(['eq.l2']);
 await expect(undo(page)).toBeVisible();await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 if(width===390)await page.screenshot({path:shot(info,`note-undo-390-${scheme}.png`)});
 await expect(undo(page)).toHaveCount(0,{timeout:7000});expect(f.confirmed).toEqual([]);
 await page.locator('[data-basket-close]').click();const row=page.locator('[data-basket-row-item="n"]');
 await expect(row.getByRole('button',{name:'테스트 프로젝트 연결 해제'})).toHaveCount(0);await expect(row.getByRole('button',{name:'합성 조직 연결 해제'})).toBeVisible();expect(f.errors).toEqual([]);
});

test('note screen: tapping a chip opens that project; its 🧺 line opens back the note',async({page})=>{
 const f=await basket(page);await openList(page,1280);await page.locator('[data-basket-row="n"]').click();
 await page.locator('[data-basket-state] [data-basket-chip-open="l2"]').click();
 await expect(page.locator('#ps3DetailModal')).toBeVisible();await expectProjectTitle(page,'테스트 프로젝트',{contains:true});expect(f.deleted).toEqual([]);expect(f.errors).toEqual([]);
});

test('a disconnect in an open detail re-reads the basket list underneath (shared event)',async({page})=>{
 const f=await basket(page),row=await openList(page,1280);await expect(row.getByRole('button',{name:'합성 조직 연결 해제'})).toBeVisible();
 f.links.splice(0,1);await page.evaluate(()=>dispatchEvent(new Event('kptu:basket-links-changed')));
 await expect(row.getByRole('button',{name:'합성 조직 연결 해제'})).toHaveCount(0);await expect(row.getByRole('button',{name:'테스트 프로젝트 연결 해제'})).toBeVisible();expect(f.errors).toEqual([]);
});

// Report captures of the two detail screens inside the real app shell, light and dark, at 390.
for(const scheme of ['light','dark'])test(`detail screens in the app: ⋯ menu and undo notice (${scheme}) 390`,async({page},info)=>{
 await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width:390,height:900});const f=await basket(page);await openList(page,390);
 await page.evaluate(async()=>{await window.KPTUViewLoader.load('team');await window.KPTUWorkplace.open('o');});
 const org=page.locator('#wdUpdates [data-basket-link="l1"]');await expect(org).toBeVisible();await expect(org).toContainText('조직 요약');
 await org.getByRole('button',{name:'정리함 기록 메뉴'}).click();await expect(page.locator('#basketLinkMenu')).toBeVisible();
 await page.screenshot({path:shot(info,`org-menu-390-${scheme}.png`)});
 accept(page);await page.locator('#basketLinkMenu').getByRole('button',{name:'연결 해제'}).click();await expect(org).toHaveCount(0);
 await expect(page.locator('#wdModal [data-undo-notice]')).toBeVisible();await page.screenshot({path:shot(info,`org-undo-390-${scheme}.png`)});
 await page.locator('#wdModal [data-undo-notice]').getByRole('button',{name:'되돌리기'}).click();await expect(page.locator('#wdUpdates [data-basket-link]')).toHaveCount(1);
 await page.locator('[data-wd-close="wdModal"]').click();await expect(page.locator('#wdModal')).toBeHidden();
 await page.evaluate(async()=>{await window.KPTUViewLoader.load('projects');await window.KPTUProjects.open('p');});
 const project=page.locator('#ps3-progress [data-basket-link="l2"]');await expect(project).toBeVisible();
 await project.getByRole('button',{name:'정리함 기록 메뉴'}).click();await expect(page.locator('#ps3RecordMenu')).toBeVisible();
 await page.screenshot({path:shot(info,`project-menu-390-${scheme}.png`)});
 accept(page);await page.locator('#ps3RecordMenu').getByRole('button',{name:'연결 해제'}).click();await expect(project).toHaveCount(0);
 await expect(page.locator('#ps3DetailModal [data-undo-notice]')).toBeVisible();await page.screenshot({path:shot(info,`project-undo-390-${scheme}.png`)});
 expect(f.deleted.map(d=>d.id)).toEqual(['eq.l1','eq.l2']);expect(f.confirmed).toHaveLength(1);expect(f.errors).toEqual([]);
});
