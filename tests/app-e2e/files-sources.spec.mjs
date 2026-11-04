import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// FILES-출처켜고끄기 + FILES-두드라이브나무(S49-21, 요청함 11/04 07:34): [파일] 위 줄 출처 아이콘 [원드라이브][구글 드라이브] 켜기/끄기(서버 view_prefs.files_sources),
// S49-26(명진 결정 H-8): 켜고 끄기 기억은 기기 종류마다 따로(files_sources.app / .phone / .pc) — 412는 폰 브라우저, 884·1440은 PC 칸.
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
    const phone = width <= 760, dev = phone ? 'phone' : 'pc';
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
    await expect.poll(() => prefs.patches.at(-1)?.files_sources).toEqual({ [dev]: { od: true, gd: false } });
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
    expect(prefs.value?.files_sources).toEqual({ [dev]: { od: true, gd: false } }); // 서버 값(이 기기 칸)에서 읽음

    // 모두 끄면 '위 출처 아이콘을 켜 주세요' 한 줄(사진 화면과 같은 문구).
    await chip(page, 'od').click();
    await expect(chip(page, 'od')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => prefs.patches.at(-1)?.files_sources).toEqual({ [dev]: { od: false, gd: false } });
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
  await installViewPrefsServer(page, { files_sources: { phone: { od: false, gd: false } } });
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

// S49-26 명진 결정 H-8: 같은 계정, 두 기기(폰 앱 412 · PC 1440). 한 기기에서 끈 출처는 다른 기기에 번지지 않고, 각자 다시 열어도 유지된다.
// 서버(view_prefs)는 하나: 두 기기 흉내 쪽이 같은 서버 값을 이어 받는다(state.value를 넘겨 줌).
test('[파일] 같은 계정 두 기기: 폰 앱과 PC의 출처 켜고 끄기가 서로 따로 기억되고 다시 열어도 유지', async ({ browser }) => {
  test.setTimeout(150000);
  const APP_UA = 'Mozilla/5.0 (Linux; Android 14; SM-F956N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 KPTUAndroid/0.4.15';
  const appCtx = await browser.newContext({ userAgent: APP_UA }), pcCtx = await browser.newContext();
  try {
    const app = await appCtx.newPage(), pc = await pcCtx.newPage();
    // 폰 앱: 구글 드라이브 끄기 → files_sources.app 칸에만 저장.
    const a = await start(app, 412);
    const appPrefs = await installViewPrefsServer(app);
    await openFiles(app, 412);
    await chip(app, 'gd').click();
    await expect(chip(app, 'gd')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => appPrefs.value?.files_sources).toEqual({ app: { od: true, gd: false } });

    // PC(같은 서버 값): 폰 앱에서 끈 것이 번지지 않아 둘 다 켜짐. 원드라이브를 끄면 pc 칸만 더해지고 app 칸은 그대로.
    const p = await start(pc, 1440);
    const pcPrefs = await installViewPrefsServer(pc, appPrefs.value);
    await pc.reload();
    await openFiles(pc, 1440);
    await expect(chip(pc, 'gd')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(pc, 'od')).toHaveAttribute('aria-pressed', 'true');
    await expect(roots(pc)).toHaveCount(2);
    await chip(pc, 'od').click();
    await expect(chip(pc, 'od')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => pcPrefs.value?.files_sources).toEqual({ app: { od: true, gd: false }, pc: { od: false, gd: true } });

    // 폰 앱을 다시 열면(서버 값은 PC가 바꾼 것): 폰 앱 칸 그대로 — 원드라이브 켜짐, 구글 드라이브 꺼짐.
    appPrefs.value = pcPrefs.value;
    await app.reload();
    await openFiles(app, 412);
    await expect(chip(app, 'od')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(app, 'gd')).toHaveAttribute('aria-pressed', 'false');
    // PC도 다시 열면 PC 칸 그대로 — 원드라이브 꺼짐, 구글 드라이브 켜짐.
    await pc.reload();
    await openFiles(pc, 1440);
    await expect(chip(pc, 'od')).toHaveAttribute('aria-pressed', 'false');
    await expect(chip(pc, 'gd')).toHaveAttribute('aria-pressed', 'true');
    await expect(roots(pc)).toHaveCount(1);
    await expect(roots(pc).first()).toContainText('구글 드라이브');
    expect(a.errors).toEqual([]);
    expect(p.errors).toEqual([]);
  } finally { await appCtx.close(); await pcCtx.close(); }
});

