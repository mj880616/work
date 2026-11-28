// BRIEF-추가빠르게(사용자 신고 11/28 12:31·12:32, 폴드 펼침):
// ① 브리핑 룸 [+] → [자료실에서 선택]·[파일 업로드] 누른 뒤 창이 5초 넘게 늦게 뜸 → 누르자마자 창 자리(껍데기)가 뜨고, 늦게 오는 것은 그 자리에 채운다.
//    느린 모듈(자료실 프로그램을 붙잡아 둠)·느린 서버(폴더·자료 읽기를 붙잡아 둠) 흉내로도 껍데기는 바로 뜬다.
// ② '이미 있는 자료예요'에서 브리핑 룸(골라서 넣으려고 연 창)이면 [올리지 않기] 자리가 [있는 자료 쓰기] → 새로 올리지 않고 그 자료가 브리핑 룸에 들어간다.
//    일부만 겹치면 겹친 것만 있는 자료로, 나머지는 창에 남는다. 자료실에 등록하려고 연 창은 지금처럼 [올리지 않기] + [자료 보기].
// 자료 이름·문장은 모두 예시. 서버는 흉내(owner RLS REST).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { briefAdd, briefAddMenu } from './helpers/brief-head.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const HWP = Buffer.from('합성 한글 파일 내용');
const lib = [
  { id: D(1), title: '예시 인력 운영 계획', file_name: '예시 계획.pdf', mime_type: 'application/pdf', created_at: '2026-10-06T00:50:00Z' },
  { id: D(2), title: '예시 보도자료', file_name: '예시 보도자료.hwp', file_size: HWP.length, created_at: '2026-11-11T01:00:00Z' },
];
const WIDTHS = [['phone-412', 412, 915], ['fold-880', 880, 900], ['pc-1280', 1280, 900]];

// 붙잡아 두기: hold(이름)으로 그 요청을 멈춰 두고 release(이름)으로 놓는다.
function holds(page) {
  const gates = new Map();
  const gate = name => { if (!gates.has(name)) { let open; const p = new Promise(r => { open = r; }); gates.set(name, {p, open}); } return gates.get(name); };
  const hits = new Map();
  return {
    hold: (name, pattern) => page.route(pattern, async r => { hits.set(name, (hits.get(name) || 0) + 1); await gate(name).p; return r.fallback(); }),
    release: name => gate(name).open(),
    hit: name => hits.get(name) || 0,
  };
}

async function open(page, {before = null} = {}) {
  const posted = [];
  const items = new Map([[D(1), 'f-brief']]);
  await openHome(page, {
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_task_attachments**', r => r.fulfill({ json: [] }));
      await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: [] }));
      await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'f-brief', name: '브리핑 요청함', sort_order: 1, parent_id: null, project_id: null }] : [] }));
      await page.route(SB + '/rest/v1/app_library_folder_items**', r => {
        const req = r.request(), u = new URL(req.url());
        if (req.method() === 'POST') {
          const body = [req.postDataJSON()].flat();
          posted.push(...body);
          for (const b of body) items.set(b.document_id, b.folder_id);
          return r.fulfill({ status: 201, body: '' });
        }
        const inList = u.searchParams.get('document_id');
        if (inList?.startsWith('in.(')) {
          const ids = inList.slice(4, -1).split(',');
          return r.fulfill({ json: ids.filter(id => items.has(id)).map(id => ({ document_id: id, folder_id: items.get(id) })) });
        }
        const folder = (u.searchParams.get('folder_id') || '').replace('eq.', '');
        return r.fulfill({ json: [...items].filter(([, f]) => !folder || f === folder).map(([document_id, folder_id]) => ({ document_id, folder_id })) });
      });
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        if (r.request().method() !== 'GET') return r.fallback();
        const url = decodeURIComponent(r.request().url());
        // 같은 파일 찾기(이름·크기): 예시 보도자료.hwp만 있다.
        if (url.includes('file_name=in.')) return r.fulfill({ json: url.includes('"예시 보도자료.hwp"') ? [{ ...lib[1], workspace_id: 'w' }] : [] });
        const want = new URL(r.request().url()).searchParams.get('id');
        const rows = want?.startsWith('in.(') ? lib.filter(d => want.slice(4, -1).split(',').includes(d.id)) : lib;
        return r.fulfill({ json: rows.map(d => ({ workspace_id: 'w', category: '기타', visibility: 'private', ...d })) });
      });
      if (before) await before();
    },
  });
  await page.evaluate(() => window.KPTURouter.go('brief'));
  await expect(page.locator('#briefView [data-br-list] .br-row')).toHaveCount(1);
  return { posted };
}

