import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
// UI-키보드하단바: 하단 탭은 자판이 없을 때만 보이고(홈 빠른 입력·노트 검색 공통, accessibility-dialog.js 한 곳) 자판이 뜨면 숨는다.
// 쓰기 창(ed-window.js)의 하단 탭·자판 시험은 ed-window.spec.mjs가 맡는다(옛 큰 창 시험은 ED③ 순서 6에서 지웠다).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});

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
// The phone keyboard as most Android browsers show it over the page: only the visual viewport shrinks.
const keyboard=(page,open)=>page.evaluate(open=>{if(open)Object.defineProperty(window.visualViewport,'height',{configurable:true,value:444});else delete window.visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));},open);
const tabs=page=>page.locator('.mobile-tabs');
const goView=async(page,view)=>{await page.evaluate(view=>window.KPTURouter.go(view),view);await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe(view);};

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
