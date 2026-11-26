import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { readFileSync } from 'node:fs';

// S71-50 NOTE-보드배경색(사용자 2026-11-26 19:51 "보드 배경색상도 지정가능하게 해줘요"): 보드마다 바탕색.
// - PC: 보드 칸 우클릭 메뉴·빈 판 우클릭 메뉴의 '배경색'. 폰: 화면 ⋯ 메뉴의 '배경색'(보드 보기일 때).
// - 고르면 바로 바뀌고(점 무늬는 그대로), 서버 화면 기억 note_board_bg에 저장 → 새로 불러와도(다른 기기 흉내) 그대로. '기본'은 칸을 지운다.
// - 목록 밖 색은 화면이 보내지 않는다. 서버(DB 검사)가 아직 모르면(적용 전) 거절 → 기본 바탕 + 한 줄 알림.
// - HTML 내보내기에 바탕색이 함께 나간다. 이름은 지어낸 것.
test.use({ hasTouch: true });
test.describe.configure({ timeout: 60000 });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BID = 'bcolor01', BID2 = 'bcolor02';
const SAGE = 'rgb(233, 238, 227)', SKY = 'rgb(230, 237, 243)';

async function fixture(page, width, { prefs = {}, deny = false } = {}) {
  await page.setViewportSize({ width, height: 860 });
  await page.emulateMedia({ colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const server = await installViewPrefsServer(page, { note_view: 'board', note_boards: [{ id: BID, name: '색 보드' }, { id: BID2, name: '둘째 보드' }], note_board: BID, ...prefs }, deny ? { denyKeys: ['note_board_bg'] } : {});
  await openHome(page);
  const row = { id: 'n1', workspace_id: 'w', kind: 'note', title: '가 노트', raw_text: '가 노트\n본문', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { boards: { [BID]: { x: 40, y: 40, r: 1, z: 0 }, [BID2]: { x: 40, y: 40, r: 1, z: 0 } } } };
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.fulfill({ json: r.request().method() === 'GET' ? [structuredClone(row)] : [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.route(u => u.origin === SB && (u.pathname === '/rest/v1/app_note_board_texts' || u.pathname === '/rest/v1/app_note_board_links'), r => r.fulfill({ json: [] }));
  await openBoard(page);
  return { errors, server };
}
async function openBoard(page) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(1);
}
const scroll = page => page.locator('[data-note-board] [data-nb-scroll]');
const bgColor = page => scroll(page).evaluate(el => getComputedStyle(el).backgroundColor);
const dots = page => scroll(page).evaluate(el => getComputedStyle(el).backgroundImage);
// PC: 지금 보드 칸 우클릭 → 메뉴 안 색 칸. 폰: 화면 ⋯ → 메뉴 안 색 칸.
async function pick(page, width, color) {
  const label = color === null ? '기본' : { sage: '쑥', sky: '하늘', rose: '장미' }[color];
  if (width > 760) {
    await page.locator(`[data-nbb-board="${BID}"]`).click({ button: 'right' });
    const sw = page.locator(`[data-nbb-menu] .nbb-bg [role="radio"][aria-label="${label}"]`);
    await expect(sw).toBeVisible();
    await sw.click();
    await expect(page.locator('[data-nbb-menu]')).toBeHidden();
  } else {
    await page.locator('[data-note-folder-more]').click();
    const sw = page.locator(`#noteDocMenu .nbb-bg [role="radio"][aria-label="${label}"]`);
    await expect(sw).toBeVisible();
    await sw.click();
    await expect(page.locator('#noteDocMenu')).toBeHidden();
  }
}

for (const width of [1280, 390]) {
  test(`배경색 고르면 바로 바뀌고 다시 불러와도 그대로, '기본'으로 되돌리기 (${width})`, async ({ page }) => {
    const { errors, server } = await fixture(page, width);
    const plain = await bgColor(page), pattern = await dots(page);
    expect(pattern).toContain('radial-gradient');
    await pick(page, width, 'sage');
    await expect(scroll(page)).toHaveAttribute('data-nb-bg', 'sage');
    expect(await bgColor(page)).toBe(SAGE);
    expect(await dots(page)).toBe(pattern); // 점 무늬는 색 위에 그대로
    await expect.poll(() => server.value?.note_board_bg).toEqual({ [BID]: 'sage' });
    // 고른 색에 ✓(aria-checked) — 다시 연 메뉴에서.
    if (width > 760) {
      await page.locator(`[data-nbb-board="${BID}"]`).click({ button: 'right' });
      await expect(page.locator('[data-nbb-menu] .nbb-bg [aria-label="쑥"]')).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('[data-nbb-menu] .nbb-bg [aria-label="기본"]')).toHaveAttribute('aria-checked', 'false');
      await page.screenshot({ path: test.info().outputPath(`board-bg-menu-${width}.png`) });
      await page.keyboard.press('Escape');
    } else {
      await page.locator('[data-note-folder-more]').click();
      await expect(page.locator('#noteDocMenu .nbb-bg [aria-label="쑥"]')).toHaveAttribute('aria-checked', 'true');
      await page.screenshot({ path: test.info().outputPath(`board-bg-menu-${width}.png`) });
      await page.keyboard.press('Escape');
    }
    // 다른 보드는 기본 그대로.
    await page.locator(`[data-nbb-board="${BID2}"]`).click();
    await expect(scroll(page)).not.toHaveAttribute('data-nb-bg', /./);
    expect(await bgColor(page)).toBe(plain);
    await page.locator(`[data-nbb-board="${BID}"]`).click();
    await expect(scroll(page)).toHaveAttribute('data-nb-bg', 'sage');
    // 새로 불러오기(다른 기기 흉내 — 바탕색은 기기에 저장하지 않으므로 서버 값만으로 그린다).
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /board|bg/i.test(k)))).toEqual([]);
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 15000 });
    await openBoard(page);
    await expect(scroll(page)).toHaveAttribute('data-nb-bg', 'sage');
    expect(await bgColor(page)).toBe(SAGE);
    await page.screenshot({ path: test.info().outputPath(`board-bg-${width}.png`) });
    // '기본'으로 되돌리기: 칸을 지운다.
    await pick(page, width, null);
    await expect(scroll(page)).not.toHaveAttribute('data-nb-bg', /./);
    expect(await bgColor(page)).toBe(plain);
    await expect.poll(() => server.value && 'note_board_bg' in server.value).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('빈 판 우클릭 메뉴에서도 배경색, HTML 내보내기에 바탕색이 함께 나간다 (1280)', async ({ page }) => {
  const { errors, server } = await fixture(page, 1280);
  await page.locator('[data-note-board]').click({ button: 'right', position: { x: 600, y: 520 } });
  const sw = page.locator('#noteDocMenu .nbb-bg [aria-label="하늘"]');
  await expect(sw).toBeVisible();
  await sw.click();
  await expect(scroll(page)).toHaveAttribute('data-nb-bg', 'sky');
  await expect.poll(() => server.value?.note_board_bg).toEqual({ [BID]: 'sky' });
  await page.locator(`[data-nbb-board="${BID}"]`).click({ button: 'right' });
  const dl = page.waitForEvent('download');
  await page.locator('[data-nbb-menu] [data-nbb-export="html"]').click();
  const html = readFileSync(await (await dl).path(), 'utf8');
  expect(html).toContain(`<style>html,body{margin:0;background:${SKY}}`);
  expect(html).toMatch(new RegExp(`data-nb-export="" style="[^"]*background:${SKY.replace(/[()]/g, '\\$&')}`));
  const view = await page.context().newPage();
  await view.setContent(html);
  expect(await view.locator('[data-nb-export]').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(SKY);
  await view.close();
  expect(errors).toEqual([]);
});

test('목록 밖 색은 보내지 않고, 서버가 아직 모르면(적용 전) 기본 바탕 + 알림 (1280)', async ({ page }) => {
  const { errors, server } = await fixture(page, 1280, { deny: true });
  // 화면 단추를 목록 밖 값으로 바꿔 눌러도 보내지 않는다.
  await page.locator(`[data-nbb-board="${BID}"]`).click({ button: 'right' });
  const sw = page.locator('[data-nbb-menu] .nbb-bg [aria-label="장미"]');
  await sw.evaluate(el => { el.dataset.nbbBg = 'red'; });
  const before = server.patches.length;
  await sw.click();
  await expect(page.getByText('목록에 없는 색이에요.').first()).toBeVisible();
  await expect(scroll(page)).not.toHaveAttribute('data-nb-bg', /./);
  expect(server.patches.length).toBe(before);
  // 적용 전 서버: 거절 → 되돌려 기본 바탕, 한 줄 알림. 보드 목록은 그대로.
  await pick(page, 1280, 'rose');
  await expect(page.getByText('배경색은 아직 서버에 저장할 수 없어요(준비 중). 기본 바탕으로 보여요.').first()).toBeVisible();
  await expect(scroll(page)).not.toHaveAttribute('data-nb-bg', /./);
  expect(server.value?.note_board_bg).toBeUndefined();
  await expect(page.locator('[data-nbb-board]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('서버에 남은 목록 밖 색·지운 보드 색은 무시한다 (390)', async ({ page }) => {
  const { errors } = await fixture(page, 390, { prefs: { note_board_bg: { [BID]: 'neon', bgone0001: 'sky' } } });
  await expect(scroll(page)).not.toHaveAttribute('data-nb-bg', /./);
  expect(errors).toEqual([]);
});
