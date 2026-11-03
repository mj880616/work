import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// FILES-출처켜고끄기 + FILES-두드라이브나무(S49-21, 요청함 11/04 07:34): [파일] 위 줄 출처 아이콘 [원드라이브][구글 드라이브] 켜기/끄기(서버 view_prefs.files_sources),
// 켜진 두 드라이브가 맨 위 줄로 나란히 있는 폴더 나무(폰 [폴더] 탭 포함), 펼치기 2단계 이상, 폴더 눌러 들어가기, 모두 끔 안내. 파일·폴더 이름은 모두 가짜.
const root = page => page.locator('#filesRoot');
const chip = (page, name) => root(page).locator(`[data-fx-src="${name}"]`);
const tree = page => root(page).locator('[data-fx-tree]');
const roots = page => tree(page).locator('.fx-root');
const twist = (page, key) => tree(page).locator(`[data-fx-twist="${key}"]`);
const folderCalls = server => server.calls.filter(c => c.action === 'folder').map(c => `${c.body.source}:${c.body.id || ''}`);
const SHOTS = process.env.FILES_SOURCES_SHOTS || '';

for (const width of [412, 884, 1440]) {
  test(`[파일] ${width}폭: 출처 아이콘 켜기/끄기 · 두 드라이브 나무 · 펼치기 2단계 · 모두 끔 안내 · 저장 뒤 다시 열어도 유지`, async ({ page }) => {
    test.setTimeout(120000);
    const phone = width <= 760;
    const { errors, server } = await start(page, width);
    const prefs = await installViewPrefsServer(page);
    await openFiles(page, width);
    // 아이콘 둘: 둘 다 연결돼 있으니 보이고 켜짐. 사진 화면과 같은 부품(공용 줄 src-chips).
    await expect(chip(page, 'od')).toBeVisible();
    await expect(chip(page, 'gd')).toBeVisible();
    await expect(chip(page, 'od')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, 'gd')).toHaveAttribute('aria-pressed', 'true');
    await expect(root(page).locator('[data-fx-srcs]')).toHaveClass(/src-chips/);
    if (phone) await root(page).locator('[data-fx-tab="folders"]').click();
    // 맨 위 두 줄: 원드라이브 / 구글 드라이브가 나란히(▸). 폰은 이 나무가 [폴더] 탭 첫 화면이고 목록은 아직 없다.
    await expect(roots(page)).toHaveCount(2);
    await expect(roots(page).nth(0)).toContainText('원드라이브');
    await expect(roots(page).nth(1)).toContainText('구글 드라이브');
    await expect(twist(page, 'od:')).toHaveText('▸');
    await expect(twist(page, 'gd:')).toHaveText('▸');
    if (phone) { await expect(root(page).locator('[data-fx-list] [data-fx-row]:visible')).toHaveCount(0); await expect(root(page)).toHaveAttribute('data-fx-pane', 'tree'); }
    // 펼치기 2단계: 원드라이브 → 가짜 문서함 → 가짜 2026. 두 번째 드라이브도 같은 화면에서 펼친다.
    await twist(page, 'od:').click();
    await expect(tree(page).locator('[data-fx-go="od"][data-fx-id="OD!1"]')).toBeVisible();
    await twist(page, 'od:OD!1').click();
    await expect(tree(page).locator('[data-fx-go="od"][data-fx-id="OD!10"]')).toBeVisible();
    await twist(page, 'gd:').click();
    await expect(tree(page).locator('[data-fx-go="gd"][data-fx-id="gdFolder1"]')).toBeVisible();
    await expect(twist(page, 'od:')).toHaveText('▾');
    // 펼친 폴더는 바로 읽기(Edge folder)로 채우고, 접었다 다시 펼쳐도 다시 부르지 않는다.
    await expect.poll(() => folderCalls(server)).toEqual(expect.arrayContaining(['od:OD!1', 'od:', 'gd:']));
    const before = folderCalls(server).length;
    await twist(page, 'od:OD!1').click();
    await expect(tree(page).locator('[data-fx-go="od"][data-fx-id="OD!10"]')).toHaveCount(0);
    await twist(page, 'od:OD!1').click();
    await expect(tree(page).locator('[data-fx-go="od"][data-fx-id="OD!10"]')).toBeVisible();
    expect(folderCalls(server).length).toBe(before);
    // 나무 줄은 촘촘하게(폰 32px 안쪽, PC 28px대), 펼치기 단추는 손가락이 닿는 폭.
    const rowBox = await tree(page).locator('.nx-folder:not(.fx-root) .nx-main').first().boundingBox();
    expect(rowBox.height).toBeLessThanOrEqual(phone ? 34 : 30);
    if (phone) expect((await twist(page, 'od:').boundingBox()).width).toBeGreaterThanOrEqual(36);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/files-tree-${width}.png` }); }
    // 폴더 이름을 누르면 그 폴더 안 파일 목록으로 들어간다.
    await tree(page).locator('[data-fx-go="od"][data-fx-id="OD!1"]').click();
    await expect(root(page).locator('[data-fx-list] [data-fx-row="od:OD!11"]')).toBeVisible();
    if (phone) { await expect(root(page)).toHaveAttribute('data-fx-pane', 'list'); await expect(tree(page)).toBeHidden(); }
    // 폰: ‹ 로 위 폴더 → 맨 위 폴더에서 한 번 더 ‹ 면 나무로 돌아온다.
    if (phone) {
      await root(page).locator('[data-fx-up]').click();
      await expect(root(page).locator('.fx-crumb-now')).toHaveText('원드라이브');
      await root(page).locator('[data-fx-up]').click();
      await expect(root(page)).toHaveAttribute('data-fx-pane', 'tree');
      await expect(roots(page)).toHaveCount(2);
    }

    // 구글 드라이브 끄기: 아이콘이 꺼짐으로, 나무·[최근]에서 구글 드라이브가 빠지고, 서버에 저장.
    await chip(page, 'gd').click();
    await expect(chip(page, 'gd')).toHaveAttribute('aria-pressed', 'false');
    await expect(roots(page)).toHaveCount(1);
    await expect(roots(page).first()).toContainText('원드라이브');
    await expect.poll(() => prefs.patches.at(-1)?.files_sources).toEqual({ od: true, gd: false });
    await root(page).locator(phone ? '[data-fx-tab="recent"]' : '[data-fx-shelf="recent"]').click();
    await expect(root(page).locator('[data-fx-list] [data-fx-row^="gd:"]')).toHaveCount(0);
    await expect(root(page).locator('[data-fx-list] [data-fx-row^="od:"]').first()).toBeVisible();
    // 끈 것은 보기에서만 빠진다: 연결 표시·색인 호출은 그대로, 연결을 끊는 호출은 없다.
    expect(server.calls.filter(c => c.what === 'edge' && /disconnect|unlink/.test(c.action || ''))).toEqual([]);

    // 다시 열어도(새로고침) 같은 상태: 서버에 저장된 값에서 읽는다. 기기 저장 없음.
    await page.reload();
    await openFiles(page, width);
    await expect(chip(page, 'gd')).toHaveAttribute('aria-pressed', 'false');
    await expect(chip(page, 'od')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /files.?sources/i.test(k)))).toEqual([]);

    // 모두 끄면 '위 출처 아이콘을 켜 주세요' 한 줄(사진 화면과 같은 문구).
    await chip(page, 'od').click();
    await expect(chip(page, 'od')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => prefs.patches.at(-1)?.files_sources).toEqual({ od: false, gd: false });
    await expect(root(page).getByText('위 출처 아이콘을 켜 주세요').first()).toBeVisible();
    await expect(root(page).locator('[data-fx-list] [data-fx-row]')).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/files-all-off-${width}.png` });
    // 다시 켜면 돌아온다.
    await chip(page, 'od').click();
    await chip(page, 'gd').click();
    await expect(chip(page, 'od')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, 'gd')).toHaveAttribute('aria-pressed', 'true');
    await expect(root(page).locator('[data-fx-list] [data-fx-row]').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('[파일] 폰 412: 모두 끈 채 [폴더] 탭도 안내 한 줄, 켜면 나무로 돌아온다', async ({ page }) => {
  const { errors } = await start(page, 412);
  await installViewPrefsServer(page, { files_sources: { od: false, gd: false } });
  await page.reload(); // 처음 읽을 때부터 서버에 저장돼 있던 값
  await openFiles(page, 412);
  await expect(root(page).getByText('위 출처 아이콘을 켜 주세요').first()).toBeVisible();
  await root(page).locator('[data-fx-tab="folders"]').click();
  await expect(tree(page).getByText('위 출처 아이콘을 켜 주세요')).toBeVisible();
  await chip(page, 'gd').click();
  await expect(roots(page)).toHaveCount(1);
  await expect(roots(page).first()).toContainText('구글 드라이브');
  expect(errors).toEqual([]);
});

test('[파일] 구글 드라이브가 연결돼 있지 않으면 그 아이콘·나무는 없고, 원드라이브 아이콘을 누르면 켜기/끄기, 연결 안 된 쪽은 연결 안내 한 줄', async ({ page }) => {
  const { errors } = await start(page, 1440, { connected: { od: true, gd: false } });
  await installViewPrefsServer(page);
  await openFiles(page, 1440);
  await expect(chip(page, 'od')).toBeVisible();
  await expect(chip(page, 'gd')).toBeHidden();
  await expect(roots(page)).toHaveCount(1);
  await chip(page, 'od').click();
  await expect(chip(page, 'od')).toHaveAttribute('aria-pressed', 'false');
  await expect(root(page).getByText('위 출처 아이콘을 켜 주세요').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('[파일] 원드라이브가 연결 전이면 아이콘을 눌러도 켜지지 않고 연결 안내 한 줄', async ({ page }) => {
  const { errors } = await start(page, 1440, { connected: { od: false, gd: true } });
  const prefs = await installViewPrefsServer(page);
  await openFiles(page, 1440);
  await expect(chip(page, 'od')).toHaveAttribute('aria-pressed', 'false');
  await chip(page, 'od').click();
  await expect(root(page).locator('[data-fx-note]')).toContainText('원드라이브가 연결돼 있지 않아요');
  expect(prefs.patches.filter(p => 'files_sources' in p)).toEqual([]);
  expect(errors).toEqual([]);
});

test('[파일] 서버가 출처 저장을 거절하면(DB 적용 전) 아이콘이 원래대로 돌아가고 알린다', async ({ page }) => {
  const { errors } = await start(page, 1440);
  const prefs = await installViewPrefsServer(page);
  prefs.denyKeys = ['files_sources']; // 서버 검사가 아직 모르는 칸(DB 적용 전)
  await openFiles(page, 1440);
  await chip(page, 'gd').click();
  await expect(chip(page, 'gd')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  expect(errors.filter(e => !/400|violates/.test(e))).toEqual([]);
});
