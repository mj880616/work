import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {noteMenuAction} from './helpers/note-menu.mjs';
import {noteField, edWin, edWinText, typeInto} from './helpers/note-editor.mjs';
// NOTE-크게쓰기틀·본문칸여백(S70-38, 2026-11-25 사용자):
// ① 노트 [큰 창에서 수정] 창은 넓은 화면에서 본문 칸 틀 그대로 — 위·아래 끝이 왼쪽 메뉴 카드와 같고, 같은 둥근 모서리·테두리. 폰은 화면 전체(하단바 숨음).
// ② 노트 읽기 본문 상자는 글이 테두리에 붙지 않게 위·아래 안쪽 여백(공용 간격 토큰 --kptu-space-4)과 몇 줄짜리 최소 높이를 두고,
//    읽기 ↔ 고치기 전환 때 본문 상자 높이가 같다(흔들리지 않음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const at = '2026-10-02T01:00:00Z';
const note = (id, title, raw_text) => ({id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}});

async function fixture(page) {
  const rows = [note('n-two', '두 줄 노트', '첫 줄\n둘째 줄')], writes = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id'));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({json: []}); return r.fulfill({json: rows.filter(pick).slice(Number(q.get('offset') || 0))}); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push(body); const hit = rows.filter(pick); for (const row of hit) Object.assign(row, body); return r.fulfill({json: hit}); }
    return r.fulfill({status: 500, json: {}});
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('[data-note-host] [data-note-row]').filter({hasText: '두 줄 노트'}).click();
  await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toContainText('둘째 줄');
  return {writes, errors};
}
const readBox = page => page.locator('[data-note-detail] [data-basket-read-text]');
// The box's own outer height and the gap between its border and the first / last line of text.
const space = box => box.evaluate(el => {
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el), range = document.createRange();
  range.selectNodeContents(el);
  const lines = [...range.getClientRects()].filter(x => x.height > 0);
  const top = Math.min(...lines.map(x => x.top)), bottom = Math.max(...lines.map(x => x.bottom));
  const space4 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kptu-space-4'));
  return {height: r.height, above: top - r.top - parseFloat(cs.borderTopWidth), below: r.bottom - parseFloat(cs.borderBottomWidth) - bottom, space4};
});

