import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noteAction } from './helpers/basket-more.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import {openWriteFromEntry} from './helpers/write-opener.mjs';
// UI-키보드하단바: 쓰기 창 머리줄 한 줄 [× 닫기] [저장 아이콘] [업데이트 ▾|노트] [쓰기|미리보기] … [내보내기] → 서식 도구줄 → 본문 → 앱 하단 탭 6칸.
// BASKET-업데이트통합 PR 2: 저장은 × 옆 저장 아이콘 하나(저장하고 닫기).
// 하단 탭은 자판이 없을 때만 보이고(쓰기 창·홈 빠른 입력·노트 검색 공통, accessibility-dialog.js 한 곳), 글이 있는 쓰기 창에서
// 탭을 누르면 "저장 안 하고 닫을까요?"를 먼저 묻는다. 캡처: UI_REVIEW_DIR가 있으면 그 폴더에 390·1280 라이트·다크를 남긴다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});
const REVIEW=process.env.UI_REVIEW_DIR||'';

async function fixture(page,{width=390,height=844,dark=false}={}){
 if(dark)await page.emulateMedia({colorScheme:'dark'});
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
async function openWriter(page,width){
 await openWriteFromEntry(page,width);
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();return editor;
}
// The phone keyboard as most Android browsers show it over the page: only the visual viewport shrinks.
const keyboard=(page,open)=>page.evaluate(open=>{if(open)Object.defineProperty(window.visualViewport,'height',{configurable:true,value:444});else delete window.visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));},open);
const tabs=page=>page.locator('.mobile-tabs');
const goView=async(page,view)=>{await page.evaluate(view=>window.KPTURouter.go(view),view);await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe(view);};
async function head(editor){
 return editor.locator('.md-editor-head').evaluate(el=>[...el.children].filter(c=>c.getClientRects().length&&getComputedStyle(c).position!=='absolute').map(c=>{const r=c.getBoundingClientRect();return {name:c.getAttribute('aria-label')||c.textContent.trim(),x:r.x,y:r.y,h:Math.round(r.height),w:Math.round(r.width)};}));
}

