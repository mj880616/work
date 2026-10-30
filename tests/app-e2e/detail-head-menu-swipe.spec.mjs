import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { noteTrash } from './helpers/note-trash.mjs';

// UI-머리줄겹침 · UI-메뉴잘림 · UI-목록밀기(2026-10-30 요청함, 명진 결정 "같이"). Supabase 응답만 합성하고 실제 앱을 Chromium에서 누른다.
// [1] 위에 다른 칸(공유 받기 칸 등)이 떠 있어도 업데이트·노트 상세의 '‹ 정리함 … ⋯' 줄이 그 위에 포개지지 않는다(폰 412·폴드 884).
// [2] 정리함 업데이트 줄 ⋯ 메뉴가 [삭제]까지 안쪽 스크롤 없이 다 보이고, [삭제]는 맨 끝에 선으로 나뉜다(412·884).
// [3] 폰 목록 줄 밀기: 왼쪽으로 밀기 [삭제](휴지통 + 위쪽 '지웠어요 [되돌리기]'), 오른쪽으로 밀기 대표 처리(업데이트 [보류로], 노트 [고정]).
//     조금 밀면 버튼만 보이고 멈추고, 끝까지 밀면 바로 실행한다. 폴드 펼친 폭(884)은 ⋯·우클릭 메뉴만(밀기 없음).
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co', stamp = '2026-10-06T01:00:00Z';
const A = '10000000-0000-4000-8000-0000000000a1', B = '10000000-0000-4000-8000-0000000000b2';

async function routes(page, rows, trash) {
  const writes = [];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'))
      && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'))
      && (!q.has('metadata->>pinned_at') || (q.get('metadata->>pinned_at') === 'is.null' ? x.metadata.pinned_at == null : 'eq.' + x.metadata.pinned_at === q.get('metadata->>pinned_at')));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ method: 'PATCH', query: Object.fromEntries(q), body }); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, body, { updated_at: '2026-10-06T05:00:00Z' })); return r.fulfill({ json: hit }); }
    if (req.method() === 'DELETE') { writes.push({ method: 'DELETE', query: Object.fromEntries(q) }); const hit = rows.filter(pick); hit.forEach(x => { rows.splice(rows.indexOf(x), 1); trash.take(x, 0); }); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') || q.has('google_task_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  for (const t of ['app_documents', 'app_suborganizations', 'app_suborganization_assignees', 'app_spaces']) await page.route(SB + '/rest/v1/' + t + '?**', r => r.fulfill({ json: [] }));
  return writes;
}
async function updates(page, width) {
  await page.setViewportSize({ width, height: width < 761 ? 800 : 700 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const trash = await noteTrash(page, SB);
  const base = { workspace_id: 'w', kind: 'basket', title: null, created_at: stamp, updated_at: stamp, archived_at: null, ai_export_allowed: true, metadata: {}, attachments: [] };
  const rows = [
    { ...base, id: A, raw_text: '합성 교섭 결과 공유\n다음 회의 10/27', occurred_at: '2026-10-06T03:00:00Z' },
    { ...base, id: B, raw_text: '합성 둘째 업데이트', occurred_at: '2026-10-06T02:00:00Z' },
  ];
  const writes = await routes(page, rows, trash);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(page.locator(`[data-basket-row="${A}"]`)).toBeVisible();
  return { rows, writes, trash, errors };
}
async function notesList(page, width) {
  await page.setViewportSize({ width, height: width < 761 ? 800 : 700 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const trash = await noteTrash(page, SB);
  const row = (id, title, raw_text, updated_at) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} });
  const rows = [row('n-one', '첫 노트', '첫 노트 글', '2026-10-16T01:00:00Z'), row('n-two', '둘째 노트', '둘째 글', '2026-10-12T01:00:00Z')];
  const writes = await routes(page, rows, trash);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-note-row]')).toHaveCount(2);
  return { rows, writes, trash, errors };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
// 위쪽에 다른 칸 하나(공유 받기 칸과 같은 자리·같은 모양: 정리함 머리 바로 아래).
const putAbove = page => page.evaluate(() => {
  const v = document.querySelector('#basketView'), box = document.createElement('div');
  box.className = 'share-intake'; box.dataset.qaAbove = ''; box.innerHTML = '<p class="share-intake-sum">공유로 받은 항목 1개</p><p class="share-intake-line"><input aria-label="메모" value="합성 메모"><button type="button">취소</button></p>';
  const head = v.querySelector('.basket-head'); if (head) head.after(box); else v.prepend(box);
});
const boxOf = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });
const overlaps = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
async function noOverlap(page, headSel) {
  const above = await boxOf(page, '[data-qa-above]'), head = await boxOf(page, headSel);
  expect(above.height).toBeGreaterThan(20); expect(head.height).toBeGreaterThan(20);
  expect(overlaps(above, head)).toBe(false);
  expect(head.top).toBeGreaterThanOrEqual(above.bottom - 0.5);
  // 위쪽 머리줄·경로 줄과도 겹치지 않는다.
  const tops = await page.evaluate(() => [...document.querySelectorAll('#appView > :is(.mobile-shell-header,.app-topline,.app-nav)')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }));
  for (const t of tops) expect(overlaps(t, head)).toBe(false);
}
// 손가락 밀기(합성 터치 포인터). dx < 0 = 왼쪽으로.
async function swipe(locator, dx) {
  await expect(locator).toBeVisible();
  const b = await locator.boundingBox();
  await locator.evaluate((el, { dx, x, y }) => {
    const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
    fire('pointerdown', x); for (let i = 1; i <= 10; i++) fire('pointermove', x + dx * i / 10); fire('pointerup', x + dx);
  }, { dx, x: b.x + b.width / 2, y: b.y + b.height / 2 });
}

