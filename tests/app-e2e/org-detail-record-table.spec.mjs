import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
// ORG-기록하나로 O-5(설계 docs/design/record-one.md 4절 '조직 상세'): 담당조직 상세는 [기록 | 현황 표] 소탭 없이 '날짜 | 기록' 한 표.
// 날짜 칸 = 기록 날짜(기간이면 시작~끝), 최근 10줄 + 그 앞은 '지난 기록 n'(접힘), 줄 ⋯ = [수정][삭제] + (통화·소식·업데이트에서 온 기록만) [원래 글 보기].
// 옛 현황 표 쓰기는 없다(app_org_status_rows 쓰기 0). 서버는 가짜, 이름은 모두 합성 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const orgs=[{id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp}];
const FEED='0f0f0f0f-0000-4000-8000-00000000000f';
const rec=(i,x={})=>({id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,organization_id:'oa',occurred_at:`2026-09-${String(i).padStart(2,'0')}T03:00:00Z`,end_day:null,raw_text:`합성 기록 ${i}`,detail_text:null,doc:null,source_kind:null,source_id:null,...x});
const UP=[...Array.from({length:11},(_,i)=>rec(i+1)),rec(20,{raw_text:'합성 파업 찬반투표',end_day:'2026-09-24'}),rec(21,{raw_text:'합성 통화에서 온 기록',source_kind:'feed',source_id:FEED})];
async function fixture(page,{width}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await installViewPrefsServer(page,null);
 const f=await openHome(page);
 const db={statusWrites:[],feedReads:0,patches:[]};
 const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return json(route,id?orgs.filter(o=>'eq.'+o.id===id):orgs)});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return json(route,q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner})))});
 const ups=UP.map(r=>({...r}));db.patches=[];
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>{const req=route.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='PATCH'){const b=req.postDataJSON(),id=(q.get('id')||'').replace(/^eq\./,'');db.patches.push({id,...b});const hit=ups.filter(r=>r.id===id);hit.forEach(r=>Object.assign(r,b));return json(route,hit)}
  return json(route,ups)});
 for(const t of ['app_notes','app_record_links'])await page.route(SB+`/rest/v1/${t}?**`,route=>json(route,[]));
 await page.route(/\/rest\/v1\/app_org_status_rows(\?|$)/,route=>{if(route.request().method()!=='GET')db.statusWrites.push(route.request().method());return json(route,[])});
 await page.route(SB+'/rest/v1/app_feed_items?**',route=>{const q=new URL(route.request().url()).searchParams;db.feedReads++;return json(route,q.get('id')==='eq.'+FEED&&q.get('workspace_id')?[{source:'call',day:'2026-09-21',title:'합성 통화 제목',summary:'합성 통화 요약 글'}]:[])});
 return {f,db,errors};
}
async function openOrg(page){
 await clickView(page,'team');
 await page.locator('#soOrganizationList [data-so-org="oa"]').click();
 await expect(page.locator('#wdModal')).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText(orgs[0].name);
}
const row=(page,i)=>page.locator(`#wdUpdates [data-wd-up="${rec(i).id}"]`);

