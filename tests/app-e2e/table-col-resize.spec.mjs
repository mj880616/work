import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { screenFind } from './helpers/screen-find.mjs';
// S51-33 UI-칸너비끌기(요청함 11/06 22:33 "이거 이름 위치 바뀐 날 이런거 드래그해서 너비 조절 가능하게", 시안 docs/design/mockups/table-column-resize.html):
// 머리줄 칸 사이 가는 세로 금을 끌면 금 왼쪽 칸 너비가 바뀐다(이름 칸 포함). 끄는 동안 표 아래까지 안내선, 금 두 번 누르기 = 글자 길이에 맞춤.
// 너비는 서버(view_prefs.col_widths.files)에만, 폰·폴드 펼침·PC 따로(_p·_f·꼬리 없음). 칸 합이 넓으면 목록만 옆으로 밀어 본다. 이름은 모두 가짜.
const root = page => page.locator('#filesRoot');
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const LONG = '가짜 아주 긴 동영상 파일 이름 — 현장 기록 전체 촬영본 (1).mp4';
const addLong = server => { const base = server.items.find(i => i.item_id === 'OD!11'); server.items.push({ ...base, item_id: 'OD!99', name: LONG, mime: 'video/mp4', size_bytes: 9_000_000_000 }); };
const head = page => root(page).locator('[data-fx-list] .fx-head').first();
const nameCell = page => head(page).locator('[data-col-grip="name"]').locator('xpath=..');
// 이름 칸(그리드 둘째 칸) 너비: 머리 칸은 아이콘 칸까지 덮으므로 줄의 .fx-nm으로 잰다.
const nameWidth = page => root(page).locator('[data-fx-list] .fx-row .fx-nm').first().evaluate(el => el.getBoundingClientRect().width);
const openBig = async (page, width) => {
  await openFiles(page, width);
  await root(page).locator('[data-fx-tree] [data-fx-shelf="big"]').click();
  await expect(head(page).locator('[data-col-grip]')).toHaveCount(4); // 이름·위치·바뀐 날·크기 오른쪽 금(종류는 표 끝)
  await settle(page);
};
const drag = async (page, grip, dx, {during} = {}) => {
  const g = await grip.boundingBox(), y = g.y + g.height / 2, x = g.x + g.width / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 });
  if (during) await during();
  await page.mouse.up(); await settle(page);
};