for (const width of [412, 884]) {
  test(`[1] 위에 다른 칸이 있어도 업데이트 상세 머리 줄이 겹치지 않음 ${width}`, async ({ page }) => {
    const f = await updates(page, width);
    await putAbove(page);
    await press(page, page.locator(`[data-basket-row="${A}"]`), width);
    const head = '[data-basket-detail] > .basket-detail-head';
    await expect(page.locator(head).locator('.basket-back')).toHaveText('‹ 정리함');
    await noOverlap(page, head);
    // 위 칸이 없을 때도 첫 줄은 화면 위쪽 그대로(빈 띠 없음): 폰은 비어 버린 위 머리줄을 접는다.
    if (width < 761) await expect(page.locator('#appView > .mobile-shell-header')).toBeHidden();
    expect(f.errors).toEqual([]);
  });
  test(`[1] 위에 다른 칸이 있어도 노트 상세 머리 줄이 겹치지 않음 ${width}`, async ({ page }) => {
    const f = await notesList(page, width);
    await putAbove(page);
    await press(page, page.locator('[data-note-row="n-one"]'), width);
    const head = '[data-note-detail] > .basket-detail-head';
    await expect(page.locator('[data-note-detail]')).toBeVisible();
    await expect(page.locator(head)).toBeVisible();
    await noOverlap(page, head);
    expect(f.errors).toEqual([]);
  });
  test(`[2] 업데이트 줄 ⋯ 메뉴는 [삭제]까지 다 보이고 [삭제]는 맨 끝, 선으로 나뉨 ${width}`, async ({ page }) => {
    const f = await updates(page, width);
    // 화면 아래쪽 줄에서 열어도(위·아래 중 다 들어가는 쪽으로) 잘리지 않는다.
    for (const id of [A, B]) {
      await press(page, page.locator(`[data-basket-row-more="${id}"]`), width);
      const menu = page.locator('#basketRowMenu');
      await expect(menu).toBeVisible();
      const del = menu.getByRole('button', { name: '삭제', exact: true });
      await expect(menu.locator('button').last()).toHaveText('삭제');
      const fit = await menu.evaluate(el => ({ inner: el.scrollHeight - el.clientHeight, more: el.dataset.scrollBelow || '' }));
      expect(fit.inner).toBeLessThanOrEqual(1); expect(fit.more).toBe('');
      const m = await boxOf(page, '#basketRowMenu'), d = await del.boundingBox(), vh = page.viewportSize().height;
      expect(d.y).toBeGreaterThanOrEqual(m.top - 0.5); expect(d.y + d.height).toBeLessThanOrEqual(m.bottom + 0.5); expect(m.bottom).toBeLessThanOrEqual(vh);
      expect(await del.evaluate(el => getComputedStyle(el).boxShadow)).toContain('inset');
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    }
    expect(f.errors).toEqual([]);
  });
}

