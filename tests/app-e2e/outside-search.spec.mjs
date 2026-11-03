import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S48-18 사회운동 Now [문장 찾기](docs/design/outside-statements.md 3.3·4·5절): 탭 줄 [새로 온 것]·[문장 찾기](폰은 좌우 밀기),
// 찾기 칸 + 기간·단체·[비슷한 말]·[내 성명], 결과 문장 칠하기·앞뒤 문장·'비슷한 말' 꼬리표·[원문], [초안에 쓰기] → 성명 초안 '바깥 문장'(글 id + 문장 번호만 보냄).
// 서버는 흉내 낸다(시계 2026-10-06 10:00 서울, home-entry.mjs). 글은 모두 가상의 글.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CATALOG = [
  { key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' },
  { key: 'laborparty', name: '노동당', group: 'party', lang: 'ko' },
];
const P1 = 'f0000000-0000-4000-8000-000000000001', P2 = 'f0000000-0000-4000-8000-000000000002';
const DOC = 'd0000000-0000-4000-8000-000000000001', DOC2 = 'd0000000-0000-4000-8000-000000000002';
const HITS = [
  { post_id: P1, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '[성명] 가상 구조조정 중단하라', url: 'https://nodong.org/statement/101', published_at: '2026-10-05T00:30:00Z',
    idx: 1, sentence: '정부는 가상 구조조정을 즉각 중단하라.', prev_sentence: '앞 문장이다.', next_sentence: '뒤 문장이다.', matched: '구조조정', is_similar: false },
  { post_id: P2, source_key: 'laborparty', kind: 'comment', lang: 'ko', title: '[논평] 가상 논평', url: 'https://laborparty.kr/?uid=7', published_at: null,
    idx: 0, sentence: '<b>인력 감축</b>은 안전을 무너뜨린다.', prev_sentence: null, next_sentence: null, matched: '인력 감축', is_similar: true },
];

async function server(page) {
  const s = { calls: [], expand: 0 };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/outside-feed') {
      const action = u.searchParams.get('action');
      s.calls.push({ what: 'edge', action, body });
      if (action === 'catalog') return ok({ ok: true, sources: CATALOG });
      if (action === 'expand') { s.expand++; return ok({ ok: true, terms: ['인력 감축', '구조조정', '정원 축소'] }); }
      return ok({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
    }
    if (p === '/functions/v1/ai-assist' && body?.kind === 'press_draft') {
      s.calls.push({ what: 'press', body });
      return ok({ ok: true, kind: 'press_draft', type: 'statement', title: '가상 초안 제목', subtitle: '', partial: false,
        paragraphs: [{ text: '민주노총은 "정부는 가상 구조조정을 즉각 중단하라"고 밝혔다.', refs: [1] }], demands: [], checks: ['인용 출처 확인: 민주노총 · 가상 · 10.5'],
        sources: [{ ref: 1, post_id: P1, idx: 1, title: '바깥 인용 · 민주노총 · [성명] 가상 구조조정 중단하라', day: '2026-10-05' }] });
    }
    if (p === '/rest/v1/rpc/app_outside_search') { s.calls.push({ what: 'search', body }); return ok(body.p_offset ? [] : HITS); }
    if (p === '/rest/v1/rpc/app_search_records') {
      s.calls.push({ what: 'records', body });
      return ok({ groups: [{ kind: 'document', total: 2, items: [
        { kind: 'document', source: 'document', id: DOC, title: '우리 가상 성명', snippet: '구조조정 반대 성명', occurred_at: '2026-09-01T00:00:00Z' },
        { kind: 'document', source: 'document', id: DOC2, title: '가상 회의자료', snippet: '구조조정 회의', occurred_at: null }] }] });
    }
    if (p === '/rest/v1/app_documents' && /^in\./.test(u.searchParams.get('id') || '')) {
      s.calls.push({ what: 'doc-cats', query: decodeURIComponent(u.search) });
      return ok([{ id: DOC, category: '성명·보도자료' }, { id: DOC2, category: '회의' }]);
    }
    if (p === '/rest/v1/app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }, { source_key: 'laborparty', enabled: true, last_ok_at: null, last_error: null }]);
    if (p === '/rest/v1/app_outside_seen') return ok(method === 'PATCH' ? [{ seen_at: body.seen_at }] : [{ seen_at: '2026-10-05T00:00:00Z' }]);
    if (p === '/rest/v1/app_outside_posts') return ok([]);
    return route.fallback();
  });
  return s;
}

