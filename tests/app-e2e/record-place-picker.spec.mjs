import {test,expect} from '@playwright/test';
import {openHome,createdTaskReply} from './helpers/home-entry.mjs';
// UI-기록할곳창PC: 넓은 PC(1024px~)에서 [업데이트 ▾] "기록할 곳 선택" 창은 넓게 — 제목 옆 검색칸 하나, 그 아래 "최근" 한 줄, 그 아래
// 왼쪽 담당조직(묶음별 줄) / 오른쪽 프로젝트(한 줄 목록). 1280×800에서 창 안 스크롤 없이 한 번에 보이고, 항목이 아주 많으면 각 열 안에서만
// 스크롤. 폰·중간 폭은 위아래 순서 그대로.
// UI-기록할곳되돌리기: 조직·프로젝트에 업데이트를 추가하면 다음 입력은 바구니(미분류)로 돌아가고, 방금 쓴 곳은 "최근" 맨 앞에 남는다.
// 추가 없이 닫거나 다른 화면에 다녀와도 바구니. 추가가 실패하면 고른 곳 유지. 할 일 [프로젝트 ▾]도 추가 뒤 "프로젝트 없음"으로.
// 이름은 모두 가짜(합성) 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const NAMES=['전국철도노동조합','서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합','서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부','메트로9호선노동조합','서울교통공사9호선지부','김포도시철도지부','용인경전철지부'];
const quick=page=>page.locator('#homeView [data-home-quick]');
const dialog=page=>page.getByRole('dialog');
const PROJECTS=[{id:'p',name:'테스트 프로젝트',owner_id:'home-test',status:'active',metadata:{project_system:'v2'}},{id:'child',name:'자식 프로젝트',parent_id:'p',owner_id:'home-test',status:'active'}];
const synthetic=n=>Array.from({length:n},(_,i)=>({id:'x'+i,name:'합성 과제 '+i,parent_id:i%3?'x'+(i-i%3):null,owner_id:'home-test',status:'active',metadata:{project_system:'v2'}}));
async function setup(page,{width,height=800,projects=12,orgs=NAMES}={}){
 await page.setViewportSize({width,height});await openHome(page);
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:orgs.map((name,i)=>({id:'o'+i,name,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:orgs.map((_,i)=>({organization_id:'o'+i}))}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[5,1,0].map(i=>({organization_id:'o'+i,occurred_at:'2026-10-06'}))}));
 await page.route(SB+'/rest/v1/app_spaces?**',r=>r.fulfill({json:[...PROJECTS,...synthetic(projects)]}));
 await page.reload();
 const q=quick(page);await q.locator('[data-quick-mode="update"]').click();await q.locator('[data-quick-input]').fill('합성 기록');
 return q;
}
const box=el=>el.boundingBox();

