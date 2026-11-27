// BRIEF-열보이기·열폭끌기(명진 11/27 PC 캡처 "넣은날 크기 종류 이것도 켜고 끄고 폭 조절"): 브리핑 룸 목록 표(PC 1280·폴드 펼침)의
// ① 머리 줄 끝 '보일 칸' 단추로 넣은 날·크기·종류를 켜고 끌 수 있다(이름은 못 끔, 숨긴 칸은 줄에 그려지지 않음, 서버 view_prefs.brief_cols),
// ② 칸 오른쪽 금을 끌면 폭이 바뀌고(서버 col_widths.brief) 새로 열어도 같다(최소 폭 보장·키보드 ←/→), ③ 폰 390은 머리 줄 없이 지금 모양 그대로.
// 자료 이름·문장은 모두 예시. 서버는 흉내.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-00000000000${n}`;
const docs = [
  { id: D(1), title: '예시 연구 보고서', file_name: '예시 보고서.hwp', file_id: 'FILE_aaaaaaaaaa', file_size: 2048000, created_at: '2026-10-06T00:50:00Z' },
  { id: D(2), title: '가 예시 계획', file_name: '예시 계획.pdf', mime_type: 'application/pdf', file_id: 'FILE_bbbbbbbbbb', file_size: 5000, created_at: '2026-10-05T00:00:00Z' },
  { id: D(3), title: '나 예시 공문', file_name: '예시 공문.pdf', mime_type: 'application/pdf', file_id: 'FILE_cccccccccc', file_size: 7000, created_at: '2026-10-04T00:00:00Z' },
];
const brief = { v: 3, lead: '예시 요지', gist: ['예시 요지'], sections: [{ title: '예시 안건', items: [{ text: '예시 항목', page: 3 }] }], quotes: [] };
const briefRows = () => [D(1), D(2), D(3)].map((id, i) => ({ id: 'b' + i, document_id: id, status: 'done', stage: 'done', step_no: 3, step_total: 3, page_count: 10, brief, error_code: null, created_at: '2026-10-0' + (i + 1) + 'T00:00:00Z', updated_at: '2026-10-07T00:00:00Z', finished_at: '2026-10-07T00:00:00Z' }));

async function open(page, width = 1280, height = 860) {
  await page.setViewportSize({ width, height });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const home = await openHome(page, {
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: briefRows() }));
      await page.route(SB + '/rest/v1/app_library_folders**', r => r.request().method() === 'GET' ? r.fulfill({ json: [{ id: 'f-brief', parent_id: null, name: '브리핑 요청함', sort_order: 1, project_id: null }] }) : r.fulfill({ status: 204, body: '' }));
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => r.request().method() === 'GET' ? r.fulfill({ json: [D(1), D(2), D(3)].map(document_id => ({ document_id, folder_id: 'f-brief' })) }) : r.fulfill({ status: 204, body: '' }));
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        if (r.request().method() !== 'GET') return r.fallback();
        const want = new URL(r.request().url()).searchParams.get('id');
        const rows = want?.startsWith('in.(') ? docs.filter(d => want.slice(4, -1).split(',').includes(d.id)) : docs;
        return r.fulfill({ json: rows.map(d => ({ workspace_id: 'w', category: '기타', visibility: 'private', ...d })) });
      });
      await page.route(SB + '/functions/v1/document-actions', r => r.fulfill({ json: { ok: true } }));
    },
  });
  const show = async () => {
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    await page.waitForFunction(() => window.KPTURouter?.go);
    await page.evaluate(() => window.KPTURouter.go('brief'));
    await expect(page.locator('#briefView .br-row')).toHaveCount(3);
  };
  await show();
  return { prefs: home.prefs, errors, show };
}
const list = page => page.locator('#briefView [data-br-list]');
const head = page => list(page).locator('.br-fhead');
const headNames = page => head(page).locator('[role="columnheader"]').evaluateAll(els => els.map(e => e.dataset.brCol));
const headCell = (page, key) => head(page).locator(`[data-br-col="${key}"]`);
const rowOne = page => list(page).locator(`.br-row[data-br-open="${D(2)}"]`);
const menu = page => page.locator('#brColsMenu');
const openMenu = async page => { await head(page).locator('[data-br-cols-menu]').click(); await expect(menu(page)).toBeVisible(); };
const cellKeys = page => rowOne(page).evaluate(r => [...r.children].map(c => c.className.split(' ').find(k => /^fx-(day|size|kind)$/.test(k))).filter(Boolean));

