import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {expectJournalDay} from './helpers/screen-title.mjs';
// JOURNAL-챙길것 1단계 / AI-서버연동 S5 / JOURNAL-챙길것화면: the "챙길 것" box on home (below 주요 일정) and above the journal day card.
// One look everywhere: two lines per row, ✓ ✎ ✕ on the right, handled rows folded in '처리함 N ▸', 4 rows + 'N건 더 ›'.
// app_todo_candidates, app_todo_radar_state and ai-assist kind=todo_radar are mocked. Synthetic IDs and text only.
// The clock is 2026-10-06 10:00 KST (openHome). Nothing here calls a real server.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const SRC='c0000000-0000-4000-8000-000000000101',ORG='c0000000-0000-4000-8000-000000000201';
const cand=(n,over={})=>({id:id(n),kind:'request',summary:`가상 요청 ${n}`,due:null,source_kind:'basket',source_id:SRC,source_day:'2026-10-06',evidence:`근거 ${n}`,project_id:null,organization_id:null,status:'open',task_id:null,created_at:`2026-10-06T00:0${n%10}:00Z`,decided_at:null,...over});
const resourceNoise=text=>/Failed to load resource|net::ERR_FAILED/.test(text);

async function fixture(page,{rows=[cand(1,{kind:'deadline',due:'2026-10-09',summary:'가상 의견 제출'}),cand(2,{source_kind:'org_update',organization_id:ORG,summary:'가상 조직 회신'})],tables=true,fn='ok',state={last_success_at:'2026-10-06T00:30:00Z',last_partial:false},width=1280,routes=null}={}){
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
   if(k==='or'){const since=(v.match(/decided_at\.gte\."?([^",)]+)/)||[])[1];return r.status==='open'||(!!r.decided_at&&!!since&&r.decided_at>=since);}
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
 await routes?.(); // extra routes (after the home's catch-all, so they win)
 // The home starts before these routes exist; start again from a fresh page so every radar read hits them.
 page.once('framenavigated',()=>{armed=true;});
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 return {...f,db,calls,errors,queue};
}
const radar=page=>page.locator('#homeView [data-home-card="radar"]');
// Phone: a real touch tap (locator.tap waits again when the box redraws after the automatic find); PC: a click.
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const pressHeight=button=>button.evaluate(el=>Math.max(el.getBoundingClientRect().height,parseFloat(getComputedStyle(el,'::after').height)||0));
const createsOf=page=>{const list=[];page.on('request',r=>{if(r.url().includes('/functions/v1/google-tasks')&&new URL(r.url()).searchParams.get('action')==='create')list.push(r.postDataJSON());});return list;};
const btn=(row,name)=>row.getByRole('button',{name,exact:true});

