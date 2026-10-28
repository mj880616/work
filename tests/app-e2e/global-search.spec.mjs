import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// SEARCH-전체검색 S-3·S-4(2026-10-22 요청함 07:55·07:57·08:01). 상단 줄 검색칸 → 결과 창(종류 칩·띠·들여쓴 줄·형광·N건 모두 보기),
// ↑↓·엔터·Esc, 결과 누르면 원본 화면, 상단 줄 ←로 돌아오기. 폰(390)은 메뉴 창 맨 위 검색칸 → 화면 전체 검색(왼쪽 위 ←).
// 서버 검색(app_search_records)은 시험 응답으로 대신한다. 이름은 모두 합성 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const item=(kind,source,id,title,extra={})=>({kind,source,id,title,matched_in:'title',snippet:null,occurred_at:'2026-10-01T00:00:00+00:00',day:null,state:null,project_id:null,project_name:null,organization_id:null,organization_name:null,...extra});
function reply(body){
  const words=String(body.p_query).split(/\s+/).filter(Boolean);
  const all={
    update:{total:5,items:[
      item('update','note','n1','교섭 결과 정리',{matched_in:'title',occurred_at:'2026-10-05T00:00:00+00:00',organization_id:'o',organization_name:'테스트 조직'}),
      item('update','note','n2','지난 메모',{matched_in:'body',snippet:'…이번 교섭 일정은 다음 주…',occurred_at:'2026-10-04T00:00:00+00:00',state:'held'}),
      item('update','note','n3','사진 메모',{matched_in:'attachment',snippet:'교섭 공문 사진',occurred_at:'2026-10-03T00:00:00+00:00'}),
      item('update','note','n4','넷째 메모',{occurred_at:'2026-10-02T00:00:00+00:00'}),
      item('update','note','n5','다섯째 메모',{occurred_at:'2026-10-01T00:00:00+00:00'})]},
    note:{total:1,items:[item('note','note','d1','교섭 노트')]},
    work:{total:1,items:[item('work','note','w1','교섭 준비 한 줄',{day:'2026-10-06',occurred_at:'2026-10-06T00:00:00+09:00'})]},
    // SEARCH ②: 자료는 파일 안 글자(extracted_text)에서 찾으면 matched_in 'attachment'.
    document:{total:1,items:[item('document','document','doc1','교섭 자료',{matched_in:'attachment',snippet:'…3조 교섭 위원 구성은 노사 각 5명…'})]},
    meeting:{total:0,items:[]},
    project:{total:1,items:[item('project','project','p','테스트 프로젝트 교섭',{state:'done'})]},
    organization:{total:0,items:[]},
    milestone:{total:1,items:[item('milestone','milestone','ms','교섭 주요 일정',{project_id:'child',project_name:'자식 프로젝트',occurred_at:'2026-10-07T00:00:00+00:00'})]}
  };
  if(body.p_query.includes('<img'))return {words,groups:Object.keys(all).map(kind=>({kind,total:kind==='note'?1:0,capped:false,offset:0,items:kind==='note'?[item('note','note','x1',body.p_query)]:[]}))};
  if(body.p_query.includes('실패'))return null;
  const kinds=body.p_kind?[body.p_kind]:Object.keys(all);
  return {words,groups:kinds.map(kind=>{const g=all[kind];const off=body.p_kind?body.p_offset||0:0;return {kind,total:g.total,capped:false,offset:off,items:g.items.slice(off,off+body.p_per_kind)}})};
}
async function routeSearch(page,calls){
  await page.route(SB+'/rest/v1/rpc/app_search_records',route=>{
    const body=route.request().postDataJSON();calls.push(body);
    const data=reply(body);
    if(!data)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'22023',message:'SEARCH_QUERY_TOO_SHORT'})});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
}
const top=page=>page.locator('[data-search-slot] input[type="search"]');
const panel=page=>page.locator('#gsPanel');

