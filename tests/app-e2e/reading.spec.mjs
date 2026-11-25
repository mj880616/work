// S68-09 READ-읽을거리함: 메뉴 '읽을 거리' → 목록(안 읽음 점·제목·사이트·날짜, 칩 [안 읽음 n][전체][밑줄]) → 글 보기(받아 둔 원문 사본·밑줄·[밑줄을 노트로]·[읽음])
// · [+ 추가](주소 → 넣기 → 기존 note-import로 원문 받아 오기) · 남의 작업공간 줄은 서버가 거절(화면은 한 줄 알림, 요청은 늘 내 작업공간 열쇠).
// 글·주소는 모두 예시. 서버는 흉내(표는 owner RLS REST, 원문은 Edge note-import).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noticeText } from './helpers/small-notice.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const A = 'a6800000-0000-4000-8000-000000000001', B = 'a6800000-0000-4000-8000-000000000002', NEW = 'a6800000-0000-4000-8000-000000000003';
const QUOTE = '공공부문 인력 충원이 늦어지는 까닭';
const BODY = `첫 문단은 배경이에요.\n\n둘째 문단: ${QUOTE}을 짚어 봐요.\n\n셋째 문단은 정리예요.`;

async function server(page, { refuseRead = false, extra = [], importFail = {}, newsBodies = {}, importDelay = 0 } = {}) {
  const s = {
    rows: [
      { id: A, workspace_id: 'w', url: 'https://example.com/a', title: '예시 기사 하나', site: 'example.com', saved_at: '2026-11-22T01:00:00Z', read_at: null, body_state: 'ok', body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T01:00:10Z', body: BODY },
      { id: B, workspace_id: 'w', url: 'https://example.org/b', title: '예시 칼럼 둘', site: 'example.org', saved_at: '2026-11-21T01:00:00Z', read_at: '2026-11-21T02:00:00Z', body_state: 'bot_check', body_at: '2026-11-21T01:00:10Z', business_area_id: null, updated_at: '2026-11-21T02:00:00Z', body: null },
      ...extra,
    ],
    calls: [], posts: [], patches: [], imports: [], hl: [], hlPosts: [], notes: [], bodyReads: [],
  };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/note-import') {
      s.imports.push(body);
      if (importDelay) await new Promise(r => setTimeout(r, importDelay));
      if (importFail[body.url]) return ok({ ok: true, state: 'failed', reason: importFail[body.url], url: body.url, title: null, site: null, author: null, published_at: null, lang: null, blocks: [], chars: 0, truncated: false });
      return ok({ ok: true, state: 'ok', reason: null, url: body.url, title: '새로 받은 글 제목', site: '예시 신문', author: null, published_at: null, lang: 'ko',
        blocks: [{ t: 'h', text: '소제목' }, { t: 'p', text: '받아 온 본문 <b>글자</b>예요.' }, { t: 'img', src: 'https://example.org/x.png' }], chars: 20, truncated: false });
    }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_reading_items') {
      s.calls.push({ method, search: decodeURIComponent(u.search) });
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const pick = r => { const { workspace_id, body: b, ...rest } = r; return (u.searchParams.get('select') || '').includes('body') ? { ...rest, body: b } : rest; };
      if (method === 'POST') {
        s.posts.push(body);
        const row = { id: NEW, saved_at: '2026-11-22T03:00:00Z', read_at: null, body_state: 'pending', body_at: null, business_area_id: null, updated_at: '2026-11-22T03:00:00Z', body: null, ...body };
        s.rows.unshift(row);
        return ok([pick(row)], 201);
      }
      if (method === 'PATCH') {
        s.patches.push({ id, body });
        // 남의 작업공간 줄(또는 RLS가 막은 줄)은 서버가 거절한다.
        if (refuseRead && 'read_at' in body) return ok({ code: '42501', message: 'new row violates row-level security policy' }, 403);
        const r = s.rows.find(x => x.id === id);
        if (r) Object.assign(r, body);
        return ok(r ? [pick(r)] : []);
      }
      if (method === 'DELETE') { s.rows = s.rows.filter(x => x.id !== id); return route.fulfill({ status: 204 }); }
      return ok((id ? s.rows.filter(x => x.id === id) : s.rows).map(pick));
    }
    if (table === 'app_news_article_bodies' || table === 'app_outside_article_bodies') {
      const id = (u.searchParams.get('article_id') || '').replace(/^eq\./, '');
      s.bodyReads.push(id);
      return ok(newsBodies[id] ? [newsBodies[id]] : []);
    }
    if (table === 'app_news_highlights') {
      if (method === 'POST') { const row = { ...body, id: 'b6800000-0000-4000-8000-00000000000' + (s.hl.length + 1), created_at: '2026-11-22T04:00:00Z', updated_at: '2026-11-22T04:00:00Z' }; s.hlPosts.push(body); s.hl.unshift(row); return ok([row], 201); }
      return ok(s.hl);
    }
    if (table === 'app_notes' && method === 'POST') { s.notes.push(body); if (s.noteDelay) await new Promise(r => setTimeout(r, s.noteDelay)); return ok([{ id: 'c6800000-0000-4000-8000-000000000001', kind: 'note', title: body.title, raw_text: body.raw_text, metadata: body.metadata || {}, created_at: '2026-11-22T04:00:00Z', updated_at: '2026-11-22T04:00:00Z', archived_at: null }], 201); }
    return route.fallback();
  });
  return s;
}

