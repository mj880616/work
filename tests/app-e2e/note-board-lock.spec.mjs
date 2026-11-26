// S69 보드잠금가림(요청함 '보드 화면에서 잠금 노트 제목이 보이는 문제'): 노트 [보드] 보기에서도 잠근 노트 폴더(feature-lock.js 판정 한 곳)를 지킨다.
// - PC 왼쪽 '노트 목록': 잠근 폴더는 줄 하나 '이름 · 잠김'(펼치기·개수·끌어 놓기 없음), 하위 폴더·안의 노트 제목은 그리지 않는다.
// - 판에 이미 붙은 잠긴 폴더 노트 카드: 자물쇠 모양만(제목 없음).
// - 폰 [+ 노트 붙이기] 고르기 창도 같다. 잠긴 줄을 누르면 그 자리 PIN 창 → 맞으면 보임 → 떠난 뒤 5분이면 다시 사라짐.
// 서버(app_lock_*)·노트·폴더·화면 기억은 page.route로 흉내 낸다. 값은 모두 합성.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const T0 = Date.parse('2026-10-06T01:00:00Z');
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const F1 = U(1), F2 = U(2), F3 = U(3), B = 'b1a2b3c4';
const HIDDEN = ['감춘 노트', '안쪽 노트', '옛 이름 노트', '안쪽'];

async function setup(page, width) {
  const s = { pin: '1234', locked: [F1] };
  const folders = [
    { id: F1, workspace_id: 'w', parent_id: null, name: '비밀', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: F2, workspace_id: 'w', parent_id: F1, name: '안쪽', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: F3, workspace_id: 'w', parent_id: null, name: '보통', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
  ];
  const list = () => ({ folders: [...s.locked], covered: [...s.locked, F2], top_names: ['비밀'] });
  const row = (id, title, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문 글', occurred_at: '2026-10-05T01:00:00Z', created_at: '2026-10-05T01:00:00Z', updated_at: '2026-10-05T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const place = { boards: { [B]: { x: 40, y: 40, r: 0, z: 1 } } };
  const notes = [row('n1', '열린 노트', { folder_id: F3, folder: '보통' }), row('n2', '감춘 노트', { folder_id: F1, folder: '비밀', ...place }), row('n3', '안쪽 노트', { folder_id: F2, folder: '안쪽' }), row('n4', '옛 이름 노트', { folder: '비밀' })];
  await page.setViewportSize({ width, height: 860 });
  await installViewPrefsServer(page, { note_view: 'board', note_boards: [{ id: B, name: '잠금 보드' }], note_board: B });
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop(), body = route.request().postDataJSON() || {};
      const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (name === 'app_lock_read') return json({ has_pin: true, features: [], relock: '5m', left: 5, blocked_until: null });
      if (name === 'app_lock_note_folders') return json(list());
      if (name === 'app_lock_check') return json(body.p_pin === s.pin ? { ok: true, left: 5, blocked_until: null } : { ok: false, left: 4, blocked_until: null });
      return route.fulfill({ status: 404, body: '' });
    });
  } });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(notes) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  return s;
}
const go = (page, view) => page.evaluate(v => window.KPTURouter.go(v, { source: 'delegated' }), view);
async function openNotes(page) {
  await go(page, 'basket');
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 4');
  await expect(page.locator('[data-nb-card="n2"]')).toBeVisible();
}
const hereKeys = async (page, digits) => { for (const d of digits) await page.locator('dialog.lk-here [data-lk-key="' + d + '"]').click(); };