for(const width of [1280])test(`home: two lines per row, ✓ ✎ ✕ on the right, below 주요 일정, auto find once ${width}`,async({page},info)=>{
 const f=await fixture(page,{width});const box=radar(page);
 await expect(box).toBeVisible();
 await expect(box.locator('h3')).toContainText('챙길 것');await expect(box.locator('[data-radar-count]')).toHaveText('2');
 await expect(box.locator('[data-radar-row]')).toHaveCount(2);
 const row=box.locator(`[data-radar-row="${id(1)}"]`);
 // ② no kind tag; ④ no '대기'. ① title, then a grey line: source · 제안 기한.
 await expect(box).not.toContainText('마감');await expect(box).not.toContainText('요청');await expect(box).not.toContainText('대기');
 await expect(box.locator('.radar-kind')).toHaveCount(0);
 await expect(row.locator('.radar-summary')).toHaveText('가상 의견 제출');
 await expect(row.locator('[data-radar-source]')).toHaveText('업데이트 · 제안 기한 10.9');
 await expect(box.locator(`[data-radar-row="${id(2)}"] [data-radar-source]`)).toHaveText('조직 기록');
 const lines=await row.evaluate(el=>{const t=el.querySelector('.radar-summary').getBoundingClientRect(),m=el.querySelector('.radar-meta').getBoundingClientRect(),c=getComputedStyle(el.querySelector('[data-radar-source]'));return {below:m.top>=t.bottom-1,size:c.fontSize,grey:c.color===getComputedStyle(el.querySelector('.radar-row-status')||document.querySelector('[data-radar-checked]')).color};});
 expect(lines).toEqual({below:true,size:'12px',grey:true});
 // The evidence opens with ▾ and closes again.
 await expect(row.locator('[data-radar-evidence]')).toHaveCount(0);
 await tap(page,row.locator('[data-radar-why]'),width);
 await expect(row.locator('[data-radar-evidence]')).toHaveText('근거 1');await expect(row.locator('[data-radar-why]')).toHaveAttribute('aria-expanded','true');
 await tap(page,row.locator('[data-radar-why]'),width);await expect(row.locator('[data-radar-evidence]')).toHaveCount(0);
 // ③ three small buttons on the title line, right side; visible ≤28px, press range ≥44px.
 for(const name of ['바로 할 일로','고쳐서 넣기','무시']){const b=btn(row,name);await expect(b).toBeVisible();
  expect(await pressHeight(b)).toBeGreaterThanOrEqual(44);
  const bb=await b.boundingBox();expect(bb.height).toBeLessThanOrEqual(28);expect(bb.width).toBeLessThanOrEqual(32);
  expect(await b.evaluate(el=>{const s=el.closest('.radar-line').querySelector('.radar-summary').getBoundingClientRect(),r=el.getBoundingClientRect();return Math.abs(r.top-s.top)<12&&r.left>s.left;})).toBe(true);}
 await expect(btn(row,'바로 할 일로')).toHaveText('✓');await expect(btn(row,'고쳐서 넣기')).toHaveText('✎');await expect(btn(row,'무시')).toHaveText('✕');
 // ⑥ [다시 찾기] is a text button.
 expect(await box.locator('[data-radar-find]').evaluate(el=>getComputedStyle(el).borderTopStyle==='none'||getComputedStyle(el).borderTopWidth==='0px')).toBe(true);
 await expect(box.locator('[data-radar-checked]')).toContainText('마지막 찾기');
 // The first open of the day asks once with mode auto (the server answers skipped) and only kind+mode are sent.
 await expect.poll(()=>f.calls.ai.length).toBe(1);expect(f.calls.ai[0]).toEqual({kind:'todo_radar',mode:'auto'});
 // Home reads what is open and what was handled since today's start (Seoul).
 expect(f.calls.reads[0].or).toBe('(status.eq.open,decided_at.gte."2026-10-05T15:00:00.000Z")');
 const order=await page.evaluate(()=>{const dday=document.querySelector('[data-home-card="dday"]'),radar=document.querySelector('[data-home-card="radar"]'),tasks=document.querySelector('[data-home-card="tasks"]'),meet=document.querySelector('[data-home-card="meetings"]');
  return {sameColumn:dday.parentElement===radar.parentElement,next:dday.nextElementSibling===radar,column:radar.parentElement.dataset.homeColumn,afterTasks:!!(radar.compareDocumentPosition(tasks)&Node.DOCUMENT_POSITION_PRECEDING),beforeMeetings:!!(radar.compareDocumentPosition(meet)&Node.DOCUMENT_POSITION_FOLLOWING)};});
 expect(order.sameColumn&&order.next).toBe(true);
 expect(order.column).toBe(width>=1024?'aside':'main');
 if(width<1024)expect(order.afterTasks&&order.beforeMeetings).toBe(true);
 expect(await noWideScroll(page)).toBe(true);
 await page.screenshot({path:info.outputPath(`todo-radar-home-${width}.png`),fullPage:width<1024});
 expect(f.errors).toEqual([]);
});

