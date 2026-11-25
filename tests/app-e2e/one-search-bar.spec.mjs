import {test,expect} from '@playwright/test';
import {start} from './helpers/news-server.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {bootLibrary,libDoc} from './helpers/library-folder-server.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {screenFind,screenTools} from './helpers/screen-find.mjs';
// S70-54 UI-검색창하나로(명진 11/25 21:28~21:30 폴드 펼침 사진 "검색창 두개인데 걍 맨 위 검색창 활용하면 안되나", 설계 docs/design/one-search-bar.md):
// 노트·읽을 거리·자료실·조직 관리에서
//  ① 화면 안 검색 칸 줄이 없다(자리째) ② 맨 위 칸에 치면 그 화면 목록이 걸러진다(안내글 '○○에서 찾기')
//  ③ 걸러진 목록 아래 끝 '전체에서 「…」 찾기 →' 줄로 전체 검색 화면이 같은 낱말로 열린다 ④ 읽을 거리 [매체 ▾]가 맨 위 줄에서 열리고 고르면 목록이 바뀐다.
// 폭: 폴드 펼침 884(PC 틀)·PC 1280·폰 390(머리 줄 돋보기 → 칸). 서버는 흉내, 이름은 모두 지어낸 것.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const WIDTHS=[884,1280,390];
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
async function goAll(page,q){
  // 걸러진 목록 아래 끝 한 줄(목록을 덮는 펼침 창이 아님).
  const row=page.locator('#gsAllLine');
  await expect(row).toBeVisible();await expect(row).toHaveText(`전체에서 「${q}」 찾기 →`);
  await row.click();
  await expect(page.locator('#searchView')).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('q')).toBe(q);
  await expect(page.locator(page.viewportSize().width>760?'#gsTopInput':'#gsViewInput')).toHaveValue(q);
}

