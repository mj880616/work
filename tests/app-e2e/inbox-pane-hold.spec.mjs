import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {basketKindButton,openKindMenu,chooseBasketKind} from './helpers/basket-kind.mjs';

// BASKET-정리함이름 / UPD-보류이름통일: the 정리함's top-right switch [업데이트 n][챙길 것 n] (counts = unprocessed only), the 챙길 것 chips and
// row buttons, [노트] as an independent menu item, and [보류로] / [보류 해제] in the list menu. Supabase REST is the only synthetic part.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';
const nid=n=>'10000000-0000-4000-8000-00000000000'+n,cid=n=>'c0000000-0000-4000-8000-00000000000'+n;
const SRC='c0000000-0000-4000-8000-000000000101';
const cand=(n,over={})=>({id:cid(n),kind:'request',summary:`합성 챙길 것 ${n}`,due:null,source_kind:'basket',source_id:SRC,source_day:'2026-10-06',evidence:`근거 ${n}`,project_id:null,organization_id:null,status:'open',task_id:null,decided_at:null,created_at:`2026-10-06T0${n}:00:00Z`,...over});

async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 await openHome(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource|net::ERR_FAILED/.test(e.text()))errors.push(e.text());});
 const note=(id,raw,extra={})=>({id,workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:raw,ai_export_allowed:true,archived_at:null,attachments:[],metadata:{},...extra});
 const db={
  app_notes:[note(nid(1),'합성 미분류 하나'),note(nid(2),'합성 미분류 둘'),note(nid(3),'합성 보류한 것',{archived_at:stamp})],
  app_todo_candidates:[cand(1),cand(2),cand(3,{status:'tasked',task_id:'g1',decided_at:stamp}),cand(4,{status:'dismissed',decided_at:stamp})],
 };
 const patches=[];
 await page.route(SB+'/rest/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop();
  if(!Object.hasOwn(db,table))return route.fallback();
  const q=url.searchParams,pick=()=>db[table].filter(r=>[...q.entries()].every(([k,v])=>{
   if(['select','order','limit','offset','workspace_id'].includes(k))return true;
   if(v.startsWith('eq.'))return String(r[k]??'')===v.slice(3);
   if(v.startsWith('in.('))return v.slice(4,-1).split(',').includes(String(r[k]));
   return true;}));
  if(req.method()==='GET')return route.fulfill({json:pick()});
  if(req.method()==='PATCH'){const body=req.postDataJSON(),hit=pick();patches.push({table,body});for(const r of hit)Object.assign(r,body);return route.fulfill({json:hit});}
  return route.fulfill({status:403,json:{message:'시험에서 막음'}});
 });
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 return {errors,patches,db};
}
async function enter(page){
 await basketKindButton(page,'memo').click();
 await expect(page.locator('#basketView')).toBeVisible();
 await expect(page.locator('[data-basket-list-status]')).toHaveText(/개 업데이트/);
}
const paneBtn=(page,pane)=>page.locator(`#basketView [data-inbox-pane="${pane}"]`);

