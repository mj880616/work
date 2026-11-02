import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// NOTE-읽생기아이디어 1단계(요청함 10/28 01:08 주소 이전 ③·빠짐25): 노트 아래 댓글(생각·질문·인용, 본문 문장 고르면 인용), [댓글] 모아 보기(유형 칩),
// 본문 #낱말 → [태그] 모아 보기와 노트 머리의 #태그. 검색은 댓글 글도 찾는다. 댓글 표가 없으면(DB 적용 전) 댓글 칸만 '준비 중'.
// 폰 412·PC 1440. 이름·글은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
async function fixture(page, width, { table = true } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], posts = [], deletes = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const row = (id, title, raw_text, updated_at) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} });
  const rows = [
    row('n1', '바다 책', '바다는 넓고 깊다.\n#읽기 #바다', '2026-10-16T01:00:00Z'),
    row('n2', '회의 메모', '안건 정리 #회의 #읽기', '2026-10-12T01:00:00Z'),
    row('n3', '태그 없는 노트', '그냥 글 # 제목 아님', '2026-10-10T01:00:00Z'),
  ];
  const comments = [{ id: 'c1', workspace_id: 'w', note_id: 'n2', kind: 'question', quote: null, body: '다음 회의 언제?', created_at: '2026-10-13T01:00:00Z' }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => {
    const q = new URL(r.request().url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    return r.request().method() === 'GET' ? r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }) : r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_comments', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    if (!table) return r.fulfill({ status: 404, json: { code: 'PGRST205', message: 'Could not find the table public.app_note_comments' } });
    if (req.method() === 'GET') return r.fulfill({ json: structuredClone(comments) });
    if (req.method() === 'POST') { const body = req.postDataJSON(); posts.push(body); const made = { id: 'c' + (comments.length + 1), created_at: '2026-11-02T01:00:00Z', ...body }; comments.push(made); return r.fulfill({ status: 201, json: [made] }); }
    if (req.method() === 'DELETE') { const id = (q.get('id') || '').slice(3); deletes.push(id); const i = comments.findIndex(c => c.id === id); const gone = i >= 0 ? comments.splice(i, 1) : []; return r.fulfill({ json: gone.map(c => ({ id: c.id })) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { errors, posts, deletes };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const view = (page, name) => page.locator(`.nv-switch [data-note-view="${name}"]`);

for (const width of [412, 1440]) {
  test(`태그 모아 보기·댓글 쓰기(인용)·댓글 모아 보기·검색 (${width})`, async ({ page }) => {
    const { errors, posts, deletes } = await fixture(page, width);
    // [태그]: 많은 순 칩(#읽기 2, 그다음 이름 차례), 처음은 가장 많은 태그의 노트.
    await press(page, view(page, 'tag'), width);
    await expect(page.locator('[data-nt-tag]')).toHaveText(['#읽기2', '#바다1', '#회의1']);
    await expect(page.locator('[data-nt-tag="읽기"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#noteRows .basket-title-text')).toHaveText(['바다 책', '회의 메모']);
    await press(page, page.locator('[data-nt-tag="회의"]'), width);
    await expect(page.locator('#noteRows .basket-title-text')).toHaveText(['회의 메모']);
    // 노트를 열면 머리 줄에 #태그, 아래 댓글 칸(0개).
    await press(page, page.locator('#noteRows [data-note-row="n2"]'), width);
    await expect(page.locator('[data-note-meta-tags] [data-note-tag]')).toHaveText(['#회의', '#읽기']);
    await expect(page.locator('[data-cm-count]')).toHaveText('댓글 1');
    await expect(page.locator('[data-cm-row="c1"] .note-cm-kind')).toHaveText('질문');
    // 노트 머리의 #읽기 → [태그] 보기에서 #읽기.
    await press(page, page.locator('[data-note-tag="읽기"]'), width);
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    await expect(page.locator('[data-nt-tag="읽기"]')).toHaveAttribute('aria-pressed', 'true');
    // 바다 책: 본문 문장을 고르면 인용으로 붙고, 저장하면 서버에 kind quote + 그 문장.
    await press(page, page.locator('#noteRows [data-note-row="n1"]'), width);
    await expect(page.locator('[data-cm-count]')).toHaveText('댓글 0');
    await page.locator('[data-basket-read-text]').evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode()) && !node.textContent.includes('바다는')) {}
      const r = document.createRange(); const i = node.textContent.indexOf('바다는'); r.setStart(node, i); r.setEnd(node, i + '바다는 넓고 깊다.'.length);
      const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await expect(page.locator('[data-cm-quote]')).toBeVisible();
    await expect(page.locator('[data-cm-quote-text]')).toHaveText('바다는 넓고 깊다.');
    await expect(page.locator('[data-cm-kind]')).toHaveValue('quote');
    await page.locator('[data-cm-text]').fill('넓다는 말이 좋다');
    await press(page, page.locator('[data-cm-save]'), width);
    await expect(page.locator('[data-cm-count]')).toHaveText('댓글 1');
    expect(posts).toEqual([{ workspace_id: 'w', note_id: 'n1', kind: 'quote', quote: '바다는 넓고 깊다.', body: '넓다는 말이 좋다' }]);
    await expect(page.locator('.note-cm-row .note-cm-quote')).toHaveText('바다는 넓고 깊다.');
    await expect(page.locator('[data-cm-text]')).toHaveValue('');
    await expect(page.locator('[data-cm-kind]')).toHaveValue('thought');
    // 생각 댓글 하나 더 쓰고 지우기.
    await page.locator('[data-cm-text]').fill('지울 생각');
    await press(page, page.locator('[data-cm-save]'), width);
    await expect(page.locator('[data-cm-count]')).toHaveText('댓글 2');
    expect(posts[1]).toEqual({ workspace_id: 'w', note_id: 'n1', kind: 'thought', quote: null, body: '지울 생각' });
    await press(page, page.locator('.note-cm-row').filter({ hasText: '지울 생각' }).locator('[data-cm-del]'), width);
    await expect(page.locator('[data-cm-count]')).toHaveText('댓글 1');
    expect(deletes).toEqual(['c3']);
    // [댓글] 모아 보기: 최근 쓴 순, 유형 칩으로 거르기, 누르면 그 노트.
    await press(page, page.locator('[data-note-tag="바다"]'), width);
    await expect(page.locator('[data-nt-tag="바다"]')).toHaveAttribute('aria-pressed', 'true');
    await press(page, view(page, 'comment'), width);
    await expect(page.locator('[data-nt-kind]')).toHaveText(['전체', '생각', '질문', '인용']);
    await expect(page.locator('[data-nt-cm-open]')).toHaveCount(2);
    await expect(page.locator('[data-nt-cm-open]').first()).toContainText('넓다는 말이 좋다');
    await press(page, page.locator('[data-nt-kind="question"]'), width);
    await expect(page.locator('[data-nt-cm-open]')).toHaveCount(1);
    await expect(page.locator('[data-nt-cm-open]')).toContainText('다음 회의 언제?');
    await expect(page.locator('[data-nt-cm-open] .nx-path')).toContainText('회의 메모');
    // 검색은 댓글 글도 찾는다(목록 보기).
    await press(page, view(page, 'list'), width);
    await page.locator('[data-note-search]').fill('언제');
    await expect(page.locator('#noteRows .basket-title-text')).toHaveText(['회의 메모']);
    await page.locator('[data-note-search]').fill('');
    await press(page, view(page, 'comment'), width);
    await press(page, page.locator('[data-nt-cm-open="n2"]'), width);
    await expect(page.locator('[data-note-detail]')).toBeVisible();
    await expect(page.locator('[data-cm-row="c1"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('댓글 표가 아직 없으면 댓글 칸만 준비 중, 노트·태그는 그대로 (412)', async ({ page }) => {
  const { errors } = await fixture(page, 412, { table: false });
  await press(page, page.locator('#noteRows [data-note-row="n1"]'), 412);
  await expect(page.locator('[data-basket-read-text]')).toContainText('바다는 넓고 깊다.');
  await expect(page.locator('[data-cm-wait]')).toHaveText('댓글은 준비 중이에요.');
  await expect(page.locator('[data-cm-text]')).toHaveCount(0);
  await expect(page.locator('[data-note-meta-tags] [data-note-tag]')).toHaveText(['#읽기', '#바다']);
  expect(errors).toEqual([]);
});
