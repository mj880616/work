// S69-04 MARK-밑줄한목록(사용자 11/24 "앞서 저장해서 노트 밑줄에 있는 것들 지금 저장된 글 밑줄에 없음 두개 동기화 해줘요"):
// 저장한 글 [밑줄] 탭과 노트 › 밑줄은 같은 원본(app_news_highlights, text-highlights.js 목록)을 같은 규칙(visibleMarks)으로 읽는다 —
// 저장한 글에 든 글이든 아니든(지운 글·News·사회운동 글·노트) 내가 그은 밑줄 전부가 두 곳에 같은 순서·같은 개수로 보이고,
// 한쪽에서 지우면 다른 쪽에서도 사라진다. 글은 모두 가상, 서버는 흉내(owner RLS REST).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const A = 'a6900000-0000-4000-8000-000000000001', GONE = 'a6900000-0000-4000-8000-000000000009';
const N1 = 'a6900000-0000-4000-8000-0000000000a1', P1 = 'a6900000-0000-4000-8000-0000000000b1', NT = 'a6900000-0000-4000-8000-0000000000c1';
const H = n => `b6900000-0000-4000-8000-00000000000${n}`;
const BODY = '첫 문단은 배경이에요.\n\n둘째 문단: 가상 인력 충원 이야기를 짚어 봐요.';

function marks() {
  const m = (n, type, id, quote, title, media, at) => ({ id: H(n), source_type: type, source_id: id, quote, quote_prefix: '', quote_suffix: '', memo: null, source_title: title, source_media: media,
    source_date: at, source_url: type === 'note' ? null : 'https://example.org/' + n, created_at: at, updated_at: at });
  return [
    m(1, 'reading', A, '가상 인력 충원', '가상 저장 글', 'example.com', '2026-11-23T05:00:00Z'),
    m(2, 'reading', GONE, '저장한 글에서 지운 글의 밑줄', '지운 가상 글', 'example.net', '2026-11-23T04:00:00Z'),
    m(3, 'news', N1, '가상 뉴스 문장', '가상 기사', '가상일보', '2026-11-23T03:00:00Z'),
    m(4, 'outside', P1, '가상 성명 문장', '가상 성명', '가상 단체', '2026-11-23T02:00:00Z'),
    m(5, 'note', NT, '가상 노트 본', '가상 노트', '노트', '2026-11-23T01:00:00Z'),
  ];
}

async function server(page) {
  const s = { hl: marks(), deletes: [] };
  const rows = [{ id: A, url: 'https://example.com/a', title: '가상 저장 글', site: 'example.com', saved_at: '2026-11-22T01:00:00Z', read_at: '2026-11-22T02:00:00Z', body_state: 'ok', body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T02:00:00Z', body: BODY }];
  const note = { id: NT, workspace_id: 'w', kind: 'note', title: '가상 노트', raw_text: '가상 노트 본문', occurred_at: '2026-11-20T00:00:00Z', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method(), q = u.searchParams;
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    const id = (q.get('id') || '').replace(/^eq\./, '');
    if (table === 'app_news_highlights') {
      if (method === 'DELETE') { s.deletes.push(id); s.hl = s.hl.filter(x => x.id !== id); return route.fulfill({ status: 204 }); }
      return ok(s.hl);
    }
    if (table === 'app_reading_items') {
      if (method !== 'GET') return ok([]);
      if (q.get('news_article_id') || q.get('outside_article_id')) return ok([]);
      const pick = r => { const { body, ...rest } = r; return (q.get('select') || '').includes('body') ? { ...rest, body } : rest; };
      return ok((id ? rows.filter(r => r.id === id) : rows).map(pick));
    }
    if (table === 'app_notes' && method === 'GET') return ok([note].filter(x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!id || x.id === id)));
    if (table === 'app_note_folders' || table === 'app_note_comments' || table === 'app_record_links') return ok([]);
    if (table.startsWith('app_news_') || table.startsWith('app_outside_') || table.startsWith('app_now_')) return method === 'GET' ? ok([]) : ok([], 201);
    return route.fallback();
  });
  return s;
}