for (const width of [412, 1280]) {
  test(`사회운동 Now [문장 찾기] ${width}: 탭·거르기·칠하기·내 성명·초안에 쓰기`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await openHome(page);
    const s = await server(page);
    if (width <= 760) {
      await page.locator('#mobileMenuTab').click();
      await page.locator('#mobileMenu nav button:visible', { hasText: 'Now' }).click();
    } else await page.locator('#appView>.app-nav').getByRole('button', { name: 'Now', exact: true }).click();
    const root = page.locator('#outsideRoot');
    await expect(root.getByRole('tab', { name: '사회운동' })).toHaveAttribute('aria-selected', 'true');
    await expect(root.locator('[data-os-search]')).toBeHidden();

    // 탭 [문장 찾기]: [새로 온 것] 칸은 감추고 찾기 칸만. 찾기 전에는 서버를 부르지 않는다.
    await root.getByRole('tab', { name: '문장 찾기' }).click();
    await expect(root.getByRole('tab', { name: '문장 찾기' })).toHaveAttribute('aria-selected', 'true');
    await expect(root.locator('[data-os-panel-new]')).toBeHidden();
    const box = root.locator('[data-os-search]');
    await expect(box.locator('[data-osq-empty="start"]')).toHaveCount(0); // 안내 문구는 입력칸 흐린 글자와 같아 뺐다
    await expect(box.locator('[data-osq-input]')).toHaveAttribute('placeholder', '찾을 낱말·문장');
    await expect(box.locator('[data-osq-period]')).toHaveText(['1달', '6달', '1년', '전체', '날짜']);
    await expect(box.locator('[data-osq-chip]')).toHaveText(['전체', '노동', '정당']);
    expect(s.calls.filter(c => c.what === 'search')).toHaveLength(0);

    await box.locator('[data-osq-input]').fill('구조조정');
    await box.locator('[data-osq-input]').press('Enter');
    // 비슷한 말(서버 expand, 원래 말 빼고) + 원래 말로 찾는다. 기간 '전체' = 기간 없음.
    await expect(box.locator('.osq-outside .osq-hit')).toHaveCount(2);
    expect(s.calls.find(c => c.action === 'expand').body).toEqual({ query: '구조조정' });
    expect(s.calls.filter(c => c.what === 'search').at(-1).body).toEqual({ p_query: '구조조정', p_terms: ['인력 감축', '정원 축소'], p_sources: null, p_from: null, p_to: null, p_limit: 31, p_offset: 0 });
    await expect(box.locator('[data-osq-note]')).toHaveText('비슷한 말: 인력 감축 · 정원 축소');
    // 결과: 찾은 말 칠하기, 앞뒤 문장 흐리게, '단체 · 종류 · 제목 · 날짜 · [원문]', 비슷한 말 꼬리표, 바깥 글은 글자로만.
    const h1 = box.locator(`[data-osq-hit="${P1}:1"]`), h2 = box.locator(`[data-osq-hit="${P2}:0"]`);
    await expect(h1.locator('mark.osq-mark:not(.is-sim)')).toHaveText('구조조정');
    await expect(h1.locator('.osq-near')).toHaveText(['앞 문장이다.', '뒤 문장이다.']);
    await expect(h1.locator('.osq-foot')).toContainText('민주노총 · 성명 · [성명] 가상 구조조정 중단하라 · 26.10.05');
    await expect(h1.getByRole('link', { name: /원문/ })).toHaveAttribute('href', 'https://nodong.org/statement/101');
    await expect(h2.locator('mark.osq-mark.is-sim')).toHaveText('인력 감축');
    await expect(h2.locator('b')).toHaveCount(0);
    await expect(h2.locator('.osq-sim-tag')).toHaveText('비슷한 말: 인력 감축');
    await expect(h2.locator('.osq-foot')).toContainText('날짜 모름');
    // 내 성명: 자료실 찾기(종류 document)에서 분류 '성명·보도자료'만.
    await expect(box.locator('.osq-mine .osq-hit')).toHaveCount(1);
    await expect(box.locator('.osq-mine [data-osq-doc]')).toHaveText('우리 가상 성명');
    expect(s.calls.find(c => c.what === 'records').body).toEqual({ p_query: '구조조정', p_kinds: null, p_per_kind: 50, p_offset: 0, p_kind: 'document' });
    expect(s.calls.find(c => c.what === 'doc-cats').query).toContain('workspace_id=eq.w');

    // 거르기: 기간 1달(게시 날짜 기준 서울 9.6부터), 단체 묶음 '정당' → 그 묶음 단체만. 비슷한 말은 다시 부르지 않는다.
    await box.locator('[data-osq-period="1m"]').click();
    await expect.poll(() => s.calls.filter(c => c.what === 'search').at(-1).body.p_from).toBe('2026-09-06');
    await box.locator('[data-osq-chip="g:party"]').click();
    await expect.poll(() => s.calls.filter(c => c.what === 'search').at(-1).body.p_sources).toEqual(['laborparty']);
    expect(s.expand).toBe(1);
    // 날짜 고르기: 달력 칸 두 개.
    await box.locator('[data-osq-period="pick"]').click();
    await expect(box.locator('input[type="date"]')).toHaveCount(2);
    await box.locator('[data-osq-period="all"]').click();
    await box.locator('[data-osq-chip="all"]').click();
    await expect(box.locator('.osq-outside .osq-hit')).toHaveCount(2);

    // [초안에 쓰기] → '초안에 쓸 문장 1/5' 줄 → [성명 초안 열기] → '바깥 문장' 칸(체크됨) → 초안 요청은 글 id + 문장 번호만.
    await h1.locator('[data-osq-quote]').click();
    await expect(h1.locator('[data-osq-quote]')).toHaveAttribute('aria-pressed', 'true');
    await expect(box.locator('[data-osq-tray]')).toContainText('초안에 쓸 문장 1/5');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await box.locator('[data-osq-draft]').click();
    const dialog = page.locator('#pressDraftDialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-pd-quotes]')).toHaveAttribute('open', '');
    await expect(dialog.locator('[data-pd-quote]')).toBeChecked();
    await expect(dialog.locator('.pd-quote')).toContainText('정부는 가상 구조조정을 즉각 중단하라.');
    await dialog.locator('[data-pd-make]').click();
    await expect(dialog.locator('[data-pd-doc-title]')).toHaveText('가상 초안 제목');
    expect(s.calls.find(c => c.what === 'press').body).toEqual({ kind: 'press_draft', type: 'statement', meeting_ids: [], quotes: [{ post_id: P1, idx: 1 }] });
    await expect(dialog.locator('.pd-sources li')).toHaveText(['바깥 인용 · 민주노총 · [성명] 가상 구조조정 중단하라 · 10.5']);
    await dialog.locator('[data-pd-close]').click();

    // 폰은 좌우 밀기로 탭 이동(오른쪽으로 밀면 바로 앞 탭 [보관], S48-27 Now 탭 넷). PC는 화살표 키.
    if (width <= 760) {
      await box.locator('.osq-outside .osq-head').evaluate(el => {
        const t = (type, x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 });
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t('touchstart', 60)], changedTouches: [t('touchstart', 60)] }));
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t('touchend', 300)] }));
      });
    } else {
      await root.getByRole('tab', { name: '문장 찾기' }).focus();
      await page.keyboard.press('ArrowLeft');
    }
    await expect(root.getByRole('tab', { name: '보관' })).toHaveAttribute('aria-selected', 'true');
    await expect(box).toBeHidden();
    // 다시 [문장 찾기]로 오면 찾은 것·고른 문장이 그대로(이 탭 메모리).
    await root.getByRole('tab', { name: '문장 찾기' }).click();
    await expect(box.locator('[data-osq-input]')).toHaveValue('구조조정');
    await expect(h1.locator('[data-osq-quote]')).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });
}
