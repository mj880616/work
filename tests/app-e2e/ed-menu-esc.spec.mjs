import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';

// NOTE-서식메뉴Esc(S61-22, PR #2509 [마감 보고] 범위 밖 발견): PC 노트 고치기에서 서식 줄의 떠 있는 메뉴(.ed-pop)나 표 칸 메뉴가
// 열린 채 Escape를 누르면 그 메뉴만 닫히고 고치기 화면은 그대로여야 한다. 원인: 편집기 안 Escape 처리가 preventDefault만 하고
// 전파를 막지 않아 노트 화면의 Escape(고치기 끝내기)까지 갔다. 고침: 공용 글쓰기 부품(ed-editor.js)이 메뉴가 먹은 Escape를 바깥으로
// 보내지 않는다. 메뉴가 닫힌 상태의 Escape는 지금처럼 노트 고치기를 끝낸다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';

async function openNoteEdit(page) {
  await page.setViewportSize({width: 1280, height: 800});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const rows = [{id: 'n1', workspace_id: 'w', kind: 'note', title: '메뉴 노트', raw_text: '첫 줄\n\n둘째 줄', occurred_at: '2026-11-12T01:00:00Z', created_at: '2026-11-12T01:00:00Z', updated_at: '2026-11-12T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}}];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => { const q = new URL(r.request().url()).searchParams; if (q.get('metadata')) return r.fulfill({json: []}); if (r.request().method() !== 'GET') return r.fulfill({status: 500, json: {}}); return r.fulfill({json: rows.filter(x => !q.get('id') || 'eq.' + x.id === q.get('id'))}); });
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await openKindMenu(page, 'note');
  await basketKindButton(page, 'note').click();
  await page.locator('[data-note-row="n1"]').first().click();
  await noteMenuAction(page, 'data-note-edit', {width: 1280});
  const field = page.locator('[data-note-detail] [data-note-editor]');
  await expect(field.locator('.ProseMirror')).toBeVisible();
  return {errors, field};
}

test('PC 노트 고치기: 떠 있는 서식 메뉴가 열린 채 Esc → 메뉴만 닫히고 고치기 그대로, 다시 Esc → 고치기 끝 (1280)', async ({page}) => {
  const {errors, field} = await openNoteEdit(page);
  const pm = field.locator('.ProseMirror');
  const pops = field.locator('.ed-bar button[aria-haspopup]');
  const n = Math.min(await pops.count(), 4);
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const pick = pops.nth(i);
    if (!(await pick.isVisible())) continue;
    await pick.click();
    const pop = page.locator('.ed-pop:not([hidden])').first();
    await expect(pop).toBeVisible();
    if (i === 0 && process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/ed-menu-esc-open-1280.png`});
    // 초점이 메뉴 안에 있든 단추에 있든 Esc 한 번은 메뉴만 닫는다.
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await expect(pm).toBeVisible();
    await expect(page.locator('[data-note-detail] [data-note-editor] .ed-bar')).toBeVisible();
  }
  // 글 칸에 초점을 두고 메뉴를 연 채(글자 단계 메뉴) Esc를 눌러도 같다(편집기 단축키 Escape 길).
  await pm.click();
  const first = pops.first();
  await first.click();
  await expect(page.locator('.ed-pop:not([hidden])').first()).toBeVisible();
  await pm.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-note-detail] .ed-pop:not([hidden])')).toHaveCount(0);
  await expect(pm).toBeVisible();
  if (process.env.CAPTURE_DIR) await page.screenshot({path: `${process.env.CAPTURE_DIR}/ed-menu-esc-after-1280.png`});
  // 메뉴가 닫힌 상태의 Esc는 지금처럼 노트 고치기를 끝낸다(바꾼 것이 없으므로 묻지 않고 읽기 화면).
  await pm.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-note-detail] [data-note-editor] .ProseMirror')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('PC 노트 고치기: 표 칸 메뉴가 열린 채 Esc → 표 칸 메뉴만 닫힌다 (1280)', async ({page}) => {
  const {errors, field} = await openNoteEdit(page);
  const pm = field.locator('.ProseMirror');
  await pm.click();
  // 표를 하나 넣고(표 단추 → 2×2), 표 칸에서 오른쪽 단추로 칸 메뉴를 연다.
  const tableBtn = field.locator('.ed-bar [data-ed-open="table"], .ed-bar button[aria-label*="표"]').first();
  test.skip(!(await tableBtn.isVisible().catch(() => false)), '표 단추가 줄에 보이지 않는 폭');
  await tableBtn.click();
  await page.locator('[data-ed-grid-r="2"][data-ed-grid-c="2"]').click();
  const cell = pm.locator('td, th').first();
  await expect(cell).toBeVisible();
  await cell.click({button: 'right'});
  const ctx = field.locator('.ed-ctx:not([hidden]), [role="menu"]:not([hidden])').first();
  await expect(ctx).toBeVisible();
  // 묻는 창(#kptuAskText)이 잠깐이라도 생기면 기록한다(표 칸 메뉴 단추에 붙어 보이지 않게 뜨는 경우도 잡는다).
  await page.evaluate(() => { window.__askSeen = false; new MutationObserver(() => { if (document.querySelector('#kptuAskText')) window.__askSeen = true; }).observe(document.body, {childList: true, subtree: true}); });
  await page.keyboard.press('Escape');
  await expect(ctx).toBeHidden();
  await expect(pm).toBeVisible();
  await expect(pm.locator('table')).toHaveCount(1);
  // 바꾼 내용(표)이 있어도 '저장하지 않고 돌아갈까요?' 묻는 창이 뜨면 안 된다(Esc가 노트 화면까지 가지 않았다).
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__askSeen)).toBe(false);
  await expect(page.locator('#kptuAskText')).toHaveCount(0);
  // 메뉴가 닫힌 뒤의 Esc는 지금처럼 고치기 끝내기 → 바꾼 내용이 있으니 묻는 창이 뜬다.
  await pm.click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('수정하던 내용을 저장하지 않고')).toBeVisible();
  expect(errors).toEqual([]);
});