const readingList = page => page.locator('#readingView [data-rd-list]');
const readingRows = page => page.locator('#readingView [data-rd-marks] .nh-row');
const noteRows = page => page.locator('#basketView [data-nnm] .nh-row');
const quotes = loc => loc.locator('.nh-q').allTextContents();

async function readingMarks(page) {
  await page.evaluate(() => window.KPTURouter.go('reading'));
  await expect(page.locator('#readingView')).toBeVisible();
  const tab = readingList(page).locator('.rd-switch [data-filter-value="marks"]');
  await expect(tab).toHaveText(/^밑줄 \d+$/);
  await tab.click();
  return tab;
}
// 노트 › 밑줄 줄의 숫자를 보고(폰은 누르면 그 줄만 상자로 바뀌므로 누르기 전에) 연다.
async function noteMarks(page, width, n) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const nav = page.locator(`${width < 600 ? '#noteRows' : '[data-nx-tree]'} [data-nx-news-item="news-hl"]`);
  // 폰은 노트 화면이 마지막 자리(밑줄 상자)를 기억한다 — 그때는 상자 머리 숫자를 본다.
  const focus = page.locator('#basketView [data-nnm-focus="news-hl"]');
  await expect(nav.or(focus).first()).toBeVisible();
  if (await focus.isVisible()) { await expect(focus.locator('.ft-focus-head')).toContainText(String(n)); return; }
  await expect(nav).toContainText(String(n));
  await nav.locator('.ft-main').click();
}
async function deleteFirst(page, rows) {
  await rows.first().locator('[data-nh-more]').click();
  await page.locator('#hlMarkMenu [data-hl-menu="delete"]').click();
  await page.locator('.kptu-ask .kptu-ask-actions button').nth(1).click();
}

for (const [label, width] of [['phone-412', 412], ['pc-1280', 1280]]) {
  test(`저장한 글 [밑줄]과 노트 › 밑줄은 같은 목록·같은 개수, 한쪽에서 지우면 다른 쪽에서도 사라진다 (${label})`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page);
    const s = await server(page);
    const all = marks().map(h => h.quote);

    // 저장한 글 [밑줄]: 저장한 글에 든 글의 밑줄만이 아니라 내가 그은 밑줄 전부(지운 글·News·사회운동 글·노트) 5개.
    let tab = await readingMarks(page);
    await expect(tab).toHaveText('밑줄 5');
    await expect(readingRows(page)).toHaveCount(5);
    expect(await quotes(readingRows(page))).toEqual(all);
    await expect(readingRows(page).first().locator('.nh-src')).toHaveText('저장한 글');

    // 노트 › 밑줄: 같은 5개, 같은 순서.
    await noteMarks(page, width, 5);
    await expect(noteRows(page)).toHaveCount(5);
    expect(await quotes(noteRows(page))).toEqual(all);

    // 노트에서 지우면 저장한 글 [밑줄]에서도 사라진다.
    await deleteFirst(page, noteRows(page));
    await expect(noteRows(page)).toHaveCount(4);
    expect(s.deletes).toEqual([H(1)]);
    tab = await readingMarks(page);
    await expect(tab).toHaveText('밑줄 4');
    await expect(readingRows(page)).toHaveCount(4);
    expect(await quotes(readingRows(page))).toEqual(all.slice(1));

    // 저장한 글 [밑줄]에서 지우면 노트 › 밑줄에서도 사라진다.
    await deleteFirst(page, readingRows(page));
    await expect(readingRows(page)).toHaveCount(3);
    await expect(tab).toHaveText('밑줄 3');
    expect(s.deletes).toEqual([H(1), H(2)]);
    await noteMarks(page, width, 3);
    await expect(noteRows(page)).toHaveCount(3);
    expect(await quotes(noteRows(page))).toEqual(all.slice(2));
    expect(errors).toEqual([]);
  });
}

test('저장한 글 [밑줄] 줄을 누르면 그 글 그 자리(저장한 글 보기)로', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await server(page);
  await readingMarks(page);
  await readingRows(page).first().locator('[data-nh-open]').click();
  const detail = page.locator('#readingView [data-rd-detail]');
  await expect(detail.locator('.rd-title')).toHaveText('가상 저장 글');
  await expect(detail.locator('[data-rd-prose] mark.hl-mark')).toHaveText('가상 인력 충원');
  expect(errors).toEqual([]);
});