for (const width of [1280, 1440]) {
  test(`① 큰 창에서 수정: 위·아래 끝이 왼쪽 메뉴 카드와 같고 같은 둥근 카드, 쓰기·저장·취소 그대로 ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 820});
    const f = await fixture(page);
    await noteMenuAction(page, 'data-note-edit');
    await expect(noteField(page)).toBeVisible();
    await page.locator('[data-note-big-write]').click();
    const win = edWin(page);
    await expect(win).toBeVisible();
    await expect(win).toHaveAttribute('data-ed-nav', 'side');
    const frame = () => page.evaluate(() => {
      const nav = document.querySelector('#appView>.app-nav'), w = document.querySelector('#edWindow'), line = document.querySelector('#appView>.app-topline');
      const n = nav.getBoundingClientRect(), b = w.getBoundingClientRect(), c = line.getBoundingClientRect();
      return {nav: [n.top, n.bottom, n.right], win: [b.top, b.bottom, b.left, b.right], col: [c.left, c.right],
        radius: [getComputedStyle(w).borderTopLeftRadius, getComputedStyle(w).borderBottomRightRadius], navRadius: getComputedStyle(nav).borderTopLeftRadius,
        border: getComputedStyle(w).borderTopWidth};
    });
    const m = await frame();
    expect(Math.abs(m.win[0] - m.nav[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(m.win[1] - m.nav[1])).toBeLessThanOrEqual(1);
    expect(m.win[2]).toBeGreaterThan(m.nav[2]);
    // 좌우는 본문 칸(머리줄)과 같은 자리.
    expect(Math.abs(m.win[2] - m.col[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(m.win[3] - m.col[1])).toBeLessThanOrEqual(1);
    expect(m.radius).toEqual([m.navRadius, m.navRadius]);
    expect(m.navRadius).not.toBe('0px');
    expect(m.border).toBe('1px');
    // 쓰기·저장 그대로: [저장]은 창을 열어 둔 채 저장하고, [취소]는 창을 닫는다.
    await typeInto(page, edWinText(page), '큰 창 틀에서 쓴 본문');
    await win.locator('[data-edw-save]').click();
    await expect(win.locator('.ed-window-status')).toHaveText('저장했어요');
    expect(f.writes.at(-1)).toMatchObject({raw_text: '큰 창 틀에서 쓴 본문'});
    await win.locator('[data-edw-cancel]').click();
    await expect(edWin(page)).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });
}

test.describe('폰 390', () => {
  test.use({hasTouch: true});
test('① 폰 390: 큰 창은 화면 전체, 하단바와 겹치지 않음', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const f = await fixture(page);
  await noteMenuAction(page, 'data-note-edit', {width: 390});
  await expect(noteField(page)).toBeVisible();
  await page.locator('[data-note-big-write]').tap();
  const win = edWin(page);
  await expect(win).toBeVisible();
  const m = await page.evaluate(() => {
    const b = document.querySelector('#edWindow').getBoundingClientRect();
    const tabs = [...document.querySelectorAll('.mobile-tabs')].filter(t => t.getClientRects().length).map(t => t.getBoundingClientRect());
    const overlap = tabs.reduce((sum, t) => sum + Math.max(0, Math.min(b.bottom, t.bottom) - Math.max(b.top, t.top)) * Math.max(0, Math.min(b.right, t.right) - Math.max(b.left, t.left)), 0);
    return {box: [b.left, b.top, b.right, b.bottom], vw: document.documentElement.clientWidth, vh: window.innerHeight, overlap, radius: getComputedStyle(document.querySelector('#edWindow')).borderTopLeftRadius};
  });
  expect(m.box[0]).toBe(0);
  expect(m.box[1]).toBe(0);
  expect(m.box[2]).toBe(m.vw);
  expect(Math.abs(m.box[3] - m.vh)).toBeLessThanOrEqual(1);
  expect(m.overlap).toBe(0);
  expect(m.radius).toBe('0px');
  await win.locator('[data-edw-cancel]').tap();
  await expect(edWin(page)).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
});

const MIN_BOX = 120; // 두 줄 노트 본문 상자 최소 높이(px): 글 두 줄(약 50px) + 위아래 여백보다 넉넉하게, 그러나 크게 늘리지 않음.
for (const width of [1280, 1440]) {
  test(`② 노트 읽기 본문 상자: 위·아래 안쪽 여백 ≥ 공용 토큰, 두 줄 노트도 최소 높이, 읽기↔고치기 높이 같음 ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    const f = await fixture(page);
    const read = await space(readBox(page));
    expect(read.space4).toBe(16);
    expect(read.above).toBeGreaterThanOrEqual(read.space4);
    expect(read.below).toBeGreaterThanOrEqual(read.space4);
    expect(read.height).toBeGreaterThanOrEqual(MIN_BOX);
    // 고치기: 같은 노트의 본문 칸(편집기 글 칸) 높이가 읽기 상자와 같다.
    await noteMenuAction(page, 'data-note-edit');
    await expect(noteField(page)).toBeVisible();
    const edit = await noteField(page).evaluate(el => el.getBoundingClientRect().height);
    expect(Math.abs(edit - read.height)).toBeLessThanOrEqual(2);
    // 취소로 읽기로 돌아와도 같은 높이.
    await page.locator('[data-note-cancel]').click();
    await expect(readBox(page)).toBeVisible();
    const back = await space(readBox(page));
    expect(Math.abs(back.height - read.height)).toBeLessThanOrEqual(2);
    expect(f.writes).toEqual([]);
    expect(f.errors).toEqual([]);
  });
}
