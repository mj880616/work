import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles, phoneFolder } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S62-40 UI-파일검색줄(명진 11/16 07:57 "검색창 폭을 줄여 가지고 두 칸 보기를 위로 올리면은 한 줄 아낄 수 있는데?",
// 시안 #2691 B안, 08:37 선택): [파일] 맨 위 줄 = [찾기][원드라이브][구글 드라이브][이 폰 — 있을 때][두 칸 보기 아이콘] 한 줄.
// S69-38 FILES-보기두칸(명진 11/24): [두 칸 보기] 아이콘 하나 → 자료실과 같은 붙은 [한 칸 | 두 칸](공용 ⑤ ds-seg). 지금 보기 쪽이 aria-pressed, 폰은 그림만. 이름·id는 모두 가짜.
// S70-57(명진 11/26 "검색창은 하나로만"): 화면 안 [찾기] 칸은 없앴다 — 찾기는 맨 위 칸 '파일에서 찾기'(폰 틀 앱 머리 줄, PC 상단 줄). 위 줄 = 출처 단추 · [한 칸 | 두 칸].
const root = page => page.locator('#filesRoot');
const SHOTS = process.env.FILES_SEARCH_ROW_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
test.use({ hasTouch: true }); // 폰 폴더 목록은 두 손가락 벌리기로 연다(phoneFolder).
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.5.0';

// 위 줄: 보이는 출처 단추·[두 칸 보기]가 모두 같은 줄(세로로 겹침)이고 가로로 넘치지 않는가. 화면 안 검색 칸은 없다.
const findPlace = page => page.locator((page.viewportSize()?.width || 1280) > 760 ? '#gsTopInput' : '#gsScreenInput');
async function topRow(page) {
  return page.evaluate(() => {
    const r = el => el.getBoundingClientRect();
    // S71-28 FILES-머리한줄: 폰(600px 미만)은 출처·보기 단추가 앱 머리 줄에 있다 — 그 줄(없으면 화면 위쪽 줄)에서 잰다.
    const seg = document.querySelector('[data-fx-view-seg]'), top = seg.closest('.mobile-shell-header') || document.querySelector('#filesRoot .fx-top');
    const t = r(seg), two = seg.querySelector('[data-fx-two]'), one = seg.querySelector('[data-fx-one]');
    const chips = [...document.querySelectorAll('[data-fx-srcs] [data-src-chip]')].filter(b => !b.hidden && b.offsetParent).map(r);
    const same = b => b.top < t.bottom && t.top < b.bottom;
    return {
      chips: chips.length, sameLine: chips.every(same), twoLast: chips.every(c => c.right <= t.left), searchIn: document.querySelectorAll('#filesRoot input[type="search"]').length,
      twoW: Math.round(t.width), twoH: Math.round(t.height),
      label: two.getAttribute('aria-label'), oneLabel: one.getAttribute('aria-label'), text: [...seg.querySelectorAll('.fx-seg-t')].filter(x => x.offsetParent).map(x => x.textContent.trim()).join('|'),
      icon: !!two.querySelector('svg') && !!one.querySelector('svg'), cls: seg.className, joined: Math.abs(r(one).right - r(two).left) <= 3 && Math.abs(r(one).top - r(two).top) < 2,
      inRow: t.right <= r(top).right + 0.5, overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

test('폰 412: [원드라이브][구글 드라이브][한 칸|두 칸] 한 줄 · 찾기는 앱 머리 줄 · 붙은 그림 단추 · 켜면 aria-pressed · 키보드로도', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  const two = page.locator('button[data-fx-two]');
  await expect(two).toBeVisible();
  await expect(two).toHaveAttribute('aria-pressed', 'false');
  const m = await topRow(page);
  expect(m.chips).toBe(2);
  expect(m.sameLine).toBe(true);
  expect(m.twoLast).toBe(true);
  expect(m.inRow).toBe(true);
  expect(m.label).toBe('두 칸 보기');
  expect(m.oneLabel).toBe('한 칸 보기');
  expect(m.text).toBe(''); // 폰은 그림만
  expect(m.icon).toBe(true);
  expect(m.cls).toContain('ds-seg');
  expect(m.joined).toBe(true);
  expect(m.twoH).toBeLessThanOrEqual(44);
  expect(m.searchIn).toBe(0);
  await expect(findPlace(page)).toHaveAttribute('placeholder', '파일에서 찾기');
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
  await expect(page.locator('button[data-fx-one]')).toHaveAttribute('aria-pressed', 'false');
  // 눌린 [두 칸]을 다시 눌러도 그대로(붙은 단추는 고르기만).
  await two.click();
  await expect(root(page).locator('[data-fx-pane-i="1"]')).toHaveCount(1);
  // 키보드: [한 칸]에 초점을 옮겨 Enter로 끈다.
  await page.locator('button[data-fx-one]').focus();
  await page.keyboard.press('Enter');
  await expect(root(page).locator('[data-fx-pane-i="1"]')).toHaveCount(0);
  await expect(two).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('button[data-fx-one]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test.describe('폰 앱 412(이 폰 단추가 있을 때)', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });
  test('[원드라이브][구글 드라이브][이 폰][두 칸 보기] 한 줄', async ({ page }) => {
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
    await expect(page.locator('[data-fx-src="ph"]')).toBeVisible();
    const m = await topRow(page);
    expect(m.chips).toBe(3);
    expect(m.sameLine).toBe(true);
    expect(m.twoLast).toBe(true);
    expect(m.inRow).toBe(true);
    expect(m.searchIn).toBe(0);
    expect(m.overflow).toBeLessThanOrEqual(0);
    await shot(page, 'phone-app-412');
    expect(errors).toEqual([]);
  });
});

test('PC 1280: 맨 위 줄 한 줄 그대로 · 붙은 [한 칸 | 두 칸] 켜고 끄기(aria-pressed)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 1280);
  await openFiles(page, 1280);
  const two = page.locator('button[data-fx-two]');
  await expect(two).toHaveAttribute('aria-pressed', 'false');
  const m = await topRow(page);
  expect(m.sameLine).toBe(true);
  expect(m.searchIn).toBe(0);
  await expect(findPlace(page)).toHaveAttribute('placeholder', '파일에서 찾기');
  expect(m.label).toBe('두 칸 보기');
  expect(m.icon).toBe(true);
  expect(m.text).toBe('한 칸|두 칸'); // PC는 자료실처럼 그림 + 글자
  expect(m.joined).toBe(true);
  expect(m.overflow).toBeLessThanOrEqual(0);
  await shot(page, 'pc-1280');
  await two.click();
  await expect(root(page).locator('[data-fx-pane-i="1"]')).toHaveCount(1);
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  expect((await topRow(page)).sameLine).toBe(true);
  await shot(page, 'pc-1280-two');
  await page.locator('button[data-fx-one]').click();
  await expect(two).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
