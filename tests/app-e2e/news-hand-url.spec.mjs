import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S68-39 NEWS-직접넣기원문주소(사용자 11/23 "저장한 글 수동으로 작성할 때 정작 링크 넣을 데가 없다"):
// ① 직접 넣기 칸에 '원문 주소'(지금 주소가 미리 채워짐) → 바꿔 저장하면 서버 hand_fill에 url이 가고, 글 상세 [원래 사이트 ↗]가 그 주소로 연다.
// ② 옛 직접 넣기(본문 첫 줄에 주소만 붙여 넣은 내 기사) → 작은 줄 '본문 첫 줄 주소를 원문 주소로 옮길까요? [옮기기]' → 같은 hand_fill로 옮김.
// ③ 본문 안 긴 주소는 작은 줄바꿈 링크(폰 390 가로 넘침 없음). 서버는 흉내, 주소·기사는 모두 가짜(example.org).
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
const LONG = 'https://www.example.org/portal/bbs/P0000559/view.do?nttId=10093517&searchCnd=1&searchKwd=&depth2=200038&depth3=200091&date=&sdate=&edate=&sort=1&pageUnit=10&depth=200091&pageIndex=1&programType=newsData&menuNo=200690&oldMenuNo=200091';
// S70-17b NEWS-제목꼭얻기: 제목 없는 기사는 보관한 글(공유로 넣은 글 = 바로 보관)일 때만 목록에 남는다 — [직접 넣기]는 그 글에서.
const FAILED = { id: 'x1', lane: 'channel', url: 'https://www.example.org/x1', title: null, lang: 'ko', publisher: null, source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-06T00:40:00Z', created_at: '2026-10-06T00:41:00Z', state: 'failed', summary: null, body_kind: null, title_ko: null, translated_at: null, starred_at: '2026-10-06T00:41:30Z', folder_id: null, _body: null, author: null, manual_at: null };
const MANUAL = { ...FAILED, id: 'm1', url: 'https://www.example.org/share-m1', title: '가짜 손으로 넣은 기사', publisher: '가짜은행', origin: 'user', state: 'ok', body_kind: 'full', _body: `${LONG}\n가짜 본문 첫 문단.`, manual_at: '2026-10-06T00:50:00Z' };

// prep(server): 목록을 읽기 전에 가짜 서버 줄을 고친다. 목록이 읽힌 뒤에 고치면 화면은 이미 읽은 옛 줄(직접 넣음·내 기사)로
// 상세 머리를 만들어, 고친 값이 반영될지가 목록 읽기와의 경주가 된다(S69-74 — CI·로컬에서 간헐 실패).
async function setup(page, width, prep = null) {
  const { errors, server } = await start(page, width);
  server.items.unshift({ ...FAILED }, { ...MANUAL });
  prep?.(server);
  const bodies = {
    x1: { state: 'failed', reason: 'timeout', blocks: [] },
    m1: { state: 'ok', reason: null, rule: 'manual@1', blocks: [{ t: 'p', text: LONG }, { t: 'p', text: `가짜 본문 첫 문단. 참고 ${LONG} 끝.` }] },
  };
  const seen = { fills: [] };
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
    if (typeof b.url === 'string') it.url = b.url.trim().replace(/^http:/, 'https:');
    if (typeof b.body === 'string') {
      const paras = b.body.split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
      Object.assign(it, { state: 'ok', body_kind: 'full', _body: paras.join('\n'), summary: null });
      bodies[b.id] = { state: 'ok', reason: null, blocks: paras.map(text => ({ t: 'p', text })) };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'filled', id: b.id }) });
  });
  await page.route('**/functions/v1/ai-assist', route => {
    const b = route.request().postDataJSON();
    if (b?.kind !== 'now_detail') return route.fallback();
    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'no_material' }) });
  });
  await openNews(page, width);
  return { errors, server, seen };
}

