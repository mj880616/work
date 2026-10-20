import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-고르기창개선 (PC만, 폰 그대로). A: 담당조직 고르기는 묶음별 줄(왼쪽 묶음 이름, 오른쪽 낮은 칩) + 맨 위 검색칸, 고른 칩은 초록 + ✓,
// 조직 이름은 전체 그대로. 묶음 순서는 철도 / 지하철 / 민자철도 / 민간도시철도, 묶음에 없는 조직은 맨 아래 "그 외".
// B: 프로젝트 고르기는 한 줄에 하나 + 검색칸, 하위는 들여쓰기·흐린 글자("↳" 없음), 작은 체크칸, 고른 줄은 연한 초록, 줄 전체 누름.
// 창은 누른 버튼 바로 아래(anchored-popup.js). C: 같은 창을 쓰는 화면(바구니 [연결하기], 홈 [업데이트 ▾]·[할 일] 프로젝트)과
// 할 일 상세 "연결할 프로젝트·조직" 체크 목록에도 같은 표시.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const NAMES=['전국철도노동조합','서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합','서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부','메트로9호선노동조합','서울교통공사9호선지부','김포도시철도지부','용인경전철지부'];
const LONG='아주 긴 이름의 합성 시험용 지역 공공운수 현장 지부 노동조합 분회';
const quick=page=>page.locator('#homeView [data-home-quick]');
const dialog=page=>page.getByRole('dialog');
async function orgRoutes(page,names){
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:names.map((name,i)=>({id:'o'+i,name,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:names.map((_,i)=>({organization_id:'o'+i}))}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[]}));
}
async function homeOrgSheet(page,width,names){
 await page.setViewportSize({width,height:900});await openHome(page);await orgRoutes(page,names);await page.reload();
 const q=quick(page);await q.locator('[data-quick-mode="update"]').click();await q.locator('[data-quick-input]').fill('QA');
 const trigger=q.locator('[data-quick-org]');await trigger.click();const sheet=dialog(page);await expect(sheet).toBeVisible();
 return {q,trigger,sheet};
}
// The extra projects are served by the network as well (a later catalog reload must not drop them).
const BASE=[{id:'p',name:'테스트 프로젝트',owner_id:'home-test',status:'active',metadata:{project_system:'v2'}},{id:'child',name:'자식 프로젝트',parent_id:'p',owner_id:'home-test',status:'active'}];
const EXTRA=[{id:'grand',name:'손자 프로젝트',parent_id:'child',owner_id:'home-test',status:'active',metadata:{project_system:'v2'}},{id:'other',name:'다른 상위 프로젝트',owner_id:'home-test',status:'active',metadata:{project_system:'v2'}}];
async function homeProjectSheet(page,width){
 await page.setViewportSize({width,height:900});await openHome(page);
 await page.route(SB+'/rest/v1/app_spaces?**',route=>route.fulfill({json:[...BASE,...EXTRA]}));
 await page.evaluate(extra=>{const c=KPTUProjectCatalog,s=c.snapshot();c.publish({workspaceId:s.workspaceId,userId:s.userId,spaces:[...s.spaces,...extra]});},EXTRA);
 const q=quick(page);await q.locator('[data-quick-mode="task"]').click();await q.locator('[data-quick-input]').fill('QA');
 const trigger=q.locator('[data-quick-project]');await trigger.click();const sheet=dialog(page);await expect(sheet).toBeVisible();
 return {q,trigger,sheet};
}
const below=async(trigger,sheet)=>{const t=await trigger.boundingBox(),d=await sheet.boundingBox();return {t,d,gap:d.y-(t.y+t.height)};};