for(const width of [390,1280]){
 test(`쓰기 창: 머리줄 한 줄 순서·높이, 서식줄이 본문 위, 폰은 하단 탭 6칸 위 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  const editor=await openWriter(page,width);
  const items=await head(editor);
  expect(items.map(i=>i.name)).toEqual(['저장하지 않고 닫기','바구니에 새 업데이트로 저장','저장할 곳','보기','내보내기'].filter(n=>width<1024||n!=='보기'));
  await expect(editor.locator('.md-editor-kinds button')).toHaveText(['업데이트','▾','노트']);
  if(width<1024)await expect(editor.locator('.md-editor-modes button')).toHaveText(['쓰기','미리보기']);
  // One row: every item on the same line, left to right, 32px tall; the icon buttons are 32×32 with a 44px press area.
  for(const i of items){expect(i.h,i.name).toBe(32);expect(Math.abs(i.y-items[0].y),i.name).toBeLessThan(2);}
  for(let n=1;n<items.length;n++)expect(items[n].x).toBeGreaterThan(items[n-1].x);
  for(const name of ['저장하지 않고 닫기','바구니에 새 업데이트로 저장','내보내기']){
   const b=editor.getByRole('button',{name,exact:true});
   expect((await b.boundingBox()).width).toBe(32);
   expect(await b.evaluate(el=>[getComputedStyle(el,'::after').width,getComputedStyle(el,'::after').height])).toEqual(['44px','44px']);
  }
  // 내보내기 sits at the right end; the save icon right beside ×.
  const share=await editor.getByRole('button',{name:'내보내기',exact:true}).boundingBox();expect(Math.round(share.x+share.width)).toBeGreaterThan(width-16);expect(share.x+share.width).toBeLessThanOrEqual(width);
  const [close,save]=await Promise.all([editor.locator('[data-close="mdEditor"]').boundingBox(),editor.locator('[data-md-save-icon]').boundingBox()]);expect(save.x-(close.x+close.width)).toBeLessThan(16);
  expect(await editor.locator('.md-editor-head').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  // Neighbouring press areas do not overlap (icons reach 6px past their 32px box).
  for(let n=1;n<items.length;n++){const gap=items[n].x-(items[n-1].x+items[n-1].w);expect(gap,items[n].name).toBeGreaterThanOrEqual(6-0.5);}
  // Head → format row → text.
  const [h,t,a]=await Promise.all([editor.locator('.md-editor-head'),editor.locator('.md-editor-tools'),editor.locator('.md-editor-text')].map(l=>l.boundingBox()));
  expect(Math.abs(t.y-(h.y+h.height))).toBeLessThan(2);expect(a.y).toBeGreaterThanOrEqual(t.y+t.height-1);
  expect(await editor.locator('.md-editor-bar').count()).toBe(1);
  if(width<761){
   await expect(tabs(page)).toBeVisible();await expect(tabs(page).locator('button')).toHaveCount(6);
   const box=await editor.boundingBox(),bar=await tabs(page).boundingBox();
   expect(Math.round(box.y+box.height)).toBe(Math.round(bar.y));
  }else await expect(tabs(page)).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });
}

test('쓰기 창: 자판이 뜨면 하단 탭이 숨고 본문이 자판 위까지, 내려가면 다시 보임 390',async({page})=>{
 const f=await fixture(page);
 const editor=await openWriter(page,390),area=editor.locator('.md-editor-text');
 await expect(area).toBeFocused();
 await keyboard(page,true);
 await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);await expect(tabs(page)).toBeHidden();
 let box=await editor.boundingBox();expect(Math.round(box.y+box.height)).toBe(444);
 // The head and the format row stay on top while typing.
 expect((await editor.locator('.md-editor-tools').boundingBox()).y).toBeLessThan(120);
 await keyboard(page,false);
 await expect(page.locator('body')).not.toHaveClass(/kptu-mobile-keyboard/);await expect(tabs(page)).toBeVisible();
 box=await editor.boundingBox();expect(Math.round(box.y+box.height)).toBe(Math.round((await tabs(page).boundingBox()).y));
 // A keyboard that shrinks the layout itself (interactive-widget=resizes-content) does the same.
 await page.setViewportSize({width:390,height:500});
 await expect(tabs(page)).toBeHidden();box=await editor.boundingBox();expect(Math.round(box.y+box.height)).toBe(500);
 await page.setViewportSize({width:390,height:844});
 await expect(tabs(page)).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('다른 화면 입력 칸(홈 빠른 입력·노트 검색)도 같은 곳에서 자판 따라 하단 탭 숨김·복귀 390',async({page})=>{
 const f=await fixture(page);
 const input=page.locator('#homeView [data-home-quick] [data-quick-input]');
 await input.focus();await expect(tabs(page)).toBeVisible();
 await keyboard(page,true);await expect(tabs(page)).toBeHidden();
 await keyboard(page,false);await expect(tabs(page)).toBeVisible();
 await page.evaluate(()=>document.activeElement.blur());
 await goView(page,'basket');await chooseBasketKind(page,'note');
 const search=page.locator('[data-note-search]');await search.focus();
 await keyboard(page,true);await expect(tabs(page)).toBeHidden();
 await keyboard(page,false);await expect(tabs(page)).toBeVisible();
 // Wide screens never use the keyboard layout.
 await page.setViewportSize({width:1280,height:900});await search.focus();await keyboard(page,true);
 await expect(page.locator('body')).not.toHaveClass(/kptu-mobile-keyboard/);
 expect(f.errors).toEqual([]);
});

test('글이 있는 쓰기 창에서 하단 탭: "저장 안 하고 닫을까요?" [계속 쓰기]·[저장 안 하고 이동] 390',async({page})=>{
 const f=await fixture(page);
 await goView(page,'basket');
 const editor=await openWriter(page,390),area=editor.locator('.md-editor-text');
 await area.fill('아직 저장 안 한 글');await area.evaluate(el=>el.blur());
 const sheet=page.locator('#mdLeaveSheet');
 await tabs(page).locator('[data-view="calendar"]').tap();
 await expect(sheet).toHaveAttribute('open','');await expect(sheet.locator('h2')).toHaveText('저장 안 하고 닫을까요?');
 await expect(sheet.locator('[data-sheet-value]')).toHaveText(['계속 쓰기','저장 안 하고 이동']);
 expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 // [계속 쓰기]: back to the text, nothing moved.
 await sheet.getByRole('button',{name:'계속 쓰기',exact:true}).tap();
 await expect(sheet).not.toHaveAttribute('open','');await expect(editor).toBeVisible();await expect(area).toHaveValue('아직 저장 안 한 글');await expect(area).toBeFocused();
 expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 // Phone back on the question closes only the question.
 await tabs(page).locator('[data-view="calendar"]').tap();await expect(sheet).toHaveAttribute('open','');
 await page.goBack();await expect(sheet).not.toHaveAttribute('open','');await expect(editor).toBeVisible();
 // [저장 안 하고 이동]: the editor closes and the tab opens.
 await tabs(page).locator('[data-view="calendar"]').tap();
 await sheet.getByRole('button',{name:'저장 안 하고 이동',exact:true}).tap();
 await expect(page.locator('#mdEditor')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('calendar');
 await expect(tabs(page).locator('[data-view="calendar"]')).toHaveAttribute('aria-current','page');
 // Back from there returns to the screen under the editor (no editor entry left behind).
 await page.goBack();await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 await expect(page.locator('#mdEditor')).toHaveCount(0);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('빈 쓰기 창·고치기로 연 편집기에서 하단 탭은 묻지 않고 바로 이동 390',async({page})=>{
 const f=await fixture(page);
 await openWriter(page,390);
 await tabs(page).locator('[data-view="projects"]').tap();
 await expect(page.locator('#mdLeaveSheet[open]')).toHaveCount(0);await expect(page.locator('#mdEditor')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('projects');
 // Whitespace only counts as empty.
 const editor=await openWriter(page,390);await editor.locator('.md-editor-text').fill('  \n ');
 await tabs(page).locator('[data-view="home"]').tap();
 await expect(page.locator('#mdEditor')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('home');
 // The editor opened to change a memo: the text goes back to the memo and the basket's own leave rules apply.
 await goView(page,'basket');await page.locator('[data-basket-row="m1"]').click();
 const detail=page.locator('[data-basket-detail]');
 await noteAction(page,'[data-basket-edit]');
 await detail.getByRole('button',{name:'큰 창에서 수정',exact:true}).click();
 await expect(page.locator('#mdEditor [data-md-kinds]')).toHaveCount(0);await expect(page.locator('#mdEditor .md-editor-kinds')).toHaveCount(0);
 await tabs(page).locator('[data-view="team"]').tap();
 await expect(page.locator('#mdLeaveSheet[open]')).toHaveCount(0);await expect(page.locator('#mdEditor')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('team');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('쓰기 창 저장 아이콘(업데이트)·[내보내기] 시트는 그대로 390',async({page})=>{
 const f=await fixture(page);
 const editor=await openWriter(page,390);
 await editor.locator('.md-editor-text').fill('쓰기 메모');
 await editor.getByRole('button',{name:'내보내기',exact:true}).click();
 const sheet=page.locator('#mdExportSheet');await expect(sheet).toHaveAttribute('open','');
 await expect(sheet.locator('[data-sheet-value]')).toHaveText(['텔레그램용 복사','한글용 복사','HWP 파일로 받기']);
 await page.keyboard.press('Escape');await expect(sheet).not.toHaveAttribute('open','');
 await editor.locator('[data-md-save-icon]').click();
 await expect(page.locator('#mdEditor')).toHaveCount(0);await expect(page.locator('#toast')).toContainText('바구니에 저장했어요.');
 expect(f.writes).toEqual([{method:'POST',body:{workspace_id:'w',raw_text:'쓰기 메모'}}]);
 await expect(tabs(page)).toBeVisible();
 expect(f.errors).toEqual([]);
});

if(REVIEW)for(const [width,dark] of [[390,false],[390,true],[1280,false],[1280,true]])test(`캡처 ${width}${dark?' 다크':''}`,async({page})=>{
 await fixture(page,{width,height:width<761?844:860,dark});
 const editor=await openWriter(page,width);
 await editor.locator('.md-editor-text').fill('# 회의 정리\n\n- **기본급** 인상\n- 수당 정비\n\n> [!NOTE]\n> 다음 주 확인');
 await editor.locator('.md-editor-text').evaluate(el=>el.blur());
 const tag=`${width}-${dark?'dark':'light'}`;
 await page.screenshot({path:`${REVIEW}/writer-${tag}.png`});
 if(width<761){
  await editor.locator('.md-editor-text').focus();await keyboard(page,true);await expect(tabs(page)).toBeHidden();
  await page.screenshot({path:`${REVIEW}/writer-keyboard-${tag}.png`});
  await keyboard(page,false);await editor.locator('.md-editor-text').evaluate(el=>el.blur());
  await tabs(page).locator('[data-view="calendar"]').tap();await expect(page.locator('#mdLeaveSheet')).toHaveAttribute('open','');
  await page.locator('#mdLeaveSheet').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
  await page.screenshot({path:`${REVIEW}/writer-leave-${tag}.png`});
 }
});