for(const width of [1280,1440]){
 test(`PC ${width}: typing opens the result window with chips, bands, indented rows, highlights and Google items`,async({page})=>{
  await page.setViewportSize({width,height:860});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const calls=[];
  await openHome(page,{beforeLoad:()=>routeSearch(page,calls)});
  await expect(top(page)).toBeVisible();
  // 홈 본문에는 검색칸이 없다(상단 줄에만).
  await expect(page.locator('#homeView input[type="search"]')).toHaveCount(0);
  await top(page).click();await top(page).fill('교');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.gs-status')).toHaveText(/두 글자/);
  expect(calls.length).toBe(0);
  await top(page).fill('교섭');
  await expect(panel(page).locator('.gs-band')).not.toHaveCount(0);
  expect(calls.at(-1)).toEqual({p_query:'교섭',p_kinds:null,p_per_kind:3,p_offset:0,p_kind:null});
  // 칩: 전체·업데이트·노트·할 일·자료실·사업 보고·일정(+건수). 업무일지 칩 없음, 일기 없음.
  const chips=panel(page).locator('.gs-chips [data-filter-value]');
  await expect(chips).toHaveText([/^전체 \d+$/,'업데이트 5','노트 1',/^할 일 \d+$/,'자료실 1','사업 보고 0',/^일정 \d+$/]);
  await expect(panel(page)).not.toContainText('일기');
  // 업데이트 묶음: 띠(아이콘+굵은 이름+오른쪽 건수), 3줄 + "5건 모두 보기".
  const upd=panel(page).locator('[data-gs-group="update"]');
  await expect(upd.locator('.gs-band .gs-band-name')).toHaveText('업데이트');
  await expect(upd.locator('.gs-band .gs-band-count')).toHaveText('5');
  await expect(upd.locator('.gs-row')).toHaveCount(3);
  await expect(upd.locator('.gs-more')).toHaveText('5건 모두 보기');
  await expect(upd.locator('.gs-row').first().locator('mark')).toHaveText('교섭');
  await expect(upd.locator('.gs-row').nth(0)).toContainText('테스트 조직');
  await expect(upd.locator('.gs-row').nth(1).locator('.gs-state')).toHaveText('보류');
  await expect(upd.locator('.gs-row').nth(1).locator('.gs-row-snippet mark')).toHaveText('교섭');
  await expect(upd.locator('.gs-row').nth(2).locator('.gs-row-snippet')).toContainText('사진 글자');
  // 자료 파일 안 글자에서 찾은 줄: 작은 글자 한 줄(배지 아님) "파일 안 글자에서 찾음 · 앞뒤 한 줄", 찾은 낱말 형광.
  const docSnip=panel(page).locator('[data-gs-group="document"] .gs-row .gs-row-snippet');
  await expect(docSnip).toHaveText('파일 안 글자에서 찾음 · …3조 교섭 위원 구성은 노사 각 5명…');
  await expect(docSnip.locator('.gs-row-where')).toHaveText('파일 안 글자에서 찾음 · ');
  await expect(docSnip.locator('mark')).toHaveText('교섭');
  expect(await docSnip.evaluate(el=>getComputedStyle(el).fontSize)).toBe(await upd.locator('.gs-row').nth(1).locator('.gs-row-snippet').evaluate(el=>getComputedStyle(el).fontSize));
  await expect(upd.locator('.gs-row').nth(2).locator('.gs-row-where')).toHaveText('사진 글자 · ');
  // 한 칸 들여쓰기: 줄 글자가 띠 이름보다 오른쪽.
  const bandX=(await upd.locator('.gs-band .gs-icon').boundingBox()).x,rowX=(await upd.locator('.gs-row .gs-icon').first().boundingBox()).x;
  expect(rowX).toBeGreaterThan(bandX+8);
  // 업무일지·프로젝트는 칩 없이 '전체'에만. 끝난 프로젝트는 '끝남'.
  await expect(panel(page).locator('[data-gs-group="work"] .gs-row')).toHaveCount(1);
  await expect(panel(page).locator('[data-gs-group="project"] .gs-state')).toHaveText('끝남');
  // 일정 = 프로젝트 주요 일정 + (Google 일정 제목·장소로 찾음). 시험 일정 이름에는 '교섭'이 없어 주요 일정만.
  await expect(panel(page).locator('[data-gs-group="schedule"] .gs-row')).toContainText(['교섭 주요 일정']);
  await expect(panel(page).locator('.gs-foot').last()).toContainText('지난 3개월~앞 6개월');
  // 결과 창은 검색칸 바로 아래.
  const [f,p]=await Promise.all([top(page).boundingBox(),panel(page).boundingBox()]);
  expect(p.y).toBeGreaterThanOrEqual(f.y+f.height-1);expect(p.y).toBeLessThan(f.y+f.height+12);
  expect(errors).toEqual([]);
 });
}

test('PC: Google tasks and events from this device are found by title and place',async({page})=>{
 await page.setViewportSize({width:1280,height:860});
 const calls=[];
 await openHome(page,{beforeLoad:()=>routeSearch(page,calls)});
 await top(page).click();await top(page).fill('오늘 항목');
 await expect(panel(page).locator('[data-gs-group="task"] .gs-row')).toHaveCount(1);
 await expect(panel(page).locator('[data-gs-group="task"] .gs-row mark')).toHaveText(['오늘','항목']);
 await top(page).fill('오전 일정');
 await expect(panel(page).locator('[data-gs-group="schedule"] .gs-row').filter({hasText:'오전 일정'})).toHaveCount(1);
});

