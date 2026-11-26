import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S67-05 NEWS-직접넣기 사진(사용자 11/19 "잘 되는데 사진은 안되나?"): 직접 넣기 본문 칸에 사진 주소 한 줄 → 저장 → 그 자리에 사진(+ 바로 다음 '사진:' 줄은 설명).
// javascript:·http:·data: 주소는 사진이 안 되고 글로 남는다. ⋯ [수정]으로 다시 열면 사진은 주소 줄(+설명 줄)로 들어와 왕복해도 같다.
// 읽어 온 기사(사진 있음)를 [수정]해 본문을 바꿔 저장해도 사진이 남는다. [사진 주소 넣기]는 커서 자리에 한 줄로.
// 서버는 흉내(사진 줄 판정은 서버 규칙과 같은 모양만 — 실제 판정 시험은 tests/security/news-feed-hand-fill.test.mjs), 그림은 가짜 응답, 주소는 모두 example.org.
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null }, stale: false };
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
// S70-17b NEWS-제목꼭얻기: 제목 없는 기사는 보관한 글(공유로 넣은 글 = 바로 보관)일 때만 목록에 남는다 — [직접 넣기]는 그 글에서.
const FAILED = { id: 'x1', lane: 'channel', url: 'https://www.example.org/x1', title: null, lang: 'ko', publisher: null, source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-06T00:40:00Z', created_at: '2026-10-06T00:41:00Z', state: 'failed', summary: null, body_kind: null, title_ko: null, translated_at: null, starred_at: '2026-10-06T00:41:30Z', folder_id: null, _body: null, author: null, manual_at: null };
const PIC = 'https://img.example.org/2026/11/fake-a.jpg';
const PIC2 = 'https://cdn.example.org/view?id=7';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#8a9a8f"/><circle cx="200" cy="120" r="60" fill="#d8dcd5"/></svg>';

// 흉내 서버: 한 줄 전체가 https 주소 + 그림 파일 끝(또는 '#사진')이면 사진, 바로 다음 '사진:'·'ⓒ'·'▲' 줄은 설명('사진:'은 뗌).
function fakeBlocks(body) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n'), out = [];
  const photo = l => { const s = l.trim(); if (!/^https:\/\/\S+$/.test(s)) return null; const m = s.endsWith('#사진'); const u = new URL(m ? s.slice(0, -3) : s); return m || /\.(jpe?g|png|webp|gif)$/i.test(u.pathname) ? u.href : null; };
  for (let i = 0; i < lines.length; i++) {
    const src = photo(lines[i]);
    if (src) {
      let cap = null, j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && /^(사진\s*[:：]|ⓒ|▲)/.test(lines[j].trim())) { cap = lines[j].trim().replace(/^사진\s*[:：]\s*/, ''); i = j; }
      out.push({ t: 'img', src, cap, alt: null });
    } else if (lines[i].trim()) out.push({ t: 'p', text: lines[i].replace(/\s+/g, ' ').trim() });
  }
  return out;
}

async function setup(page, width) {
  const { errors, server } = await start(page, width);
  server.items.unshift({ ...FAILED });
  const bodies = {
    x1: { state: 'failed', reason: 'timeout', blocks: [] },
    c1: { state: 'ok', reason: null, blocks: [{ t: 'p', text: '가짜 채널 본문 첫 문단.' }, { t: 'img', src: 'https://img.example.org/c1.png', cap: '가짜 현장 사진', alt: null }, { t: 'p', text: '가짜 채널 본문 둘째 문단.' }] },
  };
  const seen = { fills: [], pics: [] };
  await page.route('https://img.example.org/**', route => { seen.pics.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }); });
  await page.route('https://cdn.example.org/**', route => { seen.pics.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }); });
  await page.route('**/rest/v1/app_news_article_bodies*', route => {
    const id = (new URL(route.request().url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[id] ? [bodies[id]] : []) });
  });
  await page.route('**/functions/v1/news-feed?action=open', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'failed' }) }));
  await page.route('**/functions/v1/news-feed?action=hand_fill', route => {
    const b = route.request().postDataJSON();
    seen.fills.push(b);
    const it = server.items.find(i => i.id === b.id);
    Object.assign(it, { title: b.title, publisher: b.publisher, author: b.author, published_at: b.published_at, manual_at: '2026-10-06T01:00:00Z' });
    if (typeof b.body === 'string') {
      const blocks = fakeBlocks(b.body);
      Object.assign(it, { state: 'ok', body_kind: 'full', _body: blocks.filter(x => x.t === 'p').map(x => x.text).join('\n'), summary: null });
      bodies[b.id] = { state: 'ok', reason: null, blocks };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'filled', id: b.id }) });
  });
  await page.route('**/functions/v1/ai-assist', route => {
    const b = route.request().postDataJSON();
    if (b?.kind !== 'now_detail') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOW_DETAIL) });
  });
  await openNews(page, width);
  return { errors, server, seen, bodies };
}
const openMenuEdit = async (page, nd) => { await nd.locator('[data-nd-ob-more]').click(); await page.locator('#ndObMenu [data-nd-menu="hand"]').click(); };
// 작은 글 입력창(app/small-notice.js askText)에 주소를 붙여 넣고 [넣기].
const askPhoto = async (page, form, url) => { await form.locator('[data-nd-hand-photo]').click(); const f = page.locator('.kptu-ask .kptu-ask-field'); await expect(f).toBeVisible(); await f.fill(url); await page.locator('.kptu-ask button.primary').click(); await expect(page.locator('.kptu-ask')).toHaveCount(0); };
const loaded = img => img.evaluate(el => el.complete && el.naturalWidth > 0);

