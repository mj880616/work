import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// JOURNAL-챙길것 / AI-서버연동 S5 → HOME-업무일지홈(2026-10-30): 홈·업무일지의 '챙길 것' 상자는 화면째 없앴다. 남은 것:
// ① 그날 이 탭에서 홈을 처음 열 때 서버에 한 번 찾기(D7, home-summary.js → todo-radar.js autoFindToday)
// ② 홈 요약 한 줄 '나한테 온 요청 n · 챙길 것 n · 정리 안 된 것 n ›'(누르면 정리함)
// ③ 후보 줄은 정리함 [챙길 것](inbox-todos.js) 하나: [할 일로]·[무시]·[다시 찾기]·출처 열기·텔레그램 방 이름, 제안 기한은 공용 기한 글자.
// app_todo_candidates, app_todo_radar_state and ai-assist kind=todo_radar are mocked. Synthetic IDs and text only.
// The clock is 2026-10-06 10:00 KST (openHome). Nothing here calls a real server.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const SRC='c0000000-0000-4000-8000-000000000101',ORG='c0000000-0000-4000-8000-000000000201';
const cand=(n,over={})=>({id:id(n),kind:'request',summary:`가상 요청 ${n}`,due:null,source_kind:'basket',source_id:SRC,source_day:'2026-10-06',evidence:`근거 ${n}`,project_id:null,organization_id:null,status:'open',task_id:null,created_at:`2026-10-06T00:0${n%10}:00Z`,decided_at:null,...over});
const resourceNoise=text=>/Failed to load resource|net::ERR_FAILED/.test(text);

async function fixture(page,{rows=[cand(1,{kind:'deadline',due:'2026-10-09',summary:'가상 의견 제출'}),cand(2,{source_kind:'org_update',organization_id:ORG,summary:'가상 조직 회신'})],tables=true,fn='ok',state={last_success_at:'2026-10-06T00:30:00Z',last_partial:false},width=1280,routes=null,query=''}={}){
 await page.setViewportSize({width,height:900});
 const f=await openHome(page,{query});
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
   return op==='eq'?cell===val:op==='in'?val.replace(/^\(|\)$/g,'').split(',').includes(cell):op==='gte'?cell>=val:op==='lte'?cell<=val:true;}));
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
const inbox=page=>page.locator('#basketView [data-inbox-todo-host]');
const openInbox=async page=>{await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('#basketView')).toBeVisible();await expect(inbox(page).locator('[data-inbox-todo-row]').first()).toBeVisible();};
// Phone: a real touch tap (locator.tap waits again when the box redraws after the automatic find); PC: a click.
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const createsOf=page=>{const list=[];page.on('request',r=>{if(r.url().includes('/functions/v1/google-tasks')&&new URL(r.url()).searchParams.get('action')==='create')list.push(r.postDataJSON());});return list;};
const btn=(row,name)=>row.getByRole('button',{name,exact:true});


for(const width of [412,884,1440])test(`home: the first open of the day asks once (auto), and the summary line counts and opens the 정리함 ${width}`,async({page},info)=>{
 const f=await fixture(page,{width,rows:[cand(1,{kind:'deadline',due:'2026-10-09',summary:'가상 의견 제출'}),cand(2,{source_kind:'org_update',organization_id:ORG,summary:'가상 조직 회신'}),cand(3,{source_kind:'telegram',source_id:id(301),summary:'가상 나한테 온 요청'})]});
 await expect(page.locator('#homeView')).toBeVisible();
 // ① one automatic look a day, kind + mode only.
 await expect.poll(()=>f.calls.ai.length).toBe(1);expect(f.calls.ai[0]).toEqual({kind:'todo_radar',mode:'auto'});
 // ② the summary line: 나한테 온 요청 = the telegram ask, 챙길 것 = the other open ones, 정리 안 된 것 = unsorted updates (none here).
 const line=page.locator('#homeView [data-home-summary]');
 await expect(line).toBeVisible();
 await expect(line.locator('[data-home-summary-asks]')).toHaveText('나한테 온 요청 1');
 await expect(line.locator('[data-home-summary-asks]')).toHaveClass(/is-on/);
 await expect(line.locator('[data-home-summary-todos]')).toHaveText('2');
 await expect(line.locator('[data-home-summary-unsorted]')).toHaveText('0');
 await expect(line).toHaveText('나한테 온 요청 1 · 챙길 것 2 · 정리 안 된 것 0 ›');
 // 노란 주목은 요청만, 나머지는 흐린 글씨(같은 색 아님), 한 줄, 가로 넘침 없음.
 const colors=await line.evaluate(el=>({ask:getComputedStyle(el.querySelector('[data-home-summary-asks]')).color,rest:getComputedStyle(el.querySelector('.home-summary-rest')).color,h:el.getBoundingClientRect().height}));
 expect(colors.ask).not.toBe(colors.rest);expect(colors.h).toBeLessThanOrEqual(24);
 expect(await noWideScroll(page)).toBe(true);
 // 옛 챙길 것 상자는 홈 어디에도 없다.
 await expect(page.locator('#homeView [data-journal-radar],#homeView [data-home-card="radar"],#homeView [data-radar-row]')).toHaveCount(0);
 await page.screenshot({path:info.outputPath(`home-summary-${width}.png`)});
 await tap(page,line.locator('.home-summary-open'),width);
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 await expect(inbox(page).locator('[data-inbox-todo-row]')).toHaveCount(3);
 // Back home again in the same tab: no second automatic look.
 await page.evaluate(()=>window.KPTURouter.go('home'));
 await expect(page.locator('#homeView')).toBeVisible();
 await page.waitForTimeout(300);
 expect(f.calls.ai).toHaveLength(1);
 expect(f.calls.patch).toEqual([]);expect(f.errors).toEqual([]);
});