for (const width of [412, 1280]) {
  test(`원문 주소 ${width}: 직접 넣기 칸에 지금 주소 → 바꿔 저장 → [원래 사이트 ↗]가 새 주소`, async ({ page }, info) => {
    test.setTimeout(90000);
    const { errors, server, seen } = await setup(page, width);
    await row(page, 'x1').locator('[data-nc-open="x1"]').click();
    const nd = detail(page);
    await nd.locator('[data-nd-hand]').click();
    const form = nd.locator('[data-nd-hand-form]');
    const url = form.locator('[data-nd-hand-in="url"]');
    await expect(url).toHaveValue('https://www.example.org/x1');
    await expect(url).toHaveAttribute('inputmode', 'url');
    await form.locator('[data-nd-hand-in="title"]').fill('가짜 제목');
    await form.locator('[data-nd-hand-in="body"]').fill('가짜 본문.');
    // 틀린 모양은 보내지 않고 한 줄.
    await url.fill('javascript:alert(1)');
    await form.locator('button[type="submit"]').click();
    await expect(form.locator('[data-nd-hand-note]')).toHaveText('원문 주소는 http·https 주소로 넣어 주세요');
    expect(seen.fills).toHaveLength(0);
    await url.fill('https://www.example.org/real-article-1');
    if (width === 412) await page.screenshot({ path: info.outputPath('hand-url-form-412.png') });
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect(seen.fills).toHaveLength(1);
    expect(seen.fills[0]).toMatchObject({ id: 'x1', title: '가짜 제목', url: 'https://www.example.org/real-article-1', body: '가짜 본문.' });
    await expect(nd.locator('.nd-top a[data-nd-link]')).toHaveAttribute('href', 'https://www.example.org/real-article-1');
    expect(server.items.find(i => i.id === 'x1').url).toBe('https://www.example.org/real-article-1');
    // 다시 [수정]을 열면 새 주소가 칸에 있고, 그대로 저장하면 url은 보내지 않는다.
    await nd.locator('[data-nd-ob-more]').click();
    await page.locator('#ndObMenu [data-nd-menu="hand"]').click();
    await expect(form.locator('[data-nd-hand-in="url"]')).toHaveValue('https://www.example.org/real-article-1');
    await form.locator('[data-nd-hand-in="title"]').fill('가짜 제목 둘');
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect(seen.fills).toHaveLength(2);
    expect('url' in seen.fills[1]).toBe(false);
    expect(errors).toEqual([]);
  });
}

for (const width of [390, 1280]) {
  test(`옛 직접 넣기 ${width}: 본문 첫 줄 주소 → 작은 링크(가로 넘침 없음) → [옮기기]로 원문 주소`, async ({ page }, info) => {
    test.setTimeout(90000);
    const { errors, seen } = await setup(page, width);
    await row(page, 'm1').locator('[data-nc-open="m1"]').click();
    const nd = detail(page);
    const move = nd.locator('[data-nd-move-url]');
    await expect(move).toContainText('본문 첫 줄 주소를 원문 주소로 옮길까요?');
    // 긴 주소는 작은 줄바꿈 링크(새 창), 문단 글자보다 작다. 폰에서도 가로로 넘치지 않는다.
    const links = nd.locator('[data-nd-prose] a.nd-url');
    await expect(links).toHaveCount(2);
    await expect(links.first()).toHaveAttribute('href', LONG);
    await expect(links.first()).toHaveAttribute('rel', 'noopener noreferrer');
    const sizes = await nd.locator('[data-nd-prose]').evaluate(z => ({ link: parseFloat(getComputedStyle(z.querySelector('a.nd-url')).fontSize), text: parseFloat(getComputedStyle(z).fontSize) }));
    expect(sizes.link).toBeLessThan(sizes.text);
    const over = await page.evaluate(() => {
      const el = document.querySelector('#outsideRoot [data-now-detail] .nd');
      const r = el.getBoundingClientRect();
      return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, right: r.right - window.innerWidth, prose: el.querySelector('[data-nd-prose]').scrollWidth - el.querySelector('[data-nd-prose]').clientWidth };
    });
    expect(over.doc).toBeLessThanOrEqual(0);
    expect(over.right).toBeLessThanOrEqual(1);
    expect(over.prose).toBeLessThanOrEqual(0);
    await page.screenshot({ path: info.outputPath(`hand-url-move-${width}.png`) });
    await move.locator('[data-nd-move-url-go]').click();
    await expect.poll(() => seen.fills.length).toBe(1);
    await expect(nd.locator('[data-nd-hand-form]')).toHaveCount(0);
    expect(seen.fills[0]).toMatchObject({ id: 'm1', title: '가짜 손으로 넣은 기사', url: LONG });
    expect(seen.fills[0].body.startsWith('http')).toBe(false);
    expect(seen.fills[0].body).toContain('가짜 본문 첫 문단.');
    await expect(nd.locator('[data-nd-move-url]')).toHaveCount(0);
    await expect(nd.locator('.nd-top a[data-nd-link]')).toHaveAttribute('href', LONG);
    await expect(nd.locator('[data-nd-prose] p').first()).toContainText('가짜 본문 첫 문단.');
    expect(errors).toEqual([]);
  });
}

test('옮기기 줄은 손으로 넣은 내 기사에만: 수집 기사 본문 첫 줄이 주소여도 보이지 않음', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await setup(page, 1280, server => Object.assign(server.items.find(i => i.id === 'm1'), { origin: 'tg_room', manual_at: null }));
  await row(page, 'm1').locator('[data-nc-open="m1"]').click();
  const nd = detail(page);
  await expect(nd.locator('[data-nd-prose] a.nd-url')).toHaveCount(2);
  await expect(nd.locator('[data-nd-move-url]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
