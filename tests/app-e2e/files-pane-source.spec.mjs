import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S52-07 FILES-칸출처고르기(명진 결정 11/07 "모두 추천대로": 칸 머리 '원드라이브 ▾' 이름 → 목록, 고른 출처는 서버에 기억;
// 시안 docs/design/mockups/morning-1107/4-files-pane-source.html 1-A, 설계 docs/design/files-pane-source.md).
// 두 칸 [파일]의 칸 머리마다 출처 이름 ▾ → 네 줄(원드라이브·구글 드라이브·이 폰·내 PC). 이 기기에서 못 쓰는 출처는 흐리게 + 이유.
// 고르면 그 칸만 그 출처 맨 위. 고른 값은 서버 view_prefs.files_panes.<기기> = [첫 칸, 둘째 칸](migration 20261107110000).
// DB 적용 전(서버가 그 칸을 거절)에도 칸은 그 자리에서 바뀌고, 기기 저장소에는 남기지 않는다. 서버는 흉내(파일 이름은 모두 가짜).
const root = page => page.locator('#filesRoot');
const pane = (page, i) => root(page).locator(`[data-fx-pane-i="${i}"]`);
const head = (page, i) => pane(page, i).locator('.fx-ptop [data-fx-psrc]');
const pick = (page, i, src) => pane(page, i).locator(`[data-fx-psrc-pick="${src}"]`);
const SHOTS = process.env.FILES_PANE_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
async function begin(page, width, value, { denyKeys = [] } = {}) {
  const { errors, server } = await start(page, width);
  const prefs = await installViewPrefsServer(page, value || null);
  prefs.denyKeys = denyKeys; // 서버 검사가 아직 모르는 칸(DB 적용 전)
  await page.reload();
  return { errors, server, prefs };
}
const storageKeys = page => page.evaluate(() => { const out = []; try { for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); } catch {} return out.filter(k => /pane|files_panes/i.test(k)); });

