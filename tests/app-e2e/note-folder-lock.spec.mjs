// SEC-기능PIN잠금 노트 폴더(S67-14): 노트 폴더 ⋯ [잠금] → (PIN이 없으면 정하기 두 번) → 잠긴 폴더·그 하위 폴더 노트는 목록에서 '잠김',
// 찾기에도 걸리지 않음 → 누르면 숫자 판 '노트 잠김' → 맞는 PIN이면 다시 보임 → 떠난 뒤 5분이면 다시 잠김 → [잠금 해제](PIN 확인 뒤).
// 서버(app_lock_*)는 page.route로 흉내 낸다 — 대조·횟수·남의 폴더 거절의 실제 검사는 tests/auth-handoff/note-folder-lock-db.test.mjs. 값은 모두 합성.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import {screenFind} from './helpers/screen-find.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
// 화면 사진: KPTU_SHOTS=1 이면 docs/design/screens/s67-14/.
const SHOTS = process.env.KPTU_SHOTS ? 'docs/design/screens/s67-14/' : '';
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}${name}.png` }) : null;
const T0 = Date.parse('2026-10-06T01:00:00Z');
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const F1 = U(1), F2 = U(2), F3 = U(3);

function lockServer({ pin = null, locked = [] } = {}) {
  const s = { pin, features: [], relock: '5m', fail: 0, locked: [...locked], calls: [] };
  const folders = [
    { id: F1, workspace_id: 'w', parent_id: null, name: '비밀', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: F2, workspace_id: 'w', parent_id: F1, name: '안쪽', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: F3, workspace_id: 'w', parent_id: null, name: '보통', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
  ];
  const list = () => {
    const covered = new Set(s.locked);
    for (let grew = true; grew;) { grew = false; for (const f of folders) if (f.parent_id && covered.has(f.parent_id) && !covered.has(f.id)) { covered.add(f.id); grew = true; } }
    return { folders: [...s.locked].sort(), covered: [...covered].sort(), top_names: folders.filter(f => !f.parent_id && covered.has(f.id)).map(f => f.name) };
  };
  const tryPin = p => { if (p === s.pin) { s.fail = 0; return { ok: true, left: 5, blocked_until: null }; } s.fail++; return { ok: false, left: 5 - s.fail, blocked_until: null }; };
  const row = (id, title, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문 글', occurred_at: '2026-10-05T01:00:00Z', created_at: '2026-10-05T01:00:00Z', updated_at: '2026-10-05T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const notes = [row('n1', '열린 노트', { folder_id: F3, folder: '보통' }), row('n2', '감춘 노트', { folder_id: F1, folder: '비밀' }), row('n3', '안쪽 노트', { folder_id: F2, folder: '안쪽' }), row('n4', '옛 이름 노트', { folder: '비밀' })];
  s.install = async page => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const body = route.request().postDataJSON() || {};
      s.calls.push(name);
      const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (name === 'app_lock_read') return json({ has_pin: !!s.pin, features: s.features, relock: s.relock, left: 5 - s.fail, blocked_until: null });
      if (name === 'app_lock_note_folders') return json(list());
      if (name === 'app_lock_setup') { s.pin = body.p_pin; s.features = body.p_features; s.relock = body.p_relock; return json({ ok: true, features: s.features, relock: s.relock }); }
      if (name === 'app_lock_check') return json(tryPin(body.p_pin));
      if (name === 'app_lock_note_folder_set') {
        if (!folders.some(f => f.id === body.p_folder)) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'LOCK_FOLDER_FORBIDDEN' }) });
        const r = tryPin(body.p_pin); if (!r.ok) return json(r);
        s.locked = body.p_locked ? [...new Set([...s.locked, body.p_folder])] : s.locked.filter(x => x !== body.p_folder);
        return json({ ...r, ...list() });
      }
      return route.fulfill({ status: 404, body: '' });
    });
  };
  // 노트·폴더 읽기는 첫 화면이 다 뜬 뒤에 건다(첫 화면 기본 흉내보다 앞에 오게).
  s.installNotes = async page => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(notes) }) : r.fulfill({ status: 500, json: {} }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
    await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  };
  return s;
}
const go = (page, view) => page.evaluate(v => window.KPTURouter.go(v, { source: 'delegated' }), view);
const keys = async (page, digits) => { for (const d of digits) await page.locator('#lockView [data-lk-key="' + d + '"]').click(); };
const pad = page => page.locator('#lockView .lk-pad');
// S67-25: 잠긴 노트를 누르면 잠금 화면으로 가지 않고 그 자리 작은 PIN 창(같은 숫자 판).
const here = page => page.locator('dialog.lk-here .lk-pad');
const hereKeys = async (page, digits) => { for (const d of digits) await page.locator('dialog.lk-here [data-lk-key="' + d + '"]').click(); };
const title = (page, id) => page.locator(`#noteRows [data-note-row="${id}"] .basket-title-text`);
async function openNotes(page, server) {
  if (server && !server.notesOn) { server.notesOn = true; await server.installNotes(page); }
  await go(page, 'basket');
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 4');
}
async function listView(page) {
  await page.locator('[data-note-view="list"]').click();
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(4);
}