test('PC 1280×800: 넓은 창 — 제목 옆 검색칸, 최근 한 줄, 왼쪽 담당조직 / 오른쪽 프로젝트, 창 안 스크롤 없음',async({page})=>{
 const q=await setup(page,{width:1280,height:800});
 await q.locator('[data-quick-org]').click();const sheet=dialog(page);await expect(sheet).toBeVisible();
 await expect(sheet).toHaveClass(/home-choice-anchored/);await expect(sheet).toHaveClass(/home-choice-split/);
 const d=await box(sheet),t=await box(q.locator('[data-quick-org]'));
 // Still opened by the button (anchored-popup.js), inside the window, wider than the old 480px list.
 expect(d.y-(t.y+t.height)).toBeGreaterThanOrEqual(-1);expect(d.y-(t.y+t.height)).toBeLessThanOrEqual(12);
 expect(d.width).toBeGreaterThan(700);expect(d.x).toBeGreaterThanOrEqual(0);expect(d.x+d.width).toBeLessThanOrEqual(1280);expect(d.y+d.height).toBeLessThanOrEqual(800);
 // The search box is on the title line, right of the title, before ×.
 const title=await box(sheet.locator('h2')),search=sheet.getByRole('searchbox',{name:'조직·프로젝트 이름 검색'}),s=await box(search),close=await box(sheet.getByRole('button',{name:'선택판 닫기'}));
 expect(s.x).toBeGreaterThan(title.x+title.width);expect(s.x+s.width).toBeLessThanOrEqual(close.x);expect(Math.abs((s.y+s.height/2)-(title.y+title.height/2))).toBeLessThanOrEqual(4);
 // 최근 on top (full width), then the two columns side by side under it.
 const recent=await box(sheet.locator('[data-sheet-recent-block]')),orgs=await box(sheet.locator('[data-sheet-col="orgs"]')),projects=await box(sheet.locator('[data-sheet-col="projects"]'));
 expect(recent.y+recent.height).toBeLessThanOrEqual(orgs.y+1);expect(Math.abs(orgs.y-projects.y)).toBeLessThanOrEqual(1);expect(orgs.x+orgs.width).toBeLessThanOrEqual(projects.x);
 await expect(sheet.locator('[data-sheet-recent] [data-sheet-value]')).toHaveText(['서해선지부','서울교통공사노동조합','전국철도노동조합']);
 await expect(sheet.locator('[data-sheet-col="orgs"] .home-choice-label')).toHaveText('담당조직');await expect(sheet.locator('[data-sheet-col="projects"] .home-choice-label')).toHaveText('프로젝트');
 // Organizations keep the group lines with full names (A); projects keep one per line with a check box (B3).
 await expect(sheet.locator('[data-sheet-all] [data-sheet-group] .home-choice-group-name')).toHaveText(['철도','지하철','민자철도','민간도시철도']);
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]')).toHaveText(NAMES);
 await expect(sheet.locator('[data-sheet-projects] .home-choice-check').first()).toBeVisible();
 // Everything shows at once: no scroll in the sheet nor in either column.
 const scrolls=await sheet.evaluate(el=>[...el.querySelectorAll('[data-sheet-content],[data-sheet-part]')].map(x=>x.scrollHeight-x.clientHeight));
 for(const extra of scrolls)expect(extra).toBeLessThanOrEqual(1);
 for(const el of [sheet.locator('[data-sheet-all] [data-sheet-value]').last(),sheet.locator('[data-sheet-projects] [data-sheet-value]').last()]){const b=await box(el);expect(b.y+b.height).toBeLessThanOrEqual(d.y+d.height);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // Tab order follows what is seen: title-line search box, then ×.
 await search.focus();await page.keyboard.press('Tab');await expect(sheet.getByRole('button',{name:'선택판 닫기'})).toBeFocused();
 // A project row on the right picks it.
 await sheet.locator('[data-sheet-projects]').getByRole('button',{name:'자식 프로젝트',exact:true}).click();await expect(sheet).toBeHidden();
 await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 자식 프로젝트');
});

test('PC 검색칸 하나가 조직·프로젝트를 함께 거르고 최근 줄은 비켜 줌; 아주 많으면 각 열 안에서만 스크롤',async({page})=>{
 const q=await setup(page,{width:1280,height:800,projects:60});
 await q.locator('[data-quick-org]').click();const sheet=dialog(page);await expect(sheet).toHaveClass(/home-choice-split/);
 const search=sheet.getByRole('searchbox',{name:'조직·프로젝트 이름 검색'});
 // Many projects: the sheet stays inside the window and only the project column scrolls.
 const d=await box(sheet);expect(d.y+d.height).toBeLessThanOrEqual(800);
 const info=await sheet.evaluate(el=>{const extra=sel=>{const x=el.querySelector(sel);return x.scrollHeight-x.clientHeight;};return {content:extra('[data-sheet-content]'),orgs:extra('[data-sheet-all]'),projects:extra('[data-sheet-projects]'),overflow:getComputedStyle(el.querySelector('[data-sheet-projects]')).overflowY};});
 expect(info.content).toBeLessThanOrEqual(1);expect(info.orgs).toBeLessThanOrEqual(1);expect(info.projects).toBeGreaterThan(50);expect(info.overflow).toBe('auto');
 await search.fill('9호선');
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveText(['메트로9호선노동조합','서울교통공사9호선지부']);
 await expect(sheet.locator('[data-sheet-recent-block]')).toBeHidden();await expect(sheet.locator('[data-sheet-projects] [data-sheet-value]:visible')).toHaveCount(0);
 await search.fill('합성 과제 4');
 await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(0);
 await expect(sheet.locator('[data-sheet-projects] [data-sheet-value]:visible')).toHaveText(['합성 과제 4','합성 과제 40','합성 과제 41','합성 과제 42','합성 과제 43','합성 과제 44','합성 과제 45','합성 과제 46','합성 과제 47','합성 과제 48','합성 과제 49']);
 await search.fill('없는 이름');await expect(sheet.getByText('맞는 항목이 없어요.')).toBeVisible();
 await search.fill('');await expect(sheet.locator('[data-sheet-recent-block]')).toBeVisible();await expect(sheet.locator('[data-sheet-all] [data-sheet-value]:visible')).toHaveCount(13);
 // ↓ from the box goes to the first choice shown.
 await search.fill('공항');await search.press('ArrowDown');await expect(sheet.locator('[data-sheet-all]').getByRole('button',{name:'공항철도지부',exact:true})).toBeFocused();
});

