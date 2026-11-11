// FILES-폰폴더위로(요청함 11/06 01:10) ①②③④: 폰 [파일] '그 폴더만'에서 폴더 세 단계 들어간 뒤
// 뒤로 키·[‹]·화면 왼쪽 끝 밀기 어느 것으로도 한 단계씩 나오고, 들어온 폴더에서는 그 폴더를 펼친 나무로(엉뚱한 화면으로 나가지 않음).
// 위치 줄을 누르면 고른 단계로. [‹]는 지금 폴더 이름과 같은 줄(누르는 자리 44px), 정렬·[새 폴더]·[올리기]는 둘째 줄 오른쪽.
import { test, expect } from '@playwright/test';
import { start, openFiles, phoneFolder, enterRow } from './helpers/files-server.mjs';
import { swipeAt } from './helpers/pinch.mjs';

test.use({ hasTouch: true });

const root = page => page.locator('#filesRoot');
const tree = page => page.locator('#filesRoot [data-fx-tree]');
const box = page => page.locator('#filesRoot [data-fx-list] .ft-focus');
const here = page => box(page).locator('.ft-focus-name');
const up = page => box(page).locator('.ft-focus-head [data-fx-up]');

// 가짜 2026 › 가짜 3단 › 가짜 4단(세 단계째·네 단계째 폴더를 흉내 서버에 더한다).
async function deep(server) {
  const base = server.items.find(i => i.item_id === 'OD!10');
  server.items.push({ ...base, item_id: 'OD!15', parent_id: 'OD!10', name: '가짜 3단' });
  server.items.push({ ...base, item_id: 'OD!16', parent_id: 'OD!15', name: '가짜 4단' });
}
// 나무에서 '가짜 문서함'을 두 손가락으로 연 뒤 하위 폴더를 눌러 세 단계(가짜 문서함 › 가짜 2026 › 가짜 3단)까지.
async function threeDown(page) {
  await phoneFolder(page, 'od', 'OD!1');
  await expect(here(page)).toHaveText('가짜 문서함');
  await enterRow(page, box(page).locator('[data-fx-row="od:OD!10"]')); // OPS-빠진일2차 1: 안이 찬 하위 폴더 누르기는 그 자리 펼침 — 한 단계 들어가기는 두 손가락 벌리기
  await expect(here(page)).toHaveText('가짜 2026');
  await enterRow(page, box(page).locator('[data-fx-row="od:OD!15"]'));
  await expect(here(page)).toHaveText('가짜 3단');
  await expect(box(page).locator('[data-fx-row="od:OD!16"]')).toBeVisible();
}
const edgeSwipe = async page => {
  const b = await box(page).boundingBox();
  await swipeAt(page, 4, b.y + b.height / 2, 140);
};

