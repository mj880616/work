import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S68-40(사용자 11/23 09:26 "그리고 아까 사진 넣었는데 없어짐"): 직접 넣기로 붙인 내 사진이 저장 뒤 다시 그릴 때 사라지면 안 된다.
// - 저장 → 그 자리에 사진 → 요약이 끝난 뒤에도, 다시 불러온 뒤(새로 그림)에도 사진.
// - 사진 받기(hand_photo)가 잠깐 실패해도 한 번 더 받아 보이고, 계속 실패하면 칸을 감추지 않고 '사진을 불러오지 못함 [다시]'.
// - 저장 원문 읽기가 잠깐 실패해도 한 번 더 읽고, 계속 실패하면 [다시] — 기사 줄 글자(사진 없음)를 본문인 것처럼 그리지 않는다.
// 서버는 흉내(실제 저장·덮어쓰기 막기 시험은 tests/security/news-feed-shared.test.mjs·news-feed-hand-fill.test.mjs), 주소는 example.org·photo.web2.invalid.
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null }, stale: false };
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
// S70-17b NEWS-제목꼭얻기: 제목 없는 기사는 보관한 글(공유로 넣은 글 = 바로 보관)일 때만 목록에 남는다 — [직접 넣기]는 그 글에서.
const FAILED = { id: 'x1', lane: 'channel', url: 'https://www.example.org/x1', title: null, lang: 'ko', publisher: null, source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-06T00:40:00Z', created_at: '2026-10-06T00:41:00Z', state: 'failed', summary: null, body_kind: null, title_ko: null, translated_at: null, starred_at: '2026-10-06T00:41:30Z', folder_id: null, _body: null, author: null, manual_at: null };
const OWN = /^https:\/\/photo\.web2\.invalid\/([A-Za-z0-9_-]{10,200})\.(jpg|png|webp|gif)$/;
const LINK = 'https://www.example.org/some/very/long/address/that/was/pasted?with=query&and=more';

function fakeBlocks(body) {
  return body.replace(/\r\n?/g, '\n').split('\n').map(s => s.trim()).filter(Boolean)
    .map(s => (OWN.test(s) ? { t: 'img', src: s, cap: null, alt: null } : { t: 'p', text: s }));
}
async function pngBytes(page, color) {
  const arr = await page.evaluate(async color => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 150;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 240, 150);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, color);
  return Buffer.from(arr);
}
async function pastePicture(area, bytes) {
  await area.evaluate((el, arr) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(arr)], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [...bytes]);
}
const loaded = img => img.evaluate(el => el.complete && el.naturalWidth > 0);

