// S70-27 BRIEF-손수정·우클릭(명진 11/25 11:14 "브리핑 ai가 만든걸 수기 수정가능하게 / 여기 우클릭 안먹네"):
// ① 머리 [고치기] → 줄 글 바꾸고 [저장] → 서버 함수(app_document_brief_edit)에 고친 한 장, AI 원문은 그대로 → 새로 불러와도 고친 글
//    → [원래 AI 글로 되돌리기] → 원래 글.  ② 손으로 고친 브리핑을 [다시 만들기]하면 먼저 묻고, [취소]면 그대로(서버 부름 없음).
// ③ PC 요약 글 우클릭 = 앱 메뉴(공용 줄 메뉴 [고치기]+고른 글 막대 항목), 브라우저 메뉴 아님. 고치는 칸 우클릭은 브라우저 기본 메뉴.
//    Shift+F10(키보드)도 같은 메뉴. 글을 골라 두고 우클릭하면 고른 글에 막대와 같은 일([밑줄 저장]).
// 자료 이름·문장은 모두 예시. 서버는 흉내(표 읽기는 owner RLS REST).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-00000000000${n}`;
const LINE1 = '예시 기관: 통합 운영 기준을 연내 마련';
const LINE2 = '예시 노선 운영 인력 재배치 계획 설명';
const NEW1 = '예시 기관: 통합 운영 기준을 내년 상반기까지 마련(손으로 고침)';
const brief3 = {
  v: 3, lead: '통합 운영 기준을 연내 마련하기로 함.',
  gist: ['통합 운영 기준을 연내 마련하기로 함.'],
  sections: [
    { title: '안건 1. 통합 운영', items: [{ text: LINE1, page: 12, ours: true }, { text: '예시 위원: 예산 재검토 요구', page: null }] },
    { title: '안건 2. 인력', items: [{ text: LINE2, page: 33 }] },
  ],
  quotes: [{ text: '연내에 기준을 마련하겠습니다.', speaker: '예시 국장', heading: '안건 1', page: 12 }],
};
const legacy = { lead: '예전 방식 요지', touches: ['예전 방식 줄 하나'], todos: [], conflicts: [] };
const row = (id, doc, brief) => ({ id, document_id: doc, status: 'done', stage: 'done', step_no: 9, step_total: 9, page_count: 40, brief, edited: null, edited_at: null, error_code: null, created_at: '2026-11-24T00:00:00Z', updated_at: '2026-11-24T00:10:00Z', finished_at: '2026-11-24T00:10:00Z' });

async function open(page, { columns = true } = {}) {
  const s = { briefs: [row('b3', D(3), brief3), row('b4', D(4), legacy)], edits: [], starts: [], hlPosts: [] };
  const docs = [
    { id: D(3), title: '예시 도시철도 통합 연구', file_name: '예시 연구.pdf', mime_type: 'application/pdf', file_id: 'FILE_cccccccccc', created_at: '2026-11-24T00:00:00Z' },
    { id: D(4), title: '예시 예전 자료', file_name: '예시 예전.pdf', mime_type: 'application/pdf', file_id: 'FILE_dddddddddd', created_at: '2026-11-23T00:00:00Z' },
  ];
  await openHome(page, {
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_document_briefs**', r => {
        const sel = new URL(r.request().url()).searchParams.get('select') || '';
        // DB 적용 전 흉내: 없는 칸을 고르면 PostgREST처럼 400.
        if (!columns && /edited/.test(sel)) return r.fulfill({ status: 400, json: { code: '42703', message: 'column does not exist' } });
        return r.fulfill({ json: s.briefs.map(b => (columns ? b : { ...b, edited: undefined, edited_at: undefined })) });
      });
      await page.route(SB + '/rest/v1/rpc/app_document_brief_edit', r => {
        const body = r.request().postDataJSON();
        s.edits.push(body);
        const b = s.briefs.find(x => x.id === body.p_brief_id);
        b.edited = body.p_edited; b.edited_at = body.p_edited ? '2026-11-25T03:00:00Z' : null;
        return r.fulfill({ json: b.edited_at });
      });
      await page.route(SB + '/functions/v1/document-actions', r => {
        const body = r.request().postDataJSON();
        if (body.action !== 'brief-start') return r.fallback();
        s.starts.push(body.document_id);
        const made = { ...row('b5', body.document_id, null), status: 'queued', stage: 'read', step_no: 0, step_total: 0, created_at: '2026-11-25T04:00:00Z' };
        s.briefs.unshift(made);
        return r.fulfill({ json: { ok: true, brief: made } });
      });
      await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'f-brief' }] : [] }));
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ document_id: D(3) }, { document_id: D(4) }] : [] }));
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        if (r.request().method() !== 'GET') return r.fallback();
        return new URL(r.request().url()).searchParams.get('id')?.startsWith('in.') ? r.fulfill({ json: docs }) : r.fallback();
      });
      await page.route(SB + '/rest/v1/app_news_highlights**', r => {
        const req = r.request();
        if (req.method() === 'POST') { const body = req.postDataJSON(); s.hlPosts.push(body); return r.fulfill({ status: 201, json: [{ ...body, id: 'e0000000-0000-4000-8000-000000000001', created_at: '2026-11-25T00:00:00Z', updated_at: '2026-11-25T00:00:00Z' }] }); }
        return r.fulfill({ json: [] });
      });
    },
  });
  return s;
}
const detail = page => page.locator('#briefView [data-br-detail]');
const body = page => detail(page).locator('[data-br-zone]');
async function openBrief(page, name, first) {
  await page.evaluate(() => window.KPTURouter.go('brief'));
  await expect(page.locator('#briefView .br-row')).toHaveCount(2);
  await page.locator('#briefView .br-row', { hasText: name }).click();
  await expect(body(page)).toContainText(first);
}
const ask = page => page.locator('.kptu-ask');

