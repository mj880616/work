// S70-40b READ-글보기머리: 두 '글 보기' 화면(저장한 글 글 보기·읽을 거리 글 상세)을 여는 공용 시험 도우미.
// reading-two-pane-top.spec.mjs·standard-interactions.spec.mjs(화면 표)가 같이 쓴다. 서버는 흉내, 글·주소는 모두 예시.
import { expect } from '@playwright/test';
import { openHome } from './home-entry.mjs';
import { newsServer, openNews } from './news-server.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
export const READ_ID = 'a7040b00-0000-4000-8000-000000000001';
const BODY = '첫 문단은 배경이에요.\n\n둘째 문단은 짚을 점이에요.\n\n셋째 문단은 정리예요.';

function errorsOf(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}
async function readingServer(page, rows) {
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_reading_items') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const pick = r => { const { workspace_id, body: b, ...rest } = r; return (u.searchParams.get('select') || '').includes('body') ? { ...rest, body: b } : rest; };
      if (method === 'PATCH') { const r = rows.find(x => x.id === id); if (r) Object.assign(r, req.postDataJSON?.() || {}); return ok(r ? [pick(r)] : []); }
      return ok((id ? rows.filter(x => x.id === id) : rows).map(pick));
    }
    if (table === 'app_news_highlights') return ok([]);
    return route.fallback();
  });
}
// 저장한 글: 글 하나를 연 상태. title을 길게 주면 제목 줄바꿈을 본다.
export async function openSavedDoc(page, width, { title = '예시 기사 하나', body = BODY, state = 'ok' } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = errorsOf(page);
  const { prefs } = await openHome(page);
  const rows = [{ id: READ_ID, workspace_id: 'w', url: 'https://example.com/a', title, site: 'example.com', saved_at: '2026-11-22T01:00:00Z', read_at: null, body_state: state, body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T01:00:10Z', body }];
  await readingServer(page, rows);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
  await page.locator(`#readingView .rd-row[data-rd-open="${READ_ID}"]`).click();
  const detail = page.locator('#readingView [data-rd-detail]');
  await expect(detail.locator('.ds-doc-top')).toBeVisible();
  return { errors, prefs, rows, detail, list: page.locator('#readingView [data-rd-list]'), firstLeft: page.locator('#readingView [data-rd-list] .rd-head') };
}
// 읽을 거리: [언론] 탭 첫 기사를 연 상태.
export async function openNewsDoc(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = errorsOf(page);
  const { prefs } = await openHome(page);
  await newsServer(page);
  await openNews(page, width);
  const first = page.locator('#outsideRoot [data-nc-item]').first();
  await expect(first).toBeVisible();
  await first.click({ position: { x: 60, y: 12 } });
  const detail = page.locator('#outsideRoot [data-now-detail] .nd');
  await expect(detail.locator('.ds-doc-top')).toBeVisible();
  return { errors, prefs, detail, firstLeft: page.locator('#outsideRoot [data-nw-top] [data-nw-find]') };
}
export const DOC_SCREENS = [['저장한 글 글 보기', openSavedDoc], ['읽을 거리 글 보기', openNewsDoc]];
// S70-58 READ-두칸보기: 두 글 보기 화면의 목록 | 글 칸(공용 split-resize.js). checkSplit(helpers/split-check.mjs)에 넘길 칸·서버 이름·기본 왼쪽 몫(폭별).
export const DOC_SPLITS = {
  '저장한 글 글 보기': { container: '#readingView .rd-wrap', left: '[data-rd-list]', right: '[data-rd-detail]', name: 'reading', share: () => 1 / 3, ready: page => expect(page.locator('#readingView [data-rd-detail] .ds-doc-title')).toBeVisible() },
  '읽을 거리 글 보기': { container: '#outsideRoot', left: '#nowMain', right: '[data-now-detail]', name: 'now', share: width => (width > 760 ? 0.6 : 0.4), ready: page => expect(page.locator('#outsideRoot')).toHaveAttribute('data-detail', 'open') },
};
