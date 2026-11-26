import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles, treeGo, enterRow } from './helpers/files-server.mjs';
import { setup as libSetup, openLibrary } from './helpers/library-multi-delete-scenario.mjs';
import { libraryTopMenu } from './helpers/library-tree.mjs';
import { visibleText } from './helpers/visible-text.mjs';
// UI-고르기막대(S69-85, 명진 11/25 00:37~00:42 "두줄로 삐져나오지 않게 … 좀더 세련되게"): 파일·자료실 고르기 막대는 공용 모양 하나.
// 폰 390·폴드 펼침 720·PC 1280에서 막대는 늘 한 줄(높이 = 목록 줄 하나 이하), 왼쪽 [✕] + 'N개', 오른쪽 테두리 없는 가벼운 단추,
// 휴지통·삭제는 맨 끝·바탕 없이 글자색만 경고색. 폭이 모자라면 아이콘만 → 덜 쓰는 것부터 ⋯ 하나로 접고, ⋯ 메뉴 항목은 그 단추와 같은 일을 한다.
// 이름은 모두 지어낸 것이다(가짜 서버).
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const DIR = 'test-results/ui-audit'; // CI가 화면 사진을 내려받을 수 있게 남긴다(app-e2e-check.yml)
const WIDTHS = [390, 720, 1280];