async function goReading(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
}
const list = page => page.locator('#readingView [data-rd-list]');
const detail = page => page.locator('#readingView [data-rd-detail]');
const bar = page => page.locator('div[data-hl-bar]');
const pick = (page, text) => page.evaluate(t => {
  const p = [...document.querySelectorAll('#readingView [data-rd-prose] p')].find(x => x.textContent.includes(t));
  const node = [...p.childNodes].find(n => n.nodeType === 3 && n.data.includes(t));
  const i = node.data.indexOf(t), r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + t.length);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}, text);

for (const [label, width] of [['phone-412', 412], ['pc-1280', 1280]]) {
  test(`읽을 거리 목록·글 보기·밑줄·노트로·읽음 (${label})`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page);
    const s = await server(page);
    await goReading(page, width);
    // 처음은 [전체](S70-24): 두 줄. 칩은 [전체][안 읽음 1][밑줄][메모] — News 기능이 있는 계정(기본 운영자 흉내)도 [News] 칩 없음(S68-29).
    await expect(list(page).locator('.rd-switch [data-filter-value]')).toHaveText(['전체', '안 읽음 1', '밑줄', '메모']);
    await expect(list(page).locator('.rd-row')).toHaveCount(2);
    await list(page).locator('.rd-switch [data-filter-value="unread"]').click();
    await expect(list(page).locator('.rd-row')).toHaveCount(1);
    await expect(list(page).locator('.rd-row').first()).toContainText('예시 기사 하나');
    await expect(list(page).locator('.rd-row').first()).toContainText('example.com · 11/22');
    await expect(list(page).locator('.rd-row.is-unread .rd-dot')).toHaveCount(1);
    // 요청은 모두 내 작업공간 열쇠로만(서버 RLS가 owner를 다시 본다).
    expect(s.calls.every(c => c.search.includes('workspace_id=eq.w'))).toBe(true);

    // 글 보기: 원문 사본(글자로만), 원래 페이지 링크, 밑줄 줄. S68-45: 열면 읽음(read_at만 서버에 저장). 지금 [안 읽음] 보기.
    await list(page).locator(`.rd-row[data-rd-open="${A}"]`).click();
    await expect.poll(() => s.patches.length).toBe(1);
    expect(s.patches[0].id).toBe(A);
    expect(Object.keys(s.patches[0].body).sort()).toEqual(['read_at', 'updated_at']);
    expect(s.patches[0].body.read_at).toBeTruthy();
    await expect(detail(page)).toBeVisible();
    await expect(detail(page).locator('.rd-title')).toHaveText('예시 기사 하나');
    await expect(detail(page).locator('a.rd-src')).toHaveAttribute('href', 'https://example.com/a');
    await expect(detail(page).locator('[data-rd-prose] p')).toHaveCount(3);
    if (width > 760) await expect(list(page)).toBeVisible(); else await expect(list(page)).toBeHidden();

    await pick(page, QUOTE);
    await expect(bar(page)).toBeVisible();
    await bar(page).getByRole('button', { name: '밑줄 저장' }).click();
    await expect.poll(() => s.hlPosts.length).toBe(1);
    expect(s.hlPosts[0]).toMatchObject({ workspace_id: 'w', source_type: 'reading', source_id: A, quote: QUOTE, source_title: '예시 기사 하나', source_media: 'example.com', source_url: 'https://example.com/a' });
    await expect(detail(page).locator('[data-rd-prose] mark.hl-mark')).toHaveText(QUOTE);

    // [밑줄을 노트로]: 밑줄 문장 + 출처(제목·사이트·주소)로 노트 하나.
    await detail(page).locator('[data-rd-note]').click();
    await expect.poll(() => s.notes.length).toBe(1);
    expect(s.notes[0].raw_text).toContain(QUOTE);
    expect(s.notes[0].raw_text).toContain('https://example.com/a');
    expect(s.notes[0].raw_text).toContain('example.com');

    // 연 글은 이미 읽음 → [안 읽음으로]로 되돌릴 수 있고, [읽음]으로 다시. 읽은 시각만 고친다.
    await expect(detail(page).locator('[data-rd-read="0"]')).toHaveText('안 읽음으로');
    if (width > 760) await expect(list(page).locator(`.rd-row[data-rd-open="${A}"]`)).not.toHaveClass(/is-unread/); // 열어 둔 줄은 [안 읽음]에서도 닫을 때까지 그 자리
    await detail(page).locator('[data-rd-read="0"]').click();
    await expect.poll(() => s.patches.length).toBe(2);
    expect(s.patches[1].body.read_at).toBeNull();
    await expect(detail(page).locator('[data-rd-read="1"]')).toHaveText('읽음');
    await detail(page).locator('[data-rd-read="1"]').click();
    await expect.poll(() => s.patches.length).toBe(3);
    expect(Object.keys(s.patches[2].body).sort()).toEqual(['read_at', 'updated_at']);
    await expect(detail(page).locator('[data-rd-read="0"]')).toHaveText('안 읽음으로');

    // 폰: 뒤로 = 목록(다른 화면으로 가지 않음).
    if (width <= 760) {
      await page.goBack();
      await expect(detail(page)).toBeHidden();
      await expect(list(page)).toBeVisible();
      await expect(page.locator('#readingView')).toBeVisible();
    }
    // 목록으로 돌아오면 점이 꺼져 있고(전체), 새로고침 뒤에도 서버 값 그대로.
    await list(page).locator('.rd-switch [data-filter-value="all"]').click();
    await expect(list(page).locator(`.rd-row[data-rd-open="${A}"]`)).not.toHaveClass(/is-unread/);
    await page.reload();
    await goReading(page, width).catch(() => {});
    await expect(page.locator('#readingView')).toBeVisible();
    await expect(list(page).locator('.rd-switch [data-filter-value="unread"]')).toHaveText('안 읽음');
    expect(errors).toEqual([]);
  });
}

