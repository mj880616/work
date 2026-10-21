import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// JOURNAL-챙길것 1단계 / AI-서버연동 S5: the "챙길 것" box on home (below 주요 일정) and above the journal day card.
// app_todo_candidates, app_todo_radar_state and ai-assist kind=todo_radar are mocked. Synthetic IDs and text only.
// The clock is 2026-10-06 10:00 KST (openHome). Nothing here calls a real server.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const SRC='c0000000-0000-4000-8000-000000000101',ORG='c0000000-0000-4000-8000-000000000201';
const cand=(n,over={})=>({id:id(n),kind:'request',summary:`가상 요청 ${n}`,due:null,source_kind:'basket',source_id:SRC,source_day:'2026-10-06',evidence:`근거 ${n}`,project_id:null,organization_id:null,status:'open',task_id:null,created_at:`2026-10-06T00:0${n%10}:00Z`,decided_at:null,...over});
const resourceNoise=text=>/Failed to load resource|net::ERR_FAILED/.test(text);

async function fixture(page,{rows=[cand(1,{kind:'deadline',due:'2026-10-09',summary:'가상 의견 제출'}),cand(2,{source_kind:'org_update',organization_id:ORG,summary:'가상 조직 회신'})],tables=true,fn='ok',state={last_success_at:'2026-10-06T00:30:00Z',last_partial:false},width=1280}={}){
 await page.setViewportSize({width,height:900});
 const f=await openHome(page);
 // Calls are counted only from the reloaded page; the first page (before these routes) may still be finishing.
 let armed=false;
 const db={rows:structuredClone(rows),state:structuredClone(state)},calls={ai:[],patch:[],reads:[]},errors=[],queue=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!resourceNoise(m.text()))errors.push(m.text());});
 const missing=route=>route.fulfill({status:404,json:{code:'PGRST205',message:"Could not find the table 'public.x' in the schema cache"}});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',async route=>{
  if(!tables)return missing(route);
  const req=route.request(),q=new URL(req.url()).searchParams,method=req.method();
  const hit=()=>db.rows.filter(r=>[...q.entries()].every(([k,v])=>{
   if(['select','order','limit'].includes(k))return true;
   const [op,...rest]=v.split('.'),val=rest.join('.'),cell=String(r[k]);
   if(k==='workspace_id')return true;
   return op==='eq'?cell===val:op==='gte'?cell>=val:op==='lte'?cell<=val:true;}));
  if(method==='GET'){calls.reads.push(Object.fromEntries([...q.keys()].map(k=>[k,q.getAll(k).join('&')])));return route.fulfill({json:hit()});}
  if(method==='PATCH'){const body=req.postDataJSON(),h=hit();calls.patch.push({query:Object.fromEntries(q),body});for(const r of h)Object.assign(r,body);return route.fulfill({json:h.map(r=>({id:r.id,status:r.status,task_id:r.task_id,decided_at:r.decided_at}))});}
  return route.fulfill({status:405,json:{}});
 });
 await page.route(SB+'/functions/v1/ai-assist',async route=>{
  if(route.request().method()!=='POST')return route.fulfill({status:204});
  const body=route.request().postDataJSON();if(armed)calls.ai.push(body);
  if(fn==='missing')return route.fulfill({status:404,json:{code:'NOT_FOUND',message:'Requested function was not found'}});
  // Queued replies answer [다시 찾기] only; the automatic first look of the day always gets the default.
  const next=body.mode==='again'?queue.shift():null;
  if(next)return route.fulfill(next);
  if(body.mode==='auto')return route.fulfill({json:{ok:true,kind:'todo_radar',skipped:true,checked_at:db.state?.last_success_at??null,partial:db.state?.last_partial===true}});
  return route.fulfill({json:{ok:true,kind:'todo_radar',added:0,found:0,partial:false,checked_at:'2026-10-06T01:00:00Z',promises:[]}});
 });
 // The home starts before these routes exist; start again from a fresh page so every radar read hits them.
 page.once('framenavigated',()=>{armed=true;});
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 return {...f,db,calls,errors,queue};
}
const radar=page=>page.locator('#homeView [data-home-card="radar"]');
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const pressHeight=button=>button.evaluate(el=>Math.max(el.getBoundingClientRect().height,parseFloat(getComputedStyle(el,'::after').height)||0));