test('PC 보드: 잠근 폴더는 왼쪽 목록에 줄 하나 · 잠김, 판 카드는 자물쇠만 → PIN → 보임 → 5분 뒤 다시 사라짐 (1440)', async ({ page }) => {
  await setup(page, 1440);
  await openNotes(page);
  const side = page.locator('[data-nbb-side]'), card = page.locator('[data-nb-card="n2"]');
  const locked = side.locator(`[data-nbb-locked="${F1}"]`);
  await expect(locked).toHaveText(/^비밀\s*잠김$/);
  // 잠근 폴더 줄은 펼치는 줄·놓는 곳이 아니다(폴더 줄 속성·개수 없음), 안쪽 폴더·노트 제목은 어디에도 없다.
  await expect(side.locator(`[data-nbb-folder="${F1}"], [data-nbb-folder="${F2}"]`)).toHaveCount(0);
  await expect(locked).not.toHaveAttribute('data-reorder-id', /.*/);
  for (const t of HIDDEN) { await expect(side).not.toContainText(t); await expect(page.locator('[data-note-board]')).not.toContainText(t); }
  await expect(card).toHaveAttribute('data-nb-locked', '');
  await expect(card.locator('.nb-lock-ico')).toBeVisible();
  // 펼칠 수 있는 '보통' 폴더 노트는 그대로 보인다.
  await side.locator(`[data-nbb-folder="${F3}"]`).click();
  await expect(side.locator('[data-nbb-note="n1"]')).toHaveText('열린 노트');
  // 잠긴 줄을 누르면 그 자리 PIN 창 → 맞으면 목록·카드가 다시 그려져 보인다.
  await locked.click();
  await expect(page.locator('dialog.lk-here .lk-title')).toHaveText('노트 잠김');
  await hereKeys(page, '1234');
  await expect(page.locator('dialog.lk-here')).toHaveCount(0);
  await expect(side.locator(`[data-nbb-locked="${F1}"]`)).toHaveCount(0);
  await side.locator(`[data-nbb-folder="${F1}"]`).click();
  await expect(side.locator('[data-nbb-note="n4"]')).toHaveText('옛 이름 노트');
  await side.locator(`[data-nbb-folder="${F2}"]`).click();
  await expect(side.locator('[data-nbb-note="n3"]')).toHaveText('안쪽 노트');
  await expect(card).not.toHaveAttribute('data-nb-locked', /.*/);
  await expect(card.locator('.nb-title')).toHaveText('감춘 노트');
  // 노트 화면을 떠난 뒤 5분이 지나 돌아오면 다시 잠겨 사라진다.
  await go(page, 'home');
  await page.clock.setFixedTime(new Date(T0 + 6 * 60 * 1000));
  await openNotes(page);
  await expect(side.locator(`[data-nbb-locked="${F1}"]`)).toBeVisible();
  for (const t of HIDDEN) await expect(side).not.toContainText(t);
  await expect(card).toHaveAttribute('data-nb-locked', '');
  await expect(card).not.toContainText('감춘 노트');
});

test('폰 보드 [+ 노트 붙이기] 고르기 창: 잠근 폴더는 줄 하나 · 잠김, 안쪽 노트 제목 없음 (412)', async ({ page }) => {
  await setup(page, 412);
  await openNotes(page);
  await page.locator('[data-nbb] [data-nbb-pick]').click();
  const dlg = page.locator('dialog.nbb-pick');
  await expect(dlg.locator(`[data-nbb-pl="${F1}"]`)).toHaveText(/^비밀\s*잠김$/);
  await expect(dlg.locator(`[data-nbb-pf="${F1}"], [data-nbb-pf="${F2}"]`)).toHaveCount(0);
  for (const t of HIDDEN) await expect(dlg).not.toContainText(t);
  // 찾기에도 걸리지 않는다.
  await dlg.locator('[data-nbb-pick-find]').fill('감춘');
  await expect(dlg).not.toContainText('감춘 노트');
  await dlg.locator('[data-nbb-pick-find]').fill('');
  // 잠긴 줄을 누르면 그 자리 PIN 창 → 맞으면 고르기 창이 그 자리에서 다시 그려진다.
  await dlg.locator(`[data-nbb-pl="${F1}"]`).click();
  await expect(page.locator('dialog.lk-here .lk-title')).toHaveText('노트 잠김');
  await hereKeys(page, '1234');
  await expect(page.locator('dialog.lk-here')).toHaveCount(0);
  await expect(dlg.locator(`[data-nbb-pl="${F1}"]`)).toHaveCount(0);
  await page.locator(`dialog.nbb-pick [data-nbb-pf="${F1}"]`).click();
  await expect(page.locator('dialog.nbb-pick [data-nbb-pn="n2"]')).toContainText('감춘 노트');
});
