import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S67-02 NEWS-직접넣기(사용자 11/19): 공유로 넣었는데 원문을 못 읽은 기사(사이트가 늦게 답함) → 원문 칸 [직접 넣기] → 같은 자리 입력 칸
// (제목·매체·기자·기사 시각·본문) → 저장(서버 news-feed hand_fill) → 머리·제목·원문·목록 줄이 넣은 값, 요약은 넣은 본문으로 다시 만든다.
// 읽은 기사는 원문 ⋯ [수정]으로 같은 칸(값 미리 채움). 서버가 거절하면(운영자 기능 키 밖) 칸은 그대로 + 까닭 한 줄.
// 서버는 흉내, 기사·주소·사람 이름은 모두 가짜(example.org).
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '넣은 본문으로 만든 가짜 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null }, stale: false };
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
// S70-17b NEWS-제목꼭얻기: 제목 없는 기사는 보관한 글(공유로 넣은 글 = 바로 보관)일 때만 목록에 남는다 — [직접 넣기]는 그 글에서.
const FAILED = { id: 'x1', lane: 'channel', url: 'https://www.example.org/x1', title: null, lang: 'ko', publisher: null, source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-06T00:40:00Z', created_at: '2026-10-06T00:41:00Z', state: 'failed', summary: null, body_kind: null, title_ko: null, translated_at: null, starred_at: '2026-10-06T00:41:30Z', folder_id: null, _body: null, author: null, manual_at: null };

async function setup(page, width, { refuse = false } = {}) {
  const { errors, server } = await start(page, width);
  server.items.unshift({ ...FAILED });
  const bodies = { x1: { state: 'failed', reason: 'timeout', blocks: [] }, c1: { state: 'ok', reason: null, blocks: [{ t: 'p', text: '가짜 채널 본문 첫 문단.' }, { t: 'p', text: '가짜 채널 본문 둘째 문단.' }] } };
  const seen = { fills: [], ai: [] };
  await page.route('**/rest/v1/app_news_article_bodies*', route => {
    const id = (new URL(route.request().url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[id] ? [bodies[id]] : []) });
  });
  // 늦게 답하는 사이트: 다시 읽어도 못 읽음(공유 단건 그대로).
  await page.route('**/functions/v1/news-feed?action=open', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'failed' }) }));
  await page.route('**/functions/v1/news-feed?action=hand_fill', route => {
    const b = route.request().postDataJSON();
    seen.fills.push(b);
    if (refuse) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'FEATURE_OFF' }) });
    const it = server.items.find(i => i.id === b.id);
    Object.assign(it, { title: b.title, publisher: b.publisher, author: b.author, published_at: b.published_at, manual_at: '2026-10-06T01:00:00Z' });
    if (typeof b.body === 'string') {
      const paras = b.body.split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
      Object.assign(it, { state: 'ok', body_kind: 'full', _body: paras.join('\n'), summary: null });
      bodies[b.id] = { state: 'ok', reason: null, blocks: paras.map(text => ({ t: 'p', text })) };
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

for (const width of [412, 884, 1280]) {
  test(`직접 넣기 ${width}: 못 읽은 기사 → 다섯 칸 → 저장 → 머리·원문·목록·요약이 넣은 값`, async ({ page }, info) => {
    test.setTimeout(90000);
    const { errors, server, seen } = await setup(page, width);
    await expect(row(page, 'x1').locator('.nw-title')).toHaveText('못 읽은 기사 · example.org');
    await row(page, 'x1').locator('[data-nc-open="x1"]').click();
    const nd = detail(page);
    await expect(nd.locator('[data-nd-why]')).toContainText('사이트가 늦게 답해 읽지 못함');
    await expect(nd.locator('[data-nd-unread]')).toContainText('원문을 가져오면 요약해요');
    await page.screenshot({ path: info.outputPath(`hand-failed-${width}.png`) });
    await nd.locator('[data-nd-hand]').click();
    const form = nd.locator('[data-nd-hand-form]');
    await expect(form).toBeVisible();
    // 이미 아는 값(주소에서 얻은 매체)은 미리, 제목은 비움(주소뿐인 제목을 넣지 않음).
    await expect(form.locator('[data-nd-hand-in="publisher"]')).toHaveValue('example.org');
    await expect(form.locator('[data-nd-hand-in="title"]')).toHaveValue('');
    await expect(form.locator('[data-nd-hand-in="at"]')).toHaveAttribute('type', 'datetime-local');
    if (width === 412) await page.screenshot({ path: info.outputPath('hand-form-412.png') });
    await form.locator('[data-nd-hand-in="title"]').fill('가짜 공유 기사 제목 <b>태그</b>');
    await form.locator('[data-nd-hand-in="publisher"]').fill('가짜민중의소리');
    await form.locator('[data-nd-hand-in="author"]').fill('가짜 기자');
    await form.locator('[data-nd-hand-in="at"]').fill('2026-10-05T09:30');
    await form.locator('[data-nd-hand-in="body"]').fill('가짜 첫 문단입니다.\n\n가짜 둘째 문단입니다.');
    await page.screenshot({ path: info.outputPath(`hand-form-filled-${width}.png`) });
    const aiBefore = seen.ai.filter(id => id === 'x1').length;
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
    expect(seen.fills).toHaveLength(1);
    expect(seen.fills[0]).toMatchObject({ id: 'x1', title: '가짜 공유 기사 제목 <b>태그</b>', publisher: '가짜민중의소리', author: '가짜 기자', body: '가짜 첫 문단입니다.\n\n가짜 둘째 문단입니다.' });
    // 달력+시각 칸은 이 기기 시각으로 읽는다(브라우저 시간대 그대로), 목록 시각은 서울 시각으로 보인다.
    const at = await page.evaluate(() => new Date(2026, 9, 5, 9, 30).toISOString());
    expect(seen.fills[0].published_at).toBe(at);
    const seoul = new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
    // 태그 모양 글자는 그리지 않는다(뉴스 제목 공용 규칙 plainText — 꺾쇠 글자는 빼고 보임, 서버에는 넣은 글자 그대로).
    await expect(nd.locator('.nd-title')).toHaveText('가짜 공유 기사 제목 태그');
    await expect(nd.locator('.nd-title b')).toHaveCount(0);
    await expect(nd.locator('.nd-meta')).toContainText('가짜민중의소리');
    await expect(nd.locator('.nd-meta')).toContainText('가짜 기자');
    await expect(nd.locator('[data-nd-manual]')).toHaveText('직접 넣음');
    await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 첫 문단입니다.', '가짜 둘째 문단입니다.']);
    // 요약은 넣은 본문으로 다시(같은 기사 id로 요청, 재료 없음이 아님).
    await expect(nd.locator('.nd-sum')).toHaveText('넣은 본문으로 만든 가짜 요약.');
    expect(seen.ai.filter(id => id === 'x1').length).toBeGreaterThan(aiBefore);
    await page.screenshot({ path: info.outputPath(`hand-saved-${width}.png`) });
    if (width <= 760) await page.goBack();
    await expect(row(page, 'x1').locator('.nw-title')).toHaveText('가짜 공유 기사 제목 태그');
    await expect(row(page, 'x1').locator('.nw-src')).toHaveText('가짜민중의소리');
    await expect(row(page, 'x1').locator('.nw-time')).toHaveText(seoul);
    // 다시 열어도(새로 읽어도) 서버 값 그대로.
    await page.reload();
    await openNews(page, width).catch(() => {});
    await expect(row(page, 'x1').locator('.nw-title')).toHaveText('가짜 공유 기사 제목 태그');
    expect(server.items.find(i => i.id === 'x1').manual_at).toBeTruthy();
    expect(errors).toEqual([]);
  });
}

test('읽은 기사 ⋯ [수정] 1280: 같은 입력 칸에 지금 값, [취소]로 닫음, 본문을 안 바꾸면 본문은 보내지 않음', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, seen } = await setup(page, 1280);
  await row(page, 'c1').locator('[data-nc-open="c1"]').click();
  const nd = detail(page);
  await expect(nd.locator('[data-nd-prose] p')).toHaveCount(2);
  await expect(nd.locator('[data-nd-hand]')).toHaveCount(0);
  await nd.locator('[data-nd-ob-more]').click();
  await page.locator('#ndObMenu [data-nd-menu="hand"]').click();
  const form = nd.locator('[data-nd-hand-form]');
  await expect(form.locator('[data-nd-hand-in="title"]')).toHaveValue('가짜 채널 기사');
  await expect(form.locator('[data-nd-hand-in="publisher"]')).toHaveValue('가짜노동신문');
  await expect(form.locator('[data-nd-hand-in="body"]')).toHaveValue('가짜 채널 본문 첫 문단.\n가짜 채널 본문 둘째 문단.');
  await form.locator('[data-nd-hand-cancel]').click();
  await expect(form).toHaveCount(0);
  await expect(nd.locator('[data-nd-prose] p')).toHaveCount(2);
  // 제목만 바꿔 저장 → 본문은 보내지 않음(서버가 읽어 둔 본문 그대로).
  await nd.locator('[data-nd-ob-more]').click();
  await page.locator('#ndObMenu [data-nd-menu="hand"]').click();
  await form.locator('[data-nd-hand-in="title"]').fill('바로잡은 가짜 제목');
  await form.locator('button[type="submit"]').click();
  await expect(nd.locator('.nd-title')).toHaveText('바로잡은 가짜 제목');
  expect(seen.fills).toHaveLength(1);
  expect('body' in seen.fills[0]).toBe(false);
  await expect(nd.locator('[data-nd-prose] p').first()).toHaveText('가짜 채널 본문 첫 문단.');
  expect(errors).toEqual([]);
});

