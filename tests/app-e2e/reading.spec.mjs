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

async function server(page, { refuseRead = false } = {}) {
  const s = {
    rows: [
      { id: A, workspace_id: 'w', url: 'https://example.com/a', title: '예시 기사 하나', site: 'example.com', saved_at: '2026-11-22T01:00:00Z', read_at: null, body_state: 'ok', body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T01:00:10Z', body: BODY },
      { id: B, workspace_id: 'w', url: 'https://example.org/b', title: '예시 칼럼 둘', site: 'example.org', saved_at: '2026-11-21T01:00:00Z', read_at: '2026-11-21T02:00:00Z', body_state: 'bot_check', body_at: '2026-11-21T01:00:10Z', business_area_id: null, updated_at: '2026-11-21T02:00:00Z', body: null },
    ],
    calls: [], posts: [], patches: [], imports: [], hl: [], hlPosts: [], notes: [],
  };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/note-import') {
      s.imports.push(body);
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
    if (table === 'app_news_highlights') {
      if (method === 'POST') { const row = { ...body, id: 'b6800000-0000-4000-8000-00000000000' + (s.hl.length + 1), created_at: '2026-11-22T04:00:00Z', updated_at: '2026-11-22T04:00:00Z' }; s.hlPosts.push(body); s.hl.unshift(row); return ok([row], 201); }
      return ok(s.hl);
    }
    if (table === 'app_notes' && method === 'POST') { s.notes.push(body); return ok([{ id: 'c6800000-0000-4000-8000-000000000001', kind: 'note', title: body.title, raw_text: body.raw_text, metadata: body.metadata || {}, created_at: '2026-11-22T04:00:00Z', updated_at: '2026-11-22T04:00:00Z', archived_at: null }], 201); }
    return route.fallback();
  });
  return s;
}

async function goReading(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
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
    // 처음은 [안 읽음]: 안 읽은 줄 하나. 칩은 [안 읽음 1][전체][밑줄] 셋뿐 — News 기능이 있는 계정(기본 운영자 흉내)도 [News] 칩 없음(S68-29).
    await expect(list(page).locator('.rd-chips [data-filter-value]')).toHaveText(['안 읽음 1', '전체', '밑줄']);
    await expect(list(page).locator('.rd-row')).toHaveCount(1);
    await expect(list(page).locator('.rd-row').first()).toContainText('예시 기사 하나');
    await expect(list(page).locator('.rd-row').first()).toContainText('example.com · 11/22');
    await expect(list(page).locator('.rd-row.is-unread .rd-dot')).toHaveCount(1);
    await list(page).locator('.rd-chips [data-filter-value="all"]').click();
    await expect(list(page).locator('.rd-row')).toHaveCount(2);
    // 요청은 모두 내 작업공간 열쇠로만(서버 RLS가 owner를 다시 본다).
    expect(s.calls.every(c => c.search.includes('workspace_id=eq.w'))).toBe(true);

    // 글 보기: 원문 사본(글자로만), 원래 페이지 링크, 밑줄 줄.
    await list(page).locator(`.rd-row[data-rd-open="${A}"]`).click();
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

    // [읽음] → 읽은 시각만 고친다.
    await detail(page).locator('[data-rd-read="1"]').click();
    await expect.poll(() => s.patches.length).toBe(1);
    expect(Object.keys(s.patches[0].body).sort()).toEqual(['read_at', 'updated_at']);
    await expect(detail(page).locator('[data-rd-read="0"]')).toHaveText('안 읽음으로');

    // 폰: 뒤로 = 목록(다른 화면으로 가지 않음).
    if (width <= 760) {
      await page.goBack();
      await expect(detail(page)).toBeHidden();
      await expect(list(page)).toBeVisible();
      await expect(page.locator('#readingView')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test('[+ 추가]: 주소 → 넣기 → note-import로 원문을 받아 글자로만 저장, 막힌 줄은 한 줄 상태와 원래 페이지 링크', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page);
  const s = await server(page);
  await goReading(page, 1280);
  await list(page).locator('[data-rd-add]').click();
  await list(page).locator('input.rd-url').fill('javascript:alert(1)');
  await list(page).getByRole('button', { name: '저장' }).click();
  await expect(list(page).locator('.rd-bad')).toContainText('가져올 수 없어요');
  expect(s.posts).toEqual([]);
  await list(page).locator('input.rd-url').fill('example.net/new');
  await list(page).getByRole('button', { name: '저장' }).click();
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
  await expect.poll(() => noticeText(page)).toContain('읽을 거리에 넣었어요');
  // 원문은 글자로만: <b>가 꾸밈이 아니라 글자로 보인다.
  await list(page).locator(`.rd-row[data-rd-open="${NEW}"]`).click();
  await expect(detail(page).locator('[data-rd-prose] p').nth(1)).toHaveText('받아 온 본문 <b>글자</b>예요.');
  await expect(detail(page).locator('[data-rd-prose] b')).toHaveCount(0);
  // 막힌 줄: 한 줄 상태 + [다시], 원래 페이지 링크는 그대로.
  await list(page).locator('.rd-chips [data-filter-value="all"]').click();
  await list(page).locator(`.rd-row[data-rd-open="${B}"]`).click();
  await expect(detail(page).locator('.rd-line')).toContainText('읽기를 막아');
  await expect(detail(page).locator('a.rd-src')).toHaveAttribute('href', 'https://example.org/b');
  // 우클릭(PC): 줄의 ⋯ 메뉴가 열린다(공통 context-menu.js).
  await list(page).locator(`.rd-row[data-rd-open="${A}"] .rd-nm`).click({ button: 'right' });
  await expect(page.locator('#rdRowMenu')).toBeVisible();
  await expect(page.locator('#rdRowMenu button')).toHaveText(['읽음', '사업에 연결', '삭제']);
});

test('남의 작업공간 줄: 서버가 거절하면 바꾸지 않고 한 줄 알림(화면이 다른 작업공간 열쇠를 보내지 않음)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page);
  const s = await server(page, { refuseRead: true });
  await goReading(page, 1280);
  await list(page).locator(`.rd-row[data-rd-open="${A}"]`).click();
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
