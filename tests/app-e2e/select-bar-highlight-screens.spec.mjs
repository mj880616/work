// S70-80 READ-형광펜안됨(명진 2026-11-26 09:04 "형광펜은 정작 되지도 않는데", CC 확인: 읽을 거리 › 언론 기사 두 칸 보기에서 고른 글 막대에
// 형광펜 칸이 없고, 막대가 고른 글이 아니라 왼쪽 목록 칸 아래쪽에 뜸). #3038(S70-16)은 형광펜을 브리핑 룸에서만 켰다.
// 같은 공용 막대(text-select-bar.js)를 쓰는 글 보기 화면 전부를 아래 표 하나로 본다(PC 1280 두 칸 + 폰 390):
//  ① 글을 고르면 막대가 고른 글 바로 위·아래(한 줄 띄움)에 뜨고, 고른 글·앞뒤 줄을 가리지 않으며, PC 두 칸 보기에서 글 칸 밖(목록 칸)으로 나가지 않는다.
//  ② 막대에 [형광펜]·색 점 다섯·[밑줄 저장]·[복사].
//  ③ 색 점을 누르면 그 색으로 바로 칠해지고 서버 줄(mark_kind highlight·mark_color) 하나.
//  ④ 새로 불러와 다시 열어도 같은 색.
//  ⑤ 칠한 곳을 누르면 색 바꾸기(서버 mark_color만 고침)·[삭제](서버 줄 지움).
// 새 글 보기 화면이 이 막대를 쓰면 SCREENS에 한 줄 더한다. 글·이름은 모두 예시, 서버는 흉내(owner RLS REST).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { openSavedDoc, READ_ID } from './helpers/doc-view.mjs';
import { newsServer, openNews } from './helpers/news-server.mjs';
import { openBriefRoom, openBrief, LINE1 as BRIEF_LINE, DOC as BRIEF_DOC } from './helpers/select-text-bar.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const NOTE = 'd7080000-0000-4000-8000-000000000001', NEWS = 'a7080000-0000-4000-8000-000000000001';

// 밑줄·형광 표 흉내(app_news_highlights). 화면 서버보다 나중에 붙여 이 표만 맡는다.
async function hlStore(page) {
  const s = { hl: [], posts: [], patches: [], deletes: 0 };
  let n = 0, clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 26, 1, 0, ++clock)).toISOString();
  await page.route(SB + '/rest/v1/app_news_highlights**', r => {
    const req = r.request(), m = req.method(), id = (new URL(req.url()).searchParams.get('id') || '').replace(/^eq\./, '');
    if (m === 'POST') {
      const body = req.postDataJSON(), at = stamp();
      const row = { mark_kind: null, mark_color: null, ...body, id: `e7080000-0000-4000-8000-00000000000${++n}`, created_at: at, updated_at: at };
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
  return s;
}

// 노트 하나를 연 읽기 보기.
async function openNoteRead(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  const note = { id: NOTE, workspace_id: 'w', kind: 'note', title: '예시 노트 하나', raw_text: '첫 문단은 배경이에요.\n\n둘째 문단은 짚을 점이에요.', occurred_at: '2026-11-20T00:00:00Z', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} };
  await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/'), r => {
    const req = r.request(), u = new URL(req.url()), table = u.pathname.slice('/rest/v1/'.length), q = u.searchParams, id = (q.get('id') || '').replace(/^eq\./, '');
    if (table === 'app_notes' && req.method() === 'GET') return r.fulfill({ json: [note].filter(x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!id || x.id === id)).map(x => structuredClone(x)) });
    if (table === 'app_note_folders' || table === 'app_note_comments' || table === 'app_record_links') return r.fulfill({ json: [] });
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_reading_items') return req.method() === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 201, json: [] });
    return r.fallback();
  });
}
async function noteReopen(page) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const read = page.locator('#basketView [data-basket-read-text]');
  if (!(await read.isVisible())) await page.locator(`#basketView [data-note-row="${NOTE}"]`).first().click();
  await expect(read).toContainText('둘째 문단');
}

