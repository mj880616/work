import {test,expect} from '@playwright/test';
import {openHome, openQuickBox } from './helpers/home-entry.mjs';
import {pressRowAct} from './helpers/nbx-act.mjs';
// JOURNAL-챙길것 / AI-서버연동 S5 → HOME-업무일지홈(2026-10-30): 홈·업무일지의 '챙길 것' 상자는 화면째 없앴다. 남은 것:
// ① 그날 이 탭에서 홈을 처음 열 때 서버에 한 번 찾기(D7, home-summary.js → todo-radar.js autoFindToday)
// ② 홈 [하루] 카드 맨 위 '나한테 온 요청' 상자(S52-09) + 맨 아래 흐린 한 줄 '챙길 것 n · 정리 안 된 것 n ›'(누르면 정리함)
// ③ 후보 줄은 정리함 한 목록(forget-list.js, S52-20) 하나: [할 일로]·×·[다시 찾기]·내용 눌러 출처 열기·텔레그램 방 이름, 제안 기한은 작은 줄 글.
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
 const f=await openHome(page,{query,features:[]});
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
 await page.reload();await openQuickBox(page);await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 return {...f,db,calls,errors,queue};
}
// S52-20 HOME-잊지말기한목록: 후보 줄은 정리함 한 목록(forget-list.js)의 같은 줄 — 텔레그램 요청·챙길 것·가족·업데이트가 함께.
const inbox=page=>page.locator('#basketView [data-forget-section]');
const line=(page,n)=>page.locator(`#basketView [data-nbx-row="c:${id(n)}"]`);
const openInbox=async page=>{await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('#basketView')).toBeVisible();await expect(inbox(page).locator('[data-forget-src="todo"],[data-forget-src="telegram"]').first()).toBeVisible();};
// Phone: a real touch tap (locator.tap waits again when the box redraws after the automatic find); PC: a click.
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const createsOf=page=>{const list=[];page.on('request',r=>{if(r.url().includes('/functions/v1/google-tasks')&&new URL(r.url()).searchParams.get('action')==='create')list.push(r.postDataJSON());});return list;};
const btn=(row,name)=>row.getByRole('button',{name,exact:true});


for(const width of [412,884,1440])test(`home: the first open of the day asks once (auto), and the 잊지 말기 line counts and opens the 정리함 ${width}`,async({page},info)=>{
 const f=await fixture(page,{width,routes:()=>page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:['telegram']})),rows:[cand(1,{kind:'deadline',due:'2026-10-09',summary:'가상 의견 제출'}),cand(2,{source_kind:'org_update',organization_id:ORG,summary:'가상 조직 회신'}),cand(3,{source_kind:'telegram',source_id:id(301),summary:'가상 나한테 온 요청'})]});
 await expect(page.locator('#homeView')).toBeVisible();
 // ① one automatic look a day, kind + mode only.
 // (운영자 기능 telegram이 있으면 업무일지 '기억할 만한 일' 읽기도 ai-assist를 부르므로 챙길 것 찾기만 센다.)
 const radarCalls=()=>f.calls.ai.filter(c=>c.kind==='todo_radar');
 await expect.poll(()=>radarCalls().length).toBe(1);expect(radarCalls()[0]).toEqual({kind:'todo_radar',mode:'auto'});
 // ② 처리 안 한 수(요청 1 + 챙길 것 2 + 미분류 업데이트 0 = 3)는 메뉴 '홈' 표시로 보인다. QUICK-입력정리(2026-11-28): 홈 칩·띠 줄은 없다.
 await expect(page.locator('#appView')).toHaveAttribute('data-home-asks','3');
 await expect(page.locator('#homeView [data-home-summary],#homeView [data-home-forget-open],#homeView .home-summary-open,#homeView .home-summary-rest')).toHaveCount(0);
 expect(await noWideScroll(page)).toBe(true);
 // 옛 챙길 것 상자는 홈 어디에도 없다.
 await expect(page.locator('#homeView [data-journal-radar],#homeView [data-home-card="radar"],#homeView [data-radar-row]')).toHaveCount(0);
 await page.screenshot({path:info.outputPath(`home-summary-${width}.png`)});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 // 정리함: 텔레그램 요청과 챙길 것이 한 목록의 같은 줄.
 await expect(inbox(page).locator('[data-forget-src="todo"]')).toHaveCount(2);
 await expect(inbox(page).locator('[data-forget-src="telegram"] .nbx-body')).toHaveText(['가상 나한테 온 요청']);
 // Back home again in the same tab: no second automatic look.
 await page.evaluate(()=>window.KPTURouter.go('home'));
 await expect(page.locator('#homeView')).toBeVisible();
 await page.waitForTimeout(300);
 expect(radarCalls()).toHaveLength(1);
 expect(f.calls.patch).toEqual([]);expect(f.errors).toEqual([]);
});

