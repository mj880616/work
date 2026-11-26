import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S67-06 NEWS-직접넣기 사진 붙여넣기(명진 11/19 "이미지 주소 복사 말고 이미지 복사해서 넣는 방법은 안돼?"):
// 직접 넣기 본문 칸에 복사한 사진 붙여넣기 · [사진]으로 고르기(여러 장) · 끌어다 놓기 → 커서 자리에 '[사진 n]' 한 줄 + 아래 작은 미리보기.
// 저장 때 한 장씩 서버(news-feed hand_photo_put)로 올리고, 그 줄은 안쪽 표시 주소 줄로 바뀌어 hand_fill로 간다. 상세는 그 자리에 서버(hand_photo)에서 받은 사진.
// 다시 열어도(⋯ [수정]) '[사진 n]' 줄로 들어오고 미리보기가 서버 그림. jpg·png·webp·gif만, 한 장 10MB까지. 올리기 실패면 글은 그대로.
// 서버는 흉내(실제 검사 시험은 tests/security/news-feed-hand-photo.test.mjs), 주소는 example.org·photo.web2.invalid.
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null }, stale: false };
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
// S70-17b NEWS-제목꼭얻기: 제목 없는 기사는 보관한 글(공유로 넣은 글 = 바로 보관)일 때만 목록에 남는다 — [직접 넣기]는 그 글에서.
const FAILED = { id: 'x1', lane: 'channel', url: 'https://www.example.org/x1', title: null, lang: 'ko', publisher: null, source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-06T00:40:00Z', created_at: '2026-10-06T00:41:00Z', state: 'failed', summary: null, body_kind: null, title_ko: null, translated_at: null, starred_at: '2026-10-06T00:41:30Z', folder_id: null, _body: null, author: null, manual_at: null };
const OWN = /^https:\/\/photo\.web2\.invalid\/([A-Za-z0-9_-]{10,200})\.(jpg|png|webp|gif)$/;

// 흉내 서버 hand_fill: 한 줄 전체가 https 그림 주소면 사진, 바로 다음 '사진:'·'ⓒ' 줄은 설명.
function fakeBlocks(body) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (/^https:\/\/\S+\.(jpe?g|png|webp|gif)$/i.test(s)) {
      let cap = null;
      if (i + 1 < lines.length && /^(사진\s*[:：]|ⓒ|▲)/.test(lines[i + 1].trim())) { cap = lines[++i].trim().replace(/^사진\s*[:：]\s*/, ''); }
      out.push({ t: 'img', src: s, cap, alt: null });
    } else if (s) out.push({ t: 'p', text: s.replace(/\s+/g, ' ') });
  }
  return out;
}

// 이 페이지에서 그린 그림(색 칸)을 png 바이트로.
async function pngBytes(page, color, w = 480, h = 300) {
  const arr = await page.evaluate(async ({ color, w, h }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); g.fillStyle = '#f4f1ea'; g.beginPath(); g.arc(w / 2, h / 2, h / 4, 0, 7); g.fill();
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, { color, w, h });
  return Buffer.from(arr);
}

async function setup(page, width, { putFail = 0 } = {}) {
  const { errors, server } = await start(page, width);
  server.items.unshift({ ...FAILED });
  const bodies = { x1: { state: 'failed', reason: 'timeout', blocks: [] } };
  const seen = { fills: [], puts: [], views: [], stored: new Map() };
  let n = 0;
  await page.route('**/rest/v1/app_news_article_bodies*', route => {
    const id = (new URL(route.request().url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[id] ? [bodies[id]] : []) });
  });
  await page.route('**/functions/v1/news-feed?action=open', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'failed' }) }));
  await page.route('**/functions/v1/news-feed?action=hand_photo_put', route => {
    const req = route.request();
    seen.puts.push({ type: req.headers()['content-type'] || '', size: req.postDataBuffer()?.length || 0, auth: !!req.headers()['authorization'] });
    if (putFail && seen.puts.length === putFail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'DRIVE_UNAVAILABLE' }) });
    const id = `fakeDriveFile${String(++n).padStart(4, '0')}`;
    // 흉내: 몸통 안 png 머리 바이트부터 끝 경계 앞까지를 그 사진으로 기억한다.
    const buf = req.postDataBuffer(), at = buf.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    seen.stored.set(id, at >= 0 ? buf.subarray(at) : buf);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, file: id, src: `https://photo.web2.invalid/${id}.png` }) });
  });
  await page.route('**/functions/v1/news-feed?action=hand_photo', route => {
    const b = route.request().postDataJSON();
    seen.views.push(b);
    const inBody = (bodies[b.id]?.blocks || []).some(x => x.t === 'img' && OWN.exec(x.src)?.[1] === b.file);
    if (!inBody || !seen.stored.has(b.file)) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'PHOTO_NOT_FOUND' }) });
    return route.fulfill({ status: 200, contentType: 'image/png', body: seen.stored.get(b.file) });
  });
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
const openMenuEdit = async (page, nd) => { await nd.locator('[data-nd-ob-more]').click(); await page.locator('#ndObMenu [data-nd-menu="edit"]').click(); await page.locator('#outsideRoot [data-nd-edit-info]').click(); }; // S71-68 ②: ⋯ [수정] = 문단 수정 칸, 직접 넣기 칸은 그 안 [제목·정보]
const loaded = img => img.evaluate(el => el.complete && el.naturalWidth > 0);
// 복사한 사진 붙여넣기(가짜 클립보드: 그림 파일만, 글자 없음).
async function pastePicture(area, bytes, type = 'image/png') {
  await area.evaluate((el, { arr, type }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(arr)], 'image.png', { type }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { arr: [...bytes], type });
}
async function dropPicture(area, bytes) {
  await area.evaluate((el, arr) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(arr)], '끌어놓은 사진.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [...bytes]);
}
const caretEnd = area => area.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });

for (const width of [412, 884, 1280]) {
  test(`직접 넣기 사진 붙여넣기 ${width}: 붙여넣기·고르기·끌어놓기 → 저장 때 올림 → 그 자리에 내 사진, [수정] 왕복`, async ({ page }, info) => {
    test.setTimeout(120000);
    const { errors, seen } = await setup(page, width);
    await row(page, 'x1').locator('[data-nc-open="x1"]').click();
    const nd = detail(page);
    await nd.locator('[data-nd-hand]').click();
    const form = nd.locator('[data-nd-hand-form]');
    const area = form.locator('[data-nd-hand-in="body"]');
    await expect(form.locator('[data-nd-hand-pick]')).toHaveText('사진');
    await form.locator('[data-nd-hand-in="title"]').fill('가짜 사진 붙여넣기 기사');
    await area.fill('가짜 첫 문단.');
    const red = await pngBytes(page, '#8a6f6a'), green = await pngBytes(page, '#6f8a76'), blue = await pngBytes(page, '#6f7d8a'), gray = await pngBytes(page, '#8a8a80');
    // (a) 복사한 사진 붙여넣기 → 커서 자리 한 줄 + 미리보기.
    await caretEnd(area);
    await pastePicture(area, red);
    await expect(area).toHaveValue('가짜 첫 문단.\n[사진 1]\n');
    await area.evaluate(el => { el.setRangeText('사진: 가짜 붙여넣은 사진\n가짜 둘째 문단.', el.selectionStart, el.selectionEnd, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); });
    const pics = form.locator('[data-nd-hand-pics] figure:not([hidden])');
    await expect(pics).toHaveCount(1);
    await expect(pics.first().locator('figcaption')).toHaveText('[사진 1]');
    await expect(pics.first()).toHaveAttribute('title', '저장할 때 올려요');
    await expect.poll(() => loaded(pics.first().locator('img'))).toBe(true);
    // (b) [사진]으로 폰 사진 고르기(여러 장).
    await caretEnd(area);
    await area.evaluate(el => { el.setRangeText('\n', el.value.length, el.value.length, 'end'); });
    await form.locator('[data-nd-hand-file]').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: green }, { name: 'b.png', mimeType: 'image/png', buffer: blue }]);
    await expect(area).toHaveValue(/가짜 둘째 문단\.\n\n?\[사진 2\]\n\[사진 3\]\n$/);
    // (c) 끌어다 놓기.
    await caretEnd(area);
    await dropPicture(area, gray);
    await expect(area).toHaveValue(/\[사진 3\]\n\[사진 4\]\n$/);
    await expect(pics).toHaveCount(4);
    // 다른 종류·큰 파일은 넣지 않고 까닭 한 줄(넣던 글은 그대로).
    await form.locator('[data-nd-hand-file]').setInputFiles([{ name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }]);
    await expect(form.locator('[data-nd-hand-note]')).toHaveText('jpg·png·webp·gif 사진만 넣을 수 있어요');
    await form.locator('[data-nd-hand-file]').setInputFiles([{ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }]);
    await expect(form.locator('[data-nd-hand-note]')).toHaveText('사진은 한 장 10MB까지');
    await expect(area).toHaveValue(/^가짜 첫 문단\.\n\[사진 1\]\n사진: 가짜 붙여넣은 사진\n가짜 둘째 문단\./);
    // 줄을 빼면 그 사진은 올리지 않는다([사진 3] 뺌).
    await area.fill((await area.inputValue()).replace('[사진 3]\n', '') + 'ⓒ 가짜 매체');
    await area.dispatchEvent('input');
    await expect(pics).toHaveCount(3);
    await page.screenshot({ path: info.outputPath(`paste-form-${width}.png`) });
    expect(seen.puts).toHaveLength(0); // 아직 아무것도 안 올림(저장 때 올림)
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect(seen.puts).toHaveLength(3);
    expect(seen.puts.every(p => p.auth && /^multipart\/form-data/.test(p.type))).toBe(true);
    expect(seen.fills).toHaveLength(1);
    const sent = seen.fills[0].body;
    expect(sent).not.toContain('[사진');
    expect(sent.split('\n').filter(l => OWN.test(l))).toHaveLength(3);
    expect(sent).toMatch(/\nhttps:\/\/photo\.web2\.invalid\/fakeDriveFile0001\.png\n사진: 가짜 붙여넣은 사진\n/);
    // 상세: 그 자리에 서버에서 받은 내 사진(+ 설명).
    const figs = nd.locator('[data-nd-prose] figure.nd-fig');
    await expect(figs).toHaveCount(3);
    await expect.poll(() => loaded(figs.nth(0).locator('img'))).toBe(true);
    await expect(figs.nth(0).locator('img')).toHaveAttribute('src', /^blob:/);
    await expect(figs.nth(0).locator('figcaption')).toHaveText('가짜 붙여넣은 사진');
    await expect(figs.nth(2).locator('figcaption')).toHaveText('ⓒ 가짜 매체');
    expect(await nd.locator('[data-nd-prose] img[src*="photo.web2.invalid"], [data-nd-prose] a[href*="photo.web2.invalid"]').count()).toBe(0);
    expect(await nd.locator('[data-nd-prose] > *').evaluateAll(els => els.map(e => e.tagName))).toEqual(['P', 'FIGURE', 'P', 'FIGURE', 'FIGURE']);
    await page.screenshot({ path: info.outputPath(`paste-saved-${width}.png`) });
    // ⋯ [수정]: 내 사진은 '[사진 n]' 줄로 들어오고 미리보기는 서버 그림. 그대로 저장하면 본문을 보내지 않는다.
    await openMenuEdit(page, nd);
    await expect(area).toHaveValue('가짜 첫 문단.\n[사진 1]\n사진: 가짜 붙여넣은 사진\n가짜 둘째 문단.\n[사진 2]\n[사진 3]\nⓒ 가짜 매체');
    await expect(pics).toHaveCount(3);
    await expect.poll(() => loaded(pics.nth(2).locator('img'))).toBe(true);
    await expect(pics.nth(0).locator('figcaption')).toHaveText('[사진 1]');
    await expect(pics.nth(0)).not.toHaveAttribute('data-nd-hand-wait', '');
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect('body' in seen.fills[1]).toBe(false);
    expect(seen.puts).toHaveLength(3);
    // 한 장 더 붙여 넣고 저장 → 그 한 장만 올리고 옛 사진은 그대로.
    await openMenuEdit(page, nd);
    await caretEnd(area);
    await area.evaluate(el => { el.setRangeText('\n', el.value.length, el.value.length, 'end'); });
    await pastePicture(area, red);
    await expect(area).toHaveValue(/ⓒ 가짜 매체\n\[사진 4\]\n$/);
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect(seen.puts).toHaveLength(4);
    await expect(figs).toHaveCount(4);
    await expect.poll(() => loaded(figs.nth(3).locator('img'))).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('올리기 실패 412: 글은 그대로 두고 까닭 한 줄, 다시 저장하면 이어서', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, seen } = await setup(page, 412, { putFail: 2 });
  await row(page, 'x1').locator('[data-nc-open="x1"]').click();
  const nd = detail(page);
  await nd.locator('[data-nd-hand]').click();
  const form = nd.locator('[data-nd-hand-form]');
  const area = form.locator('[data-nd-hand-in="body"]');
  await form.locator('[data-nd-hand-in="title"]').fill('가짜 제목');
  await area.fill('가짜 문단.');
  await caretEnd(area);
  const a = await pngBytes(page, '#8a6f6a', 120, 80), b = await pngBytes(page, '#6f8a76', 120, 80);
  await pastePicture(area, a);
  await pastePicture(area, b);
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-nd-hand-note]')).toHaveText(/^\[사진 2\] · /);
  await expect(area).toHaveValue('가짜 문단.\n[사진 1]\n[사진 2]\n');
  expect(seen.fills).toHaveLength(0);
  // 다시 [저장]: 이미 올린 1장은 다시 올리지 않는다.
  await form.locator('button[type="submit"]').click();
  await expect(form).toHaveCount(0);
  expect(seen.puts).toHaveLength(3);
  expect(seen.fills[0].body.split('\n').filter(l => OWN.test(l))).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('운영자 아닌 작업공간 1280: 서버가 거절하면 올리지 못했다는 한 줄, 저장 안 함', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, seen } = await setup(page, 1280);
  await page.route('**/functions/v1/news-feed?action=hand_photo_put', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'FEATURE_OFF' }) }));
  await row(page, 'x1').locator('[data-nc-open="x1"]').click();
  const nd = detail(page);
  await nd.locator('[data-nd-hand]').click();
  const form = nd.locator('[data-nd-hand-form]');
  const area = form.locator('[data-nd-hand-in="body"]');
  await form.locator('[data-nd-hand-in="title"]').fill('가짜 제목');
  await area.fill('가짜 문단.');
  await caretEnd(area);
  await pastePicture(area, await pngBytes(page, '#8a6f6a', 120, 80));
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-nd-hand-note]')).toHaveText('[사진 1] · 이 작업공간에서는 쓸 수 없어요');
  expect(seen.fills).toHaveLength(0);
  expect(errors).toEqual([]);
});