for(const width of [1280])test(`✓ goes straight in (due = suggested due, else today), then the row folds into 처리함 ${width}`,async({page},info)=>{
 const f=await fixture(page,{width});const box=radar(page),creates=createsOf(page);
 // With a suggested due: that due.
 await tap(page,btn(box.locator(`[data-radar-row="${id(1)}"]`),'바로 할 일로'),width);
 await expect(box.locator('[data-radar-open] [data-radar-row]')).toHaveCount(1);
 await expect(box.locator('[data-radar-count]')).toHaveText('1');
 await expect(box.locator('[data-radar-status-line]')).toContainText('할 일로 넣었어요 · 기한 10.9.');
 // Without one: today (2026-10-06 KST).
 await tap(page,btn(box.locator(`[data-radar-row="${id(2)}"]`),'바로 할 일로'),width);
 await expect(box.locator('[data-radar-open] [data-radar-row]')).toHaveCount(0);
 await expect(box.locator('[data-radar-count]')).toHaveText('');
 expect(creates).toEqual([{action:'create',task_id:null,title:'가상 의견 제출',notes:'',due:'2026-10-09',links:[]},{action:'create',task_id:null,title:'가상 조직 회신',notes:'',due:'2026-10-06',links:[{organization_id:ORG}]}]);
 expect(f.calls.patch.map(p=>[p.query.status,p.body.status])).toEqual([['eq.open','tasked'],['eq.open','tasked']]);
 // ⑤ handled rows sit below, folded: '처리함 2 ▸'; opening shows them struck through with the due they went in with.
 const done=box.locator('[data-radar-done]'),toggle=box.locator('[data-radar-done-toggle]');
 await expect(toggle).toHaveText('처리함 2 ▸');await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(done.locator('[data-radar-row]')).toHaveCount(0);
 await tap(page,toggle,width);
 await expect(toggle).toHaveText('처리함 2 ▾');
 await expect(done.locator(`[data-radar-row="${id(1)}"] [data-radar-source]`)).toHaveText('할 일로 넣음 · 10.9 · 업데이트');
 await expect(done.locator(`[data-radar-row="${id(2)}"] [data-radar-source]`)).toHaveText('할 일로 넣음 · 10.6 · 조직 기록');
 expect(await done.locator(`[data-radar-row="${id(1)}"] .radar-summary`).evaluate(el=>getComputedStyle(el).textDecorationLine)).toContain('line-through');
 await expect(done.getByRole('button',{name:'바로 할 일로'})).toHaveCount(0);await expect(done.getByRole('button',{name:'무시'})).toHaveCount(0);
 expect(await noWideScroll(page)).toBe(true);
 if(width===390)await page.screenshot({path:info.outputPath('todo-radar-done-390.png'),fullPage:true});
 expect(f.errors).toEqual([]);
});

for(const width of [1280])test(`✎ opens in place: fix the title, pick 오늘/내일/제안 기한/기한 없음, [넣기] ${width}`,async({page})=>{
 const f=await fixture(page,{width});const box=radar(page),creates=createsOf(page);
 const row=box.locator(`[data-radar-row="${id(1)}"]`);
 await tap(page,btn(row,'고쳐서 넣기'),width);
 const title=row.locator('[data-radar-title]');await expect(title).toBeFocused();await expect(title).toHaveValue('가상 의견 제출');
 const chips=row.locator('[data-radar-due-pick]');
 await expect(chips).toHaveText(['오늘','내일','제안 기한 10.9','기한 없음']);
 await expect(row.locator('[data-radar-due-pick="suggested"]')).toHaveAttribute('aria-pressed','true');
 // Other rows' buttons wait while one is being edited.
 await expect(btn(box.locator(`[data-radar-row="${id(2)}"]`),'바로 할 일로')).toBeDisabled();
 await title.fill('가상 의견 제출하기');
 await tap(page,row.locator('[data-radar-due-pick="tomorrow"]'),width);
 await expect(row.locator('[data-radar-due-pick="tomorrow"]')).toHaveAttribute('aria-pressed','true');
 await expect(row.locator('[data-radar-title]')).toHaveValue('가상 의견 제출하기');
 await tap(page,btn(row,'넣기'),width);
 await expect(box.locator(`[data-radar-open] [data-radar-row="${id(1)}"]`)).toHaveCount(0);
 // A row without a suggested due offers no 제안 기한 and starts on 오늘; 기한 없음 sends no due.
 const row2=box.locator(`[data-radar-row="${id(2)}"]`);
 await tap(page,btn(row2,'고쳐서 넣기'),width);
 await expect(row2.locator('[data-radar-due-pick]')).toHaveText(['오늘','내일','기한 없음']);
 await expect(row2.locator('[data-radar-due-pick="today"]')).toHaveAttribute('aria-pressed','true');
 await tap(page,row2.locator('[data-radar-due-pick="none"]'),width);
 await tap(page,btn(row2,'넣기'),width);
 await expect(box.locator('[data-radar-open] [data-radar-row]')).toHaveCount(0);
 expect(creates.map(c=>[c.title,c.due])).toEqual([['가상 의견 제출하기','2026-10-07'],['가상 조직 회신',null]]);
 await box.locator('[data-radar-done-toggle]').click();
 await expect(box.locator(`[data-radar-done] [data-radar-row="${id(1)}"] [data-radar-source]`)).toHaveText('할 일로 넣음 · 10.7 · 업데이트');
 await expect(box.locator(`[data-radar-done] [data-radar-row="${id(2)}"] [data-radar-source]`)).toHaveText('할 일로 넣음 · 기한 없음 · 조직 기록');
 expect(f.calls.patch).toHaveLength(2);expect(f.errors).toEqual([]);
});