test('home: a candidate table that is not applied counts as 0; nothing else breaks',async({page})=>{
 const f=await fixture(page,{tables:false});
 await expect(page.locator('#homeView [data-journal-schedule]')).toBeVisible();
 await page.waitForTimeout(300);
 await page.waitForLoadState('networkidle');
 // A table that is not applied counts as 0 (inbox-count.js), so the menu home mark shows nothing instead of failing.
 await expect(page.locator('#appView')).not.toHaveAttribute('data-home-asks',/.*/);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`정리함: the suggested due is in the small line; [할 일로] opens the task window, and saving moves the row to 보냄 ${width}`,async({page})=>{
 const creates=createsOf(page);
 const f=await fixture(page,{width});
 await openInbox(page);
 const row=line(page,1);
 await expect(row.locator('.nbx-body')).toHaveText('가상 의견 제출');
 await expect(row.locator('.nbx-meta')).toHaveText('AI 제안업데이트에서 · 10/6 · 기한 10.9 (금)›');
 // No due → no due text.
 await expect(line(page,2).locator('.nbx-meta')).not.toContainText('기한');
 // 2026-11-27 사용자 결정: [할 일로]는 바로 만들지 않고 고쳐 쓰는 할 일 창을 연다(옛 ⋯ [수정해서 할 일로]와 합침). 저장해야 만들어지고 줄이 빠진다.
 for(const [n,title,links] of [[1,'가상 의견 제출',[]],[2,'가상 조직 회신',[{organization_id:ORG}]]]){
  await tap(page,btn(line(page,n),'할 일로'),width);
  await expect(page.locator('#gtTaskModal:not(.hidden)')).toHaveCount(1);
  await expect(page.locator('#gtEditTitle')).toHaveValue(title);
  expect(creates.length).toBe(n-1);
  await expect(line(page,n)).toBeVisible();
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>creates.length).toBe(n);
  expect(creates[n-1]).toMatchObject({action:'create',title,links});
  await expect(line(page,n)).toHaveCount(0);
 }
 await expect.poll(()=>f.calls.patch.map(p=>[p.query.status,p.body.status])).toEqual([['eq.open','tasked'],['eq.open','tasked']]);
 expect(await noWideScroll(page)).toBe(true);
 expect(f.errors).toEqual([]);
});

test('정리함: [×] moves the row to 무시 with a 5 s [되돌리기] that brings it back',async({page})=>{
 const f=await fixture(page);
 await openInbox(page);
 await pressRowAct(page,line(page,2),'dismissed');
 await expect(line(page,2)).toHaveCount(0);
 await expect(page.locator('[data-undo-notice]')).toContainText('무시했어요.');
 expect(f.calls.patch[0].body).toMatchObject({status:'dismissed'});
 await page.locator('[data-undo-notice] [data-undo-action]').click();
 await expect(line(page,2)).toBeVisible();
 await expect.poll(()=>f.calls.patch.length).toBe(2);
 expect(f.calls.patch[1]).toMatchObject({query:{status:'eq.dismissed'},body:{status:'open',decided_at:null}});
 expect(f.errors).toEqual([]);
});

// TODO-이미함·환류: [이미 함]은 할 일을 만들지 않고 빼며 결과 한 줄을 남긴다. [되돌리기]는 둘 다 되돌린다.
// S52-20: 처리 전 위 '지난주 챙길 것 …' 숫자 줄은 없다(명진 11/07 '챙길 것 정리 숫자 안 보여줘도 돼'). ⋯ [고쳐서 할 일로]는 할 일 창.
for(const width of [390,1280])test(`정리함: [이미 함] moves the row to 이미 함, logs one result, undo brings both back; [할 일로] opens the task window ${width}`,async({page})=>{
 const fb={posts:[],deletes:[]};
 const f=await fixture(page,{width,routes:async()=>{
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_feedback',async route=>{
   const req=route.request(),method=req.method();
   if(method==='POST'){fb.posts.push(req.postDataJSON());return route.fulfill({status:201,json:[{id:'f0000000-0000-4000-8000-000000000001'}]});}
   if(method==='DELETE'){fb.deletes.push(new URL(req.url()).searchParams.get('id'));return route.fulfill({status:204,body:''});}
   return route.fulfill({json:[]});
  });
 }});
 await openInbox(page);
 await expect(page.locator('#basketView')).not.toContainText('지난주 잊지 말기');
 const row=line(page,2);
 await expect(row.locator('.nbx-acts > button')).toHaveText(['할 일로','일정으로','노트로','조직','사업','이미 함','×','⋯']);
 expect(await noWideScroll(page)).toBe(true);
 await tap(page,btn(row,'이미 함'),width);
 await expect(row).toHaveCount(0);
 await expect(page.locator('[data-undo-notice]')).toContainText('이미 한 일로 뺐어요.');
 expect(f.calls.patch[0]).toMatchObject({query:{status:'eq.open'},body:{status:'done'}});
 await expect.poll(()=>fb.posts.length).toBe(1);
 expect(fb.posts[0]).toMatchObject({outcome:'done',kind:'request',source_kind:'org_update',summary:'가상 조직 회신',edited:null});
 await page.locator('[data-undo-notice] [data-undo-action]').click();
 await expect.poll(()=>f.calls.patch.length).toBe(2);
 expect(f.calls.patch[1]).toMatchObject({query:{status:'eq.done'},body:{status:'open',decided_at:null}});
 await expect.poll(()=>fb.deletes).toEqual(['eq.f0000000-0000-4000-8000-000000000001']);
 const back=line(page,2);
 await expect(back).toBeVisible();
 // [할 일로]: 할 일 창이 제목으로 채워져 열리고, 저장 전에는 상태를 바꾸지 않는다(⋯ 안 [수정해서 할 일로]는 없앴다).
 await tap(page,btn(back,'할 일로'),width);
 await expect(page.locator('#gtTaskModal')).toBeVisible();
 await expect(page.locator('#gtEditTitle')).toHaveValue('가상 조직 회신');
 expect(f.calls.patch).toHaveLength(2);
 expect(f.errors).toEqual([]);
});