test('home: no number can be read → the summary line stays hidden; nothing else breaks',async({page})=>{
 const f=await fixture(page,{tables:false});
 await expect(page.locator('#homeView [data-journal-schedule]')).toBeVisible();
 await page.waitForTimeout(300);
 const line=page.locator('#homeView [data-home-summary]');
 // A table that is not applied counts as 0 (inbox-count.js), so the line shows zeros instead of failing.
 await expect(line).toHaveText('나한테 온 요청 0 · 챙길 것 0 · 정리 안 된 것 0 ›');
 await expect(line.locator('[data-home-summary-asks]')).not.toHaveClass(/is-on/);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`정리함: the suggested due is the shared due text; [할 일로] goes in with that due and moves to 할 일로 보냄 ${width}`,async({page})=>{
 const creates=createsOf(page);
 const f=await fixture(page,{width});
 await openInbox(page);
 const row=inbox(page).locator(`[data-inbox-todo-row="${id(1)}"]`);
 await expect(row.locator('.inbox-todo-summary')).toHaveText('가상 의견 제출');
 const due=row.locator('[data-inbox-todo-due]');
 await expect(due).toHaveText('10.9 (금)');await expect(due).toHaveClass(/task-due-text/);
 const look=await due.evaluate(el=>{const c=getComputedStyle(el),t=getComputedStyle(el.closest('.inbox-todo-row').querySelector('.inbox-todo-summary'));return {size:c.fontSize,color:c.color,ink:t.color};});
 expect(look.size).toBe('12px');expect(look.color).not.toBe(look.ink);
 // No due → no due text.
 await expect(inbox(page).locator(`[data-inbox-todo-row="${id(2)}"] [data-inbox-todo-due]`)).toHaveCount(0);
 await tap(page,row.getByRole('button',{name:'할 일로',exact:true}),width);
 await expect.poll(()=>creates.length).toBe(1);
 await expect(inbox(page).locator('[data-inbox-todo-line]')).toHaveText('할 일로 보냈어요.');
 await expect(inbox(page).locator(`[data-inbox-todo-row="${id(1)}"]`)).toHaveCount(0);
 // Without a suggested due: today (2026-10-06 KST).
 await tap(page,inbox(page).locator(`[data-inbox-todo-row="${id(2)}"]`).getByRole('button',{name:'할 일로',exact:true}),width);
 await expect.poll(()=>creates.length).toBe(2);
 expect(creates).toEqual([{action:'create',task_id:null,title:'가상 의견 제출',notes:'',due:'2026-10-09',links:[]},{action:'create',task_id:null,title:'가상 조직 회신',notes:'',due:'2026-10-06',links:[{organization_id:ORG}]}]);
 await expect.poll(()=>f.calls.patch.map(p=>[p.query.status,p.body.status])).toEqual([['eq.open','tasked'],['eq.open','tasked']]);
 expect(f.calls.patch[0].body).toMatchObject({task_due:'2026-10-09'});
 await page.locator('#basketView [data-inbox-chip="tasked"]').click();
 await expect(inbox(page).locator(`[data-inbox-todo-row="${id(1)}"] .inbox-todo-done`)).toHaveText('할 일로 보냄 · 10.9');
 await expect(inbox(page).locator(`[data-inbox-todo-row="${id(2)}"] .inbox-todo-done`)).toHaveText('할 일로 보냄 · 10.6');
 expect(await noWideScroll(page)).toBe(true);
 expect(f.errors).toEqual([]);
});

test('정리함: [무시] moves the row to 무시함 with a 5 s [되돌리기] that brings it back',async({page})=>{
 const f=await fixture(page);
 await openInbox(page);
 const row=inbox(page).locator(`[data-inbox-todo-row="${id(2)}"]`);
 await row.getByRole('button',{name:'무시',exact:true}).click();
 await expect(row).toHaveCount(0);
 await expect(page.locator('[data-undo-notice]')).toContainText('무시했어요.');
 expect(f.calls.patch[0].body).toMatchObject({status:'dismissed'});
 await page.locator('#basketView [data-inbox-chip="dismissed"]').click();
 await expect(inbox(page).locator(`[data-inbox-todo-row="${id(2)}"] .inbox-todo-done`)).toHaveText('무시함');
 await page.locator('[data-undo-notice] [data-undo-action]').click();
 await page.locator('#basketView [data-inbox-chip="open"]').click();
 await expect(inbox(page).locator(`[data-inbox-todo-row="${id(2)}"]`)).toBeVisible();
 await expect.poll(()=>f.calls.patch.length).toBe(2);
 expect(f.calls.patch[1]).toMatchObject({query:{status:'eq.dismissed'},body:{status:'open',decided_at:null}});
 expect(f.errors).toEqual([]);
});

test('정리함 [다시 찾기]: new candidates appear; a limit is one plain notice and is not retried',async({page})=>{
 const f=await fixture(page);
 await openInbox(page);
 await expect.poll(()=>f.calls.ai.length).toBe(1);
 const find=page.locator('#basketView [data-inbox-find]');await expect(find).toBeEnabled();
 f.queue.push({json:{ok:true,kind:'todo_radar',added:1,found:1,partial:false,checked_at:'2026-10-06T01:00:00Z',promises:[]}});
 f.db.rows.push(cand(9,{summary:'새로 찾은 가상 요청'}));f.db.state={last_success_at:'2026-10-06T01:00:00Z',last_partial:false};
 await find.click();
 await expect(page.locator('#toast')).toHaveText('새로 1개 찾았어요.');
 await expect(inbox(page).locator(`[data-inbox-todo-row="${id(9)}"]`)).toBeVisible();
 f.queue.push({status:429,json:{ok:false,error:'daily_limit',message:'서버 문구'}});
 await expect(find).toBeEnabled();await find.click();
 await expect(page.locator('#toast')).toHaveText('오늘 챙길 것을 찾을 수 있는 횟수를 다 썼어요. 내일 다시 찾아요.');
 await expect(inbox(page).locator('[data-inbox-todo-row]')).toHaveCount(3);
 await page.waitForTimeout(300);
 expect(f.calls.ai.map(a=>a.mode)).toEqual(['auto','again','again']);
 expect(f.errors).toEqual([]);
});

test('정리함: the source button opens the update in the basket view',async({page})=>{
 const f=await fixture(page);
 await openInbox(page);
 await inbox(page).locator(`[data-inbox-todo-row="${id(1)}"] [data-inbox-todo-source]`).click();
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 expect(f.errors).toEqual([]);
});

// FEAT-1029 ⑤ 텔레그램에서 나한테 온 요청: 출처 버튼은 '텔레그램 · 방 이름'(소식 표 한 번 읽기), 누르면 텔레그램 화면.
const TG_FEED='c0000000-0000-4000-8000-000000000301';
for(const width of [412,884,1440])test(`정리함 telegram candidate: room in the source, opens the telegram view ${width}`,async({page})=>{
 const feedReads=[];
 const routes=()=>page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',route=>{
  const q=new URL(route.request().url()).searchParams;
  if(q.get('id')?.startsWith('in.')){feedReads.push(Object.fromEntries(q));return route.fulfill({json:[{id:TG_FEED,room_key:'-100777',room_label:'가상 간부방'}]});}
  return route.fulfill({json:[]});
 });
 const f=await fixture(page,{width,routes,rows:[cand(1,{source_kind:'telegram',source_id:TG_FEED,due:'2026-10-09',summary:'가상 교섭 자료 보내기'}),cand(2,{summary:'가상 조직 회신'})]});
 await openInbox(page);
 const row=inbox(page).locator(`[data-inbox-todo-row="${id(1)}"]`);
 await expect(row.locator('[data-inbox-todo-source]')).toHaveText('텔레그램 · 가상 간부방');
 await expect(row.locator('[data-inbox-todo-due]')).toHaveText('10.9 (금)');
 await expect(inbox(page).locator(`[data-inbox-todo-row="${id(2)}"] [data-inbox-todo-source]`)).toHaveText('업데이트');
 expect(feedReads.length).toBeGreaterThanOrEqual(1);
 expect(feedReads[0]).toMatchObject({source:'eq.telegram',id:`in.(${TG_FEED})`,select:'id,room_key,room_label'});
 expect(await noWideScroll(page)).toBe(true);
 await tap(page,row.locator('[data-inbox-todo-source]'),width);
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('telegram');
 expect(f.errors.filter(e=>!/telegram|feed/i.test(e))).toEqual([]);
});
