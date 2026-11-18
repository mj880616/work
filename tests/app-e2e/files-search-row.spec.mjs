import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles, phoneFolder } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S62-40 UI-파일검색줄(명진 11/16 07:57 "검색창 폭을 줄여 가지고 두 칸 보기를 위로 올리면은 한 줄 아낄 수 있는데?",
// 시안 #2691 B안, 08:37 선택): [파일] 맨 위 줄 = [찾기][원드라이브][구글 드라이브][이 폰 — 있을 때][두 칸 보기 아이콘] 한 줄.
// [두 칸 보기]는 공용 ⑥ 아이콘 단추(button.icon-btn), 이름은 늘 '두 칸 보기', 켜짐은 aria-pressed. 이름·id는 모두 가짜.
const root = page => page.locator('#filesRoot');
const SHOTS = process.env.FILES_SEARCH_ROW_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
test.use({ hasTouch: true }); // 폰 폴더 목록은 두 손가락 벌리기로 연다(phoneFolder).
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.5.0';

// 맨 위 줄: 찾기 칸·보이는 출처 단추·[두 칸 보기]가 모두 같은 줄(세로로 겹침)이고 가로로 넘치지 않는가.
async function topRow(page) {
  return page.evaluate(() => {
    const r = el => el.getBoundingClientRect();
    const top = document.querySelector('#filesRoot .fx-top');
    const search = r(top.querySelector('[data-fx-search]')), two = top.querySelector('[data-fx-two]'), t = r(two);
    const chips = [...top.querySelectorAll('[data-fx-srcs] [data-src-chip]')].filter(b => !b.hidden && b.offsetParent).map(r);
    const same = b => b.top < search.bottom && search.top < b.bottom;
    return {
      chips: chips.length, sameLine: same(t) && chips.every(same), twoLast: chips.every(c => c.right <= t.left),
      searchW: Math.round(search.width), twoW: Math.round(t.width), twoH: Math.round(t.height),
      label: two.getAttribute('aria-label'), text: two.textContent.trim(), icon: !!two.querySelector('svg'), cls: two.className,
      inRow: t.right <= r(top).right + 0.5, overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

test('폰 412: [찾기][원드라이브][구글 드라이브][두 칸 보기] 한 줄 · 아이콘 단추 · 켜면 aria-pressed · 키보드로도', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  const two = root(page).locator('[data-fx-two]');
  await expect(two).toBeVisible();
  await expect(two).toHaveAttribute('aria-pressed', 'false');
  const m = await topRow(page);
  expect(m.chips).toBe(2);
  expect(m.sameLine).toBe(true);
  expect(m.twoLast).toBe(true);
  expect(m.inRow).toBe(true);
  expect(m.label).toBe('두 칸 보기');
  expect(m.text).toBe('');
  expect(m.icon).toBe(true);
  expect(m.cls).toContain('icon-btn');
  expect([m.twoW, m.twoH]).toEqual([28, 28]);
  expect(m.searchW).toBeGreaterThanOrEqual(200);
  expect(m.overflow).toBeLessThanOrEqual(0);
  await shot(page, 'phone-412');
  // 폴더 목록 화면에서도 맨 위 줄은 그대로 한 줄(위치 길·정렬은 그 아래 줄).
  await phoneFolder(page, 'od');
  const l = await topRow(page);
  expect(l.sameLine).toBe(true);
  expect(l.overflow).toBeLessThanOrEqual(0);
  // 누르면 두 칸(위·아래) · 켜짐, 다시 누르면 한 칸. 이름은 그대로.
  await two.click();
  await expect(root(page).locator('[data-fx-pane-i="1"]')).toHaveCount(1);
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  await expect(two).toHaveAttribute('aria-label', '두 칸 보기');
  expect((await topRow(page)).sameLine).toBe(true);
  await shot(page, 'phone-412-two');
  // 키보드: 초점을 옮겨 Enter로 끈다.
  await two.focus();
  await page.keyboard.press('Enter');
  await expect(root(page).locator('[data-fx-pane-i="1"]')).toHaveCount(0);
  await expect(two).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test.describe('폰 앱 412(이 폰 단추가 있을 때)', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });
  test('[찾기][원드라이브][구글 드라이브][이 폰][두 칸 보기] 한 줄', async ({ page }) => {
    test.setTimeout(90000);
    const { errors } = await start(page, 412);
    // 앱 다리 흉내(허락 전: 이 폰 단추는 보이되 꺼짐). files-phone.spec.mjs와 같은 모양.
    await page.addInitScript(() => {
      const listeners = [];
      window.KPTUAppShell = {
        postMessage(m) { if (m === 'pfiles:hello') setTimeout(() => listeners.forEach(fn => fn({ data: `pfiles:state:${JSON.stringify({ v: 1, can: true, all: false })}` })), 0); },
        addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
      };
    });
    await installViewPrefsServer(page);
    await page.reload();
    await openFiles(page, 412);
    await expect(root(page).locator('[data-fx-src="ph"]')).toBeVisible();
    const m = await topRow(page);
    expect(m.chips).toBe(3);
    expect(m.sameLine).toBe(true);
    expect(m.twoLast).toBe(true);
    expect(m.inRow).toBe(true);
    expect(m.searchW).toBeGreaterThanOrEqual(160);
    expect(m.overflow).toBeLessThanOrEqual(0);
    await shot(page, 'phone-app-412');
    expect(errors).toEqual([]);
  });
});

test('PC 1280: 맨 위 줄 한 줄 그대로 · [두 칸 보기] 아이콘 켜고 끄기(aria-pressed)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 1280);
  await openFiles(page, 1280);
  const two = root(page).locator('[data-fx-two]');
  await expect(two).toHaveAttribute('aria-pressed', 'false');
  const m = await topRow(page);
  expect(m.sameLine).toBe(true);
  expect(m.label).toBe('두 칸 보기');
  expect(m.icon).toBe(true);
  expect(m.overflow).toBeLessThanOrEqual(0);
  await shot(page, 'pc-1280');
  await two.click();
  await expect(root(page).locator('[data-fx-pane-i="1"]')).toHaveCount(1);
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  expect((await topRow(page)).sameLine).toBe(true);
  await shot(page, 'pc-1280-two');
  await two.click();
  await expect(two).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
