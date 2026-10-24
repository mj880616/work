import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noteAction } from './helpers/basket-more.mjs';
import {openOldWriteWindow,openOldBigEditorOnBasketField} from './helpers/write-opener.mjs';
// UI-쓰기창PC탭유지: 넓은 화면(761px~)에서 쓰기 창(메뉴 [쓰기])과 고치기 창("큰 창에서 수정")은 앱 탭을 덮지 않는다.
// 1024px~는 왼쪽 세로 메뉴 옆, 761~1023px는 위쪽 한 줄 메뉴 아래에서만 열린다. 폰(760px 이하)은 하단 탭 위에서 끝나는 기존 동작 그대로.
// 탭을 누르면 폰 하단 탭과 같은 규칙(글 있으면 "저장 안 하고 닫을까요?", 빈 글은 바로 이동, 고치기는 글을 수정 칸에 돌려줌)이 적용된다.
// 캡처: UI_REVIEW_DIR가 있으면 그 폴더에 PC·폰 화면을 남긴다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const REVIEW=process.env.UI_REVIEW_DIR||'';

async function fixture(page,{width=1280,height=800}={}){
 await page.setViewportSize({width,height});
 const writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const rows=[{id:'m1',workspace_id:'w',kind:'basket',title:null,raw_text:'회의 준비 메모',occurred_at:'2026-10-05T01:00:00Z',created_at:'2026-10-05T01:00:00Z',updated_at:'2026-10-05T01:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}}];
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(row=>!q.get('kind')||'eq.'+row.kind===q.get('kind'))});}
  const body=req.postDataJSON();writes.push({method:req.method(),body});
  const at='2026-10-06T02:00:00Z',row={id:'m-new',kind:'basket',title:null,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...body};
  rows.push(row);return r.fulfill({status:201,json:[row]});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 return {writes,errors};
}
const nav=page=>page.locator('#appView>.app-nav');
// UI-PC사이드바: on the PC sidebar the home menu is the top line (icon + 홈).
const navTab=(page,view)=>view==='home'?nav(page).locator('.sidebar-brand:visible,[data-view="home"]:visible').first():nav(page).locator(`[data-view="${view}"]`);
const current=page=>page.evaluate(()=>window.KPTURouter.current);
const goView=async(page,view)=>{await page.evaluate(view=>window.KPTURouter.go(view),view);await expect.poll(()=>current(page)).toBe(view);};
async function openWriter(page){
 await openOldWriteWindow(page,1280);
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();return editor;
}
const rect=l=>l.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,r:r.right,b:r.bottom,w:r.width,h:r.height};});
const overlaps=(a,b)=>a.x<b.r-0.5&&b.x<a.r-0.5&&a.y<b.b-0.5&&b.y<a.b-0.5;

