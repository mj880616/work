import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-자주가는링크: PC 사이드바 [쓰기] 아래 '자주 가는 링크 ›' 줄. 누르면 그 줄 오른쪽에서 위쪽으로 창이 열리고(창 아래끝 = 줄 아래끝),
// 화면 밖으로 잘리지 않는다. 바깥 누르기·Esc로 닫힌다. 링크는 새 탭(rel="noopener noreferrer").
// '업무'·'담당조직 홈페이지' 두 묶음, 2열. [편집]으로 추가·이름/주소 수정·삭제·끌어서 순서 변경, 내 프로필 quick_links 칸에 저장.
// 칸이 아직 없으면(적용 전) 초기 링크를 보여 주고 편집은 '저장 준비 중' 안내. http/https 밖의 주소는 거절.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const WORK=['조직관리시스템','노조 NAS','궤도 NAS','전자결재시스템','문자·팩스 발송 시스템','망고보드','구글 시트'];
const ORG=['공공운수노조','궤도협의회','서울교통공사노조','전국철도노동조합'];

// profile: {column:true|false, value} — column:false answers like PostgREST for a missing column (400).
async function open(page,width,{height=900,profile={column:true,value:null}}={}){
 await page.setViewportSize({width,height});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const writes=[];
 await openHome(page,{beforeLoad:()=>page.route(SB+'/rest/v1/app_profiles**',async route=>{
  const req=route.request(),u=new URL(req.url());
  const wantsLinks=(u.searchParams.get('select')||'').includes('quick_links');
  if(req.method()==='PATCH'&&'quick_links' in (req.postDataJSON()||{})){
   if(!profile.column)return route.fulfill({status:400,contentType:'application/json',body:'{"code":"42703","message":"column does not exist"}'});
   const body=req.postDataJSON();writes.push(body.quick_links);profile.value=body.quick_links;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{user_id:'home-test',quick_links:profile.value}])});
  }
  if(wantsLinks){
   if(!profile.column)return route.fulfill({status:400,contentType:'application/json',body:'{"code":"42703","message":"column app_profiles.quick_links does not exist"}'});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{quick_links:profile.value}])});
  }
  return route.fallback();
 })});
 return {errors,writes,profile};
}
const row=page=>page.locator('#appView>.app-nav [data-quick-links]');
const panel=page=>page.locator('#quickLinksPanel');
const group=(page,label)=>panel(page).getByRole('region',{name:label,exact:true});