// S68-45(명진 11/23 11:08 "안읽은 글 눌러서 읽었는데 읽음 처리 안됨"): 안 읽은 줄을 눌러 열면 읽음. 저장이 실패하면 조용히 넘기지 않고(알림 한 줄)
// 점은 그대로 — 다음에 열 때 다시 저장한다.
test('열면 읽음 412: 저장 실패 → 알림 한 줄·점 그대로, 다음에 열 때 다시 저장', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 412, height: 900 });
  await openHome(page);
  const s = await server(page);
  let refuse = true;
  await page.route(SB + '/rest/v1/app_reading_items*', route => {
    if (route.request().method() === 'PATCH' && refuse) { s.patches.push({ id: 'refused', body: route.request().postDataJSON() }); return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"busy"}' }); }
    return route.fallback();
  });
  await goReading(page, 412);
  await list(page).locator(`.rd-row[data-rd-open="${A}"]`).click();
  await expect(detail(page)).toBeVisible();
  await expect.poll(() => noticeText(page)).toContain('읽음으로 저장하지 못했어요');
  await expect(detail(page).locator('[data-rd-read="1"]')).toHaveText('읽음');
  await page.goBack();
  await expect(list(page).locator(`.rd-row[data-rd-open="${A}"]`)).toHaveClass(/is-unread/);
  refuse = false;
  await list(page).locator(`.rd-row[data-rd-open="${A}"]`).click();
  await expect.poll(() => s.rows.find(r => r.id === A).read_at).toBeTruthy();
  await expect(detail(page).locator('[data-rd-read="0"]')).toHaveText('안 읽음으로');
  await page.goBack();
  await expect(list(page).locator(`.rd-row[data-rd-open="${A}"]`)).not.toHaveClass(/is-unread/); // [전체](S70-24 기본)에서 점 꺼짐
  await list(page).locator('.rd-switch [data-filter-value="unread"]').click();
  await expect(list(page).locator(`.rd-row[data-rd-open="${A}"]`)).toHaveCount(0); // [안 읽음]에서 빠짐
});

