import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { expectStickyBand } from './helpers/ed-stick.mjs';

// NOTE-제목서식줄고정(S61-16 ②, 요청함 11/12 15:03): 노트를 고칠 때 제목 칸 + 서식 줄이 한 묶음(.ed-stick)으로 화면 위(PC는 맨 위 줄 바로
// 아래 --kptu-stick-top, 폰은 맨 위)에 붙고 본문만 넘어간다. 원인: 서식 줄이 top:0에 붙어 PC 고정 맨 위 줄 뒤로 들어가 가려졌다(제목은 붙는 규칙 없음).
// 큰 쓰기 창은 창 안 스크롤 맨 위, 폰 키보드가 올라와(화면 높이가 줄어도) 띠가 보인다. [⌄] 펼친 줄·떠 있는 메뉴도 가리지 않는다.
test.use({hasTouch: true});
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const long = Array.from({length: 90}, (_, i) => '줄 ' + (i + 1)).join('\n\n');

async function openLongNote(page, width, height = 800) {
  await page.setViewportSize({width, height});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const rows = [{id: 'n1', workspace_id: 'w', kind: 'note', title: '긴 노트', raw_text: long, occurred_at: '2026-11-12T01:00:00Z', created_at: '2026-11-12T01:00:00Z', updated_at: '2026-11-12T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}}];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => { const q = new URL(r.request().url()).searchParams; if (q.get('metadata')) return r.fulfill({json: []}); if (r.request().method() !== 'GET') return r.fulfill({status: 500, json: {}}); return r.fulfill({json: rows.filter(x => !q.get('id') || 'eq.' + x.id === q.get('id'))}); });
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await openKindMenu(page, 'note');
  const press = async l => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
  await press(basketKindButton(page, 'note'));
  await press(page.locator('[data-note-row="n1"]').first());
  await noteMenuAction(page, 'data-note-edit', {width});
  await expect(page.locator('[data-note-body-field] .ProseMirror')).toBeVisible();
  return {errors, press};
}

for (const width of [1280, 412]) test(`노트 고치기: 제목 칸과 서식 줄이 한 묶음으로 위에 붙고 본문만 넘어간다 ${width}`, async ({page}) => {
  const {errors, press} = await openLongNote(page, width);
  const field = page.locator('[data-note-detail] [data-note-editor]');
  // 제목 칸은 띠 안, 서식 줄 바로 위. 열자마자 제목 칸에 초점(띠로 옮겨도 그대로).
  const title = field.locator('.ed-stick [data-note-title-input]');
  await expect(title).toHaveValue('긴 노트'); await expect(title).toBeFocused();
  const order = await field.locator('.ed-stick').evaluate(el => [...el.children].map(c => c.matches('.ed-bar') ? 'bar' : c.querySelector('[data-note-title-input]') ? 'title' : c.className));
  expect(order).toEqual(['title', 'bar']);
  const r = await expectStickyBand(page, field);
  // PC: 맨 위 줄(고정) 바로 아래 = 공용 값 --kptu-stick-top. 폰: 맨 위.
  const stick = await page.evaluate(() => { const p = document.createElement('div'); p.style.height = 'var(--kptu-stick-top, 0px)'; document.querySelector('#appView').append(p); const h = p.getBoundingClientRect().height; p.remove(); return h; });
  expect(Math.abs(r.bandTop - stick)).toBeLessThanOrEqual(1);
  if (width >= 761) expect(stick).toBeGreaterThan(30); else expect(stick).toBe(0);
  // 붙은 채로 제목을 고칠 수 있다.
  await press(title); await expect(title).toBeFocused();
  // [⌄] 펼친 아래 줄과 떠 있는 메뉴(글자색)가 띠에 가리지 않는다.
  const more = field.locator('.ed-bar .ed-more');
  if (await more.isVisible()) {
    await press(more);
    const menu = field.locator('.ed-bar .ed-more-menu');
    await expect(menu).toBeVisible();
    const m = await menu.boundingBox(); const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.ed-more-menu'), [m.x + 10, m.y + m.height / 2]);
    expect(hit).toBe(true);
    await press(more);
  }
  const pick = field.locator('.ed-bar button[aria-haspopup]').first();
  await press(pick);
  const pop = page.locator('.ed-pop:not([hidden])').first();
  await expect(pop).toBeVisible();
  const p = await pop.boundingBox(); const shown = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.ed-pop'), [p.x + p.width / 2, p.y + p.height / 2]);
  expect(shown).toBe(true);
  await page.keyboard.press('Escape');
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-sticky-head-${width}.png`});
  expect(errors).toEqual([]);
});

test('폰 키보드가 올라와 화면이 줄어도 서식 줄은 보인다 (412)', async ({page}) => {
  const {errors} = await openLongNote(page, 412, 900);
  const field = page.locator('[data-note-detail] [data-note-editor]');
  await field.locator('.ProseMirror').tap();
  // interactive-widget=resizes-content: 키보드가 오르면 화면(레이아웃) 높이가 줄어든다.
  await page.setViewportSize({width: 412, height: 520});
  const r = await expectStickyBand(page, field);
  expect(r.bandTop).toBeLessThanOrEqual(1);
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-sticky-keyboard-412.png`});
  expect(errors).toEqual([]);
});

for (const width of [1280, 412]) test(`큰 창에서 수정: 서식 줄·제목 줄 띠가 창 안 스크롤 맨 위에 남는다 ${width}`, async ({page}) => {
  const {errors, press} = await openLongNote(page, width);
  await press(page.locator('[data-note-big-write]'));
  const w = page.locator('#edWindow'); await expect(w).toBeVisible();
  await expect(w.locator('.ed-window-body .ProseMirror')).toBeVisible();
  const order = await w.locator('.ed-stick').evaluate(el => [...el.children].map(c => c.matches('.ed-bar') ? 'bar' : c.matches('.edw-title-row') ? 'title' : c.className));
  expect(order).toEqual(['bar', 'title']);
  const r = await expectStickyBand(page, w);
  const bodyTop = await w.locator('.ed-window-body').evaluate(el => el.getBoundingClientRect().top);
  expect(Math.abs(r.bandTop - bodyTop)).toBeLessThanOrEqual(1);
  await expect(w.locator('.ed-stick [data-edw-title]')).toBeVisible();
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/note-sticky-window-${width}.png`});
  expect(errors).toEqual([]);
});