for(const width of [1280,1440]){
 test(`PC ${width}: [쓰기] 아래 한 줄, 오른쪽에서 위로 열림(아래끝 맞춤·잘림 없음), 두 묶음 2열·새 탭, 바깥·Esc로 닫힘`,async({page})=>{
  const {errors}=await open(page,width);
  await expect(row(page)).toBeVisible();await expect(row(page)).toHaveText(/자주 가는 링크\s*›/);
  // The row is the last menu row (right before the sidebar spacer), directly under whichever menu row comes before it.
  // It does not depend on [쓰기]: when [쓰기] leaves the sidebar the row stays at the same place in the list.
  expect(await row(page).evaluate(el=>el.nextElementSibling?.classList.contains('sidebar-spacer'))).toBe(true);
  const prev=await row(page).evaluate(el=>{let p=el.previousElementSibling;while(p&&!p.getClientRects().length)p=p.previousElementSibling;const r=p.getBoundingClientRect();return {y:r.y,height:r.height}});
  const r=await row(page).boundingBox();
  expect(r.y).toBeGreaterThanOrEqual(prev.y+prev.height-1);expect(r.y).toBeLessThan(prev.y+prev.height+12);
  await expect(row(page)).toHaveAttribute('aria-expanded','false');
  await row(page).click();
  await expect(panel(page)).toBeVisible();await expect(row(page)).toHaveAttribute('aria-expanded','true');
  await expect(group(page,'업무').getByRole('link')).toHaveText(WORK);
  await expect(group(page,'담당조직 홈페이지').getByRole('link')).toHaveText(ORG);
  // Upward, beside the row: left of the panel right of the row, bottom edge on the row's bottom edge, all inside the window.
  const p=await panel(page).boundingBox(),vw=width,vh=900;
  expect(p.x).toBeGreaterThanOrEqual(r.x+r.width);
  expect(Math.abs((p.y+p.height)-(r.y+r.height))).toBeLessThanOrEqual(1.5);
  expect(p.y).toBeGreaterThanOrEqual(0);expect(p.x+p.width).toBeLessThanOrEqual(vw);expect(p.y+p.height).toBeLessThanOrEqual(vh);
  // Two columns: the first two links of 업무 sit on one line.
  const [a,b,c]=await Promise.all([0,1,2].map(i=>group(page,'업무').getByRole('link').nth(i).boundingBox()));
  expect(Math.abs(a.y-b.y)).toBeLessThan(2);expect(b.x).toBeGreaterThan(a.x+a.width-1);expect(c.y).toBeGreaterThan(a.y+a.height-1);
  // Every link: exact address, new tab, no opener/referrer.
  const links=await panel(page).getByRole('link').evaluateAll(els=>els.map(a=>[a.textContent,a.getAttribute('href'),a.target,a.rel]));
  expect(links).toEqual([
   ['조직관리시스템','https://www.kptu.net:8000/main'],['노조 NAS','https://kptu00.quickconnect.to/'],['궤도 NAS','https://data.railone.kr/'],
   ['전자결재시스템','https://npasoneq.co.kr/npasoneq/index.html'],['문자·팩스 발송 시스템','https://letter.dlive.kr/'],['망고보드','https://www.mangoboard.net/'],
   ['구글 시트','https://docs.google.com/spreadsheets/'],['공공운수노조','https://www.kptu.net'],['궤도협의회','https://railone.kr/'],
   ['서울교통공사노조','http://www.stlu.kr/'],['전국철도노동조합','https://krwu.nodong.net']].map(([n,h])=>[n,h,'_blank','noopener noreferrer']));
  // Clicking a link opens a new tab (the request is stopped; nothing leaves the test).
  await page.context().route(/^https?:\/\/(?!127\.0\.0\.1|xmlkxfjeagycwttklxjw)/,route=>route.fulfill({status:200,contentType:'text/html',body:'<title>외부</title>'}));
  const [popup]=await Promise.all([page.waitForEvent('popup'),group(page,'업무').getByRole('link',{name:'망고보드'}).click()]);
  expect(popup.url()).toBe('https://www.mangoboard.net/');
  expect(await popup.evaluate(()=>window.opener)).toBeNull();await popup.close();
  // Outside press closes; focus does not jump.
  await page.mouse.click(vw-40,vh-40);await expect(panel(page)).toBeHidden();await expect(row(page)).toHaveAttribute('aria-expanded','false');
  // Esc closes and returns focus to the row.
  await row(page).click();await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');await expect(panel(page)).toBeHidden();await expect(row(page)).toBeFocused();
  // Pressing the row again also closes it.
  await row(page).click();await expect(panel(page)).toBeVisible();await row(page).click();await expect(panel(page)).toBeHidden();
  expect(errors).toEqual([]);
 });
}

test('PC 1280 짧은 창(높이 520): 줄이 아래쪽이라도 창 위끝이 화면 안, 아래끝은 줄 아래끝 이내',async({page})=>{
 const {errors}=await open(page,1280,{height:520});
 await row(page).scrollIntoViewIfNeeded();
 const r=await row(page).boundingBox();
 await row(page).click();await expect(panel(page)).toBeVisible();
 const p=await panel(page).boundingBox();
 expect(p.y).toBeGreaterThanOrEqual(0);expect(p.y+p.height).toBeLessThanOrEqual(520);
 expect(p.y+p.height).toBeLessThanOrEqual(Math.max(r.y+r.height,p.height+8)+1.5);
 // The content scrolls inside when the window is shorter than the list.
 expect(await panel(page).evaluate(el=>el.scrollHeight<=el.clientHeight+1||getComputedStyle(el).overflowY==='auto')).toBe(true);
 expect(errors).toEqual([]);
});

