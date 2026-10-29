import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { noteField } from './helpers/note-editor.mjs';

// NOTE-최근5개 ③(명진 10/29 08:57): 폰 노트 첫 화면 '노트' 제목(위 머리줄)과 검색 칸 사이가 크게 비었다. 같은 빈 공간이 다른 메뉴 첫 화면에
// 다시 생기지 않게, 메뉴마다 위 머리줄 아래 끝 → 화면에서 처음 보이는 내용(글자·입력칸·버튼·그림·테두리 있는 칸)의 위 끝 거리를 잰다.
// 기준은 머리줄 아래 간격(12px) + 여유 6px. 폰 412·884(폴드 펼침), PC 1440은 노트 화면(최근 5개 포함)을 함께 본다. 가짜 자료만.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 기준: 머리줄 아래 12px + 여유. 할 일(28)·프로젝트(24)처럼 칸 안쪽 여백 정도는 넘기고, 노트(64)처럼 빈 띠 한 칸(44px 이상)이 끼면 실패.
const LIMIT = 30;
const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });

async function boot(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const rows = [
    row('n1', '가 노트', '2026-10-01T01:00:00Z', { folder_id: U(1), folder: '회의' }),
    row('n2', '나 노트', '2026-10-02T01:00:00Z', { folder_id: U(2), folder: '개발' }),
    row('n3', '다 노트', '2026-10-03T01:00:00Z'),
    row('n4', '라 노트', '2026-10-04T01:00:00Z', { folder_id: U(1), folder: '회의' }),
    row('n5', '마 노트', '2026-10-05T01:00:00Z', { folder_id: U(2), folder: '개발' }),
    row('n6', '바 노트', '2026-10-06T00:00:00Z', { folder_id: U(1), folder: '회의' }),
  ];
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }, { id: U(2), workspace_id: 'w', parent_id: null, name: '개발', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' }];
  const writes = [];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push(body); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: r.request().method() === 'GET' ? structuredClone(folders) : [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  return { errors, rows, writes };
}

// 위 머리줄(폰) 또는 화면 칸 위 끝(그 밖)에서 처음 보이는 내용까지의 거리. 위치가 고정된 것(아래에 붙은 입력칸·[+]·하단 탭)과 감춘 것은 뺀다.
async function topGap(page) {
  return page.evaluate(() => {
    const panel = [...document.querySelectorAll('#appView > .view-panel')].find(el => !el.classList.contains('hidden') && el.getClientRects().length);
    if (!panel) return { gap: null, what: 'no panel' };
    const head = document.querySelector('#appView > .mobile-shell-header');
    const headBox = head && getComputedStyle(head).display !== 'none' ? head.getBoundingClientRect() : null;
    const from = headBox ? headBox.bottom : panel.getBoundingClientRect().top;
    const name = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].join('.') : ''}`;
    const fixed = el => { for (let e = el; e && e !== panel; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed') return true; } return false; };
    const shows = el => {
      const s = getComputedStyle(el);
      if (s.visibility !== 'visible' || Number(s.opacity) === 0) return false;
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|IMG|SVG|CANVAS|VIDEO|IFRAME)$/i.test(el.tagName)) return true;
      if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return true;
      if (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none') return true;
      return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent' && s.backgroundColor !== getComputedStyle(panel).backgroundColor;
    };
    let best = null;
    for (const el of panel.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1 || b.bottom <= from - 2 || b.top >= innerHeight) continue;
      if (el.closest('.a11y-only, [hidden], .hidden') || fixed(el) || !shows(el)) continue;
      if (!best || b.top < best.top) best = { top: b.top, el, what: name(el) };
    }
    if (!best) return { gap: null, what: 'nothing' };
    // 빈 띠를 차지한 것(내용 위에 있는 높이 있는 칸, 그 내용의 조상 제외) — 실패 글에 함께 적는다.
    const band = [];
    for (const el of panel.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.height < 1 || el.contains(best.el) || b.top >= best.top - 1 || b.bottom <= from + 1 || fixed(el) || getComputedStyle(el).display === 'none') continue;
      if (band.length < 6) band.push(`${name(el)}@${Math.round(b.top - from)}+${Math.round(b.height)}`);
    }
    const pad = getComputedStyle(panel).paddingTop;
    return { gap: Math.round(best.top - from), what: best.what, band, pad };
  });
}

// MTG-프로젝트합치기 ①: 사업영역 관리(projects)는 화면이 아니라 사업 보고 위 창이라 이 목록에서 뺀다(창 모양은 area-window.spec.mjs).
const SCREENS = ['home', 'basket', 'note', 'calendar', 'tasks', 'journal', 'diary', 'meetings', 'library', 'pages', 'team', 'ledger', 'photos'];
async function show(page, name) {
  if (name === 'note') { await page.evaluate(() => window.KPTURouter.go('basket')); await chooseBasketKind(page, 'note'); await expect(page.locator('[data-nx-count]')).toHaveText(/노트 · \d+/); }
  else await page.evaluate(v => window.KPTURouter.go(v), name);
  await page.waitForFunction(v => window.KPTURouter.current === (v === 'note' ? 'basket' : v), name);
  await page.waitForTimeout(400);
}

test('폰 412: 메뉴마다 첫 화면 위 머리줄 아래에 빈 띠가 없다', async ({ page }) => {
  const { errors } = await boot(page, 412);
  const found = [];
  for (const name of SCREENS) {
    await show(page, name);
    const m = await topGap(page);
    found.push({ name, ...m });
  }
  test.info().annotations.push({ type: 'gaps', description: JSON.stringify(found) });
  console.log('first-screen gaps 412', JSON.stringify(found));
  // 음수는 머리줄 줄에 올린 단추(담당조직 ⋯ 등, 의도된 모양)라 빈 띠가 아니다.
  expect(found.filter(f => f.gap === null || f.gap > LIMIT), JSON.stringify(found)).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [412, 884, 1440]) test(`노트 첫 화면 ${width}: 맨 위 '최근' 5개(폴더 상관없이, 고친 노트가 바로 맨 위) + 위쪽 빈 띠 없음`, async ({ page }) => {
  const { errors, writes } = await boot(page, width);
  await show(page, 'note');
  const m = await topGap(page);
  console.log(`note gap ${width}`, JSON.stringify(m));
  expect(m.gap, JSON.stringify(m)).not.toBeNull();
  expect(m.gap, JSON.stringify(m)).toBeLessThanOrEqual(LIMIT);
  const wide = width >= 1024;
  const recent = wide ? page.locator('#noteRows [data-nx-recent-row]') : page.locator('[data-nx-recent] [data-nx-recent-row]');
  // 최근 고친 순 5개, 폴더가 섞여 있고, 줄 오른쪽에 작은 폴더 이름(폴더 없음 노트는 비움).
  await expect(recent).toHaveCount(5);
  expect(await recent.evaluateAll(els => els.map(e => e.dataset.nxNote))).toEqual(['n6', 'n5', 'n4', 'n3', 'n2']);
  await expect(recent.first().locator('[data-nx-recent-folder]')).toContainText('회의');
  await expect(recent.nth(1).locator('[data-nx-recent-folder]')).toContainText('개발');
  await expect(recent.nth(3).locator('[data-nx-recent-folder]')).toHaveCount(0);
  if (wide) {
    await expect(page.locator('[data-nx-tree] > *').first()).toHaveAttribute('data-nx-recent-item', '');
    await expect(page.locator('[data-nx-tree] [data-nx-recent-item]')).toHaveClass(/nx-current/);
    await expect(page.locator('[data-nx-here]')).toHaveText('최근 · 5');
  } else {
    // 그 아래 지금처럼 폴더 목록.
    await expect(page.locator(`#noteRows [data-nx-folder="${U(1)}"]`)).toBeVisible();
    const r = await page.locator('[data-nx-recent]').boundingBox(), f = await page.locator('#noteRows').boundingBox();
    expect(r.y + r.height).toBeLessThanOrEqual(f.y + 1);
  }
  // 다른 폴더의 오래된 노트(n1, 회의)를 고치면 바로 '최근' 맨 위로 온다(저장한 서버 값으로 다시 그림).
  if (!wide) { await page.locator(`#noteRows [data-nx-open="${U(1)}"]`).click(); }
  else await page.locator(`[data-nx-tree] [data-nx-open="${U(1)}"]`).click();
  await page.locator('#noteRows [data-note-row="n1"]').click();
  await expect(page.locator('[data-note-detail]')).toBeVisible();
  await noteMenuAction(page, 'data-note-edit');
  await expect(noteField(page)).toBeVisible();
  const title = page.locator('[data-note-detail] [data-note-title-input]');
  await title.fill('가 노트 고침');
  await page.locator('[data-note-detail] [data-note-save]').click();
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  // PC: 열린 노트를 닫으면(Esc) 목록 — 왼쪽 나무 맨 위 [최근]을 누르면 오른쪽에 최근 5개.
  if (wide) { await page.keyboard.press('Escape'); await expect(page.locator('[data-note-detail]')).toBeHidden(); await page.locator('[data-nx-tree] [data-nx-open="recent"]').click(); }
  else { await page.goBack(); await expect(page.locator('[data-note-detail]')).toBeHidden(); await page.goBack(); }
  await expect(recent.first()).toHaveAttribute('data-nx-note', 'n1');
  await expect(recent.first()).toContainText('가 노트 고침');
  await expect(recent).toHaveCount(5);
  expect(errors).toEqual([]);
});