// ctl: viewFail(남은 사진 받기 실패 수, -1 = 계속), bodyFail(남은 원문 읽기 실패 수, -1 = 계속).
async function setup(page, width) {
  const { errors, server } = await start(page, width);
  server.items.unshift({ ...FAILED });
  const bodies = { x1: { state: 'failed', reason: 'timeout', blocks: [] } };
  const ctl = { viewFail: 0, bodyFail: 0, views: 0, bodyReads: 0, stored: new Map() };
  await page.route('**/rest/v1/app_news_article_bodies*', route => {
    ctl.bodyReads++;
    if (ctl.bodyFail) { if (ctl.bodyFail > 0) ctl.bodyFail--; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"busy"}' }); }
    const id = (new URL(route.request().url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[id] ? [bodies[id]] : []) });
  });
  await page.route('**/functions/v1/news-feed?action=open', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'failed' }) }));
  await page.route('**/functions/v1/news-feed?action=hand_photo_put', route => {
    const buf = route.request().postDataBuffer(), at = buf.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const id = `fakeDriveFile${String(ctl.stored.size + 1).padStart(4, '0')}`;
    ctl.stored.set(id, at >= 0 ? buf.subarray(at) : buf);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, file: id, src: `https://photo.web2.invalid/${id}.png` }) });
  });
  await page.route('**/functions/v1/news-feed?action=hand_photo', route => {
    ctl.views++;
    const b = route.request().postDataJSON();
    if (ctl.viewFail) { if (ctl.viewFail > 0) ctl.viewFail--; return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'PHOTO_UNAVAILABLE' }) }); }
    const inBody = (bodies[b.id]?.blocks || []).some(x => x.t === 'img' && OWN.exec(x.src)?.[1] === b.file);
    if (!inBody || !ctl.stored.has(b.file)) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'PHOTO_NOT_FOUND' }) });
    return route.fulfill({ status: 200, contentType: 'image/png', body: ctl.stored.get(b.file) });
  });
  await page.route('**/functions/v1/news-feed?action=hand_fill', route => {
    const b = route.request().postDataJSON();
    const it = server.items.find(i => i.id === b.id);
    Object.assign(it, { title: b.title, publisher: b.publisher, author: b.author, published_at: b.published_at, manual_at: '2026-10-06T01:00:00Z' });
    if (typeof b.body === 'string') {
      const blocks = fakeBlocks(b.body);
      // 기사 줄 글자는 글 문단만(서버 handPatch와 같음 — 사진 없음).
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
  return { errors, server, ctl };
}
// 직접 넣기: 긴 주소 한 줄 + 복사한 사진 한 장 → 저장.
async function handSaveWithPhoto(page) {
  await row(page, 'x1').locator('[data-nc-open="x1"]').click();
  const nd = detail(page);
  await nd.locator('[data-nd-hand]').click();
  const form = nd.locator('[data-nd-hand-form]');
  const area = form.locator('[data-nd-hand-in="body"]');
  await form.locator('[data-nd-hand-in="title"]').fill('가짜 이직 기사');
  await area.fill(LINK);
  await area.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  await pastePicture(area, await pngBytes(page, '#6f7d8a'));
  await expect(area).toHaveValue(`${LINK}\n[사진 1]\n`);
  await form.locator('button[type="submit"]').click();
  await expect(form).toHaveCount(0);
  return nd;
}
// 다시 불러오기(이 탭 메모리를 모두 버리고 서버에서 새로 읽음) → 같은 기사 열기.
async function reloadAndOpen(page, width) {
  await page.reload();
  if (!(await page.locator('#nowPanelNews').isVisible().catch(() => false))) await openNews(page, width);
  await row(page, 'x1').locator('[data-nc-open="x1"]').click();
  return detail(page);
}

for (const width of [412, 1280]) {
  test(`직접 넣은 사진 ${width}: 저장 → 요약 뒤·다시 불러온 뒤에도 사진, 잠깐 실패는 다시 받기`, async ({ page }, info) => {
    test.setTimeout(120000);
    const { errors, ctl } = await setup(page, width);
    let nd = await handSaveWithPhoto(page);
    const fig = () => nd.locator('[data-nd-prose] figure.nd-fig');
    await expect(fig()).toHaveCount(1);
    await expect.poll(() => loaded(fig().locator('img'))).toBe(true);
    await expect(nd.locator('.nd-sum')).toHaveText('가짜 요약.');
    await expect(fig()).toBeVisible();
    await expect.poll(() => loaded(fig().locator('img'))).toBe(true);
    expect(await nd.locator('[data-nd-prose] > *').evaluateAll(els => els.map(e => e.tagName))).toEqual(['P', 'FIGURE']);
    // 상세 전체를 다시 그려도(넓은 화면에서 같은 글 줄을 다시 누름 → 상세 다시 그림) 사진 그대로. 고치기 전에는 여기서 사진 칸이 비었다.
    if (width > 760) {
      await row(page, 'x1').locator('[data-nc-open="x1"]').click();
      await expect(fig()).toBeVisible();
      await expect.poll(() => loaded(fig().locator('img'))).toBe(true);
    }
    // 다시 불러온 뒤: 서버 블록에서 다시 — 사진 그대로.
    nd = await reloadAndOpen(page, width);
    await expect(fig()).toBeVisible();
    await expect.poll(() => loaded(fig().locator('img'))).toBe(true);
    await expect(nd.locator('[data-nd-prose] p').first()).toHaveText(LINK);
    // 사진 받기가 한 번 실패해도 잠깐 뒤 한 번 더 받아 보인다(칸을 감추지 않음).
    ctl.viewFail = 1;
    const before = ctl.views;
    nd = await reloadAndOpen(page, width);
    await expect.poll(() => loaded(fig().locator('img')), { timeout: 10000 }).toBe(true);
    expect(ctl.views - before).toBe(2);
    await expect(fig().locator('[data-nd-own-fail]')).toBeHidden();
    // 계속 실패하면 '사진을 불러오지 못함 [다시]' — 다시 누르면 받아 보인다.
    ctl.viewFail = -1;
    nd = await reloadAndOpen(page, width);
    const fail = fig().locator('[data-nd-own-fail]');
    await expect(fail).toBeVisible({ timeout: 10000 });
    await expect(fail).toContainText('사진을 불러오지 못함');
    await expect(fig()).toBeVisible();
    await page.screenshot({ path: info.outputPath(`photo-fail-${width}.png`) });
    ctl.viewFail = 0;
    await fail.locator('[data-nd-own-retry]').click();
    await expect.poll(() => loaded(fig().locator('img'))).toBe(true);
    await expect(fail).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('저장 원문 읽기 실패 412: 한 번은 다시 읽어 사진까지, 계속 실패면 [다시] — 사진 없는 기사 줄 글자를 본문으로 그리지 않음', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, ctl } = await setup(page, 412);
  await handSaveWithPhoto(page);
  ctl.bodyFail = 1;
  let nd = await reloadAndOpen(page, 412);
  const fig = () => nd.locator('[data-nd-prose] figure.nd-fig');
  await expect(fig()).toBeVisible();
  await expect.poll(() => loaded(fig().locator('img'))).toBe(true);
  ctl.bodyFail = -1;
  nd = await reloadAndOpen(page, 412);
  const inner = nd.locator('[data-nd-body-inner]');
  await expect(inner).toContainText('원문을 불러오지 못함');
  await expect(inner.locator('[data-nd-prose]')).toHaveCount(0);
  await expect(inner).not.toContainText(LINK);
  ctl.bodyFail = 0;
  await inner.locator('[data-nd-body-retry]').click();
  await expect(fig()).toBeVisible();
  await expect.poll(() => loaded(fig().locator('img'))).toBe(true);
  expect(errors).toEqual([]);
});