test('PC 1280 편집: 추가·이름/주소 수정·삭제·끌어서 순서 → 내 프로필 quick_links에 저장, 다시 열어도 그대로',async({page})=>{
 const {errors,writes,profile}=await open(page,1280);
 await row(page).click();await panel(page).getByRole('button',{name:'편집'}).click();
 const work=group(page,'업무 편집'),org=group(page,'담당조직 홈페이지 편집');
 await expect(work.getByRole('textbox',{name:'이름'})).toHaveCount(7);await expect(org.getByRole('textbox',{name:'이름'})).toHaveCount(4);
 // 수정: 망고보드 → 망고보드(디자인), 주소도 바꿈.
 await work.getByRole('textbox',{name:'이름'}).nth(5).fill('망고보드(디자인)');
 await work.getByRole('textbox',{name:'주소'}).nth(5).fill('https://www.mangoboard.net/design');
 // 삭제: 구글 시트.
 await work.getByRole('button',{name:'구글 시트 삭제'}).click();await expect(work.getByRole('textbox',{name:'이름'})).toHaveCount(6);
 // 추가: 담당조직에 새 링크(주소창처럼 www.만 써도 https:// 붙임).
 await org.getByRole('button',{name:'+ 추가'}).click();
 await expect(org.getByRole('textbox',{name:'이름'}).last()).toBeFocused();
 await org.getByRole('textbox',{name:'이름'}).last().fill('부산교통공사노조');
 await org.getByRole('textbox',{name:'주소'}).last().fill('www.example.org/busan');
 // 끌어서 순서: 업무의 궤도 NAS(3번째)를 맨 위(조직관리시스템 자리)로.
 const handles=work.locator('[data-ql-handle]');
 await handles.nth(2).dragTo(work.locator('.ql-edit-row').nth(0));
 await expect(work.getByRole('textbox',{name:'이름'}).first()).toHaveValue('궤도 NAS');
 // 키보드로도 순서: 첫 줄(궤도 NAS) 손잡이에서 ↓ 한 번.
 await work.locator('[data-ql-handle]').first().focus();await page.keyboard.press('ArrowDown');
 await expect(work.getByRole('textbox',{name:'이름'}).nth(1)).toHaveValue('궤도 NAS');await expect(work.locator('[data-ql-handle]').nth(1)).toBeFocused();
 await page.keyboard.press('ArrowUp');await expect(work.getByRole('textbox',{name:'이름'}).first()).toHaveValue('궤도 NAS');
 await panel(page).getByRole('button',{name:'저장'}).click();
 await expect(panel(page).getByRole('status').filter({hasText:'저장했어요.'})).toBeVisible();
 expect(writes).toHaveLength(1);
 expect(writes[0]).toEqual([
  {group:'work',name:'궤도 NAS',url:'https://data.railone.kr/'},{group:'work',name:'조직관리시스템',url:'https://www.kptu.net:8000/main'},
  {group:'work',name:'노조 NAS',url:'https://kptu00.quickconnect.to/'},{group:'work',name:'전자결재시스템',url:'https://npasoneq.co.kr/npasoneq/index.html'},
  {group:'work',name:'문자·팩스 발송 시스템',url:'https://letter.dlive.kr/'},{group:'work',name:'망고보드(디자인)',url:'https://www.mangoboard.net/design'},
  {group:'org',name:'공공운수노조',url:'https://www.kptu.net'},{group:'org',name:'궤도협의회',url:'https://railone.kr/'},
  {group:'org',name:'서울교통공사노조',url:'http://www.stlu.kr/'},{group:'org',name:'전국철도노동조합',url:'https://krwu.nodong.net'},
  {group:'org',name:'부산교통공사노조',url:'https://www.example.org/busan'}]);
 // The view shows the saved list right away, and again after closing and reopening (read back from the profile row).
 await expect(group(page,'업무').getByRole('link')).toHaveText(['궤도 NAS','조직관리시스템','노조 NAS','전자결재시스템','문자·팩스 발송 시스템','망고보드(디자인)']);
 await page.keyboard.press('Escape');await expect(panel(page)).toBeHidden();
 await row(page).click();
 await expect(group(page,'담당조직 홈페이지').getByRole('link').last()).toHaveText('부산교통공사노조');
 await expect(group(page,'담당조직 홈페이지').getByRole('link').last()).toHaveAttribute('href','https://www.example.org/busan');
 expect(profile.value).toEqual(writes[0]);
 // Cancel throws away an unsaved change; Esc in edit mode leaves edit mode first.
 await panel(page).getByRole('button',{name:'편집'}).click();
 await group(page,'업무 편집').getByRole('textbox',{name:'이름'}).first().fill('바뀐 이름');
 await panel(page).getByRole('button',{name:'취소'}).click();
 await expect(group(page,'업무').getByRole('link').first()).toHaveText('궤도 NAS');
 await panel(page).getByRole('button',{name:'편집'}).click();await page.keyboard.press('Escape');
 await expect(panel(page).getByRole('button',{name:'편집'})).toBeVisible();await expect(panel(page)).toBeVisible();
 expect(writes).toHaveLength(1);
 expect(errors).toEqual([]);
});