for(const width of [390,1280])test(`home: 챙길 것 below 주요 일정 (PC right column, phone under the quick input), auto find once ${width}`,async({page},info)=>{
 const f=await fixture(page,{width});const box=radar(page);
 await expect(box).toBeVisible();
 await expect(box.locator('h3')).toContainText('챙길 것');
 await expect(box.locator('[data-radar-row]')).toHaveCount(2);
 await expect(box.locator('[data-radar-row]').first()).toContainText('마감');await expect(box.locator('[data-radar-row]').first()).toContainText('가상 의견 제출');
 await expect(box.locator('[data-radar-row]').first()).toContainText('업데이트 10. 6. · 기한 10. 9.');
 await expect(box.locator('[data-radar-checked]')).toContainText('마지막 찾기');
 // The first open of the day asks once with mode auto (the server answers skipped) and only kind+mode are sent.
 await expect.poll(()=>f.calls.ai.length).toBe(1);expect(f.calls.ai[0]).toEqual({kind:'todo_radar',mode:'auto'});
 const order=await page.evaluate(()=>{const dday=document.querySelector('[data-home-card="dday"]'),radar=document.querySelector('[data-home-card="radar"]'),cal=document.querySelector('[data-home-card="calendar"]');
  return {sameColumn:dday.parentElement===radar.parentElement,next:dday.nextElementSibling===radar,column:radar.parentElement.dataset.homeColumn,beforeCalendar:!!(radar.compareDocumentPosition(cal)&Node.DOCUMENT_POSITION_FOLLOWING)};});
 expect(order.sameColumn&&order.next).toBe(true);
 expect(order.column).toBe(width>=1024?'aside':'main');
 if(width<1024)expect(order.beforeCalendar).toBe(true);
 for(const name of ['할 일로','무시'])expect(await pressHeight(box.getByRole('button',{name}).first())).toBeGreaterThanOrEqual(44);
 expect(await noWideScroll(page)).toBe(true);
 if(width===390)await page.screenshot({path:info.outputPath('todo-radar-home-390.png'),fullPage:true});
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`[할 일로]: title and due can be changed, one Google task through the existing create, then the row leaves ${width}`,async({page})=>{
 const f=await fixture(page,{width});const box=radar(page);
 const creates=[];page.on('request',r=>{if(r.url().includes('/functions/v1/google-tasks')&&new URL(r.url()).searchParams.get('action')==='create')creates.push(r.postDataJSON());});
 const row=box.locator(`[data-radar-row="${id(2)}"]`);
 await tap(page,row.getByRole('button',{name:'할 일로'}),width);
 const title=row.locator('[data-radar-title]');await expect(title).toBeFocused();await expect(title).toHaveValue('가상 조직 회신');
 await title.fill('가상 조직에 회신하기');await row.locator('[data-radar-due]').fill('2026-10-08');
 await tap(page,row.getByRole('button',{name:'할 일 만들기'}),width);
 await expect(box.locator(`[data-radar-row="${id(2)}"]`)).toHaveCount(0);
 await expect(box.locator('[data-radar-status-line]')).toHaveText('할 일로 옮겼어요.');
 expect(creates).toEqual([{action:'create',task_id:null,title:'가상 조직에 회신하기',notes:'',due:'2026-10-08',links:[{organization_id:ORG}]}]);
 expect(f.calls.patch).toHaveLength(1);
 expect(f.calls.patch[0].query.status).toBe('eq.open');expect(f.calls.patch[0].body).toMatchObject({status:'tasked',task_id:expect.stringMatching(/^home-created-/)});
 expect(f.errors).toEqual([]);
});

test('[할 일로] with an empty title asks for one and creates nothing; [취소] returns to the row',async({page})=>{
 const f=await fixture(page);const box=radar(page),row=box.locator(`[data-radar-row="${id(1)}"]`);
 const creates=[];page.on('request',r=>{if(r.url().includes('action=create'))creates.push(1);});
 await row.getByRole('button',{name:'할 일로'}).click();
 await row.locator('[data-radar-title]').fill('  ');await row.getByRole('button',{name:'할 일 만들기'}).click();
 await expect(row.locator('.radar-row-status')).toHaveText('할 일 제목을 써 주세요.');await expect(row.locator('[data-radar-title]')).toBeFocused();
 await row.getByRole('button',{name:'취소'}).click();
 await expect(row.getByRole('button',{name:'할 일로'})).toBeFocused();
 expect(creates).toEqual([]);expect(f.calls.patch).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`[무시] hides the row with 5 s [되돌리기] ${width}`,async({page})=>{
 const f=await fixture(page,{width});const box=radar(page);
 await tap(page,box.locator(`[data-radar-row="${id(1)}"]`).getByRole('button',{name:'무시'}),width);
 await expect(box.locator(`[data-radar-row="${id(1)}"]`)).toHaveCount(0);
 await expect(page.locator('[data-undo-notice]')).toContainText('챙길 것에서 뺐어요.');
 expect(f.calls.patch[0].body).toMatchObject({status:'dismissed'});
 await tap(page,page.locator('[data-undo-notice] [data-undo-action]'),width);
 await expect(box.locator(`[data-radar-row="${id(1)}"]`)).toBeVisible();
 expect(f.calls.patch[1]).toMatchObject({query:{status:'eq.dismissed'},body:{status:'open',decided_at:null}});
 expect(f.errors).toEqual([]);
});

test('home shows 5 rows and [모두 보기 N]; what is already a task is not shown again',async({page})=>{
 // openHome's task list has "오늘 항목"; a candidate with the same title is left out (decision 5).
 const rows=[1,2,3,4,5,6,7].map(n=>cand(n)).concat(cand(8,{summary:'오늘 항목'}));
 const f=await fixture(page,{rows});const box=radar(page);
 await expect(page.locator('#homeView [data-home-card="tasks"]')).toHaveAttribute('data-state','ready');
 await expect(box.locator('[data-radar-row]')).toHaveCount(5);
 await expect(box.locator('h3 small')).toHaveText('7');
 await box.getByRole('button',{name:'모두 보기 7'}).click();
 await expect(box.locator('[data-radar-row]')).toHaveCount(7);await expect(box).not.toContainText('오늘 항목');
 await box.getByRole('button',{name:'접기'}).click();await expect(box.locator('[data-radar-row]')).toHaveCount(5);
 expect(f.errors).toEqual([]);
});

test('[다시 찾기]: new candidates appear; a counterpart promise is shown with [원장으로 복사] and never stored',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 const f=await fixture(page,{rows:[]});const box=radar(page);
 await expect(box.locator('[data-home-body]')).toContainText('챙길 것 없음');
 await expect.poll(()=>f.calls.ai.length).toBe(1);await expect(box.getByRole('button',{name:'다시 찾기'})).toBeEnabled();
 f.queue.push({json:{ok:true,kind:'todo_radar',added:1,found:1,partial:true,checked_at:'2026-10-06T01:00:00Z',promises:[{summary:'상대 측 자료 송부 약속',due:'2026-10-10',evidence:'보내기로 함',source_kind:'meeting',source_id:id(50),source_day:'2026-10-05'}]}});
 f.db.rows.push(cand(9,{summary:'새로 찾은 가상 요청'}));f.db.state={last_success_at:'2026-10-06T01:00:00Z',last_partial:true};
 await box.getByRole('button',{name:'다시 찾기'}).click();
 await expect(box.locator('[data-radar-status-line]')).toHaveText('새로 1개 찾았어요.');
 await expect(box.locator(`[data-radar-row="${id(9)}"]`)).toBeVisible();
 const promise=box.locator('[data-radar-promise]');await expect(promise).toContainText('상대 약속');await expect(promise).toContainText('상대 측 자료 송부 약속');
 await expect(promise.getByRole('button',{name:'할 일로'})).toHaveCount(0);
 await expect(box.locator('[data-radar-checked]')).toContainText('일부만 봤어요');
 await promise.getByRole('button',{name:'원장으로 복사'}).click();
 await expect(box.locator('[data-radar-status-line]')).toHaveText('원장에 넣을 약속 문구를 복사했어요.');
 const copied=await page.evaluate(()=>navigator.clipboard.readText());
 expect(copied).toMatch(/^쓰기요청\n- 종류: 약속\(상대·제3자\)\n- 내용: 상대 측 자료 송부 약속\n- 기한: 2026-10-10/);
 expect(f.calls.ai.map(a=>a.mode)).toEqual(['auto','again']);
 expect(f.calls.patch).toEqual([]);expect(f.errors).toEqual([]);
});

test('find errors are one plain line; limits are not retried automatically',async({page})=>{
 const f=await fixture(page);const box=radar(page);
 await expect.poll(()=>f.calls.ai.length).toBe(1);await expect(box.getByRole('button',{name:'다시 찾기'})).toBeEnabled();
 f.queue.push({status:429,json:{ok:false,error:'daily_limit',message:'서버 문구'}});
 await box.getByRole('button',{name:'다시 찾기'}).click();
 await expect(box.locator('[data-radar-status-line]')).toHaveText('오늘 챙길 것을 찾을 수 있는 횟수를 다 썼어요. 내일 다시 찾아요.');
 await expect(box.locator('[data-radar-row]')).toHaveCount(2);
 expect(f.calls.ai).toHaveLength(2);expect(f.errors).toEqual([]);
});

for(const [name,opts] of [['tables not applied',{tables:false}],['function not deployed',{fn:'missing'}]])
 test(`not deployed yet (${name}): the box stays hidden and nothing else changes`,async({page})=>{
  const f=await fixture(page,opts);
  await expect(page.locator('#homeView [data-home-card="tasks"]')).toHaveAttribute('data-state','ready');
  await page.waitForTimeout(300);
  await expect(radar(page)).toBeHidden();await expect(radar(page)).toBeEmpty();
  await expect(page.locator('#homeView [data-home-card="dday"]')).toBeVisible();
  expect(f.errors).toEqual([]);
 });

for(const width of [390,1280])test(`journal: the chosen day's candidates above the day card, with what became of them ${width}`,async({page},info)=>{
 const rows=[cand(1,{summary:'오늘 나온 가상 요청'}),cand(2,{summary:'처리한 가상 요청',status:'tasked',task_id:'g',decided_at:'2026-10-06T00:40:00Z'}),cand(3,{summary:'어제 나온 가상 준비',kind:'prepare',source_day:'2026-10-05'})];
 const f=await fixture(page,{rows,width});
 await page.evaluate(()=>window.KPTURouter.go('journal'));
 const box=page.locator('#journalView [data-journal-radar]');
 await expect(box).toBeVisible();
 await expect(box.locator('h4')).toContainText('그날 나온 챙길 것');
 await expect(box.locator('[data-radar-row]')).toHaveCount(2);
 await expect(box.locator(`[data-radar-row="${id(2)}"] [data-radar-state]`)).toHaveText('할 일로 옮김');
 await expect(box.locator(`[data-radar-row="${id(2)}"]`).getByRole('button',{name:'할 일로'})).toHaveCount(0);
 await expect(box.locator(`[data-radar-row="${id(1)}"]`).getByRole('button',{name:'무시'})).toBeVisible();
 expect(await page.evaluate(()=>{const r=document.querySelector('[data-journal-radar]').getBoundingClientRect(),d=document.querySelector('[data-journal-day]').getBoundingClientRect();return r.bottom<=d.top;})).toBe(true);
 // The week is read once; another day of the same week is drawn from it.
 const weekReads=f.calls.reads.filter(r=>r.source_day).length;
 await page.locator('#journalRoot [data-journal-date="2026-10-05"]').click();
 await expect(box.locator('[data-radar-row]')).toHaveCount(1);await expect(box).toContainText('어제 나온 가상 준비');
 expect(f.calls.reads.filter(r=>r.source_day).length).toBe(weekReads);
 expect(f.calls.reads.find(r=>r.source_day)).toMatchObject({source_day:'gte.2026-10-05&lte.2026-10-11'});
 // [주간 정리] hides it; [하루] shows it again.
 await page.locator('#journalRoot [data-journal-mode="week"]').click();await expect(box).toBeHidden();
 await page.locator('#journalRoot [data-journal-mode="day"]').click();await expect(box).toBeVisible();
 expect(await noWideScroll(page)).toBe(true);
 if(width===390)await page.screenshot({path:info.outputPath('todo-radar-journal-390.png'),fullPage:true});
 expect(f.errors).toEqual([]);
});

test('journal hides the box when the tables are not applied',async({page})=>{
 const f=await fixture(page,{tables:false});
 await page.evaluate(()=>window.KPTURouter.go('journal'));
 await expect(page.locator('#journalRoot [data-journal-day-title]')).toBeVisible();
 await page.waitForTimeout(300);
 await expect(page.locator('#journalView [data-journal-radar]')).toBeHidden();
 expect(f.errors).toEqual([]);
});

test('source link opens the update in the basket',async({page})=>{
 const f=await fixture(page);const box=radar(page);
 await box.locator(`[data-radar-row="${id(1)}"] [data-radar-source]`).click();
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 expect(f.errors).toEqual([]);
});