test('[+ 추가]: 주소 → 넣기 → note-import로 원문을 받아 글자로만 저장, 막힌 줄은 한 줄 상태와 원래 페이지 링크', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page);
  const s = await server(page);
  await goReading(page, 1280);
  await list(page).locator('[data-rd-add]').click();
  await list(page).locator('input.rd-url').fill('javascript:alert(1)');
  await list(page).getByRole('button', { name: '저장', exact: true }).click(); // S68-34: 줄 ⋯ 이름 '저장한 글 메뉴'와 겹치지 않게 정확히
  await expect(list(page).locator('.rd-bad')).toContainText('가져올 수 없어요');
  expect(s.posts).toEqual([]);
  await list(page).locator('input.rd-url').fill('example.net/new');
  await list(page).getByRole('button', { name: '저장', exact: true }).click(); // S68-34: 줄 ⋯ 이름 '저장한 글 메뉴'와 겹치지 않게 정확히
  await expect.poll(() => s.posts.length).toBe(1);
  expect(s.posts[0]).toEqual({ workspace_id: 'w', url: 'https://example.net/new', title: null, site: 'example.net' });
  await expect.poll(() => s.imports.length).toBe(1);
  expect(s.imports[0]).toEqual({ url: 'https://example.net/new' });
  await expect.poll(() => s.patches.length).toBe(1);
  const patch = s.patches[0];
  expect(patch.id).toBe(NEW);
  expect(patch.body).toMatchObject({ title: '새로 받은 글 제목', site: '예시 신문', body_state: 'ok', body: '소제목\n\n받아 온 본문 <b>글자</b>예요.' });
  expect('workspace_id' in patch.body || 'url' in patch.body).toBe(false);
  await expect(list(page).locator(`.rd-row[data-rd-open="${NEW}"]`)).toContainText('새로 받은 글 제목');
  await expect.poll(() => noticeText(page)).toContain('저장한 글에 넣었어요');
  // 원문은 글자로만: <b>가 꾸밈이 아니라 글자로 보인다.
  await list(page).locator(`.rd-row[data-rd-open="${NEW}"]`).click();
  await expect(detail(page).locator('[data-rd-prose] p').nth(1)).toHaveText('받아 온 본문 <b>글자</b>예요.');
  await expect(detail(page).locator('[data-rd-prose] b')).toHaveCount(0);
  // 막힌 줄: 한 줄 상태 + [다시], 원래 페이지 링크는 그대로.
  await list(page).locator('.rd-switch [data-filter-value="all"]').click();
  await list(page).locator(`.rd-row[data-rd-open="${B}"]`).click();
  await expect(detail(page).locator('.rd-line')).toContainText('읽기를 막아');
  await expect(detail(page).locator('a.rd-src')).toHaveAttribute('href', 'https://example.org/b');
  // 우클릭(PC): 줄의 ⋯ 메뉴가 열린다(공통 context-menu.js).
  await list(page).locator(`.rd-row[data-rd-open="${A}"] .rd-nm`).click({ button: 'right' });
  await expect(page.locator('#rdRowMenu')).toBeVisible();
  await expect(page.locator('#rdRowMenu button')).toHaveText(['수정', '읽음', '사업에 연결', '삭제']);
});

test('남의 작업공간 줄: 서버가 거절하면 바꾸지 않고 한 줄 알림(화면이 다른 작업공간 열쇠를 보내지 않음)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page);
  const s = await server(page, { refuseRead: true });
  await goReading(page, 1280);
  await list(page).locator(`.rd-row[data-rd-open="${A}"]`).click();
  // S68-45: 열 때 읽음 저장도 서버가 거절 → 알림 한 줄, 그대로 안 읽음.
  await expect.poll(() => noticeText(page)).toContain('읽음으로 저장하지 못했어요');
  await detail(page).locator('[data-rd-read="1"]').click();
  await expect.poll(() => noticeText(page)).toContain('저장하지 못했어요');
  await expect(detail(page).locator('[data-rd-read="1"]')).toHaveText('읽음');
  expect(s.calls.filter(c => c.method === 'PATCH').every(c => c.search.includes(`id=eq.${A}`) && c.search.includes('workspace_id=eq.w'))).toBe(true);
});