test('폴더 ⋯ [잠금] → PIN 정하기 → 하위·옛 이름 노트까지 잠김(찾기 안 걸림) → PIN 풀림 → 5분 뒤 다시 잠김 → [잠금 해제] (PC 1280)', async ({ page }) => {
  const server = lockServer();
  await page.setViewportSize({ width: 1280, height: 860 });
  await openHome(page, { beforeLoad: () => server.install(page) });
  await openNotes(page, server);
  await expect(page.locator(`[data-nx-tree] [data-nx-folder="${F1}"]`)).toBeVisible();
  // 폴더 ⋯ [잠금]: PIN이 없으니 정하기(두 번) — 그 PIN으로 바로 잠근다.
  await page.locator(`[data-nx-tree] [data-nx-folder-more="${F1}"]`).click();
  await page.locator('#noteDocMenu [data-nx-lock-folder]').click();
  await expect(pad(page).locator('.lk-title')).toHaveText("'비밀' 폴더 잠그기");
  await keys(page, '1234');
  await expect(pad(page).locator('.lk-title')).toHaveText('한 번 더 입력');
  await keys(page, '1234');
  await expect(page.locator('#basketView')).toBeVisible();
  expect([server.pin, server.locked]).toEqual(['1234', [F1]]);
  // 방금 PIN을 넣었으니 풀린 채.
  await listView(page);
  await expect(title(page, 'n2')).toHaveText('감춘 노트');
  // 메뉴 › 잠금에는 '잠긴 노트 폴더 1개' 한 줄.
  await go(page, 'lock');
  await expect(page.locator('#lockView [data-lk-folders]')).toHaveText('잠긴 노트 폴더 1개');
  await shot(page, 'lock-menu-1280');
  await expect(page.locator('#lockView .lk-note')).toHaveCount(0);
  // 정리함을 떠난 뒤 5분이 지나면 잠긴다.
  await go(page, 'home');
  await page.clock.setFixedTime(new Date(T0 + 6 * 60 * 1000));
  await openNotes(page, server);
  for (const id of ['n2', 'n3', 'n4']) await expect(title(page, id)).toHaveText('잠김');
  await expect(title(page, 'n1')).toHaveText('열린 노트');
  await expect(page.locator('#noteRows [data-nx-locked]')).toHaveCount(3);
  await shot(page, 'list-locked-1280');
  await expect(page.locator('#noteRows')).not.toContainText('감춘 노트');
  // 찾기: 잠긴 노트 글자로는 걸리지 않는다.
  await (await screenFind(page)).fill('감춘');
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(0);
  await (await screenFind(page)).fill('');
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(4);
  // 잠긴 노트를 누르면 그 자리 숫자 판(S67-25) → 틀림 → 맞음 → 화면을 떠나지 않고 노트가 보인다.
  await page.locator('#noteRows [data-note-row="n3"]').click();
  await expect(here(page).locator('.lk-title')).toHaveText('노트 잠김');
  await expect(page.locator('#lockView')).toBeHidden();
  await hereKeys(page, '0000');
  await expect(page.locator('dialog.lk-here [data-lk-msg]')).toHaveText('PIN이 맞지 않아요 · 4번 남았어요');
  await hereKeys(page, '1234');
  await expect(page.locator('dialog.lk-here')).toHaveCount(0);
  await expect(page.locator('#basketView')).toBeVisible();
  await expect(title(page, 'n3')).toHaveText('안쪽 노트');
  await expect(title(page, 'n2')).toHaveText('감춘 노트');
  // [잠금 해제]도 PIN 확인 뒤(폴더 보기의 폴더 ⋯). 풀린 동안은 폴더 꼬리표가 없다.
  await page.locator('[data-note-view="folder"]').click();
  await expect(page.locator(`[data-nx-tree] [data-nx-folder="${F1}"] .ft-tag`)).toHaveCount(0);
  await page.locator(`[data-nx-tree] [data-nx-folder-more="${F1}"]`).click();
  await expect(page.locator('#noteDocMenu [data-nx-lock-folder]')).toHaveText('잠금 해제');
  await page.locator('#noteDocMenu [data-nx-lock-folder]').click();
  await expect(pad(page).locator('.lk-title')).toHaveText("'비밀' 폴더 잠금 해제");
  await keys(page, '1234');
  await expect(page.locator('#basketView')).toBeVisible();
  expect(server.locked).toEqual([]);
  await page.clock.setFixedTime(new Date(T0 + 20 * 60 * 1000));
  await go(page, 'home');
  await openNotes(page, server);
  await expect(title(page, 'n2')).toHaveText('감춘 노트');
});