test('정리함 [다시 찾기]: new candidates appear; a limit is one plain notice and is not retried',async({page})=>{
 const f=await fixture(page);
 await openInbox(page);
 await expect.poll(()=>f.calls.ai.length).toBe(1);
 const find=page.locator('[data-sf-tools="forget"] [data-inbox-find]');await expect(find).toBeEnabled();
 f.queue.push({json:{ok:true,kind:'todo_radar',added:1,found:1,partial:false,checked_at:'2026-10-06T01:00:00Z',promises:[]}});
 f.db.rows.push(cand(9,{summary:'새로 찾은 가상 요청'}));f.db.state={last_success_at:'2026-10-06T01:00:00Z',last_partial:false};
 await find.click();
 await expect(page.locator('#toast')).toHaveText('새로 1개 찾았어요.');
 await expect(line(page,9)).toBeVisible();
 f.queue.push({status:429,json:{ok:false,error:'daily_limit',message:'서버 문구'}});
 await expect(find).toBeEnabled();await find.click();
 await expect(page.locator('#toast')).toHaveText('오늘 잊지 말기를 찾을 수 있는 횟수를 다 썼어요. 내일 다시 찾아요.');
 await expect(inbox(page).locator('[data-forget-src="todo"]')).toHaveCount(3);
 await page.waitForTimeout(300);
 expect(f.calls.ai.map(a=>a.mode)).toEqual(['auto','again','again']);
 expect(f.errors).toEqual([]);
});

test('정리함: pressing the row text opens its source (the update in the basket view)',async({page})=>{
 const f=await fixture(page);
 await openInbox(page);
 await line(page,1).locator('[data-forget-source]').click();
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 expect(f.errors).toEqual([]);
});

// FEAT-1029 ⑤ 텔레그램에서 나한테 온 요청: 작은 줄은 '텔레그램' 꼬리표 + 방 이름(소식 표 한 번 읽기), 내용을 누르면 텔레그램 화면.
const TG_FEED='c0000000-0000-4000-8000-000000000301';
for(const width of [412,884,1440])test(`정리함 telegram candidate: room in the small line, opens the telegram view ${width}`,async({page})=>{
 const feedReads=[];
 const routes=()=>page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',route=>{
  const q=new URL(route.request().url()).searchParams;
  if(q.get('id')?.startsWith('in.')){feedReads.push(Object.fromEntries(q));return route.fulfill({json:[{id:TG_FEED,room_key:'-100777',room_label:'가상 간부방'}]});}
  return route.fulfill({json:[]});
 });
 const f=await fixture(page,{width,routes,rows:[cand(1,{source_kind:'telegram',source_id:TG_FEED,due:'2026-10-09',summary:'가상 교섭 자료 보내기'}),cand(2,{summary:'가상 조직 회신'})]});
 await openInbox(page);
 const row=line(page,1);
 await expect(row.locator('.nbx-meta')).toHaveText('텔레그램가상 간부방 · 10/6 · 기한 10.9 (금)›');
 await expect(line(page,2).locator('.nbx-meta')).toHaveText('AI 제안업데이트에서 · 10/6›');
 expect(feedReads.length).toBeGreaterThanOrEqual(1);
 expect(feedReads[0]).toMatchObject({source:'eq.telegram',id:`in.(${TG_FEED})`,select:'id,room_key,room_label'});
 expect(await noWideScroll(page)).toBe(true);
 await tap(page,row.locator('[data-forget-source]'),width);
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('telegram');
 expect(f.errors.filter(e=>!/telegram|feed/i.test(e))).toEqual([]);
});

// 옛 ⋯ [이미 할 일에 있음](이미 있는 할 일 고르기) 시험 둘은 그 단추와 함께 없앴다(2026-11-27 사용자 결정, 쳐내기는 [이미 함]).