test('전체 검색: 읽을 거리 제목·원문 사본에서 찾고 누르면 그 글, 서버가 아직 읽을 거리를 모르면 지금 종류로 다시 묻는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const calls = [];
  let knowsReading = false;
  const item = (kind, id, title, extra = {}) => ({ kind, source: kind, id, title, matched_in: 'title', snippet: null, occurred_at: '2026-11-22T01:00:00+00:00', day: null, state: null,
    project_id: null, project_name: null, organization_id: null, organization_name: null, ...extra });
  await openHome(page, { beforeLoad: () => page.route(SB + '/rest/v1/rpc/app_search_records', route => {
    const body = route.request().postDataJSON(); calls.push(body);
    if (!knowsReading && body.p_kinds?.includes('reading')) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '22023', message: 'SEARCH_BAD_KIND' }) });
    const kinds = body.p_kind ? [body.p_kind] : body.p_kinds || ['update', 'note', 'work', 'document', 'meeting', 'project', 'organization', 'milestone'];
    const groups = kinds.map(kind => kind === 'reading'
      ? { kind, total: 1, capped: false, offset: 0, items: [item('reading', A, '예시 기사 하나', { matched_in: 'body', snippet: '둘째 문단: 공공부문 인력 충원이 늦어지는 까닭을' })] }
      : { kind, total: 0, capped: false, offset: 0, items: [] });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ words: [String(body.p_query)], groups }) });
  }) });
  const s = await server(page);
  const top = page.locator('[data-search-slot] input[type="search"]');
  // 아직 적용 전 서버: 이름 목록이 거절되면 지금 종류(null)로 한 번 더 — 검색은 그대로 된다.
  await top.click(); await top.fill('충원');
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[0].p_kinds).toEqual(['update', 'note', 'work', 'document', 'meeting', 'project', 'organization', 'milestone', 'reading']);
  expect(calls[1].p_kinds).toBe(null);
  await page.keyboard.press('Escape');
  // 적용 뒤 서버(새 탭과 같음): 읽을 거리 묶음이 보이고, 누르면 읽을 거리 화면의 그 글.
  knowsReading = true;
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await top.click(); await top.fill('인력 충원');
  const row = page.locator('#gsPanel').getByText('예시 기사 하나');
  await expect(row).toBeVisible();
  expect(calls.at(-1).p_kinds).toContain('reading');
  await row.click();
  await expect(page.locator('#readingView')).toBeVisible();
  await expect(detail(page).locator('.rd-title')).toHaveText('예시 기사 하나');
  expect(s.calls.length).toBeGreaterThan(0);
});

