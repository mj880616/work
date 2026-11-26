import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
// S67-54 UI-자판이름칸가림(11/20 사용자 요청): 노트 > 폴더 목록 아래쪽 폴더 ⋯ → [이름 바꾸기]로 뜨는 작은 글 입력창(.kptu-ask, app/small-notice.js)이
// 자판에 가리지 않는다. 자판은 칸에 초점이 간 뒤에 올라오므로, 창은 보이는 화면(visualViewport)이 바뀔 때 자리를 다시 잡는다(app/anchored-popup.js onViewportChange).
// 자판은 두 가지로 흉내 낸다: ① 화면 위만 덮는 자판(보이는 화면 높이만 줄어듦, 삼성 인터넷·크롬) ② 화면 높이가 줄어드는 자판(폰 앱 adjustResize).
// 같은 공용 창을 쓰는 새 폴더 만들기도 함께 본다. PC 1280은 예전처럼 누른 자리 바로 아래. 폴더 이름은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const KB = 330;
const NAMES = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하'].map(x => x + ' 폴더');
const SHOTS = 'docs/design/screens/s67-54/';

async function fixture(page, width, height) {
  await page.setViewportSize({ width, height });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const folders = NAMES.map((name, i) => ({ id: U(i + 1), workspace_id: 'w', parent_id: null, name, sort_order: 1024 * (i + 1), created_at: '2026-10-01T00:00:00Z' }));
  const rows = [{ id: 'n1', workspace_id: 'w', kind: 'note', title: '메모', raw_text: '메모 본문', occurred_at: '2026-10-16T01:00:00Z', created_at: '2026-10-16T01:00:00Z', updated_at: '2026-10-16T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', async r => {
    const req = r.request(), id = (new URL(req.url()).searchParams.get('id') || '').slice(3);
    if (req.method() === 'GET') return r.fulfill({ json: structuredClone(folders) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ id, body }); const x = folders.find(f => f.id === id); Object.assign(x, body); return r.fulfill({ json: [structuredClone(x)] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({ json: [] }) : r.fallback());
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  return { errors, writes, folders };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
// 맨 아래 폴더 줄을 화면 아래쪽(하단 탭 바로 위)으로 내려 두고 ⋯ → 메뉴 줄을 누른다.
async function openFromLastFolder(page, width, item) {
  const id = U(NAMES.length);
  const more = page.locator(`#noteRows [data-nx-folder-more="${id}"], [data-nx-tree] [data-nx-folder-more="${id}"]`).first();
  await more.evaluate(el => el.closest('[data-nx-folder]')?.scrollIntoView({ block: 'end' }) ?? el.scrollIntoView({ block: 'end' }));
  await press(page, more, width);
  await press(page, page.locator(`#noteDocMenu [${item}]`), width);
  const ask = page.locator('.kptu-ask');
  await expect(ask.locator('.kptu-ask-field')).toBeFocused();
  return { ask, more };
}
const overlayKeyboard = (page, open) => page.evaluate(([open, kb]) => { if (open) Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: innerHeight - kb }); else delete window.visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); }, [open, KB]);
// 입력칸·[확인]·[취소]가 보이는 화면(자판 위) 안에 다 들어 있는지, 그리고 창이 아래 탭과 겹치지 않는지.
function seen() {
  const vv = window.visualViewport, top = vv ? vv.offsetTop : 0, bottom = top + (vv ? vv.height : innerHeight);
  const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; };
  const panel = document.querySelector('.kptu-ask'), parts = [panel.querySelector('.kptu-ask-field'), ...panel.querySelectorAll('.kptu-ask-actions button')];
  const tabs = document.querySelector('nav.mobile-tabs'), tr = tabs && tabs.checkVisibility() ? tabs.getBoundingClientRect() : null;
  const p = panel.getBoundingClientRect();
  return { inside: parts.every(el => { const [t, b] = box(el); return t >= top - 1 && b <= bottom + 1; }), underTabs: !!(tr && tr.height && p.bottom > tr.top + 1), view: [Math.round(top), Math.round(bottom)], panel: box(panel) };
}

test('폰 412×915: 아래쪽 폴더 [이름 바꾸기] 창 — 화면 위만 덮는 자판에서도 입력칸·[확인]이 자판 위에 보이고, 자판을 내리면 제자리', async ({ page }) => {
  const f = await fixture(page, 412, 915);
  const { ask, more } = await openFromLastFolder(page, 412, 'data-nx-rename');
  // 창과 ⋯ 사이 거리(창이 ⋯에 붙은 모양). 자판을 내리면 다시 이 모양이 된다(⋯ 줄이 그사이 움직였어도 그 줄을 따라감).
  const gap = () => Promise.all([more.boundingBox(), ask.boundingBox()]).then(([a, p]) => Math.round(p.y + p.height <= a.y + 1 ? a.y - (p.y + p.height) : p.y - (a.y + a.height)));
  await expect(ask.locator('.kptu-ask-text')).toHaveText('폴더 이름 바꾸기 (40자까지)');
  expect(await page.evaluate(seen)).toMatchObject({ inside: true, underTabs: false });
  const before = await gap();
  expect(before).toBeGreaterThanOrEqual(0);expect(before).toBeLessThanOrEqual(8);
  await overlayKeyboard(page, true);
  await expect.poll(() => page.evaluate(seen)).toMatchObject({ inside: true });
  // 캡처에만: 자판이 덮는 자리를 회색 판으로 그린다(누르기는 통과, 찍고 바로 지움).
  await page.evaluate(kb => { const d = document.createElement('div'); d.id = 'kbShade'; d.textContent = '자판 자리'; d.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${kb}px;background:#8888;z-index:99999;pointer-events:none;display:grid;place-items:center;font:14px sans-serif;color:#222`; document.body.append(d); }, KB);
  await page.screenshot({ path: SHOTS + 'phone-412-rename-keyboard-overlay.png' });
  await page.evaluate(() => document.getElementById('kbShade')?.remove());
  await overlayKeyboard(page, false);
  await expect.poll(gap).toBe(before);
  expect(await page.evaluate(seen)).toMatchObject({ inside: true, underTabs: false });
  // 창은 그대로 쓸 수 있다: 이름을 넣고 [확인] = 저장.
  await overlayKeyboard(page, true);
  await ask.locator('.kptu-ask-field').fill('말과 글, 문장');
  await ask.locator('.kptu-ask-actions button').nth(1).tap();
  await expect(ask).toHaveCount(0);
  await expect.poll(() => f.writes.map(w => w.body.name)).toEqual(['말과 글, 문장']);
  expect(f.errors).toEqual([]);
});

test('폰 412×915: 화면 높이가 줄어드는 자판(폰 앱)에서도 [이름 바꾸기]·[새 폴더] 창 입력칸이 자판 위에', async ({ page }) => {
  const f = await fixture(page, 412, 915);
  for (const item of ['data-nx-rename', 'data-nx-new-in']) {
    const { ask } = await openFromLastFolder(page, 412, item);
    await page.setViewportSize({ width: 412, height: 915 - KB });
    await expect.poll(() => page.evaluate(seen)).toMatchObject({ inside: true });
    if (item === 'data-nx-rename') await page.screenshot({ path: SHOTS + 'phone-412-rename-keyboard-resize.png' });
    await ask.locator('.kptu-ask-actions button').first().tap();
    await expect(ask).toHaveCount(0);
    await page.setViewportSize({ width: 412, height: 915 });
  }
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('PC 1280: [이름 바꾸기] 창은 예전처럼 누른 ⋯ 바로 아래(또는 위)에 붙는다', async ({ page }) => {
  const f = await fixture(page, 1280, 900);
  const { ask, more } = await openFromLastFolder(page, 1280, 'data-nx-rename');
  const [a, p] = await Promise.all([more.boundingBox(), ask.boundingBox()]);
  // 메뉴 줄을 누른 뒤에는 초점이 ⋯로 돌아가 있다 — 창은 그 ⋯에 붙는다(아래 4px 또는 위 4px).
  expect(Math.abs(p.y - (a.y + a.height + 4)) <= 2 || Math.abs(p.y + p.height - (a.y - 4)) <= 2).toBe(true);
  await page.screenshot({ path: SHOTS + 'pc-1280-rename.png' });
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
