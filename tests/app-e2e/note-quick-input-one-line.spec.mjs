import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// S70-05 NOTE-입력창한줄(사용자 11/25 09:30 "pc에서 노트를 입력하세요 입력창 한줄로 / 어차피 크게 누르면 전체화면인데"):
// PC(1280)의 노트 입력칸은 늘 한 줄 높이([추가] 높이 이하)이고, 세 줄을 넣어도 높이가 그대로이며, [추가]하면 세 줄이 모두 저장된다.
// 크기 손잡이(resize)는 없고, [폴더 ▾]·[첨부]·[추가]는 칸과 같은 한 줄에 나란히, [⤢ 크게]는 칸 안 오른쪽 끝에서 쓰기 창을 연다.
// 폰(390·412)은 고치기 전과 같은 한 줄 칸(공용 --ds-control-height). 가짜 자료만 쓴다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const rows = [];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ json: structuredClone(rows) });
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); writes.push(body);
      const at = '2026-11-25T01:00:00Z', row = { id: 'n-created', occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, ...body };
      rows.push(row); return r.fulfill({ status: 201, json: [row] });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-note-list] [data-quick-input]')).toBeVisible();
  return { errors, writes };
}
const q = (page, sel) => page.locator(`[data-note-list] .home-quick[data-note-only] ${sel}`);
const rect = l => l.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width, right: r.right, left: r.left }; });
const THREE = '첫째 줄 합성 메모\n둘째 줄 내용\n셋째 줄 끝';

test('PC 1280: 노트 입력칸은 한 줄 높이 고정, 세 줄도 그대로 저장, 손잡이 없음, [⤢ 크게]로 쓰기 창', async ({ page }) => {
  const f = await fixture(page, 1280);
  const input = q(page, '[data-quick-input]'), save = q(page, '[data-quick-save]');
  const s = await rect(save), i0 = await rect(input);
  expect(i0.height).toBeLessThanOrEqual(s.height + 0.5);
  expect(await input.evaluate(el => getComputedStyle(el).resize)).toBe('none');
  // [폴더 ▾]·[첨부]·[추가]는 칸과 같은 한 줄: 각 단추의 세로 가운데가 칸 안에 있다.
  for (const sel of ['[data-quick-folder]', '[data-quick-file-picker]', '[data-quick-save]']) {
    const b = await rect(q(page, sel)), mid = (b.top + b.bottom) / 2;
    expect(mid).toBeGreaterThanOrEqual(i0.top); expect(mid).toBeLessThanOrEqual(i0.bottom);
    expect(b.left).toBeGreaterThanOrEqual(i0.right - 0.5);
  }
  // [⤢ 크게]는 칸 안 오른쪽 끝.
  const big = await rect(q(page, '[data-quick-big]'));
  expect(big.right).toBeLessThanOrEqual(i0.right + 0.5); expect(big.left).toBeGreaterThan(i0.left + i0.width / 2);
  expect(big.top).toBeGreaterThanOrEqual(i0.top - 0.5); expect(big.bottom).toBeLessThanOrEqual(i0.bottom + 0.5);
  // 감싼 상자도 콤팩트하다(칸 높이 + 위아래 여백 조금).
  const boxH = (await rect(page.locator('[data-note-list] .home-quick[data-note-only]'))).height;
  expect(boxH).toBeLessThanOrEqual(i0.height + 20);

  await input.fill(THREE);
  await input.dispatchEvent('input');
  expect((await rect(input)).height).toBeCloseTo(i0.height, 0);
  await expect(input).toHaveValue(THREE);
  await save.click();
  await expect(page.locator('#toast')).toContainText('노트를 추가했습니다.');
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({ kind: 'note', raw_text: THREE });
  await expect(input).toHaveValue('');

  await q(page, '[data-quick-big]').click();
  await expect(page.locator('#edWindow')).toBeVisible();
  expect(f.errors).toEqual([]);
});

for (const width of [390, 412]) test(`폰 ${width}: 노트 입력칸 높이는 고치기 전과 같음(공용 한 줄 칸)`, async ({ page }) => {
  const f = await fixture(page, width);
  const input = q(page, '[data-quick-input]');
  const [h, token] = await input.evaluate(el => [el.getBoundingClientRect().height, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ds-control-height'))]);
  expect(token).toBeGreaterThan(0);
  expect(h).toBeCloseTo(token, 0);
  expect(await input.evaluate(el => getComputedStyle(el).resize)).toBe('none');
  expect(f.errors).toEqual([]);
});