test('PC 1280: 머리 줄 = 이름·넣은 날·크기·종류, 줄 칸이 머리 칸과 같은 자리', async ({ page }) => {
  const s = await open(page);
  expect(await headNames(page)).toEqual(['name', 'day', 'size', 'kind']);
  expect(await cellKeys(page)).toEqual(['fx-day', 'fx-size', 'fx-kind']);
  for (const [key, cls] of [['day', 'fx-day'], ['size', 'fx-size'], ['kind', 'fx-kind']]) {
    const h = await headCell(page, key).boundingBox(), c = await rowOne(page).locator('.' + cls).boundingBox();
    expect(Math.abs(h.x - c.x)).toBeLessThan(3);
    expect(Math.abs(h.width - c.width)).toBeLessThan(3);
  }
  expect(s.errors).toEqual([]);
});

test('PC 1280: 보일 칸 — 끄면 머리·줄에서 사라지고(그리지 않음) 켜면 돌아옴, 이름은 못 끔, 새로 열어도 같음(서버)', async ({ page }) => {
  const s = await open(page);
  const saved = () => s.prefs.value?.brief_cols ?? null;
  await openMenu(page);
  await expect(menu(page).locator('[data-br-col-toggle]')).toHaveText(['✓넣은 날', '✓크기', '✓종류']);
  await expect(menu(page).locator('[data-br-col-toggle="name"]')).toHaveCount(0);
  await menu(page).locator('[data-br-col-toggle="size"]').click();
  await expect(menu(page)).toBeVisible(); // 메뉴는 열린 채
  await expect(menu(page).locator('[data-br-col-toggle="size"]')).toHaveAttribute('aria-checked', 'false');
  expect(await headNames(page)).toEqual(['name', 'day', 'kind']);
  expect(await cellKeys(page)).toEqual(['fx-day', 'fx-kind']);
  await expect(list(page).locator('.fx-size')).toHaveCount(0);
  await menu(page).locator('[data-br-col-toggle="day"]').click();
  expect(await headNames(page)).toEqual(['name', 'kind']);
  await expect.poll(saved).toEqual(['kind']);
  // 줄 칸이 머리 칸 자리에 그대로 선다.
  const h = await headCell(page, 'kind').boundingBox(), c = await rowOne(page).locator('.fx-kind').boundingBox();
  expect(Math.abs(h.x - c.x)).toBeLessThan(3);
  await page.keyboard.press('Escape');
  // 새로 열어도 같은 칸.
  await page.reload(); await s.show();
  expect(await headNames(page)).toEqual(['name', 'kind']);
  // 모두 끄기 = 이름만, 줄도 그려진다.
  await openMenu(page);
  await menu(page).locator('[data-br-col-toggle="kind"]').click();
  expect(await headNames(page)).toEqual(['name']);
  await expect.poll(saved).toEqual([]);
  await expect(list(page).locator('.br-row')).toHaveCount(3);
  // [기본으로] = 서버 값 지움, 셋 다 보임.
  await menu(page).locator('[data-br-cols-reset]').click();
  await expect.poll(saved).toBeNull();
  expect(await headNames(page)).toEqual(['name', 'day', 'size', 'kind']);
  // 켜는 차례는 늘 넣은 날 → 크기 → 종류.
  await menu(page).locator('[data-br-col-toggle="kind"]').click(); await menu(page).locator('[data-br-col-toggle="day"]').click();
  expect(await headNames(page)).toEqual(['name', 'size']);
  expect(s.errors).toEqual([]);
});

