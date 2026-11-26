import { test, expect } from '@playwright/test';
import { bootLibrary, libFolder, libDoc, SB } from './helpers/library-folder-server.mjs';
import { libraryTopMenu } from './helpers/library-tree.mjs';
import { treeEnter } from './helpers/tree-enter.mjs';
// UI-자료실파일모양(S69-85 ②, 명진 11/25 "파일 인터페이스로 자료실도 바꿔", 'ㅇ' 확정): 자료실 목록을 파일 목록 모양으로.
// - 큰 체크칸 없음: 고른 줄은 파일과 같은 옅은 강조 바탕 + 왼쪽 진한 세로줄, 줄을 누르면 고르기·풀기(네모 칸은 보이지 않게 남아 키보드·화면 읽기 그대로).
// - 주소 줄: S71-46에 드라이브 위치 줄·위치 줄 끝 [드라이브 ↗]을 없앴다(드라이브 열기는 머리 ⋯).
// 이름은 모두 지어낸 것이다(가짜 서버).
const DRIVE = 'libraryFolder0001', PAIR = 'pairFolder000001';
const PLACE = { folder_id: DRIVE, url: `https://drive.google.com/drive/folders/${DRIVE}`, path: ['가상 앱', '자료실'], pairs: { fa: PAIR } };

for (const width of [390, 1280]) test(`자료실 ${width}: 고르기 중 네모 칸이 보이지 않고 고른 줄은 파일처럼 바탕 + 왼쪽 세로줄`, async ({ page }) => {
  const folders = [libFolder('fa', null, { name: '가상 사업', sort_order: 1024 })];
  const r = await bootLibrary(page, width, { folders, items: [], docs: [libDoc('d-1', null), libDoc('d-2', null)], group: '폴더' });
  const row = page.locator('#documentList .lu-row[data-lu-document="d-1"]');
  // 폰은 '폴더 밖'이 접혀 있다 — 고르기 전에 이름 자리를 눌러 그 자리에서 펼친다(S69-89: 고르기 중 폴더 줄 누르기는 펼치기가 아니라 고르기 — 기준표 S10).
  if (!(await row.isVisible())) { const head = page.locator('#documentList summary', { hasText: '폴더 밖' }).first(); const b = await head.boundingBox(); await page.mouse.click(b.x + 90, b.y + b.height / 2); }
  await expect(row).toBeVisible();
  await libraryTopMenu(page, 'select', { tap: false });
  const box = page.locator('[data-lu-pick="d-1"]');
  await expect(box).toHaveCount(1);
  expect(await box.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
  // 사람이 줄 이름 자리를 누른 것처럼(그 자리 맨 위 요소가 받는다 — 보이지 않는 네모 칸).
  const tapTitle = async () => { const b = await row.locator('.lu-row-title').boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  await tapTitle();
  await expect(page.locator('#librarySelectCount')).toHaveText('1개 선택됨');
  await expect(row).toHaveClass(/lu-picked/);
  const look = await row.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, bar: getComputedStyle(el).boxShadow }));
  expect(look.bar, '왼쪽 세로줄').toMatch(/inset/);
  expect(look.bg).not.toBe('rgba(0, 0, 0, 0)');
  // 다시 누르면 풀린다. ⋯는 그대로 메뉴.
  await tapTitle();
  await expect(page.locator('#librarySelectCount')).toHaveText('0개 선택됨');
  await expect(row).not.toHaveClass(/lu-picked/);
  await page.keyboard.press('Escape'); // S70-64b: [✕] 대신 Esc
  await expect(page.locator('#documentList .lu-picked')).toHaveCount(0);
  expect(r.errors).toEqual([]);
});

// S71-46 LIB-위치줄삭제(사용자 11/26 "자료실에서 이부분 불필요 없애"): 폴더 안에서도 위치 줄 끝 [드라이브 ↗]·저장 위치 줄이 없고,
// 그 폴더의 짝 드라이브 폴더는 머리 ⋯ [드라이브에서 열기]로 연다.
for (const width of [390, 1280]) test(`자료실 ${width}: 맨 위·폴더 안 모두 드라이브 위치 줄이 없고, 폴더 안 ⋯ [드라이브에서 열기]는 그 폴더의 짝 드라이브 폴더`, async ({ page, context }) => {
  const folders = [libFolder('fa', null, { name: '가상 사업', sort_order: 1024 })];
  const r = await bootLibrary(page, width, { folders, items: [{ document_id: 'd-1', folder_id: 'fa' }], docs: [libDoc('d-1', null)], group: '폴더', init: { viewPrefs: { library_two: false } } });
  let placeAsked = 0;
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/workspace-drive', route => {
    const a = new URL(route.request().url()).searchParams.get('action');
    if (a === 'drive-place') placeAsked++;
    return route.fulfill({ json: a === 'drive-place' ? { ok: true, place: PLACE } : { ok: true, state: 'aligned', pending: 0, more: false } });
  });
  await context.route('https://drive.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>drive</title>' }));
  await page.evaluate(() => window.KPTURouter.go('home'));
  await page.evaluate(() => window.KPTURouter.go('library'));
  await expect.poll(() => placeAsked).toBeGreaterThan(0);
  const none = async () => {
    await expect(page.locator('#libraryDriveLine, .lu-drive-where, a.lu-drive-open, .lu-drive-here')).toHaveCount(0);
    await expect(page.locator('#libraryListCard')).not.toContainText('구글 드라이브 ·');
    await expect(page.locator('#libraryListCard')).not.toContainText('드라이브 ↗');
  };
  await none();
  if (width >= 600) await treeEnter(page.locator('#libraryFolderNav [data-lu-nav="fa"]'));
  else await page.evaluate(() => { const u = new URL(location.href); u.searchParams.set('folder', 'fa'); history.replaceState(history.state, '', u); }).then(() => page.reload());
  const path = page.locator('#libraryPath');
  if (width >= 600) await expect(path).toBeVisible();
  await expect(page.locator('#documentList [data-lu-document="d-1"]').first()).toBeVisible();
  await none();
  await page.locator('#libraryTopMenuBtn').click();
  const open = page.locator('#luTopMenu [data-lu-top="drive-open"]');
  await expect(open).toHaveText('드라이브에서 열기');
  const [popup] = await Promise.all([context.waitForEvent('page'), open.click()]);
  expect(popup.url()).toBe(`https://drive.google.com/drive/folders/${PAIR}`);
  if (width >= 600) { const h = await path.evaluate(el => el.getBoundingClientRect().height); expect(h).toBeLessThan(40); }
  await page.screenshot({ path: `test-results/ui-audit/s71-46-library-folder-${width}.png` });
  expect(r.errors).toEqual([]);
});
