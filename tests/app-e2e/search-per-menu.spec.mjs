import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {screenFind} from './helpers/screen-find.mjs';
import CASES from './helpers/menu-find/index.mjs';
// S70-57 UI-검색창하나로 마무리(사용자 11/26 06:12 폴드 펼침 사진 10장 "전체 검색은 홈에만 있으면 됨 / 메뉴별 검색창은 그 메뉴에서 찾기로 통일 / 검색창은 하나로만"):
// 화면 표 하나(helpers/menu-find/index.mjs — 메뉴 화면마다 한 줄)로 모든 메뉴 화면을 같은 규칙으로 본다.
//  ① 홈만 '전체 검색' ② 다른 메뉴 화면은 맨 위 칸 하나 = '<메뉴>에서 찾기'(보이는 검색 칸이 정확히 1개, '전체 검색' 없음)
//  ③ 그 칸에 치면 그 화면 목록이 걸러진다. 폭: PC 1280 · 폴드 펼침 884(PC 틀) · 폴드 펼침 폰 틀 690 · 폰 390. 서버는 흉내, 이름은 지어낸 것.
const WIDTHS=[1280,884,690,390];
// 지금 보이는 검색 칸(작은 창 안 찾기는 뺀다 — 창 안의 찾기는 그 창 몫).
const visibleFinds=page=>page.evaluate(()=>{
  const shown=e=>{const r=e.getBoundingClientRect();if(!(r.width>0&&r.height>0))return false;const s=getComputedStyle(e);return s.visibility!=='hidden'&&!e.closest('[hidden],[inert],[aria-hidden="true"],.modal,[role="dialog"],dialog')};
  return [...document.querySelectorAll('input')].filter(shown).filter(i=>i.type==='search'||/찾기|검색/.test((i.placeholder||'')+(i.getAttribute('aria-label')||''))).map(i=>i.placeholder||i.getAttribute('aria-label')||i.id);
});
const allSearchEntries=page=>page.evaluate(()=>{
  const shown=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden],[inert],[aria-hidden="true"]')};
  return [...document.querySelectorAll('button,a,input')].filter(shown).filter(e=>/전체 검색/.test((e.placeholder||'')+(e.getAttribute('aria-label')||'')+(e.tagName==='INPUT'?'':e.textContent))).length;
});
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);

for(const width of WIDTHS)test.describe(`메뉴마다 검색 칸 하나 ${width}`,()=>{
  test('홈: 전체 검색 하나',async({page})=>{
    await page.setViewportSize({width,height:900});
    await openHome(page);
    if(width>760){
      await expect(page.locator('#gsTopInput')).toBeVisible();
      await expect(page.locator('#gsTopInput')).toHaveAttribute('placeholder','전체 검색');
      expect(await visibleFinds(page)).toEqual(['전체 검색']);
    }else{
      // S71-41 HOME-머리한줄: 폰 틀 홈은 입력 칸 줄 없이 날짜 줄 끝 돋보기 '전체 검색' 하나 → 누르면 전체 검색 화면 머리 줄 칸 하나(S71-07).
      const entry=page.locator('#homeView [data-journal-find]');
      await expect(entry).toBeVisible();await expect(entry).toHaveAccessibleName('전체 검색');
      expect(await visibleFinds(page)).toEqual([]);
      await entry.click();await expect(page.locator('#searchView')).toBeVisible();
      await expect(page.locator('#gsHeadInput')).toHaveAttribute('placeholder','전체 검색');
      expect(await visibleFinds(page)).toEqual(['전체 검색']);
    }
    expect(await noOverflow(page)).toBeLessThanOrEqual(1);
  });
  for(const c of CASES)test(`${c.name}: '${c.label}' 하나 · 치면 목록이 걸러짐`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await c.open(page,width);
    const rows=c.rows(page),settle=async()=>{if(c.settle)await c.settle(page)};
    await settle();await expect(rows).toHaveCount(c.before);
    const find=await screenFind(page);
    await expect(find).toHaveAttribute('placeholder',c.label);
    await expect(find).toBeVisible();
    expect(await visibleFinds(page)).toEqual([c.label]);
    expect(await allSearchEntries(page)).toBe(0);
    await find.fill(c.query);
    await expect.poll(async()=>{await settle();return rows.count()}).toBe(c.after);
    if(c.match)await expect(rows.first()).toContainText(c.match);
    await find.fill('');
    await expect.poll(async()=>{await settle();return rows.count()}).toBe(c.before);
    expect(await noOverflow(page)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
