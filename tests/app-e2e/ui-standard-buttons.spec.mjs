import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openBasketMore} from './helpers/basket-more.mjs';
// UI-디자인기준 1/3 보완(8-9c2): 홈·바구니 버튼 높이 하나(홈 빠른 입력 [추가] 높이), 버튼 4종,
// 홈 빠른 입력 탭 종류 색, "오늘 할 일" 제목, 바구니 AI 버튼 [⋯ 더보기], 다크 모드 끔.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00.123456+00:00';
const n='10000000-0000-4000-8000-000000000002';
const look=locator=>locator.evaluate(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {height:b.height,fontSize:s.fontSize,fontWeight:s.fontWeight,radius:s.borderRadius,bg:s.backgroundColor,fg:s.color,border:s.borderTopColor,shadow:s.boxShadow,image:s.backgroundImage};});
const token=(page,name)=>page.evaluate(name=>{const e=document.createElement('span');e.style.color=`var(${name})`;document.querySelector('#appView').append(e);const c=getComputedStyle(e).color;e.remove();return c;},name);
async function open(page,width,dark=false){
 await page.setViewportSize({width,height:width<761?844:900});
 if(dark)await page.emulateMedia({colorScheme:'dark'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 await openHome(page);
 const note={id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:'10/20 기자회견 자료',ai_export_allowed:true,archived_at:null,attachments:[{drive_file_id:'drive-a',file_name:'안내문.pdf',mime_type:'application/pdf',size_bytes:4096},{drive_file_id:'drive-h',file_name:'양식.hwp',mime_type:'application/x-hwp',size_bytes:8192}],metadata:{}};
 for(const t of ['app_suborganizations','app_suborganization_assignees','app_spaces','app_record_links'])await page.route(SB+'/rest/v1/'+t+'?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_notes?**',r=>{const q=new URL(r.request().url()).searchParams;if(r.request().method()!=='GET')return r.fulfill({status:500,json:{}});if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:[note].slice(Number(q.get('offset')||0))});});
 await page.waitForFunction(()=>window.KPTUHome?.metrics.readyAt>0);
 return errors;
}
// Every visible button-shaped control in a region: the same height, 13px, 500, 8px corners, no shadow or gradient.
async function sameButtons(region,height,quickHeight=height){
 const all=await region.locator('button:visible,[data-basket-attachments] a:visible,[data-basket-more] > summary:visible').all();
 const shaped=[];
 for(const control of all){
  // 8-9e-2: the basket [⋯] is a small icon on phones and its menu rows are not button-shaped.
  // UI-디자인손질 6: the note's "‹ 바구니" (title-position back link) and its [⋯] icon are not button-shaped either.
  // BASKET-업데이트통합: the input's [크게] icon (home·basket) is an icon in the field like the clip, not a button shape.
  // UI-바구니상세개편: the [복사]·원문 toggle icons, photo previews and the files' small text links are not button shapes either.
  // UI-업데이트목록메뉴: the update row's [⋯] beside [복사] is the same small icon (as the note row's).
  // UI-PC바구니첨부버튼: the [📎 첨부] shared button (46px) is checked in basket-attach-button.spec.
  if(await control.evaluate(el=>el.matches('.basket-row,.basket-clip,.home-quick-big,.icon-btn,.quick-text-link,.home-basket-link,.md-body *,.basket-more-menu *,.basket-back,[data-basket-note-more],.basket-icon-button,.basket-row-copy,.basket-row-more,.basket-file-thumb,.basket-file-link')||el.matches('.basket-more-trigger')&&innerWidth<761))continue;
  const s=await look(control);shaped.push(s);
  // UI-버튼크기: 주 동작 버튼만 [추가] 높이(46px). 전환(홈 [업데이트 ▾|할 일]·바구니 [메모|노트])은 32px 상자 안 칸으로
  // 바깥쪽 모서리만 8px, 필터([미분류·전체·보관])는 32px 알약, PC [⋯ 더보기]는 32px 보조 버튼. 작은 것은 누르는 범위(::after) 44px.
  const want=await control.evaluate(el=>{
   const seg=el.closest('.home-quick-modes,.inbox-pane-switch');
   const r='8px';
   if(seg){const cells=[...seg.querySelectorAll('button')],i=cells.indexOf(el);return {min:30,max:32,radius:i===0?`${r} 0px 0px ${r}`:i===cells.length-1?`0px ${r} ${r} 0px`:'0px'};}
   // UI-버튼작게 ①: 읽기 화면 아래 버튼은 한 줄 32px. UI-업데이트편집한줄: 수정 화면 버튼 줄과 [첨부 저장]도 32px.
   if(el.closest('.basket-read-actions,.basket-edit-actions')||el.matches('[data-basket-upload]'))return {min:32,max:32,radius:'8px'};
   if(el.matches('[data-basket-filter]'))return {min:32,max:32,radius:'999px'};
   if(el.matches('.basket-more-trigger'))return {min:32,max:32,radius:'8px'};
   return null;
  });
  const label=await control.textContent();
  if(want){expect(s.height,label).toBeGreaterThanOrEqual(want.min);expect(s.height,label).toBeLessThanOrEqual(want.max);expect(s.radius,label).toBe(want.radius);expect(await control.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height)),label).toBe(44);}
  // UI-PC버튼36: the quick input's [추가] is the input height on PC (quickHeight); other main buttons keep --ds-control-height.
  // UI-버튼전수조사(2026-10-24): 46px(--ds-control-height) 버튼은 없앴다. 채운 버튼(주 동작)은 36px(--kptu-control-height), 나머지는 작은 버튼 32px. 누르는 범위 44px.
  else{const h=await control.evaluate((el,q)=>el.matches('.home-quick-save')?q:el.matches('.primary,.quick-pill-primary,[data-basket-save]')?36:32,quickHeight);expect(Math.abs(s.height-h),label).toBeLessThanOrEqual(0.5);expect(s.radius,label).toBe('8px');expect(await control.evaluate(el=>{const r=el.getBoundingClientRect().height,a=getComputedStyle(el,'::after');return a.content==='none'?r:Math.max(r,parseFloat(a.height)||0,parseFloat(a.minHeight)||0)}),label+' 누르는 범위').toBeGreaterThanOrEqual(44);}
  expect(s.fontSize).toBe('13px');expect(s.fontWeight).toBe('500');expect(s.shadow).toBe('none');expect(s.image).toBe('none');
 }
 return shaped;
}