test('폴드 884: 칸 머리 이름 ▾ → 네 줄 목록(못 쓰는 출처는 흐리게 + 이유) → 그 칸만 바뀜 · 서버 기억 · 다시 열면 그 출처', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, prefs } = await begin(page, 884, { files_two: { pc: { fold: true } } });
  await openFiles(page, 884, { two: true });
  await expect(root(page)).toHaveAttribute('data-fx-two', 'fold');
  // 처음은 지금 규칙 그대로: 왼쪽 = 켜진 첫 출처, 오른쪽 = 다른 출처. 칸 머리 이름이 출처(위치 줄에 같은 이름을 또 쓰지 않음).
  await expect(head(page, 0)).toContainText('원드라이브');
  await expect(head(page, 1)).toContainText('구글 드라이브');
  await expect(pane(page, 1).locator('.fx-ptop .fx-crumb-now')).toHaveCount(0);
  await expect(head(page, 1)).toHaveAttribute('aria-expanded', 'false');
  // 오른쪽 칸 머리를 누르면 네 줄. 지금 출처에 ✓, 이 폰(폰 앱 아님)·내 PC(PC 앱 문 없음)는 흐리게 + 이유.
  await head(page, 1).click();
  await expect(head(page, 1)).toHaveAttribute('aria-expanded', 'true');
  const items = pane(page, 1).locator('[data-fx-psrc-pick]');
  await expect(items).toHaveCount(4);
  await expect(items.locator('.fx-psrc-name')).toHaveText(['원드라이브', '구글 드라이브', '이 폰', '내 PC']);
  await expect(pick(page, 1, 'gd')).toHaveAttribute('aria-current', 'true');
  await expect(pick(page, 1, 'od')).toBeEnabled();
  await expect(pick(page, 1, 'ph')).toBeDisabled();
  await expect(pick(page, 1, 'ph').locator('.fx-psrc-why')).toHaveText('폰 앱에서만');
  await expect(pick(page, 1, 'pc')).toBeDisabled();
  await expect(pick(page, 1, 'pc').locator('.fx-psrc-why')).not.toHaveText('');
  await shot(page, 'files-pane-source-884');
  // 원드라이브를 고르면 오른쪽 칸만 원드라이브 맨 위(양쪽 같은 출처 가능). 목록은 닫힘. 왼쪽은 그대로.
  await pick(page, 1, 'od').click();
  await expect(pane(page, 1).locator('[data-fx-psrc-menu]')).toHaveCount(0);
  await expect(head(page, 1)).toContainText('원드라이브');
  await expect(pane(page, 1).locator('[data-fx-row="od:OD!1"]')).toBeVisible();
  await expect(head(page, 0)).toContainText('원드라이브');
  await expect.poll(() => prefs.value?.files_panes).toEqual({ pc: ['od', 'od'] });
  // 왼쪽 칸을 구글 드라이브로 → [구글 드라이브, 원드라이브].
  await head(page, 0).click();
  await pick(page, 0, 'gd').click();
  await expect(head(page, 0)).toContainText('구글 드라이브');
  await expect(pane(page, 0).locator('[data-fx-row="gd:gdFolder1"]')).toBeVisible();
  await expect.poll(() => prefs.value?.files_panes).toEqual({ pc: ['gd', 'od'] });
  // 폴더 안으로 들어가면 위치 줄은 출처 다음 단계부터(‹ 위 폴더 + 폴더 이름).
  await pane(page, 0).locator('[data-fx-row="gd:gdFolder1"]').click();
  await expect(pane(page, 0).locator('.fx-ptop .fx-crumb-now')).toHaveText('가짜 업무 공간');
  await expect(pane(page, 0).locator('.fx-ptop .fx-crumb-step')).toHaveCount(0);
  // 다시 열면 기억한 출처에서 시작.
  await page.reload();
  await openFiles(page, 884, { two: true });
  await expect(head(page, 0)).toContainText('구글 드라이브');
  await expect(head(page, 1)).toContainText('원드라이브');
  await expect(pane(page, 1).locator('[data-fx-row="od:OD!1"]')).toBeVisible();
  expect(await storageKeys(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('PC 1440: 기억한 두 칸 출처로 시작 · Esc·밖 누르기로 목록 닫기 · 키보드로 고르기', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, prefs } = await begin(page, 1440, { files_two: { pc: { wide: true } }, files_panes: { pc: ['gd', 'od'] } });
  await openFiles(page, 1440);
  await expect(root(page)).toHaveAttribute('data-fx-two', 'wide');
  await expect(head(page, 0)).toContainText('구글 드라이브');
  await expect(head(page, 1)).toContainText('원드라이브');
  // Esc로 닫으면 칸 머리 단추로 돌아온다.
  await head(page, 1).click();
  await expect(pick(page, 1, 'od')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pane(page, 1).locator('[data-fx-psrc-menu]')).toHaveCount(0);
  await expect(head(page, 1)).toBeFocused();
  // 목록 밖을 누르면 닫힌다.
  await head(page, 0).click();
  await expect(pick(page, 0, 'gd')).toBeVisible();
  await pane(page, 1).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
  await expect(pane(page, 0).locator('[data-fx-psrc-menu]')).toHaveCount(0);
  // 키보드: 열면 첫 쓸 수 있는 줄에 포커스, Tab으로 다음 줄, Enter로 고름.
  await head(page, 1).focus();
  await page.keyboard.press('Enter');
  await expect(pick(page, 1, 'od')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(pick(page, 1, 'gd')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(head(page, 1)).toContainText('구글 드라이브');
  await expect.poll(() => prefs.value?.files_panes).toEqual({ pc: ['gd', 'gd'] });
  expect(errors).toEqual([]);
});

test('폰 412: 위·아래 두 칸도 칸 머리 이름 ▾ · 아래 칸만 바뀜 · 폰 브라우저 칸에 기억', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, prefs } = await begin(page, 412, { files_two: { phone: { narrow: true } } });
  await openFiles(page, 412);
  await expect(root(page)).toHaveAttribute('data-fx-two', 'phone');
  await expect(head(page, 0)).toContainText('원드라이브');
  await expect(head(page, 1)).toContainText('구글 드라이브');
  await head(page, 1).click();
  await expect(pick(page, 1, 'ph').locator('.fx-psrc-why')).toHaveText('폰 앱에서만');
  // 목록은 칸 머리 아래 한 줄을 통째로 쓴다(화면 밖으로 나가지 않음).
  const box = await pane(page, 1).locator('[data-fx-psrc-menu]').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(413);
  await shot(page, 'files-pane-source-412');
  await pick(page, 1, 'od').click();
  await expect(head(page, 1)).toContainText('원드라이브');
  await expect(pane(page, 1).locator('[data-fx-row="od:OD!1"]')).toBeVisible();
  await expect(head(page, 0)).toContainText('원드라이브');
  await expect.poll(() => prefs.value?.files_panes).toEqual({ phone: ['od', 'od'] });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('DB 적용 전(서버가 files_panes 거절): 칸은 그 자리에서만 바뀌고 오류 없이, 기기 저장도 없음 · 다시 열면 지금 규칙', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, prefs } = await begin(page, 884, { files_two: { pc: { fold: true } } }, { denyKeys: ['files_panes'] });
  await openFiles(page, 884, { two: true });
  await head(page, 1).click();
  await pick(page, 1, 'od').click();
  await expect(head(page, 1)).toContainText('원드라이브');
  await expect(pane(page, 1).locator('[data-fx-row="od:OD!1"]')).toBeVisible();
  // 서버 값은 그대로(두 칸 켬만), 거절 뒤에도 칸은 그대로.
  await page.waitForTimeout(1200);
  expect(prefs.value?.files_panes).toBeUndefined();
  expect(prefs.value?.files_two).toEqual({ pc: { fold: true } });
  await expect(head(page, 1)).toContainText('원드라이브');
  expect(await storageKeys(page)).toEqual([]);
  await page.reload();
  await openFiles(page, 884, { two: true });
  await expect(head(page, 1)).toContainText('구글 드라이브');
  expect(errors).toEqual([]);
});