test('PC 담당조직: 묶음 순서대로 한 줄씩(이름 왼쪽, 칩 오른쪽), 그 외는 맨 아래, 이름은 줄이지 않음, 누른 버튼 바로 아래',async({page})=>{
 const {trigger,sheet}=await homeOrgSheet(page,1280,[...NAMES,LONG]);
 await expect(sheet).toHaveClass(/home-choice-anchored/);
 const {d,gap}=await below(trigger,sheet);expect(gap).toBeGreaterThanOrEqual(-1);expect(gap).toBeLessThanOrEqual(12);
 // UI-기록할곳창PC: at 1280 the 기록할 곳 sheet is the wide split list (organizations left, projects right), up to 880px.
 await expect(sheet).toHaveClass(/home-choice-split/);expect(d.width).toBeLessThanOrEqual(880);
 const groups=sheet.locator('[data-sheet-all] [data-sheet-group]');
 await expect(groups.locator('.home-choice-group-name')).toHaveText(['철도','지하철','민자철도','민간도시철도','그 외']);
 expect(await groups.evaluateAll(gs=>gs.map(g=>[...g.querySelectorAll('[data-sheet-value]')].map(b=>b.textContent)))).toEqual([NAMES.slice(0,1),NAMES.slice(1,5),NAMES.slice(5,9),NAMES.slice(9,13),[LONG]]);
 // Each group is one line: its name sits left of its first chip, on the same line.
 for(const g of await groups.all()){
  const name=await g.locator('.home-choice-group-name').boundingBox(),chip=await g.locator('[data-sheet-value]').first().boundingBox();
  expect(name.x+name.width).toBeLessThanOrEqual(chip.x);expect(Math.abs(name.y-chip.y)).toBeLessThanOrEqual(2);
 }
 // Low chips (24px), full names (no ellipsis, nothing cut).
 const chip=sheet.locator('[data-sheet-all] [data-sheet-value]').first();await expect(chip).toHaveCSS('height','24px');
 const long=sheet.locator('[data-sheet-all] [data-sheet-value]').filter({hasText:LONG});await expect(long).toHaveText(LONG);
 // Every letter is drawn inside the chip (the long name wraps instead of being cut or ended with "…").
 expect(await long.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const t=r.getBoundingClientRect(),b=el.getBoundingClientRect();return getComputedStyle(el).textOverflow!=='ellipsis'&&t.left>=b.left-.5&&t.right<=b.right+.5&&t.bottom<=b.bottom+.5;})).toBe(true);
 const lb=await long.boundingBox();expect(lb.x+lb.width).toBeLessThanOrEqual(d.x+d.width);
 // A chosen chip is green with ✓.
 await sheet.locator('[data-sheet-all]').getByRole('button',{name:'서해선지부',exact:true}).click();await expect(sheet).toBeHidden();
 await trigger.click();const chosen=sheet.locator('[data-sheet-all] [aria-pressed="true"]');await expect(chosen).toHaveText('서해선지부');
 await expect(chosen).toBeFocused();
 const look=await chosen.evaluate(el=>{const probe=document.createElement('span');probe.style.color='var(--kptu-success)';document.body.append(probe);const green=getComputedStyle(probe).color;probe.remove();return {green,color:getComputedStyle(el).color,border:getComputedStyle(el).borderTopColor,mark:getComputedStyle(el,'::before').content};});
 expect(look.color).toBe(look.green);expect(look.border).toBe(look.green);expect(look.mark).toContain('✓');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('PC 담당조직: 검색칸이 이름으로 거르고 빈 묶음은 숨김, 맞는 게 없으면 안내, 지우면 다시 전체',async({page})=>{
 const {sheet}=await homeOrgSheet(page,1280,NAMES);
 const box=sheet.getByRole('searchbox',{name:'조직·프로젝트 이름 검색'});await expect(box).toBeVisible();
 // The box stays above the list (outside its scroll).
 expect(await box.evaluate(el=>!el.closest('[data-sheet-content]'))).toBe(true);
 await box.fill('9호선');
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveText(['메트로9호선노동조합','서울교통공사9호선지부']);
 await expect(sheet.locator('[data-sheet-all] [data-sheet-group]:visible .home-choice-group-name')).toHaveText(['민간도시철도']);
 await expect(sheet.locator('[data-sheet-recent]')).toBeHidden();await expect(sheet.locator('[data-sheet-projects] [data-sheet-value]:visible')).toHaveCount(0);
 await box.fill('서울 교통');
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveText(['서울교통공사노동조합','서울교통공사9호선지부']);
 await box.fill('자식');
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(0);await expect(sheet.locator('[data-sheet-projects] [data-sheet-value]:visible')).toHaveText(['자식 프로젝트']);
 await box.fill('없는 이름');await expect(sheet.getByText('맞는 항목이 없어요.')).toBeVisible();
 await box.fill('');await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(13);await expect(sheet.getByText('맞는 항목이 없어요.')).toBeHidden();
 // ↓ goes from the box to the first choice shown; a pick closes the list.
 await box.fill('공항');await box.press('ArrowDown');const first=sheet.locator('[data-sheet-all]').getByRole('button',{name:'공항철도지부',exact:true});await expect(first).toBeFocused();
 await page.keyboard.press('Enter');await expect(sheet).toBeHidden();await expect(quick(page).locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 공항철도지부');
 // Opening again starts with an empty box and every choice.
 await quick(page).locator('[data-quick-org]').click();await expect(box).toHaveValue('');await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(13);
});

test('묶음 값이 없을 때(묶음에 든 조직이 없음): 지금처럼 한 묶음 + 검색, 묶음 이름 없음',async({page})=>{
 const names=['합성 가지부','합성 나지부','합성 다지부'];
 const {sheet}=await homeOrgSheet(page,1280,names);
 await expect(sheet.locator('[data-sheet-all] .home-choice-group')).toHaveCount(1);await expect(sheet.locator('[data-sheet-all] .home-choice-group-name')).toHaveCount(0);
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]')).toHaveText(names);
 await sheet.getByRole('searchbox').fill('나');await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveText(['합성 나지부']);
});

