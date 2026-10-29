import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// NOTE-보기3가지 (요청함 10/29 15:05, 명진 15:10 '추천대로'): 노트 검색 칸 오른쪽 [폴더|목록|포스트잇].
// 목록 = 모든 노트 최근 고친 순 한 줄(폴더 꼬리표·날짜), 포스트잇 = 넓은 보드 위 같은 크기 칸(제목·앞 줄·폴더 이름), 끌어 놓으면
// metadata.board로 서버 저장(처음 옮길 때 아직 자리 없는 칸도 보이던 자리로 함께), 끈 칸은 맨 위. 검색은 세 보기 모두. 폰 412·884, PC 1440. 이름은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const F = '00000000-0000-4000-8000-000000000001';
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n첫 줄 내용\n둘째 줄', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n1', '가 노트', '2026-10-10T01:00:00Z', { folder_id: F }),
    row('n2', '나 노트', '2026-10-16T01:00:00Z'),
    row('n3', '다 노트', '2026-10-12T01:00:00Z', { folder_id: F }),
  ];
  const folders = [{ id: F, workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ id: (q.get('id') || '').slice(3), body }); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { rows, writes, errors };
}
const view = (page, name) => page.locator(`.nv-switch [data-note-view="${name}"]`);
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };

for (const width of [412, 884, 1440]) {
  test(`세 보기 전환·목록 순서·포스트잇 칸·검색 (${width})`, async ({ page }) => {
    const { errors } = await fixture(page, width);
    await expect(view(page, 'folder')).toHaveAttribute('aria-pressed', 'true');
    const head = await page.locator('.note-list-head').boundingBox(), sw = await page.locator('.nv-switch').boundingBox();
    expect(sw.height).toBeLessThanOrEqual(34); expect(sw.y + sw.height).toBeLessThanOrEqual(head.y + head.height + 1);
    // 목록: 최근 고친 순(나 → 다 → 가), 폴더 노트에만 꼬리표.
    await press(page, view(page, 'list'), width);
    await expect(view(page, 'list')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-nx-tree]')).toBeHidden();
    await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(3);
    await expect(page.locator('#noteRows .basket-title-text')).toHaveText(['나 노트', '다 노트', '가 노트']);
    await expect(page.locator('#noteRows [data-nx-note="n3"] .nx-path')).toHaveText('회의');
    await expect(page.locator('#noteRows [data-nx-note="n2"] .nx-path')).toHaveCount(0);
    // 포스트잇: 같은 크기 칸 3장, 제목·앞 줄·폴더 이름.
    await press(page, view(page, 'board'), width);
    const cards = page.locator('[data-note-board] [data-nb-card]');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('[data-nx-body]')).toBeHidden();
    await expect(page.locator('[data-nb-card="n1"] .nb-title')).toHaveText('가 노트');
    await expect(page.locator('[data-nb-card="n1"] .nb-text')).toContainText('첫 줄 내용');
    await expect(page.locator('[data-nb-card="n1"] .nb-folder')).toHaveText('회의');
    const sizes = await cards.evaluateAll(list => list.map(el => [el.offsetWidth, el.offsetHeight]));
    expect(new Set(sizes.map(s => s.join('x'))).size).toBe(1);
    expect(await page.locator('[data-nb-card="n1"]').getAttribute('data-tone')).toBe(await page.locator('[data-nb-card="n3"]').getAttribute('data-tone'));
    expect(await page.locator('[data-nb-card="n2"]').getAttribute('data-tone')).toBe('none');
    // 검색은 포스트잇에서도.
    await page.locator('[data-note-search]').fill('다 노트');
    await expect(cards).toHaveCount(1);
    await page.locator('[data-note-search]').fill('');
    await expect(cards).toHaveCount(3);
    // [＋][－]
    const before = await page.locator('[data-nb-sizer]').evaluate(el => el.offsetWidth);
    await press(page, page.locator('[data-nb-zoom="1"]'), width);
    expect(await page.locator('[data-nb-sizer]').evaluate(el => el.offsetWidth)).toBeGreaterThan(before);
    // 한 번 누르면 노트 열기.
    await press(page, page.locator('[data-nb-card="n2"] .nb-open'), width);
    await expect(page.locator('[data-note-detail]')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('포스트잇 끌어 놓기: 서버 저장(처음엔 모두), 끈 칸이 맨 위, 다시 그려도 그 자리 (1440)', async ({ page }) => {
  const { writes, errors } = await fixture(page, 1440);
  await view(page, 'board').click();
  const card = page.locator('[data-nb-card="n1"]');
  const z = el => el.evaluate(n => Number(n.style.zIndex));
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40); await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120, { steps: 6 }); await page.mouse.move(box.x + 240, box.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => writes.filter(w => w.body?.metadata?.board).length).toBe(3);
  const moved = writes.find(w => w.id === 'n1' && w.body.metadata.board).body.metadata.board;
  expect(Object.keys(moved).sort()).toEqual(['r', 'x', 'y', 'z']);
  for (const w of writes) expect(w.body.updated_at).toBeUndefined(); // 옮기기는 고치기가 아니다
  const others = await Promise.all(['n2', 'n3'].map(id => z(page.locator(`[data-nb-card="${id}"]`))));
  expect(await z(card)).toBeGreaterThan(Math.max(...others));
  // 끈 뒤에는 열리지 않는다.
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  // 다른 보기로 갔다 와도(다시 그림) 같은 자리.
  const left = await card.evaluate(n => n.style.left);
  await view(page, 'list').click(); await view(page, 'board').click();
  await expect(page.locator('[data-nb-card="n1"]')).toHaveCSS('left', left);
  expect(errors).toEqual([]);
});