test('폴드 884: 큰 파일 표 이름 칸을 끌어 넓히면 이름이 다 보이고, 안내선이 표 아래까지, 다시 열어도 그대로(폴드 값만)', async ({ page }) => {
  test.setTimeout(90000);
  const prefs = await installViewPrefsServer(page);
  const { errors, server } = await start(page, 884);
  addLong(server);
  await openBig(page, 884);
  const stored = () => prefs.value?.col_widths?.files ?? null;
  // ① 금은 늘 보이는 가는 선(2px), 잡는 범위는 손가락 크기(24px 이상).
  const grip = head(page).locator('[data-col-grip="name"]');
  const look = await grip.evaluate(el => ({ w: el.getBoundingClientRect().width, line: getComputedStyle(el, '::before').width, bg: getComputedStyle(el, '::before').backgroundColor }));
  expect(look.w).toBeGreaterThanOrEqual(24); expect(look.line).toBe('2px'); expect(look.bg).not.toBe('rgba(0, 0, 0, 0)');
  const longRow = root(page).locator('[data-fx-list] .fx-row', { hasText: LONG });
  const cut = () => longRow.locator('.fx-name').evaluate(el => el.scrollWidth - el.clientWidth);
  expect(await cut()).toBeGreaterThan(0); // 처음엔 잘림('…')
  const before = await nameWidth(page);
  // ② 끄는 동안 안내선이 금 자리에서 표 아래까지.
  await drag(page, grip, 240, { during: async () => {
    const guide = page.locator('.col-guide');
    await expect(guide).toBeVisible();
    const [gb, lb, hb] = [await guide.boundingBox(), await root(page).locator('[data-fx-list]').boundingBox(), await grip.boundingBox()];
    expect(Math.abs(gb.x + gb.width / 2 - (hb.x + hb.width / 2))).toBeLessThan(3);
    expect(gb.y).toBeLessThanOrEqual(lb.y + 1); expect(gb.y + gb.height).toBeGreaterThanOrEqual(Math.min(lb.y + lb.height, 900) - 2);
  } });
  await expect(page.locator('.col-guide')).toHaveCount(0);
  expect(Math.abs((await nameWidth(page)) - (before + 240))).toBeLessThan(4);
  await expect.poll(() => stored()?.name_f ?? 0).toBeGreaterThan(before + 200);
  expect(stored()?.name).toBeUndefined(); // PC 값은 그대로(따로 기억)
  // 머리줄과 줄 칸이 같이 움직이고, 화면 전체가 아니라 목록만 옆으로 민다.
  const hx = await head(page).locator('[data-col-grip="path"]').locator('xpath=..').boundingBox();
  const rx = await longRow.locator('.fx-path').boundingBox();
  expect(Math.abs(hx.x - rx.x)).toBeLessThan(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  // ③ 다시 열어도(다른 기기도 같은 서버 값) 그 너비.
  const saved = stored().name_f;
  await page.reload(); await openBig(page, 884);
  await expect.poll(async () => Math.abs((await nameWidth(page)) - saved)).toBeLessThan(3);
  // ④ PC 폭이 되면 PC 값(없음 = 기본 너비), 다시 폴드 폭이면 폴드 값.
  await page.setViewportSize({ width: 1440, height: 900 }); await settle(page);
  await expect.poll(async () => Math.abs((await nameWidth(page)) - saved)).toBeGreaterThan(20);
  await page.setViewportSize({ width: 884, height: 900 }); await settle(page);
  await expect.poll(async () => Math.abs((await nameWidth(page)) - saved)).toBeLessThan(3);
  await page.screenshot({ path: 'test-results/col-resize-fold-884.png' });
  expect(errors).toEqual([]);
});

test.describe('손가락', () => {
  test.use({ hasTouch: true });
  test('폴드 884: 금을 손가락으로 끌기 · 두 번 누르면 이름 길이에 맞춰 이름이 다 보임', async ({ page }) => {
    test.setTimeout(90000);
    const prefs = await installViewPrefsServer(page);
    const { errors, server } = await start(page, 884);
    addLong(server);
    await openBig(page, 884);
    const grip = head(page).locator('[data-col-grip="name"]');
    const longName = root(page).locator('[data-fx-list] .fx-row', { hasText: LONG }).locator('.fx-name');
    // 손가락 끌기(터치 → pointer 이벤트): 왼쪽으로 줄이면 줄고, 최소 너비 아래로는 안 준다.
    const cdp = await page.context().newCDPSession(page);
    const g = await grip.boundingBox(), x = g.x + g.width / 2, y = g.y + g.height / 2;
    const touch = async (type, px) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y }] });
    await touch('touchStart', x); for (const d of [-40, -200, -600]) await touch('touchMove', x + d); await touch('touchEnd');
    await settle(page);
    await expect.poll(() => prefs.value?.col_widths?.files?.name_f).toBe(40);
    expect(Math.abs((await nameWidth(page)) - 40)).toBeLessThan(2);
    // 두 번 누르기 = 글자 길이에 맞춤.
    const g2 = await grip.boundingBox();
    await page.touchscreen.tap(g2.x + g2.width / 2, g2.y + g2.height / 2);
    await page.touchscreen.tap(g2.x + g2.width / 2, g2.y + g2.height / 2);
    await expect.poll(() => prefs.value?.col_widths?.files?.name_f ?? 0).toBeGreaterThan(200);
    await settle(page);
    expect(await longName.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});

test('PC 1440: 찾기 결과에도 같은 머리줄(이름·위치·바뀐 날·크기 금), 폴더 목록 너비는 PC 값', async ({ page }) => {
  test.setTimeout(90000);
  const prefs = await installViewPrefsServer(page);
  const { errors } = await start(page, 1440);
  await openFiles(page, 1440);
  await expect(head(page).locator('[data-col-grip]')).toHaveCount(3); // 폴더 목록: 이름·바뀐 날·크기
  await settle(page);
  const before = await nameWidth(page);
  await drag(page, head(page).locator('[data-col-grip="name"]'), -60);
  expect(Math.abs((await nameWidth(page)) - (before - 60))).toBeLessThan(4);
  await expect.poll(() => prefs.value?.col_widths?.files?.name ?? 0).toBeGreaterThan(0);
  expect(prefs.value.col_widths.files.name_f).toBeUndefined();
  await (await screenFind(page)).fill('가짜');
  await expect(root(page).locator('[data-fx-list] .fx-row').first()).toBeVisible();
  await expect(head(page).locator('[data-col-grip]')).toHaveCount(4);
  await expect(head(page)).toContainText('위치');
  expect(errors).toEqual([]);
});