for (const width of [390, 344]) {
  test(`파일 폰 ${width}: 세 단계 들어간 뒤 뒤로 키·[‹]·왼쪽 끝 밀기 = 한 단계씩, 들어온 폴더에서는 펼친 나무`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    await deep(server);
    await openFiles(page, width);
    await expect(tree(page).locator('[data-fx-fold="od:OD!1"]')).toBeVisible();
    await threeDown(page);
    await expect(up(page)).toHaveAttribute('aria-label', '위 폴더');

    await page.goBack();
    await expect(here(page)).toHaveText('가짜 2026');
    await expect(page.locator('#filesView')).toBeVisible();
    await up(page).tap();
    await expect(here(page)).toHaveText('가짜 문서함');
    await expect(up(page)).toHaveAttribute('aria-label', '폴더 나무');
    await edgeSwipe(page);
    await expect(tree(page)).toBeVisible();
    await expect(root(page)).toHaveAttribute('data-fx-pane', 'tree');
    await expect(tree(page).locator('[data-fx-fold="od:OD!1"] .ft-ico').first()).toHaveAttribute('data-ft-shape', 'open');

    // 다른 차례(밀기 → 뒤로 키 → [‹])도 같고, 나무에서 한 번 더 뒤로 키는 [파일] 화면에 남지 않고 이전 화면으로.
    await threeDown(page);
    await edgeSwipe(page);
    await expect(here(page)).toHaveText('가짜 2026');
    await page.goBack();
    await expect(here(page)).toHaveText('가짜 문서함');
    await page.goBack();
    await expect(tree(page)).toBeVisible();
    await expect(page.locator('#filesView')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`파일 폰 ${width}: 위치 줄 = 고른 단계로, 가운데 밀기·세로 굴리기는 위로 가지 않음`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    await deep(server);
    await openFiles(page, width);
    await threeDown(page);
    // 왼쪽 끝이 아닌 곳에서 민 것·왼쪽 끝에서 세로로 끈 것은 아무 일도 없다.
    const b = await box(page).boundingBox();
    await swipeAt(page, Math.round(width / 2), b.y + b.height / 2, 140);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 4, y: b.y + 10, id: 0 }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 4 + i * 4, y: b.y + 10 + i * 30, id: 0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect(here(page)).toHaveText('가짜 3단');
    // 위치 줄 '가짜 문서함'을 누르면 그 단계로 한 번에, 거기서 [‹]는 나무.
    await box(page).locator('.ft-focus-anc [data-fx-id="OD!1"]').tap();
    await expect(here(page)).toHaveText('가짜 문서함');
    await up(page).tap();
    await expect(tree(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`파일 폰 ${width}: [‹]는 폴더 이름 줄 맨 앞(누르는 자리 44px), 정렬·[새 폴더]·[올리기]는 둘째 줄 오른쪽`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    await deep(server);
    await openFiles(page, width);
    await threeDown(page);
    const m = await page.evaluate(() => {
      const r = el => el.getBoundingClientRect();
      const back = document.querySelector('#filesRoot [data-fx-list] .ft-focus-head [data-fx-up]');
      const name = document.querySelector('#filesRoot [data-fx-list] .ft-focus-name');
      const after = getComputedStyle(back, '::after');
      const b = r(back), n = r(name);
      const top = document.querySelector('#filesRoot .fx-top'), two = top.querySelector('[data-fx-two]');
      const tools = ['[data-fx-sort]', '[data-fx-mkdir]', '[data-fx-upload]'].map(s => r(top.querySelector(s)));
      return {
        hitW: b.width - parseFloat(after.left) - parseFloat(after.right), hitH: b.height - parseFloat(after.top) - parseFloat(after.bottom),
        sameLine: b.top < n.bottom && n.top < b.bottom, before: b.right <= n.left,
        ancBack: document.querySelectorAll('#filesRoot [data-fx-list] .ft-focus-anc [data-fx-up]').length,
        toolsRow: tools.every(t => Math.abs(t.top - tools[0].top) < 2), toolsRight: Math.round(r(top).right - tools[2].right),
        afterTwo: tools[0].left > r(two).right, toolsH: Math.max(...tools.map(t => t.height)),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(m.hitW).toBeGreaterThanOrEqual(44);
    expect(m.hitH).toBeGreaterThanOrEqual(44);
    expect(m.sameLine).toBe(true);
    expect(m.before).toBe(true);
    expect(m.ancBack).toBe(0);
    expect(m.toolsRow).toBe(true);
    expect(m.toolsRight).toBeLessThanOrEqual(2);
    expect(m.afterTwo).toBe(true);
    expect(m.toolsH).toBeLessThanOrEqual(28);
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

// ⑤ 같은 종류: 자료실 폰 '그 폴더만'도 같은 규칙 — 하위 폴더로 들어간 뒤 [‹]·뒤로 키·왼쪽 끝 밀기 = 한 단계 위, 들어온 폴더에서는 나무.
test('자료실 폰 390: 하위 폴더로 들어간 뒤 [‹]·뒤로 키 = 한 단계 위, 들어온 폴더에서 왼쪽 끝 밀기 = 나무', async ({ page }) => {
  const { bootLibrary, libFolder } = await import('./helpers/library-folder-server.mjs');
  const { pinch } = await import('./helpers/pinch.mjs');
  const { errors } = await bootLibrary(page, 390, { folders: [libFolder('fa', 'top-a', { name: '가상 A', sort_order: 1024 }), libFolder('fc', 'top-a', { name: '가상 C', parent_id: 'fa', sort_order: 0 })], items: [{ document_id: 'a-1', folder_id: 'fc' }, { document_id: 'n-1', folder_id: 'fa' }] });
  await page.locator('#libraryGroupBy').selectOption({ label: '폴더' });
  const head = key => page.locator(`#documentList details[data-lu-node="${key}"] > summary`);
  const path = page.locator('#libraryPath');
  const back = path.locator('[data-lu-path-back]');
  await pinch(page, head('f:fa'), 'out');
  await expect(path).toHaveText('‹자료실›');
  await expect(back).toHaveAttribute('aria-label', '폴더 나무');
  await head('f:fc').dblclick();
  await expect(path).toHaveText('‹자료실›가상 A›');
  await expect(back).toHaveAttribute('aria-label', '위 폴더');
  await back.tap();
  await expect(path).toHaveText('‹자료실›');
  await head('f:fc').dblclick();
  await expect(path).toHaveText('‹자료실›가상 A›');
  await page.goBack();
  await expect(path).toHaveText('‹자료실›');
  await expect(page.locator('#libraryView')).toBeVisible();
  const b = await page.locator('#documentList').boundingBox();
  await swipeAt(page, 4, b.y + 20, 140);
  await expect(path).toBeHidden();
  await expect(page.locator('#documentList details[data-lu-node="f:fc"]')).toBeVisible();
  expect(errors).toEqual([]);
});