test('[3] 폰 업데이트 줄: 왼쪽으로 끝까지 밀면 바로 휴지통 + [되돌리기], 오른쪽으로 조금 밀면 [보류로]만 보이고 멈춤', async ({ page }) => {
  const f = await updates(page, 412);
  page.on('dialog', d => { throw new Error('묻지 않아야 함: ' + d.message()); });
  await swipe(page.locator(`[data-basket-row="${B}"]`), -320);
  await expect(page.locator(`[data-basket-row="${B}"]`)).toHaveCount(0);
  expect(f.writes.filter(w => w.method === 'DELETE')).toHaveLength(1);
  const undo = page.locator('[data-undo-notice] [data-undo-action]');
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => f.trash.restored).toEqual([B]);
  // 오른쪽으로 조금(40px 남짓 밀어 버튼 폭의 절반 넘게): 줄은 그대로, 왼쪽 끝 [보류로]가 보이고 멈춘다. 누르면 보류.
  await swipe(page.locator(`[data-basket-row="${A}"]`), 50);
  const hold = page.locator('#basketRows [data-row-swipe-act="start"]');
  await expect(hold).toHaveText('보류로');
  await expect(page.locator(`[data-basket-row="${A}"]`)).toBeVisible();
  expect(f.writes.filter(w => w.method === 'PATCH')).toHaveLength(0);
  await hold.tap();
  await expect.poll(() => f.writes.filter(w => w.method === 'PATCH').length).toBe(1);
  expect(f.writes.find(w => w.method === 'PATCH').body.archived_at).toBeTruthy();
  await expect(page.locator('#basketRows [data-row-swipe-act]')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test('[3] 폰 노트 줄: 오른쪽으로 끝까지 밀면 [고정], 왼쪽으로 조금 밀면 [삭제] → 휴지통 + [되돌리기]', async ({ page }) => {
  const f = await notesList(page, 412);
  page.on('dialog', d => { throw new Error('묻지 않아야 함: ' + d.message()); });
  await swipe(page.locator('[data-note-row="n-two"]'), 320);
  await expect.poll(() => f.writes.filter(w => w.method === 'PATCH').length).toBe(1);
  expect(f.writes.find(w => w.method === 'PATCH').body.metadata?.pinned_at).toBeTruthy();
  // 노트 보기 전환(좌우 밀기)은 일어나지 않는다: 목록 보기 그대로.
  await expect(page.locator('[data-note-row]')).toHaveCount(2);
  await swipe(page.locator('[data-note-row="n-one"]'), -50);
  const del = page.locator('[data-note-list] [data-row-swipe-act="end"]');
  await expect(del).toHaveText('삭제');
  await del.tap();
  await expect(page.locator('[data-note-row="n-one"]')).toHaveCount(0);
  const undo = page.locator('[data-undo-notice] [data-undo-action]');
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => f.trash.restored).toEqual(['n-one']);
  expect(f.errors).toEqual([]);
});

test('[3] 폴드 펼친 폭(884)은 밀기 없음: ⋯·우클릭 메뉴 그대로', async ({ page }) => {
  const f = await updates(page, 884);
  await swipe(page.locator(`[data-basket-row="${B}"]`), -320);
  await expect(page.locator(`[data-basket-row="${B}"]`)).toBeVisible();
  await expect(page.locator('[data-row-swipe-act]')).toHaveCount(0);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});