test('PC 프로젝트: 한 줄에 하나, 하위는 들여쓰기·흐린 글자(↳ 없음), 체크칸, 줄 전체 눌러 선택, 검색',async({page})=>{
 const {trigger,sheet}=await homeProjectSheet(page,1280);
 await expect(sheet).toHaveClass(/home-choice-anchored/);
 const {d,gap}=await below(trigger,sheet);expect(gap).toBeGreaterThanOrEqual(-1);expect(gap).toBeLessThanOrEqual(12);expect(d.width).toBeLessThanOrEqual(360);
 const rows=sheet.locator('[data-sheet-value]');
 await expect(rows).toHaveText(['프로젝트 없음','테스트 프로젝트','자식 프로젝트','손자 프로젝트','다른 상위 프로젝트']);
 expect((await sheet.locator('[data-sheet-content]').textContent())).not.toContain('↳');
 const info=await rows.evaluateAll(rs=>rs.map(r=>{const n=r.querySelector('.home-choice-name'),c=r.querySelector('.home-choice-check'),b=r.getBoundingClientRect();return {x:n.getBoundingClientRect().left,color:getComputedStyle(n).color,check:c.getBoundingClientRect().width,h:b.height,w:b.width};}));
 const [, top,child,grand,other]=info;
 expect(child.x).toBeGreaterThan(top.x+10);expect(grand.x).toBeGreaterThan(child.x+10);expect(other.x).toBe(top.x);
 expect(child.color).not.toBe(top.color);expect(grand.color).toBe(child.color);expect(other.color).toBe(top.color);
 for(const r of info){expect(r.check).toBeGreaterThan(10);expect(r.check).toBeLessThanOrEqual(16);expect(r.h).toBeLessThanOrEqual(34);}
 // The whole row is the button: a press at its right end picks it.
 const childRow=sheet.locator('[data-sheet-value="child"]'),b=await childRow.boundingBox();
 await page.mouse.click(b.x+b.width-6,b.y+b.height/2);await expect(sheet).toBeHidden();await expect(trigger).toHaveText('자식 프로젝트 ▾');
 // Picking a parent does not pick its children.
 await trigger.click();await expect(sheet.locator('[aria-pressed="true"]')).toHaveText(['자식 프로젝트']);
 const chosen=sheet.locator('[data-sheet-value="child"]');
 const look=await chosen.evaluate(el=>{const p=document.createElement('span');p.style.background='var(--kptu-success-soft)';p.style.color='var(--kptu-success)';document.body.append(p);const s=getComputedStyle(p),out={soft:s.backgroundColor,green:s.color};p.remove();const c=getComputedStyle(el.querySelector('.home-choice-check'));return {...out,bg:getComputedStyle(el).backgroundColor,check:c.backgroundColor,mark:getComputedStyle(el.querySelector('.home-choice-check'),'::after').content};});
 expect(look.bg).toBe(look.soft);expect(look.check).toBe(look.green);expect(look.mark).toContain('✓');
 await sheet.locator('[data-sheet-value="p"]').click();await trigger.click();await expect(sheet.locator('[aria-pressed="true"]')).toHaveText(['테스트 프로젝트']);
 const box=sheet.getByRole('searchbox',{name:'프로젝트 이름 검색'});await box.fill('손자');
 await expect(sheet.locator('[data-sheet-value]:visible')).toHaveText(['손자 프로젝트']);
 await box.fill('상위');await expect(sheet.locator('[data-sheet-value]:visible')).toHaveText(['다른 상위 프로젝트']);
});

