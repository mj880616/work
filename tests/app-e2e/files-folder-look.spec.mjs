import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
// FOLDER-순서·색 ③-2 (S49-50, docs/design/folder-color-order.md): [파일] 클라우드 폴더(원드라이브·구글 드라이브)에 노트와 같은 색 8가지·직접 정한 순서.
// 폴더 한 개를 고르면(PC Ctrl+누르기·폰 꾹 누르기) 아래 막대에 [색] [위로] [아래로] → 서버 표 app_folder_prefs에 저장(서버 함수), 새로고침해도 유지,
// 목록·나무·받을 곳 창이 같은 색·같은 순서, [기본]은 지금 모양(📁), 저장 실패는 그대로 두고 알림, DB 적용 전에도 목록은 그대로. 폴더 이름은 모두 가짜.
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const folderNames = page => root(page).locator('[data-fx-list] .fx-row.fx-folder .fx-name').allTextContents();
const RGB = { 4: 'rgb(63, 148, 134)', 1: 'rgb(180, 90, 82)' };
async function gotoOdRoot(page, width) {
  if (width <= 760) {
    await root(page).locator('[data-fx-tab="folders"]').click();
    await root(page).locator('[data-fx-tree] [data-fx-twist="od:"]').click();
  } else if (await root(page).locator('[data-fx-tree] [data-fx-twist="od:"][aria-expanded="false"]').count()) await root(page).locator('[data-fx-tree] [data-fx-twist="od:"]').click();
  await root(page).locator('[data-fx-tree] [data-fx-go="od"][data-fx-id=""]').click();
  await expect(row(page, 'od:OD!1')).toBeVisible();
}
// 이미 고른 줄이면 그대로 두고, 아니면 고른다(고르기는 눌러 바꾸는 방식이라 같은 줄을 또 누르면 풀린다).
async function pick(page, key) {
  if (!(await row(page, key).evaluate(el => el.classList.contains('fx-picked')))) await row(page, key).dispatchEvent('contextmenu');
  await expect(row(page, key)).toHaveClass(/fx-picked/);
}
async function pickColor(page, name) {
  await root(page).locator('[data-fx-bar] [data-fx-look="color"]').click();
  const choice = page.locator('#fxLookMenu .fl-choice');
  await expect(choice).toBeVisible();
  await choice.getByRole('radio', { name, exact: true }).click();
  await expect(page.locator('#fxLookMenu')).toBeHidden();
}
const icon = (page, key) => row(page, key).locator('.fx-ico');

