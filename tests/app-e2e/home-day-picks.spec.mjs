import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// HOME-하루채우기 ②·③ 화면 연결(PR-C, 2026-11-09 시안 ④): 홈 [하루] '읽을 만한 글'·'이런 기록은 어때요?'. 폰 390·폴드 884·PC 1440.
// 가짜 서버만 쓴다: ai-assist(kind=home_day_picks), 표 app_home_day_picks(읽기·suggests_done 고치기), 일기 app_notes(kind=diary).
// 시계: 2026-10-06 19:30 KST(저녁 — 기록 제안이 보이는 때). 그 주 일정 '오전 일정' 10:00~11:00(home-entry.mjs).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const WIDTHS = [[390, 844], [884, 1104], [1440, 900]];
const EVENING = '2026-10-06T10:30:00Z', MORNING = '2026-10-06T01:00:00Z';
const READS = [
  { id: 'n1', title: '가상지부 교섭 결렬', what: '가상지부 교섭이 결렬됨', why: '담당 가상지부', source: '가상신문', at: '2026-10-06T00:10:00Z', url: 'https://news.example.test/1' },
  { id: 'n2', title: '가상사업 예산 소식', what: '가상사업 예산이 늘어남', why: '사업영역 가상사업', source: '가상일보', at: '2026-10-05T03:00:00Z', url: 'https://news.example.test/2' },
  { id: 'n3', title: '이번 주 행사 기사', what: '행사 장소가 바뀜', why: '10.8 행사 일정', source: '가상뉴스', at: '2026-10-04T03:00:00Z', url: 'javascript:alert(1)' },
];
const SUGGESTS = [
  { id: 's1', text: '오늘 가상 교섭 준비 회의를 했다', basis: '회의: 가상 교섭 준비' },
  { id: 's2', text: '오늘 보도자료를 마무리했다', basis: '끝낸 할 일: 보도자료' },
];
const rowOf = (extra = {}) => ({ day: '2026-10-06', reads: READS, reads_at: '2026-10-06T10:00:00Z', suggests: SUGGESTS, suggests_at: '2026-10-06T10:00:00Z', suggests_done: [], ...extra });

async function boot(page, width, height, { now = EVENING, row = rowOf(), ai = null } = {}) {
  await page.setViewportSize({ width, height });
  const errors = [], asks = [], patches = [], notes = [];
  page.on('pageerror', e => errors.push(e.message));
  const state = { row: row ? structuredClone(row) : null };
  const beforeLoad = async () => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/ai-assist', async r => {
      let body = null; try { body = r.request().postDataJSON(); } catch { body = null; }
      if (body?.kind !== 'home_day_picks') return r.fallback();
      asks.push(body);
      if (ai) return ai(r, body);
      return r.fulfill({ json: { ok: true, kind: 'home_day_picks', day: body.day, picks: state.row || { reads: [], suggests: [], suggests_done: [] } } });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_home_day_picks', async r => {
      const req = r.request();
      if (req.method() === 'GET') return r.fulfill({ json: state.row ? [state.row] : [] });
      if (req.method() === 'PATCH') { const b = req.postDataJSON(); patches.push(b); state.row = { ...state.row, ...b }; return r.fulfill({ status: 204, body: '' }); }
      return r.fulfill({ status: 500, json: {} });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
      const req = r.request(), q = new URL(req.url()).searchParams;
      if (req.method() === 'POST') {
        const b = req.postDataJSON();
        if (b.kind !== 'diary') return r.fallback();
        const saved = { id: 'diary-1', title: null, archived_at: null, attachments: [], metadata: {}, occurred_at: EVENING, created_at: EVENING, updated_at: EVENING, ...b };
        notes.push(saved); return r.fulfill({ status: 201, json: [saved] });
      }
      if (req.method() === 'GET' && q.get('kind') === 'eq.diary') {
        const day = (q.get('journal_day') || '').replace(/^eq\./, '');
        return r.fulfill({ json: notes.filter(n => !day || n.journal_day === day) });
      }
      if (req.method() === 'PATCH' && notes.length) { const b = req.postDataJSON(); Object.assign(notes[0], b); return r.fulfill({ json: [notes[0]] }); }
      return r.fallback();
    });
  };
  await openHome(page, { beforeLoad, now });
  return { errors, asks, patches, notes, state };
}
const fill = page => page.locator('#journalRoot [data-journal-fill]');

