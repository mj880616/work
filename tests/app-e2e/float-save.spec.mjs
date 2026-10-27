import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {typeInto} from './helpers/note-editor.mjs';
// UI-떠있는저장: a long write panel gets one small floating [저장] (float-save.js) at the lower right, just above the
// [달력 | 할 일 | 업무일지 | 일기] line and the bottom tabs. It shows only while the panel's own [저장] is not fully on screen and the
// phone keyboard is closed, it presses that same [저장] (one save request), and the blank under a short text is small.
// Checked on the [일기] write panel; the clock is 2026-10-06 KST (openHome).
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
 await expect(page.locator('#diaryRoot [data-diary-text] .ProseMirror')).toBeVisible();
}
const box=async(page,selector)=>page.locator(selector).first().boundingBox();

test('390 폰: 글이 길어 원래 [저장]이 안 보이면 떠 있는 [저장]이 오른쪽 아래 전환 줄 위에 뜨고, 원래 것이 보이면 사라진다',async({page})=>{
 const f=await fixture(page,{width:390,height:700});await openWriter(page,390);
 const float=page.locator('#floatSave'),original=page.locator('[data-diary-save]');
 await typeInto(page,page.locator('#diaryRoot [data-diary-text] .ProseMirror'),long);
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect(float).toBeVisible();await expect(float).toHaveText('저장');
 const fb=await float.boundingBox(),sw=await box(page,'#diaryView .schedule-switch'),tabs=await box(page,'.mobile-tabs');
 expect(fb.height).toBeLessThanOrEqual(34);expect(fb.width).toBeLessThan(90);
 expect(fb.x+fb.width).toBeGreaterThan(390-30);expect(fb.x+fb.width).toBeLessThanOrEqual(390);
 expect(fb.y+fb.height).toBeLessThanOrEqual(sw.y);expect(sw.y+sw.height).toBeLessThanOrEqual(tabs.y+1);
 // 맨 아래까지 내리면 원래 [저장]이 보이고 떠 있는 것은 사라진다(두 개가 동시에 안 보임).
 await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
 await expect(float).toBeHidden();await expect(original).toBeInViewport({ratio:1});
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect(float).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('390 폰: 자판이 올라오면 떠 있는 [저장]은 안 보이고, 내려가면 다시 보인다',async({page})=>{
 const f=await fixture(page,{width:390,height:700});await openWriter(page,390);
 const float=page.locator('#floatSave');
 await typeInto(page,page.locator('#diaryRoot [data-diary-text] .ProseMirror'),long);
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect(float).toBeVisible();
 // 자판이 레이아웃을 줄이는 폰(앱 공용 감지가 body 표시를 켠다).
 await page.setViewportSize({width:390,height:420});
 await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);
 await expect(float).toBeHidden();
 await page.setViewportSize({width:390,height:700});
 await expect(page.locator('body')).not.toHaveClass(/kptu-mobile-keyboard/);
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect(float).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('390 폰: 떠 있는 [저장]은 원래 [저장]과 같은 저장을 한 번만 부른다',async({page})=>{
 const f=await fixture(page,{width:390,height:700});await openWriter(page,390);
 const float=page.locator('#floatSave');
 await typeInto(page,page.locator('#diaryRoot [data-diary-text] .ProseMirror'),long);
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect(float).toBeVisible();
 await float.click();
 await expect.poll(()=>f.writes.length).toBe(1);
 expect(f.writes[0].body.kind).toBe('diary');expect(f.writes[0].body.raw_text).toContain('40번째 줄');
 await expect(page.locator('#diaryRoot [data-diary-editor]')).toBeHidden();
 await expect(float).toBeHidden();
 expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('390 폰: 글이 짧으면 본문 아래 큰 빈칸이 없다(본문 아래 56px)',async({page})=>{
 const f=await fixture(page,{width:390,height:844});await openWriter(page,390);
 await typeInto(page,page.locator('#diaryRoot [data-diary-text] .ProseMirror'),'짧은 글');
 const pad=await page.locator('#diaryRoot .ed-input').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom));
 expect(pad).toBeLessThanOrEqual(60);
 const text=await box(page,'#diaryRoot .ed-input'),save=await box(page,'[data-diary-save]');
 expect(save.y-(text.y+text.height)).toBeLessThan(100);
 expect(f.errors).toEqual([]);
});

test('1280 PC: 짧은 글은 [저장]이 보여 떠 있는 것이 없고, 긴 글에서는 오른쪽 아래에 작게 뜬다',async({page})=>{
 const f=await fixture(page,{width:1280,height:720});await openWriter(page,1280);
 const float=page.locator('#floatSave');
 await typeInto(page,page.locator('#diaryRoot [data-diary-text] .ProseMirror'),'짧은 글');
 await expect(page.locator('[data-diary-save]')).toBeInViewport({ratio:1});
 await expect(float).toBeHidden();
 await typeInto(page,page.locator('#diaryRoot [data-diary-text] .ProseMirror'),long);
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect(float).toBeVisible();
 const fb=await float.boundingBox();
 expect(fb.height).toBeLessThanOrEqual(34);expect(fb.x+fb.width).toBeGreaterThan(1280-30);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.errors).toEqual([]);
});
