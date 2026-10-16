import {testOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
test.use({hasTouch:true});
const fixture=testOrigin+'/tests/app-e2e/basket-link-detail-fixture.html';
const host=kind=>kind==='organization'?'#wdUpdates':'#ps3-progress [data-ps3-records]';
const title=kind=>kind==='organization'?'#wdTitle':'#ps3Title';
const modal=kind=>kind==='organization'?'#wdModal':'#ps3DetailModal';
async function ready(page,kind,width=390,history=false){
 await page.setViewportSize({width,height:900});await page.goto(fixture+(history?'?history=1':''));await expect.poll(()=>page.evaluate(()=>window.__detailReady)).toBe(true);
 await page.evaluate(kind=>{const s=window.__detailState;if(kind==='project')for(const row of s.links){row.project_id=s.ids.project;row.organization_id=null;}return kind==='organization'?KPTUWorkplace.open(s.ids.org):KPTUProjects.open(s.ids.project);},kind);
 await page.evaluate(kind=>{
  const s=window.__detailState,t=window.__transition={kind,a:kind==='organization'?s.ids.org:s.ids.project,b:kind==='organization'?s.ids.otherOrg:s.ids.child,bLink:'40000000-0000-4000-8000-000000000003',waiting:false,reads:[],error:null};
  s.links.push({...s.links[0],id:t.bLink,organization_id:kind==='organization'?t.b:null,project_id:kind==='project'?t.b:null,summary:'B 최초 요약'});
  const api=KPTURuntime.api;
  KPTURuntime.api=async(path,...args)=>{
   const u=new URL(path,'https://fixture.invalid'),table=u.pathname.split('/').pop();
   if(table==='app_record_links'&&u.searchParams.get('note_id')==='not.is.null')t.reads.push(u.searchParams.get(kind==='organization'?'organization_id':'project_id'));
   const rows=await api(path,...args);
   if(table===(kind==='organization'?'app_suborganizations':'app_project_comments')&&u.search.includes(t.b)&&!t.released){t.waiting=true;await new Promise(resolve=>t.release=resolve);if(t.fail)throw Error('합성 B 조회 실패');}
   return rows;
  };
 },kind);
}
async function startB(page){await page.evaluate(()=>{const t=__transition;t.open=Promise.resolve(t.kind==='organization'?KPTUWorkplace.open(t.b):KPTUProjects.open(t.b)).catch(e=>t.error=e.message);});await expect.poll(()=>page.evaluate(()=>__transition.waiting)).toBe(true);}
async function event(page){await page.evaluate(async()=>{const t=__transition;__detailState.links.find(row=>row.id===t.bLink).summary='B 최신 요약';window.dispatchEvent(new Event('kptu:basket-links-changed'));for(let i=0;i<20;i++)await Promise.resolve();});}
async function release(page){await page.evaluate(async()=>{const t=__transition;t.released=true;t.release();await t.open;});}
for(const kind of ['organization','project'])for(const width of [390,1280])test(`${kind} transition retains rendered ownership and replays latest refresh ${width}`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await ready(page,kind,width);const aTitle=await page.locator(title(kind)).textContent();await startB(page);await event(page);
 await expect(page.locator(title(kind))).toHaveText(aTitle);await expect(page.locator(`${host(kind)} [data-basket-link="40000000-0000-4000-8000-000000000003"]`)).toHaveCount(0);
 await expect(page.locator(`${host(kind)} [data-link-summary-form]`)).toHaveCount(0);
 if(kind==='project')await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('2');
 await release(page);await expect(page.locator(title(kind))).toHaveText(kind==='organization'?'다른 담당조직':'하위 프로젝트');await expect(page.locator(host(kind))).toContainText('B 최신 요약');await expect(page.locator(`${host(kind)} [data-basket-link]`)).toHaveCount(1);
 if(kind==='project'){await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('1');await expect(page.locator(`${host(kind)} [data-basket-link]`)).toHaveAttribute('href',/view=basket&note=/);await expect(page.locator(`${host(kind)} button`)).toHaveCount(0);}
 else{await page.locator(`${host(kind)} [data-link-summary-edit]`).tap();await expect(page.locator(`${host(kind)} textarea`)).toHaveValue('B 최신 요약');}expect(errors).toEqual([]);
});
for(const kind of ['organization'])test(`${kind} late summary save during transition refreshes the loaded destination`,async({page})=>{
 await ready(page,kind);const row=page.locator(`${host(kind)} [data-basket-link]`).first();await row.locator('[data-link-summary-edit]').click();await row.locator('textarea').fill('전환 중 늦은 A 저장');await page.evaluate(()=>{const s=__detailState;s.holdTable='app_basket_update_link_summary';s.holdTarget=s.ids.link;});await row.locator('[data-link-summary-save]').click();await expect.poll(()=>page.evaluate(()=>typeof __detailState.release)).toBe('function');
 page.once('dialog',d=>d.accept());await startB(page);await page.evaluate(async()=>{__detailState.links.find(row=>row.id===__transition.bLink).summary='B 최신 요약';__detailState.holdTable=null;__detailState.release();for(let i=0;i<30;i++)await Promise.resolve();});
 await expect(page.locator(`${host(kind)} [data-basket-link="40000000-0000-4000-8000-000000000003"]`)).toHaveCount(0);await release(page);await expect(page.locator(host(kind))).toContainText('B 최신 요약');await expect(page.locator(host(kind))).not.toContainText('전환 중 늦은 A 저장');
});
for(const kind of ['organization','project'])test(`${kind} failed destination load never publishes its records or editor`,async({page})=>{
 await ready(page,kind);const aTitle=await page.locator(title(kind)).textContent();await startB(page);await page.evaluate(()=>__transition.fail=true);await event(page);await release(page);
 await expect(page.locator(title(kind))).toHaveText(aTitle);await expect(page.locator(`${host(kind)} [data-basket-link="40000000-0000-4000-8000-000000000003"]`)).toHaveCount(0);await event(page);await expect(page.locator(`${host(kind)} [data-basket-link="40000000-0000-4000-8000-000000000003"]`)).toHaveCount(0);
 if(kind==='organization')await expect(page.locator('#wdState')).toContainText('합성 B 조회 실패');else expect(await page.evaluate(()=>__transition.error)).toBe('합성 B 조회 실패');
});
for(const kind of ['organization','project'])for(const action of ['close','session'])test(`${kind} ${action} invalidates pending transition and queued refresh`,async({page})=>{
 await ready(page,kind);await startB(page);await event(page);if(action==='session')await page.evaluate(()=>window.dispatchEvent(new Event('kptu:session-changed')));else await page.locator(kind==='organization'?'[data-wd-close="wdModal"]':'[data-ps3-close="ps3DetailModal"]').click();await release(page);await expect(page.locator(modal(kind))).toBeHidden();await expect(page.locator(`${host(kind)} [data-link-summary-form]`)).toHaveCount(0);
});
for(const kind of ['organization','project'])for(const outcome of ['success','error'])test(`${kind} reversed old ${outcome} response cannot change the new destination`,async({page})=>{
 await ready(page,kind);await page.evaluate(outcome=>{const t=__transition,api=KPTURuntime.api;t.oldOutcome=outcome;KPTURuntime.api=async(path,...args)=>{const u=new URL(path,'https://fixture.invalid'),rows=await api(path,...args);if(u.pathname.endsWith('/app_record_links')&&u.searchParams.get('note_id')==='not.is.null'&&u.search.includes(t.a)){t.oldWaiting=true;await new Promise(resolve=>t.releaseOld=resolve);if(t.oldOutcome==='error')throw Error('합성 이전 조회 실패');}return rows;};window.dispatchEvent(new Event('kptu:basket-links-changed'));},outcome);await expect.poll(()=>page.evaluate(()=>__transition.oldWaiting)).toBe(true);
 await startB(page);await event(page);await release(page);await expect(page.locator(host(kind))).toContainText('B 최신 요약');await page.evaluate(async()=>{__transition.releaseOld();for(let i=0;i<20;i++)await Promise.resolve();});await expect(page.locator(title(kind))).toHaveText(kind==='organization'?'다른 담당조직':'하위 프로젝트');await expect(page.locator(`${host(kind)} [data-basket-link]`)).toHaveCount(1);await expect(page.locator(host(kind))).toContainText('B 최신 요약');await expect(page.locator(host(kind))).not.toContainText('불러오지 못했습니다');
});
for(const kind of ['organization','project'])test(`${kind} mobile Back retires the pending destination and deferred refresh`,async({page})=>{
 await ready(page,kind,390,true);await expect(page.locator(modal(kind))).toHaveAttribute('data-kptu-history-open','1');await startB(page);await event(page);await page.evaluate(()=>history.back());await expect(page.locator(modal(kind))).toBeHidden();await release(page);await expect(page.locator(modal(kind))).toBeHidden();
});
for(const kind of ['organization','project'])test(`${kind} deferred query error belongs to the newly rendered destination`,async({page})=>{
 await ready(page,kind);await startB(page);await event(page);await page.evaluate(()=>__detailState.failLinks=true);await expect(page.locator(host(kind))).not.toContainText('불러오지 못했습니다');await release(page);await expect(page.locator(title(kind))).toHaveText(kind==='organization'?'다른 담당조직':'하위 프로젝트');await expect(page.locator(host(kind))).toContainText('불러오지 못했습니다');
});
async function queuedProjectMenu(page){
 await ready(page,'project');await page.evaluate(()=>{const t=__transition;t.released=true;history.back=()=>{t.menuBack=true};document.querySelector('#ps3Body').insertAdjacentHTML('beforeend','<div data-ps3-record="synthetic-progress"><button data-ps3-record-menu="synthetic-progress">합성 기록 메뉴</button></div>');document.querySelector('[data-ps3-record-menu]').click();return KPTUProjects.open(t.b);});await expect.poll(()=>page.evaluate(()=>__transition.menuBack)).toBe(true);
}
async function releaseMenu(page){await page.evaluate(async()=>{window.dispatchEvent(new PopStateEvent('popstate',{state:history.state}));for(let i=0;i<20;i++)await Promise.resolve();});}
test('queued project record-menu render cannot replace a newer project or its editor',async({page})=>{
 await queuedProjectMenu(page);await page.evaluate(()=>KPTUProjects.open(__transition.a));await releaseMenu(page);
 await expect(page.locator('#ps3Title')).toHaveText('합성 프로젝트');await expect(page.locator('#ps3Body')).toHaveAttribute('data-project',await page.evaluate(()=>__transition.a));await expect(page.locator(`${host('project')} [data-basket-link]`)).toHaveCount(2);expect(new URL(page.url()).searchParams.get('project')).toBe(await page.evaluate(()=>__transition.a));
 await expect(page.locator(host('project'))).toContainText('연결 요약');await expect(page.locator(`${host('project')} [data-basket-link]`).first()).toHaveAttribute('href',/view=basket&note=/);await expect(page.locator('#ps3Body [data-link-summary-edit],#ps3Body [data-link-summary-input]')).toHaveCount(0);
});
for(const action of ['route close','session'])test(`queued project record-menu render retires on ${action}`,async({page})=>{
 await queuedProjectMenu(page);if(action==='session')await page.evaluate(()=>window.dispatchEvent(new Event('kptu:session-changed')));else await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:view-changed',{detail:{view:'home'}})));await expect(page.locator('#ps3DetailModal')).toBeHidden();const before=await page.locator('#ps3Body').innerHTML();await releaseMenu(page);expect(await page.locator('#ps3Body').innerHTML()).toBe(before);expect(await page.locator('#ps3Body').getAttribute('data-project')).not.toBe(await page.evaluate(()=>__transition.b));await expect(page.locator('#ps3DetailModal')).toBeHidden();
});
