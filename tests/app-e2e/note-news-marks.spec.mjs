import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
// S62-13 NOTE-News밑줄보관보기(명진 11/15 '가'·'추천대로', 시안 docs/design/mockups/note-news-marks.html ①~④):
// 노트 [폴더] 목록 맨 아래 'News에서' + [밑줄 n]·[보관한 글 n]. 복사본 없이 News와 같은 서버 자료(app_news_highlights, app_outside_marks·app_news_items 별표)를 읽는다.
// 밑줄 ⋯ = News 밑줄 메뉴 + [원문에서 보기], 보관한 글 [전체|뉴스|사회운동 글], 노트 검색이 밑줄·보관도 찾음('노트 n · 밑줄 n · 보관 n'),
// [목록] 등 다른 보기에는 없음, 줄을 누르면 News로 가서 그 글을 연다. 폰 412·폴드 펼침 880·PC 1280. 글은 모두 가상.
// 화면 사진: S62_SHOTS=1이면 docs/design/screens/s62-13/에 찍는다(PR 첨부용, 평소 CI에서는 찍지 않음).
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHOTS = process.env.S62_SHOTS ? 'docs/design/screens/s62-13/' : '';
const NEWS1 = 'a6000000-0000-4000-8000-000000000001', NEWS2 = 'a6000000-0000-4000-8000-000000000002', POST1 = 'a6000000-0000-4000-8000-000000000003';
const HL1 = 'b6000000-0000-4000-8000-000000000001', HL2 = 'b6000000-0000-4000-8000-000000000002';

