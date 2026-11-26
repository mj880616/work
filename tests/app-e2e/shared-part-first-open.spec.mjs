// S67-41 공용 부품 꾸밈 보장(명진 11/20 20:40 "이런 경우가 잦네 / 꾸밈 못불러오는"): 공용 고르기 창(library-move-picker.js)의 꾸밈은
// library-upload.css에 있는데, 브리핑 룸 화면 모양 목록에는 그 파일이 없어 브리핑 룸을 첫 화면으로 열면 [자료실에서 선택] 첫 열기가
// 꾸밈 없는 창(브라우저 기본 단추·검은 테두리)으로 떴다. 이제 부품이 열리기 전에 자기 모양 파일을 기다려 부른다(app/part-styles.js 표).
// 이 시험은 새 세션에서 그 화면을 첫 화면으로 열고, 첫 열기에서 계산된 모양과 고르기·넣기가 바로 되는지 본다. 자료 이름은 모두 예시.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { openBriefLibPick } from './helpers/brief-head.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const lib = [
  { id: D(1), title: '예시 인력 운영 계획', file_name: '예시 계획.pdf', mime_type: 'application/pdf', created_at: '2026-10-06T00:50:00Z' },
  { id: D(2), title: '예시 연구 용역 보고서', file_name: '예시 보고서.hwp', created_at: '2026-10-05T00:00:00Z' },
];

async function routes(page, posted) {
  await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'f-brief', sort_order: 1 }] : [] }));
  await page.route(SB + '/rest/v1/app_library_folder_items**', r => {
    const req = r.request();
    if (req.method() === 'POST') { posted.push(...[req.postDataJSON()].flat()); return r.fulfill({ status: 201, body: '' }); }
    return r.fulfill({ json: [] });
  });
  await page.route(SB + '/rest/v1/app_documents?**', r => {
    if (r.request().method() !== 'GET') return r.fallback();
    const want = new URL(r.request().url()).searchParams.get('id');
    const rows = want?.startsWith('in.(') ? lib.filter(d => want.slice(4, -1).split(',').includes(d.id)) : lib;
    return r.fulfill({ json: rows.map(d => ({ workspace_id: 'w', category: '기타', visibility: 'private', ...d })) });
  });
}

// 꾸밈이 붙었는지: 창은 고정 자리·얇은 테두리, 줄 단추는 바탕 없음·테두리 없음(브라우저 기본 회색 단추가 아님).
async function styled(locator) {
  return locator.evaluate(el => {
    const cs = getComputedStyle(el), b = el.querySelector('button.lu-move-item, .lu-move-foot button');
    const bs = b ? getComputedStyle(b) : null;
    return { position: cs.position, border: cs.borderTopWidth, display: cs.display, buttonBorder: bs?.borderTopWidth, buttonBg: bs?.backgroundColor };
  });
}

for (const [label, width, height] of [['phone-412', 412, 915], ['pc-1280', 1280, 900]]) {
  test(`브리핑 룸이 첫 화면일 때 [자료실에서 선택] 첫 열기부터 꾸밈·고르기 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const posted = [];
    await openHome(page, { query: '?view=brief', beforeLoad: () => routes(page, posted) });
    await expect(page.locator('#briefView')).toBeVisible();
    // 첫 화면이 브리핑 룸이면 자료실 모양 파일은 다른 화면에서 미리 불리지 않는다.
    await openBriefLibPick(page); // S71-30: 머리 [+] → [자료실에서 선택]
    const picker = page.locator('#brLibPicker');
    await expect(picker).toBeVisible();
    const look = await styled(picker);
    expect(look).toMatchObject({ position: 'fixed', border: '1px', display: 'flex', buttonBorder: '0px', buttonBg: 'rgba(0, 0, 0, 0)' });
    await page.screenshot({ path: `docs/design/screens/s67-41/${label}-brief-first-open.png` });
    await picker.locator(`[data-lu-move-folder="${D(2)}"]`).click();
    const done = picker.locator('[data-lu-move-done]');
    await expect(done).toHaveText('넣기 1개');
    await done.click();
    await expect(picker).toBeHidden();
    await expect.poll(() => posted.map(p => p.document_id)).toEqual([D(2)]);
  });
}

// 부품 모듈이 열리면(import가 끝나면) 그 부품 모양 파일이 이미 붙어 있다 — 화면 목록에 없는 파일도(모듈 맨 위 await partStyles).
test('부품을 처음 부르는 화면에서도 import가 끝나기 전에 그 부품 모양이 붙는다(브리핑 룸 → 작은 입력 창·고르기 창)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await openHome(page, { query: '?view=brief', beforeLoad: () => routes(page, []) });
  await expect(page.locator('#briefView')).toBeVisible();
  const got = await page.evaluate(async () => {
    const has = name => [...document.querySelectorAll('link[rel="stylesheet"]')].some(l => new URL(l.href).pathname.endsWith('/' + name) && l.sheet);
    const before = has('small-form-modal.css');
    await import('./small-form-modal.js');
    return { before, after: has('small-form-modal.css') };
  });
  expect(got).toEqual({ before: false, after: true });
});

// 다른 화면 몇 곳: 새 세션 첫 화면이 다 그려졌을 때, 받은 공용 부품 모듈마다 그 모양 파일이 붙어 있다.
for (const view of ['home', 'calendar', 'tasks', 'library', 'brief', 'search']) {
  test(`첫 화면 ${view}: 받은 공용 부품마다 모양 파일이 붙어 있다`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await openHome(page, { query: `?view=${view}`, beforeLoad: () => routes(page, []) });
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
    const missing = await page.evaluate(async () => {
      const { PART_STYLES } = await import('./part-styles.js');
      const loaded = new Set(performance.getEntriesByType('resource').map(e => new URL(e.name).pathname.split('/').at(-1)));
      const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(l => l.sheet).map(l => new URL(l.href).pathname.split('/').at(-1));
      const out = [];
      for (const [name, list] of Object.entries(PART_STYLES)) {
        if (!loaded.has(`${name}.js`) && !loaded.has(`${name}.mjs`)) continue;
        for (const path of list) if (!sheets.includes(path.slice(2))) out.push(`${name} → ${path}`);
      }
      return out;
    });
    expect(missing).toEqual([]);
  });
}
