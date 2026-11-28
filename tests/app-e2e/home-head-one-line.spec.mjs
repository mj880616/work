import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S71-41 HOME-머리한줄(사용자 요청 11/26).
// 폰 틀(~760px) 홈: 따로 된 '전체 검색' 입력 칸 줄이 없고(머리 줄 자체가 그려지지 않음), 첫 줄 = [아이콘] 날짜 · [하루|주간 보고] · 찾기(돋보기) 한 줄.
// 돋보기를 누르면 그 첫 줄 자리에 전체 검색 칸이 열리고(전체 검색 화면 머리 줄 — S71-07 '누른 자리 그대로'), 결과는 아래.
// 결과를 누르면 원문으로 가는 것은 기존 시험(global-search·global-search-jump·source-open-back-rest — 입구를 이 돋보기로 바꿈)이 지킨다.
// 날짜가 한 줄에 다 안 들어가면 '11월 26일 (목)'처럼 짧게. PC 틀(761px~)은 맨 위 줄 '전체 검색' 칸 그대로이고 돋보기는 없다.
// 가짜 서버·가짜 자료만 쓴다(openHome).
const box = loc => loc.evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom, mid: b.y + b.height / 2 }; });
// 첫 줄(날짜 제목과 같은 높이)에 있는 것들.
const firstRow = page => page.evaluate(() => {
  const head = document.querySelector('#homeView .journal-head'), b = e => e?.getBoundingClientRect();
  const parts = { mark: head.querySelector('.head-mark'), title: head.querySelector('[data-journal-title]'), sw: head.querySelector('.journal-mode-switch'), find: head.querySelector('[data-journal-find]') };
  const out = {};
  for (const [k, e] of Object.entries(parts)) { const r = b(e); out[k] = r && r.width > 0 ? { x: r.x, right: r.right, mid: r.y + r.height / 2, top: r.top, bottom: r.bottom } : null; }
  out.headRight = b(head).right;
  const t = parts.title; out.cut = t.scrollWidth > t.clientWidth + 1; out.text = t.textContent;
  out.docW = document.documentElement.scrollWidth; out.vw = innerWidth;
  return out;
});
for (const width of [344, 390, 690]) test(`폰 틀 ${width}: 홈 첫 줄 한 줄 = 날짜 · [하루|주간 보고] · 돋보기, 따로 된 검색 줄 없음`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  const find = page.locator('#homeView [data-journal-find]');
  await expect(find).toBeVisible();
  await expect(find).toHaveAccessibleName('전체 검색');
  // 따로 된 '전체 검색' 칸 줄 없음: 머리 줄이 그려지지 않고, 보이는 검색 입력 칸이 없다.
  await expect(page.locator('#appView > .mobile-shell-header')).toBeHidden();
  await expect(page.locator('#gsHeadInput')).toBeHidden();
  expect(await page.locator('input[type="search"]:visible').count()).toBe(0);
  for (const mode of ['day', 'week']) {
    await page.locator(`button[data-journal-mode="${mode}"]`).click();
    await expect(page.locator(`button[data-journal-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
    const r = await firstRow(page);
    // 한 줄: 아이콘·날짜·[하루|주간 보고]·돋보기 가운데 높이가 같고, 돋보기가 오른쪽 끝, 순서대로 겹치지 않음.
    for (const k of ['mark', 'sw', 'find']) expect(Math.abs(r[k].mid - r.title.mid), `${mode} ${k}`).toBeLessThanOrEqual(2);
    expect(Math.abs(r.find.right - r.headRight), mode).toBeLessThanOrEqual(1);
    expect(r.title.right, mode).toBeLessThanOrEqual(r.sw.x + 1);
    expect(r.sw.right, mode).toBeLessThanOrEqual(r.find.x + 1);
    // 첫 줄 높이는 한 줄(44px 안쪽).
    expect(Math.max(r.sw.bottom, r.find.bottom, r.title.bottom) - Math.min(r.sw.top, r.find.top, r.title.top), mode).toBeLessThanOrEqual(44);
    // 날짜는 다 보이거나(짧은 꼴로) 잘리지 않는다 — 390 이상은 잘리지 않음.
    if (width >= 390) expect(r.cut, `${mode} ${r.text}`).toBe(false);
    expect(r.docW, mode).toBeLessThanOrEqual(r.vw);
  }
  expect(errors).toEqual([]);
});

test('폰 390: 돋보기를 누르면 그 줄 자리에서 전체 검색 입력, 결과는 아래, 뒤로 = 홈', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  const find = page.locator('#homeView [data-journal-find]');
  const before = await box(find);
  await find.click();
  const input = page.locator('#gsHeadInput');
  await expect(page.locator('#searchView')).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('placeholder', '전체 검색');
  // 화면 안 두 번째 칸 없음. 칸은 돋보기 줄(가운데 높이 같음, 오른쪽 끝 같음).
  await expect(page.locator('#searchView input')).toHaveCount(0);
  const opened = await box(input);
  expect(Math.abs(opened.mid - before.mid)).toBeLessThanOrEqual(2);
  expect(Math.abs(opened.right - before.right)).toBeLessThanOrEqual(1);
  await input.pressSequentially('가상', { delay: 20 });
  const body = page.locator('#searchView .gs-view-body');
  await expect(body).toBeVisible();
  await expect(body).not.toBeEmpty();
  // 결과·안내는 칸 아래.
  expect((await box(body)).y).toBeGreaterThanOrEqual(opened.bottom);
  expect(await box(input)).toEqual(opened);
  await page.goBack();
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(find).toBeVisible();
  await expect(input).toBeHidden();
  await expect(input).toHaveValue('');
  expect(errors).toEqual([]);
});

test('PC 1280: 맨 위 줄 \'전체 검색\' 칸 그대로, 날짜 줄은 한 줄이고 돋보기 없음', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page);
  await expect(page.locator('#gsTopInput')).toBeVisible();
  await expect(page.locator('#gsTopInput')).toHaveAttribute('placeholder', '전체 검색');
  await expect(page.locator('#homeView [data-journal-find]')).toBeHidden();
  const head = await box(page.locator('#homeView .journal-head'));
  expect(head.h).toBeLessThanOrEqual(48);
});
