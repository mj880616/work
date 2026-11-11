import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { start, openFiles, treeGo, enterRow } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { readZip } from '../../app/weekly-hwpx/zip.mjs';
// S52-44 FILES-관리자마무리 2/2 ②(설계 docs/design/files-manager-audit.md G·H·I): 찾기 거르기(이 폴더/전체 · 종류 · 날짜 · 크기),
// 한글 미리보기(쪽 그림), ⋯ [여러 개 받기](zip), 큰 폴더는 화면 밖 줄을 그리지 않음, PC 두 칸 종류 열. 서버·클라우드는 흉내(파일 이름은 모두 가짜).
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const prev = page => root(page).locator('[data-fx-prev]');
const listRows = page => root(page).locator('[data-fx-list] [data-fx-row]');
const fake = o => ({ parent_id: null, is_folder: false, mime: null, size_bytes: 1000, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null, ...o });

async function begin(page, { width = 1440, items = [], prefs = null } = {}) {
  const { errors, server } = await start(page, width);
  await installViewPrefsServer(page, prefs);
  server.items.push(...items);
  await page.reload();
  await openFiles(page, width, { two: !!prefs?.files_two });
  return { errors, server };
}
async function search(page, q) {
  await root(page).locator('[data-fx-search]').fill(q);
  await expect(root(page).locator('[data-fx-find-bar]')).toBeVisible();
}