test('1280: [쓰기]를 열어도 왼쪽 세로 메뉴가 보이고 누를 수 있다. 편집기는 메뉴 오른쪽에서만 연다',async({page})=>{
 const f=await fixture(page);
 const editor=await openWriter(page);
 const box=await rect(editor),side=await rect(nav(page));
 expect(overlaps(box,side)).toBe(false);
 expect(box.x).toBeGreaterThanOrEqual(side.r);expect(box.y).toBe(0);expect(Math.round(box.r)).toBe(1280);expect(Math.round(box.b)).toBe(800);
 await expect(editor).toHaveAttribute('data-md-nav','side');
 // 메뉴의 모든 탭이 보이고 가운데 점이 편집기 밖(실제로 눌림)에 있다.
 // UI-PC일정묶음: the sub rows (바구니·일정 아래) count as tabs too.
 // 창이 짧으면 사이드바가 스크롤된다(UI-사이드바링크아래). 맨 아래 묶음은 사이드바 안에서 굴려 본 뒤 잰다.
 for(const tab of await nav(page).locator(':is(.nav-btn,.nav-sub-btn):visible').all()){
  await tab.evaluate(el=>el.scrollIntoView({block:'nearest'}));const r=await rect(tab);
  expect(await tab.evaluate((el,[x,y])=>document.elementFromPoint(x,y)?.closest('.nav-btn,.nav-sub-btn')===el,[r.x+r.w/2,r.y+r.h/2]),await tab.textContent()).toBe(true);
 }
 // 대화상자 이름·역할은 그대로, 메뉴를 쓰는 동안은 모달이 아니다.
 await expect(editor).toHaveAttribute('role','dialog');await expect(editor).toHaveAttribute('aria-modal','false');
 await expect(page.getByRole('dialog',{name:'쓰기'})).toBeVisible();
 // 넓은 화면: 글·미리보기 나란히, 머리줄·서식줄·내보내기 그대로.
 const [t,p]=await Promise.all([rect(editor.locator('.md-editor-text')),rect(editor.locator('.md-editor-preview'))]);
 expect(Math.abs(t.y-p.y)).toBeLessThan(2);expect(p.x).toBeGreaterThanOrEqual(t.r-1);expect(t.w).toBeGreaterThan(300);
 await expect(editor.locator('.md-editor-modes')).toBeHidden();
 await expect(editor.locator('.md-editor-tools button').first()).toBeVisible();
 await editor.locator('.md-editor-text').fill('내보내기 확인');
 await editor.getByRole('button',{name:'내보내기',exact:true}).click();
 const sheet=page.locator('#mdExportSheet');await expect(sheet).toHaveAttribute('open','');
 await expect(sheet.locator('[data-sheet-value]')).toHaveText(['텔레그램용 복사','한글용 복사','HWP 파일로 받기']);
 await page.keyboard.press('Escape');await expect(sheet).not.toHaveAttribute('open','');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('1280: 글이 있을 때 탭을 누르면 묻는다 — [계속 쓰기]는 글 유지, [저장 안 하고 이동]은 이동하고 글은 탭 메모리에 남는다',async({page})=>{
 const f=await fixture(page);
 await goView(page,'basket');
 const editor=await openWriter(page),area=editor.locator('.md-editor-text');
 await area.fill('아직 저장 안 한 글');await area.evaluate(el=>el.blur());
 const sheet=page.locator('#mdLeaveSheet');
 await navTab(page,'calendar').click();
 await expect(sheet).toHaveAttribute('open','');await expect(sheet.locator('h2')).toHaveText('저장 안 하고 닫을까요?');
 await expect(sheet.locator('[data-sheet-value]')).toHaveText(['계속 쓰기','저장 안 하고 이동']);
 expect(await current(page)).toBe('basket');
 await sheet.getByRole('button',{name:'계속 쓰기',exact:true}).click();
 await expect(sheet).not.toHaveAttribute('open','');await expect(editor).toBeVisible();await expect(area).toHaveValue('아직 저장 안 한 글');await expect(area).toBeFocused();
 expect(await current(page)).toBe('basket');
 // [저장 안 하고 이동]
 await navTab(page,'calendar').click();
 await sheet.getByRole('button',{name:'저장 안 하고 이동',exact:true}).click();
 await expect(page.locator('#mdEditor')).toHaveCount(0);
 await expect.poll(()=>current(page)).toBe('calendar');
 await expect(navTab(page,'calendar')).toHaveAttribute('aria-current','page');
 // 글은 이 탭 메모리에 남아 다시 [쓰기]를 열면 이어진다.
 const again=await openWriter(page);await expect(again.locator('.md-editor-text')).toHaveValue('아직 저장 안 한 글');
 // 뒤로 가기는 편집기만 닫는다.
 await page.goBack();await expect(page.locator('#mdEditor')).toHaveCount(0);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('1280: 빈 글이면 묻지 않고 바로 이동, [쓰기] 탭은 이어서 쓰기',async({page})=>{
 const f=await fixture(page);
 await openWriter(page);
 await navTab(page,'projects').click();
 await expect(page.locator('#mdLeaveSheet[open]')).toHaveCount(0);await expect(page.locator('#mdEditor')).toHaveCount(0);
 await expect.poll(()=>current(page)).toBe('projects');
 const editor=await openWriter(page),area=editor.locator('.md-editor-text');
 await area.fill('  \n ');
 await navTab(page,'home').click();
 await expect(page.locator('#mdEditor')).toHaveCount(0);await expect.poll(()=>current(page)).toBe('home');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('1280: 고치기로 연 편집기도 탭을 가리지 않고, 탭을 누르면 글을 수정 칸에 돌려준 뒤 이동',async({page})=>{
 const f=await fixture(page);
 await goView(page,'basket');await page.locator('[data-basket-row="m1"]').click();
 const detail=page.locator('[data-basket-detail]');
 await noteAction(page,'[data-basket-edit]');
 await openOldBigEditorOnBasketField(page);
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
 expect(overlaps(await rect(editor),await rect(nav(page)))).toBe(false);
 await expect(editor.locator('.md-editor-kinds')).toHaveCount(0);
 await editor.locator('.md-editor-text').fill('고치던 글');
 await navTab(page,'team').click();
 // 저장 버튼이 없는 편집기는 묻지 않고 닫아 글을 수정 칸에 돌려준다. 이동은 그 화면의 기존 나가기 확인을 따른다.
 await expect(page.locator('#mdLeaveSheet[open]')).toHaveCount(0);await expect(page.locator('#mdEditor')).toHaveCount(0);
 const view=await current(page);
 if(view==='basket')await expect(detail.locator('[data-basket-text]')).toHaveValue('고치던 글');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('1280: Tab 키는 편집기 → 메뉴 → 편집기로 돌고 Enter로 탭을 쓸 수 있다',async({page})=>{
 const f=await fixture(page);
 const editor=await openWriter(page);
 // UI-크게첨부: the write window's last control is now [📎 첨부] under the text (the file input itself is tabindex -1).
 const first=editor.locator('.md-editor-head button').first(),lastTool=editor.getByRole('button',{name:'파일 첨부',exact:true});
 await lastTool.focus();
 await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>!!document.activeElement.closest('#appView>.app-nav'))).toBe(true);
 const items=await nav(page).locator('button:visible, a[href]:visible').count();
 for(let i=1;i<items;i++)await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>!!document.activeElement.closest('#appView>.app-nav'))).toBe(true);
 await page.keyboard.press('Tab');await expect(first).toBeFocused();
 await page.keyboard.press('Shift+Tab');
 expect(await page.evaluate(()=>!!document.activeElement.closest('#appView>.app-nav'))).toBe(true);
 await nav(page).locator('button:visible, a[href]:visible').first().focus();
 await page.keyboard.press('Shift+Tab');await expect(lastTool).toBeFocused();
 // 키보드로 메뉴의 탭 열기(빈 글: 바로 이동).
 await navTab(page,'projects').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#mdEditor')).toHaveCount(0);await expect.poll(()=>current(page)).toBe('projects');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('1280: 화면이 아래로 스크롤된 채 열어도 메뉴가 제자리에 보인다',async({page})=>{
 const f=await fixture(page,{width:1280,height:500});
 await goView(page,'basket');
 await page.evaluate(()=>{const tall=document.createElement('div');tall.style.height='3000px';document.querySelector('#appView').append(tall);window.scrollTo(0,400);});
 const editor=await openWriter(page);
 const side=await rect(nav(page)),box=await rect(editor);
 expect(side.y).toBeGreaterThanOrEqual(0);expect(side.b).toBeGreaterThan(300);expect(overlaps(box,side)).toBe(false);
 await editor.getByRole('button',{name:'저장하지 않고 닫기'}).click();
 await expect(page.locator('#mdEditor')).toHaveCount(0);
 expect(await page.evaluate(()=>Math.round(scrollY))).toBe(400);
 expect(f.errors).toEqual([]);
});

test('900(761~1023): 위쪽 한 줄 메뉴 아래에서만 열린다. 스크롤돼 있어도 메뉴가 보인다',async({page})=>{
 const f=await fixture(page,{width:900,height:700});
 await goView(page,'basket');
 await page.evaluate(()=>{const tall=document.createElement('div');tall.style.height='3000px';document.querySelector('#appView').append(tall);window.scrollTo(0,300);});
 // 이 폭에는 메뉴의 [쓰기]가 없어 바구니 입력칸의 ⤢로 연다.
 await openOldWriteWindow(page,900);
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
 await expect(editor).toHaveAttribute('data-md-nav','top');
 const top=await rect(nav(page)),box=await rect(editor);
 expect(top.y).toBeGreaterThanOrEqual(0);expect(top.b).toBeGreaterThan(20);expect(overlaps(box,top)).toBe(false);expect(Math.round(box.b)).toBe(700);expect(box.x).toBe(0);
 await editor.locator('.md-editor-text').fill('중간 폭 글');
 await navTab(page,'home').click();
 await expect(page.locator('#mdLeaveSheet')).toHaveAttribute('open','');
 await page.locator('#mdLeaveSheet').getByRole('button',{name:'저장 안 하고 이동',exact:true}).click();
 await expect(page.locator('#mdEditor')).toHaveCount(0);await expect.poll(()=>current(page)).toBe('home');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('390 폰: 기존 그대로 — 화면 전체 폭, 하단 탭 6칸 위에서 끝나고 모달',async({page})=>{
 const f=await fixture(page,{width:390,height:844});
 await openOldWriteWindow(page,390);
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
 const box=await rect(editor),tabs=await rect(page.locator('.mobile-tabs'));
 expect(box.x).toBe(0);expect(box.y).toBe(0);expect(Math.round(box.w)).toBe(390);expect(Math.round(box.b)).toBe(Math.round(tabs.y));
 await expect(editor).not.toHaveAttribute('data-md-nav','side');await expect(editor).not.toHaveAttribute('data-md-nav','top');
 await expect(editor).toHaveAttribute('aria-modal','true');
 await expect(page.locator('.mobile-tabs button')).toHaveCount(6);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('1280 → 390 → 1280: 창 크기를 바꾸면 자리를 다시 잡는다',async({page})=>{
 const f=await fixture(page);
 const editor=await openWriter(page);
 await page.setViewportSize({width:390,height:844});
 await expect.poll(async()=>(await rect(editor)).x).toBe(0);
 await expect(editor).toHaveAttribute('aria-modal','true');
 expect(Math.round((await rect(editor)).b)).toBe(Math.round((await rect(page.locator('.mobile-tabs'))).y));
 await page.setViewportSize({width:1280,height:800});
 await expect.poll(async()=>(await rect(editor)).x).toBeGreaterThan(150);
 expect(overlaps(await rect(editor),await rect(nav(page)))).toBe(false);
 expect(f.errors).toEqual([]);
});

if(REVIEW)for(const [width,height,dark] of [[1280,800,false],[1280,800,true],[900,700,false],[390,844,false]])test(`캡처 ${width}${dark?' 다크':''}`,async({page})=>{
 if(dark)await page.emulateMedia({colorScheme:'dark'});
 await fixture(page,{width,height});
 await openOldWriteWindow(page,width);
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
 await editor.locator('.md-editor-text').fill('# 회의 정리\n\n- **기본급** 인상\n- 수당 정비\n\n> [!NOTE]\n> 다음 주 확인');
 await editor.locator('.md-editor-text').evaluate(el=>el.blur());
 const tag=`${width}-${dark?'dark':'light'}`;
 await page.screenshot({path:`${REVIEW}/pc-tabs-${tag}.png`});
 if(width>=761){
  await nav(page).locator('[data-view="calendar"]').click();await expect(page.locator('#mdLeaveSheet')).toHaveAttribute('open','');
  await page.locator('#mdLeaveSheet').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
  await page.screenshot({path:`${REVIEW}/pc-tabs-leave-${tag}.png`});
 }
});