// [화면, 여는 함수(width) → {zone 선택자, 고를 글, 출처 종류, 다시 열기}]
const SCREENS = [
  // 명진이 본 자리: 읽을 거리 › [언론] 기사 글 보기(PC 두 칸). 흉내 서버의 첫 기사 id만 운영과 같은 UUID 모양으로 바꾼다(밑줄 표는 UUID만 받음).
  ['읽을 거리 글 보기', async (page, width) => {
    await page.setViewportSize({ width, height: 900 });
    await openHome(page);
    const srv = await newsServer(page);
    srv.items.find(i => i.id === 'c1').id = NEWS;
    const reopen = async () => {
      await openNews(page, width);
      await page.locator('#outsideRoot [data-nc-item]').first().click({ position: { x: 60, y: 12 } });
      await expect(page.locator('#outsideRoot [data-now-detail] [data-nd-prose]')).toBeVisible();
    };
    await reopen();
    const prose = page.locator('#outsideRoot [data-now-detail] [data-nd-prose]');
    // 새로 불러오면 폰은 글 보기 자리를 되살린다 — 이미 열렸으면 그대로, 읽을 거리면 첫 기사만 다시 연다.
    const again = async () => {
      await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
      await expect.poll(async () => (await prose.isVisible()) || (await page.locator('#outsideRoot [data-nc-item]').first().isVisible()) || (await page.locator('#homeView').isVisible())).toBe(true);
      if (await prose.isVisible()) return;
      if (!(await page.locator('#outsideView').isVisible())) return reopen();
      const tab = page.locator('#outsideRoot [data-os-tab="media"]');
      if (await tab.isVisible()) await tab.click();
      await page.locator('#outsideRoot [data-nc-item]').first().click({ position: { x: 60, y: 12 } });
      await expect(prose).toBeVisible();
    };
    return { zone: '#outsideRoot [data-now-detail] [data-nd-prose]', text: '본문 첫 문단', type: 'news', id: NEWS, reopen: again };
  }],
  ['저장한 글 글 보기', async (page, width) => {
    await openSavedDoc(page, width);
    return { zone: '#readingView [data-rd-detail] [data-rd-prose]', text: '짚을 점', type: 'reading', id: READ_ID,
      reopen: async () => {
        await page.evaluate(() => window.KPTURouter.go('reading'));
        const prose = page.locator('#readingView [data-rd-detail] [data-rd-prose]');
        if (!(await prose.isVisible())) await page.locator(`#readingView .rd-row[data-rd-open="${READ_ID}"]`).click();
      } };
  }],
  ['노트 글 보기', async (page, width) => {
    await openNoteRead(page, width);
    await noteReopen(page);
    return { zone: '#basketView [data-basket-read-text]', text: '짚을 점', type: 'note', id: NOTE, reopen: () => noteReopen(page) };
  }],
  ['브리핑 룸', async (page, width) => {
    await page.setViewportSize({ width, height: 900 });
    await openBriefRoom(page);
    await openBrief(page);
    return { zone: '#briefView [data-br-detail] [data-br-zone]', text: '통합 운영 기준', type: 'brief', id: BRIEF_DOC, reopen: () => openBrief(page) };
  }],
];

const bar = page => page.locator('div[data-hl-bar]');
const pick = (page, zone, t) => page.evaluate(([zone, t]) => {
  const z = document.querySelector(zone);
  const w = document.createTreeWalker(z, NodeFilter.SHOW_TEXT);
  let node; while ((node = w.nextNode()) && !node.data.includes(t));
  if (!node) return false;
  const i = node.data.indexOf(t), r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + t.length);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return true;
}, [zone, t]);
// 막대·고른 글·글 칸 상자(화면 좌표)와 글 한 줄 높이.
const boxes = (page, zone) => page.evaluate(zone => {
  const sel = getSelection(), z = document.querySelector(zone), b = document.querySelector('div[data-hl-bar]').getBoundingClientRect(), c = z.getBoundingClientRect();
  const rs = [...sel.getRangeAt(0).getClientRects()].filter(x => x.width && x.height);
  const s = { top: Math.min(...rs.map(x => x.top)), bottom: Math.max(...rs.map(x => x.bottom)), left: Math.min(...rs.map(x => x.left)), right: Math.max(...rs.map(x => x.right)) };
  return { bar: { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width }, sel: s, col: { left: c.left, right: c.right, w: c.width }, line: parseFloat(getComputedStyle(z).lineHeight) || 20, vw: document.documentElement.clientWidth };
}, zone);

