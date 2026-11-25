import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S68-44(명진 11/23 11:07 "본문에 글자를 강요함 / 본문 글자 없이도 저장되게 못함?"): 손으로 넣기·고치기에서 본문 글자가 없어도 저장된다.
// ① 못 읽은 기사에 제목만 → 저장(본문은 보내지 않음), 요약은 '만드는 중'에 머물지 않고 '원문을 가져오면 요약해요'(S68-43 문구).
// ② 읽은 기사 ⋯ [수정]에서 본문을 비워 저장 → 원문 칸은 빈 칸 대신 작은 '본문 없음 · 원래 사이트 ↗', 요약도 '본문 없음'.
// ③ 사진만 넣어 저장 → 사진이 보이고 '본문 없음'. ④ 제목·원문 주소·본문을 모두 비우면 보내지 않음(한 줄 까닭).
// 서버는 흉내(서버 규칙과 같게: 빈 제목 = 그대로, 빈 본문 = 블록 failed·no_body, 사진만 = image_only, 둘 다 손 규칙 manual@1). 모두 가짜(example.org).
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#888"/></svg>';
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
// S70-17b NEWS-제목꼭얻기: 제목 없는 기사는 보관한 글(공유로 넣은 글 = 바로 보관)일 때만 목록에 남는다 — [직접 넣기]는 그 글에서.
const FAILED = { id: 'x1', lane: 'channel', url: 'https://www.example.org/x1', title: null, lang: 'ko', publisher: null, source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-06T00:40:00Z', created_at: '2026-10-06T00:41:00Z', state: 'failed', summary: null, body_kind: null, title_ko: null, translated_at: null, starred_at: '2026-10-06T00:41:30Z', folder_id: null, _body: null, author: null, manual_at: null };
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null }, stale: false };
const photoOf = l => { const s = l.trim(); return /^https:\/\/\S+\.(jpe?g|png|webp|gif)$/i.test(s) ? s : null; };

async function setup(page, width) {
  const { errors, server } = await start(page, width);
  server.items.unshift({ ...FAILED });
  const c1 = server.items.find(i => i.id === 'c1');
  Object.assign(c1, { body_kind: 'full', _body: '가짜 채널 본문 첫 문단.\n가짜 채널 본문 둘째 문단.' });
  const bodies = { x1: { state: 'failed', reason: 'timeout', rule: 'open@3', blocks: [] }, c1: { state: 'ok', reason: null, rule: 'open@3', blocks: [{ t: 'p', text: '가짜 채널 본문 첫 문단.' }, { t: 'p', text: '가짜 채널 본문 둘째 문단.' }] } };
  const seen = { fills: [], ai: [] };
  await page.route('https://img.example.org/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
  await page.route('**/rest/v1/app_news_article_bodies*', route => {
    const id = (new URL(route.request().url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[id] ? [bodies[id]] : []) });
  });
  await page.route('**/functions/v1/news-feed?action=open', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'failed' }) }));
  await page.route('**/functions/v1/news-feed?action=hand_fill', route => {
    const b = route.request().postDataJSON();
    seen.fills.push(b);
    const hasBody = typeof b.body === 'string';
    if (!String(b.title || '').trim() && !b.url && !(hasBody && b.body.trim())) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'EMPTY_ARTICLE' }) });
    const it = server.items.find(i => i.id === b.id);
    Object.assign(it, { publisher: b.publisher, author: b.author, published_at: b.published_at, manual_at: '2026-10-06T01:00:00Z' });
    if (String(b.title || '').trim()) it.title = b.title.trim();
    if (hasBody) {
      const lines = b.body.split('\n').map(s => s.trim()).filter(Boolean);
      const blocks = lines.map(l => (photoOf(l) ? { t: 'img', src: photoOf(l), cap: null, alt: null } : { t: 'p', text: l }));
      const texts = blocks.filter(x => x.t === 'p');
      Object.assign(it, { state: 'ok', body_kind: texts.length ? 'full' : null, _body: texts.length ? texts.map(x => x.text).join('\n') : null, summary: null });
      bodies[b.id] = texts.length ? { state: 'ok', reason: null, rule: 'manual@1', blocks }
        : blocks.length ? { state: 'image_only', reason: null, rule: 'manual@1', blocks }
        : { state: 'failed', reason: 'no_body', rule: 'manual@1', blocks: [] };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'filled', id: b.id }) });
  });
  await page.route('**/functions/v1/ai-assist', route => {
    const b = route.request().postDataJSON();
    if (b?.kind !== 'now_detail') return route.fallback();
    seen.ai.push(b.news_item_id);
    const it = server.items.find(i => i.id === b.news_item_id);
    if (!it?.body_kind && !it?.summary) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'no_material' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOW_DETAIL) });
  });
  await openNews(page, width);
  return { errors, server, seen };
}