// 막대 실측: 높이·보이는 칸이 한 줄인지·막대 밖으로 나간 칸·맨 끝 단추·경고색.
async function measure(bar) {
  return bar.evaluate(el => {
    const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const kids = [...el.querySelectorAll('.kptu-sb-count, button.kptu-sb-act')].filter(x => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden');
    const rects = kids.map(x => x.getBoundingClientRect());
    const mids = rects.map(r => r.top + r.height / 2);
    const buttons = kids.filter(x => x.matches('button'));
    const last = buttons.at(-1), first = buttons[0];
    const danger = el.querySelector('button.kptu-sb-danger:not(.kptu-sb-folded)');
    const ink = getComputedStyle(el.querySelector('button.kptu-sb-act:not(.kptu-sb-danger):not(.kptu-sb-close)') || el).color;
    return {
      height: Math.round(b.height), midSpread: Math.max(...mids) - Math.min(...mids),
      outside: rects.filter(r => r.right > b.right + 1 || r.left < b.left - 1).length,
      wraps: cs.flexWrap, firstIsClose: !!first?.classList.contains('kptu-sb-close'),
      lastIsDanger: !!last?.classList.contains('kptu-sb-danger'),
      dangerColor: danger ? getComputedStyle(danger).color : null, ink,
      dangerBg: danger ? getComputedStyle(danger).backgroundColor : null,
      borders: buttons.map(x => getComputedStyle(x).borderTopWidth),
      folded: el.querySelectorAll('button.kptu-sb-folded').length, more: !!el.querySelector('.kptu-sb-more:not([hidden])'),
      labels: buttons.map(x => (x.querySelector('.kptu-act-tx')?.textContent || x.getAttribute('aria-label') || '').trim()),
    };
  });
}
// S70-64b: 자료실·노트·줄 고르기 막대는 [✕]·개수 글자가 없고 맨 왼쪽이 [전체 선택]. 파일 막대는 다음 차례(S70-64c)까지 ✕ 그대로.
function checkOneLine(m, label, {close = true} = {}) {
  expect(m.height, `${label}: 막대 높이 = 목록 줄 하나 이하`).toBeLessThanOrEqual(40);
  expect(m.midSpread, `${label}: 칸이 모두 한 줄`).toBeLessThanOrEqual(2);
  expect(m.outside, `${label}: 막대 밖으로 나간 칸 없음`).toBe(0);
  expect(m.wraps, `${label}: 줄바꿈 없음`).toBe('nowrap');
  if (close) expect(m.firstIsClose, `${label}: 맨 왼쪽은 ✕`).toBe(true);
  else { expect(m.firstIsClose, `${label}: ✕ 없음`).toBe(false); expect(m.labels[0], `${label}: 맨 왼쪽은 [전체 선택]`).toBe('전체 선택'); }
  expect(m.borders.every(w => w === '0px'), `${label}: 단추에 테두리 상자 없음`).toBe(true);
}

for (const width of WIDTHS) test(`UI-고르기막대 파일 ${width}px: 3개 고르면 '✕ 3개 · 복사 옮기기 자료실로 별표 휴지통'이 한 줄, 휴지통은 맨 끝 글자색만 경고색`, async ({ page }) => {
  test.setTimeout(60000);
  mkdirSync(DIR, { recursive: true });
  const { errors } = await start(page, width);
  await openFiles(page, width);
  await treeGo(page, 'od', '');
  const row = key => page.locator(`#filesRoot [data-fx-row="${key}"]`);
  await enterRow(page, row('od:OD!1'));
  await expect(page.locator('#filesRoot :is(.fx-crumb-now, .ft-focus-name)')).toHaveText('가짜 문서함');
  for (const k of ['od:OD!11', 'od:OD!12', 'od:OD!13']) await row(k).click({ modifiers: ['Control'] });
  const bar = page.locator('#filesRoot [data-fx-bar]');
  await expect(bar.locator('.fx-bar-t')).toHaveText('3개');
  const m = await measure(bar);
  checkOneLine(m, `파일 ${width}`);
  expect(m.lastIsDanger || m.more, '휴지통은 맨 끝(모자라면 ⋯ 안 맨 아래)').toBe(true);
  if (m.dangerColor) { expect(m.dangerColor).not.toBe(m.ink); expect(m.dangerBg, '휴지통 바탕은 비움').toBe('rgba(0, 0, 0, 0)'); }
  // 글자가 화면에서 빠져도 단추 이름은 그대로(화면 읽기·시험).
  await expect(bar.getByRole('button', { name: '복사', exact: true })).toHaveCount(1);
  await page.screenshot({ path: `${DIR}/s69-85-files-${width}.png` });
  process.stdout.write(`::notice title=select-bar files ${width}::${JSON.stringify(m)}\n`);
  // ✕ = 고르기 풀기.
  await bar.locator('[data-fx-unpick]').click();
  await expect(bar).toBeHidden();
  expect(errors).toEqual([]);
});

for (const width of WIDTHS) test(`UI-고르기막대 자료실 ${width}px: '전체 선택 폴더로 옮기기 ⋯ 삭제' 한 줄(✕·개수 글자 없음), 사업영역·담당조직·분류 바꾸기는 ⋯ 안`, async ({ page }) => {
  test.setTimeout(60000);
  mkdirSync(DIR, { recursive: true });
  const state = await libSetup(page, width);
  await openLibrary(page, BASE);
  await libraryTopMenu(page, 'select');
  const bar = page.locator('#librarySelectBar');
  await expect(bar).toBeVisible();
  await page.locator('[data-lu-pick="n1"]').click();
  await expect(page.locator('#librarySelectCount')).toHaveText('1개 선택됨');
  const m = await measure(bar);
  checkOneLine(m, `자료실 ${width}`, { close: false });
  expect(await visibleText(bar), '보이는 글에 "선택됨" 없음').not.toContain('선택됨');
  expect(m.more, '⋯가 보인다(한꺼번에 바꾸기 셋)').toBe(true);
  expect(m.lastIsDanger, '삭제는 맨 끝').toBe(true);
  expect(m.dangerColor).not.toBe(m.ink);
  await page.screenshot({ path: `${DIR}/s69-85-library-${width}.png` });
  process.stdout.write(`::notice title=select-bar library ${width}::${JSON.stringify(m)}\n`);
  // ⋯ → [분류 바꾸기] = 예전 막대의 [분류 바꾸기]와 같은 창.
  await bar.locator('.kptu-sb-more').click();
  const menu = page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('button')).toContainText(['사업영역 바꾸기', '담당조직 바꾸기', '분류 바꾸기']);
  await menu.getByRole('button', { name: '분류 바꾸기' }).click();
  await expect(page.locator('#luBulkMenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#luBulkMenu')).toBeHidden();
  // S70-64b: [✕] 없음 — PC Esc = 선택 끝내기.
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  expect(state.deletes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('UI-고르기막대 폭이 모자라면: 아이콘만 → 덜 쓰는 것부터 ⋯로 접고, ⋯ 항목은 그 단추를 누른 것과 같다', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await start(page, 390);
  await openFiles(page, 390);
  await treeGo(page, 'od', '');
  const row = key => page.locator(`#filesRoot [data-fx-row="${key}"]`);
  await enterRow(page, row('od:OD!1'));
  await row('od:OD!11').click({ modifiers: ['Control'] });
  const bar = page.locator('#filesRoot [data-fx-bar]');
  await expect(bar.locator('.fx-bar-t')).toHaveText('1개');
  // 막대 폭을 줄여(좁은 폴드 접음보다 좁게) 다시 맞춘다 — 폭이 바뀌면 저절로 맞춘다.
  await bar.evaluate(el => { el.style.width = '230px'; });
  await expect.poll(() => bar.evaluate(el => el.classList.contains('kptu-sb-icons'))).toBe(true);
  await expect(bar.locator('.kptu-sb-more')).toBeVisible();
  const m = await measure(bar);
  checkOneLine(m, '좁은 막대');
  expect(m.folded).toBeGreaterThan(0);
  // 복사는 가장 늦게 접힌다(옮기기·별표·자료실로·이름이 먼저).
  await expect(bar.locator('[data-fx-copy]')).not.toHaveClass(/kptu-sb-folded/);
  await expect(bar.locator('[data-fx-rename]')).toHaveClass(/kptu-sb-folded/);
  await bar.locator('.kptu-sb-more').click();
  const menu = page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /^이름/ }).click();
  // [이름] 단추와 같은 일: 이름 바꾸기 칸이 열린다.
  await expect(page.locator('.kptu-ask .kptu-ask-field')).toBeVisible();
  await page.keyboard.press('Escape');
  // 폭을 되돌리면 다시 글자와 함께 펼쳐진다.
  await bar.evaluate(el => { el.style.width = ''; });
  await expect.poll(() => bar.evaluate(el => el.querySelectorAll('.kptu-sb-folded').length)).toBe(0);
  expect(errors).toEqual([]);
});
