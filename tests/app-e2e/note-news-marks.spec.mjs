import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import {screenFind} from './helpers/screen-find.mjs';
// S62-13 NOTE-News밑줄보관보기(명진 11/15 '가'·'추천대로', 시안 docs/design/mockups/note-news-marks.html ①~④):
// 노트 [폴더] 목록 맨 아래 'News에서' + [밑줄 n]·[보관한 글 n]. 복사본 없이 News와 같은 서버 자료(app_news_highlights, app_outside_marks·app_news_items 별표)를 읽는다.
// 밑줄 ⋯ = News 밑줄 메뉴 + [원문에서 보기], 보관한 글 [전체|뉴스|사회운동 글], 노트 검색이 밑줄·보관도 찾음('노트 n · 밑줄 n · 보관 n'),
// [목록] 등 다른 보기에는 없음, 줄을 누르면 News로 가서 그 글을 연다. 폰 412·폴드 펼침 880·PC 1280. 글은 모두 가상.
// 화면 사진: S62_SHOTS=1이면 docs/design/screens/s62-13/에 찍는다(PR 첨부용, 평소 CI에서는 찍지 않음).
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHOTS = process.env.S62_SHOTS ? 'docs/design/screens/s62-13/' : '';
// S62-24 NOTE-News에서글자빼기 화면 사진: S62_24_SHOTS=1이면 docs/design/screens/s62-24/에 찍는다(평소 CI에서는 찍지 않음).
const SHOTS24 = process.env.S62_24_SHOTS ? 'docs/design/screens/s62-24/' : '';
const NEWS1 = 'a6000000-0000-4000-8000-000000000001', NEWS2 = 'a6000000-0000-4000-8000-000000000002', POST1 = 'a6000000-0000-4000-8000-000000000003';
const HL1 = 'b6000000-0000-4000-8000-000000000001', HL2 = 'b6000000-0000-4000-8000-000000000002', HL3 = 'b6000000-0000-4000-8000-000000000003', HL4 = 'b6000000-0000-4000-8000-000000000004';
const NOTE4 = 'd6000000-0000-4000-8000-000000000004';