test('PC 1280: 칸 숨겨도 줄 누르기·정렬은 그대로, 숨긴 칸 기준 정렬도 유지', async ({ page }) => {
  const s = await open(page);
  await head(page).locator('[data-head-sort="size"]').click();
  await expect.poll(() => s.prefs.value?.brief_sort).toEqual({ key: 'size', dir: 'asc' });
  await openMenu(page);
  await menu(page).locator('[data-br-col-toggle="size"]').click();
  await page.keyboard.press('Escape');
  expect(await headNames(page)).toEqual(['name', 'day', 'kind']);
  await expect(list(page).locator('.br-row .fx-name')).toHaveText(['가 예시 계획', '나 예시 공문', '예시 연구 보고서']);
  await head(page).locator('[data-head-sort="kind"]').click();
  await expect.poll(() => s.prefs.value?.brief_sort).toEqual({ key: 'kind', dir: 'asc' });
  expect(s.errors).toEqual([]);
});

test('PC 1280: 칸 금을 끌면 폭이 바뀌고(줄도 같이) 새로 열어도 같음(서버), 정렬은 안 됨', async ({ page }) => {
  const s = await open(page);
  const stored = () => s.prefs.value?.col_widths?.brief ?? null;
  expect(stored()).toBeNull();
  const w0 = (await headCell(page, 'day').boundingBox()).width;
  const grip = headCell(page, 'day').locator('[data-col-grip]');
  const g = await grip.boundingBox(), y = g.y + g.height / 2, x = g.x + g.width / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 20, y, { steps: 4 }); await page.mouse.move(x + 40, y, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => Math.round((await headCell(page, 'day').boundingBox()).width)).toBe(Math.round(w0 + 40));
  expect(Math.abs((await rowOne(page).locator('.fx-day').boundingBox()).width - (w0 + 40))).toBeLessThan(3);
  await expect.poll(() => stored()?.day).toBe(Math.round(w0 + 40));
  expect(s.prefs.value?.brief_sort ?? null).toBeNull(); // 금 끌기는 정렬을 바꾸지 않는다
  await page.reload(); await s.show();
  await expect.poll(async () => Math.round((await headCell(page, 'day').boundingBox()).width)).toBe(Math.round(w0 + 40));
  expect(s.errors).toEqual([]);
});

test('PC 1280: 칸 폭 최소 보장·키보드 ←/→·Home(기본으로), 이름 칸도 조절', async ({ page }) => {
  const s = await open(page);
  const grip = headCell(page, 'size').locator('[data-col-grip]');
  const w0 = (await headCell(page, 'size').boundingBox()).width;
  await grip.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.round((await headCell(page, 'size').boundingBox()).width)).toBe(Math.round(w0 + 8));
  await expect.poll(() => s.prefs.value?.col_widths?.brief?.size).toBe(Math.round(w0 + 8));
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft');
  const min = Number(await grip.getAttribute('aria-valuemin'));
  await expect.poll(() => s.prefs.value?.col_widths?.brief?.size).toBe(min);
  expect((await headCell(page, 'size').boundingBox()).width).toBeGreaterThanOrEqual(min - 1);
  await page.keyboard.press('Home');
  await expect.poll(() => s.prefs.value?.col_widths?.brief ?? null).toBeNull();
  // 이름 칸 금도 있다.
  const nameGrip = headCell(page, 'name').locator('[data-col-grip]');
  await expect(nameGrip).toHaveCount(1);
  const n0 = (await headCell(page, 'name').boundingBox()).width;
  await nameGrip.focus(); await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Math.round((await headCell(page, 'name').boundingBox()).width)).toBe(Math.round(n0 - 8));
  expect(s.errors).toEqual([]);
});

test('폴드 펼침 690: 켠 칸만 머리·줄에 그려진다', async ({ page }) => {
  const s = await open(page, 690, 900);
  await openMenu(page);
  await menu(page).locator('[data-br-col-toggle="kind"]').click();
  await page.keyboard.press('Escape');
  expect((await headNames(page)).includes('kind')).toBe(false);
  await expect(list(page).locator('.fx-kind')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(s.errors).toEqual([]);
});

test('폰 390: 머리 줄·보일 칸 단추 없음, 줄은 지금 모양(이름 / 넣은 날 · 크기 · 종류)', async ({ page }) => {
  const s = await open(page, 390, 800);
  await expect(head(page)).toHaveCount(0);
  await expect(list(page).locator('[data-br-cols-menu]')).toHaveCount(0);
  await expect(rowOne(page).locator('.fx-sub')).toBeVisible();
  await expect(rowOne(page).locator('.fx-sub')).toContainText('PDF');
  expect(s.errors).toEqual([]);
});