async function fixture(page, width) {
  await page.setViewportSize({ width, height: width < 761 ? 860 : 820 });
  const errors = [], s = { calls: [], deletes: [], patches: [] };
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const note = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const notes = [note('n1', '가상 회의 — 철도 현장 간담회 정리', '2026-10-05T01:00:00Z', { folder_id: U(1), folder: '가상 회의' }), note('n2', '가상 성명 초안', '2026-10-04T01:00:00Z', { folder_id: U(2), folder: '가상 성명' }), note('n3', '폴더 밖 메모', '2026-10-03T01:00:00Z')];
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '가상 회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }, { id: U(2), workspace_id: 'w', parent_id: null, name: '가상 성명', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' }];
  s.hl = [
    { id: HL1, source_type: 'news', source_id: NEWS1, quote: '가상공단은 내년 상반기까지 점검 인력을 늘리기로 했다', quote_prefix: '', quote_suffix: '', memo: '자료에 넣기', source_title: '철도 안전점검 인력 확대 가상 기사', source_media: '가상일보', source_date: '2026-10-04T00:00:00Z', source_url: 'https://example.org/a1', created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' },
    { id: HL2, source_type: 'news', source_id: NEWS2, quote: '총인건비 인상률은 지침 범위 안에서 정한다', quote_prefix: '', quote_suffix: '', memo: null, source_title: '내년 예산 편성 가상 지침', source_media: '가상뉴스', source_date: '2026-10-02T00:00:00Z', source_url: 'https://example.org/a2', created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z' },
  ];
  const news = [
    { id: NEWS1, lane: 'keyword', url: 'https://example.org/a1', title: '철도 안전점검 인력 확대 가상 기사', lang: 'ko', publisher: '가상일보', published_at: '2026-10-04T00:00:00Z', created_at: '2026-10-04T00:00:00Z', summary: null, title_ko: null, starred_at: '2026-10-05T02:00:00Z', folder_id: null, state: 'ok', body_kind: null },
    { id: NEWS2, lane: 'keyword', url: 'https://example.org/a2', title: '내년 예산 편성 가상 지침', lang: 'ko', publisher: '가상뉴스', published_at: '2026-10-02T00:00:00Z', created_at: '2026-10-02T00:00:00Z', summary: null, title_ko: null, starred_at: '2026-10-04T02:00:00Z', folder_id: null, state: 'ok', body_kind: null },
  ];
  const marks = [{ post_id: POST1, starred_at: null, archived_at: '2026-10-05T03:00:00Z', app_outside_posts: { id: POST1, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '현장 노동자 안전 가상 증언 모음', title_ko: null, url: 'https://example.org/p1', published_at: '2026-10-03T00:00:00Z', fetched_at: '2026-10-03T00:10:00Z', summary_ko: null, key_sentences: [], has_body: false } }];
  await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/'), async r => {
    const req = r.request(), u = new URL(req.url()), table = u.pathname.slice('/rest/v1/'.length), method = req.method(), q = u.searchParams;
    const id = (q.get('id') || '').replace(/^eq\./, '');
    if (['app_news_highlights', 'app_outside_article_marks', 'app_news_marks'].includes(table)) s.calls.push(table + ' ' + method + ' ' + decodeURIComponent(u.search));
    if (table === 'app_notes' && method === 'GET') return r.fulfill({ json: notes.filter(x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!id || x.id === id)).map(x => structuredClone(x)) });
    if (table === 'app_note_folders' && method === 'GET') return r.fulfill({ json: structuredClone(folders) });
    if (table === 'app_news_highlights') {
      if (method === 'DELETE') { s.deletes.push(id); s.hl = s.hl.filter(x => x.id !== id); return r.fulfill({ status: 204 }); }
      if (method === 'PATCH') { const body = req.postDataJSON(); s.patches.push({ id, body }); const h = s.hl.find(x => x.id === id); if (h) Object.assign(h, body); return r.fulfill({ json: h ? [structuredClone(h)] : [] }); }
      return r.fulfill({ json: structuredClone(s.hl) });
    }
    // NEWS-모두에게열기 ③: 보관은 내 표시 표(공용 글 embed) — 옛 모양(post_id·app_outside_posts)을 새 모양(article_id·app_outside_articles)으로.
    if (table === 'app_outside_article_marks' && method === 'GET') return r.fulfill({ json: structuredClone(marks).map(({ post_id, app_outside_posts, ...m }) => ({ ...m, article_id: post_id, dismissed_at: null, app_outside_articles: app_outside_posts })) });
    if (table === 'app_news_marks' && method === 'GET') return r.fulfill({ json: structuredClone(news.filter(x => x.starred_at)).map(({ starred_at, folder_id, ...a }) => ({ article_id: a.id, starred_at, folder_id: folder_id ?? null, hidden_at: null, keywords: [], app_news_articles: a })) });
    if (table === 'app_news_articles' && method === 'GET') return r.fulfill({ json: structuredClone(id ? news.filter(x => x.id === id) : news).map(({ starred_at, folder_id, ...a }) => ({ ...a, app_news_marks: starred_at ? [{ starred_at, folder_id: folder_id ?? null, hidden_at: null, keywords: [] }] : [] })) });
    if (table === 'app_record_links' || table === 'app_note_comments') return r.fulfill({ json: [] });
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_feed_reads' || table === 'app_feed_bodies') return method === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 201, json: [] });
    return r.fallback();
  });
  await page.route(u => u.origin === SB && u.pathname.startsWith('/functions/v1/') && /outside-feed|news-feed|ai-assist/.test(u.pathname), r => r.fulfill({ json: { ok: true, sources: [], limits: {}, ran: false, added: 0 } }));
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  const ws = await page.evaluate(() => window.KPTURuntime.context.read().workspace.id);
  return { s, errors, ws };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const navRow = (page, id, width) => page.locator(`${width < 600 ? '#noteRows' : '[data-nx-tree]'} [data-nx-news-item="${id}"] .ft-main`);
const box = page => page.locator('#basketView [data-nnm]');