// opts.noteHl: S62-17 NOTE-노트에서도밑줄 — UUID 이름의 노트 하나(NOTE4)와 그 노트에서 저장한 밑줄 둘(그대로 있는 글·노트를 고쳐 없어진 글).
async function fixture(page, width, opts = {}) {
  await page.setViewportSize({ width, height: width < 761 ? 860 : 820 });
  const errors = [], s = { calls: [], deletes: [], patches: [], posts: [] };
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const note = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const notes = opts.fresh ? [] : [...(opts.noteHl ? [note(NOTE4, '가상 메모 노트', '2026-10-06T01:00:00Z')] : []), note('n1', '가상 회의 — 철도 현장 간담회 정리', '2026-10-05T01:00:00Z', { folder_id: U(1), folder: '가상 회의' }), note('n2', '가상 성명 초안', '2026-10-04T01:00:00Z', { folder_id: U(2), folder: '가상 성명' }), note('n3', '폴더 밖 메모', '2026-10-03T01:00:00Z')];
  const folders = opts.fresh ? [] : [{ id: U(1), workspace_id: 'w', parent_id: null, name: '가상 회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }, { id: U(2), workspace_id: 'w', parent_id: null, name: '가상 성명', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' }];
  s.hl = [
    { id: HL1, source_type: 'news', source_id: NEWS1, quote: '가상공단은 내년 상반기까지 점검 인력을 늘리기로 했다', quote_prefix: '', quote_suffix: '', memo: '자료에 넣기', source_title: '철도 안전점검 인력 확대 가상 기사', source_media: '가상일보', source_date: '2026-10-04T00:00:00Z', source_url: 'https://example.org/a1', created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' },
    { id: HL2, source_type: 'news', source_id: NEWS2, quote: '총인건비 인상률은 지침 범위 안에서 정한다', quote_prefix: '', quote_suffix: '', memo: null, source_title: '내년 예산 편성 가상 지침', source_media: '가상뉴스', source_date: '2026-10-02T00:00:00Z', source_url: 'https://example.org/a2', created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z' },
  ];
  if (opts.noteHl) s.hl.unshift(
    { id: HL3, source_type: 'note', source_id: NOTE4, quote: '메모 노트 본', quote_prefix: '가상 ', quote_suffix: '문', memo: null, source_title: '가상 메모 노트', source_media: '노트', source_date: '2026-10-06T01:00:00Z', source_url: null, created_at: '2026-10-06T01:30:00Z', updated_at: '2026-10-06T01:30:00Z' },
    { id: HL4, source_type: 'note', source_id: NOTE4, quote: '노트를 고치기 전 문장', quote_prefix: '', quote_suffix: '', memo: null, source_title: '가상 메모 노트', source_media: '노트', source_date: '2026-10-06T01:00:00Z', source_url: null, created_at: '2026-10-06T01:20:00Z', updated_at: '2026-10-06T01:20:00Z' });
  const news = [
    { id: NEWS1, lane: 'keyword', url: 'https://example.org/a1', title: '철도 안전점검 인력 확대 가상 기사', lang: 'ko', publisher: '가상일보', published_at: '2026-10-04T00:00:00Z', created_at: '2026-10-04T00:00:00Z', summary: null, title_ko: null, starred_at: '2026-10-05T02:00:00Z', folder_id: null, state: 'ok', body_kind: null },
    { id: NEWS2, lane: 'keyword', url: 'https://example.org/a2', title: '내년 예산 편성 가상 지침', lang: 'ko', publisher: '가상뉴스', published_at: '2026-10-02T00:00:00Z', created_at: '2026-10-02T00:00:00Z', summary: null, title_ko: null, starred_at: '2026-10-04T02:00:00Z', folder_id: null, state: 'ok', body_kind: null },
  ];
  // S67-09: 옛 보관 표시는 DB(20261119120000)가 별표(같은 시각)로 채웠다 — 옮긴 뒤 모양(보관 = 별표).
  const marks = [{ post_id: POST1, starred_at: '2026-10-05T03:00:00Z', archived_at: '2026-10-05T03:00:00Z', app_outside_posts: { id: POST1, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '현장 노동자 안전 가상 증언 모음', title_ko: null, url: 'https://example.org/p1', published_at: '2026-10-03T00:00:00Z', fetched_at: '2026-10-03T00:10:00Z', summary_ko: null, key_sentences: [], has_body: false } }];
  await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/'), async r => {
    const req = r.request(), u = new URL(req.url()), table = u.pathname.slice('/rest/v1/'.length), method = req.method(), q = u.searchParams;
    const id = (q.get('id') || '').replace(/^eq\./, '');
    if (['app_news_highlights', 'app_outside_article_marks', 'app_news_marks', 'app_reading_items'].includes(table)) s.calls.push(table + ' ' + method + ' ' + decodeURIComponent(u.search));
    if (table === 'app_notes' && method === 'GET') return r.fulfill({ json: notes.filter(x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!id || x.id === id)).map(x => structuredClone(x)) });
    if (table === 'app_note_folders' && method === 'GET') return r.fulfill({ json: structuredClone(folders) });
    if (table === 'app_news_highlights') {
      if (method === 'DELETE') { s.deletes.push(id); s.hl = s.hl.filter(x => x.id !== id); return r.fulfill({ status: 204 }); }
      if (method === 'POST') { const body = req.postDataJSON(); s.posts.push(body); const row = { id: `c6000000-0000-4000-8000-00000000000${s.posts.length}`, ...body, created_at: '2026-10-06T02:00:00Z', updated_at: '2026-10-06T02:00:00Z' }; s.hl.unshift(row); return r.fulfill({ status: 201, json: [structuredClone(row)] }); }
      if (method === 'PATCH') { const body = req.postDataJSON(); s.patches.push({ id, body }); const h = s.hl.find(x => x.id === id); if (h) Object.assign(h, body); return r.fulfill({ json: h ? [structuredClone(h)] : [] }); }
      return r.fulfill({ json: structuredClone(s.hl) });
    }
    // S68-27 READ-보관기록일원화: 보관은 내 읽을 거리 줄(원래 글 연결 칸 + 글 embed). 가짜 자료의 starred_at = 그 줄의 저장 시각.
    if (table === 'app_reading_items' && method === 'GET' && q.get('outside_article_id') === 'not.is.null')
      return r.fulfill({ json: structuredClone(marks).map(({ post_id, starred_at, app_outside_posts }) => ({ outside_article_id: post_id, saved_at: starred_at, app_outside_articles: app_outside_posts })) });
    if (table === 'app_reading_items' && method === 'GET' && q.get('news_article_id') === 'not.is.null')
      return r.fulfill({ json: structuredClone(news.filter(x => x.starred_at)).map(({ starred_at, folder_id, ...a }) => ({ id: 'r-' + a.id, saved_at: starred_at, app_news_articles: { ...a, app_news_marks: [{ folder_id: folder_id ?? null, hidden_at: null, keywords: [] }] } })) });
    if (table === 'app_outside_article_marks' && method === 'GET') return r.fulfill({ json: [] });
    if (table === 'app_news_marks' && method === 'GET') return r.fulfill({ json: [] });
    if (table === 'app_news_articles' && method === 'GET') return r.fulfill({ json: structuredClone(id ? news.filter(x => x.id === id) : news).map(({ starred_at, folder_id, ...a }) => ({ ...a, app_news_marks: [{ folder_id: folder_id ?? null, hidden_at: null, keywords: [] }], app_reading_items: starred_at ? [{ saved_at: starred_at }] : [] })) });
    if (table === 'app_record_links' || table === 'app_note_comments') return r.fulfill({ json: [] });
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_feed_reads' || table === 'app_feed_bodies') return method === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 201, json: [] });
    return r.fallback();
  });
  await page.route(u => u.origin === SB && u.pathname.startsWith('/functions/v1/') && /outside-feed|news-feed|ai-assist/.test(u.pathname), r => r.fulfill({ json: { ok: true, sources: [], limits: {}, ran: false, added: 0 } }));
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText(`노트 · ${notes.length}`);
  const ws = await page.evaluate(() => window.KPTURuntime.context.read().workspace.id);
  return { s, errors, ws };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const navRow = (page, id, width) => page.locator(`${width < 600 ? '#noteRows' : '[data-nx-tree]'} [data-nx-news-item="${id}"] .ft-main`);
