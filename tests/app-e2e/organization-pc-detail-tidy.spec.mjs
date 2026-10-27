import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// ORG-PC상세정리(요청함 14:10): PC(≥1024) 담당조직 상세 칸.
// ① 칸 맨 위 '담당조직' + 조직명 줄 없음 → 상단 줄 위치가 '담당조직 › 조직명'. ② ⤢는 입력칸 안 오른쪽 아래, [저장]은 작은 버튼(32px).
// ③ 할 일 줄 [연결 해제]는 ⋯ 안(TASK-바로처리통일로 폰 창도 ⋯ 안 — 공용 할 일 줄). ④ 할 일 제목은 보통 굵기(할 일 화면과 같음). ⑤ 자료 0개는 한 줄. ⑥ 순서: 입력칸 → 기록 → 할 일 → 자료.
// 폰(상세 창)은 그대로. 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const orgs=[
 {id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp},
 {id:'ob',workspace_id:'w',name:'합성 나 지부',active:true,created_by:owner,updated_at:stamp}
];
const linked=[
 {id:'t-1',title:'합성 할 일 하나',taskListId:'@default',due:'2026-10-08T00:00:00.000Z',status:'needsAction',source:'google-task'},
 {id:'t-2',title:'합성 할 일 둘',taskListId:'@default',due:null,status:'needsAction',source:'google-task'}
];
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const state={unlinks:[],tasks:linked.map(t=>({...t}))};
 const list=(route,rows)=>{const q=new URL(route.request().url()).searchParams;const o=Number(q.get('offset')||0);return route.fulfill({json:rows.slice(o,o+Number(q.get('limit')||rows.length||1))})};
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return route.fulfill({json:id?orgs.filter(o=>'eq.'+o.id===id):orgs})});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner}))})});
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>{const q=new URL(route.request().url()).searchParams;return q.get('organization_id')==='eq.oa'?list(route,[{id:'u-1',organization_id:'oa',raw_text:'합성 기록 하나',detail_text:null,occurred_at:stamp}]):list(route,[])});
 await page.route(SB+'/rest/v1/app_documents?**',route=>list(route,[]));
 await page.route(SB+'/functions/v1/google-tasks?**',route=>{
  const req=route.request(),a=new URL(req.url()).searchParams.get('action');
  if(a==='linked')return route.fulfill({json:{tasks:state.tasks}});
  if(a==='unlink'){const body=req.postDataJSON();state.unlinks.push(body);state.tasks=state.tasks.filter(t=>t.id!==body.task_id);return route.fulfill({json:{ok:true}})}
  return route.fallback();
 });
 return {state,errors};
}
const where=page=>page.locator('[data-topline-where]');
const box=loc=>loc.evaluate(el=>{const r=el.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),right:Math.round(r.right),h:Math.round(r.height),w:Math.round(r.width)}});
const press=loc=>loc.evaluate(el=>{const a=getComputedStyle(el,'::after');return Math.max(el.getBoundingClientRect().height,a.content==='none'?0:parseFloat(a.height)||0)});

