import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S70-21 NOTE-보드탭자리(명진 11/25 10:53, PC 노트 [보드] 사진): "여기서 이 메뉴 위치가 뜬금없음 오른쪽 보드 위쪽으로 가야할 듯 이쯤"
// · "왼쪽은 노트목록이잖아". 보드 고르기 줄([보드 이름들] [+ 새 보드])은 오른쪽 보드 칸의 머리 — 판 바로 위, 판과 같은 왼쪽 끝.
// 왼쪽 노트 목록 칸 위에는 아무것도 없고, 판 위 도구 막대(+주제…맞추기)와도 겹치지 않는다. 폰(한 칸)·전체 화면도 같다.
// 보드 이름·노트 제목은 지어낸 것.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const A = 'b1a2b3c4', B = 'b5a6b7c8';
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const server = await installViewPrefsServer(page, { note_view: 'board', note_boards: [{ id: A, name: '교섭' }, { id: B, name: '행사 준비' }], note_board: A });
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n첫 줄 내용', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n1', '가 노트', '2026-10-10T01:00:00Z', { boards: { [A]: { x: 200, y: 160, r: 1, z: 0 } } }),
    row('n2', '나 노트', '2026-10-16T01:00:00Z', { boards: { [B]: { x: 260, y: 200, r: 1, z: 0 } } }),
    row('n3', '다 노트', '2026-10-12T01:00:00Z'),
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(1);
  return { errors, server };
}
const box = l => l.boundingBox();
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const xOverlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));

// 보드 고르기 줄이 판 머리에 있다: 왼쪽 끝 ≥ 판 칸 왼쪽 끝(같은 왼쪽 끝), 아래 끝 ≤ 판 위 끝(바로 위), 도구 막대와 겹침 0.
async function checkPlace(page, { side }) {
  const bar = await box(page.locator('[data-nbb]')), scroll = await box(page.locator('[data-nb-scroll]')), tools = await box(page.locator('[data-note-board] .nb-tools'));
  expect(bar.x, '보드 고르기 줄 왼쪽 끝 ≥ 판 왼쪽 끝').toBeGreaterThanOrEqual(scroll.x - 0.5);
  expect(bar.x - scroll.x, '판과 같은 왼쪽 끝').toBeLessThanOrEqual(1);
  expect(bar.y + bar.height, '보드 고르기 줄 아래 끝 ≤ 판 위 끝').toBeLessThanOrEqual(scroll.y + 0.5);
  expect(scroll.y - (bar.y + bar.height), '판 바로 위(빈 줄 없음)').toBeLessThanOrEqual(12);
  expect(overlap(bar, tools), '도구 막대와 겹침 0').toBe(0);
  for (const c of await page.locator('[data-nbb] button').all()) { if (!(await c.isVisible())) continue; expect(overlap(await box(c), tools)).toBe(0); }
  if (side) {
    const s = await box(page.locator('[data-nbb-side]'));
    expect(xOverlap(bar, s), '노트 목록 칸과 가로로 겹치지 않음').toBe(0);
    // 왼쪽 칸은 '노트 목록' 머리부터 — 그 위에 보드 고르기 줄이 없다.
    const head = await box(page.locator('[data-nbb-side] .ft-box-head'));
    expect(head.y - s.y).toBeLessThanOrEqual(12);
    expect(s.y, '노트 목록 칸은 보드 칸 줄과 같은 높이에서 시작').toBeLessThanOrEqual(bar.y + 1);
  }
}

for (const width of [1440, 1280]) {
  test(`PC ${width}: 보드 고르기 줄은 오른쪽 보드 판 머리(같은 왼쪽 끝·판 바로 위), 노트 목록 위에는 없음 · 보드 바꾸기·새 보드 그대로`, async ({ page }) => {
    const { errors, server } = await fixture(page, width);
    await expect(page.locator('[data-nbb-side]')).toBeVisible();
    // 보드 고르기 줄은 오른쪽 칸 안에 그려진다(왼쪽 목록과 형제가 아니다).
    expect(await page.locator('[data-nbb]').evaluate(el => !!el.closest('[data-nbw-main]') && !el.closest('[data-nbb-side]'))).toBe(true);
    await checkPlace(page, { side: true });
    if (process.env.CAPTURE_DIR) await page.screenshot({ path: `${process.env.CAPTURE_DIR}/note-board-tabs-place-${width}.png` });
    // 보드 바꾸기 그대로.
    await page.locator('[data-nbb] .nbb-chip', { hasText: '행사 준비' }).click();
    await expect(page.locator('[data-nbb] .nbb-chip', { hasText: '행사 준비' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-note-board] [data-nb-card="n2"]')).toBeVisible();
    await expect.poll(() => server.value?.note_board).toBe(B);
    await checkPlace(page, { side: true });
    // [+ 새 보드] 그대로: 이름을 넣으면 새 보드가 골라지고 서버에 기억된다.
    await page.locator('[data-nbb] [data-nbb-new]').click();
    const ask = page.locator('.kptu-ask');
    await ask.waitFor({ state: 'visible' });
    await ask.locator('.kptu-ask-field').fill('새 판');
    await ask.locator('.kptu-ask-actions button').nth(1).click();
    await ask.waitFor({ state: 'detached' });
    await expect(page.locator('[data-nbb] .nbb-chip', { hasText: '새 판' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => server.value?.note_boards?.length).toBe(3);
    await checkPlace(page, { side: true });
    // 전체 화면에서도 보드 고르기 줄이 판 머리에 함께.
    await page.locator('[data-nb-full]').click();
    await expect(page.locator('[data-note-board-wrap]')).toHaveClass(/nbw-full/);
    await expect(page.locator('[data-nbb]')).toBeVisible();
    await checkPlace(page, { side: false });
    await page.locator('[data-nb-side-toggle]').click();
    await expect(page.locator('[data-nbb-side]')).toBeVisible();
    expect(overlap(await box(page.locator('[data-nbb]')), await box(page.locator('[data-nbb-side]'))), '펼친 노트 목록이 보드 고르기 줄을 덮지 않음').toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-note-board-wrap]')).not.toHaveClass(/nbw-full/);
    await checkPlace(page, { side: true });
    expect(errors).toEqual([]);
  });
}

test('폰 390: 한 칸에서도 보드 고르기 줄이 보드 판 머리 · 보드 바꾸기 · 전체 화면도 함께', async ({ page }) => {
  const { errors } = await fixture(page, 390);
  await expect(page.locator('[data-nbb-side]')).toBeHidden();
  await checkPlace(page, { side: false });
  await page.locator('[data-nbb] .nbb-chip', { hasText: '행사 준비' }).click();
  await expect(page.locator('[data-note-board] [data-nb-card="n2"]')).toBeVisible();
  await checkPlace(page, { side: false });
  await page.locator('[data-nb-full]').click();
  await expect(page.locator('[data-note-board-wrap]')).toHaveClass(/nbw-full/);
  await checkPlace(page, { side: false });
  if (process.env.CAPTURE_DIR) await page.screenshot({ path: `${process.env.CAPTURE_DIR}/note-board-tabs-place-390-full.png` });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-note-board-wrap]')).not.toHaveClass(/nbw-full/);
  expect(errors).toEqual([]);
});
