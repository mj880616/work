import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
// S52-27 UI-창스크롤(요청함 11/07 21:08·21:13·21:24): 노트 [폴더로 옮기기] 창(app/library-move-picker.js, 자료실·노트·News 공용).
// 원인: 창이 바깥 화면 scroll을 받아 자리를 다시 맞추는 처리(keep)가 창 안 목록 scroll까지 받아, 폰 시트의 높이 한도를 지웠다 다시 써서
// 목록 스크롤이 매번 0으로 돌아갔다. 시험: 폰·폴드에서 손가락으로 밀어 맨 아래 폴더까지 닿고 고를 수 있는지, 바깥 화면은 같이 밀리지 않는지,
// 창이 아래 바를 가리지 않는지, 폰은 찾기 칸에 저절로 초점(자판)을 주지 않는지(PC는 그대로 찾기 칸), 색 없는 폴더도 같은 폴더 그림·이름은 왼쪽.
// 폴더 이름은 모두 합성.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const N = 30;
async function fixture(page, width, height) {
  await page.setViewportSize({ width, height });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const t = '2026-10-16T01:00:00Z';
  const rows = [{ id: 'n1', workspace_id: 'w', kind: 'note', title: '가 노트', raw_text: '가 노트', occurred_at: t, created_at: t, updated_at: t, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} }];
  const folders = Array.from({ length: N }, (_, i) => ({ id: U(i + 1), workspace_id: 'w', parent_id: null, name: `시험 폴더 ${String(i + 1).padStart(2, '0')}`, sort_order: 1024 * (i + 1), color: i % 3 === 0 ? 4 : null, created_at: '2026-10-01T00:00:00Z' }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request();
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push(body); Object.assign(rows[0], body); return r.fulfill({ json: [rows[0]] }); }
    return r.fulfill({ json: rows });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: folders }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => r.fulfill({ json: [] }));
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  return { errors, writes };
}
const picker = page => page.locator('#luMovePicker');
async function openPicker(page, phone) {
  const more = page.locator('[data-note-row-more="n1"]').first();
  if (phone) await more.tap(); else await more.click();
  const move = page.locator('#noteDocMenu [data-note-folder-move]');
  if (phone) await move.tap(); else await move.click();
  await expect(picker(page)).toBeVisible();
}
// 손가락 하나로 목록 안에서 위로 밀기(CDP 터치 입력 — 브라우저의 실제 터치 스크롤 길).
async function swipeUp(page, x, y, dy) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - dy * i / 10, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
const listState = page => page.evaluate(() => { const l = document.querySelector('#luMovePicker .lu-move-list'); return { top: l.scrollTop, max: l.scrollHeight - l.clientHeight }; });

for (const [name, width, height] of [['폰', 390, 800], ['폴드 접힘', 344, 882], ['폴드 펼침', 720, 840]]) test(`폴더로 옮기기 창: 손가락으로 맨 아래 폴더까지 (${name} ${width}×${height})`, async ({ page }) => {
  const f = await fixture(page, width, height);
  await openPicker(page, true);
  // 폰: 찾기 칸에 저절로 초점이 가지 않는다(자판이 뜨지 않음). 창 자체가 초점을 받는다.
  await expect(picker(page).locator('.lu-move-find')).not.toBeFocused();
  await expect(picker(page)).toBeFocused();
  // 창은 아래 바를 가리지 않는다. S54-04 UI-고르기창버튼아래(11/08 명진 결정 B)로 이 창(노트 ⋯ [폴더로 옮기기], place 'below')은
  // 아래 시트가 아니라 누른 ⋯ 버튼 아래 작은 창으로 바뀌었다 — 아래 바 위에서 끝나는 기준은 그대로라 이 검사도 그대로 둔다.
  const geo = await page.evaluate(() => ({ p: document.querySelector('#luMovePicker').getBoundingClientRect().bottom, bar: document.querySelector('nav.mobile-tabs')?.getBoundingClientRect().top ?? innerHeight }));
  expect(geo.p).toBeLessThanOrEqual(geo.bar);
  // 처음엔 목록이 넘친다(맨 아래 폴더는 안 보임).
  expect((await listState(page)).max).toBeGreaterThan(0);
  const docBefore = await page.evaluate(() => scrollY);
  const box = await picker(page).locator('.lu-move-list').boundingBox();
  for (let i = 0; i < 12 && (await listState(page)).top < (await listState(page)).max - 1; i++) {
    const before = (await listState(page)).top;
    await swipeUp(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height - 16), Math.min(250, box.height - 40));
    await page.waitForTimeout(150);
    expect((await listState(page)).top).toBeGreaterThan(before); // 밀 때마다 실제로 내려간다(0으로 돌아가지 않음)
  }
  const s = await listState(page);
  expect(s.top).toBeGreaterThanOrEqual(s.max - 1);
  expect(await page.evaluate(() => scrollY)).toBe(docBefore); // 바깥 화면은 같이 밀리지 않는다
  // 맨 아래 폴더가 목록 칸 안에 보이고, 눌러서 고를 수 있다.
  const last = picker(page).locator('.lu-move-item', { hasText: `시험 폴더 ${N}` });
  const lb = await last.boundingBox(), list = await picker(page).locator('.lu-move-list').boundingBox();
  expect(lb.y + lb.height).toBeLessThanOrEqual(list.y + list.height + 1);
  await last.tap();
  await expect(picker(page)).toBeHidden();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].metadata.folder_id).toBe(U(N));
  expect(f.errors).toEqual([]);
});

test('폴더로 옮기기 창: 폰에서 찾기 칸을 누르면 그때 초점 · 색 없는 폴더도 폴더 그림 · 이름은 왼쪽 (390)', async ({ page }) => {
  const f = await fixture(page, 390, 800);
  await openPicker(page, true);
  const find = picker(page).locator('.lu-move-find');
  await find.tap();
  await expect(find).toBeFocused();
  // 모든 줄 앞에 폴더 그림(색 고른 폴더는 색 번호, 안 고른 폴더는 기본 노랑 = 색 번호 없음), 이름은 그림 바로 옆.
  const items = picker(page).locator('.lu-move-list .lu-move-item');
  await expect(items).toHaveCount(N);
  await expect(picker(page).locator('.lu-move-list .lu-move-item .lu-move-ico svg')).toHaveCount(N);
  await expect(items.nth(0).locator('.lu-move-ico')).toHaveAttribute('data-fc', '4');
  await expect(items.nth(1).locator('.lu-move-ico')).not.toHaveAttribute('data-fc', /./);
  const gaps = await items.evaluateAll(bs => bs.slice(0, 3).map(b => b.querySelector('.lu-move-name').getBoundingClientRect().left - b.querySelector('.lu-move-ico').getBoundingClientRect().right));
  for (const g of gaps) expect(g).toBeLessThan(20);
  expect(f.errors).toEqual([]);
});

test.describe('PC(마우스)', () => {
  test.use({ hasTouch: false });
  test('폴더로 옮기기 창: PC는 찾기 칸에 바로 초점, 바퀴로 맨 아래까지 (1280)', async ({ page }) => {
  const f = await fixture(page, 1280, 800);
  await openPicker(page, false);
  await expect(picker(page).locator('.lu-move-find')).toBeFocused();
  const box = await picker(page).locator('.lu-move-list').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 300);
  await expect.poll(async () => { const s = await listState(page); return s.top >= s.max - 1; }).toBe(true);
  await expect(picker(page).locator('.lu-move-item', { hasText: `시험 폴더 ${N}` })).toBeInViewport();
  expect(f.errors).toEqual([]);
});
});
