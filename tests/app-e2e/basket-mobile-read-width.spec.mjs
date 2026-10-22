import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// BASKET-모바일본문폭: on a phone the title row keeps the room for the right-hand buttons, but the text and tables
// below it use the whole card width; a many-column table scrolls sideways and keeps a date such as 10/21(수) on one line.
const X=Array.from({length:4},(_,i)=>'추가열'+i+'번아주긴제목입니다열');
const row=a=>'| '+a.concat(X).join(' | ')+' |';
const TABLE=[row(['날짜','장소','내용','참석','담당','비고','결과']),'|'+' --- |'.repeat(11),row(['10/21(수)','본사 회의실','교섭 준비 회의','12명','김명진','자료 취합','완료']),row(['10/22(목)','서울 현장','현장 간담회 진행','30명','박승지','사진 첨부','진행'])].join('\n');
const TITLE='첫 줄 제목입니다 이 줄은 버튼 옆에 놓입니다 길게 길게 이어집니다';
const BODY=TITLE+'\n\n'+'둘째 문단은 카드 오른쪽 끝까지 폭을 모두 씁니다. '.repeat(6)+'\n\n'+TABLE;
function rows(){return [
 {id:'m1',workspace_id:'w',kind:'basket',title:null,raw_text:BODY,occurred_at:'2026-10-21T01:00:00Z',created_at:'2026-10-21T01:00:00Z',updated_at:'2026-10-21T01:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
 {id:'n1',workspace_id:'w',kind:'note',title:'표가 있는 노트',raw_text:BODY,occurred_at:'2026-10-21T01:00:00Z',created_at:'2026-10-21T01:00:00Z',updated_at:'2026-10-21T01:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
];}
async function fixture(page){
 const data=rows(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(r.request().method()!=='GET'||q.get('metadata'))return r.fulfill({json:[]});
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'));
  return r.fulfill({json:data.filter(pick).slice(Number(q.get('offset')||0))});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();
 return {errors};
}
async function check(page,card,text,tools,info,name){
 await expect(text.locator('table')).toBeVisible();
 const [c,t,tb]=await Promise.all([card.boundingBox(),text.boundingBox(),text.locator('table').boundingBox()]);
 // The body ends at the card's right edge (card padding only), not at the buttons' left edge.
 expect(c.x+c.width-(t.x+t.width)).toBeLessThanOrEqual(14);
 expect(t.width).toBeGreaterThan(c.width-30);
 // The table scrolls sideways inside the text; the page itself never overflows.
 const sc=await text.locator('table').evaluate(el=>({sw:el.scrollWidth,cw:el.clientWidth,ox:getComputedStyle(el).overflowX}));
 expect(sc.ox).toBe('auto');expect(sc.sw).toBeGreaterThan(sc.cw);
 expect(tb.x+tb.width).toBeLessThanOrEqual(t.x+t.width+1);
 // A date stays on one line.
 const cell=text.locator('td',{hasText:'10/21(수)'});
 const h=await cell.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);return r.getClientRects().length;});
 expect(h).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // The title row still leaves the buttons' room: the first text line stops before the buttons.
 if(tools){const tl=await tools.boundingBox();const first=await text.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el.querySelector('p')||el);return r.getClientRects()[0].right;});expect(first).toBeLessThanOrEqual(tl.x+2);}
 await page.screenshot({path:info.outputPath(`${name}.png`),fullPage:true});
}
for(const width of [390,1280])test(`update card ${width}: body uses the full card width, table scrolls sideways`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page);
 await page.locator('[data-basket-row="m1"]').click();
 const card=page.locator('[data-basket-card]'),text=card.locator('[data-basket-read-text]');
 await expect(text).toHaveClass(/md-body/);
 await check(page,card,text,card.locator('.basket-card-tools'),info,`update-${width}`);
 expect(f.errors).toEqual([]);
});
for(const width of [390,1280])test(`note ${width}: body uses the full card width, table scrolls sideways`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page);
 await chooseBasketKind(page,'note');
 await page.locator('[data-note-host] [data-note-row]').first().click();
 const detail=page.locator('[data-note-detail]'),text=detail.locator('[data-basket-read-text]');
 await expect(text).toHaveClass(/md-body/);
 await check(page,detail.locator('[data-note-read]'),text,null,info,`note-${width}`);
 expect(f.errors).toEqual([]);
});