for(const width of [390,884,1440])test(`조직 상세 '날짜 | 기록' 한 표: 소탭 없음·최근 10줄·지난 기록 접힘·원래 글 보기 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width});
 await openOrg(page);
 // 옛 [기록 | 현황 표] 소탭은 없다. 기록 입력칸은 바로 보인다.
 await expect(page.locator('#wdSubTabs')).toHaveCount(0);await expect(page.locator('#wdStatusTable')).toHaveCount(0);
 await expect(page.locator('#wdModal')).not.toContainText('현황 표');
 await expect(page.locator('#wdInbox')).toBeVisible();
 // 최근 10줄(날짜 내림차순)만 펼쳐 있고, 그 앞 3줄은 '지난 기록 3'에 접혀 있다.
 const box=page.locator('#wdUpdates');
 await expect(box.locator(':scope > [data-wd-up]')).toHaveCount(10);
 await expect(box.locator(':scope > [data-wd-up]').first()).toHaveAttribute('data-wd-up',rec(21).id);
 const older=box.locator('[data-wd-log-older]');
 await expect(older.locator('summary')).toHaveText('지난 기록 3');
 await expect(row(page,1)).toBeHidden();
 // 날짜 칸: 하루 기록 'M.D.', 기간 기록 '시작~끝'.
 await expect(row(page,11).locator('.wd-log-day')).toHaveText('9.11.');
 await expect(row(page,20).locator('.wd-log-day')).toHaveText('9.20.~9.24.');
 await expect(row(page,20).locator('.wd-log-main')).toContainText('합성 파업 찬반투표');
 // 날짜 칸은 기록 글 왼쪽 한 줄.
 const [d,m]=await Promise.all([row(page,11).locator('.wd-log-day').boundingBox(),row(page,11).locator('.wd-log-main').boundingBox()]);
 expect(d.x+d.width).toBeLessThanOrEqual(m.x+1);expect(Math.abs(d.y-m.y)).toBeLessThan(12);
 await older.locator('summary').click();
 await expect(row(page,1)).toBeVisible();await expect(row(page,1).locator('.wd-log-day')).toHaveText('9.1.');
 // 직접 쓴 기록 ⋯ 에는 [원래 글 보기]가 없다.
 await row(page,11).locator('[data-wd-up-menu]').click();
 const menu=page.locator('#wdUpMenu');
 await expect(menu.getByRole('button',{name:'수정',exact:true})).toBeVisible();
 await expect(menu.getByRole('button',{name:/^원래/})).toHaveCount(0);
 await page.keyboard.press('Escape');
 // 통화에서 온 기록 ⋯ [원래 통화·글 보기] → 줄 아래 원래 글(읽기만), 다시 누르면 접힘.
 await row(page,21).locator('[data-wd-up-menu]').click();
 await menu.getByRole('button',{name:'원래 통화·글 보기'}).click();
 const src=row(page,21).locator('[data-wd-up-src]');
 await expect(src).toContainText('통화');await expect(src).toContainText('합성 통화 요약 글');
 expect(db.feedReads).toBe(1);
 // 지난 기록 펼친 상태는 다시 그려도 그대로.
 await expect(row(page,1)).toBeVisible();
 await row(page,21).locator('[data-wd-up-menu]').click();
 await menu.getByRole('button',{name:'원래 글 접기'}).click();
 await expect(src).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(db.statusWrites).toEqual([]);
 expect(errors).toEqual([]);
});

// ORG-기록날짜고치기(요청함 11/10): 조직 상세 기록 ⋯ [날짜 수정] → 줄 바로 아래 [하루|기간|없음] + 달력(조직보고 표와 같은 칸) → 원래 기록 날짜만.
for(const width of [412,1280])test(`조직 상세 기록 ⋯ [날짜 수정]: 하루로 바꾸면 날짜 칸이 새 날짜, 없음은 '-', 글 그대로 ${width}px`,async({page})=>{
 const {db,errors}=await fixture(page,{width});
 await openOrg(page);
 const menu=page.locator('#wdUpMenu');
 await row(page,11).locator('[data-wd-up-menu]').click();
 await menu.getByRole('button',{name:'날짜 수정'}).click();
 const form=row(page,11).locator('[data-rde-day-form]');
 await expect(form).toBeVisible();
 await expect(form.locator('[data-rde-mode="day"]')).toHaveAttribute('aria-pressed','true');
 await expect(form.locator('[data-rde-field="day"]')).toHaveValue('2026-09-11');
 await form.locator('[data-rde-field="day"]').fill('2026-09-12');
 await form.locator('[data-rde-save]').click();
 await expect(form).toHaveCount(0);
 expect(db.patches.at(-1)).toEqual({id:rec(11).id,occurred_at:'2026-09-12T12:00:00+09:00',end_day:null,day_none:false});
 await expect(row(page,11).locator('.wd-log-day')).toHaveText('9.12.');
 await expect(row(page,11).locator('.wd-log-main')).toContainText('합성 기록 11');
 // 없음
 await row(page,11).locator('[data-wd-up-menu]').click();
 await menu.getByRole('button',{name:'날짜 수정'}).click();
 await form.locator('[data-rde-mode="none"]').click();
 await form.locator('[data-rde-save]').click();
 await expect(row(page,11).locator('.wd-log-day')).toHaveText('-');
 expect(db.patches.at(-1)).toMatchObject({end_day:null,day_none:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});