for(const width of [390,1280])test(`pane switch counts only unprocessed, chips and row buttons of 챙길 것 ${width}`,async({page})=>{
 const f=await fixture(page,width);await enter(page);
 await expect(page.locator('#basketView h2')).toHaveText('정리함');
 await expect(paneBtn(page,'update')).toContainText('업데이트');await expect(paneBtn(page,'update')).toContainText('2');
 await expect(paneBtn(page,'todo')).toContainText('챙길 것');await expect(paneBtn(page,'todo')).toContainText('2');
 await expect(page.locator('#basketView [data-basket-filter]')).toHaveText(['미분류 2','분류 완료','보류']);
 await paneBtn(page,'todo').click();
 await expect(page.locator('#basketView')).toHaveAttribute('data-pane','todo');
 const chips=page.locator('#basketView [data-inbox-chip]');
 await expect(chips).toHaveText(['처리 전 2','할 일로 보냄','무시함']);
 const todoRows=page.locator('#basketView [data-inbox-todo-row]');
 await expect(todoRows).toHaveCount(2);
 await expect(todoRows.first().locator('[data-inbox-todo-source]')).toBeVisible();
 await expect(todoRows.first().locator('.inbox-todo-actions button')).toHaveText(['할 일로','무시']);
 await chips.nth(1).click();await expect(todoRows).toHaveCount(1);await expect(todoRows.first()).toContainText('할 일로 보냄');
 await chips.nth(2).click();await expect(todoRows).toHaveCount(1);await expect(todoRows.first()).toContainText('무시함');
 await chips.nth(0).click();
 // [무시] moves the row out of 처리 전 and the numbers drop at once.
 await todoRows.first().locator('[data-inbox-todo-dismiss]').click();
 await expect(todoRows).toHaveCount(1);await expect(paneBtn(page,'todo')).toContainText('1');
 expect(f.patches.some(p=>p.table==='app_todo_candidates'&&p.body.status==='dismissed')).toBe(true);
 await paneBtn(page,'update').click();
 await expect(page.locator('#basketView')).toHaveAttribute('data-pane','update');
 expect(f.errors).toEqual([]);
});

// BASKET-전환버튼고정: 쪽을 바꿔도 [업데이트][챙길 것] 전환 버튼의 자리(x)·폭이 같다(⋯ 자리는 두 쪽 모두 같은 폭).
for(const width of [390,1280])test(`pane switch buttons keep their place when the side changes ${width}`,async({page})=>{
 const f=await fixture(page,width);await enter(page);
 const spot=async()=>{const u=await paneBtn(page,'update').boundingBox(),t=await paneBtn(page,'todo').boundingBox();return {ux:u.x,uw:u.width,tx:t.x,tw:t.width,uy:u.y,ty:t.y};};
 const first=await spot();
 expect(first.uw).toBe(first.tw);
 await paneBtn(page,'todo').click();await expect(page.locator('#basketView')).toHaveAttribute('data-pane','todo');
 expect(await spot()).toEqual(first);
 await paneBtn(page,'update').click();await expect(page.locator('#basketView')).toHaveAttribute('data-pane','update');
 expect(await spot()).toEqual(first);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`[노트] is its own menu item and no [업데이트|노트] switch is drawn ${width}`,async({page})=>{
 const f=await fixture(page,width);await enter(page);
 await expect(page.locator('#basketView [data-basket-kind]')).toHaveCount(0);
 await openKindMenu(page,'note');
 await expect(basketKindButton(page,'note')).toBeVisible();
 await chooseBasketKind(page,'note');
 await expect(page.locator('#basketView')).toHaveAttribute('data-kind','note');
 await page.goBack().catch(()=>{});
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`list menu [보류로] / [보류 해제] move the row and the 미분류 number ${width}`,async({page})=>{
 const f=await fixture(page,width);await enter(page);
 const rows=page.locator('#basketView [data-basket-row]');
 await expect(rows).toHaveCount(2);
 const first=rows.first(),firstId=await first.getAttribute('data-basket-row');
 await page.locator(`#basketView [data-basket-row-more="${firstId}"]`).click();
 const menu=page.locator('#basketRowMenu');
 await expect(menu.getByRole('button',{name:'보류로',exact:true})).toBeVisible();
 await menu.getByRole('button',{name:'보류로',exact:true}).click();
 await expect(rows).toHaveCount(1);
 await expect(page.locator('#basketView [data-basket-filter="unclassified"]')).toContainText('1');
 expect(f.patches.some(p=>p.table==='app_notes'&&p.body.archived_at)).toBe(true);
 await page.locator('#basketView [data-basket-filter="archived"]').click();
 await expect(page.locator(`#basketView [data-basket-row="${firstId}"]`)).toHaveCount(1);
  await page.locator(`#basketView [data-basket-row-more="${firstId}"]`).click();
 await expect(menu.getByRole('button',{name:'보류 해제',exact:true})).toBeVisible();
 await menu.getByRole('button',{name:'보류 해제',exact:true}).click();
 await expect(page.locator('#basketView [data-basket-filter="unclassified"]')).toContainText('2');
 expect(f.errors).toEqual([]);
});