for (const width of [412, 880, 1280]) {
  test(`${width}: 폴더 목록 맨 아래 'News에서' 두 줄 → 밑줄 목록(⋯ 메뉴에 원문에서 보기) · 내 작업공간 자료만 읽음`, async ({ page }) => {
    const { s, errors, ws } = await fixture(page, width);
    const list = width < 600 ? page.locator('#noteRows') : page.locator('[data-nx-tree]');
    await expect(list.locator('.nnm-sep')).toHaveText('News에서');
    await expect(navRow(page, 'news-hl', width)).toContainText('밑줄');
    await expect(navRow(page, 'news-hl', width).locator('.ft-num')).toHaveText('2');
    await expect(navRow(page, 'news-saved', width).locator('.ft-num')).toHaveText('3');
    // 'News에서'는 '폴더 없음' 아래, [+ 새 폴더] 위.
    const order = await list.evaluate(el => [...el.querySelectorAll('.nx-outside, .nnm-sep, .nx-news-item, .nx-new-folder')].map(x => x.className.includes('nx-outside') ? 'out' : x.className.includes('nnm-sep') ? 'sep' : x.className.includes('nx-new-folder') ? 'new' : x.dataset.nxNewsItem));
    expect(order.filter(x => x !== 'new')).toEqual(['out', 'sep', 'news-hl', 'news-saved']);
    if (SHOTS && width === 412) await page.screenshot({ path: SHOTS + '412-1-folder-list.png' });
    // 읽기는 내 작업공간 것만(서버 RLS 그대로 + 작업공간 조건): 밑줄·보관 읽기가 모두 workspace_id=eq.<내 것>.
    for (const c of s.calls.filter(x => / GET /.test(x))) expect(c).toContain(`workspace_id=eq.${ws}`);
    await press(page, navRow(page, 'news-hl', width), width);
    const b = box(page);
    await expect(b.locator('.nh-row')).toHaveCount(2);
    await expect(b.locator('.nh-row').first().locator('.nh-q')).toHaveText(s.hl[0].quote);
    await expect(b.locator('.nh-row').first().locator('.nh-memo')).toContainText('자료에 넣기');
    await expect(b.locator('[data-nnm-news]')).toHaveText('News에서 보기 ↗');
    if (width < 600) await expect(b.locator('[data-nnm-focus]')).toBeVisible();
    await press(page, b.locator('.nh-row').first().locator('[data-nh-more]'), width);
    const menu = page.locator('#hlMarkMenu');
    await expect(menu.locator('button')).toHaveText(['메모 수정', '원문에서 보기', '노트로', '복사', '삭제']);
    if (SHOTS) await page.screenshot({ path: SHOTS + `${width}-2-highlights-menu.png` });
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
}

test('412: 노트에서 메모를 고치고 밑줄을 지우면 같은 서버 자료가 바뀌고(복사본 없음) News [밑줄] 탭도 같다', async ({ page }) => {
  const { s, errors } = await fixture(page, 412);
  await navRow(page, 'news-hl', 412).tap();
  const b = box(page);
  await b.locator('.nh-row').nth(1).locator('[data-nh-more]').tap();
  await page.locator('#hlMarkMenu [data-hl-menu="memo"]').tap();
  await page.locator('.kptu-ask .kptu-ask-field').fill('새 가상 메모');
  await page.locator('.kptu-ask .kptu-ask-actions button').nth(1).tap();
  await expect(b.locator('.nh-row').nth(1).locator('.nh-memo')).toContainText('새 가상 메모');
  expect(s.patches.map(p => p.id)).toEqual([HL2]);
  await b.locator('.nh-row').first().locator('[data-nh-more]').tap();
  await page.locator('#hlMarkMenu [data-hl-menu="delete"]').tap();
  await page.locator('.kptu-ask .kptu-ask-actions button').nth(1).tap();
  await expect(b.locator('.nh-row')).toHaveCount(1);
  expect(s.deletes).toEqual([HL1]);
  await expect(b.locator('.ft-focus-head')).toContainText('1');
  // News [밑줄] 탭: 같은 밑줄 하나, 같은 메모.
  await page.evaluate(() => window.KPTURouter.go('news'));
  await page.locator('#outsideRoot').getByRole('tab', { name: '밑줄' }).click();
  await expect(page.locator('[data-now-panel-marks] .nh-row')).toHaveCount(1);
  await expect(page.locator('[data-now-panel-marks] .nh-memo')).toContainText('새 가상 메모');
  expect(errors).toEqual([]);
});

test('880: 보관한 글 — [전체|뉴스|사회운동 글] 거르기, 줄 ⋯ = 보관 풀기, 줄을 누르면 News 그 글', async ({ page }) => {
  const { errors } = await fixture(page, 880);
  await navRow(page, 'news-saved', 880).click();
  const b = box(page);
  await expect(b.locator('[data-nnm-kind]')).toHaveText(['전체', '뉴스', '사회운동 글']);
  await expect(b.locator('.nnm-sv')).toHaveCount(3);
  await expect(b.locator('.nnm-sv').first().locator('.nnm-t')).toHaveText('현장 노동자 안전 가상 증언 모음');
  await expect(b.locator('.nnm-sv').first().locator('.nnm-tag')).toHaveText('보관');
  await expect(b.locator('.nnm-sv').nth(1).locator('.nnm-star')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: SHOTS + '880-3-saved.png' });
  await b.locator('[data-nnm-kind="news"]').click();
  await expect(b.locator('.nnm-sv')).toHaveCount(2);
  await b.locator('[data-nnm-kind="outside"]').click();
  await expect(b.locator('.nnm-sv')).toHaveCount(1);
  await b.locator('[data-nnm-kind="all"]').click();
  await b.locator('.nnm-sv').nth(1).locator('[data-now-more]').click();
  await expect(page.locator('#rowMenu')).toContainText('보관 풀기');
  await page.keyboard.press('Escape');
  await b.locator('.nnm-sv').nth(1).locator('[data-nnm-saved]').click();
  await expect.poll(() => page.evaluate(() => window.KPTURouter.current)).toBe('outside');
  await expect(page.locator('#outsideRoot').getByRole('tab', { name: '보관' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#outsideRoot')).toHaveAttribute('data-detail', 'open');
  expect(errors).toEqual([]);
});

test('1280: 노트 검색이 노트·밑줄·보관을 함께 찾는다(꼬리표, 노트 n · 밑줄 n · 보관 n) · [목록] 보기에는 News에서가 없다', async ({ page }) => {
  const { errors } = await fixture(page, 1280);
  await page.locator('[data-note-search]').fill('철도');
  await expect(page.locator('[data-nnm-head]')).toContainText('노트 1 · 밑줄 1 · 보관 1');
  await expect(page.locator('#noteRows [data-note-row="n1"]')).toBeVisible();
  const b = box(page);
  await expect(b.locator('.nh-row .nnm-tag')).toHaveText(['밑줄']);
  await expect(b.locator('.nnm-sv .nnm-tag')).toHaveText(['보관']);
  if (SHOTS) await page.screenshot({ path: SHOTS + '1280-4-search.png' });
  // 노트에는 없고 밑줄에만 있는 말도 '맞는 노트 없음'으로 가리지 않는다.
  await page.locator('[data-note-search]').fill('총인건비');
  await expect(page.locator('[data-nnm-head]')).toContainText('노트 0 · 밑줄 1 · 보관 0');
  await expect(page.locator('[data-note-list-status]')).not.toContainText('맞는 노트 없음');
  await page.locator('[data-note-search]').fill('');
  await page.locator('[data-note-view="list"]').click();
  await expect(page.locator('#basketView .nnm-sep')).toHaveCount(0);
  await expect(box(page)).toBeHidden();
  await expect(page.locator('[data-nnm-head]')).toBeHidden();
  expect(errors).toEqual([]);
});

test('1280: 밑줄 줄을 누르면 News [밑줄] 탭에서 그 글이 열린다', async ({ page }) => {
  const { errors } = await fixture(page, 1280);
  await navRow(page, 'news-hl', 1280).click();
  await box(page).locator('.nh-row').first().locator('[data-nh-open]').click();
  await expect.poll(() => page.evaluate(() => window.KPTURouter.current)).toBe('outside');
  await expect(page.locator('#outsideRoot').getByRole('tab', { name: '밑줄' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#outsideRoot')).toHaveAttribute('data-detail', 'open');
  expect(errors).toEqual([]);
});
