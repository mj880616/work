import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { mkdirSync } from 'node:fs';

// S69-09 (명진 11/24 07:46 "노트보드 쪽에 글상자랑 더하기버튼 버튼 전체 여기 뭔가 겹쳐져 있고 잘려져 있는 느낌"):
// 보드 판 오른쪽 위 단추 묶음 [+ 글 상자][－][＋][전체](S69-33부터 [맞추기]). 원인: 공용 .icon-btn 고정 폭(32px)이 그대로 남아 [+ 글 상자](글자 약 56px)가
// 32px 칸을 넘쳐 옆 [－]를 덮고, [－]의 왼쪽 구분선이 '글'과 '상자' 사이를 가로질렀다. 단추 폭을 글자에 맞추고(줄바꿈 없음),
// 누르는 자리(높이 44px)는 이웃 단추끼리 겹치지 않게 했다. 폰 390·412, 폴드 펼침 884, PC 1280에서 잰다. 이름은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOTS = 'test-results/ui-audit/note-board-tools';

async function openEmptyBoard(page, width) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // S69-83: [전체]가 없으므로 보드가 없으면 판·도구 줄 대신 빈 안내 — 빈 보드 하나를 열어 잰다.
  await installViewPrefsServer(page, { note_view: 'board', note_boards: [{ id: 'btools01', name: '빈 보드' }], note_board: 'btools01' });
  await openHome(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-note-board] .nb-tools')).toBeVisible();
  return errors;
}

// 묶음·단추·글자·누르는 자리(::after)를 화면 좌표로 잰다.
const measure = page => page.evaluate(() => {
  const box = document.querySelector('[data-note-board]');
  const tools = box.querySelector('.nb-tools'), scroll = box.querySelector('[data-nb-scroll]');
  const rect = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const buttons = [...tools.querySelectorAll('button')].filter(btn => !btn.hidden).map(btn => {
    const range = document.createRange(); range.selectNodeContents(btn);
    const text = range.getBoundingClientRect(), own = rect(btn), after = getComputedStyle(btn, '::after');
    const left = own.l + parseFloat(after.left), right = own.r - parseFloat(after.right);
    const cx = (own.l + own.r) / 2, cy = (own.t + own.b) / 2;
    return { label: btn.getAttribute('aria-label') || btn.textContent.trim(), own, text: { l: text.left, r: text.right },
      hit: { l: left, r: right, h: parseFloat(after.height) }, top: document.elementFromPoint(cx, cy)?.closest('button') === btn,
      wraps: text.height > own.h };
  });
  return { tools: rect(tools), scroll: rect(scroll), buttons };
});

for (const width of [390, 412, 884, 1280]) {
  test(`보드 단추 묶음: 겹침·잘림 없이 열 단추가 다 보이고 판 안쪽에 있다 (${width})`, async ({ page }) => {
    const errors = await openEmptyBoard(page, width);
    const m = await measure(page);
    // S69-33: [－] [100% ▾] [＋] 가운데 비율 글자, [전체] → [맞추기], 끝에 [전체 화면]. [노트 목록]은 전체 화면 안에서만 보인다.
    // S69-91: [+ 주제] 옆에 [글자]·[도형▾]·[선▾](넣기). 좁은 폰에서도 한 줄·겹침 없이. S70-32 ②: 그 옆 [이미지].
    expect(m.buttons.map(b => b.label)).toEqual(['+ 상자', '글자', '도형▾', '선▾', '이미지 넣기', '작게', '보드 비율 100% · 누르면 비율 선택', '크게', '맞추기 — 카드가 모두 보이게', '전체 화면']);
    // 묶음은 판 테두리 안쪽 여백(4px 이상)을 지킨다.
    expect(m.tools.l - m.scroll.l).toBeGreaterThanOrEqual(4);
    expect(m.scroll.r - m.tools.r).toBeGreaterThanOrEqual(4);
    expect(m.tools.t - m.scroll.t).toBeGreaterThanOrEqual(4);
    for (const [i, b] of m.buttons.entries()) {
      // 단추는 묶음 안에, 글자는 단추 안에(넘쳐서 이웃을 덮지 않음), 한 줄.
      expect(b.own.l).toBeGreaterThanOrEqual(m.tools.l - 0.5);
      expect(b.own.r).toBeLessThanOrEqual(m.tools.r + 0.5);
      expect(b.text.l).toBeGreaterThanOrEqual(b.own.l - 0.5);
      expect(b.text.r).toBeLessThanOrEqual(b.own.r + 0.5);
      expect(b.wraps).toBe(false);
      // 보이는 크기는 작은 단추(높이 28px 이상·폭 28px 이상), 누르는 자리 높이는 44px.
      expect(b.own.w).toBeGreaterThanOrEqual(28);
      expect(b.own.h).toBeGreaterThanOrEqual(28);
      expect(b.hit.h).toBeGreaterThanOrEqual(44);
      expect(b.hit.r - b.hit.l).toBeGreaterThanOrEqual(28);
      // 가운데를 누르면 그 단추가 받는다(다른 단추·글자에 가리지 않음).
      expect(b.top, `${b.label} 가운데가 가려짐`).toBe(true);
      // 이웃 단추와 사각형 교차 0, 누르는 자리도 교차 0.
      const next = m.buttons[i + 1];
      if (next) {
        expect(b.own.r).toBeLessThanOrEqual(next.own.l + 0.5);
        expect(b.hit.r).toBeLessThanOrEqual(next.hit.l + 0.5);
      }
    }
    // [－]·[＋]가 실제로 눌린다(가려져 있지 않음).
    const zoom = () => page.locator('[data-note-board]').getAttribute('data-nb-zoom-now').then(Number);
    const before = await zoom();
    await page.locator('[data-note-board] [data-nb-zoom="-1"]').click();
    await expect.poll(zoom).toBeLessThan(before);
    await page.locator('[data-note-board] [data-nb-zoom="1"]').click();
    await expect.poll(zoom).toBeCloseTo(before, 2);
    mkdirSync(SHOTS, { recursive: true });
    const t = await page.locator('[data-note-board] .nb-tools').boundingBox();
    await page.screenshot({ path: `${SHOTS}/${width}.png`, clip: { x: Math.max(0, t.x - 24), y: Math.max(0, t.y - 16), width: Math.min(width - Math.max(0, t.x - 24), t.width + 48), height: t.height + 32 } });
    expect(errors).toEqual([]);
  });
}