for (const width of [412, 884, 1280]) {
  test(`직접 넣기 사진 ${width}: 주소 줄 → 그 자리에 사진·설명, 위험한 주소는 글, [수정] 왕복 유지`, async ({ page }, info) => {
    test.setTimeout(90000);
    const { errors, seen } = await setup(page, width);
    await row(page, 'x1').locator('[data-nc-open="x1"]').click();
    const nd = detail(page);
    await nd.locator('[data-nd-hand]').click();
    const form = nd.locator('[data-nd-hand-form]');
    const area = form.locator('[data-nd-hand-in="body"]');
    await expect(form.locator('[data-nd-hand-photo]')).toHaveText('사진 주소 넣기');
    await expect(form.locator('[data-nd-hand-photo]')).toHaveAttribute('title', /사진:/);
    await expect(form.getByText('본문을 바꾸면 사진은 빠져요')).toHaveCount(0);
    await form.locator('[data-nd-hand-in="title"]').fill('가짜 사진 기사');
    await area.fill(['가짜 첫 문단.', PIC, '사진: 가짜 현장 모습', '가짜 둘째 문단.', 'javascript:alert(1)//a.jpg', 'http://img.example.org/plain.jpg', 'data:image/png;base64,AAAA', '가짜 셋째 문단.'].join('\n'));
    // [사진 주소 넣기]: 작은 입력창에 붙여 넣은 주소 → 커서 자리(맨 끝)에 한 줄로. 그림 파일 끝이 아닌 주소는 열어 보고 '#사진'.
    await area.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
    await askPhoto(page, form, PIC2);
    await expect(area).toHaveValue(/\nhttps:\/\/cdn\.example\.org\/view\?id=7#사진\n$/);
    await area.evaluate(el => { el.value += 'ⓒ 가짜 매체'; });
    if (width === 412) await page.screenshot({ path: info.outputPath('photo-form-412.png') });
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect(seen.fills).toHaveLength(1);
    expect(seen.fills[0].body).toContain(`${PIC}\n사진: 가짜 현장 모습`);
    // 그 자리에 사진(가짜 그림 응답) + 설명, 위험한 주소는 글자 문단으로만.
    const figs = nd.locator('[data-nd-prose] figure.nd-fig');
    await expect(figs).toHaveCount(2);
    await expect(figs.nth(0).locator('img')).toHaveAttribute('src', PIC);
    await expect(figs.nth(0).locator('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(figs.nth(0).locator('figcaption')).toHaveText('가짜 현장 모습');
    await expect(figs.nth(1).locator('img')).toHaveAttribute('src', PIC2);
    await expect(figs.nth(1).locator('figcaption')).toHaveText('ⓒ 가짜 매체');
    await expect.poll(() => loaded(figs.nth(0).locator('img'))).toBe(true);
    const prose = nd.locator('[data-nd-prose] > *');
    await expect(prose).toHaveCount(8);
    expect(await prose.evaluateAll(els => els.map(e => e.tagName))).toEqual(['P', 'FIGURE', 'P', 'P', 'P', 'P', 'P', 'FIGURE']);
    await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 첫 문단.', '가짜 둘째 문단.', 'javascript:alert(1)//a.jpg', 'http://img.example.org/plain.jpg', 'data:image/png;base64,AAAA', '가짜 셋째 문단.']);
    expect(await nd.locator('[data-nd-prose] a[href^="javascript"], [data-nd-prose] img[src^="http:"], [data-nd-prose] img[src^="data:"]').count()).toBe(0);
    expect(seen.pics.every(u => u.startsWith('https://'))).toBe(true);
    await page.screenshot({ path: info.outputPath(`photo-saved-${width}.png`) });
    // ⋯ [수정]: 사진은 주소 줄 + '사진:' 설명 줄로 되돌아온다. 그대로 저장하면 본문은 보내지 않는다.
    await openMenuEdit(page, nd);
    await expect(area).toHaveValue(['가짜 첫 문단.', PIC, '사진: 가짜 현장 모습', '가짜 둘째 문단.', 'javascript:alert(1)//a.jpg', 'http://img.example.org/plain.jpg', 'data:image/png;base64,AAAA', '가짜 셋째 문단.', `${PIC2}#사진`, 'ⓒ 가짜 매체'].join('\n'));
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect('body' in seen.fills[1]).toBe(false);
    // 글자만 바꿔 저장 → 사진 줄이 함께 가서 사진이 그대로.
    await openMenuEdit(page, nd);
    await area.fill((await area.inputValue()).replace('가짜 셋째 문단.', '가짜 셋째 문단 바꿈.'));
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    await expect(figs).toHaveCount(2);
    await expect(figs.nth(0).locator('figcaption')).toHaveText('가짜 현장 모습');
    await expect(nd.locator('[data-nd-prose] p').last()).toHaveText('가짜 셋째 문단 바꿈.');
    // 다시 열어도 같은 글자(왕복해도 같음).
    await openMenuEdit(page, nd);
    expect(await area.inputValue()).toContain(`${PIC}\n사진: 가짜 현장 모습`);
    expect(await area.inputValue()).toContain(`${PIC2}#사진\nⓒ 가짜 매체`);
    expect(errors).toEqual([]);
  });
}

test('읽어 온 기사 ⋯ [수정] 1280: 사진은 주소 줄로 들어오고, 본문을 바꿔 저장해도 사진이 남는다', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, seen } = await setup(page, 1280);
  await row(page, 'c1').locator('[data-nc-open="c1"]').click();
  const nd = detail(page);
  await expect(nd.locator('[data-nd-prose] figure.nd-fig')).toHaveCount(1);
  await openMenuEdit(page, nd);
  const form = nd.locator('[data-nd-hand-form]');
  const area = form.locator('[data-nd-hand-in="body"]');
  await expect(area).toHaveValue('가짜 채널 본문 첫 문단.\nhttps://img.example.org/c1.png\n사진: 가짜 현장 사진\n가짜 채널 본문 둘째 문단.');
  // 중간 커서 자리에 [사진 주소 넣기] → 그 줄 앞뒤로 줄을 바꿔 한 줄 전체가 된다.
  await area.evaluate(el => { const i = el.value.indexOf('둘째'); el.focus(); el.setSelectionRange(i, i); });
  await askPhoto(page, form, 'https://img.example.org/new.webp');
  await expect(area).toHaveValue('가짜 채널 본문 첫 문단.\nhttps://img.example.org/c1.png\n사진: 가짜 현장 사진\n가짜 채널 본문 \nhttps://img.example.org/new.webp\n둘째 문단.');
  // 쓸 수 없는 주소는 넣지 않고 까닭 한 줄(넣던 글자는 그대로).
  await askPhoto(page, form, 'javascript:alert(1)');
  await expect(form.locator('[data-nd-hand-note]')).toHaveText('https 사진 주소만 넣을 수 있어요');
  await expect(area).toHaveValue(/new\.webp/);
  await form.locator('button[type="submit"]').click();
  await expect(form).toHaveCount(0);
  expect(seen.fills[0].body).toContain('https://img.example.org/c1.png\n사진: 가짜 현장 사진');
  const figs = nd.locator('[data-nd-prose] figure.nd-fig');
  await expect(figs).toHaveCount(2);
  await expect(figs.nth(0).locator('img')).toHaveAttribute('src', 'https://img.example.org/c1.png');
  await expect(figs.nth(0).locator('figcaption')).toHaveText('가짜 현장 사진');
  await expect(figs.nth(1).locator('img')).toHaveAttribute('src', 'https://img.example.org/new.webp');
  expect(errors).toEqual([]);
});

test('사진 21장은 보내지 않음 412', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, seen } = await setup(page, 412);
  await row(page, 'x1').locator('[data-nc-open="x1"]').click();
  const nd = detail(page);
  await nd.locator('[data-nd-hand]').click();
  const form = nd.locator('[data-nd-hand-form]');
  await form.locator('[data-nd-hand-in="title"]').fill('가짜 제목');
  await form.locator('[data-nd-hand-in="body"]').fill(Array.from({ length: 21 }, (_, i) => `가짜 문단 ${i}\nhttps://img.example.org/${i}.jpg`).join('\n'));
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-nd-hand-note]')).toHaveText('사진은 20장까지');
  expect(seen.fills).toHaveLength(0);
  expect(errors).toEqual([]);
});
