import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { noteTrash } from './helpers/note-trash.mjs';
import { touchDrag } from './helpers/touch-drag.mjs';
import { treeEnter } from './helpers/tree-enter.mjs';
import { answerAsk as askText } from './helpers/small-notice.mjs';

// S69-27 (명진 11/24): 노트 [폴더] 보기
// ① "폴더 밑에 바로 들어가있는 메모도 목록으로 보여야해 / 왼쪽은 목록 오른쪽에는 노트 내용" — PC·펼친 폴드 왼쪽 나무에 폴더 바로 아래 노트 줄(하위 폴더 먼저),
//    노트를 누르면 오른쪽 칸에 그 노트(나무는 그대로). 폰은 목록 → 노트 화면, 뒤로가기 = 목록.
// ② "지운 노트 어디서봐? 휴지통 보여야함" — 나무 맨 아래 '휴지통 N', 누르면 지운 노트(제목·지운 날), [되돌리기] = 원래 폴더로.
// ③ "드래그하면 드래그하는 게 보여야해. 투명하게 따라오는" — 끄는 동안 반투명 조각(제목 한 줄)이 따라오고 놓으면 사라진다.
// 이름은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const F = '00000000-0000-4000-8000-000000000001', G = '00000000-0000-4000-8000-000000000002';
async function fixture(page, width, { trashed = [] } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], deletes = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const trash = await noteTrash(page, SB);
  trashed.forEach(t => trash.take({ id: t, workspace_id: 'w', kind: 'note', title: `지운 노트 ${t}`, raw_text: '본문' }, 0));
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문 글', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n1', '가 노트', '2026-10-16T01:00:00Z', { folder_id: F }),
    row('n2', '나 노트', '2026-10-12T01:00:00Z', { folder_id: F }),
    row('n3', '다 노트', '2026-10-10T01:00:00Z'),
  ];
  const folders = [{ id: F, workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: G, workspace_id: 'w', parent_id: F, name: '궤도', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }];
  // 되돌리기: 휴지통 흉내가 돌려준 노트를 목록에 다시 넣는다(폴더 표시 그대로).
  trash.onRestore = n => { const { link_count, deleted_at, ...back } = n; rows.push(back); };
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    if (req.method() === 'DELETE') { const hit = rows.filter(pick); deletes.push(Object.fromEntries(q)); hit.forEach(x => { rows.splice(rows.indexOf(x), 1); trash.take(x, 0); }); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { rows, trash, deletes, errors };
}
const tree = page => page.locator('[data-nx-tree]');
const treeNote = (page, id) => tree(page).locator(`[data-nx-note="${id}"]`);
const detail = page => page.locator('[data-note-detail]');
async function answerAsk(page, yes) {
  const ask = page.locator('.kptu-ask');
  await ask.waitFor({ state: 'visible' });
  await ask.locator('.kptu-ask-actions button').nth(yes ? 1 : 0).click();
  await ask.waitFor({ state: 'detached' });
}