// NOTE-목록머리겹침 전수(명진 11/27 노트 목록 수정일 머리 겹침 → 같은 표 부품을 쓰는 [파일] 표도 같은 검사): 머리 칸마다 글자·▲▼·너비 금(가운데 선)이 서로 다른 자리,
// 칸 범위는 서로 겹치지 않는다. PC 폭 여러 개, 바뀐 날·크기(오른쪽 맞춤) 칸을 가장 좁게 줄인 뒤에도.
for (const width of [1100, 1400, 1750]) test(`PC ${width}: [파일] 큰 파일 표 머리 칸의 글자·화살표·금이 서로 겹치지 않음(기본 폭과 좁힌 폭)`, async ({ page }) => {
  test.setTimeout(90000);
  await installViewPrefsServer(page);
  const { errors } = await start(page, width);
  await openBig(page, width);
  const parts = () => head(page).evaluate(h => {
    const r = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right }; };
    return [...h.querySelectorAll('[role="columnheader"]')].map(c => {
      const btn = c.querySelector('.hs-btn'), grip = c.querySelector('.col-grip'), gr = grip && r(grip), mid = gr && (gr.l + gr.r) / 2;
      return { name: c.textContent.trim(), cell: r(c), btn: btn && r(btn), line: gr && { l: mid - 1, r: mid + 1 } };
    });
  });
  const hit = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r;
  const check = async when => {
    const p = await parts(), why = `${width} ${when}`;
    for (let i = 1; i < p.length; i++) expect(p[i - 1].cell.r, `${why}: ${p[i - 1].name}·${p[i].name} 칸`).toBeLessThanOrEqual(p[i].cell.l + 0.5);
    for (const a of p) {
      if (a.btn) { expect(a.btn.l, `${why}: ${a.name} 글자 왼쪽`).toBeGreaterThanOrEqual(a.cell.l - 0.5); expect(a.btn.r, `${why}: ${a.name} 글자 오른쪽`).toBeLessThanOrEqual(a.cell.r + 0.5); }
      for (const b of p) expect(hit(a.line, b.btn), `${why}: ${a.name} 금이 ${b.name} 글자 위`).toBe(false);
    }
  };
  await check('기본');
  for (const key of ['day', 'size']) {
    const grip = head(page).locator(`[data-col-grip="${key}"]`);
    if (!(await grip.count())) continue;
    await grip.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
  }
  await settle(page);
  await check('좁힘');
  expect(errors).toEqual([]);
});

// LIST-정렬꺾쇠(사용자 결정 2026-11-28 시안 A, docs/design/approved/list-sort-chevron.md): 노트 목록과 같은 공용 머리 칸 — [파일] 표도 꺾쇠 SVG·세로 가운데·정렬 칸만 진함,
// 칸 사이 금은 평소 안 보이고 머리 줄에 올릴 때만(자리·폭 그대로).
for (const width of [1280, 884]) test(`LIST-정렬꺾쇠 [파일] ${width}: 머리 칸 꺾쇠·방향·정렬 칸만 진함, 금은 올릴 때만`, async ({ page }) => {
  test.setTimeout(90000);
  const { expectSortMark, gripOpacities } = await import('./helpers/sort-mark.mjs');
  await installViewPrefsServer(page);
  const { errors } = await start(page, width);
  await openBig(page, width);
  await expectSortMark(head(page), { key: 'size', dir: 'desc', why: '큰 파일 처음' });
  await head(page).locator('[data-head-sort="name"]').click();
  await expect(head(page).locator('[data-head-sort="name"]').locator('xpath=..')).toHaveAttribute('aria-sort', 'ascending');
  await expectSortMark(head(page), { key: 'name', dir: 'asc', why: '이름 오름' });
  const n = await head(page).locator('.col-grip').count();
  const row = await root(page).locator('[data-fx-list] .fx-row').nth(2).boundingBox();
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await expect.poll(() => gripOpacities(head(page))).toEqual(Array(n).fill(0));
  const hb = await head(page).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await expect.poll(() => gripOpacities(head(page))).toEqual(Array(n).fill(1));
  expect(errors).toEqual([]);
});
