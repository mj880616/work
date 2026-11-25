// S70-16 고른 글 막대 시험 도움(브리핑 룸 가짜 서버 + 글 고르기·가림 재기). select-bar-highlight.spec.mjs·standard-interactions.spec.mjs가 함께 쓴다.
// 자료 이름·문장은 모두 예시. 서버는 흉내(표 읽기는 owner RLS REST).
import { expect } from '@playwright/test';
import { openHome } from './home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
export const DOC = 'd0000000-0000-4000-8000-000000000003';
export const NAME = '예시 도시철도 통합 연구';
export const LINE1 = '예시 기관: 통합 운영 기준을 연내 마련';
export const LINE2 = '예시 노선 운영 인력 재배치 계획 설명';
const brief3 = {
  v: 3, lead: '통합 운영 기준을 연내 마련하기로 함.',
  gist: ['통합 운영 기준을 연내 마련하기로 함.', '인력 재배치는 다음 회의에서 다시 봄.'],
  sections: [
    { title: '안건 1. 통합 운영', items: [{ text: LINE1, page: 12 }, { text: '예시 위원: 예산 재검토 요구', page: null }] },
    { title: '안건 2. 인력', items: [{ text: LINE2, page: 33 }, { text: '예시 위원: 다음 회의에서 다시 보기로', page: null }] },
  ],
  quotes: [],
};

export async function openBriefRoom(page) {
  const s = { hl: [], posts: [], patches: [], deletes: 0, notes: [] };
  await openHome(page, {
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: [{ id: 'b3', document_id: DOC, status: 'done', stage: 'done', step_no: 9, step_total: 9, page_count: 96, brief: brief3, error_code: null, created_at: '2026-11-24T00:00:00Z', updated_at: '2026-11-24T00:10:00Z', finished_at: '2026-11-24T00:10:00Z' }] }));
      await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'f-brief' }] : [] }));
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ document_id: DOC }] : [] }));
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        if (r.request().method() !== 'GET') return r.fallback();
        return new URL(r.request().url()).searchParams.get('id')?.startsWith('in.') ? r.fulfill({ json: [{ id: DOC, title: NAME, file_name: '예시 연구.pdf', mime_type: 'application/pdf', file_id: 'FILE_cccccccccc', created_at: '2026-11-24T00:00:00Z' }] }) : r.fallback();
      });
      let n = 0, clock = 0;
      const stamp = () => new Date(Date.UTC(2026, 10, 25, 1, 0, ++clock)).toISOString();
      await page.route(SB + '/rest/v1/app_news_highlights**', r => {
        const req = r.request(), m = req.method(), id = (new URL(req.url()).searchParams.get('id') || '').replace(/^eq\./, '');
        if (m === 'POST') {
          const body = req.postDataJSON(), at = stamp();
          const row = { mark_kind: null, mark_color: null, ...body, id: `e0000000-0000-4000-8000-00000000000${++n}`, created_at: at, updated_at: at };
          s.posts.push(body); s.hl.unshift(row);
          return r.fulfill({ status: 201, json: [row] });
        }
        if (m === 'PATCH') {
          const body = req.postDataJSON(); s.patches.push(body);
          s.hl = s.hl.map(h => (h.id === id ? { ...h, ...body, updated_at: stamp() } : h));
          return r.fulfill({ json: s.hl.filter(h => h.id === id) });
        }
        if (m === 'DELETE') { s.deletes++; s.hl = s.hl.filter(h => h.id !== id); return r.fulfill({ status: 204, body: '' }); }
        return r.fulfill({ json: s.hl });
      });
      await page.route(SB + '/rest/v1/app_notes**', r => {
        const req = r.request();
        if (req.method() === 'POST') { const body = req.postDataJSON(); const row = { id: `f0000000-0000-4000-8000-00000000000${s.notes.length + 1}`, kind: 'note', created_at: '2026-11-25T00:00:00Z', updated_at: '2026-11-25T00:00:00Z', ...body }; s.notes.push(row); return r.fulfill({ status: 201, json: [row] }); }
        return r.fallback();
      });
    },
  });
  return s;
}
export const zone = page => page.locator('#briefView [data-br-detail] [data-br-zone]');
export const bar = page => page.locator('div[data-hl-bar]');
export async function openBrief(page) {
  await page.evaluate(() => window.KPTURouter.go('brief'));
  await expect(page.locator('#briefView .br-row')).toHaveCount(1);
  await page.locator('#briefView .br-row').first().click();
  await expect(zone(page).locator('.br-items li').first()).toContainText(LINE1);
}
// 글 a의 처음부터 글 b의 끝까지(두 문단) 고르기. 텍스트 마디 안 글자만.
export const pickSpan = (page, a, b) => page.evaluate(([a, b]) => {
  const z = document.querySelector('#briefView [data-br-detail] [data-br-zone]');
  const w = document.createTreeWalker(z, NodeFilter.SHOW_TEXT);
  let s = null, e = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!s && n.data.includes(a)) s = [n, n.data.indexOf(a)];
    if (n.data.includes(b)) e = [n, n.data.indexOf(b) + b.length];
  }
  if (!s || !e) return false;
  const r = document.createRange(); r.setStart(...s); r.setEnd(...e);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return true;
}, [a, b]);
// 고른 글 상자(첫 줄 위 ~ 마지막 줄 아래)를 위·아래 한 줄씩 넓힌 상자와 막대 상자가 겹치는가.
export const coversText = page => page.evaluate(() => {
  const sel = getSelection(), b = document.querySelector('div[data-hl-bar]').getBoundingClientRect();
  if (!sel.rangeCount) return 'no selection';
  const rs = [...sel.getRangeAt(0).getClientRects()].filter(x => x.width && x.height);
  const z = document.querySelector('#briefView [data-br-detail] [data-br-zone]');
  const lh = parseFloat(getComputedStyle(z).lineHeight) || 20;
  const top = Math.min(...rs.map(x => x.top)) - lh, bottom = Math.max(...rs.map(x => x.bottom)) + lh;
  const left = Math.min(...rs.map(x => x.left)), right = Math.max(...rs.map(x => x.right));
  return b.left < right && left < b.right && b.top < bottom && top < b.bottom;
});
// 글 a의 시작점과 글 b의 끝점(화면 좌표).
export const ends = (page, a, b) => page.evaluate(([a, b]) => {
  const z = document.querySelector('#briefView [data-br-detail] [data-br-zone]');
  const w = document.createTreeWalker(z, NodeFilter.SHOW_TEXT), out = {};
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const r = document.createRange();
    if (!out.a && n.data.includes(a)) { r.setStart(n, n.data.indexOf(a)); r.setEnd(n, n.data.indexOf(a) + 1); const x = r.getBoundingClientRect(); out.a = { x: x.left + 1, y: x.top + x.height / 2 }; }
    if (n.data.includes(b)) { const i = n.data.indexOf(b) + b.length; r.setStart(n, i - 1); r.setEnd(n, i); const x = r.getBoundingClientRect(); out.b = { x: x.right - 1, y: x.top + x.height / 2 }; }
  }
  return out;
}, [a, b]);
export const box = loc => loc.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });

