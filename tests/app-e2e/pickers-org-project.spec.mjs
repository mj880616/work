import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openWriteFromEntry} from './helpers/write-opener.mjs';
import { expectChoiceAtButton } from './helpers/choice-anchor.mjs';
import { SHEET, openPicker, pressRow, openFolds } from './helpers/area-org-picker.mjs';
// UI-고르기창개선 (PC만, 폰 그대로). A: 담당조직 선택은 묶음별 줄(왼쪽 묶음 이름, 오른쪽 낮은 칩) + 맨 위 검색칸, 고른 칩은 초록 + ✓,
// 조직 이름은 전체 그대로. 묶음 순서는 철도 / 지하철 / 민자철도 / 민간도시철도, 묶음에 없는 조직은 맨 아래 "그 외".
// B: 프로젝트 고르기는 한 줄에 하나 + 검색칸, 하위는 들여쓰기·흐린 글자("↳" 없음), 작은 체크칸, 고른 줄은 연한 초록, 줄 전체 누름.
// 창은 누른 버튼 바로 아래(anchored-popup.js). C: 같은 창을 쓰는 화면(바구니 [연결하기], 홈 [업데이트 ▾]·[할 일] 프로젝트)과
// 할 일 상세 "연결할 프로젝트·조직" 체크 목록에도 같은 표시.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const NAMES=['전국철도노동조합','서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합','서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부','메트로9호선노동조합','서울교통공사9호선지부','김포도시철도지부','용인경전철지부'];
const LONG='아주 긴 이름의 합성 시험용 지역 공공운수 현장 지부 노동조합 분회';
const dialog=page=>page.getByRole('dialog');
async function orgRoutes(page,names){
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:names.map((name,i)=>({id:'o'+i,name,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:names.map((_,i)=>({organization_id:'o'+i}))}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[]}));
}
// QUICK-입력정리(2026-11-28): 홈 [업데이트 ▾]는 지웠다 — 같은 '기록할 곳' 창을 여는 큰 쓰기 창 [기록할 곳 ▾]로 본다.
const placeButton=page=>page.locator('#edWindow [data-edw-place]');
async function homeOrgSheet(page,width,names){
 await page.setViewportSize({width,height:900});await openHome(page);await orgRoutes(page,names);await page.reload();
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});await openWriteFromEntry(page,width);
 const trigger=placeButton(page);await trigger.click();const sheet=page.locator('#edwPlaceSheet');await expect(sheet).toBeVisible();
 // S52-01 ②: 담당조직·사업영역은 접힌 묶음(같은 고르기 창 목록) — 줄을 보려면 펼친다.
 await openFolds(sheet);
 return {trigger,sheet};
}
// The extra projects are served by the network as well (a later catalog reload must not drop them).
const BASE=[{id:'p',name:'테스트 프로젝트',owner_id:'home-test',status:'active',metadata:{project_system:'v2'}},{id:'child',name:'자식 프로젝트',parent_id:'p',owner_id:'home-test',status:'active'}];
const EXTRA=[{id:'grand',name:'손자 프로젝트',parent_id:'child',owner_id:'home-test',status:'active',metadata:{project_system:'v2'}},{id:'other',name:'다른 상위 프로젝트',owner_id:'home-test',status:'active',metadata:{project_system:'v2'}}];
const quickOrgButton=page=>placeButton(page);
const below=async(trigger,sheet)=>{const t=await trigger.boundingBox(),d=await sheet.boundingBox();return {t,d,gap:d.y-(t.y+t.height)};};

// UPD-여러곳고르기 ①: 담당조직도 프로젝트처럼 — 묶음 이름은 작은 소제목, 그 아래 조직이 한 줄에 하나씩 체크칸과 함께.
test('PC 담당조직: 묶음 소제목 아래 한 줄에 하나(체크칸), 그 외는 맨 아래, 이름은 줄이지 않음, 누른 버튼 바로 아래',async({page})=>{
 const {trigger,sheet}=await homeOrgSheet(page,1280,[...NAMES,LONG]);
 await expect(sheet).toHaveClass(/home-choice-anchored/);
 const {d,gap}=await below(trigger,sheet);expect(gap).toBeGreaterThanOrEqual(-1);expect(gap).toBeLessThanOrEqual(12);
 // UI-기록할곳창PC: at 1280 the 기록할 곳 sheet is the wide split list (organizations left, projects right), up to 880px.
 await expect(sheet).toHaveClass(/home-choice-split/);expect(d.width).toBeLessThanOrEqual(880);
 const groups=sheet.locator('[data-sheet-all] .aop-group');
 await expect(groups.locator('.aop-group-label')).toHaveText(['철도','지하철','민자철도','민간도시철도','그 외']);
 expect(await groups.evaluateAll(gs=>gs.map(g=>[...g.querySelectorAll('[data-sheet-value]')].map(b=>b.textContent)))).toEqual([NAMES.slice(0,1),NAMES.slice(1,5),NAMES.slice(5,9),NAMES.slice(9,13),[LONG]]);
 // Each group: the heading above, then its organizations one per line (same left edge), each with a check box.
 for(const g of await groups.all()){
  const name=await g.locator(':scope > .aop-line').boundingBox(),rows=await g.locator('[data-sheet-value]').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.left,top:r.top,bottom:r.bottom};}));
  expect(name.y+name.height).toBeLessThanOrEqual(rows[0].top+1);
  for(let i=1;i<rows.length;i++){expect(rows[i].x).toBe(rows[0].x);expect(rows[i].top).toBeGreaterThanOrEqual(rows[i-1].bottom-.5);}
 }
 // Low rows (32px), full names (no ellipsis, nothing cut).
 const chip=sheet.locator('[data-sheet-all] [data-sheet-value]').first();expect((await chip.boundingBox()).height).toBeLessThanOrEqual(34);await expect(chip.locator('.home-choice-check')).toBeVisible();
 const long=sheet.locator('[data-sheet-all] [data-sheet-value]').filter({hasText:LONG});await expect(long).toHaveText(LONG);
 // Every letter is drawn inside the chip (the long name wraps instead of being cut or ended with "…").
 expect(await long.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const t=r.getBoundingClientRect(),b=el.getBoundingClientRect();return getComputedStyle(el).textOverflow!=='ellipsis'&&t.left>=b.left-.5&&t.right<=b.right+.5&&t.bottom<=b.bottom+.5;})).toBe(true);
 const lb=await long.boundingBox();expect(lb.x+lb.width).toBeLessThanOrEqual(d.x+d.width);
 // A chosen row is light green with a green ✓ box, as a chosen project row.
 await sheet.locator('[data-sheet-all]').getByRole('button',{name:'서해선지부',exact:true}).click();await sheet.getByRole('button',{name:'저장',exact:true}).click();await expect(sheet).toBeHidden();
 await trigger.click();const chosen=sheet.locator('[data-sheet-all] [aria-pressed="true"]');await expect(chosen).toHaveText('서해선지부');
 await expect(chosen).toBeFocused();
 const look=await chosen.evaluate(el=>{const p=document.createElement('span');p.style.background='var(--kptu-success-soft)';p.style.color='var(--kptu-success)';document.body.append(p);const s=getComputedStyle(p),out={soft:s.backgroundColor,green:s.color};p.remove();const c=el.querySelector('.home-choice-check');return {...out,bg:getComputedStyle(el).backgroundColor,check:getComputedStyle(c).backgroundColor,mark:getComputedStyle(c,'::after').content};});
 expect(look.bg).toBe(look.soft);expect(look.check).toBe(look.green);expect(look.mark).toContain('✓');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('PC 담당조직: 검색칸이 이름으로 거르고 빈 묶음은 숨김, 맞는 게 없으면 안내, 지우면 다시 전체',async({page})=>{
 const {sheet}=await homeOrgSheet(page,1280,NAMES);
 const box=sheet.getByRole('searchbox',{name:'조직·사업영역 이름 검색'});await expect(box).toBeVisible();
 // The box stays above the list (outside its scroll).
 expect(await box.evaluate(el=>!el.closest('[data-sheet-content]'))).toBe(true);
 await box.fill('9호선');
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveText(['메트로9호선노동조합','서울교통공사9호선지부']);
 await expect(sheet.locator('[data-sheet-all] .aop-group:visible .aop-group-label')).toHaveText(['민간도시철도']);
 await expect(sheet.locator('[data-sheet-recent]')).toBeHidden();await expect(sheet.locator('[data-sheet-projects] [data-sheet-value]:visible')).toHaveCount(0);
 await box.fill('서울 교통');
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveText(['서울교통공사노동조합','서울교통공사9호선지부']);
 await box.fill('자식');
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(0);await expect(sheet.locator('[data-sheet-projects] [data-sheet-value]:visible .home-choice-name')).toHaveText(['자식 프로젝트']);
 await box.fill('없는 이름');await expect(sheet.locator('[data-sheet-empty][data-wait-empty]')).toBeVisible();await expect(sheet.locator('[data-sheet-empty]')).toHaveText('맞는 항목 없음');
 await box.fill('');await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(13);await expect(sheet.locator('[data-sheet-empty][data-wait-empty]')).toBeHidden();
 // ↓ goes from the box to the first choice shown; Enter marks it and [저장] closes the list.
 await box.fill('공항');await box.press('ArrowDown');const first=sheet.locator('[data-sheet-all]').getByRole('button',{name:'공항철도지부',exact:true});await expect(first).toBeFocused();
 await page.keyboard.press('Enter');await expect(first).toHaveAttribute('aria-pressed','true');await sheet.getByRole('button',{name:'저장',exact:true}).click();await expect(sheet).toBeHidden();await expect(placeButton(page)).toHaveAttribute('aria-label','기록할 곳 선택: 공항철도지부');
 // Opening again starts with an empty box and every choice.
 await placeButton(page).click();await expect(box).toHaveValue('');await openFolds(sheet);await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(13);
});

test('묶음 값이 없을 때(묶음에 든 조직이 없음): 지금처럼 한 묶음 + 검색, 묶음 이름 없음',async({page})=>{
 const names=['합성 가지부','합성 나지부','합성 다지부'];
 const {sheet}=await homeOrgSheet(page,1280,names);
 await expect(sheet.locator('[data-sheet-all] .aop-group')).toHaveCount(0);await expect(sheet.locator('[data-sheet-all] .aop-group-label')).toHaveCount(0);
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]')).toHaveText(names);
 await sheet.getByRole('searchbox').fill('나');await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveText(['합성 나지부']);
});

// S52-01 ②: 빠른 입력 [할 일] 사업영역도 같은 고르기 창(#areaOrgPickSheet) — 큰 묶음만 보이고 꺾쇠로 하위를 펼친다.

// UPD-여러곳고르기: the phone sheet has the same list as a PC (group headings, one organization per 44px line, check boxes on every
// row, since many can be chosen) with [취소] [저장] fixed at the bottom; still no search box.
test('폰: 아래에서 올라오는 시트, 찾기 칸, 묶음 이름 + 조직 줄 44px, 체크칸, 아래 [취소] [저장]',async({page})=>{
 const {sheet}=await homeOrgSheet(page,390,NAMES);
 // S54-05(11/08 명진 결정): 폰도 누른 버튼 아래 작은 창(전에는 아래에서 올라오는 시트). 폰 줄 높이·체크칸·아래 [취소] [저장]은 그대로.
 await expectChoiceAtButton(page,sheet,await quickOrgButton(page),{firstRow:false});
 /* S52-01 ②: 폰도 찾기 칸 */await expect(sheet.getByRole('searchbox')).toBeVisible();await expect(sheet.locator('[data-sheet-all] .aop-group-label')).toHaveText(['철도','지하철','민자철도','민간도시철도']);
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]').first()).toHaveCSS('min-height','44px');
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]')).toHaveText(NAMES);
 const row=sheet.locator('[data-sheet-projects] [data-sheet-value]').first();await expect(row).toHaveCSS('height','44px');
 await expect(row.locator('.home-choice-check')).toBeVisible();
 await expect(sheet.getByRole('button',{name:'저장',exact:true})).toBeVisible();
 // S52-01 ②: 찾기 칸은 폰에도 있어, PC에서 쓴 글자가 폰 폭으로 줄여도 그대로 거른다.
 await page.keyboard.press('Escape');await page.setViewportSize({width:1280,height:900});await placeButton(page).click();
 await sheet.getByRole('searchbox').fill('9호선');await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(2);
 await page.setViewportSize({width:390,height:844});await expect(sheet).toHaveClass(/home-choice-anchored/);
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(2);
});

// S52-01 UI-사업영역조직고르기창: 할 일 연결은 '사업영역'·'조직' 두 줄 + 누르면 고르기 창. 창 안 모양은 위 고르기 창과 같다:
// PC는 하위가 들여쓰기·흐린 글자(↳ 없음), 조직은 묶음 이름(꺾쇠로 펼침). 폰은 같은 창이 아래에서, 찾기 칸도 있다.
test('할 일 연결 고르기 창(PC): 하위는 ↳ 없이 들여쓰기·흐린 글자, 조직 묶음 이름; 폰은 아래 창 + 찾기',async({page})=>{
 await page.setViewportSize({width:1280,height:900});await openHome(page);await orgRoutes(page,NAMES);
 await page.waitForFunction(()=>window.KPTUGoogleTasks?.openEditor);await page.evaluate(()=>window.KPTUGoogleTasks.openEditor());
 await openPicker(page,'#gtEditLinkBody','area');const sheet=page.locator(SHEET);
 await pressRow(page,'p:child');
 const child=sheet.locator('[data-sheet-value="p:child"]'),top=sheet.locator('[data-sheet-value="p:p"]');
 await expect(child).not.toContainText('↳');
 const [cx,tx]=await Promise.all([child.locator('.home-choice-check').boundingBox(),top.locator('.home-choice-check').boundingBox()]);expect(cx.x).toBeGreaterThan(tx.x+10);
 const [cc,tc]=await Promise.all([child.locator('.home-choice-name').evaluate(e=>getComputedStyle(e).color),top.locator('.home-choice-name').evaluate(e=>getComputedStyle(e).color)]);expect(cc).not.toBe(tc);
 await sheet.locator('[data-sheet-save]').click();await expect(sheet).toBeHidden();
 await expect(page.locator('#gtEditLinkBody [data-aop-chip="p:child"] .aop-chip-text')).toHaveText(/ › 자식 프로젝트$/);
 await openPicker(page,'#gtEditLinkBody','org');
 await expect(sheet.locator('.aop-group-name')).toContainText(['철도','지하철','민자철도','민간도시철도']);
 await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
 await page.setViewportSize({width:390,height:844});
 await openPicker(page,'#gtEditLinkBody','org');
 await expect(sheet).toHaveClass(/home-choice-anchored/);await expect(sheet.locator('[data-sheet-search]')).toBeVisible(); // S54-05: 폰도 버튼 아래 작은 창
});

// UI-화면점검 ③ → S52-01: 연결 칸은 테두리 상자·legend 없이 두 줄. 줄 이름은 다른 칸 이름보다 크지 않고 한 줄, 안내 줄 없음(UI-당연한안내삭제).
for(const width of [390,1280])test(`할 일 수정 창 연결 두 줄: 줄 이름 한 줄·라벨보다 크지 않음, 안내 줄 없음 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});await openHome(page);await orgRoutes(page,NAMES);
 await page.waitForFunction(()=>window.KPTUGoogleTasks?.openEditor);await page.evaluate(()=>window.KPTUGoogleTasks.openEditor());
 await expect(page.locator('#gtEditLinkBody .aop-row')).toHaveCount(2);
 const m=await page.evaluate(()=>{
  const modal=document.querySelector('#gtTaskModal'),set=modal.querySelector('.gt-links'),label=modal.querySelector('label'),fs=e=>parseFloat(getComputedStyle(e).fontSize);
  const names=[...set.querySelectorAll('.aop-label')];
  return {names:names.map(e=>e.textContent.trim()),sizes:names.map(fs),labelSize:fs(label),legend:set.querySelectorAll('legend').length,hints:set.querySelectorAll('.gt-links-hint').length,
   oneLine:names.every(e=>e.getBoundingClientRect().height<=parseFloat(getComputedStyle(e).lineHeight||'18')+2||e.getBoundingClientRect().height<=20),groupLabel:set.getAttribute('aria-label'),over:set.scrollWidth-set.clientWidth};
 });
 expect(m.names).toEqual(['사업영역','조직']);expect(m.groupLabel).toBe('연결할 사업영역·조직');
 for(const size of m.sizes)expect(size).toBeLessThanOrEqual(m.labelSize);
 expect(m.legend).toBe(0);expect(m.hints,'고르지 않아도 됩니다 안내 줄은 지웠다').toBe(0);
 expect(m.oneLine).toBe(true);expect(m.over).toBeLessThanOrEqual(1);
});