test('폰은 그대로: 아래에서 올라오는 시트, 검색칸 없음, 칩 32px·묶음 이름 없음, 프로젝트 줄 44px·체크칸 없음',async({page})=>{
 const {sheet}=await homeOrgSheet(page,390,NAMES);
 await expect(sheet).not.toHaveClass(/home-choice-anchored/);
 await expect(sheet.getByRole('searchbox')).toBeHidden();await expect(sheet.locator('.home-choice-group-name:visible')).toHaveCount(0);
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]').first()).toHaveCSS('height','32px');
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]')).toHaveText(NAMES);
 const row=sheet.locator('[data-sheet-projects] [data-sheet-value]').first();await expect(row).toHaveCSS('height','44px');
 await expect(row.locator('.home-choice-check')).toBeHidden();
 // A box typed in on a PC and then shrunk to a phone does not keep filtering.
 await page.keyboard.press('Escape');await page.setViewportSize({width:1280,height:900});await quick(page).locator('[data-quick-org]').click();
 await sheet.getByRole('searchbox').fill('9호선');await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(2);
 await page.setViewportSize({width:390,height:844});await expect(sheet).not.toHaveClass(/home-choice-anchored/);
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(13);
});

test('할 일 상세 "연결할 프로젝트·조직"(PC): 하위는 ↳ 없이 들여쓰기·흐린 글자, 조직 묶음 이름; 폰은 ↳ 그대로',async({page})=>{
 await page.setViewportSize({width:1280,height:900});await openHome(page);await orgRoutes(page,NAMES);
 await page.waitForFunction(()=>window.KPTUGoogleTasks?.openEditor);await page.evaluate(()=>window.KPTUGoogleTasks.openEditor());
 const links=page.locator('#gtEditLinkBody');await expect(links.locator('input[value="p:child"]')).toBeVisible();
 const child=links.locator('label.gt-link-opt',{has:page.locator('input[value="p:child"]')}),top=links.locator('label.gt-link-opt',{has:page.locator('input[value="p:p"]')});
 await expect(child.locator('.gt-link-arrow')).toBeHidden();
 const [cx,tx]=await Promise.all([child.locator('input').boundingBox(),top.locator('input').boundingBox()]);expect(cx.x).toBeGreaterThan(tx.x+10);
 const [cc,tc]=await Promise.all([child.locator('span').evaluate(e=>getComputedStyle(e).color),top.locator('span').evaluate(e=>getComputedStyle(e).color)]);expect(cc).not.toBe(tc);
 await expect(links.locator('.gt-org-group-name')).toHaveText(['철도','지하철','민자철도','민간도시철도']);
 await page.setViewportSize({width:390,height:844});
 await expect(child.locator('.gt-link-arrow')).toBeVisible();await expect(child.locator('span')).toHaveText('　↳ 자식 프로젝트');
 await expect(links.locator('.gt-org-group-name:visible')).toHaveCount(0);
});
