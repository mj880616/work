// BRIEF-밀기메뉴(명진 11/26): 브리핑 룸 줄 ⋯는 없다. 폰 = 왼쪽 밀기 [수정][삭제], PC = 줄 우클릭 [수정][삭제]. 삭제 = 브리핑 + 자료,
// 자료실에 있던 자료(브리핑 요청함 폴더 밖, 아래 D(3))는 브리핑만 지우고 자료는 남긴다. 오른쪽 밀기 여러 개 [삭제]도 같은 규칙.
// 자료 이름은 모두 예시. 서버는 흉내(브리핑만 = rpc app_document_brief_delete + '브리핑 요청함' 폴더 줄 삭제, 자료까지 = document-actions delete).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-00000000000${n}`;
const docs = [
  { id: D(1), title: '예시 계획 자료', file_name: '예시 계획.pdf', mime_type: 'application/pdf', file_id: 'FILE_aaaaaaaaaa', created_at: '2026-10-06T00:50:00Z' },
  { id: D(2), title: '예시 보고서', file_name: '예시 보고서.hwp', file_id: 'FILE_bbbbbbbbbb', created_at: '2026-10-05T00:00:00Z' },
  { id: D(3), title: '예시 편람 개정안', file_name: '예시 편람.pdf', mime_type: 'application/pdf', file_id: 'FILE_cccccccccc', created_at: '2026-10-04T00:00:00Z' },
];
const brief = { v: 1, lead: '예시 한 줄 요지.', touches: [], todos: [], conflicts: [], quotes: [] };
const allRows = [
  { id: 'b1', document_id: D(1), status: 'running', stage: 'chunk', step_no: 2, step_total: 9, brief: null, created_at: '2026-10-06T00:40:00Z', updated_at: '2026-10-06T00:59:50Z', lease_until: '2099-01-01T00:00:00Z' },
  { id: 'b2', document_id: D(2), status: 'done', stage: 'done', step_no: 9, step_total: 9, brief, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:10:00Z', finished_at: '2026-10-05T00:10:00Z' },
  { id: 'b3', document_id: D(3), status: 'done', stage: 'done', step_no: 9, step_total: 9, brief, created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:10:00Z', finished_at: '2026-10-04T00:10:00Z' },
];

async function open(page) {
  const gone = { briefs: new Set(), docs: new Set(), folder: new Set() };
  const calls = { rpc: [], folderDelete: [], actions: [] };
  await openHome(page, {
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/rpc/app_document_brief_delete', r => {
        const id = r.request().postDataJSON().p_document_id; calls.rpc.push(id); gone.briefs.add(id);
        return r.fulfill({ json: 1 });
      });
      await page.route(SB + '/rest/v1/app_document_briefs**', r => {
        const u = new URL(r.request().url());
        const live = allRows.filter(x => !gone.briefs.has(x.document_id) && !gone.docs.has(x.document_id));
        if (u.searchParams.get('status') === 'eq.done') return r.fulfill({ json: live.filter(x => x.status === 'done').map(x => ({ document_id: x.document_id, lead: x.brief.lead })) });
        return r.fulfill({ json: live });
      });
      await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'f-brief' }] : [] }));
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => {
        const u = new URL(r.request().url());
        if (r.request().method() === 'DELETE') { const id = (u.searchParams.get('document_id') || '').replace(/^eq\./, ''); calls.folderDelete.push(id); gone.folder.add(id); return r.fulfill({ status: 204, body: '' }); }
        return r.fulfill({ json: [D(1), D(2)].filter(id => !gone.folder.has(id) && !gone.docs.has(id)).map(id => ({ document_id: id })) });
      });
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        const u = new URL(r.request().url());
        if (r.request().method() !== 'GET' || !u.searchParams.get('id')?.startsWith('in.')) return r.fallback();
        return r.fulfill({ json: docs.filter(d => !gone.docs.has(d.id)).map(d => ({ workspace_id: 'w', category: '기타', visibility: 'private', ...d })) });
      });
      await page.route(SB + '/functions/v1/document-actions', r => {
        const body = r.request().postDataJSON(); calls.actions.push(body);
        if (body.action === 'delete') { gone.docs.add(body.document_id); return r.fulfill({ json: { ok: true, drive_result: 'trashed', drive_preserved: false, reason: 'ordinary_library' } }); }
        return r.fulfill({ json: { ok: true } });
      });
    },
  });
  await page.evaluate(() => window.KPTURouter.go('brief'));
  await expect(page.locator('#briefView .br-row')).toHaveCount(3);
  return calls;
}
const row = (page, id) => page.locator(`#briefView .br-row[data-br-open="${id}"]`);
const answer = async page => { await page.locator('.kptu-ask .kptu-ask-actions button', { hasText: '삭제' }).click(); };
async function swipeLeft(page, loc) {
  await expect(async () => {
    await loc.evaluate(el => { const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + 12; const f = (t, cx) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y })); f('pointerdown', x); for (let i = 1; i <= 12; i++) f('pointermove', x - 200 * i / 12); f('pointerup', x - 200); });
    await expect(page.locator('[data-row-swipe-act="end"]').first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

test('폰 412: ⋯ 단추 없음 · 왼쪽 밀기 = [수정][삭제] 두 칸만 (만드는 중 줄은 [삭제]만)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await open(page);
  await expect(page.locator('#briefView .br-row [data-br-more], #briefView .br-row .br-more')).toHaveCount(0);
  await swipeLeft(page, row(page, D(2)));
  await expect(page.locator('#briefView [data-row-swipe-act="end"] .row-swipe-tx')).toHaveText(['수정', '삭제']);
  await expect(page.locator('.kptu-ask')).toHaveCount(0); // 끝까지 밀어도 바로 하지 않음
  await page.screenshot({ path: 'docs/design/screens/brief-swipe-menu/phone-412-swipe.png', fullPage: false });
  await page.locator('[data-row-swipe-key="edit"]').click();
  await expect(page.locator('#briefView [data-br-form]')).toBeVisible(); // 수정 = 요약·본문을 고치는 화면
  await page.goBack().catch(() => {});
});