for(const width of [1280,1440])test(`PC ${width}: 담당조직 상세 칸 정리(위치 줄 조직명·순서·⤢·작은 저장·⋯ 안 연결 해제·제목 굵기·자료 0 한 줄)`,async({page})=>{
 const {state,errors}=await fixture(page,width);
 await clickView(page,'team');
 const modal=page.locator('#wdDetailPane #wdModal');await expect(modal).toBeVisible();
 await expect(page.locator('#wdTitle')).toHaveText('합성 가 지부');
 // ① 칸 맨 위 '담당조직' 작은 제목 + 조직명 줄은 없고, 상단 줄 위치가 '담당조직 › 조직명'을 보여 준다.
 await expect(modal.locator('.modal-head')).toBeHidden();await expect(modal.locator('.eyebrow')).toBeHidden();
 await expect(modal).toHaveAttribute('aria-labelledby','wdTitle');
 await expect(where(page).locator('li')).toHaveText(['담당조직','합성 가 지부']);
 await expect(where(page).locator('[aria-current="page"]')).toHaveText('합성 가 지부');
 await page.locator('#soOrganizationList [data-so-org="ob"]').click();await expect(page.locator('#wdTitle')).toHaveText('합성 나 지부');
 await expect(where(page).locator('li')).toHaveText(['담당조직','합성 나 지부']);
 await page.locator('#soOrganizationList [data-so-org="oa"]').click();await expect(page.locator('#wdTitle')).toHaveText('합성 가 지부');
 await expect(where(page).locator('li')).toHaveText(['담당조직','합성 가 지부']);
 await expect(modal.locator('#wdUpdates')).toContainText('합성 기록 하나');
 await expect(modal.locator('#wdTaskBody [data-google-task]')).toHaveCount(2);
 // ⑥ 순서: 입력칸 → 기록 → 할 일 → 자료(보이는 순서와 요소 순서·Tab 순서가 같다).
 const ids=['#wdInboxText','#wdLog','#wdTasks','#wdDocs'];
 const tops=[];for(const id of ids)tops.push((await box(modal.locator(id))).top);
 expect(tops,'보이는 순서').toEqual([...tops].sort((a,b)=>a-b));
 expect(await modal.evaluate((m,ids)=>{const els=ids.map(id=>m.querySelector(id));return els.every((el,i)=>!i||(els[i-1].compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))},ids),'요소 순서').toBe(true);
 // ② ⤢는 입력칸 안 오른쪽 아래(보조 32px, 누르는 범위 44px), [저장]은 작은 버튼 32px(누르는 범위 44px).
 const input=await box(modal.locator('#wdInboxText')),big=modal.locator('#wdInboxBig'),save=modal.locator('#wdInboxSave');
 await expect(big).toBeVisible();await expect(big).toHaveAccessibleName('크게');
 const b=await box(big),s=await box(save);
 expect(b.h).toBe(32);expect(await press(big)).toBeGreaterThanOrEqual(44);
 expect(b.left).toBeGreaterThanOrEqual(input.left+input.w/2);expect(b.right).toBeLessThanOrEqual(input.right);
 expect(b.top).toBeGreaterThanOrEqual(input.top+input.h/2);expect(b.bottom).toBeLessThanOrEqual(input.bottom);
 expect(await big.evaluate(el=>[...el.childNodes].some(n=>n.nodeType===1&&n.matches('svg')&&n.getBoundingClientRect().width>0))).toBe(true);
 expect(await big.evaluate(el=>el.querySelector('.wd-inbox-big-label').getClientRects().length),'⤢ 옆 "크게" 글자는 칸에서 숨김').toBe(0);
 expect(s.h).toBe(32);expect(await press(save)).toBeGreaterThanOrEqual(44);expect(s.top).toBeGreaterThanOrEqual(input.bottom);expect(s.w).toBeLessThan(140);
 // ⤢ and 저장 keep working: ⤢ opens the big window with the text; Ctrl+Enter in the input still saves through [저장].
 await modal.locator('#wdInboxText').fill('합성 큰 창 글');await big.click();
 await expect(page.locator('#edWindow')).toBeVisible();await expect(page.locator('#edWindow .ed-window-body .ProseMirror')).toContainText('합성 큰 창 글');
 await page.locator('#edWindow [data-close="edWindow"]').click();await expect(page.locator('#edWindow')).toHaveCount(0);
 await expect(modal.locator('#wdInboxText')).toHaveValue('합성 큰 창 글');
 // ③ 할 일 줄마다 [연결 해제] 버튼은 없고 ⋯ 안에 있다. TASK-바로처리통일: PC는 마우스를 올렸거나 초점이 있는 줄에만 ⋯가 보인다.
 const rows=modal.locator('#wdTaskBody [data-google-task]');
 await expect(rows.getByRole('button',{name:/연결 해제/})).toHaveCount(0);
 const more=rows.first().locator('[data-gt-linked-more]');await rows.first().hover();await expect(more).toBeVisible();await expect(more).toHaveText('⋯');
 const m=await box(more);expect(m.w).toBe(44);expect(m.h).toBe(44);
 // ④ 할 일 제목은 굵지 않다(할 일 화면 목록과 같은 13px·보통 굵기).
 for(const t of await rows.locator('.gt-main b').all())await expect(t).toHaveCSS('font-weight','400');
 await expect(rows.first().locator('.gt-main b')).toHaveCSS('font-size','13px');
 await more.click();
 const menu=page.locator('#gtLinkedMenu');await expect(menu).toBeVisible();await expect(menu.getByRole('button')).toHaveText(['내일로','기한 바꾸기','고치기','연결 해제','지우기']);
 await expect(more).toHaveAttribute('aria-expanded','true');
 await menu.getByRole('button',{name:'연결 해제'}).click();
 await expect(rows).toHaveCount(1);await expect(menu).toBeHidden();
 expect(state.unlinks).toEqual([{action:'unlink',task_id:'t-1',links:[{organization_id:'oa'}]}]);
 // Keyboard: ⋯ opens with Enter, Escape closes back to ⋯.
 const more2=rows.first().locator('[data-gt-linked-more]');await more2.focus();await page.keyboard.press('Enter');
 await expect(menu).toBeVisible();await expect(menu.getByRole('button',{name:'내일로'})).toBeFocused();
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(more2).toBeFocused();
 // ⑤ 자료가 0개면 큰 점선 상자 대신 한 줄.
 const docs=modal.locator('#wdDocBody');
 await expect(docs.locator('.wd-doc-none,.empty,.wd-doc-row')).toHaveCount(0);
 expect((await box(docs.locator('[data-wd-doc-state]'))).h).toBeLessThanOrEqual(24);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 // Another screen: the top line no longer names the organization.
 await clickView(page,'home');await expect(where(page).locator('li')).toHaveText(['홈']);
 await clickView(page,'team');await expect(where(page).locator('li')).toHaveText(['담당조직','합성 가 지부']);
 expect(errors).toEqual([]);
});