for (const width of [412, 1280]) {
  test(`본문 없이 저장 ${width}: 제목만 · 본문 비우기 · 사진만 — 목록·상세 정상, 요약은 '만드는 중'에 머물지 않음`, async ({ page }, info) => {
    test.setTimeout(90000);
    const { errors, server, seen } = await setup(page, width);
    const nd = detail(page);
    // ① 못 읽은 기사: 제목만 넣고 저장 → 본문은 보내지 않는다.
    await row(page, 'x1').locator('[data-nc-open="x1"]').click();
    await nd.locator('[data-nd-hand]').click();
    const form = nd.locator('[data-nd-hand-form]');
    await form.locator('[data-nd-hand-in="title"]').fill('가짜 제목만 넣은 기사');
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect(seen.fills).toHaveLength(1);
    expect('body' in seen.fills[0]).toBe(false);
    await expect(nd.locator('.nd-title')).toHaveText('가짜 제목만 넣은 기사');
    await expect(nd.locator('[data-nd-unread]')).toContainText('원문을 가져오면 요약해요');
    await expect(nd.locator('[data-nd-wait]')).toHaveCount(0);
    // ③ 같은 기사에 사진만 넣고 저장 → 사진 블록 + '본문 없음', 요약도 '본문 없음'.
    await nd.locator('[data-nd-hand]').click();
    await form.locator('[data-nd-hand-in="body"]').fill('https://img.example.org/only.png');
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect(seen.fills[1].body).toBe('https://img.example.org/only.png');
    await expect(nd.locator('[data-nd-prose] img')).toHaveCount(1);
    await expect(nd.locator('[data-nd-no-text]')).toContainText('본문 없음');
    await expect(nd.locator('[data-nd-unread]')).toContainText('본문 없음');
    await expect(nd.locator('[data-nd-wait]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`hand-photo-only-${width}.png`) });
    if (width <= 760) await page.goBack();
    await expect(row(page, 'x1').locator('.nw-title')).toHaveText('가짜 제목만 넣은 기사');

    // ② 읽은 기사 ⋯ [수정]: 본문을 비우고 저장 → 원문 칸 '본문 없음 · 원래 사이트 ↗'(빈 칸 아님).
    await row(page, 'c1').locator('[data-nc-open="c1"]').click();
    await expect(nd.locator('[data-nd-prose] p')).toHaveCount(2);
    await nd.locator('[data-nd-ob-more]').click();
    await page.locator('#ndObMenu [data-nd-menu="hand"]').click();
    await expect(form.locator('[data-nd-hand-in="body"]')).toHaveValue('가짜 채널 본문 첫 문단.\n가짜 채널 본문 둘째 문단.');
    await form.locator('[data-nd-hand-in="body"]').fill('');
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect(seen.fills[2].body).toBe('');
    await expect(nd.locator('[data-nd-prose]')).toHaveCount(0);
    await expect(nd.locator('[data-nd-no-text]')).toContainText('본문 없음');
    await expect(nd.locator('.nd-no-text a')).toHaveAttribute('href', 'https://example.org/c1');
    await expect(nd.locator('[data-nd-unread]')).toContainText('본문 없음');
    await expect(nd.locator('[data-nd-wait]')).toHaveCount(0);
    await expect(nd.locator('.nd-title')).toHaveText('가짜 채널 기사');
    await page.screenshot({ path: info.outputPath(`hand-no-body-${width}.png`) });
    expect(server.items.find(i => i.id === 'c1').body_kind).toBe(null);
    if (width <= 760) await page.goBack();
    await expect(row(page, 'c1').locator('.nw-title')).toHaveText('가짜 채널 기사');
    expect(errors).toEqual([]);
  });
}

test('빈 기사는 보내지 않음 412: 제목·원문 주소·본문을 모두 비우면 한 줄 까닭, 칸은 그대로', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, seen } = await setup(page, 412);
  await row(page, 'x1').locator('[data-nc-open="x1"]').click();
  const nd = detail(page);
  await nd.locator('[data-nd-hand]').click();
  const form = nd.locator('[data-nd-hand-form]');
  await form.locator('[data-nd-hand-in="url"]').fill('');
  await form.locator('[data-nd-hand-in="author"]').fill('가짜 기자');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-nd-hand-note]')).toHaveText('제목·원문 주소·본문(글이나 사진) 중 하나는 넣어 주세요');
  await expect(form.locator('[data-nd-hand-in="author"]')).toHaveValue('가짜 기자');
  expect(seen.fills).toHaveLength(0);
  expect(errors).toEqual([]);
});