// S68-32: 이미 보관한 글 원문 다시 — 화면이 열릴 때 원문이 없거나 실패·robots로 남은 줄을 한 번씩 자동으로(2개씩 차례로), News에서 온 줄은 News 쪽 본문 먼저.
test('자동 다시 가져오기: 옛 robots·실패·빈 줄만 한 번, News 본문이 있으면 그것, 다시 실패하면 [다시] 단추만', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page);
  const id = n => `a6800000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
  const NEWS_ART = 'd6800000-0000-4000-8000-000000000001';
  const row = (n, extra) => ({ id: id(n), workspace_id: 'w', url: `https://example.net/${n}`, title: `보관 글 ${n}`, site: 'example.net', saved_at: `2026-11-20T0${n}:00:00Z`, read_at: null,
    body_state: 'robots', body_at: '2026-11-20T00:00:10Z', business_area_id: null, updated_at: '2026-11-20T00:00:10Z', body: null, origin: 'direct', news_article_id: null, outside_article_id: null, ...extra });
  const s = await server(page, {
    extra: [
      row(1, {}), // 옛 robots(서버 고침 전) → 원래 주소로 다시
      row(2, { body_state: 'pending', body_at: null, origin: 'news', news_article_id: NEWS_ART }), // News에서 온 빈 줄 → News 본문
      row(3, { body_state: 'failed' }), // 옛 실패 → 다시 했는데 또 막힘
      row(4, { body_state: 'robots', body_at: '2026-11-23T05:00:00+09:00' }), // 고친 뒤에 이미 해 본 줄 → 자동 안 함
      row(5, { body_state: 'too_big' }), // 다시 해도 같은 상태 → 자동 안 함
    ],
    importFail: { 'https://example.net/3': 'bot_check' },
    newsBodies: { [NEWS_ART]: { state: 'ok', reason: null, blocks: [{ t: 'p', text: 'News에 이미 있던 본문이에요.' }, { t: 'img', src: 'https://example.org/y.png' }] } },
  });
  await goReading(page, 1280);
  // 대상 셋(1·2·3)만, 한 줄에 한 번. News 줄은 note-import를 부르지 않는다.
  await expect.poll(() => s.patches.length).toBe(3);
  expect(s.imports.map(x => x.url).sort()).toEqual(['https://example.net/1', 'https://example.net/3']);
  expect(s.bodyReads).toEqual([NEWS_ART]);
  const byId = Object.fromEntries(s.patches.map(x => [x.id, x.body]));
  expect(byId[id(2)]).toMatchObject({ body: 'News에 이미 있던 본문이에요.', body_state: 'ok' });
  expect(Object.keys(byId[id(2)]).sort()).toEqual(['body', 'body_at', 'body_state', 'updated_at']);
  expect(byId[id(1)]).toMatchObject({ body_state: 'ok' });
  expect(byId[id(3)]).toMatchObject({ body_state: 'bot_check', body: null });
  expect(id(4) in byId || id(5) in byId).toBe(false);
  // 다시 열어도(다른 화면 → 읽을 거리) 다시 자동으로 하지 않는다 — 실패한 줄은 [다시] 단추만.
  await page.evaluate(() => window.KPTUReading.refresh());
  // S68-45: 줄을 열면 읽음이 되어 [안 읽음]에서 빠지므로 [전체]에서 차례로 연다.
  await list(page).locator('.rd-switch [data-filter-value="all"]').click();
  await list(page).locator(`.rd-row[data-rd-open="${id(3)}"]`).click();
  await expect(detail(page).locator('.rd-line')).toContainText('읽기를 막아');
  await expect(detail(page).locator('.rd-line [data-rd-fetch]')).toHaveText('원문 다시 가져오기');
  await page.waitForTimeout(500);
  expect(s.imports.length).toBe(2);
  // robots 줄(자동 대상 아님)도 [다시]는 보인다. too_big은 숨김.
  await list(page).locator(`.rd-row[data-rd-open="${id(4)}"]`).click();
  await expect(detail(page).locator('.rd-line [data-rd-fetch]')).toHaveText('원문 다시 가져오기');
  await list(page).locator(`.rd-row[data-rd-open="${id(5)}"]`).click();
  await expect(detail(page).locator('.rd-line')).toContainText('너무 커서');
  await expect(detail(page).locator('.rd-line [data-rd-fetch]')).toHaveCount(0);
  // [다시] 누르면 그때 원래 주소로 한 번 더(사람이 누른 것).
  await list(page).locator(`.rd-row[data-rd-open="${id(3)}"]`).click();
  await detail(page).locator('.rd-line [data-rd-fetch]').click();
  await expect.poll(() => s.imports.length).toBe(3);
});