test('폰 390: 상세 창은 그대로(제목 줄, [크게]·[저장] 한 줄, 줄마다 ⋯ 안에 [연결 해제], 할 일 → 자료 → 기록, 자료 0 안내 상자)',async({page})=>{
 const {errors}=await fixture(page,390);
 await clickView(page,'team');
 await page.locator('#soOrganizationList [data-so-org="oa"]').click();
 const modal=page.locator('#wdModal');await expect(modal).toBeVisible();await expect(modal).toHaveAttribute('role','dialog');
 await expect(modal.locator('.modal-head')).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText('합성 가 지부');
 const big=modal.locator('#wdInboxBig'),save=modal.locator('#wdInboxSave');
 await expect(big).toHaveText('크게');await expect(big.locator('.wd-inbox-big-label')).toBeVisible();
 const b=await box(big),s=await box(save);expect(b.h).toBe(32);expect(s.h).toBe(36);expect(Math.abs((b.top+b.h/2)-(s.top+s.h/2))).toBeLessThanOrEqual(1);/* UI-버튼전수조사: [크게]는 보조 32px, [저장] 36px, 같은 줄 가운데 */
 await expect(modal.locator('#wdTaskBody [data-google-task]')).toHaveCount(2);
 // TASK-바로처리통일: 폰은 줄마다 ⋯가 늘 보이고 [연결 해제]는 그 안(창 안에서 열림).
 for(const m of await modal.locator('#wdTaskBody [data-gt-linked-more]').all())await expect(m).toBeVisible();
 await expect(modal.locator('#wdTaskBody').getByRole('button',{name:/연결 해제/})).toHaveCount(0);
 await modal.locator('#wdTaskBody [data-gt-linked-more]').first().click();
 const menu=page.locator('#gtLinkedMenu');await expect(menu).toBeVisible();await expect(menu.getByRole('button',{name:'연결 해제'})).toBeVisible();
 expect(await menu.evaluate(m=>!!m.closest('#wdModal'))).toBe(true);
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(modal).toBeVisible();
 const order=await modal.locator('.wd-card').evaluate(card=>[...card.querySelectorAll(':scope > .wd-sec')].map(sec=>sec.id||sec.querySelector('h3')?.textContent?.trim()));
 expect(order.slice(0,4)).toEqual(['wdTasks','wdDocs','wdReports','wdLog']);
 await expect(modal.locator('#wdDocBody .empty')).toHaveCount(0);
 expect(errors).toEqual([]);
});
