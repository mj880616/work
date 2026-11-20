// S67-23 잠금과 고르기 창: 하루 기록 수정 창에서 [사진]·글 칸 [넣기]›[사진]으로 폰 고르기 창을 열었다 닫으면(화면이 잠깐 숨겨짐)
// 다시 잠그기 '바로'여도 잠금 화면이 뜨지 않고 쓰던 글이 그대로다. 고르기 창 없이 다른 앱으로 가면 그대로 잠기고,
// 잠긴 동안 수정 창은 보이지 않으며, PIN을 풀면 쓰던 수정 창으로 돌아온다. 고르기 창을 연 채 오래(3분) 떠나 있었으면 원래대로 잠긴다.
// 노트 폴더 잠금도 같다(고치던 노트는 잠금 화면 뒤에 숨었다가 PIN 뒤 그대로). 서버(app_lock_*)는 page.route 흉내, 값은 모두 합성.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
// 화면 사진: KPTU_SHOTS=1 이면 docs/design/screens/s67-23/.
const SHOTS = process.env.KPTU_SHOTS ? 'docs/design/screens/s67-23/' : '';
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}${name}.png` }) : null;
const T0 = Date.parse('2026-10-06T01:00:00Z');
const F1 = '00000000-0000-4000-8000-000000000001';

function lockServer({ pin = '1234', features = ['diary'], relock = 'now', locked = [] } = {}) {
  const s = { pin, features, relock, locked, calls: [] };
  s.install = async page => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const body = route.request().postDataJSON() || {};
      s.calls.push(name);
      const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (name === 'app_lock_read') return json({ has_pin: true, features: s.features, relock: s.relock, left: 5, blocked_until: null });
      if (name === 'app_lock_note_folders') return json({ folders: s.locked, covered: s.locked, top_names: s.locked.length ? ['비밀'] : [] });
      if (name === 'app_lock_check') return json(body.p_pin === s.pin ? { ok: true, left: 5, blocked_until: null } : { ok: false, left: 4, blocked_until: null });
      return route.fulfill({ status: 404, body: '' });
    });
  };
  return s;
}
const keys = async (page, digits) => { for (const d of digits) await page.locator('#lockView [data-lk-key="' + d + '"]').click(); };
const pad = page => page.locator('#lockView .lk-pad');
const current = page => page.evaluate(() => window.KPTURouter.current);
// 폰 고르기 창·다른 앱으로 가기 흉내: 화면 숨김 → 다시 보임.
const seen = (page, state) => page.evaluate(v => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);
const diaryText = page => page.locator('#diaryRoot [data-diary-editor] [data-diary-text] .ProseMirror');

async function openDiaryEditor(page, server, { width = 412 } = {}) {
  await page.setViewportSize({ width, height: 860 });
  await openHome(page, { beforeLoad: () => server.install(page), query: '?view=diary' });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 500, json: {} }));
  await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김', { timeout: 20000 });
  await keys(page, '1234');
  await expect(page.locator('#diaryView')).toBeVisible();
  await page.locator('#diaryRoot [data-diary-new]').click();
  await expect(diaryText(page)).toBeVisible();
  await diaryText(page).click();
  await page.keyboard.type('쓰던 글 그대로');
  await expect(diaryText(page)).toHaveText('쓰던 글 그대로');
}
// 고르기 창 열기(Playwright가 창을 받아 둔다) → 화면 숨김 → (away ms 지남) → 다시 보임.
async function pickAndBack(page, button, { away = 0, files = null } = {}) {
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  const fc = await chooser;
  await seen(page, 'hidden');
  if (away) await page.clock.setFixedTime(new Date(T0 + away));
  if (files) await fc.setFiles(files);
  await seen(page, 'visible');
}

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date(T0)); });

test('다시 잠그기 "바로": [사진] 고르기 창을 열고 닫아도 잠금 화면이 뜨지 않고 쓰던 글 그대로 (폰 412)', async ({ page }) => {
  const server = lockServer();
  await openDiaryEditor(page, server);
  await pickAndBack(page, page.locator('#diaryRoot [data-diary-pick]'));
  await expect(page.locator('#diaryView')).toBeVisible();
  expect(await current(page)).toBe('diary');
  await expect(pad(page)).toBeHidden();
  await expect(diaryText(page)).toHaveText('쓰던 글 그대로');
  await shot(page, 'diary-after-picker-412');
  // 글 칸 [넣기 ▾] › [사진]도 같은 길(편집기 공용 고르기 칸). 하루 기록 글 칸에는 [파일 넣기]가 없다(S67-20 #2785: 본문 사진만).
  // 폰 폭(412)은 늘 묶음 줄이라 [넣기 ▾]가 보일 때까지 기다렸다 누른다(누르기 전 한 번 보고 넘어가지 않게).
  const editor = page.locator('#diaryRoot [data-diary-editor]');
  const group = editor.locator('.ed-tools [data-ed-cmd="gInsert"]');
  await expect(group).toBeVisible();
  await group.click();
  await expect(editor.getByRole('button', { name: '파일 넣기', exact: true })).toHaveCount(0);
  await pickAndBack(page, editor.getByRole('button', { name: '사진 넣기', exact: true }));
  expect(await current(page)).toBe('diary');
  await expect(pad(page)).toBeHidden();
  await expect(diaryText(page)).toHaveText('쓰던 글 그대로');
  // 고르기 창이 닫힌 뒤에는 원래 규칙: 다른 앱으로 가면(누름 없이 숨김) 바로 잠긴다.
  await seen(page, 'hidden');
  await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김');
  await expect(page.locator('#diaryView')).toBeHidden();
  await expect(page.locator('#diaryRoot [data-diary-editor]')).toBeHidden();
  await seen(page, 'visible');
  await shot(page, 'locked-pad-412');
  // PIN을 풀면 쓰던 수정 창으로 돌아온다(목록·달력이 아니라).
  await keys(page, '1234');
  await expect(page.locator('#diaryView')).toBeVisible();
  await expect(page.locator('#diaryRoot [data-diary-editor]')).toBeVisible();
  await expect(diaryText(page)).toHaveText('쓰던 글 그대로');
  await expect(page.locator('#diaryRoot [data-diary-cal]')).toBeHidden();
  await shot(page, 'diary-back-after-pin-412');
  // 돌아온 수정 창은 뒤로가기로 닫힌다(겹이 다시 열림) — 저장 안 한 글이 있으니 묻는다.
  await page.goBack();
  await expect(page.getByText('쓰던 하루 기록을 저장하지 않고 닫을까요?')).toBeVisible();
});

test('고르기 창을 연 채 3분 넘게 떠나 있었으면 돌아왔을 때 잠기고, PIN 뒤 쓰던 수정 창으로 (폰 412)', async ({ page }) => {
  const server = lockServer();
  await openDiaryEditor(page, server);
  await pickAndBack(page, page.locator('#diaryRoot [data-diary-pick]'), { away: 4 * 60 * 1000 });
  await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김');
  await expect(page.locator('#diaryView')).toBeHidden();
  // 잠긴 동안 메뉴로 다른 화면에 갔다가 하루 기록으로 와도 다시 숫자 판(붙들어 둔 글은 보이지 않음).
  await page.evaluate(() => window.KPTURouter.go('home', { source: 'delegated' }));
  await page.evaluate(() => window.KPTURouter.go('diary', { source: 'delegated' }));
  await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김');
  await expect(page.locator('#diaryView')).toBeHidden();
  await keys(page, '1234');
  await expect(page.locator('#diaryRoot [data-diary-editor]')).toBeVisible();
  await expect(diaryText(page)).toHaveText('쓰던 글 그대로');
});

test('다시 잠그기 5분: 고르기 창 2분은 그대로, 6분이면 잠긴 뒤 PIN → 수정 창 (폰 412)', async ({ page }) => {
  const server = lockServer({ relock: '5m' });
  await openDiaryEditor(page, server);
  await pickAndBack(page, page.locator('#diaryRoot [data-diary-pick]'), { away: 2 * 60 * 1000 });
  expect(await current(page)).toBe('diary');
  await expect(diaryText(page)).toHaveText('쓰던 글 그대로');
  await pickAndBack(page, page.locator('#diaryRoot [data-diary-pick]'), { away: 8 * 60 * 1000 });
  await expect(pad(page).locator('.lk-title')).toHaveText('하루 기록 잠김');
  await keys(page, '1234');
  await expect(diaryText(page)).toHaveText('쓰던 글 그대로');
});

test('노트 폴더 잠금: 잠긴 폴더 노트를 고치다 고르기 창을 열고 닫아도 그대로, 다시 잠기면 숨었다가 PIN 뒤 쓰던 그대로 (폰 412)', async ({ page }) => {
  const server = lockServer({ features: [], locked: [F1] });
  await page.setViewportSize({ width: 412, height: 860 });
  await openHome(page, { beforeLoad: () => server.install(page) });
  const note = { id: 'n2', workspace_id: 'w', kind: 'note', title: '감춘 노트', raw_text: '감춘 노트 본문 글', occurred_at: '2026-10-05T01:00:00Z', created_at: '2026-10-05T01:00:00Z', updated_at: '2026-10-05T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { folder_id: F1, folder: '비밀' } };
  const folder = { id: F1, workspace_id: 'w', parent_id: null, name: '비밀', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' };
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: [structuredClone(note)] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: [folder] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket', { source: 'delegated' }));
  await chooseBasketKind(page, 'note');
  await page.locator('[data-note-view="list"]').click();
  await page.locator('#noteRows [data-note-row="n2"]').click();
  // S67-25: 잠긴 노트 열기는 그 자리 작은 PIN 창(잠금 화면과 같은 숫자 판). 고치던 노트를 붙드는 다시 잠김(아래)은 잠금 화면 그대로.
  await expect(page.locator('dialog.lk-here .lk-title')).toHaveText('노트 잠김');
  for (const d of '1234') await page.locator('dialog.lk-here [data-lk-key="' + d + '"]').click();
  await expect(page.locator('dialog.lk-here')).toHaveCount(0);
  await expect(page.locator('#noteRows [data-note-row="n2"]')).toBeVisible();
  await page.locator('#noteRows [data-note-row="n2"]').click();
  await noteMenuAction(page, 'data-note-edit');
  const box = page.locator('[data-note-detail] [data-note-body-field]'), field = box.locator('.ProseMirror');
  await expect(field).toBeVisible();
  await field.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 더 쓴 글');
  await expect(field).toContainText('더 쓴 글');
  const group = box.locator('[data-ed-cmd="gInsert"]');
  await expect(group).toBeVisible();
  await group.click();
  await pickAndBack(page, box.getByRole('button', { name: '파일 넣기', exact: true }));
  expect(await current(page)).toBe('basket');
  await expect(field).toContainText('더 쓴 글');
  // 다른 앱으로 가면 다시 잠긴다 — 고치던 노트는 버리지 않고 잠금 화면 뒤로.
  await seen(page, 'hidden');
  await expect(pad(page).locator('.lk-title')).toHaveText('노트 잠김');
  await expect(page.locator('#basketView')).toBeHidden();
  await seen(page, 'visible');
  await keys(page, '1234');
  await expect(page.locator('#basketView')).toBeVisible();
  await expect(field).toContainText('더 쓴 글');
  await shot(page, 'note-back-after-pin-412');
});