test('PC 1280 편집: javascript:·data:·ftp:·빈 이름은 거절하고 저장하지 않는다; 고치던 중 바깥 누르기는 버리지 않음',async({page})=>{
 const {errors,writes}=await open(page,1280);
 await row(page).click();await panel(page).getByRole('button',{name:'편집'}).click();
 const work=group(page,'업무 편집'),url=work.getByRole('textbox',{name:'주소'}).first(),name=work.getByRole('textbox',{name:'이름'}).first();
 for(const bad of ['javascript:alert(1)','JaVaScRiPt:alert(1)','data:text/html,<b>x</b>','ftp://example.org/','https://exa mple.org','http://','vbscript:x']){
  await url.fill(bad);await panel(page).getByRole('button',{name:'저장'}).click();
  await expect(url).toHaveAttribute('aria-invalid','true');
  await expect(panel(page).locator('.ql-note')).toHaveText('주소는 http:// 또는 https://로 시작하는 웹 주소만 쓸 수 있어요.');
 }
 await url.fill('https://www.kptu.net:8000/main');await name.fill('   ');
 await panel(page).getByRole('button',{name:'저장'}).click();
 await expect(name).toHaveAttribute('aria-invalid','true');await expect(name).toBeFocused();
 expect(writes).toHaveLength(0);
 // Outside press while there is an unsaved change keeps the window and says so.
 await page.mouse.click(1240,860);
 await expect(panel(page)).toBeVisible();await expect(panel(page).locator('.ql-note')).toContainText('[저장] 또는 [취소]');
 await panel(page).getByRole('button',{name:'취소'}).click();
 // The view never renders a javascript: link even if one reached the stored value.
 expect(await panel(page).getByRole('link').evaluateAll(els=>els.every(a=>/^https?:\/\//.test(a.getAttribute('href'))))).toBe(true);
 expect(errors).toEqual([]);
});

test('저장 칸이 아직 없으면(적용 전): 초기 링크를 보여 주고 편집은 "저장 준비 중" 안내만',async({page})=>{
 const {errors,writes}=await open(page,1280,{profile:{column:false,value:null}});
 await row(page).click();
 await expect(group(page,'업무').getByRole('link')).toHaveText(WORK);await expect(group(page,'담당조직 홈페이지').getByRole('link')).toHaveText(ORG);
 await panel(page).getByRole('button',{name:'편집'}).click();
 await expect(panel(page).locator('.ql-note')).toContainText('저장 준비 중');
 await expect(panel(page).getByRole('textbox')).toHaveCount(0);
 expect(writes).toHaveLength(0);
 expect(errors).toEqual([]);
});

test('저장된 목록이 틀린 모양이면 믿지 않고 초기 링크(편집은 막힘)',async({page})=>{
 const {errors}=await open(page,1280,{profile:{column:true,value:[{group:'work',name:'나쁜 링크',url:'javascript:alert(1)'}]}});
 await row(page).click();
 await expect(group(page,'업무').getByRole('link')).toHaveText(WORK);
 await expect(panel(page).getByRole('link',{name:'나쁜 링크'})).toHaveCount(0);
 await panel(page).getByRole('button',{name:'편집'}).click();
 await expect(panel(page).locator('.ql-note')).toContainText('불러오지 못해');
 expect(errors).toEqual([]);
});

test('PC 1280: [쓰기]가 사이드바에서 빠져도 줄은 같은 자리(목록 끝)에 남고 창이 그대로 열린다',async({page})=>{
 const {errors}=await open(page,1280);
 await page.locator('#appView>.app-nav .nav-write').evaluate(el=>el.remove());
 const hwp=await page.locator('#appView>.app-nav [data-view="hwp"]').boundingBox(),r=await row(page).boundingBox();
 expect(r.y).toBeGreaterThanOrEqual(hwp.y+hwp.height-1);expect(r.y).toBeLessThan(hwp.y+hwp.height+12);
 await row(page).click();await expect(panel(page)).toBeVisible();
 const p=await panel(page).boundingBox();expect(Math.abs((p.y+p.height)-(r.y+r.height))).toBeLessThanOrEqual(1.5);
 expect(errors).toEqual([]);
});

test('폰 390·761~1023px에는 줄이 없다(이번엔 PC만)',async({page})=>{
 const {errors}=await open(page,390);
 await expect(row(page)).toBeHidden();
 await page.setViewportSize({width:870,height:900});await expect(row(page)).toBeHidden();
 await page.setViewportSize({width:1024,height:900});await expect(row(page)).toBeVisible();
 expect(errors).toEqual([]);
});