test('PC: chips switch the kind, ↑↓ skip chips and bands, Enter opens the original, ← on the top line comes back',async({page})=>{
 await page.setViewportSize({width:1280,height:860});
 const calls=[];
 await openHome(page,{beforeLoad:()=>routeSearch(page,calls)});
 await top(page).click();await top(page).fill('교섭');
 await expect(panel(page).locator('[data-gs-group="update"] .gs-row')).toHaveCount(3);
 // 칩 [자료실]: 그 종류만(서버 p_kind).
 await panel(page).locator('.gs-chips [data-filter-value="document"]').click();
 await expect(panel(page).locator('[data-gs-group]')).toHaveCount(1);
 await expect(panel(page).locator('[data-gs-group="document"] .gs-row')).toHaveText(/교섭 자료/);
 expect(calls.at(-1)).toMatchObject({p_kind:'document',p_kinds:null,p_offset:0});
 await panel(page).locator('.gs-chips [data-filter-value="all"]').click();
 await expect(panel(page).locator('[data-gs-group="update"] .gs-row')).toHaveCount(3);
 // ↓ 첫 줄(업데이트 첫 줄), 활성 줄은 aria-activedescendant.
 await top(page).focus();await page.keyboard.press('ArrowDown');
 const active=panel(page).locator('[role="option"].is-active');
 await expect(active).toContainText('교섭 결과 정리');
 await expect(top(page)).toHaveAttribute('aria-activedescendant',await active.getAttribute('id'));
 await page.keyboard.press('ArrowDown');await expect(active).toContainText('지난 메모');
 await page.keyboard.press('ArrowUp');await expect(active).toContainText('교섭 결과 정리');
 // Esc 닫기, 다시 ↓로 열림.
 await page.keyboard.press('Escape');await expect(panel(page)).toBeHidden();
 await expect(top(page)).toHaveValue('교섭');
 await page.keyboard.press('ArrowDown');await expect(panel(page)).toBeVisible();
 // 자료 줄로 가서 엔터 → 자료실 화면.
 const docRow=panel(page).locator('[data-gs-group="document"] .gs-row');
 for(let i=0;i<20&&!(await docRow.evaluate(el=>el.classList.contains('is-active')));i++)await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Enter');
 await expect(page.locator('#libraryView')).toBeVisible();
 await expect(panel(page)).toBeHidden();
 // 상단 줄 ← 로 홈으로 돌아온다.
 await page.locator('[data-trail="back"]').click();
 await expect(page.locator('#homeView')).toBeVisible();
});

test('PC: "N건 모두 보기" opens the result screen with the address, and reload / back restore it',async({page})=>{
 await page.setViewportSize({width:1440,height:860});
 const calls=[];
 await openHome(page,{beforeLoad:()=>routeSearch(page,calls)});
 await top(page).click();await top(page).fill('교섭');
 await panel(page).locator('[data-gs-more="update"]').click();
 await expect(page.locator('#searchView')).toBeVisible();
 await expect(page).toHaveURL(/view=search/);await expect(page).toHaveURL(/kind=update/);
 await expect(panel(page)).toBeHidden();
 const body=page.locator('#searchView .gs-view-body');
 await expect(body.locator('[data-gs-group="update"] .gs-row')).toHaveCount(5);
 await expect(body.locator('.gs-chips [data-filter-value="update"]')).toHaveAttribute('aria-checked','true');
 expect(calls.at(-1)).toMatchObject({p_kind:'update',p_per_kind:20,p_offset:0});
 await expect(page.locator('#searchView .gs-view-title')).toHaveText('‘교섭’ 검색 결과');
 // 결과 화면의 줄을 누르면 원본 화면(바구니 메모), ← 로 결과 화면으로 돌아온다.
 await body.locator('.gs-row').filter({hasText:'넷째 메모'}).click();
 await expect(page.locator('#basketView')).toBeVisible();
 await page.locator('[data-trail="back"]').click();
 await expect(page.locator('#searchView')).toBeVisible();
 await expect(page.locator('#searchView .gs-view-body [data-gs-group="update"] .gs-row')).toHaveCount(5);
 await page.reload();
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
 await expect(page.locator('#searchView')).toBeVisible();
 await expect(page.locator('#searchView .gs-view-body [data-gs-group="update"] .gs-row')).toHaveCount(5);
 await expect(top(page)).toHaveValue('교섭');
});