for (const [width, height] of WIDTHS) {
  test(`${width}: 읽을 만한 글 2개 펼침·나머지 접음, 저녁 기록 제안 2개, 오늘 일정·끝낸 할 일만 서버에 보냄`, async ({ page }) => {
    const f = await boot(page, width, height);
    const reads = fill(page).locator('[data-journal-reads]'), suggests = fill(page).locator('[data-journal-suggests]');
    await expect(reads).toBeVisible();
    await expect(reads.locator('.journal-heading')).toHaveText('읽을 만한 글');
    await expect(reads.locator('.journal-head-count')).toHaveText('3');
    await expect(reads.locator('.journal-fill-note')).toHaveText('오늘 저녁 선택');
    await expect(reads.locator(':scope > .journal-reads-list > [data-journal-read]')).toHaveCount(2);
    const more = reads.locator('[data-journal-reads-more]');
    await expect(more.locator('summary')).toHaveText('1개 더');
    await expect(more).not.toHaveAttribute('open', '');
    const first = reads.locator('[data-journal-read="n1"]');
    await expect(first).toContainText('무슨 일: 가상지부 교섭이 결렬됨');
    await expect(first).toContainText('왜: 담당 가상지부');
    await expect(first.locator('[data-journal-read-link]')).toHaveAttribute('href', 'https://news.example.test/1');
    await expect(first.locator('[data-journal-read-link]')).toHaveAttribute('target', '_blank');
    await expect(reads.locator('[data-journal-read="n3"] [data-journal-read-link]')).toHaveCount(0); // https가 아닌 주소는 링크 없음
    await expect(suggests).toBeVisible();
    await expect(suggests.locator('.journal-heading')).toHaveText('이런 기록은 어때요?');
    await expect(suggests.locator('[data-journal-suggest]')).toHaveCount(2);
    await expect(suggests.locator('button.secondary[data-journal-suggest-write]')).toHaveCount(2);
    await expect.poll(() => f.asks.length).toBe(1);
    expect(f.asks[0].day).toBe('2026-10-06');
    expect(f.asks[0].events).toContainEqual({ day: '2026-10-06', start: '10:00', end: '11:00', title: '오전 일정' });
    expect(f.asks[0].events.every(e => e.day >= '2026-10-05' && e.day <= '2026-10-11')).toBe(true);
    expect(Array.isArray(f.asks[0].done)).toBe(true);
    const m = await page.evaluate(() => {
      const root = document.querySelector('#journalRoot'), done = root.querySelector('[data-journal-done-day]'), r = root.querySelector('[data-journal-reads]'), s = root.querySelector('[data-journal-suggests]');
      const btn = s.querySelector('[data-journal-suggest-write]').getBoundingClientRect(), box = s.getBoundingClientRect();
      return { order: !!(done.compareDocumentPosition(r) & 4) && !!(r.compareDocumentPosition(s) & 4), inside: btn.right <= box.right + 0.5 && btn.left >= box.left - 0.5, docW: document.documentElement.scrollWidth, vw: innerWidth };
    });
    expect(m.order).toBe(true);
    expect(m.inside).toBe(true);
    expect(m.docW).toBeLessThanOrEqual(m.vw);
    await more.locator('summary').click();
    await expect(reads.locator('[data-journal-read="n3"]')).toBeVisible();
    expect(f.errors).toEqual([]);
  });
}

test('[일기 쓰기]: 첫 줄이 채워진 일기 쓰기 창 → 저장하면 그 제안이 서버 표에서 사라짐(다른 제안은 그대로)', async ({ page }) => {
  const f = await boot(page, 390, 844);
  const suggests = fill(page).locator('[data-journal-suggests]');
  await expect(suggests.locator('[data-journal-suggest]')).toHaveCount(2);
  await suggests.locator('[data-journal-suggest-write="s1"]').click();
  const editor = page.locator('[data-diary-editor]');
  await expect(editor).toBeVisible();
  await expect(editor.locator('#diaryEditorTitle')).toHaveText('일기 쓰기');
  await expect(editor.locator('[data-diary-text]')).toContainText('오늘 가상 교섭 준비 회의를 했다');
  await editor.locator('[data-diary-save]').click();
  await expect.poll(() => f.notes.length).toBe(1);
  expect(f.notes[0].journal_day).toBe('2026-10-06');
  expect(f.notes[0].raw_text).toContain('오늘 가상 교섭 준비 회의를 했다');
  await expect.poll(() => f.patches.length).toBe(1);
  expect(f.patches[0]).toEqual({ suggests_done: ['s1'] });
  await page.evaluate(() => window.KPTURouter.go('home'));
  await expect(page.locator('#journalRoot')).toBeVisible();
  const left = fill(page).locator('[data-journal-suggests] [data-journal-suggest]');
  await expect(left).toHaveCount(1);
  await expect(left).toHaveAttribute('data-journal-suggest', 's2');
  expect(f.errors).toEqual([]);
});

test('아침에는 기록 제안이 안 보이고, 한도에 닿으면 칸 머리에 한도 알림 한 줄(칸을 조용히 비우지 않음)', async ({ page }) => {
  const f = await boot(page, 390, 844, { now: MORNING, row: null,
    ai: (r) => r.fulfill({ status: 429, json: { ok: false, error: 'monthly_limit', message: '이번 달 AI 한도에 닿았어요.' } }) });
  const reads = fill(page).locator('[data-journal-reads]');
  await expect(reads).toBeVisible();
  await expect(reads.locator('[data-journal-fill-limit]')).toHaveText('이번 달 AI 한도에 닿았어요.');
  await expect(reads.locator('[data-journal-read]')).toHaveCount(0);
  await expect(fill(page).locator('[data-journal-suggests]')).toBeHidden();
  expect(f.asks.length).toBe(1);
  expect(f.errors).toEqual([]);
});

test('고른 것이 없으면 두 칸 모두 안 보인다(빈 안내문 없음), 아침 기록 제안은 서버에 있어도 숨김', async ({ page }) => {
  const f = await boot(page, 390, 844, { now: MORNING, row: rowOf({ reads: [] }) });
  await expect.poll(() => f.asks.length).toBe(1);
  await expect(fill(page).locator('[data-journal-reads]')).toBeHidden();
  await expect(fill(page).locator('[data-journal-suggests]')).toBeHidden();
  await expect(fill(page).locator('text=읽을 만한 글')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