for(const width of WIDTHS)test.describe(`검색 칸 하나 ${width}`,()=>{
  test('읽을 거리: 찾기 줄 없음 · 맨 위 칸으로 거르기 · 전체에서 찾기 · 맨 위 줄 [매체 ▾]',async({page})=>{
    test.setTimeout(90000);
    const {errors}=await start(page,width);
    await page.evaluate(()=>window.KPTURouter.go('outside'));
    const root=page.locator('#outsideRoot');
    await expect(root.locator('[data-nw-key="news:c1"]')).toBeVisible();
    // ① 화면 안 찾기 줄·칸이 없다.
    await expect(page.locator('#outsideView [data-nw-top], #outsideView input[type="search"]')).toHaveCount(0);
    // ④ [매체 ▾]·⋯는 맨 위 줄.
    const media=screenTools(page).locator('[data-nw-media]');
    await expect(media).toBeVisible();await expect(media).toHaveText('매체: 전체 ▾');
    await expect(screenTools(page).locator('[data-os-more]')).toBeVisible();
    // ② 맨 위 칸 = '읽을 거리에서 찾기', 치면 목록이 제목으로 걸러진다.
    const find=await screenFind(page);
    await expect(find).toHaveAttribute('placeholder','읽을 거리에서 찾기');
    await find.fill('키워드');
    await expect(root.locator('[data-nw-key="news:c1"]')).toHaveCount(0);await expect(root.locator('[data-nw-key="news:k1"]')).toBeVisible();
    if(width===884)await page.screenshot({path:test.info().outputPath('reading-find-884.png')});
    // ③ 전체에서 찾기.
    await goAll(page,'키워드');
    // 돌아오면 읽을 거리 찾기 글자는 그대로(그 화면 메모리), 맨 위 칸도 다시 그 찾기.
    await page.goBack();
    await expect(page.locator('#outsideView')).toBeVisible();
    const back=await screenFind(page);await expect(back).toHaveAttribute('placeholder','읽을 거리에서 찾기');await expect(back).toHaveValue('키워드');
    await back.fill('');await page.keyboard.press('Escape');
    await expect(root.locator('[data-nw-key="news:c1"]')).toBeVisible();
    // ④ 맨 위 줄 [매체 ▾] → 고르기 창 → 매체 하나 → 목록이 그 매체만.
    await media.click();
    const picker=page.locator('#nwMediaPicker');await expect(picker).toBeVisible();
    await picker.getByRole('button',{name:'가짜노동신문',exact:true}).click();
    await expect(media).toHaveText('매체: 가짜노동신문 ▾');
    await expect(picker).toBeHidden();await expect(media).toHaveAttribute('aria-expanded','false');
    expect(await noOverflow(page)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('노트: 목록 머리 찾기 칸 없음 · 맨 위 칸으로 거르기 · ⋯는 맨 위 줄 · 전체에서 찾기',async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const at='2026-10-05T01:00:00Z';
    const note=(id,title,raw_text)=>({id,workspace_id:'w',kind:'note',title,raw_text,occurred_at:at,created_at:at,updated_at:at,archived_at:null,metadata:{}});
    const rows=[note('n1','가상 임금 정리','기본급 인상'),note('n2','가상 회의 메모','다음 회의 준비')];
    await openHome(page);
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{const q=new URL(r.request().url()).searchParams;
      if(r.request().method()!=='GET')return r.fallback();if(q.get('metadata'))return r.fulfill({json:[]});
      return r.fulfill({json:rows.filter(x=>!q.get('kind')||'eq.'+x.kind===q.get('kind'))})});
    await chooseBasketKind(page,'note');
    const list=page.locator('#noteRows [data-note-row]');
    await expect(list).toHaveCount(2);
    await expect(page.locator('#basketView [data-note-search], #basketView .note-search, #basketView [data-note-list] input[type="search"]')).toHaveCount(0);
    await expect(page.locator('#basketView [data-note-folder-more]')).toHaveCount(0);
    const more=screenTools(page).locator('[data-note-folder-more]');await expect(more).toBeVisible();
    await more.click();await expect(page.locator('#noteDocMenu')).toBeVisible();await page.keyboard.press('Escape');
    const find=await screenFind(page);
    await expect(find).toHaveAttribute('placeholder','노트에서 찾기');
    await find.fill('기본급');
    await expect(list).toHaveCount(1);await expect(list).toContainText('가상 임금 정리');
    await goAll(page,'기본급');
    expect(await noOverflow(page)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('자료실: 찾기 칸·⌕ 없음 · 맨 위 칸으로 거르기 · [+]·⋯ 맨 위 줄 · 전체에서 찾기',async({page})=>{
    test.setTimeout(90000);
    const {errors}=await bootLibrary(page,width,{docs:[libDoc('d1',null,{category:'정책',title:'가상 요구안'}),libDoc('d2',null,{category:'투쟁',title:'가상 결의문'})]});
    const rows=page.locator('#documentList [data-lu-document]');
    await page.locator('#documentList details[data-lu-node]').evaluateAll(xs=>xs.forEach(x=>x.open=true));
    await expect(rows).toHaveCount(2);
    await expect(page.locator('#documentSearch,#librarySearchOpen,#librarySearchClose,#libraryView input[type="search"]')).toHaveCount(0);
    await expect(screenTools(page).locator('#newDocumentBtn')).toBeVisible();await expect(screenTools(page).locator('#libraryTopMenuBtn')).toBeVisible();
    const find=await screenFind(page);
    await expect(find).toHaveAttribute('placeholder','자료실에서 찾기');
    await find.fill('결의');
    await page.locator('#documentList details[data-lu-node]').evaluateAll(xs=>xs.forEach(x=>x.open=true));
    await expect(rows).toHaveCount(1);await expect(page.locator('#documentList [data-lu-document="d2"]')).toBeAttached();
    await goAll(page,'결의');
    expect(await noOverflow(page)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('조직 관리: 머리 줄 없음 · 맨 위 칸으로 담당조직 이름 거르기 · [+ 담당조직]·⋯ 맨 위 줄 · 전체에서 찾기',async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const owner='home-test',stamp='2026-09-15T01:00:00Z';
    const orgs=[{id:'oa',workspace_id:'w',name:'가상 철도 지부',active:true,created_by:owner,updated_at:stamp},{id:'ob',workspace_id:'w',name:'가상 병원 지부',active:true,created_by:owner,updated_at:stamp}];
    await openHome(page,{features:[]});
    await page.route(SB+'/rest/v1/app_suborganizations?**',r=>{const id=new URL(r.request().url()).searchParams.get('id');return r.fulfill({json:id?orgs.filter(o=>'eq.'+o.id===id):orgs})});
    await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>{const q=new URL(r.request().url()).searchParams;return r.fulfill({json:q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner}))})});
    await page.evaluate(()=>window.KPTURouter.go('team'));
    const cards=page.locator('#soOrganizationList [data-so-org]');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('#soTeamHead')).toHaveCount(0);
    await expect(screenTools(page).locator('#soAddOrg')).toBeVisible();await expect(screenTools(page).locator('#soTeamMore')).toBeVisible();
    const find=await screenFind(page);
    await expect(find).toHaveAttribute('placeholder','조직 관리에서 찾기');
    await find.fill('철도');
    await expect(cards).toHaveCount(1);await expect(cards).toContainText('가상 철도 지부');
    await find.fill('없는이름');
    await expect(cards).toHaveCount(0);await expect(page.locator('#soOrganizationList [data-wait-empty]')).toHaveText('맞는 담당조직 없음');
    await find.fill('지부');
    await goAll(page,'지부');
    expect(await noOverflow(page)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});

// 화면 찾기가 없는 화면(홈)은 지금처럼 전체 검색 — 안내글 '전체 검색', 결과 창.
test('홈 1280: 맨 위 칸은 전체 검색 그대로',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await openHome(page);
  await expect(page.locator('#gsTopInput')).toHaveAttribute('placeholder','전체 검색');
  await expect(page.locator('#gsTopInput')).not.toHaveAttribute('data-screen-find',/.*/);
  await expect(page.locator('.sf-tools:not([hidden])')).toHaveCount(0);
});