for(const [width,height] of [[390,844],[900,800]])test(`폭 ${width}: 위아래 순서 그대로(최근 → 담당조직 → 프로젝트), 넓은 배치 없음`,async({page})=>{
 const q=await setup(page,{width,height,projects:2});
 await q.locator('[data-quick-org]').click();const sheet=dialog(page);await expect(sheet).toBeVisible();
 await expect(sheet).not.toHaveClass(/home-choice-split/);
 if(width<761){await expect(sheet).not.toHaveClass(/home-choice-anchored/);await expect(sheet.getByRole('searchbox')).toBeHidden();}
 else{await expect(sheet).toHaveClass(/home-choice-anchored/);expect((await box(sheet)).width).toBeLessThanOrEqual(480);
  // The search box stays above the list (not on the title line).
  const s=await box(sheet.getByRole('searchbox')),title=await box(sheet.locator('h2'));expect(s.y).toBeGreaterThan(title.y+title.height-1);}
 const recent=await box(sheet.locator('[data-sheet-recent] [data-sheet-value]').first()),org=await box(sheet.locator('[data-sheet-all] [data-sheet-value]').first());
 await sheet.locator('[data-sheet-projects] [data-sheet-value]').first().scrollIntoViewIfNeeded();
 const project=await box(sheet.locator('[data-sheet-projects] [data-sheet-value]').first()),org2=await box(sheet.locator('[data-sheet-all] [data-sheet-value]').last());
 expect(recent.y).toBeLessThan(org.y);expect(org2.y).toBeLessThan(project.y);
 expect(await sheet.locator('[data-sheet-content] .home-choice-label').allTextContents()).toEqual(['최근','담당조직','프로젝트']);
});

test('창이 열린 채 폭을 바꾸면 넓은 배치와 위아래 배치가 그 자리에서 바뀜(검색칸도 제자리로)',async({page})=>{
 const q=await setup(page,{width:1280,height:800,projects:2});
 await q.locator('[data-quick-org]').click();const sheet=dialog(page);await expect(sheet).toHaveClass(/home-choice-split/);
 await page.setViewportSize({width:900,height:800});await expect(sheet).not.toHaveClass(/home-choice-split/);
 expect(await sheet.getByRole('searchbox').evaluate(el=>!!el.closest('[data-sheet-search-box]'))).toBe(true);
 await page.setViewportSize({width:1280,height:800});await expect(sheet).toHaveClass(/home-choice-split/);
 expect(await sheet.getByRole('searchbox').evaluate(el=>!!el.closest('header'))).toBe(true);
});

for(const width of [390,1280])test(`조직에 추가하면 다음 입력은 바구니로, 방금 쓴 곳은 최근 맨 앞 ${width}`,async({page})=>{
 const q=await setup(page,{width,height:width<761?844:800,projects:2});const orgBodies=[],projectBodies=[],notes=[];
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{orgBodies.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await page.route(SB+'/rest/v1/app_project_progress_updates',r=>{projectBodies.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await page.route(SB+'/rest/v1/app_notes**',r=>{if(r.request().method()!=='POST')return r.fallback();const body=r.request().postDataJSON();notes.push(body);return r.fulfill({json:[{id:'n'+notes.length,kind:'basket',occurred_at:'2026-10-06T01:00:00Z',...body}]});});
 await q.locator('[data-quick-org]').click();await dialog(page).locator('[data-sheet-all]').getByRole('button',{name:'공항철도지부',exact:true}).click();
 await expect(q.locator('[data-quick-input]')).toHaveAttribute('placeholder','공항철도지부 기록을 입력하세요');
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(orgBodies).toEqual([{organization_id:'o8',raw_text:'합성 기록',created_by:'home-test'}]);
 // Back to the basket at once.
 await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-input]')).toHaveAttribute('placeholder','업데이트 입력(바구니에 저장)');
 await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택');
 // The place just used is first on the 최근 line (after [바구니(미분류)]), not chosen.
 await q.locator('[data-quick-org]').click();const sheet=dialog(page);
 await expect(sheet.locator('[data-sheet-basket] [aria-pressed="true"]')).toHaveText('바구니(미분류)');
 await expect(sheet.locator('[data-sheet-recent] [data-sheet-value]')).toHaveText(['공항철도지부','서해선지부','서울교통공사노동조합']);
 await sheet.locator('[data-sheet-recent]').getByRole('button',{name:'공항철도지부',exact:true}).click();
 await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 공항철도지부');
 // A project used once also shows on the 최근 line and can be picked from there.
 await q.locator('[data-quick-org]').click();await sheet.locator('[data-sheet-projects]').getByRole('button',{name:'자식 프로젝트',exact:true}).click();
 await q.locator('[data-quick-input]').fill('합성 진행');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(projectBodies).toHaveLength(1);expect(projectBodies[0]).toMatchObject({project_id:'child',summary:'합성 진행'});
 await expect(q).toHaveAttribute('data-mode','basket');
 await q.locator('[data-quick-org]').click();await expect(sheet.locator('[data-sheet-recent] [data-sheet-value]').first()).toHaveText('자식 프로젝트');
 await expect(sheet.locator('[data-sheet-recent] [aria-pressed="true"]')).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
 // The next add with nothing chosen goes to the basket.
 await q.locator('[data-quick-input]').fill('바구니 기록');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(notes).toHaveLength(1);expect(notes[0]).toMatchObject({raw_text:'바구니 기록'});expect(orgBodies).toHaveLength(1);expect(projectBodies).toHaveLength(1);
});

test('추가가 실패하면 고른 곳과 글을 그대로 두어 다시 누르면 같은 곳에 저장',async({page})=>{
 const q=await setup(page,{width:1280,height:800,projects:2});let fail=true;const bodies=[];
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({status:fail?500:200,json:fail?{message:'합성 오류'}:[]});});
 await q.locator('[data-quick-org]').click();await dialog(page).locator('[data-sheet-all]').getByRole('button',{name:'서해선지부',exact:true}).click();
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText('합성 오류');
 await expect(q.locator('[data-quick-input]')).toHaveValue('합성 기록');await expect(q).toHaveAttribute('data-mode','update');
 await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 서해선지부');
 fail=false;await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(bodies.map(b=>b.organization_id)).toEqual(['o5','o5']);await expect(q).toHaveAttribute('data-mode','basket');
});