for (const [label, width, height] of [['phone-390', 390, 844], ['pc-1280', 1280, 860]]) {
  test(`브리핑 손으로 고치기 → 새로 불러와도 고친 글 → 원래 AI 글로 되돌리기 (${label})`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const s = await open(page);
    await openBrief(page, '통합 연구', LINE1);

    await detail(page).locator('[data-br-edit]').click();
    const field = detail(page).locator('textarea[data-br-field="i:0:0"]');
    await expect(field).toHaveValue(LINE1);
    await expect(detail(page).locator('textarea[data-br-field]')).toHaveCount(6); // 요지 1 + 소제목 2 + 줄 3(원문 인용은 칸 없음)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await field.fill(NEW1);
    await detail(page).locator('[data-br-edit-save]').click();
    await expect.poll(() => s.edits.length).toBe(1);
    const sent = s.edits[0];
    expect(sent.p_brief_id).toBe('b3');
    expect(sent.p_edited).toMatchObject({ v: 3, sections: [{ title: '안건 1. 통합 운영', items: [{ text: NEW1, page: 12, ours: true }, { text: '예시 위원: 예산 재검토 요구' }] }, { title: '안건 2. 인력' }] });
    expect(sent.p_edited.quotes).toEqual(brief3.quotes);
    expect(s.briefs.find(b => b.id === 'b3').brief).toEqual(brief3); // AI 원문은 그대로(서버 흉내 — 화면은 edited만 보냄)
    await expect(body(page).locator('.br-items li').first()).toContainText(NEW1);
    await expect(detail(page).locator('.br-edited')).toContainText('손으로 수정함');

    // 새로 불러와도 고친 글.
    await page.reload();
    await page.waitForFunction(() => window.KPTURouter?.go);
    await openBrief(page, '통합 연구', NEW1);
    await expect(body(page)).not.toContainText(LINE1);

    // [원래 AI 글로 되돌리기] → 묻기 → 되돌리기 → 원래 글.
    await detail(page).locator('[data-br-revert]').click();
    await expect(ask(page).locator('.kptu-ask-text')).toHaveText('손으로 수정한 글 대신 AI가 만든 글로 되돌릴까요?');
    await ask(page).getByRole('button', { name: '되돌리기' }).click();
    await expect.poll(() => s.edits.length).toBe(2);
    expect(s.edits[1]).toEqual({ p_brief_id: 'b3', p_edited: null });
    await expect(body(page).locator('.br-items li').first()).toContainText(LINE1);
    await expect(detail(page).locator('.br-edited')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('PC 1280: 요약 글 우클릭 = 앱 메뉴, Shift+F10도 같은 메뉴, 고른 글 우클릭 = 막대와 같은 항목, 고치는 칸 우클릭 = 브라우저 메뉴', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 860 });
  const s = await open(page);
  await openBrief(page, '통합 연구', LINE1);
  // 브라우저 기본 메뉴인지: contextmenu가 막혔는지(앱이 preventDefault 했는지)를 맨 바깥에서 본다.
  await page.evaluate(() => { window.__ctx = []; window.addEventListener('contextmenu', e => window.__ctx.push(e.defaultPrevented)); });
  const menu = page.locator('#rowMenu');
  const line2 = body(page).locator('[data-br-line="i:1:0"]');
  await line2.locator('.br-tx').click({ button: 'right' });
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => window.__ctx.at(-1))).toBe(true);
  const names = await menu.locator('[data-row-item]').allInnerTexts();
  expect(names.map(t => t.trim())).toEqual(['수정', '형광펜', '밑줄 저장', '메모', '노트로', '복사']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Shift+F10: 포커스 받은 줄의 같은 메뉴.
  await line2.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');

  // 고른 글 위 우클릭 → [밑줄 저장] = 고른 글 그대로 밑줄.
  await page.evaluate(t => {
    const zone = document.querySelector('#briefView [data-br-zone]');
    const w = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.data.indexOf(t); if (i < 0) continue; const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length); getSelection().removeAllRanges(); getSelection().addRange(r); return; }
  }, '인력 재배치');
  const at = await page.evaluate(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await menu.locator('[data-row-item="save"]').click();
  await expect.poll(() => s.hlPosts.length).toBe(1);
  expect(s.hlPosts[0]).toMatchObject({ source_type: 'brief', source_id: D(3), quote: '인력 재배치' });

  // 우클릭 [고치기] → 그 줄 칸에 커서. 고치는 칸 우클릭은 브라우저 기본 메뉴(앱 메뉴 없음).
  await line2.locator('.br-tx').click({ button: 'right' });
  await menu.locator('[data-row-item="edit"]').click();
  const field = detail(page).locator('textarea[data-br-field="i:1:0"]');
  await expect(field).toBeFocused();
  await field.click({ button: 'right' });
  expect(await page.evaluate(() => window.__ctx.at(-1))).toBe(false);
  await expect(menu).toBeHidden();
  await field.press('Escape');
  await expect(detail(page).locator('[data-br-form]')).toHaveCount(0);
  expect(s.edits).toEqual([]);
});

test('DB 적용 전(칸 없음 400): 브리핑 보기는 그대로, [고치기]만 없음', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await open(page, { columns: false });
  await openBrief(page, '통합 연구', LINE1);
  await expect(detail(page).locator('[data-br-edit]')).toHaveCount(0);
});