for (const [screen, open] of SCREENS) {
  for (const [label, width] of [['phone-390', 390], ['pc-1280', 1280]]) {
    test(`형광펜·막대 자리 — ${screen} (${label})`, async ({ page }) => {
      test.setTimeout(120000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const sc = await open(page, width);
      const s = await hlStore(page);
      const zone = page.locator(sc.zone);
      await expect(zone).toContainText(sc.text);
      await zone.evaluate(el => el.scrollIntoView({ block: 'center' }));

      // ① 고른 글 바로 위·아래, 가리지 않음, PC 두 칸에서 글 칸 밖으로 안 나감.
      expect(await pick(page, sc.zone, sc.text)).toBe(true);
      await expect(bar(page)).toBeVisible();
      await expect(bar(page)).toHaveAttribute('data-anchor-side', /^(top|bottom)$/);
      const b = await boxes(page, sc.zone);
      const gapAbove = b.sel.top - b.bar.bottom, gapBelow = b.bar.top - b.sel.bottom;
      const near = (gapAbove >= b.line - 1 && gapAbove <= b.line + 2) || (gapBelow >= b.line - 1 && gapBelow <= b.line + 24 + 2);
      expect(near, `막대 ${JSON.stringify(b.bar)} 고른 글 ${JSON.stringify(b.sel)} 줄 ${b.line}`).toBe(true);
      expect(b.bar.left).toBeGreaterThanOrEqual(0);
      expect(b.bar.right).toBeLessThanOrEqual(b.vw + 1);
      if (width > 760 && b.bar.w <= b.col.w) {
        expect(b.bar.left).toBeGreaterThanOrEqual(b.col.left - 1);
        expect(b.bar.right).toBeLessThanOrEqual(b.col.right + 1);
      }

      // ② 형광펜 칸.
      await expect(bar(page).getByRole('button', { name: '형광펜', exact: true })).toBeVisible();
      await expect(bar(page).getByRole('button', { name: /^형광펜 (노랑|초록|파랑|분홍|주황)$/ })).toHaveCount(5);
      await expect(bar(page).getByRole('button', { name: '밑줄 저장', exact: true })).toBeVisible();
      await expect(bar(page).getByRole('button', { name: '복사', exact: true })).toBeVisible();
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${label}-${sc.type}-select.png` });

      // ③ 초록 → 바로 칠함 + 서버 줄.
      await bar(page).getByRole('button', { name: '형광펜 초록' }).click();
      await expect.poll(() => s.posts.length).toBe(1);
      expect(s.posts[0]).toMatchObject({ source_type: sc.type, mark_kind: 'highlight', mark_color: 'green', memo: null, quote: sc.text });
      if (sc.id) expect(s.posts[0].source_id).toBe(sc.id);
      const mark = zone.locator('mark.hl-mark.hl-pen');
      await expect(mark).toHaveText(sc.text);
      await expect(mark).toHaveClass(/hl-c-green/);
      expect(await mark.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${label}-${sc.type}-green.png` });

      // ④ 새로 불러와 다시 열어도 같은 색.
      await page.reload();
      await expect(page.locator('#appView')).toBeVisible();
      await sc.reopen();
      await expect(zone.locator('mark.hl-mark.hl-pen')).toHaveClass(/hl-c-green/);

      // ⑤ 칠한 곳을 누르면 색 바꾸기 → 파랑(서버는 색만).
      await zone.locator('mark.hl-mark.hl-pen').click();
      const menu = page.locator('#hlMarkMenu');
      await expect(menu.getByRole('button', { name: '파랑' })).toBeVisible();
      await menu.getByRole('button', { name: '파랑' }).click();
      await expect.poll(() => s.patches.length).toBe(1);
      expect(Object.keys(s.patches[0]).sort()).toEqual(['mark_color', 'updated_at']);
      expect(s.patches[0].mark_color).toBe('blue');
      await expect(zone.locator('mark.hl-mark.hl-pen')).toHaveClass(/hl-c-blue/);
      // [삭제] → 서버 줄 지움, 칠한 표시 사라짐.
      await page.keyboard.press('Escape');
      await zone.locator('mark.hl-mark.hl-pen').click();
      await menu.getByRole('button', { name: '삭제', exact: true }).click();
      await expect.poll(() => s.deletes).toBe(1);
      await expect(zone.locator('mark.hl-mark.hl-pen')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}
