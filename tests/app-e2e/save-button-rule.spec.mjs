import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {typeInto} from './helpers/note-editor.mjs';
// UI-저장자리(2026-10-27 명진 요청): 저장 버튼은 창(칸)의 오른쪽 아래, 순서는 [취소] 왼쪽 [저장] 맨 오른쪽.
// 긴 글 쓰기 칸(여기서는 일기 쓰기)은 아래 버튼 줄이 화면 아래에 붙어 있고(스크롤해도), 폰에서 자판이 올라오면 숨었다가 내리면 다시 보인다.
// 팝업(일정 등록)도 [저장]이 창 오른쪽 아래. 예전의 떠 있는 [저장](#floatSave)은 이 아래 줄이 대신해 없다.
// 시계는 2026-10-06 KST(openHome).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const long=Array.from({length:40},(_,i)=>`${i+1}번째 줄 오늘 있었던 일을 길게 적어 봅니다`).join('\n');
async function fixture(page,{width,height}){
 const writes=[],errors=[],rows=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await page.setViewportSize({width,height});
 await openHome(page);
 const at='2026-10-05T01:00:00Z';
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),method=req.method();
  if(method==='GET'){if(new URL(req.url()).searchParams.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows});}
  if(method==='POST'){
   const body=req.postDataJSON();writes.push({method,body});
   const row={id:'d-new',title:null,journal_day:null,occurred_at:at,created_at:at,updated_at:'2026-10-06T01:00:01Z',archived_at:null,ai_export_allowed:false,attachments:[],metadata:{},kind:'diary',workspace_id:'w',...body};
   rows.push(row);return r.fulfill({status:201,json:[row]});
  }
  return r.fulfill({json:[]});
 });
 return {writes,errors};
}
async function openWriter(page,width){
 if(width<=760){
  await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('#calendarView .schedule-switch [data-view="diary"]').click();
 }else await page.locator('.app-nav [data-view="diary"]').click();
 await expect(page.locator('#diaryView')).toBeVisible();
 await page.locator('#diaryRoot [data-diary-new]').click();
 await expect(page.locator('#diaryRoot [data-diary-editor] .ProseMirror')).toBeVisible();
}
const box=async(page,selector)=>page.locator(selector).first().boundingBox();
const ACTIONS='#diaryRoot [data-diary-editor] .diary-actions';

test('390 폰: 일기 쓰기 아래 줄은 글이 길어도 화면 아래 오른쪽에 붙어 있고, [취소]가 [저장] 왼쪽',async({page})=>{
 const f=await fixture(page,{width:390,height:700});await openWriter(page,390);
 await expect(page.locator('#floatSave')).toHaveCount(0);
 await typeInto(page,page.locator('#diaryRoot [data-diary-editor] .ProseMirror'),long);
 for(const top of [true,false]){
  await page.evaluate(t=>window.scrollTo(0,t?0:document.documentElement.scrollHeight),top);
  await expect(page.locator(ACTIONS)).toBeInViewport({ratio:1});
  const row=await box(page,ACTIONS),save=await box(page,'[data-diary-editor] [data-diary-save]'),cancel=await box(page,ACTIONS+' [data-diary-editor-close]');
  const sw=await box(page,'#diaryView .schedule-switch'),tabs=await box(page,'.mobile-tabs');
  // [저장]은 줄 맨 오른쪽, [취소]는 그 왼쪽(같은 높이). 줄은 전환 줄·아래 탭 위.
  expect(row.x+row.width-(save.x+save.width)).toBeLessThanOrEqual(2);
  expect(cancel.x+cancel.width).toBeLessThanOrEqual(save.x);expect(Math.abs(cancel.y+cancel.height/2-(save.y+save.height/2))).toBeLessThanOrEqual(1);
  expect(row.y+row.height).toBeLessThanOrEqual(sw.y+1);expect(sw.y+sw.height).toBeLessThanOrEqual(tabs.y+1);
 }
 // 맨 아래까지 내리면 본문은 버튼 줄 위에서 끝난다(버튼이 글을 가리지 않음).
 const text=await box(page,'#diaryRoot [data-diary-editor] .ProseMirror'),row=await box(page,ACTIONS);
 expect(text.y+text.height).toBeLessThanOrEqual(row.y+1);
 expect(f.errors).toEqual([]);
});

test('390 폰: 자판이 올라오면 아래 버튼 줄이 숨고, 내리면 다시 보인다',async({page})=>{
 const f=await fixture(page,{width:390,height:700});await openWriter(page,390);
 await typeInto(page,page.locator('#diaryRoot [data-diary-editor] .ProseMirror'),long);
 await expect(page.locator(ACTIONS)).toBeVisible();
 await page.setViewportSize({width:390,height:420});
 await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);
 await expect(page.locator(ACTIONS)).toBeHidden();
 await page.setViewportSize({width:390,height:700});
 await expect(page.locator('body')).not.toHaveClass(/kptu-mobile-keyboard/);
 await expect(page.locator(ACTIONS)).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('390 폰: 아래 [저장]을 누르면 저장 요청이 한 번 가고 창이 닫힌다(엔터 저장과 같은 경로)',async({page})=>{
 const f=await fixture(page,{width:390,height:700});await openWriter(page,390);
 await typeInto(page,page.locator('#diaryRoot [data-diary-editor] .ProseMirror'),long);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.locator('[data-diary-editor] [data-diary-save]').click();
 await expect.poll(()=>f.writes.length).toBe(1);
 expect(f.writes[0].body.kind).toBe('diary');expect(f.writes[0].body.raw_text).toContain('40번째 줄');
 await expect(page.locator('#diaryRoot [data-diary-editor]')).toBeHidden();
 expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('1280 PC: 일기 쓰기 아래 줄이 화면 아래에 붙고 [저장]이 오른쪽 끝, 가로 넘침 없음',async({page})=>{
 const f=await fixture(page,{width:1280,height:720});await openWriter(page,1280);
 await typeInto(page,page.locator('#diaryRoot [data-diary-editor] .ProseMirror'),long);
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect(page.locator(ACTIONS)).toBeInViewport({ratio:1});
 const row=await box(page,ACTIONS),save=await box(page,'[data-diary-editor] [data-diary-save]'),cancel=await box(page,ACTIONS+' [data-diary-editor-close]');
 expect(row.x+row.width-(save.x+save.width)).toBeLessThanOrEqual(2);expect(cancel.x+cancel.width).toBeLessThanOrEqual(save.x);
 expect(row.y+row.height).toBeGreaterThan(720-80);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`${width}: 일정 등록 팝업의 [저장]은 창 오른쪽 아래(글자 폭), 안내 글은 그 위`,async({page})=>{
 await page.setViewportSize({width,height:760});
 await openHome(page,{query:'?view=calendar'});
 await page.locator('#newEventBtn').click();
 const modal=page.locator('#eventModal');await expect(modal).toBeVisible();
 const card=await modal.locator('.modal-card').boundingBox(),save=await box(page,'#saveEventBtn');
 expect(card.x+card.width-(save.x+save.width)).toBeLessThanOrEqual(40);
 expect(card.y+card.height-(save.y+save.height)).toBeLessThanOrEqual(40);
 expect(save.width).toBeLessThan(card.width/2);
});