for(const width of [390,1280])test(`home and basket buttons share the [추가] height and four kinds ${width}`,async({page})=>{
 const errors=await open(page,width);
 const quick=page.locator('#homeView .home-quick'),save=quick.locator('[data-quick-save]');
 // UI-PC버튼36(2026-10-20): PC(≥1024) 빠른 입력 [추가]·입력칸은 입력칸 높이(--kptu-control-height 36px). 토큰 --ds-control-height(46px)는 입력칸 등에 남아 있다(버튼은 UI-버튼전수조사로 36/32px).
 const height=parseFloat(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ds-control-height')));
 // UI-버튼줄이기 + HOME-모바일정리④: 빠른 입력 [추가]와 홈 입력칸은 폭과 상관없이 36px(--kptu-control-height).
 const quickHeight=parseFloat(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--kptu-control-height'))),inputHeight=quickHeight;
 expect(height).toBe(46);expect((await look(save)).height).toBe(quickHeight);expect(quickHeight).toBe(36);
 const primary=await token(page,'--kptu-primary'),onPrimary=await token(page,'--kptu-on-primary');
 // Home tabs: one height; the selected tab is gray whichever it is (UI-선택표시통일 결정 B), the others white.
 const kinds={update:'--ds-kind-other',task:'--ds-kind-other'};
 for(const [mode,kind] of Object.entries(kinds)){
  const tab=quick.locator(`[data-quick-mode="${mode}"]`);
  if(width<761)await tab.tap();else await tab.click();
  await expect(tab).toHaveAttribute('aria-pressed','true');
  const s=await look(tab);expect(s.bg).toBe(await token(page,'--ds-select-bg'));expect(s.fg).toBe(await token(page,'--ds-select-ink'));
  for(const other of Object.keys(kinds).filter(m=>m!==mode))expect((await look(quick.locator(`[data-quick-mode="${other}"]`))).bg).toBe(await token(page,'--kptu-surface'));
  const filled=await look(save);expect(filled.height).toBe(quickHeight);expect(filled.bg).toBe(primary);expect(filled.fg).toBe(onPrimary);
  if(mode!=='update')expect((await quick.locator('[data-quick-input]').boundingBox()).height).toBe(inputHeight);
  expect(await save.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height))).toBe(44);
  await sameButtons(quick.locator('.home-quick-modes'),height,quickHeight);
 }
 await quick.locator('[data-quick-mode="update"]').click();
 // 이름만 바꿈: 밀린 할 일도 그대로 보인다.
 const tasks=page.locator('#homeView [data-home-card="tasks"]');
 await expect(tasks.locator('h3')).toContainText('오늘 할 일');await expect(tasks.locator('h3')).not.toContainText('밀린');
 await expect(tasks).toContainText('지연 항목');await expect(tasks).toContainText('오늘 항목');

 // Basket list: filters, [추가] and [⋯ 더보기]; the AI buttons are folded away until it opens.
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 const basket=page.locator('#basketView'),more=basket.locator('[data-basket-more]');
 // 8-9e-2: [⋯] is a button (aria-label 더보기) that opens a small menu under itself.
 await expect(more).toHaveJSProperty('tagName','BUTTON');await expect(more).toHaveAttribute('aria-label','더보기');await expect(more).toHaveAttribute('aria-expanded','false');
 for(const name of ['AI 분류 요청','분류 결과 입력','GPT 답변 가져오기'])await expect(basket.getByRole('button',{name,exact:true})).toHaveCount(0);
 await sameButtons(basket,height,quickHeight);
 const filled=[];for(const c of await basket.locator('button:visible').all())if((await look(c)).bg===primary&&!(await c.evaluate(el=>el.matches('[aria-pressed="true"],[aria-checked="true"],.active'))))filled.push(await c.textContent());
 expect(filled).toEqual(['추가']);
 expect((await look(basket.locator('[data-basket-filter="unclassified"]'))).bg).toBe(primary);
 // Keyboard opens and closes the menu; it does not push the list.
 const listTop=(await basket.locator('[data-basket-filter="unclassified"]').boundingBox()).y;
 await more.focus();await page.keyboard.press('Enter');await expect(more).toHaveAttribute('aria-expanded','true');
 await expect(page.locator('#basketMoreMenu').getByRole('button')).toHaveText(['AI 분류 요청','GPT 답변 가져오기']);
 expect((await basket.locator('[data-basket-filter="unclassified"]').boundingBox()).y).toBe(listTop);
 await sameButtons(basket,height,quickHeight);
 await page.keyboard.press('Escape');await expect(more).toHaveAttribute('aria-expanded','false');await expect(more).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

 // Read view: actions and attachment controls share the height; 연결하기 filled, 할 일 만들기 task kind (UI-디자인손질 6),
 // 삭제 is a red item in the note's [⋯] menu.
 const row=page.locator(`[data-basket-row="${n}"]`);if(width<761)await row.tap();else await row.click();
 await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 const detail=basket.locator('[data-basket-detail]');
 await expect(detail.locator('[data-basket-attachments] a')).toHaveCount(2);await expect(detail.locator('[data-basket-library-send]')).toHaveCount(2);await expect(detail.locator('[data-basket-hwp-edit]')).toHaveCount(1);
 // UI-바구니상세개편: the file controls are small text links (12px, no box) under the name and size.
 for(const l of await detail.locator('.basket-file-link').all())expect(await l.evaluate(el=>[getComputedStyle(el).fontSize,getComputedStyle(el).borderTopStyle])).toEqual(['12px','none']);
 await sameButtons(detail,height);
 // UI-바구니상세버튼색: [연결하기]·[할 일 만들기]·[노트로 옮기기] share background, border and text color.
 const link=await look(detail.locator('[data-basket-link-open]')),task=await look(detail.locator('[data-basket-task-open]')),move=await look(detail.locator('[data-basket-to-note]'));
 expect(move.bg).toBe(await token(page,'--kptu-surface'));
 for(const b of [link,task])for(const k of ['bg','fg','border','fontWeight','shadow','image'])expect(b[k]).toBe(move[k]);
 await detail.locator('[data-basket-note-more]').click();
 const del=await look(detail.locator('[data-basket-delete]'));expect(del.fg).toBe(await token(page,'--kptu-danger'));
 // Edit view: [수정 저장] is the one filled button.
 await detail.locator('[data-basket-edit]').click();await expect(detail.locator('[data-basket-save]')).toBeVisible();
 await sameButtons(detail,height);
 const editFilled=[];for(const c of await detail.locator('button:visible').all())if((await look(c)).bg===primary&&!(await c.evaluate(el=>el.matches('[aria-pressed="true"],[aria-checked="true"],.active'))))editFilled.push(await c.textContent());
 expect(editFilled).toEqual(['수정 저장']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('dark mode follows the device on home and basket (3/3 8-9e-3 turned it on for the whole app)',async({page})=>{
 const errors=await open(page,390,true);
 expect(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
 const dark={bg:'rgb(22, 22, 19)',surface:'rgb(31, 31, 27)'};
 const colors=()=>page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return {scheme:s.colorScheme,bg:getComputedStyle(document.body).backgroundColor,surface:getComputedStyle(document.querySelector('#homeView .home-quick')).backgroundColor};});
 const home=await colors();expect(home.bg).toBe(dark.bg);expect(home.surface).toBe(dark.surface);expect(home.scheme).toContain('dark');
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe(dark.bg);
 await openBasketMore(page);
 expect(errors).toEqual([]);
});