for (const width of [412, 884]) test(`잠긴 폴더는 처음부터 가려지고, 잠긴 폴더 ⋯는 [열기]·[잠금 해제]만 · 줄 ⋯도 숫자 판 · PIN → 보임 (${width})`, async ({ page }) => {
  const server = lockServer({ pin: '1234', locked: [F1] });
  await page.setViewportSize({ width, height: 860 });
  await openHome(page, { beforeLoad: () => server.install(page) });
  await openNotes(page, server);
  // 폴더 보기: 잠긴 폴더에 '잠김' 꼬리표, ⋯는 [열기]·[잠금 해제]만.
  const folder = page.locator(`[data-nx-folder="${F1}"]:visible`).first();
  await expect(folder.locator('.ft-tag')).toHaveText('잠김');
  await folder.locator(`[data-nx-folder-more="${F1}"]`).click();
  await expect(page.locator('#noteDocMenu button')).toHaveText(['열기', '잠금 해제']);
  await shot(page, `folder-menu-${width}`);
  await page.keyboard.press('Escape');
  await listView(page);
  for (const id of ['n2', 'n3', 'n4']) await expect(title(page, id)).toHaveText('잠김');
  await expect(title(page, 'n1')).toHaveText('열린 노트');
  await shot(page, `list-locked-${width}`);
  // 잠긴 노트 줄 ⋯도 메뉴 대신 그 자리 숫자 판(S67-25). [취소]면 창만 닫힌다(그대로 잠김).
  await page.locator('#noteRows [data-note-row-more="n2"]').click();
  await expect(here(page).locator('.lk-title')).toHaveText('노트 잠김');
  await page.locator('dialog.lk-here [data-lk-cancel]').click();
  await expect(page.locator('dialog.lk-here')).toHaveCount(0);
  await expect(title(page, 'n2')).toBeVisible();
  await expect(title(page, 'n2')).toHaveText('잠김');
  await page.locator('#noteRows [data-note-row="n2"]').click();
  await hereKeys(page, '1234');
  await expect(title(page, 'n2')).toBeVisible();
  await expect(title(page, 'n2')).toHaveText('감춘 노트');
  expect(server.calls.filter(c => c === 'app_lock_check').length).toBe(1);
});