// S68-52: 글 보기에서도 [원문 다시 가져오기](⋯ 메뉴와 같은 함수). 앞부분만 받은 줄(조선일보처럼 본문을 못 뽑아 리드만 남은 줄) → 다시 → 전체 본문, 실패면 까닭 한 줄.
test('글 보기 [원문 다시 가져오기]: 가져오는 중 → 본문 표시, 실패면 까닭 한 줄과 단추가 다시', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page);
  const LEAD = 'a6800000-0000-4000-8000-000000000201', FAIL = 'a6800000-0000-4000-8000-000000000202';
  const row = (id, n, extra) => ({ id, workspace_id: 'w', url: `https://example.net/lead/${n}`, title: `앞부분만 받은 글 ${n}`, site: 'example.net', saved_at: `2026-11-12T0${n}:00:00Z`, read_at: null,
    body_state: 'paywall', body_at: '2026-11-23T06:00:00+09:00', business_area_id: null, updated_at: '2026-11-23T06:00:00+09:00', body: '공개 리드 문단만 있어요.', origin: 'direct', news_article_id: null, outside_article_id: null, ...extra });
  const s = await server(page, {
    extra: [row(LEAD, 1, {}), row(FAIL, 2, { body_state: 'failed', body: null })],
    importFail: { 'https://example.net/lead/2': 'bot_check' },
    importDelay: 400,
  });
  await goReading(page, 1280);
  await list(page).locator(`.rd-row[data-rd-open="${LEAD}"]`).click();
  await expect(detail(page).locator('.rd-line')).toContainText('공개된 앞부분만');
  const again = detail(page).locator('.rd-line [data-rd-fetch]');
  await expect(again).toHaveText('원문 다시 가져오기');
  await page.waitForTimeout(300);
  expect(s.imports.length).toBe(0); // 자동으로 부르지 않는다(사람이 누를 때만)
  await again.click();
  await expect(detail(page).locator('.rd-line')).toHaveText('원문을 가져오는 중…');
  await expect(detail(page).locator('.rd-line [data-rd-fetch]')).toHaveCount(0);
  await expect(detail(page).locator('[data-rd-prose]')).toContainText('받아 온 본문');
  await expect(detail(page).locator('.rd-line')).toHaveCount(0);
  expect(s.imports.map(x => x.url)).toEqual(['https://example.net/lead/1']);
  expect(s.patches.find(x => x.id === LEAD && 'body_state' in x.body)?.body).toMatchObject({ body_state: 'ok' });
  // 실패: 까닭 한 줄 + 단추가 다시 보인다.
  await list(page).locator('.rd-switch [data-filter-value="all"]').click();
  await list(page).locator(`.rd-row[data-rd-open="${FAIL}"]`).click();
  await detail(page).locator('.rd-line [data-rd-fetch]').click();
  await expect.poll(() => s.imports.length).toBe(2);
  await expect(detail(page).locator('.rd-line')).toContainText('읽기를 막아');
  await expect(detail(page).locator('.rd-line [data-rd-fetch]')).toHaveText('원문 다시 가져오기');
});

// S68-52: News에서 온 줄인데 News 쪽 본문이 앞부분(리드)뿐이면 — 예전에는 다시 눌러도 그 리드만 다시 넣었다. 이제 원래 주소로 한 번 더 읽어 전문을 넣고, 못 받으면 리드를 남긴다.
// News에서 온 줄은 줄을 누르면 News 원문 보기로 열리므로(그쪽 단추는 news-detail-refetch.spec) 여기서는 줄 ⋯ 메뉴로 누른다 — 같은 fetchBody.
test('News에서 온 앞부분만 줄: ⋯ [원문 다시 가져오기] → 원래 주소로 전문, 못 받으면 News 앞부분 유지', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page);
  const N1 = 'a6800000-0000-4000-8000-000000000301', N2 = 'a6800000-0000-4000-8000-000000000302';
  const ART1 = 'd6800000-0000-4000-8000-000000000301', ART2 = 'd6800000-0000-4000-8000-000000000302';
  const row = (id, n, art) => ({ id, workspace_id: 'w', url: `https://example.net/news/${n}`, title: `News 글 ${n}`, site: 'example.net', saved_at: `2026-11-12T0${n}:00:00Z`, read_at: null,
    body_state: 'paywall', body_at: '2026-11-23T06:00:00+09:00', business_area_id: null, updated_at: '2026-11-23T06:00:00+09:00', body: 'News 리드 문단.', origin: 'news', news_article_id: art, outside_article_id: null });
  const lead = { state: 'lead', reason: null, blocks: [{ t: 'p', text: 'News 리드 문단.' }] };
  const s = await server(page, {
    extra: [row(N1, 1, ART1), row(N2, 2, ART2)],
    newsBodies: { [ART1]: lead, [ART2]: lead },
    importFail: { 'https://example.net/news/2': 'no_body' },
  });
  await goReading(page, 1280);
  const refetch = async id => {
    await list(page).locator(`[data-rd-more="${id}"]`).click();
    await page.locator('#rdRowMenu [data-rd-act="fetch"]').click();
  };
  await refetch(N1);
  await expect.poll(() => s.patches.filter(x => x.id === N1 && 'body_state' in x.body).length).toBe(1);
  expect(s.imports.map(x => x.url)).toEqual(['https://example.net/news/1']);
  expect(s.bodyReads).toContain(ART1);
  expect(s.patches.find(x => x.id === N1 && 'body_state' in x.body).body).toMatchObject({ body_state: 'ok' });
  await refetch(N2);
  await expect.poll(() => s.patches.filter(x => x.id === N2 && 'body_state' in x.body).length).toBe(1);
  expect(s.imports.map(x => x.url)).toEqual(['https://example.net/news/1', 'https://example.net/news/2']);
  expect(s.patches.find(x => x.id === N2 && 'body_state' in x.body).body).toMatchObject({ body: 'News 리드 문단.', body_state: 'paywall' });
});