test('PC 1440 찾기 거르기: [이 폴더|전체] · 종류 · 날짜 · 크기 칩(작은 메뉴), 삭제하면 처음으로', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, { items: [fake({ source: 'od', item_id: 'OD!50', parent_id: 'OD!10', name: '가짜 큰 사진.jpg', mime: 'image/jpeg', size_bytes: 20 * 1024 * 1024, modified_at: '2026-10-05T01:00:00Z' })] });
  await treeGo(page, 'od', '');
  await enterRow(page, row(page, 'od:OD!1'));
  await expect(row(page, 'od:OD!11')).toBeVisible();
  await search(page, '가짜');
  const all = await listRows(page).count();
  expect(all).toBeGreaterThan(4);
  // 이 폴더(가짜 문서함과 그 안 폴더)만 → 구글 드라이브·다른 폴더 줄이 빠진다.
  const scope = root(page).locator('[data-fx-fscope]');
  await expect(scope).toHaveText(['가짜 문서함', '전체']);
  await root(page).locator('[data-fx-fscope="here"]').click();
  await expect(root(page).locator('[data-fx-fscope="here"]')).toHaveAttribute('aria-checked', 'true');
  await expect(row(page, 'gd:gdDoc1')).toHaveCount(0);
  await expect(row(page, 'od:OD!20')).toHaveCount(0);
  await expect(row(page, 'od:OD!11')).toBeVisible();
  await expect(row(page, 'od:OD!14')).toBeVisible(); // 안 폴더(가짜 2026)의 파일도
  // 종류: 사진만.
  await root(page).locator('[data-fx-fdim="kind"]').click();
  await page.locator('#rowMenu').getByRole('button', { name: '사진' }).click();
  await expect(root(page).locator('[data-fx-fdim="kind"]')).toHaveText('사진');
  await expect(root(page).locator('[data-fx-fdim="kind"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(listRows(page)).toHaveCount(1);
  await expect(row(page, 'od:OD!50')).toBeVisible();
  await expect(root(page).locator('.fx-crumb-now').first()).toHaveText('찾은 것 1');
  // 크기: 100MB 넘음 → 없음.
  await root(page).locator('[data-fx-fdim="size"]').click();
  await page.locator('#rowMenu').getByRole('button', { name: '100MB 넘음' }).click();
  await expect(root(page).locator('[data-fx-list]')).toContainText('거른 뒤 남은 것 없음');
  // 날짜 칩도 같은 메뉴(7일 안 = 시험 시계 10/06 기준).
  await root(page).locator('[data-fx-fdim="size"]').click();
  await page.locator('#rowMenu').getByRole('button', { name: '모든 크기' }).click();
  await root(page).locator('[data-fx-fdim="day"]').click();
  await page.locator('#rowMenu').getByRole('button', { name: '7일 안' }).click();
  await expect(row(page, 'od:OD!50')).toBeVisible();
  // 찾기를 지우면 거르기도 처음으로.
  await root(page).locator('[data-fx-search]').fill('');
  await expect(row(page, 'od:OD!11')).toBeVisible();
  await search(page, '가짜');
  await expect(root(page).locator('[data-fx-fdim="kind"]')).toHaveText('종류');
  await expect(root(page).locator('[data-fx-fscope="all"]')).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('PC 1440: 한글 파일 미리보기 = 쪽 그림(blob: SVG <img>), 화면 메모리에서만', async ({ page }) => {
  test.setTimeout(120000);
  const { errors, server } = await begin(page, { items: [fake({ source: 'od', item_id: 'OD!60', parent_id: 'OD!1', name: '가짜 공문.hwp', size_bytes: 20000 }),
    fake({ source: 'od', item_id: 'OD!61', parent_id: 'OD!1', name: '가짜 큰 공문.hwpx', size_bytes: 40 * 1024 * 1024 })] });
  await treeGo(page, 'od', '');
  await enterRow(page, row(page, 'od:OD!1'));
  await row(page, 'od:OD!60').click();
  const pageImg = prev(page).locator('img.fx-hwp-page').first();
  await expect(pageImg).toBeVisible({ timeout: 60000 });
  expect(await pageImg.getAttribute('src')).toMatch(/^blob:/);
  expect(await pageImg.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  expect(server.calls.some(c => c.what === 'edge' && c.action === 'media' && c.body.id === 'OD!60')).toBe(true); // 흉내 서버가 시험용 한글 파일을 줌
  // 30MB 넘는 한글은 받지 않고 한 줄.
  const before = server.calls.filter(c => c.what === 'edge' && c.action === 'media').length;
  await row(page, 'od:OD!61').click();
  await expect(prev(page)).toContainText('30MB가 넘는 한글 파일은 여기서 보지 않아요');
  await expect(prev(page).locator('img.fx-hwp-page')).toHaveCount(0);
  expect(server.calls.filter(c => c.what === 'edge' && c.action === 'media').length).toBe(before);
  expect(errors).toEqual([]);
});

test('PC 1440: 여러 개 선택한 뒤 ⋯(우클릭) [여러 개 받기] = 파일만 zip 하나(같은 이름은 번호)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await begin(page, { items: [fake({ source: 'od', item_id: 'OD!70', parent_id: 'OD!1', name: '가짜 메모.txt', mime: 'text/plain', size_bytes: 30 })] });
  await treeGo(page, 'od', '');
  await enterRow(page, row(page, 'od:OD!1'));
  await expect(row(page, 'od:OD!11')).toBeVisible();
  await row(page, 'od:OD!11').click({ modifiers: ['Control'] });
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await row(page, 'od:OD!70').click({ modifiers: ['Control'] });
  await row(page, 'od:OD!10').click({ modifiers: ['Control'] }); // 폴더는 빠진다
  await row(page, 'od:OD!13').click({ button: 'right' });
  const download = page.waitForEvent('download');
  await page.locator('#rowMenu').getByRole('button', { name: '여러 개 받기' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^가짜 문서함 \d\d-\d\d\.zip$/);
  const bytes = readFileSync(await file.path());
  const names = readZip(new Uint8Array(bytes), { inflateRaw: () => { throw new Error('압축 없음'); } }).map(e => e.name);
  expect(names.sort()).toEqual(['가짜 메모 (2).txt', '가짜 메모.txt', '가짜 안내문.pdf'].sort());
  await expect(page.getByText('3개를 zip 하나로 받았어요 (폴더 1개는 뺐어요)').first()).toBeVisible();
  expect(server.calls.filter(c => c.what === 'edge' && c.action === 'media').length).toBe(3);
  expect(errors).toEqual([]);
});

test('PC 1440: 3000개 폴더 — 화면 밖 줄은 그리지 않고(content-visibility) 끝까지 내려 선택할 수 있다', async ({ page }) => {
  test.setTimeout(120000);
  const many = Array.from({ length: 3000 }, (_, i) => fake({ source: 'od', item_id: `OD!B${i}`, parent_id: 'OD!2', name: `가짜 사진 ${String(i).padStart(4, '0')}.txt`, mime: 'text/plain', size_bytes: 10 }));
  const { errors } = await begin(page, { items: many });
  await treeGo(page, 'od', '');
  await enterRow(page, row(page, 'od:OD!2'));
  await expect(row(page, 'od:OD!B0')).toBeVisible({ timeout: 30000 }); // 흉내 서버가 3000줄 개수를 세느라 느림(화면 시간 아님)
  await expect(root(page).locator('[data-fx-list]')).toHaveAttribute('data-fx-many', '');
  // 폴더를 열면 색인 목록을 먼저 그리고, 클라우드에서 그 폴더를 바로 읽은 뒤(directRead) 목록을 한 번 더 통째로 그린다.
  // 줄을 잡은 뒤 따로 계산하면 그 사이 옛 줄이 빠져 빈 값('')이 나온다 — 찾기·계산을 한 번에(지금 붙어 있는 줄) 하고, 값이 될 때까지 상태로 기다린다.
  await expect.poll(() => page.evaluate(() => {
    const b = document.querySelector('#filesRoot [data-fx-list] [data-fx-row="od:OD!B0"]');
    return b ? getComputedStyle(b).contentVisibility : null;
  })).toBe('auto');
  const last = row(page, 'od:OD!B2999');
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(last).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 종류 열이 보이고(폴드 두 칸은 뺌) 칸 폭 끌기 금도 그대로', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, { prefs: { files_two: { pc: { wide: true } } } });
  const pane0 = root(page).locator('[data-fx-pane-i="0"]');
  await expect(pane0.locator('[data-fx-row]').first()).toBeVisible();
  await expect(pane0.locator('.fx-head span').last()).toBeVisible();
  await expect(pane0.locator('.fx-row .fx-kind').first()).toBeVisible();
  await expect(pane0.locator('.fx-head [data-col-grip]').first()).toBeAttached();
  expect(errors).toEqual([]);
});

for (const width of [412, 884]) test(`폭 ${width}: 찾기 거르기 줄이 옆으로 넘치지 않고 칩 메뉴가 같다`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, { width, items: [fake({ source: 'od', item_id: 'OD!51', parent_id: 'OD!2', name: '가짜 바다.jpg', mime: 'image/jpeg' })] });
  await search(page, '가짜');
  const bar = root(page).locator('[data-fx-find-bar]');
  const box = await bar.boundingBox();
  expect(box.width).toBeLessThanOrEqual(width);
  expect(await bar.evaluate(b => b.scrollWidth <= b.clientWidth + 1)).toBe(true);
  await root(page).locator('[data-fx-fdim="kind"]').click();
  await page.locator('#rowMenu').getByRole('button', { name: '사진' }).click();
  await expect(root(page).locator('[data-fx-list] [data-fx-row]:visible')).toHaveCount(2); // 가짜 현장.jpg · 가짜 바다.jpg
  expect(errors).toEqual([]);
});