// 누른 순간(메뉴 줄 click)부터 창 자리가 보일 때까지 화면 안 시간(ms).
async function timeToShow(page, act, selector) {
  await page.evaluate(({act, selector}) => {
    window.__briefAddT = null;
    const on = e => { if (!e.target.closest?.(`[data-br-add-act="${act}"]`)) return;
      document.removeEventListener('click', on, true);
      const t0 = performance.now();
      const tick = () => { const n = document.querySelector(selector); if (n && n.getClientRects().length && !n.closest('.hidden')) window.__briefAddT = performance.now() - t0; else requestAnimationFrame(tick); };
      tick();
    };
    document.addEventListener('click', on, true);
  }, {act, selector});
  await briefAdd(page).click();
  await briefAddMenu(page).locator(`[data-br-add-act="${act}"]`).click();
  await expect.poll(() => page.evaluate(() => window.__briefAddT), {timeout: 3000}).not.toBeNull();
  return page.evaluate(() => window.__briefAddT);
}

for (const [label, width, height] of WIDTHS) {
  test(`[+] 파일 업로드: 느린 모듈·느린 서버에도 창 자리는 바로 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const h = holds(page);
    await open(page, { before: async () => {
      // 자료실 프로그램(모듈)과 자료실 폴더 목록 읽기(서버)를 붙잡아 둔다.
      await h.hold('module', '**/app/library-upload.js*');
      await h.hold('server', u => u.href.startsWith(SB + '/rest/v1/app_library_folders?') && /select=id(,|%2C)project_id/.test(u.href));
    } });
    const ms = await timeToShow(page, 'file', '#documentModal.doc-wait .modal-card');
    expect(ms).toBeLessThan(300);
    const modal = page.locator('#documentModal');
    await expect(modal).toHaveClass(/doc-wait/);
    await expect(modal.locator('.modal-head h2')).toHaveText('자료 등록');
    await expect(modal.locator('[data-doc-wait] [data-wait]')).toBeAttached();
    await expect(modal.locator('#docTitle')).toBeHidden(); // 최종 창 내용은 아직 안 보인다(기본 모양을 먼저 그리지 않음)
    const shell = await modal.locator('.modal-card').boundingBox();
    await page.screenshot({ path: `docs/design/screens/brief-add-fast/${label}-shell.png` });
    await expect.poll(() => h.hit('module')).toBeGreaterThan(0); // 정말 붙잡혀 있었다
    h.release('module');
    await expect.poll(() => h.hit('server')).toBeGreaterThan(0);
    await page.waitForTimeout(200);
    await expect(modal).toHaveClass(/doc-wait/); // 서버가 붙잡혀 있는 동안에도 자리 그대로
    h.release('server');
    await expect(modal).not.toHaveClass(/doc-wait/, { timeout: 15000 });
    await expect(modal.locator('#libraryFileInput')).toBeAttached();
    await expect(modal.locator('#libraryUploadFolder')).toHaveText('‘브리핑 요청함’ 폴더에 넣어요');
    const done = await modal.locator('.modal-card').boundingBox();
    expect(Math.abs(done.width - shell.width)).toBeLessThanOrEqual(1); // 같은 폭(넓은 화면 640·폰 가득)
    expect(Math.abs(done.x - shell.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(done.height - shell.height)).toBeLessThanOrEqual(2); // 처음 열 때도 높이 그대로(자리가 출렁이지 않음)
    expect(Math.abs(done.y - shell.y)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `docs/design/screens/brief-add-fast/${label}-final.png` });
  });

  test(`[+] 자료실에서 선택: 느린 서버에도 창은 바로, 목록은 그 자리에 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const h = holds(page);
    await open(page, { before: () => h.hold('docs', u => u.href.startsWith(SB + '/rest/v1/app_documents?') && /select=id(,|%2C)title(,|%2C)file_name(,|%2C)mime_type(,|%2C)created_at&/.test(u.href)) });
    const ms = await timeToShow(page, 'lib', '#brLibPicker');
    expect(ms).toBeLessThan(300);
    const picker = page.locator('#brLibPicker');
    await expect(picker.locator('[data-wait]')).toBeAttached();
    await expect(picker.locator('.lu-move-item')).toHaveCount(0);
    expect(h.hit('docs')).toBeGreaterThan(0);
    h.release('docs');
    await expect(picker.locator('.lu-move-item')).toHaveCount(2);
    await expect(picker.locator('[data-wait]')).toHaveCount(0);
  });
}