// S49-26 FILES-통합 1-②: [최근]은 켜진 출처를 서버(app_cloud_find_in p_sources)로 넘겨 받은 줄만 그린다(화면에서 덮어 거르지 않음).
for (const width of [412, 884, 1440]) {
  test(`[파일] ${width}폭: [최근]은 켜진 출처만 서버에 물어 그대로 보이고, 출처를 바꾸면 다시 묻는다`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    await installViewPrefsServer(page);
    await openFiles(page, width);
    const lastFind = () => server.calls.filter(c => c.what === 'app_cloud_find_in').at(-1)?.body;
    const list = root(page).locator('[data-fx-list]');
    await expect.poll(lastFind).toEqual({ p_sources: ['od', 'gd'], p_query: null, p_shelf: 'recent', p_limit: 200 });
    await expect(list.locator('[data-fx-row^="gd:"]').first()).toBeVisible();
    await expect(list.locator('[data-fx-row^="od:"]').first()).toBeVisible();
    await chip(page, 'od').click();
    await expect.poll(lastFind).toEqual({ p_sources: ['gd'], p_query: null, p_shelf: 'recent', p_limit: 200 });
    await expect(list.locator('[data-fx-row^="od:"]')).toHaveCount(0);
    await expect(list.locator('[data-fx-row^="gd:"]').first()).toBeVisible();
    await chip(page, 'od').click();
    await chip(page, 'gd').click();
    await expect.poll(lastFind).toEqual({ p_sources: ['od'], p_query: null, p_shelf: 'recent', p_limit: 200 });
    await expect(list.locator('[data-fx-row^="gd:"]')).toHaveCount(0);
    await expect(list.locator('[data-fx-row^="od:"]').first()).toBeVisible();
    // 찾는 중에 출처를 바꾸면 켜진 출처로 다시 찾는다.
    await root(page).locator('[data-fx-search]').fill('가짜');
    await expect.poll(lastFind).toEqual({ p_sources: ['od'], p_query: '가짜', p_shelf: null, p_limit: 200 });
    await chip(page, 'gd').click();
    await expect.poll(lastFind).toEqual({ p_sources: ['od', 'gd'], p_query: '가짜', p_shelf: null, p_limit: 200 });
    expect(errors).toEqual([]);
  });
}

test('[파일] 폰 412: [최근]을 못 읽으면 \'불러오지 못했습니다\' 옆에 작은 글자로 까닭 + [다시]', async ({ page }) => {
  const { errors, server } = await start(page, 412);
  await installViewPrefsServer(page);
  server.findFail = { status: 500, message: 'canceling statement due to statement timeout' };
  await openFiles(page, 412).catch(() => {});
  const fail = root(page).locator('[data-fx-list] [data-wait-fail]');
  await expect(fail).toContainText('불러오지 못했습니다');
  await expect(fail.locator('[data-wait-reason]')).toHaveText('· 서버 시간 초과');
  expect(await fail.textContent()).not.toContain('canceling');
  // [다시]를 누르면 다시 읽고, 이번엔 된다.
  server.findFail = null;
  await fail.locator('[data-fx-retry]').click();
  await expect(root(page).locator('[data-fx-list] [data-fx-row]').first()).toBeVisible();
  expect(errors.filter(e => !/500/.test(e))).toEqual([]);
});
