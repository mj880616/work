import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// BUG-내보내기탭이동: on a phone the shared bottom choice sheet (choice-sheet.js) rises from just above the bottom tabs, not
// over them. Before, its lowest row ([HWP 파일로 받기]) lay on the tabs, so a press there followed by one more press at the
// same spot (the sheet already closed) went to the tab under the finger — 담당조직 for a right thumb.
// Presses here are real touch sequences (touchstart → touchend → the click the browser makes) through CDP.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true,isMobile:true});

async function fixture(page){
 await page.setViewportSize({width:390,height:844});
 const writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{if(r.request().method()!=='GET')writes.push(r.request().method());return r.fulfill({json:[]});});
 return {writes,errors};
}
async function openWriter(page,text){
 await page.locator('#mobileMenuTab').tap();await page.locator('#mobileMenu [data-menu-write]').tap();
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
 const area=editor.locator('.md-editor-text');await area.fill(text);await area.evaluate(el=>el.blur());
 return {editor,area};
}
const settle=sheet=>sheet.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
async function openExport(page,editor){
 await editor.getByRole('button',{name:'내보내기',exact:true}).tap();
 const sheet=page.locator('#mdExportSheet');await expect(sheet).toHaveAttribute('open','');await settle(sheet);return sheet;
}
async function touch(page,x,y){
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await cdp.detach();
}
const current=page=>page.evaluate(()=>window.KPTURouter.current);
async function expectAboveTabs(page,sheet){
 const box=await sheet.boundingBox(),bar=await page.locator('.mobile-tabs').boundingBox();
 await expect(page.locator('.mobile-tabs')).toBeVisible();
 expect(Math.round(box.y+box.height)).toBe(Math.round(bar.y));
 for(const row of await sheet.locator('[data-sheet-value]').all()){const r=await row.boundingBox();expect(r.y+r.height).toBeLessThanOrEqual(bar.y);}
}

const EXPORTS=[['텔레그램용 복사','텔레그램용 글을 복사했어요. 텔레그램에 붙여 넣으세요.'],['한글용 복사','한글용 복사는 준비 중이에요.'],['HWP 파일로 받기','HWP 파일로 받기는 준비 중이에요.']];
for(const [item,status] of EXPORTS)test(`내보내기 [${item}]: 탭 이동 없이 동작하고 쓰기 창이 남음, 같은 자리를 또 눌러도 탭으로 가지 않음 390`,async({page})=>{
 const f=await fixture(page);
 await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.__copied=text;};});
 const {editor,area}=await openWriter(page,'# 쓰던 글');
 const sheet=await openExport(page,editor);
 await expectAboveTabs(page,sheet);
 // The lowest point of the row, where the right thumb lands (the tab under it was 담당조직).
 const row=await sheet.getByRole('button',{name:item,exact:true}).boundingBox(),x=row.x+row.width*0.75,y=row.y+row.height-4;
 await touch(page,x,y);
 await expect(sheet).not.toHaveAttribute('open','');
 await expect(editor.locator('.md-editor-status')).toHaveText(status);
 if(item==='텔레그램용 복사')expect(await page.evaluate(()=>window.__copied)).toBe('쓰던 글');
 // A second press at the same spot lands in the write window, not on a tab.
 await touch(page,x,y);
 await expect(page.locator('#mdLeaveSheet[open]')).toHaveCount(0);
 await expect(editor).toBeVisible();await expect(area).toHaveValue('# 쓰던 글');
 expect(await current(page)).toBe('home');
 await expect(page.locator('.mobile-tabs [data-view="team"]')).not.toHaveAttribute('aria-current','page');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('내보내기 시트 바깥(어두운 곳)을 누르면 시트만 닫히고 쓰기 창·화면은 그대로 390',async({page})=>{
 const f=await fixture(page);
 const {editor,area}=await openWriter(page,'바깥 누르기');
 const sheet=await openExport(page,editor);
 const box=await sheet.boundingBox();
 await touch(page,200,box.y-40);
 await expect(sheet).not.toHaveAttribute('open','');
 await expect(editor).toBeVisible();await expect(area).toHaveValue('바깥 누르기');await expect(editor.locator('.md-editor-status')).toHaveText('');
 expect(await current(page)).toBe('home');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('시트가 닫힌 뒤 아래 탭을 직접 누르면 기존대로 "저장 안 하고 닫을까요?" → 이동 (#658) 390',async({page})=>{
 const f=await fixture(page);
 const {editor}=await openWriter(page,'아직 저장 안 한 글');
 const sheet=await openExport(page,editor);
 await touch(page,(await sheet.getByRole('button',{name:'한글용 복사',exact:true}).boundingBox()).x+40,(await sheet.getByRole('button',{name:'한글용 복사',exact:true}).boundingBox()).y+20);
 await expect(sheet).not.toHaveAttribute('open','');
 const team=await page.locator('.mobile-tabs [data-view="team"]').boundingBox();
 await touch(page,team.x+team.width/2,team.y+team.height/2);
 const leave=page.locator('#mdLeaveSheet');await expect(leave).toHaveAttribute('open','');await settle(leave);
 // The question sheet sits above the tabs too.
 await expectAboveTabs(page,leave);
 expect(await current(page)).toBe('home');
 const go=await leave.getByRole('button',{name:'저장 안 하고 이동',exact:true}).boundingBox();
 await touch(page,go.x+go.width/2,go.y+go.height/2);
 await expect(page.locator('#mdEditor')).toHaveCount(0);
 await expect.poll(()=>current(page)).toBe('team');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('다른 고르기 시트(홈 [업데이트 ▾] 조직)도 아래 탭 위에서 열리고, 고른 뒤 같은 자리 누름이 탭으로 가지 않음 390',async({page})=>{
 const f=await fixture(page);
 const names=['전국철도노동조합','서울교통공사노동조합','부산지하철노동조합'];
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:names.map((name,i)=>({id:String(i),name,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:names.map((_,i)=>({organization_id:String(i)}))}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[]}));
 await page.reload();
 const quick=page.locator('#homeView [data-home-quick]');
 await quick.locator('[data-quick-mode="update"]').tap();await quick.locator('[data-quick-org]').tap();
 const sheet=page.getByRole('dialog');await expect(sheet).toBeVisible();await settle(sheet);
 await expectAboveTabs(page,sheet);
 const last=await sheet.getByRole('button',{name:names.at(-1),exact:true}).last().boundingBox(),x=last.x+last.width/2,y=last.y+last.height-2;
 await touch(page,x,y);
 await expect(sheet).toBeHidden();
 await expect(quick.locator('[data-quick-org]')).toHaveAccessibleName(`조직 선택: ${names.at(-1)}`);
 await touch(page,x,y);
 expect(await current(page)).toBe('home');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('PC 폭에서는 고르기 시트 위치가 그대로(화면 맨 아래) 1280',async({page})=>{
 await page.setViewportSize({width:1280,height:860});
 await openHome(page);
 await page.locator('#appView>.app-nav [data-menu-write]').click();
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
 await editor.getByRole('button',{name:'내보내기',exact:true}).click();
 const sheet=page.locator('#mdExportSheet');await expect(sheet).toHaveAttribute('open','');await settle(sheet);
 const box=await sheet.boundingBox();expect(Math.round(box.y+box.height)).toBe(860);
});