test('PC 1280: 폴더를 펼치면 하위 폴더 다음에 그 폴더 노트 줄, 노트를 누르면 오른쪽에 내용(나무는 그대로), 다른 노트로 바꾸기·Esc로 닫기', async ({ page }) => {
  const f = await fixture(page, 1280);
  await expect(treeNote(page, 'n1')).toHaveCount(0); // 접힌 폴더 안 노트는 안 보인다
  await treeEnter(tree(page).locator(`[data-nx-folder="${F}"] .ft-main`)); // T10: 넓은 화면 나무는 이름 = 오른쪽 그 폴더, 펼치기는 꺾쇠(treeEnter = 둘 다)
  await expect(treeNote(page, 'n1')).toBeVisible(); await expect(treeNote(page, 'n2')).toBeVisible();
  // 하위 폴더('궤도') 줄이 먼저, 그다음 노트.
  // S70-82: 나무 줄은 [파일]처럼 상자(.ft-box) 안 — 나무 안 차례로 본다.
  const order = await tree(page).locator('[data-nx-folder], [data-nx-note]').evaluateAll(els => els.map(el => el.dataset.nxFolder || el.dataset.nxNote));
  expect(order.indexOf(G)).toBeLessThan(order.indexOf('n1'));
  await treeNote(page, 'n1').locator('[data-note-row]').click();
  await expect(detail(page)).toBeVisible();
  await expect(detail(page).locator('[data-basket-read-text]')).toContainText('가 노트 본문 글');
  await expect(tree(page)).toBeVisible();
  expect(await detail(page).evaluate(el => !!el.closest('[data-nx-body]'))).toBe(true); // 같은 두 칸 안 오른쪽
  await expect(page.locator('.nx-pane')).toBeHidden();
  await expect(treeNote(page, 'n1')).toHaveClass(/nx-current/);
  const t = await tree(page).boundingBox(), d = await detail(page).boundingBox();
  expect(d.x).toBeGreaterThanOrEqual(t.x + t.width - 1);
  // 다른 노트를 누르면 그 노트로 바뀐다.
  await treeNote(page, 'n2').locator('[data-note-row]').click();
  await expect(detail(page).locator('[data-basket-read-text]')).toContainText('나 노트 본문 글');
  await expect(treeNote(page, 'n2')).toHaveClass(/nx-current/);
  // 접으면 숨는다(열린 노트는 그대로). S69-38: 접기는 폴더 그림(이름 누르기 = 그 폴더 열기).
  await tree(page).locator(`[data-nx-tog="${F}"]`).click();
  await expect(treeNote(page, 'n1')).toHaveCount(0);
  await expect(detail(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail(page)).toBeHidden();
  await expect(page.locator('.nx-pane')).toBeVisible();
  expect(f.errors).toEqual([]);
});

test('폰 390: 폴더 펼치기 → 노트 줄 → 누르면 노트 화면, 뒤로가기로 목록', async ({ page }) => {
  const f = await fixture(page, 390);
  await page.locator(`#noteRows [data-nx-folder="${F}"] .ft-main`).tap();
  const row = page.locator('#noteRows [data-nx-note="n1"] [data-note-row]');
  await expect(row).toBeVisible();
  await row.tap();
  await expect(detail(page)).toBeVisible();
  await expect(page.locator('[data-note-list]')).toBeHidden();
  await page.goBack();
  await expect(detail(page)).toBeHidden();
  await expect(page.locator('#noteRows [data-nx-note="n1"]')).toBeVisible();
  expect(f.errors).toEqual([]);
});

for (const width of [1280, 390]) test(`노트 삭제 → '휴지통 1' → 지운 노트 줄 → [되돌리기] → 원래 폴더에 다시 (${width})`, async ({ page }) => {
  const f = await fixture(page, width);
  const press = l => (width < 761 ? l.tap() : l.click());
  const trashRow = page.locator(width < 761 ? '#noteRows [data-nx-trash-item]' : '[data-nx-tree] [data-nx-trash-item]');
  await expect(trashRow).toContainText('휴지통');
  await expect(trashRow.locator('.ft-num')).toHaveText('0');
  // 폴더를 펼치고 노트 ⋯ [삭제].
  await treeEnter(page.locator(`${width < 761 ? '#noteRows' : '[data-nx-tree]'} [data-nx-folder="${F}"] .ft-main`), { tap: width < 761 }); // T10: 넓은 화면은 이름 + 꺾쇠
  await press(page.locator(`[data-note-row-more="n2"]`).first());
  await press(page.locator('#noteDocMenu').getByRole('button', { name: '삭제', exact: true }));
  await answerAsk(page, true);
  await expect(page.locator('[data-nx-note="n2"]')).toHaveCount(0);
  await expect(trashRow.locator('.ft-num')).toHaveText('1');
  await press(trashRow);
  const box = page.locator('[data-nx-trash]');
  await expect(box).toBeVisible();
  const line = box.locator('[data-tr-row="n2"]');
  await expect(line).toContainText('나 노트');
  await expect(line.locator('time')).toContainText('2026');
  // 시안 '마': 글자 단추·네모 ⋯ 칸 없이 그림 단추 둘(이름은 aria-label).
  await expect(line.locator('summary')).toHaveCount(0);
  await expect(line.locator('[data-tr-purge]')).toHaveAttribute('aria-label', /영구 삭제/);
  await press(line.locator('[data-tr-restore]'));
  await expect(line).toHaveCount(0);
  await expect(box.locator('[data-nxt-empty]')).toBeVisible();
  expect(f.trash.restored).toEqual(['n2']);
  // 원래 폴더('회의')에 다시 보인다.
  if (width < 761) { await page.goBack(); await expect(page.locator(`#noteRows [data-nx-note="n2"]`)).toBeVisible(); }
  else await expect(treeNote(page, 'n2')).toBeVisible();
  await expect(trashRow.locator('.ft-num')).toHaveText('0');
  expect(f.errors).toEqual([]);
});

test('PC 1280: 노트를 끄는 동안 반투명 조각(제목)이 따라오고 놓으면 사라진다, 놓을 폴더 줄은 강조', async ({ page }) => {
  const f = await fixture(page, 1280);
  await treeEnter(tree(page).locator(`[data-nx-folder="${F}"] .ft-main`)); // T10: 넓은 화면 나무는 이름 = 오른쪽 그 폴더, 펼치기는 꺾쇠(treeEnter = 둘 다)
  const src = treeNote(page, 'n1').locator('[data-note-row]'), dst = tree(page).locator(`[data-nx-folder="${G}"]`);
  const a = await src.boundingBox(), b = await dst.boundingBox();
  await page.mouse.move(a.x + 30, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 8 });
  const ghost = page.locator('[data-drag-ghost]');
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveText('가 노트');
  expect(Number(await ghost.evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(1);
  await expect(dst).toHaveClass(/nx-drop/);
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  await expect.poll(() => f.rows.find(r => r.id === 'n1').metadata.folder_id).toBe(G);
  expect(f.errors).toEqual([]);
});

test('폰 390: 노트 줄을 꾹 눌러 끄는 동안에도 같은 조각이 따라오고, 놓으면 사라진다', async ({ page }) => {
  const f = await fixture(page, 390);
  await page.locator(`#noteRows [data-nx-folder="${F}"] .ft-main`).tap();
  const src = page.locator('#noteRows [data-nx-note="n1"] [data-note-row]'), dst = page.locator(`#noteRows [data-nx-folder="${G}"]`);
  await expect(src).toBeVisible();
  let seen = null;
  await touchDrag(page, src, dst, { before: async () => { seen = await page.locator('[data-drag-ghost]').evaluate(el => ({ text: el.textContent, opacity: Number(getComputedStyle(el).opacity) })).catch(() => null); } });
  expect(seen?.text).toBe('가 노트');
  expect(seen.opacity).toBeLessThan(1);
  await expect(page.locator('[data-drag-ghost]')).toHaveCount(0);
  await expect.poll(() => f.rows.find(r => r.id === 'n1').metadata.folder_id).toBe(G);
  expect(f.errors).toEqual([]);
});

// NOTE-휴지통줄슬림(명진 11/26 "버튼도 뚱뚱하고 혼자 튀고. 무엇보다 휴지통 비우기가 없어"): 휴지통 줄은 얇은 한 줄(테두리 단추 없음), [휴지통 비우기] = 확인 → 건수만큼 영구 삭제.
for (const width of [1280, 390]) test(`휴지통 줄은 얇고 단추에 테두리가 없다 · [휴지통 비우기]: 취소하면 그대로, 확인하면 모두 사라진다 (${width})`, async ({ page }) => {
  const f = await fixture(page, width, { trashed: ['t1', 't2', 't3'] });
  const press = l => (width < 761 ? l.tap() : l.click());
  await press(page.locator(width < 761 ? '#noteRows [data-nx-trash-item]' : '[data-nx-tree] [data-nx-trash-item]'));
  const box = page.locator('[data-nx-trash]');
  const rows = box.locator('[data-tr-row]');
  await expect(rows).toHaveCount(3);
  // 얇은 줄: 높이 46px 이하, 그림 단추 ↶·휴지통X와 [휴지통 비우기]는 테두리·바탕이 없다.
  for (const r of await rows.all()) expect((await r.boundingBox()).height).toBeLessThanOrEqual(46);
  const quiet = async l => expect(await l.evaluate(e => { const c = getComputedStyle(e); return [c.borderTopWidth === '0px' || c.borderTopColor === 'rgba(0, 0, 0, 0)', c.backgroundColor]; })).toEqual([true, 'rgba(0, 0, 0, 0)']);
  await quiet(rows.first().locator('[data-tr-restore]'));
  await quiet(rows.first().locator('[data-tr-purge]'));
  await quiet(box.locator('[data-nxt-empty-all]'));
  await expect(rows.first().locator('[data-tr-restore]')).toHaveAttribute('aria-label', /되살리기/);
  await expect(rows.first().locator('[data-tr-restore]')).toHaveText('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // 취소: 아무것도 지우지 않는다.
  await press(box.locator('[data-nxt-empty-all]'));
  await page.locator('.kptu-ask').waitFor({ state: 'visible' });
  const full = (await page.locator('.kptu-ask').textContent()) || '';
  expect(full).toContain('3개');
  expect(full).toContain('되돌릴 수 없');
  await askText(page, false);
  await expect(rows).toHaveCount(3);
  expect(f.trash.purged).toEqual([]);
  // 확인: 건수만큼 영구 삭제, 목록 비고 '휴지통 비어 있음'.
  await press(box.locator('[data-nxt-empty-all]'));
  await answerAsk(page, true);
  await expect(rows).toHaveCount(0);
  await expect(box.locator('[data-nxt-empty]')).toBeVisible();
  expect(f.trash.purged.sort()).toEqual(['t1', 't2', 't3']);
  expect(f.trash.restored).toEqual([]);
  await expect(box.locator('[data-nxt-empty-all]')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

// TRASH-줄그림단추(명진 11/28 시안 '마'): 휴지통 줄을 꾹 눌러(PC는 Ctrl+클릭) 고르면 줄 앞 동그라미·위 [모두 고르기]·[취소]·아래 막대 'N개 선택 · 되살리기 · 영구 삭제'.
// 일괄도 줄마다 쓰는 서버 길 그대로(한 개씩). 고르기 줄에는 그림 단추가 없다(줄을 다시 그린다). 뒤로가기·Esc·취소로 끝.
for (const width of [1280, 412, 390]) test(`휴지통 줄 고르기 모드: 고르기 줄·막대, 일괄 되살리기·영구 삭제, 취소 (${width})`, async ({ page }) => {
  const f = await fixture(page, width, { trashed: ['t1', 't2', 't3', 't4'] });
  const phone = width < 761;
  const press = l => (phone ? l.tap() : l.click());
  await press(page.locator(phone ? '#noteRows [data-nx-trash-item]' : '[data-nx-tree] [data-nx-trash-item]'));
  const box = page.locator('[data-nx-trash]');
  const rows = box.locator('[data-tr-row]');
  await expect(rows).toHaveCount(4);
  const hold = async id => { // 폰: 0.5초 꾹 누르기, PC: Ctrl+클릭
    const r = box.locator(`[data-tr-row="${id}"] .tr-name`);
    if (!phone) return r.click({ modifiers: ['Control'] });
    // 앞 일이 끝난 뒤 목록이 다시 그려지는 사이에도 안전하게: 자리를 한 번에 재고, 줄이 바뀌었으면 다시 잰다.
    let b = null;
    await expect.poll(async () => { b = await r.evaluate(el => { el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return q.width ? { x: q.x, y: q.y } : null; }).catch(() => null); return !!b; }).toBe(true);
    await r.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: b.x + 4, clientY: b.y + 4, bubbles: true });
    await page.waitForTimeout(650);
    await r.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: b.x + 4, clientY: b.y + 4, bubbles: true });
  };
  await hold('t1');
  await expect(box.locator('.tr-pick')).toHaveCount(4);
  await expect(box.locator('[data-tr-restore],[data-tr-purge]')).toHaveCount(0); // 고르기 줄에는 그림 단추가 없다
  await expect(box.locator('[data-tr-row="t1"]')).toHaveAttribute('aria-selected', 'true');
  await expect(box.locator('[data-tr-bar] .kptu-sb-count')).toHaveText('1개 선택');
  await expect(box.locator('[data-tr-bar]').getByRole('button')).toHaveText(['되살리기', '영구 삭제']);
  await expect(box.locator('[data-tr-all]')).toBeVisible();
  await expect(box.locator('[data-tr-cancel]')).toBeVisible();
  await press(box.locator('[data-tr-row="t2"] .tr-name'));
  await expect(box.locator('[data-tr-bar] .kptu-sb-count')).toHaveText('2개 선택');
  await press(box.locator('[data-tr-row="t2"] .tr-name'));
  await expect(box.locator('[data-tr-bar] .kptu-sb-count')).toHaveText('1개 선택');
  // [모두 고르기] → 4개, 다시 누르면 모두 풀리며 고르기가 끝난다.
  await press(box.locator('[data-tr-all]'));
  await expect(box.locator('[data-tr-bar] .kptu-sb-count')).toHaveText('4개 선택');
  await press(box.locator('[data-tr-all]'));
  await expect(box.locator('[data-tr-bar]')).toHaveCount(0);
  await expect(box.locator('[data-tr-restore]')).toHaveCount(4);
  // 취소.
  await hold('t1');
  await press(box.locator('[data-tr-cancel]'));
  await expect(box.locator('[data-tr-bar]')).toHaveCount(0);
  expect(f.trash.restored).toEqual([]);
  expect(f.trash.purged).toEqual([]);
  // 일괄 되살리기(2개).
  await hold('t1');
  await press(box.locator('[data-tr-row="t3"] .tr-name'));
  await press(box.locator('[data-tr-bulk-restore]'));
  await expect(rows).toHaveCount(2);
  expect(f.trash.restored.sort()).toEqual(['t1', 't3']);
  await expect(box.locator('[data-tr-bar]')).toHaveCount(0);
  // 일괄 영구 삭제: 한 번 묻고(취소하면 그대로), 확인하면 고른 것만.
  await hold('t2');
  await press(box.locator('[data-tr-bulk-purge]'));
  await answerAsk(page, false);
  expect(f.trash.purged).toEqual([]);
  await press(box.locator('[data-tr-bulk-purge]'));
  await answerAsk(page, true);
  await expect(rows).toHaveCount(1);
  expect(f.trash.purged).toEqual(['t2']);
  expect(f.errors).toEqual([]);
});
