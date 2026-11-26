// BRIEF-브리핑룸삭제(S63-08): 브리핑 룸 줄 ⋯(폰 길게 누르기·PC 우클릭도) [브리핑만 삭제]·[자료까지 삭제], 여러 개 선택도 같은 두 가지.
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

for (const [label, width, height] of [['phone-412', 412, 915], ['pc-1280', 1280, 860]]) {
  test(`브리핑만 삭제: 목록에서 빠지고 자료는 그대로(폴더 밖으로), 만드는 중도 멈춤 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await open(page);
    await row(page, D(1)).locator('[data-br-more]').click();
    const menu = page.locator('#brRowMenu');
    // S70-84: [폴더로 옮기기…](브리핑 폴더 — 공용 '옮길 곳' 창)가 [선택] 다음에.
    await expect(menu.locator('button')).toHaveText(['선택', '폴더로 옮기기…', '브리핑만 삭제', '자료까지 삭제']);
    await page.screenshot({ path: `docs/design/screens/s63-08/${label}-menu.png`, fullPage: false });
    await menu.locator('[data-br-act="brief"]').click();
    await expect(page.locator('.kptu-ask-text')).toHaveText('“예시 계획 자료” 브리핑만 삭제할까요?');
    await answer(page);
    await expect(row(page, D(1))).toHaveCount(0);
    expect(calls.rpc).toEqual([D(1)]);
    expect(calls.folderDelete).toEqual([D(1)]);
    expect(calls.actions.filter(a => a.action === 'delete')).toHaveLength(0);
  });
}

test('자료까지 삭제: 자료실 삭제와 같은 서버 길(Drive 휴지통), 목록에서 빠짐', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const calls = await open(page);
  // PC 우클릭은 공용 우클릭 메뉴가 그 줄 ⋯를 연다.
  await row(page, D(3)).locator('.br-nm').click({ button: 'right' });
  await expect(page.locator('#brRowMenu')).toBeVisible();
  await page.locator('#brRowMenu [data-br-act="doc"]').click();
  await expect(page.locator('.kptu-ask-note')).toContainText('휴지통');
  await answer(page);
  await expect(row(page, D(3))).toHaveCount(0);
  expect(calls.actions.filter(a => a.action === 'delete').map(a => a.document_id)).toEqual([D(3)]);
});

for (const [label, width, height] of [['phone-412', 412, 915], ['pc-1280', 1280, 860]]) {
  test(`여러 개 선택: 같은 두 가지 중 고름 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const calls = await open(page);
    await row(page, D(2)).locator('[data-br-more]').click();
    await page.locator('#brRowMenu [data-br-act="select"]').click();
    await expect(page.locator('#briefView .br-count')).toHaveText('1개 선택됨');
    await row(page, D(3)).locator('.br-nm').click();
    await expect(page.locator('#briefView .br-count')).toHaveText('2개 선택됨');
    await expect(page.locator('#briefView [data-br-del-many]')).toHaveText(['브리핑만 삭제', '자료까지 삭제']);
    await page.screenshot({ path: `docs/design/screens/s63-08/${label}-select.png`, fullPage: false });
    await page.locator('#briefView [data-br-del-many="brief"]').click();
    await expect(page.locator('.kptu-ask-text')).toHaveText('2개 브리핑만 삭제할까요?');
    await answer(page);
    await expect(page.locator('#briefView .br-row')).toHaveCount(1);
    expect(calls.rpc.sort()).toEqual([D(2), D(3)]);
    // D(2)만 '브리핑 요청함' 폴더에 있었다.
    expect(calls.folderDelete).toEqual([D(2)]);
    await expect(page.locator('#briefView .br-count')).toHaveCount(0);
  });
}