const box = page => page.locator('#basketView [data-nnm]');

for (const width of [412, 880, 1280]) {
  test(`${width}: 폴더 목록 맨 아래 얇은 줄(글자 없음) + 두 줄 → 밑줄 목록(⋯ 메뉴에 원문에서 보기) · 내 작업공간 자료만 읽음`, async ({ page }) => {
    const { s, errors, ws } = await fixture(page, width);
    const list = width < 600 ? page.locator('#noteRows') : page.locator('[data-nx-tree]');
    // NOTE-News에서글자빼기: 구분 줄은 글자 없는 얇은 줄만. 노트 화면 어디에도 'News에서' 글자가 없다(줄마다 출처 꼬리표는 그대로).
    await expect(list.locator('.nnm-sep')).toHaveCount(1);
    await expect(list.locator('.nnm-sep')).toHaveText('');
    expect(await list.locator('.nnm-sep').evaluate(el => parseFloat(getComputedStyle(el).borderTopWidth) > 0 && el.getBoundingClientRect().height <= 2)).toBeTruthy();
    await expect(page.locator('#basketView')).not.toContainText('News에서');
    expect(await page.locator('#basketView [aria-label*="News"]').count()).toBe(0);
    await expect(navRow(page, 'news-hl', width)).toContainText('밑줄');
    await expect(navRow(page, 'news-hl', width).locator('.ft-num')).toHaveText('2');
    await expect(navRow(page, 'news-saved', width).locator('.ft-num')).toHaveText('3');
    // 구분 줄과 줄들(밑줄·메모·저장한 글)은 '폴더 없음' 아래, [+ 새 폴더] 위.
    const order = await list.evaluate(el => [...el.querySelectorAll('.nx-outside, .nnm-sep, .nx-news-item, .nx-new-folder')].map(x => x.className.includes('nx-outside') ? 'out' : x.className.includes('nnm-sep') ? 'sep' : x.className.includes('nx-new-folder') ? 'new' : x.dataset.nxMemoItem !== undefined ? 'memo' : x.dataset.nxNewsItem));
    // S69-94: 밑줄 바로 아래 '메모' 한 줄(노트 [메모] 보기로 감).
    expect(order.filter(x => x !== 'new')).toEqual(['out', 'sep', 'news-hl', 'memo', 'news-saved']);
    if (SHOTS && width === 412) await page.screenshot({ path: SHOTS + '412-1-folder-list.png' });
    if (SHOTS24) await page.screenshot({ path: SHOTS24 + `note-folder-list-${width}.png` });
    // 읽기는 내 작업공간 것만(서버 RLS 그대로 + 작업공간 조건): 밑줄·보관 읽기가 모두 workspace_id=eq.<내 것>.
    for (const c of s.calls.filter(x => / GET /.test(x))) expect(c).toContain(`workspace_id=eq.${ws}`);
    await press(page, navRow(page, 'news-hl', width), width);
    const b = box(page);
    await expect(b.locator('.nh-row')).toHaveCount(2);
    await expect(b.locator('.nh-row').first().locator('.nh-q')).toHaveText(s.hl[0].quote);
    await expect(b.locator('.nh-row').first().locator('.nh-memo')).toContainText('자료에 넣기');
    // S62-17: 머리 줄 [News에서 보기 ↗]는 뺐다(줄마다 원문으로 감). 머리 아이콘은 폴더가 아니라 밑줄 띠 하나(글 없이 따로 붙은 띠 없음).
    await expect(b.locator('[data-nnm-news]')).toHaveCount(0);
    await expect(b.locator('.nnm-hlico')).toHaveCount(1);
    await expect(b.locator('.nnm-bar')).toHaveCount(0);
    if (width < 600) { await expect(b.locator('[data-nnm-focus]')).toBeVisible(); await expect(b.locator('.ft-focus-head .nnm-hlico')).toBeVisible(); await expect(b.locator('.ft-focus-head .ft-ico:not(.nnm-hlico)')).toHaveCount(0); }
    await expect(b.locator('.nh-row').first().locator('.nh-src')).toHaveText('읽을 거리');
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
  // 보관 = 별표(S67-09): 사회운동 글 줄도 ★, '보관' 글씨 없음.
  await expect(b.locator('.nnm-sv').first().locator('.nnm-star')).toBeVisible();
  await expect(b.locator('.nnm-sv').first().locator('.nnm-tag')).toHaveCount(0);
  await expect(b.locator('.nnm-sv').nth(1).locator('.nnm-star')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: SHOTS + '880-3-saved.png' });
  await b.locator('[data-nnm-kind="news"]').click();
  await expect(b.locator('.nnm-sv')).toHaveCount(2);
  await b.locator('[data-nnm-kind="outside"]').click();
  await expect(b.locator('.nnm-sv')).toHaveCount(1);
  await b.locator('[data-nnm-kind="all"]').click();
  await b.locator('.nnm-sv').nth(1).locator('[data-now-more]').click();
  await expect(page.locator('#rowMenu')).toContainText('삭제');
  await page.keyboard.press('Escape');
  const key = await b.locator('.nnm-sv').nth(1).getAttribute('data-nw-key');
  await b.locator('.nnm-sv').nth(1).locator('[data-nnm-saved]').click();
  await expect.poll(() => page.evaluate(() => window.KPTURouter.current)).toBe('outside');
  // S68-24: News [보관] 탭은 없앴다 — 그 글이 든 탭(언론 기사 = [언론], 사회운동 글 = [사회운동])으로 연다.
  await expect(page.locator('#outsideRoot').getByRole('tab', { name: key.startsWith('news:') ? '언론' : '사회운동' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#outsideRoot')).toHaveAttribute('data-detail', 'open');
  expect(errors).toEqual([]);
});

test('1280: 노트 검색이 노트·밑줄·보관을 함께 찾는다(꼬리표, 노트 n · 밑줄 n · 보관 n) · [목록] 보기에는 News에서가 없다', async ({ page }) => {
  const { errors } = await fixture(page, 1280);
  await (await screenFind(page)).fill('철도');
  await expect(page.locator('[data-nnm-head]')).toContainText('노트 1 · 밑줄 1 · 저장한 글 1');
  await expect(page.locator('#noteRows [data-note-row="n1"]')).toBeVisible();
  const b = box(page);
  await expect(b.locator('.nh-row .nnm-tag')).toHaveText(['밑줄']);
  await expect(b.locator('.nnm-sv .nnm-tag')).toHaveText(['저장한 글']);
  if (SHOTS) await page.screenshot({ path: SHOTS + '1280-4-search.png' });
  // 노트에는 없고 밑줄에만 있는 말도 '맞는 노트 없음'으로 가리지 않는다.
  await (await screenFind(page)).fill('총인건비');
  await expect(page.locator('[data-nnm-head]')).toContainText('노트 0 · 밑줄 1 · 저장한 글 0');
  await expect(page.locator('[data-note-list-status]')).not.toContainText('맞는 노트 없음');
  await (await screenFind(page)).fill('');
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

// S62-17 NOTE-노트에서도밑줄: 노트 본문에서 글을 골라 [밑줄 저장] → 노트 › 밑줄에 노트 꼬리표로 함께, 누르면 그 노트 그 자리, 노트를 고쳐 글이 없어지면 작은 표시.
const NSHOTS = process.env.S62_SHOT || '';
const pickInNote = (page, t) => page.evaluate(t => {
  const z = document.querySelector('#basketView [data-basket-read-text]');
  const w = document.createTreeWalker(z, NodeFilter.SHOW_TEXT); let node; while ((node = w.nextNode()) && !node.data.includes(t));
  const i = node.data.indexOf(t), r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + t.length);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}, t);
for (const width of [412, 880, 1280]) {
  test(`${width}: 노트 본문에서 밑줄 저장 → 노트 › 밑줄(노트 꼬리표·원문이 바뀌었어요) → 누르면 그 노트 그 자리, News [밑줄] 탭에는 노트 밑줄 없음`, async ({ page }) => {
    test.setTimeout(90000);
    const { s, errors } = await fixture(page, width, { noteHl: true });
    // 노트 › 밑줄: 새 것이 위, 출처 꼬리표 노트·News, 노트를 고쳐 없어진 글은 '원문이 바뀌었어요'(밑줄은 그대로).
    await press(page, navRow(page, 'news-hl', width), width);
    const b = box(page);
    await expect(b.locator('.nh-row')).toHaveCount(4);
    await expect(b.locator('.nh-row .nh-src')).toHaveText(['노트', '노트', '읽을 거리', '읽을 거리']);
    await expect(b.locator(`[data-nh-row="${HL3}"] .nh-meta`)).toHaveText(/^노트10\/06/);
    await expect(b.locator(`[data-nh-row="${HL3}"] [data-nh-gone]`)).toHaveCount(0);
    await expect(b.locator(`[data-nh-row="${HL4}"] [data-nh-gone]`)).toHaveText('원문이 바뀌었어요');
    if (NSHOTS) await page.screenshot({ path: `${NSHOTS}/note-marks-list-${width}.png` });
    // 줄을 누르면 그 노트가 열리고 그 자리 밑줄이 칠해져 있다.
    await press(page, b.locator(`[data-nh-row="${HL3}"] [data-nh-open]`), width);
    const read = page.locator('#basketView [data-basket-read-text]');
    await expect(read).toBeVisible();
    await expect(read.locator(`mark.hl-mark[data-hl-id="${HL3}"]`)).toHaveText('메모 노트 본');
    expect(await page.evaluate(() => window.KPTURouter.current)).toBe('basket');
    // 노트 안 밑줄을 누르면 밑줄 메뉴(노트 안이라 [노트로]는 없음).
    await read.locator(`mark.hl-mark[data-hl-id="${HL3}"]`).click();
    await expect(page.locator('#hlMarkMenu button')).toHaveText(['메모 달기', '복사', '삭제']);
    await page.keyboard.press('Escape');
    // 본문에서 글을 골라 [밑줄 저장] → 서버에 note 종류·노트 id·제목, 노란 띠.
    await pickInNote(page, '가상');
    const bar = page.locator('div[data-hl-bar]');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.kptu-act:visible')).toHaveText(['밑줄 저장', '복사', ...(await page.evaluate(() => typeof navigator.share === 'function') ? ['공유'] : [])]);
    await bar.getByRole('button', { name: '밑줄 저장' }).click();
    await expect.poll(() => s.posts.length).toBe(1);
    expect(s.posts[0]).toMatchObject({ source_type: 'note', source_id: NOTE4, quote: '가상', source_title: '가상 메모 노트', source_media: '노트', source_url: null });
    await expect(read.locator('mark.hl-mark')).toHaveCount(2);
    if (NSHOTS) await page.screenshot({ path: `${NSHOTS}/note-body-mark-${width}.png` });
    // 바뀐 원문 밑줄을 누르면: 노트는 열리고 작은 알림(밑줄은 지우지 않음).
    await page.goBack(); // 뒤로가기 한 번 = 노트 목록(밑줄 칸)
    await expect(read).toBeHidden();
    // 폰은 뒤로가기 한 번에 밑줄 칸으로 돌아온다(그 칸이 없으면 왼쪽 줄에서 다시 연다).
    if (!(await box(page).locator(`[data-nh-row="${HL4}"]`).isVisible())) await press(page, navRow(page, 'news-hl', width), width);
    await press(page, box(page).locator(`[data-nh-row="${HL4}"] [data-nh-open]`), width);
    await expect(read).toBeVisible();
    await expect(page.locator('#kptuNotice .kptu-notice-text')).toContainText('원문이 바뀌었어요');
    expect(s.hl.some(h => h.id === HL4)).toBe(true);
    // News [밑줄] 탭에는 노트 밑줄이 없다(그 탭은 News 원문 밑줄만).
    await page.evaluate(() => window.KPTURouter.go('news'));
    await page.locator('#outsideRoot').getByRole('tab', { name: '밑줄' }).click();
    await expect(page.locator('[data-now-panel-marks] .nh-row')).toHaveCount(2);
    expect(s.deletes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// NOTE-News에서글자빼기 ③: 폴더도 노트도 없는 새 계정. 폴더가 없으면 첫 화면은 폴더 목록이 아니라 노트 목록 그대로라 '최근'·'폴더 없음' 줄은 없다
// (note-tree.mjs paneRows: 폴더가 하나도 없으면 바로 노트 · basket-notes.js showRecent: 폴더가 있을 때만 '최근' — 같은 노트를 두 번 보이지 않게, 의도).
// 폴드 펼침·PC 왼쪽 나무에는 '폴더 없음' 줄이 하나 있다(오른쪽 칸이 그 노트를 보임). '최근'은 폭과 상관없이 없다.
// 폰은 [밑줄]·[보관한 글] 두 줄 상자만, 폴드·PC는 '폴더 없음' 아래 글자 없는 얇은 줄 + 두 줄. 'News에서' 글자 없음.
for (const width of [412, 880, 1280]) {
  test(`${width}: 폴더 없는 새 계정 — '최근' 없음(폰은 '폴더 없음'·구분 줄도 없음) + 밑줄·보관한 글 두 줄, 'News에서' 글자 없음`, async ({ page }) => {
    await fixture(page, width, { fresh: true });
    const list = width < 600 ? page.locator('#noteRows') : page.locator('[data-nx-tree]');
    // 폰: 두 줄은 따로 선 상자라 구분 줄 없음(상자 맨 위 줄 두 겹 없음). 폴드·PC 나무: '폴더 없음' 아래 글자 없는 얇은 줄.
    await expect(list.locator('.nnm-sep')).toHaveCount(width < 600 ? 0 : 1);
    if (width >= 600) await expect(list.locator('.nnm-sep')).toHaveText('');
    await expect(list.locator('[data-nx-news-item]')).toHaveCount(2);
    await expect(page.locator('#basketView')).not.toContainText('News에서');
    // 폰(한 화면씩): 폴더가 없으면 노트 목록 그대로라 '폴더 없음' 줄 없음. 폴드 펼침·PC 나무: '폴더 없음' 줄 하나(오른쪽 칸에 그 노트).
    await expect(list.locator('.nx-outside')).toHaveCount(width < 600 ? 0 : 1);
    await expect(page.locator('#basketView [data-nx-recent]:visible')).toHaveCount(0);
    if (SHOTS24) await page.screenshot({ path: SHOTS24 + `note-folder-list-new-account-${width}.png` });
  });
}