test('글 보기 [원문 다시 가져오기] 폰 폭: 단추가 줄 안에 보이고 누르면 본문, 가로 넘침 없음', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await openHome(page);
  const LEAD = 'a6800000-0000-4000-8000-000000000401';
  const s = await server(page, { extra: [{ id: LEAD, workspace_id: 'w', url: 'https://example.net/lead/9', title: '앞부분만 받은 글 폰', site: 'example.net', saved_at: '2026-11-12T09:00:00Z', read_at: null,
    body_state: 'paywall', body_at: '2026-11-23T06:00:00+09:00', business_area_id: null, updated_at: '2026-11-23T06:00:00+09:00', body: '공개 리드 문단만 있어요.', origin: 'direct', news_article_id: null, outside_article_id: null }] });
  await goReading(page, 412);
  await list(page).locator(`.rd-row[data-rd-open="${LEAD}"]`).click();
  const again = detail(page).locator('.rd-line [data-rd-fetch]');
  await expect(again).toBeVisible();
  // 글 보기 칸이 밀려 들어오는 동안은 위치가 바뀐다 — 자리 잡은 뒤의 오른쪽 끝을 본다.
  await expect.poll(async () => { const b = await again.boundingBox(); return b ? b.x + b.width : 9999; }).toBeLessThanOrEqual(412);
  await again.click();
  await expect(detail(page).locator('[data-rd-prose]')).toContainText('받아 온 본문');
  expect(s.imports.length).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// S69-98 NOTE-에버노트 ⑤: 글 보기 [노트로 만들기] — 원문 사본·출처 주소·저장 시각을 새 노트 한 장으로(기존 노트 만들기 길, 내 작업공간 열쇠),
// 원래 주소는 노트 원문 정보(metadata.source)에도. 읽을 거리 줄은 그대로(지우거나 바꾸지 않음), 누르는 동안은 한 번만.
for (const [label, width] of [['phone-390', 390], ['pc-1280', 1280]]) {
  test(`[노트로 만들기]: 원문·출처·저장 시각을 노트로 복사, 줄은 그대로 (${label})`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 860 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page);
    const s = await server(page);
    await goReading(page, width);
    await list(page).locator(`.rd-row[data-rd-open="${A}"]`).click();
    await expect(detail(page).locator('[data-rd-prose] p')).toHaveCount(3);
    const make = detail(page).locator(`[data-rd-make-note="${A}"]`);
    await expect(make).toHaveText('노트로 만들기');
    await expect(make).toBeEnabled();
    const before = s.patches.length;
    s.noteDelay = 800;
    await make.click();
    // 만드는 동안은 단추가 잠겨 두 번 눌러도 한 장.
    await expect(make).toHaveText('만드는 중…');
    await expect(make).toBeDisabled();
    await make.click({ force: true, timeout: 500 }).catch(() => {});
    await expect.poll(() => noticeText(page)).toContain('노트로 만들었어요');
    expect(s.notes).toHaveLength(1);
    const n = s.notes[0];
    expect(n.workspace_id).toBe('w');
    expect(n.kind).toBe('note');
    expect(n.title).toBe('예시 기사 하나');
    expect(n.raw_text).toContain('첫 문단은 배경이에요.');
    expect(n.raw_text).toContain(QUOTE);
    expect(n.raw_text).toContain('출처: example.com · https://example.com/a');
    expect(n.raw_text).toContain('저장: 2026-11-22 10:00');
    expect(n.metadata.source).toMatchObject({ url: 'https://example.com/a', state: 'ok', site: 'example.com' });
    await expect(page.locator('#kptuNotice:not([hidden])').getByRole('button', { name: '열기' })).toBeVisible();
    // 읽을 거리 줄은 그대로: 지우기·고치기 요청 없음(열면 읽음 저장 한 번 말고는).
    expect(s.patches.length).toBe(before);
    expect(s.calls.some(c => c.method === 'DELETE')).toBe(false);
    await expect(detail(page).locator('a.rd-src')).toHaveAttribute('href', 'https://example.com/a');
    await expect(make).toHaveText('노트로 만들기');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(over).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