test('PC: a query that looks like HTML is shown as text, never injected; server errors show plain words',async({page})=>{
 await page.setViewportSize({width:1280,height:860});
 const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 let alerted=false;page.on('dialog',d=>{alerted=true;void d.dismiss()});
 await openHome(page,{beforeLoad:()=>routeSearch(page,calls)});
 await top(page).click();await top(page).fill('<img src=x onerror=alert(1)>');
 const row=panel(page).locator('[data-gs-group="note"] .gs-row');
 await expect(row).toHaveCount(1);
 await expect(row.locator('img')).toHaveCount(0);
 await expect(row.locator('mark')).toHaveText(['<img','src=x','onerror=alert(1)>']);
 await expect(row.locator('.gs-row-title')).toHaveText('<img src=x onerror=alert(1)>');
 await top(page).fill('실패 검색');
 await expect(panel(page).locator('.gs-status')).toHaveText('두 글자 이상 입력하면 찾아요.');
 expect(alerted).toBe(false);expect(errors).toEqual([]);
});

test('Phone 390: the menu sheet has a search field at the top; it opens a full-screen search with ← and no home field',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const calls=[];
 await openHome(page,{beforeLoad:()=>routeSearch(page,calls)});
 await expect(page.locator('#homeView input[type="search"]')).toHaveCount(0);
 await expect(page.locator('[data-search-slot]')).toBeHidden();
 await page.locator('#mobileMenuTab').click();
 const entry=page.locator('#mobileMenu .gs-menu-entry');
 await expect(entry).toBeVisible();
 // 메뉴 창 맨 위(타일들보다 위).
 const [e,t]=await Promise.all([entry.boundingBox(),page.locator('#mobileMenu nav button').first().boundingBox()]);
 expect(e.y).toBeLessThan(t.y);
 await entry.click();
 await expect(page.locator('#mobileMenu')).toBeHidden();
 await expect(page.locator('#searchView')).toBeVisible();
 const input=page.locator('#searchView .gs-view-input input');
 await expect(input).toBeFocused();
 await input.fill('교섭');
 const body=page.locator('#searchView .gs-view-body');
 await expect(body.locator('.gs-chips [data-filter-value]')).toHaveCount(7);
 await expect(body.locator('[data-gs-group="update"] .gs-band')).toBeVisible();
 await expect(body.locator('[data-gs-group="update"] .gs-row')).toHaveCount(3);
 // 가로 스크롤 없음.
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 // 칩 [업데이트] → 그 종류만 5건.
 await body.locator('.gs-chips [data-filter-value="update"]').click();
 await expect(body.locator('[data-gs-group="update"] .gs-row')).toHaveCount(5);
 // 줄 누르기 → 원본(바구니), 뒤로 가기 → 검색 화면, 왼쪽 위 ← → 이전 화면(홈).
 await body.locator('.gs-row').filter({hasText:'다섯째 메모'}).click();
 await expect(page.locator('#basketView')).toBeVisible();
 await page.goBack();
 await expect(page.locator('#searchView')).toBeVisible();
 await page.locator('#searchView .gs-back').click();
 await expect(page.locator('#homeView')).toBeVisible();
});

// LIB-후속1 ② / SEARCH-선택옮기기(1차): 자료실 결과 줄 우클릭 = 작은 메뉴(맨 위 [선택], [열기]). [선택]은 결과 창을 닫고 자료실 화면의 같은 선택 모드로 넘긴다.
// 다른 종류 결과(업데이트 등) 우클릭은 이 메뉴를 열지 않는다.
test('PC 1280: 자료실 결과 우클릭 메뉴 [선택]·[열기], [선택]은 자료실 화면으로',async({page})=>{
  await page.setViewportSize({width:1280,height:860});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const calls=[];
  await openHome(page,{beforeLoad:()=>routeSearch(page,calls)});
  await top(page).click();await top(page).fill('교섭');
  await expect(panel(page).locator('.gs-band')).not.toHaveCount(0);
  await panel(page).locator('[data-gs-group="update"] .gs-row').first().click({button:'right'});
  await expect(page.locator('#gsRowMenu')).toBeHidden();
  await panel(page).locator('[data-gs-group="document"] .gs-row').first().click({button:'right'});
  const menu=page.locator('#gsRowMenu');
  await expect(menu).toBeVisible();await expect(panel(page)).toBeVisible();
  await expect(menu.getByRole('button')).toHaveText(['선택','열기']);
  await menu.getByRole('button',{name:'선택',exact:true}).click();
  await expect(page.locator('#libraryView')).toBeVisible();
  await expect(panel(page)).toBeHidden();
  expect(errors).toEqual([]);
});
