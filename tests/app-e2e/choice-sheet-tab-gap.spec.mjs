import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import {openWriteFromEntry} from './helpers/write-opener.mjs';
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
// ED③ 순서 6: the new write window (ed-window.js); the text is typed into its editor (plain letters, so the exported text is the same).
async function openWriter(page,text){
 await openWriteFromEntry(page,390);
 const editor=page.locator('#edWindow');await expect(editor).toBeVisible();
 const area=editor.locator('.ed-input');await area.click();await page.keyboard.type(text);await area.evaluate(el=>el.blur());
 return {editor,area};
}
const settle=sheet=>sheet.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
async function openExport(page,editor){
 await editor.getByRole('button',{name:'내보내기',exact:true}).tap();
 const sheet=page.locator('#edwExportSheet');await expect(sheet).toHaveAttribute('open','');await settle(sheet);return sheet;
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

const EXPORTS=[['텔레그램용 복사','텔레그램용 글을 복사했어요. 텔레그램에 붙여 넣으세요.'],['한글용 복사','한글용 글을 복사했어요. 한글에 붙여 넣으세요.'],['HWP 파일로 받기','HWP 파일로 받기는 준비 중이에요.']];
for(const [item,status] of EXPORTS)test(`내보내기 [${item}]: 탭 이동 없이 동작하고 쓰기 창이 남음, 같은 자리를 또 눌러도 탭으로 가지 않음 390`,async({page})=>{
 const f=await fixture(page);
 await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.__copied=text;};navigator.clipboard.write=async items=>{window.__copied=await (await items[0].getType('text/plain')).text();};});
 const {editor,area}=await openWriter(page,'쓰던 글');
 const sheet=await openExport(page,editor);
 await expectAboveTabs(page,sheet);
 // The lowest point of the row, where the right thumb lands (the tab under it was 담당조직).
 const row=await sheet.getByRole('button',{name:item,exact:true}).boundingBox(),x=row.x+row.width*0.75,y=row.y+row.height-4;
 await touch(page,x,y);
 await expect(sheet).not.toHaveAttribute('open','');
 await expect(editor.locator('.ed-window-status')).toHaveText(status);
 if(item!=='HWP 파일로 받기')expect(await page.evaluate(()=>window.__copied)).toBe('쓰던 글');
 // A second press at the same spot lands in the write window, not on a tab.
 // UI-저장자리(2026-10-27): 쓰기 창 맨 아래 줄([취소][저장])이 탭 바로 위라 그 자리를 누르면 창의 버튼이 받는다(탭이 아님). 취소면 닫기 확인창이 뜰 수 있어 닫고 이어간다.
 expect(await page.evaluate(([px,py])=>!!document.elementFromPoint(px,py)?.closest('#edWindow'),[x,y])).toBe(true);
 await touch(page,x,y);
 if(await page.locator('#edwCloseSheet[open]').count())await page.keyboard.press('Escape');
 await expect(editor).toBeVisible();await expect(area).toHaveText('쓰던 글');
 expect(await current(page)).toBe('basket');
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
 await expect(editor).toBeVisible();await expect(area).toHaveText('바깥 누르기');await expect(editor.locator('.ed-window-status')).toHaveText('');
 expect(await current(page)).toBe('basket');
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
 const leave=page.locator('#edwCloseSheet');await expect(leave).toHaveAttribute('open','');await settle(leave);
 // The question sheet sits above the tabs too.
 await expectAboveTabs(page,leave);
 expect(await current(page)).toBe('basket');
 const go=await leave.getByRole('button',{name:'저장하지 않고 닫기',exact:true}).boundingBox();
 await touch(page,go.x+go.width/2,go.y+go.height/2);
 await expect(page.locator('#edWindow')).toHaveCount(0);
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
 // UPD-여러곳고르기: a press on a row marks it and keeps the sheet open; [저장] (at the very bottom, just above the tabs) closes it.
 // The same spot pressed again after the sheet closed must not reach the tab under it.
 const last=await sheet.getByRole('button',{name:names.at(-1),exact:true}).last().boundingBox();
 await touch(page,last.x+last.width/2,last.y+last.height/2);
 await expect(sheet).toBeVisible();await expect(sheet.getByRole('button',{name:names.at(-1),exact:true}).last()).toHaveAttribute('aria-pressed','true');
 const save=await sheet.getByRole('button',{name:'저장',exact:true}).boundingBox(),x=save.x+save.width/2,y=save.y+save.height-2;
 await touch(page,x,y);
 await expect(sheet).toBeHidden();
 await expect(quick.locator('[data-quick-org]')).toHaveAccessibleName(`기록할 곳 선택: ${names.at(-1)}`);
 await touch(page,x,y);
 expect(await current(page)).toBe('home');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

// UI-PC팝업위치: on a PC the same sheet opens as a small list right by [내보내기] (the bottom sheet stays phone only).
test('PC 폭에서는 고르기 시트가 누른 버튼 바로 옆에 작은 목록으로 열림 1280',async({page})=>{
 await page.setViewportSize({width:1280,height:860});
 await openHome(page);
 await openWriteFromEntry(page,1280);
 const editor=page.locator('#edWindow');await expect(editor).toBeVisible();
 const trigger=editor.getByRole('button',{name:'내보내기',exact:true});await trigger.click();
 const sheet=page.locator('#edwExportSheet');await expect(sheet).toHaveAttribute('open','');await settle(sheet);
 await expect(sheet).toHaveClass(/home-choice-anchored/);
 const t=await trigger.boundingBox(),box=await sheet.boundingBox();
 expect(box.y).toBeGreaterThanOrEqual(t.y+t.height);expect(box.y-(t.y+t.height)).toBeLessThanOrEqual(12);
 expect(box.width).toBeLessThanOrEqual(360);expect(box.x+box.width).toBeLessThanOrEqual(1280);expect(box.x).toBeGreaterThanOrEqual(0);
 expect(Math.round(box.y+box.height)).toBeLessThan(860);
});