for (const width of [1440, 412]) test.describe(`[파일] 폴더 색·순서 ${width}`, () => {
  test.use({ hasTouch: width < 761 });
  test(`색 고르기·순서 바꾸기는 서버에 저장되고 새로고침해도 유지, 목록·나무·받을 곳 창이 같다 ${width}`, async ({ page }, info) => {
    test.setTimeout(120000);
    const { errors, server } = await start(page, width);
    await openFiles(page, width);
    await gotoOdRoot(page, width);
    // 안 고른 폴더는 지금 모양(📁), 색 속성 없음. 이름순: 문서함 → 사진함.
    await expect(icon(page, 'od:OD!2')).toHaveText('\u{1F4C1}');
    await expect(root(page).locator('[data-fc]')).toHaveCount(0);
    expect(await folderNames(page)).toEqual(['가짜 문서함', '가짜 사진함']);
    // 폴더 한 개를 고르면 막대에 [색] [위로](끝이라 [아래로]는 없음). 파일을 고르면 보이지 않는다.
    await pick(page, 'od:OD!2');
    const bar = root(page).locator('[data-fx-bar]');
    await expect(bar.locator('[data-fx-look="color"]')).toBeVisible();
    await expect(bar.locator('[data-fx-look="up"]')).toBeVisible();
    await expect(bar.locator('[data-fx-look="down"]')).toHaveCount(0);
    await pick(page, 'od:OD!1');
    await expect(bar.locator('[data-fx-look]')).toHaveCount(0); // 둘을 고름 → 단추 없음
    await row(page, 'od:OD!1').dispatchEvent('contextmenu'); // 다시 누르면 풀림
    await expect(row(page, 'od:OD!1')).not.toHaveClass(/fx-picked/);
    expect(server.prefCalls).toEqual([]);

    // 메뉴: 동그라미 8개 + [기본], 이 앱에서만 보인다는 한 줄. 화면 안에 들어온다.
    await bar.locator('[data-fx-look="color"]').click();
    const choice = page.locator('#fxLookMenu .fl-choice');
    await expect(choice.getByRole('radio')).toHaveCount(9);
    await expect(choice.getByRole('radio', { name: '기본', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#fxLookMenu')).toContainText('이 앱에서만');
    const box = await page.locator('#fxLookMenu').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(page.locator('#fxLookMenu')).toBeHidden();
    expect(server.prefCalls).toEqual([]);

    // 청록(4): 서버 함수 한 번(그 폴더·그 출처만), 칠한 폴더 그림, 값은 토큰 색.
    await pick(page, 'od:OD!2');
    await pickColor(page, '청록');
    await expect.poll(() => server.prefCalls.length).toBe(1);
    expect(server.prefCalls[0]).toMatchObject({ source: 'od', items: [{ k: 'OD!2', c: 4 }] });
    await expect(icon(page, 'od:OD!2')).toHaveAttribute('data-fc', '4');
    await expect(icon(page, 'od:OD!1')).not.toHaveAttribute('data-fc', /./);
    expect(await icon(page, 'od:OD!2').locator('svg').evaluate(x => getComputedStyle(x).color)).toBe(RGB[4]);
    if (width > 760) {
      // 나무 줄도 같은 색.
      const treeIcon = root(page).locator('[data-fx-tree] [data-fx-id="OD!2"] .fl-ico');
      await expect(treeIcon).toHaveAttribute('data-fc', '4');
      expect(await treeIcon.locator('svg').evaluate(x => getComputedStyle(x).color)).toBe(RGB[4]);
    }

    // 위로: 순서 값이 없던 형제라 같은 칸을 1024 간격으로 다시 매겨 한 번에 보낸다. 목록·나무 순서가 바뀐다.
    await pick(page, 'od:OD!2');
    await bar.locator('[data-fx-look="up"]').click();
    await expect.poll(() => server.prefCalls.length).toBe(2);
    expect(server.prefCalls[1]).toMatchObject({ source: 'od', items: [{ k: 'OD!2', o: 1024 }, { k: 'OD!1', o: 2048 }] });
    await expect.poll(() => folderNames(page)).toEqual(['가짜 사진함', '가짜 문서함']);
    if (width > 760) await expect.poll(() => root(page).locator('[data-fx-tree] [data-fx-go][data-fx-id]:not([data-fx-id=""])').evaluateAll(els => els.map(e => e.dataset.fxId))).toEqual(['OD!2', 'OD!1']);

    // 새로고침해도 유지(서버 값).
    await page.reload();
    await expect(root(page)).toBeVisible();
    await openFiles(page, width).catch(() => {});
    await gotoOdRoot(page, width);
    await expect.poll(() => folderNames(page)).toEqual(['가짜 사진함', '가짜 문서함']);
    await expect(icon(page, 'od:OD!2')).toHaveAttribute('data-fc', '4');
    expect(server.prefReads).toBeGreaterThan(1);

    // 받을 곳 창(옮기기)의 나무도 같은 색·같은 순서.
    await pick(page, 'od:OD!1');
    // OD!1 은 폴더라 막대의 [옮기기]로 받을 곳 창을 연다(폴더를 다른 폴더 안으로 옮기는 창 = 같은 나무).
    await root(page).locator('[data-fx-bar] [data-fx-cut]').click();
    const dest = root(page).locator('[data-fx-dest]');
    await expect(dest).toBeVisible();
    if (await dest.locator('[data-fx-dest-twist="od:"][aria-expanded="false"]').count()) await dest.locator('[data-fx-dest-twist="od:"]').click();
    const destRows = dest.locator('[data-fx-dest-pick]:not([data-fx-dest-pick$=":"])');
    await expect.poll(() => destRows.evaluateAll(els => els.map(e => e.dataset.fxDestPick))).toEqual(expect.arrayContaining(['od:OD!2', 'od:OD!1']));
    expect(await destRows.evaluateAll(els => els.map(e => e.dataset.fxDestPick).filter(k => /^od:OD![12]$/.test(k)))).toEqual(['od:OD!2', 'od:OD!1']);
    await expect(dest.locator('[data-fx-dest-pick="od:OD!2"] .fl-ico')).toHaveAttribute('data-fc', '4');
    await page.keyboard.press('Escape');
    if (await root(page).locator('[data-fx-dest]').isVisible()) await root(page).locator('[data-fx-dest-close]').click();

    // [기본]: 지금 모양(📁)으로, 서버에는 null이 간다. (받을 곳 창을 열려고 둘을 골랐으니 풀고 하나만 고른다.)
    if (await root(page).locator('[data-fx-bar] [data-fx-unpick]').count()) await root(page).locator('[data-fx-bar] [data-fx-unpick]').click();
    await pick(page, 'od:OD!2');
    await expect(bar.locator('[data-fx-look="color"]')).toBeVisible();
    await pickColor(page, '기본');
    await expect.poll(() => server.prefCalls.length).toBe(3);
    expect(server.prefCalls[2]).toMatchObject({ items: [{ k: 'OD!2', c: null }] });
    await expect(root(page).locator('[data-fc]')).toHaveCount(0);
    await expect(icon(page, 'od:OD!2')).toHaveText('\u{1F4C1}');
    expect(errors).toEqual([]);
    if (width < 761) await page.screenshot({ path: info.outputPath('files-folder-look-412.png') });
  });

  test(`다른 출처(구글 드라이브)는 따로 저장하고, 어두운 테마에서는 어두운 색 값 ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.emulateMedia({ colorScheme: 'dark' });
    const { errors, server } = await start(page, width, { prefs: [{ source: 'od', folder_key: 'OD!1', color: 1, sort_order: null }] });
    await openFiles(page, width);
    await gotoOdRoot(page, width);
    // 서버에 있던 색이 그대로 보인다(어두운 테마 값 #c27a72).
    await expect(icon(page, 'od:OD!1')).toHaveAttribute('data-fc', '1');
    expect(await icon(page, 'od:OD!1').locator('svg').evaluate(x => getComputedStyle(x).color)).toBe('rgb(194, 122, 114)');
    // 같은 열쇠여도 출처가 다르면 다른 줄: 구글 드라이브 폴더에 색을 고르면 source 'gd'로 간다.
    if (width <= 760) await root(page).locator('[data-fx-up]').click().catch(() => {});
    if (width <= 760) await root(page).locator('[data-fx-tree] [data-fx-twist="gd:"]').click();
    await root(page).locator('[data-fx-tree] [data-fx-go="gd"][data-fx-id=""]').click();
    await expect(row(page, 'gd:gdFolder1')).toBeVisible();
    await expect(icon(page, 'gd:gdFolder1')).not.toHaveAttribute('data-fc', /./);
    await pick(page, 'gd:gdFolder1');
    // 폴더가 하나뿐이면 [위로]·[아래로]는 없다.
    await expect(root(page).locator('[data-fx-bar] [data-fx-look="up"], [data-fx-bar] [data-fx-look="down"]')).toHaveCount(0);
    await pickColor(page, '벽돌');
    await expect.poll(() => server.prefCalls.length).toBe(1);
    expect(server.prefCalls[0]).toMatchObject({ source: 'gd', items: [{ k: 'gdFolder1', c: 1 }] });
    await expect(icon(page, 'gd:gdFolder1')).toHaveAttribute('data-fc', '1');
    expect(errors).toEqual([]);
  });

  test(`저장이 실패하면 그대로 두고 알린다 ${width}`, async ({ page }) => {
    const { server } = await start(page, width, { prefsFail: true });
    await openFiles(page, width);
    await gotoOdRoot(page, width);
    await pick(page, 'od:OD!2');
    await pickColor(page, '자주');
    await expect.poll(() => server.prefCalls.length).toBe(1);
    await expect(root(page).locator('[data-fc]')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('폴더 색을 저장하지 못했어요');
    await pick(page, 'od:OD!2');
    await root(page).locator('[data-fx-bar] [data-fx-look="up"]').click();
    await expect.poll(() => server.prefCalls.length).toBe(2);
    await expect(page.locator('body')).toContainText('폴더 순서를 저장하지 못했어요');
    expect(await folderNames(page)).toEqual(['가짜 문서함', '가짜 사진함']);
  });

  test(`DB 적용 전(표·함수 없음)에도 목록은 그대로 뜨고 저장만 알린다 ${width}`, async ({ page }) => {
    const { server } = await start(page, width, { prefsMissing: true });
    await openFiles(page, width);
    await gotoOdRoot(page, width);
    expect(await folderNames(page)).toEqual(['가짜 문서함', '가짜 사진함']);
    await expect(root(page).locator('[data-fc]')).toHaveCount(0);
    await pick(page, 'od:OD!1');
    await pickColor(page, '회색');
    await expect(page.locator('body')).toContainText('폴더 색을 저장하지 못했어요');
    expect(server.prefCalls.length).toBe(1);
  });
});