test('서버 거절 412: 운영자 기능 키 밖이면 입력 칸은 그대로 + 까닭 한 줄, 제목·주소·본문이 다 비면 보내지 않음', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, seen } = await setup(page, 412, { refuse: true });
  await row(page, 'x1').locator('[data-nc-open="x1"]').click();
  const nd = detail(page);
  await nd.locator('[data-nd-hand]').click();
  const form = nd.locator('[data-nd-hand-form]');
  // S68-44: 제목은 필수가 아니다(제목이 비어도 원문 주소가 있으면 보냄). 주소까지 비우면 빈 기사라 보내지 않는다.
  await form.locator('[data-nd-hand-in="url"]').fill('');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-nd-hand-note]')).toHaveText('제목·원문 주소·본문(글이나 사진) 중 하나는 넣어 주세요');
  expect(seen.fills).toHaveLength(0);
  await form.locator('[data-nd-hand-in="url"]').fill('https://www.example.org/x1');
  await form.locator('[data-nd-hand-in="title"]').fill('가짜 제목');
  await form.locator('[data-nd-hand-in="author"]').fill('가짜 기자');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-nd-hand-note]')).toHaveText('이 작업공간에서는 쓸 수 없어요');
  await expect(form.locator('[data-nd-hand-in="title"]')).toHaveValue('가짜 제목');
  await expect(form.locator('[data-nd-hand-in="author"]')).toHaveValue('가짜 기자');
  expect(seen.fills).toHaveLength(1);
  await expect(nd.locator('.nd-title')).toHaveText('못 읽은 기사 · example.org');
  expect(errors.filter(e => !/403/.test(e))).toEqual([]);
});