test('✎ with an empty title asks for one and creates nothing; [취소] returns to the row',async({page})=>{
 const f=await fixture(page);const box=radar(page),row=box.locator(`[data-radar-row="${id(1)}"]`);
 const creates=createsOf(page);
 await btn(row,'고쳐서 넣기').click();
 await row.locator('[data-radar-title]').fill('  ');await btn(row,'넣기').click();
 await expect(row.locator('.radar-row-status')).toHaveText('할 일 제목을 써 주세요.');await expect(row.locator('[data-radar-title]')).toBeFocused();
 await btn(row,'취소').click();
 await expect(btn(row,'고쳐서 넣기')).toBeFocused();await expect(row.locator('[data-radar-edit]')).toHaveCount(0);
 expect(creates).toEqual([]);expect(f.calls.patch).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [1280])test(`✕ folds the row into 처리함 as 무시함, with 5 s [되돌리기] ${width}`,async({page})=>{
 const f=await fixture(page,{width});const box=radar(page);
 await tap(page,btn(box.locator(`[data-radar-row="${id(1)}"]`),'무시'),width);
 await expect(box.locator(`[data-radar-open] [data-radar-row="${id(1)}"]`)).toHaveCount(0);
 await expect(box.locator('[data-radar-count]')).toHaveText('1');
 await expect(page.locator('[data-undo-notice]')).toContainText('챙길 것에서 뺐어요.');
 expect(f.calls.patch[0].body).toMatchObject({status:'dismissed'});
 await expect(box.locator('[data-radar-done-toggle]')).toHaveText('처리함 1 ▸');
 await tap(page,box.locator('[data-radar-done-toggle]'),width);
 await expect(box.locator(`[data-radar-done] [data-radar-row="${id(1)}"] [data-radar-source]`)).toHaveText('무시함 · 업데이트');
 await tap(page,page.locator('[data-undo-notice] [data-undo-action]'),width);
 await expect(box.locator(`[data-radar-open] [data-radar-row="${id(1)}"]`)).toBeVisible();
 await expect(box.locator('[data-radar-done]')).toHaveCount(0);
 expect(f.calls.patch[1]).toMatchObject({query:{status:'eq.dismissed'},body:{status:'open',decided_at:null}});
 expect(f.errors).toEqual([]);
});

for(const width of [1280])test(`first 4 open rows and 'N건 더 ›'; open always above handled; count is open only ${width}`,async({page})=>{
 // openHome's task list has "오늘 항목"; a candidate with the same title is left out (decision 5).
 const rows=[1,2,3,4,5,6,7].map(n=>cand(n)).concat(cand(8,{summary:'오늘 항목'}),
  cand(10,{summary:'오늘 처리한 가상 요청',status:'tasked',task_id:'today',decided_at:'2026-10-06T00:20:00Z'}),
  cand(11,{summary:'오늘 무시한 가상 요청',status:'dismissed',decided_at:'2026-10-06T00:10:00Z'}),
  cand(12,{summary:'어제 처리한 가상 요청',status:'dismissed',decided_at:'2026-10-05T10:00:00Z'}));
 const f=await fixture(page,{rows,width});const box=radar(page);
 await expect(page.locator('#homeView [data-home-card="tasks"]')).toHaveAttribute('data-state','ready');
 await expect(box.locator('[data-radar-open] [data-radar-row]')).toHaveCount(4);
 await expect(box.locator('[data-radar-count]')).toHaveText('7');
 const more=box.getByRole('button',{name:'3건 더 ›'});await expect(more).toBeVisible();
 // Handled today: folded below the open rows; yesterday's handled rows are not read on home.
 await expect(box.locator('[data-radar-done-toggle]')).toHaveText('처리함 2 ▸');
 expect(await box.evaluate(el=>{const o=el.querySelector('[data-radar-open]').getBoundingClientRect(),d=el.querySelector('[data-radar-done]').getBoundingClientRect();return d.top>=o.bottom;})).toBe(true);
 // The two folding links are on one line and their press ranges do not overlap.
 expect(await box.evaluate(el=>{const a=el.querySelector('[data-radar-all]').getBoundingClientRect(),b=el.querySelector('[data-radar-done-toggle]').getBoundingClientRect();return Math.abs(a.top-b.top)<4&&a.right<=b.left;})).toBe(true);
 await tap(page,more,width);
 await expect(box.locator('[data-radar-open] [data-radar-row]')).toHaveCount(7);await expect(box).not.toContainText('오늘 항목');
 await tap(page,box.getByRole('button',{name:'접기'}),width);await expect(box.locator('[data-radar-open] [data-radar-row]')).toHaveCount(4);
 await tap(page,box.locator('[data-radar-done-toggle]'),width);
 await expect(box.locator('[data-radar-done] [data-radar-row]')).toHaveCount(2);
 await expect(box.locator(`[data-radar-done] [data-radar-row="${id(10)}"] [data-radar-source]`)).toHaveText('할 일로 넣음 · 10.6 · 업데이트');
 await expect(box).not.toContainText('어제 처리한 가상 요청');
 expect(await noWideScroll(page)).toBe(true);
 expect(f.errors).toEqual([]);
});

test('[다시 찾기]: new candidates appear; a counterpart promise is shown with [원장으로 복사] and never stored',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 const f=await fixture(page,{rows:[]});const box=radar(page);
 // With nothing to show the home card folds away; the journal box keeps [다시 찾기].
 await expect.poll(()=>f.calls.ai.length).toBe(1);await expect(box).toBeHidden();
 await page.evaluate(()=>window.KPTURouter.go('journal'));
 const jbox=page.locator('#journalView [data-journal-radar]');
 await expect(jbox).toHaveClass(/radar-collapsed/);await expect(jbox.locator('[data-radar-quiet]')).toHaveText(/^챙길 것 없음 · 마지막 찾기 \d\d:\d\d$|^챙길 것 없음$|^챙길 것 없음 · 아직 찾지 않았어요$/);await expect(jbox.getByRole('button',{name:'다시 찾기'})).toBeVisible();expect(await jbox.evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(70);
 f.queue.push({json:{ok:true,kind:'todo_radar',added:1,found:1,partial:true,checked_at:'2026-10-06T01:00:00Z',promises:[{summary:'상대 측 자료 송부 약속',due:'2026-10-10',evidence:'보내기로 함',source_kind:'meeting',source_id:id(50),source_day:'2026-10-05'}]}});
 f.db.rows.push(cand(9,{summary:'새로 찾은 가상 요청'}));f.db.state={last_success_at:'2026-10-06T01:00:00Z',last_partial:true};
 await jbox.getByRole('button',{name:'다시 찾기'}).click();
 await expect(jbox.locator('[data-radar-status-line]')).toHaveText('새로 1개 찾았어요.');
 await page.evaluate(()=>window.KPTURouter.go('home'));
 await expect(box.locator(`[data-radar-row="${id(9)}"]`)).toBeVisible();
 const promise=box.locator('[data-radar-promise]');await expect(promise).toContainText('상대 약속');await expect(promise).toContainText('상대 측 자료 송부 약속');
 await expect(promise.getByRole('button',{name:'바로 할 일로'})).toHaveCount(0);
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

for(const width of [390,1280])test(`journal: the same look — open rows with ✓ ✎ ✕ above, the day's handled rows in 처리함 ${width}`,async({page},info)=>{
 const rows=[cand(1,{summary:'오늘 나온 가상 요청'}),cand(2,{summary:'처리한 가상 요청',status:'tasked',task_id:'today',decided_at:'2026-10-06T00:40:00Z'}),cand(3,{summary:'어제 나온 가상 준비',kind:'prepare',source_day:'2026-10-05'})];
 const f=await fixture(page,{rows,width});
 await page.evaluate(()=>window.KPTURouter.go('journal'));
 const box=page.locator('#journalView [data-journal-radar]');
 await expect(box).toBeVisible();
 await expect(box.locator('h4')).toContainText('그날 나온 챙길 것');await expect(box.locator('[data-radar-count]')).toHaveText('1');
 await expect(box.locator('[data-radar-open] [data-radar-row]')).toHaveCount(1);
 const open=box.locator(`[data-radar-row="${id(1)}"]`);
 for(const name of ['바로 할 일로','고쳐서 넣기','무시'])await expect(btn(open,name)).toBeVisible();
 await expect(open.locator('[data-radar-source]')).toHaveText('업데이트');
 await expect(box).not.toContainText('대기');await expect(box.locator('.radar-kind')).toHaveCount(0);
 await expect(box.locator('[data-radar-done-toggle]')).toHaveText('처리함 1 ▸');
 await tap(page,box.locator('[data-radar-done-toggle]'),width);
 await expect(box.locator(`[data-radar-done] [data-radar-row="${id(2)}"] [data-radar-source]`)).toHaveText('할 일로 넣음 · 10.6 · 업데이트');
 await expect(box.locator(`[data-radar-done] [data-radar-row="${id(2)}"]`).getByRole('button',{name:'바로 할 일로'})).toHaveCount(0);
 // Same row look as home: two lines, the same button sizes.
 const look=await open.evaluate(el=>{const b=el.querySelector('[data-radar-quick]').getBoundingClientRect(),t=el.querySelector('.radar-summary').getBoundingClientRect(),m=el.querySelector('.radar-meta').getBoundingClientRect();return {h:Math.round(b.height),w:Math.round(b.width),below:m.top>=t.bottom-1};});
 expect(look).toEqual({h:28,w:28,below:true});
 expect(await page.evaluate(()=>{const q=s=>document.querySelector(s).getBoundingClientRect();const w=q('[data-journal-days]'),l=q('[data-journal-line]'),r=q('[data-journal-radar]'),m=q('[data-journal-materials]');return w.bottom<=l.top&&l.bottom<=r.top&&r.bottom<=m.top;})).toBe(true);
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
 await expectJournalDay(page,/\d+월 \d+일/);
 await page.waitForTimeout(300);
 await expect(page.locator('#journalView [data-journal-radar]')).toBeHidden();
 expect(f.errors).toEqual([]);
});

// HOME-모바일홈채우기: 폰·중간 폭 홈은 챙길 것 카드 대신 '정리 안 된 것' 한 줄을 쓴다(카드는 PC 홈과 업무일지에서 그대로).
test('phone home: the 챙길 것 card is not shown (replaced by the 정리 안 된 것 line)',async({page})=>{
 const f=await fixture(page,{width:390});
 await expect(radar(page)).toBeHidden();
 await expect(page.locator('#homeView .home-fill-inbox-line')).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('source link opens the update in the basket',async({page})=>{
 const f=await fixture(page);const box=radar(page);
 await box.locator(`[data-radar-row="${id(1)}"] [data-radar-source]`).click();
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 expect(f.errors).toEqual([]);
});

// UI-화면점검 ④ + JOURNAL-챙길것화면 ⑥: [다시 찾기]는 홈·업무일지 모두 같은 글자 버튼(굵기·크기·높이).
for(const width of [1280])test(`업무일지 [다시 찾기]는 홈과 같은 글자 버튼 ${width}`,async({page})=>{
 const f=await fixture(page,{width});
 const look=l=>l.evaluate(b=>{const c=getComputedStyle(b);return {h:Math.round(b.getBoundingClientRect().height),size:c.fontSize,weight:Number(c.fontWeight),border:c.borderTopStyle}});
 const hf=page.locator('#homeView [data-radar-find]').first();await expect(hf).toBeVisible();
 const home=await look(hf);
 expect(await pressHeight(hf)).toBeGreaterThanOrEqual(44);
 await page.evaluate(()=>window.KPTURouter.go('journal'));
 const jf=page.locator('#journalView [data-journal-radar] [data-radar-find]');await expect(jf).toBeVisible();
 const journal=await look(jf);
 expect(journal).toEqual(home);expect(home).toEqual({h:28,size:'12px',weight:500,border:'none'});
 expect(f.errors).toEqual([]);
});

// FEAT-1029 ⑤ 텔레그램에서 나한테 온 요청: 같은 렌더러, 출처 꼬리 '텔레그램 · 방 이름 · 날짜', 근거 ▾ 안에 [원문 보기 ›] → 텔레그램 화면.
// 방 이름은 소식 표(app_feed_items) 한 번 읽기로 붙는다(가짜 응답). 폰 412·884는 업무일지 칸, PC 1440은 홈 카드와 업무일지 칸.
const TG_FEED='c0000000-0000-4000-8000-000000000301';
for(const width of [412,884,1440])test(`telegram candidate: room in the source line, evidence with 원문 보기, opens the telegram view ${width}`,async({page})=>{
 const feedReads=[];
 const routes=()=>page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',route=>{
  const q=new URL(route.request().url()).searchParams;
  if(q.get('id')?.startsWith('in.')){feedReads.push(Object.fromEntries(q));return route.fulfill({json:[{id:TG_FEED,room_key:'-100777',room_label:'가상 간부방'}]});}
  return route.fulfill({json:[]});
 });
 const f=await fixture(page,{width,routes,rows:[cand(1,{source_kind:'telegram',source_id:TG_FEED,due:'2026-10-09',summary:'가상 교섭 자료 보내기',evidence:'14:12 가상위원장: 금요일 전까지 자료 부탁드려요'}),cand(2,{summary:'가상 조직 회신'})]});
 await page.evaluate(()=>window.KPTURouter.go('journal'));
 const box=page.locator('#journalView [data-journal-radar]');
 const row=box.locator(`[data-radar-row="${id(1)}"]`);
 await expect(row.locator('[data-radar-source]').first()).toHaveText('텔레그램 · 가상 간부방 · 10.6 · 제안 기한 10.9');
 await expect(box.locator(`[data-radar-row="${id(2)}"] [data-radar-source]`)).toHaveText('업데이트');
 expect(feedReads.length).toBeGreaterThanOrEqual(1);
 expect(feedReads[0]).toMatchObject({source:'eq.telegram',id:`in.(${TG_FEED})`,select:'id,room_key,room_label'});
 for(const name of ['바로 할 일로','고쳐서 넣기','무시'])await expect(btn(row,name)).toBeVisible();
 await tap(page,row.locator('[data-radar-why]'),width);
 const ev=row.locator('[data-radar-evidence]');
 await expect(ev).toContainText('14:12 가상위원장: 금요일 전까지 자료 부탁드려요');
 const raw=ev.getByRole('button',{name:'원문 보기 ›'});await expect(raw).toBeVisible();
 expect(await noWideScroll(page)).toBe(true);
 if(width>=1280){const home=radar(page);await page.evaluate(()=>window.KPTURouter.go('home'));await expect(home.locator(`[data-radar-row="${id(1)}"] [data-radar-source]`)).toContainText('텔레그램 · 가상 간부방');await page.evaluate(()=>window.KPTURouter.go('journal'));await expect(raw).toBeVisible();}
 await tap(page,row.locator('[data-radar-evidence]').getByRole('button',{name:'원문 보기 ›'}),width);
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('telegram');
 expect(f.errors.filter(e=>!/telegram|feed/i.test(e))).toEqual([]);
});