test('추가 없이 다른 화면에 다녀오거나 큰 창을 저장 없이 닫으면 다음 입력은 바구니',async({page})=>{
 const q=await setup(page,{width:1280,height:800,projects:2});
 await q.locator('[data-quick-org]').click();await dialog(page).locator('[data-sheet-all]').getByRole('button',{name:'서해선지부',exact:true}).click();
 await expect(q).toHaveAttribute('data-mode','update');
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('#basketView')).toBeVisible();
 await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();
 await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택');
 // The text typed before leaving stays; only the place goes back.
 await expect(q.locator('[data-quick-input]')).toHaveValue('합성 기록');
 // Big window: a place chosen inside it and closed without saving is not kept.
 await q.locator('[data-quick-org]').click();await dialog(page).locator('[data-sheet-all]').getByRole('button',{name:'공항철도지부',exact:true}).click();
 await q.locator('[data-quick-big]').click();const e=page.locator('#mdEditor');await expect(e).toBeVisible();
 await expect(e.locator('[data-md-kind="update"]')).toHaveText('공항철도지부');
 await e.locator('[data-close="mdEditor"]').click();await expect(e).toHaveCount(0);
 await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-input]')).toHaveValue('합성 기록');
});

test('할 일 [프로젝트 ▾]도 추가 뒤 "프로젝트 없음"으로 돌아감, 실패하면 유지',async({page})=>{
 await page.setViewportSize({width:1280,height:800});await openHome(page);const q=quick(page);
 let fail=false;const bodies=[];
 await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{const body=r.request().postDataJSON();bodies.push(body);return fail?r.fulfill({status:400,json:{error:'합성 거절'}}):r.fulfill({json:createdTaskReply(body)});});
 await q.locator('[data-quick-mode="task"]').click();await q.locator('[data-quick-input]').fill('합성 할 일');
 const pick=async()=>{await q.locator('[data-quick-project]').click();await dialog(page).getByRole('button',{name:'자식 프로젝트',exact:true}).click();await expect(q.locator('[data-quick-project]')).toHaveText('자식 프로젝트 ▾');};
 await pick();await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(bodies[0].links).toEqual([{project_id:'child'}]);await expect(q.locator('[data-quick-project]')).toHaveText('프로젝트 ▾');
 // The next task has no project unless one is picked again.
 await q.locator('[data-quick-input]').fill('합성 둘째');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(bodies[1].links).toEqual([]);
 // A failed add keeps the project (and the text) for another try.
 fail=true;await q.locator('[data-quick-input]').fill('합성 셋째');await pick();
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText('합성 거절');
 await expect(q.locator('[data-quick-project]')).toHaveText('자식 프로젝트 ▾');await expect(q.locator('[data-quick-input]')).toHaveValue('합성 셋째');
 expect(bodies[2].links).toEqual([{project_id:'child'}]);
});