test('폰 412: 만드는 중 줄은 [삭제]만, 삭제 = 브리핑 + 자료(자료실 삭제와 같은 서버 길)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const calls = await open(page);
  await swipeLeft(page, row(page, D(1)));
  await expect(page.locator('#briefView [data-row-swipe-act="end"] .row-swipe-tx')).toHaveText(['삭제']);
  await page.locator('[data-row-swipe-key="delete"]').click();
  await expect(page.locator('.kptu-ask-text')).toHaveText('“예시 계획 자료” 브리핑과 자료를 삭제할까요?');
  await expect(page.locator('.kptu-ask-note')).toContainText('휴지통');
  await answer(page);
  await expect(row(page, D(1))).toHaveCount(0);
  expect(calls.actions.filter(a => a.action === 'delete').map(a => a.document_id)).toEqual([D(1)]);
});

test('폰 412: 자료실에 있던 자료(D3)는 삭제해도 자료는 남기고 브리핑만 삭제한다', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const calls = await open(page);
  await swipeLeft(page, row(page, D(3)));
  await page.locator('[data-row-swipe-key="delete"]').click();
  await expect(page.locator('.kptu-ask-text')).toHaveText('“예시 편람 개정안” 브리핑을 삭제할까요?');
  await expect(page.locator('.kptu-ask-note')).toContainText('자료는 삭제하지 않고');
  await answer(page);
  await expect(row(page, D(3))).toHaveCount(0);
  expect(calls.rpc).toEqual([D(3)]);
  expect(calls.actions.filter(a => a.action === 'delete')).toHaveLength(0);
});

test('PC 1280: ⋯ 단추 없음 · 줄 우클릭 = [수정][삭제] 두 가지, 삭제 규칙은 같다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const calls = await open(page);
  await expect(page.locator('#briefView .br-row .br-more')).toHaveCount(0);
  await row(page, D(2)).locator('.br-nm').click({ button: 'right' });
  await expect(page.locator('#rowMenu [data-row-item]')).toHaveText(['수정', '삭제']);
  await page.screenshot({ path: 'docs/design/screens/brief-swipe-menu/pc-1280-menu.png', fullPage: false });
  await page.keyboard.press('Escape');
  await row(page, D(3)).locator('.br-nm').click({ button: 'right' });
  await page.locator('#rowMenu [data-row-item="delete"]').click();
  await expect(page.locator('.kptu-ask-note')).toContainText('자료는 삭제하지 않고');
  await answer(page);
  await expect(row(page, D(3))).toHaveCount(0);
  expect(calls.rpc).toEqual([D(3)]);
  expect(calls.actions.filter(a => a.action === 'delete')).toHaveLength(0);
  await row(page, D(2)).locator('.br-nm').click({ button: 'right' });
  await page.locator('#rowMenu [data-row-item="delete"]').click();
  await answer(page);
  await expect(row(page, D(2))).toHaveCount(0);
  expect(calls.actions.filter(a => a.action === 'delete').map(a => a.document_id)).toEqual([D(2)]);
});
