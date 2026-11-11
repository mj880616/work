import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// FOLD-넓은화면 ④(S57-21, 요청함 11/06 01:18 ④ · 11/11 결정 '시안 없이 바로 개발'): 폴드 펼침(600~1199px)의 잊지 말기(정리함·업데이트)는 '왼쪽 목록 | 오른쪽 상세'.
// 업데이트 줄을 누르면 목록은 그대로 두고 오른쪽 칸에 바로 열리고(고른 줄 표시), 다른 줄을 누르면 같은 칸에서 바뀐다(뒤로가기 한 걸음 그대로). ✕·Esc·뒤로 = 상세 닫기.
// 아무것도 고르지 않았으면 오른쪽 칸이 없다(목록이 화면 폭 전체 — 할 일과 같은 규칙). 접은 폰(412)·PC(1280)는 지금처럼 상세가 목록 자리를 대신한다. 자료는 모두 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `10000000-0000-4000-8000-00000000000${n}`;
const TEXT = { 1: '첫째 가짜 업데이트\n- 확인할 것 하나', 2: '둘째 가짜 업데이트', 3: '셋째 가짜 업데이트' };

async function fixture(page, width, height = 1000) {
  const state = { errors: [], writes: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.setViewportSize({ width, height });
  const rows = [1, 2, 3].map(n => ({ id: U(n), workspace_id: 'w', kind: 'basket', title: null, raw_text: TEXT[n], occurred_at: `2026-10-0${7 - n}T01:00:00Z`, created_at: `2026-10-0${7 - n}T01:00:00Z`, updated_at: `2026-10-0${7 - n}T01:00:00Z`, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} }));
  // 목록 읽기가 화면을 띄우는 동안 먼저 나가도 같은 가짜 자료를 받게, 앱을 띄우기 전에 가로채기를 건다.
  await openHome(page, { beforeLoad: async () => {
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id'));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); state.writes.push({ id: (q.get('id') || '').replace('eq.', ''), body }); const hit = rows.filter(pick); for (const row of hit) Object.assign(row, body); return r.fulfill({ json: hit }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.route(SB + '/rest/v1/app_documents?**', r => r.fulfill({ json: [] }));
  } });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  // 화면 모듈을 처음 읽는 시간까지 넉넉히 기다린다(바쁜 러너에서 5초를 넘긴 적이 있다).
  await expect(page.locator('#basketView [data-basket-row]')).toHaveCount(3, { timeout: 20000 });
  return state;
}
const root = page => page.locator('#basketView');
const row = (page, n) => root(page).locator(`[data-basket-row="${U(n)}"]`);
const item = (page, n) => root(page).locator(`[data-basket-row-item="${U(n)}"]`);
const detail = page => root(page).locator('[data-basket-detail]');
const shape = page => root(page).evaluate(el => {
  const b = e => { if (!e || e.hidden || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
  return { split: el.classList.contains('basket-split'), view: b(el), list: b(el.querySelector('[data-basket-list]')), rows: b(el.querySelector('[data-basket-rows]')), detail: b(el.querySelector('[data-basket-detail]')),
    head: b(el.querySelector('.basket-switch-row')), vw: innerWidth, docW: document.documentElement.scrollWidth, sticky: getComputedStyle(el.querySelector('[data-basket-detail]')).position };
});

for (const [width, height] of [[690, 1000], [750, 1000], [884, 1104], [1199, 900]]) {
  test(`폴드 펼침 ${width}: 잊지 말기 — 줄을 누르면 오른쪽 칸에 상세, 다른 줄로 바꾸기, ✕·Esc·뒤로 닫기, 안 고르면 목록이 폭 전체`, async ({ page }) => {
    const s = await fixture(page, width, height);
    // 아무것도 고르지 않음: 오른쪽 칸 없음, 목록이 화면 폭 전체.
    let m = await shape(page);
    expect(m.split).toBe(false);
    expect(m.detail).toBeNull();
    expect(Math.abs(m.rows.right - m.view.right)).toBeLessThanOrEqual(2);
    const fullWidth = m.rows.w, headBefore = m.head;

    // 줄을 누르면 목록은 그대로, 오른쪽 칸에 바로 열린다.
    await row(page, 1).click();
    await expect(detail(page)).toBeVisible();
    await expect(detail(page).locator('.basket-read-text')).toContainText('첫째 가짜 업데이트');
    await expect(root(page).locator('[data-basket-list]')).toBeVisible();
    m = await shape(page);
    expect(m.split).toBe(true);
    expect(m.docW).toBeLessThanOrEqual(m.vw);
    expect(m.rows.w).toBeLessThan(fullWidth * 0.6);
    expect(m.detail.x).toBeGreaterThanOrEqual(m.rows.right + 8);
    expect(Math.abs(m.detail.right - m.view.right)).toBeLessThanOrEqual(2);
    expect(m.detail.w).toBeGreaterThanOrEqual(m.rows.w);
    // 위쪽 [처리 전 ▾] 줄은 화면 폭 전체 그대로(상세를 열어도 움직이지 않음), 그 아래 한 줄을 목록과 상세가 나눠 쓴다(같은 높이에서 시작).
    expect(m.head).toEqual(headBefore);
    expect(Math.abs(m.detail.y - m.list.y)).toBeLessThanOrEqual(2);
    expect(m.detail.y).toBeGreaterThanOrEqual(m.head.bottom - 1);
    expect(m.sticky).toBe('sticky');
    // 고른 줄 표시(한 줄만) · 닫기는 ✕(‹ 잊지 말기 없음) · 폰 틀이면 앱 머리(화면 이름)는 그대로.
    await expect(root(page).locator('[data-basket-selected]')).toHaveCount(1);
    await expect(item(page, 1)).toHaveAttribute('data-basket-selected', '');
    await expect(row(page, 1)).toHaveAttribute('aria-current', 'true');
    await expect(detail(page).getByRole('button', { name: '닫기', exact: true })).toBeVisible();
    await expect(detail(page).locator('.basket-back')).toHaveCount(0);
    if (width <= 760) await expect(page.locator('#appView > .mobile-shell-header [data-mobile-view-name]')).toBeVisible();

    // 다른 줄: 같은 칸에서 바뀐다(고른 줄 표시도 옮겨 감).
    await row(page, 2).click();
    await expect(detail(page).locator('.basket-read-text')).toContainText('둘째 가짜 업데이트');
    await expect(root(page).locator('[data-basket-selected]')).toHaveCount(1);
    await expect(item(page, 2)).toHaveAttribute('data-basket-selected', '');
    await expect(row(page, 1)).not.toHaveAttribute('aria-current', 'true');
    expect((await shape(page)).split).toBe(true);

    // 뒤로가기 한 걸음 = 상세 닫기(줄을 바꿔도 한 걸음). 목록은 그대로, 다시 화면 폭 전체.
    await page.goBack();
    await expect(detail(page)).toBeHidden();
    await expect(root(page)).toBeVisible();
    await expect(root(page).locator('[data-basket-selected]')).toHaveCount(0);
    m = await shape(page);
    expect(m.split).toBe(false);
    expect(m.rows.w).toBe(fullWidth);
    expect(await page.evaluate(() => window.KPTURouter.current)).toBe('basket');

    // ✕ 닫기 → 그 줄에 초점. 키보드: 줄에서 Enter로 열고 Esc로 닫는다.
    await row(page, 3).click();
    await expect(detail(page).locator('.basket-read-text')).toContainText('셋째 가짜 업데이트');
    await detail(page).getByRole('button', { name: '닫기', exact: true }).click();
    await expect(detail(page)).toBeHidden();
    await expect(row(page, 3)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(detail(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail(page)).toBeHidden();
    expect((await shape(page)).split).toBe(false);

    // 상세가 열린 채 다른 줄의 [이미 함]: 열린 상세를 닫고 그 줄을 보류로 보낸다(목록만 있을 때와 같은 길).
    await row(page, 1).click();
    await expect(detail(page)).toBeVisible();
    await item(page, 2).hover();
    await item(page, 2).locator('[data-nbx-act="done"]').click();
    await expect(detail(page)).toBeHidden();
    await expect.poll(() => s.writes.filter(w => w.id === U(2) && w.body.archived_at).length).toBe(1);
    await expect(row(page, 2)).toHaveCount(0);
    expect((await shape(page)).split).toBe(false);
    expect(s.errors).toEqual([]);
  });
}

for (const [width, height] of [[412, 915], [599, 900], [1200, 900], [1280, 900]]) {
  test(`폴드 펼침 밖 ${width}: 잊지 말기 상세는 지금처럼 목록 자리를 대신한다(오른쪽 칸 없음)`, async ({ page }) => {
    const s = await fixture(page, width, height);
    await row(page, 1).click();
    await expect(detail(page)).toBeVisible();
    await expect(root(page).locator('[data-basket-list]')).toBeHidden();
    const m = await shape(page);
    expect(m.split).toBe(false);
    expect(m.sticky).not.toBe('sticky');
    expect(Math.abs(m.detail.w - m.view.w)).toBeLessThanOrEqual(2);
    await expect(detail(page).locator('.basket-back[data-basket-close]')).toBeVisible();
    await expect(detail(page).locator('.basket-close-x')).toHaveCount(0);
    await expect(root(page).locator('[data-basket-selected]')).toHaveCount(0);
    await detail(page).locator('.basket-back[data-basket-close]').click();
    await expect(detail(page)).toBeHidden();
    await expect(root(page).locator('[data-basket-list]')).toBeVisible();
    await expect(row(page, 1)).toBeFocused();
    expect(s.errors).toEqual([]);
  });
}