async function pickFiles(page, files) {
  await briefAdd(page).click();
  await briefAddMenu(page).locator('[data-br-add-act="file"]').click();
  const modal = page.locator('#documentModal');
  await expect(modal).not.toHaveClass(/doc-wait/, { timeout: 15000 });
  await modal.locator('#libraryFileInput').setInputFiles(files);
  return modal;
}
const dup = { name: '예시 보도자료.hwp', mimeType: 'application/x-hwp', buffer: HWP };
const fresh = { name: '새 예시 파일.txt', mimeType: 'text/plain', buffer: Buffer.from('new') };

for (const [label, width, height] of WIDTHS) {
  test(`겹침 → [있는 자료 쓰기]: 새로 올리지 않고 그 자료가 브리핑 룸에 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { posted } = await open(page);
    const uploads = [];
    page.on('request', r => { if (/library-files|upload/i.test(r.url()) && r.method() === 'POST') uploads.push(r.url()); });
    const modal = await pickFiles(page, [dup]);
    const ask = page.locator('.kptu-ask.same-file-ask');
    await expect(ask).toBeVisible();
    await expect(ask.locator('.kptu-ask-text')).toHaveText('이미 있는 자료예요');
    await expect(ask.getByRole('button')).toHaveText(['있는 자료 쓰기', '그래도 업로드']);
    await page.screenshot({ path: `docs/design/screens/brief-add-fast/${label}-same.png` });
    await ask.getByRole('button', { name: '있는 자료 쓰기' }).click();
    await expect(modal).toBeHidden(); // 남은 파일이 없으면 창을 닫는다
    await expect.poll(() => posted.map(p => [p.document_id, p.folder_id])).toEqual([[D(2), 'f-brief']]);
    await expect(page.locator(`#briefView .br-row[data-br-open="${D(2)}"]`)).toBeVisible();
    expect(uploads).toEqual([]);
  });
}

test('일부만 겹침: 겹친 것은 있는 자료로, 나머지만 창에 남는다', async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 900 });
  const { posted } = await open(page);
  const modal = await pickFiles(page, [dup, fresh]);
  const ask = page.locator('.kptu-ask.same-file-ask');
  await expect(ask.locator('.kptu-ask-note')).toHaveText('나머지 1개는 바로 올려요');
  await ask.getByRole('button', { name: '있는 자료 쓰기' }).click();
  await expect.poll(() => posted.map(p => p.document_id)).toEqual([D(2)]);
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-lu-upload-file]')).toHaveCount(1);
  await expect(modal.locator('[data-lu-upload-file]')).toContainText('새 예시 파일.txt');
  await expect(page.locator(`#briefView .br-row[data-br-open="${D(2)}"]`)).toBeVisible();
});

test('자료실에 등록하려고 연 창은 그대로 [올리지 않기] + 그 자료로 가는 [자료 보기]', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const { posted } = await open(page);
  await page.evaluate(() => window.KPTURouter.go('library'));
  await expect(page.locator('#libraryView')).toBeVisible();
  await page.evaluate(() => window.KPTUDocumentModal.open());
  const modal = page.locator('#documentModal');
  await expect(modal).toBeVisible();
  await modal.locator('#libraryFileInput').setInputFiles([dup]);
  const ask = page.locator('.kptu-ask.same-file-ask');
  await expect(ask.getByRole('button')).toHaveText(['올리지 않기', '그래도 업로드']);
  await ask.getByRole('button', { name: '올리지 않기' }).click();
  await expect(modal.locator('[data-lu-upload-file]')).toHaveCount(0);
  const notice = page.locator('.kptu-notice').filter({ hasText: '올리지 않았어요' });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('button', { name: '자료 보기' })).toBeVisible();
  expect(posted).toEqual([]);
});
