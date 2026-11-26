// S70-84 BRIEF-두칸폴더(명진 11/26 09:28 "브리핑 룸도 마찬가지 저렇게 미리보기 안보여줘도 되고 파일 이름 기준으로 하고 여기도 폴더 개념이 들어가야하고
// 폴드펼침과 pc에서는 왼쪽 목록 오른쪽 상세"):
// ① PC 1280·폴드 펼침 690: 왼쪽 목록 | 오른쪽 브리핑 두 칸(맨 위 다 된 브리핑이 오른쪽에 열림), 폰 390: 한 칸(목록 → 보기, 뒤로 = 목록).
// ② 목록 줄에 한 줄 요지(미리보기) 없음, 줄 높이가 [파일] 목록 줄(files.css .fx-rows > .fx-row)과 같음, 기본 정렬 = 이름, 머리 칸 누르기로 바꾸고 서버(view_prefs.brief_sort)에 기억.
// ③ 폴더: 자료실 '브리핑 요청함' 아래 폴더(새 표 없음) — ⋯ [폴더로 옮기기…]의 공용 '옮길 곳' 창에서 [새 폴더] → 옮기기, '폴더 없음' ⋯ [새 폴더],
//    PC 마우스로 줄을 폴더 줄에 끌어 놓기, 폴더 이름 누르기 = 그 자리 펼치기(그 폴더 자료만 그 아래). 쓰기는 자료실 폴더 표·자료 연결 표(owner RLS)뿐.
// 자료 이름·문장은 모두 예시. 서버는 흉내.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { pickInSheet, folderSheet } from './helpers/folder-sheet.mjs';
import { briefMore, briefTopMenu, briefTools, briefAdd, briefAddMenu } from './helpers/brief-head.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const D = n => `d0000000-0000-4000-8000-00000000000${n}`;
const docs = [
  { id: D(1), title: '예시 연구 보고서', file_name: '예시 보고서.hwp', file_id: 'FILE_aaaaaaaaaa', file_size: 2048000, created_at: '2026-10-06T00:50:00Z' },
  { id: D(2), title: '가 예시 계획', file_name: '예시 계획.pdf', mime_type: 'application/pdf', file_id: 'FILE_bbbbbbbbbb', file_size: 5000, created_at: '2026-10-05T00:00:00Z' },
  { id: D(3), title: '나 예시 공문', file_name: '예시 공문.pdf', mime_type: 'application/pdf', file_id: 'FILE_cccccccccc', file_size: 7000, created_at: '2026-10-04T00:00:00Z' },
];
const LEAD = '예시 요지 한 줄: 인건비 항목 배점이 늘어남.';
const brief = { v: 3, lead: LEAD, gist: [LEAD], sections: [{ title: '예시 안건', items: [{ text: '예시 항목 하나', page: 3 }] }], quotes: [] };
const briefRows = () => [D(1), D(2), D(3)].map((id, i) => ({ id: 'b' + i, document_id: id, status: 'done', stage: 'done', step_no: 3, step_total: 3, page_count: 10, brief, error_code: null, created_at: '2026-10-0' + (i + 1) + 'T00:00:00Z', updated_at: '2026-10-07T00:00:00Z', finished_at: '2026-10-07T00:00:00Z' }));

async function open(page) {
  const db = { folders: [{ id: 'f-brief', parent_id: null, name: '브리핑 요청함', sort_order: 1, project_id: null }], items: new Map([[D(1), 'f-brief'], [D(2), 'f-brief'], [D(3), 'f-brief']]), writes: [], seq: 0 };
  const home = await openHome(page, {
    beforeLoad: async () => {
      await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({ json: briefRows() }));
      await page.route(SB + '/rest/v1/app_library_folders**', async r => {
        const req = r.request(), u = new URL(req.url()), m = req.method();
        if (m === 'GET') {
          const name = u.searchParams.get('name');
          const rows = name ? db.folders.filter(f => 'eq.' + f.name === decodeURIComponent(name) && !f.parent_id) : db.folders;
          return r.fulfill({ json: rows });
        }
        db.writes.push({ table: 'folders', method: m, url: u.search, body: req.postDataJSON?.() ?? null });
        if (m === 'POST') { const b = req.postDataJSON(); const row = { id: 'f-new' + (++db.seq), ...b }; db.folders.push(row); return r.fulfill({ status: 201, json: [row] }); }
        if (m === 'PATCH') { const id = (u.searchParams.get('id') || '').replace('eq.', ''); Object.assign(db.folders.find(f => f.id === id) || {}, req.postDataJSON()); return r.fulfill({ status: 204, body: '' }); }
        return r.fulfill({ status: 204, body: '' });
      });
      await page.route(SB + '/rest/v1/app_library_folder_items**', async r => {
        const req = r.request(), u = new URL(req.url()), m = req.method();
        if (m === 'GET') {
          const f = u.searchParams.get('folder_id') || '', d = u.searchParams.get('document_id') || '';
          const inF = f.startsWith('in.(') ? f.slice(4, -1).split(',') : f ? [f.replace('eq.', '')] : null;
          const inD = d.startsWith('in.(') ? d.slice(4, -1).split(',') : d ? [d.replace('eq.', '')] : null;
          return r.fulfill({ json: [...db.items].filter(([doc, fid]) => (!inF || inF.includes(fid)) && (!inD || inD.includes(doc))).map(([document_id, folder_id]) => ({ document_id, folder_id })) });
        }
        db.writes.push({ table: 'items', method: m, url: u.search, body: req.postDataJSON?.() ?? null });
        if (m === 'POST') { const b = req.postDataJSON(); if (db.items.has(b.document_id)) return r.fulfill({ status: 409, json: { code: '23505', message: 'duplicate key' } }); db.items.set(b.document_id, b.folder_id); return r.fulfill({ status: 201, body: '' }); }
        if (m === 'PATCH') { const id = (u.searchParams.get('document_id') || '').replace('eq.', ''); db.items.set(id, req.postDataJSON().folder_id); return r.fulfill({ status: 204, body: '' }); }
        return r.fulfill({ status: 204, body: '' });
      });
      await page.route(SB + '/rest/v1/app_documents?**', r => {
        if (r.request().method() !== 'GET') return r.fallback();
        const want = new URL(r.request().url()).searchParams.get('id');
        const rows = want?.startsWith('in.(') ? docs.filter(d => want.slice(4, -1).split(',').includes(d.id)) : docs;
        return r.fulfill({ json: rows.map(d => ({ workspace_id: 'w', category: '기타', visibility: 'private', ...d })) });
      });
      await page.route(SB + '/functions/v1/document-actions', r => r.fulfill({ json: { ok: true } }));
    },
  });
  await page.evaluate(() => window.KPTURouter.go('brief'));
  await expect(page.locator('#briefView .br-row')).toHaveCount(3);
  return { db, prefs: home.prefs };
}
const list = page => page.locator('#briefView [data-br-list]');
const detail = page => page.locator('#briefView [data-br-detail]');
const row = (page, n) => list(page).locator(`.br-row[data-br-open="${D(n)}"]`);
const folderRow = (page, name) => list(page).locator('.ft-row', { has: page.locator('.ft-name', { hasText: name }) });
// [파일] 목록 줄 높이: files.css 같은 칸(.fx-rows > .fx-row)의 줄 하나를 그 자리에 그려 잰다(브리핑 룸은 files.css를 함께 연다).
const fileRowHeight = page => page.evaluate(() => {
  const host = document.createElement('div'); host.className = 'fx-rows'; host.style.cssText = 'position:absolute;left:0;top:0;width:600px;visibility:hidden';
  host.innerHTML = '<button type="button" class="fx-row"><span class="fx-ico">P</span><span class="fx-nm"><span class="fx-name">예시</span></span><span class="fx-day">10/05</span><span class="fx-size">5KB</span><span class="fx-kind">PDF</span><span class="fx-sub">10/05 · 5KB</span></button>';
  document.body.append(host); const h = host.firstElementChild.getBoundingClientRect().height; host.remove(); return h;
});

for (const [label, width, height] of [['pc-1280', 1280, 860], ['fold-690', 690, 900]]) {
  test(`두 칸: 왼쪽 목록 | 오른쪽 브리핑, 요약 줄 없음, 줄 높이 = [파일] 줄, 이름 정렬 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { prefs } = await open(page);
    // 맨 위(이름 순 첫 줄 '가 예시 계획')의 다 된 브리핑이 오른쪽에 저절로 열린다.
    await expect(detail(page)).toBeVisible();
    await expect(detail(page).locator('.br-doc')).toHaveText('가 예시 계획');
    await expect(list(page)).toBeVisible();
    const lb = await list(page).boundingBox(), db = await detail(page).boundingBox();
    expect(lb.x + lb.width).toBeLessThanOrEqual(db.x + 1);
    expect(Math.abs(lb.y - db.y)).toBeLessThanOrEqual(4);
    await expect(page.locator('#briefView .ds-split-handle, #briefView [role="separator"]')).toHaveCount(1);
    // 목록 줄: 이름 한 줄 + 넣은 날·크기·종류, 한 줄 요지 없음.
    await expect(list(page).locator('.br-row .fx-name')).toHaveText(['가 예시 계획', '나 예시 공문', '예시 연구 보고서']);
    await expect(list(page)).not.toContainText(LEAD);
    await expect(list(page).locator('.br-one')).toHaveCount(0);
    const h = await fileRowHeight(page);
    for (const n of [1, 2, 3]) expect(Math.round((await row(page, n).boundingBox()).height)).toBe(Math.round(h));
    // 머리 칸 [이름]을 누르면 내림, 서버 기억(brief_sort).
    await list(page).locator('[data-head-sort="name"]').click();
    await expect(list(page).locator('.br-row .fx-name')).toHaveText(['예시 연구 보고서', '나 예시 공문', '가 예시 계획']);
    await expect.poll(() => prefs.value?.brief_sort).toEqual({ key: 'name', dir: 'desc' });
    await list(page).locator('[data-head-sort="modified"]').click();
    await expect(list(page).locator('.br-row .fx-name')).toHaveText(['나 예시 공문', '가 예시 계획', '예시 연구 보고서']);
    await expect.poll(() => prefs.value?.brief_sort).toEqual({ key: 'modified', dir: 'asc' });
    // 다른 줄을 누르면 오른쪽만 바뀌고 목록은 그대로.
    await row(page, 1).click();
    await expect(detail(page).locator('.br-doc')).toHaveText('예시 연구 보고서');
    await expect(list(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `docs/design/screens/s70-84/${label}-two-pane.png`, fullPage: false });
  });
}

test('폰 390: 한 칸(목록 → 보기, 뒤로 = 목록), 줄 높이 = [파일] 폰 줄, 정렬 고르기', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(detail(page)).toBeHidden();
  await expect(list(page).locator('.fx-head')).toHaveCount(0);
  await expect(list(page).locator('.br-row .fx-name')).toHaveText(['가 예시 계획', '나 예시 공문', '예시 연구 보고서']);
  await expect(list(page)).not.toContainText(LEAD);
  const h = await fileRowHeight(page);
  expect(Math.round((await row(page, 2).boundingBox()).height)).toBe(Math.round(h));
  // S71-30: 폰 정렬 고르기는 머리 [⋯] 메뉴 안(목록 칸 머리 줄은 없음).
  await expect(list(page).locator('select[data-br-sort]')).toHaveCount(0);
  await briefMore(page).click();
  await briefTopMenu(page).locator('select[data-br-sort]').selectOption('modified:desc');
  await page.keyboard.press('Escape');
  await expect(list(page).locator('.br-row .fx-name')).toHaveText(['예시 연구 보고서', '가 예시 계획', '나 예시 공문']);
  await row(page, 3).click();
  await expect(detail(page)).toBeVisible();
  await expect(list(page)).toBeHidden();
  await page.screenshot({ path: 'docs/design/screens/s70-84/phone-390-detail.png', fullPage: false });
  await page.goBack();
  await expect(list(page)).toBeVisible();
  await expect(detail(page)).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const [label, width, height] of [['phone-390', 390, 844]]) {
  test(`폴더: [폴더로 옮기기…] 창에서 새 폴더 → 옮기기, 폴더 이름 누르기 = 그 자리 펼치기, 폴더 없음 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { db } = await open(page);
    await expect(list(page).locator('.ft-row')).toHaveCount(0); // 폴더가 없으면 지금까지처럼 한 목록
    // ⋯ 단추가 없어졌다: 폰은 오른쪽 밀기로 고르고 막대 [옮기기](PC는 끌어 옮기기).
    await swipeRow(row(page, 3), 80);
    await page.locator('#briefView .row-swipe-pickbar [data-row-pick-act="move"]').click();
    const sheet = folderSheet(page);
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-fx-dest-pick][data-fx-dest-name="폴더 없음"]').click();
    await sheet.locator('[data-fx-dest-mkdir]').click();
    await page.locator('.kptu-ask input').fill('예시 회의');
    await page.locator('.kptu-ask .kptu-ask-actions button', { hasText: '만들기' }).click();
    await pickInSheet(page, [], { go: true });
    // 옮긴 뒤에도 고르기 막대는 남는다(표준: 끝내기는 폰 뒤로가기·PC Esc) — 끝낸 뒤 다음 단계로.
    await page.keyboard.press('Escape');
    await expect(page.locator('#briefView .row-swipe-pickbar')).toHaveCount(0);
    // 폴더는 '브리핑 요청함' 아래 자료실 폴더로 만들어지고, 자료 연결 줄 하나가 그 폴더로 바뀐다.
    await expect.poll(() => db.folders.find(f => f.name === '예시 회의')?.parent_id).toBe('f-brief');
    const made = db.folders.find(f => f.name === '예시 회의');
    await expect.poll(() => db.items.get(D(3))).toBe(made.id);
    expect(db.writes.every(w => w.table === 'folders' || w.table === 'items')).toBe(true);
    await expect(folderRow(page, '예시 회의')).toBeVisible();
    await expect(folderRow(page, '폴더 없음')).toBeVisible();
    await expect(row(page, 3)).toBeVisible(); // 옮긴 폴더는 펼친 채(그 안 자료)
    await expect(list(page).locator('.br-row')).toHaveCount(3);
    // 폴더 이름 누르기 = 그 자리 접기·펼치기(들어가지 않음).
    await folderRow(page, '예시 회의').locator('[data-br-fold]').click();
    await expect(row(page, 3)).toHaveCount(0);
    await expect(list(page).locator('.br-row')).toHaveCount(2);
    await folderRow(page, '예시 회의').locator('[data-br-fold]').click();
    await expect(row(page, 3)).toBeVisible();
    // '폴더 없음' ⋯ [새 폴더] → 맨 위에 하나 더.
    await folderRow(page, '폴더 없음').locator('[data-br-fmore]').click();
    await page.locator('#brFolderMenu [data-brf-act="new"]').click();
    await page.locator('.kptu-ask input').fill('예시 공문함');
    await page.locator('.kptu-ask .kptu-ask-actions button', { hasText: '만들기' }).click();
    await expect(folderRow(page, '예시 공문함')).toBeVisible();
    await expect.poll(() => db.folders.find(f => f.name === '예시 공문함')?.parent_id).toBe('f-brief');
    // 폴더 ⋯: 이름 바꾸기·옮기기·삭제(위로·아래로 단추 없음).
    await folderRow(page, '예시 공문함').locator('[data-br-fmore]').click();
    await expect(page.locator('#brFolderMenu button')).toHaveText(['이 안에 새 폴더', '이름 바꾸기', '옮기기…', '삭제']);
    await page.keyboard.press('Escape');
    if (width >= 600) {
      // PC 마우스: 자료 줄을 폴더 줄에 끌어 놓기.
      await row(page, 2).dragTo(folderRow(page, '예시 공문함'));
      await expect.poll(() => db.items.get(D(2))).toBe(db.folders.find(f => f.name === '예시 공문함').id);
      await expect(folderRow(page, '예시 공문함').locator('.ft-num')).toHaveText('1');
    }
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `docs/design/screens/s70-84/${label}-folders.png`, fullPage: false });
  });
}

// ---------- S71-30 BRIEF-머리한줄·놓기안내삭제·밀기(명진 11/26 17:38 "여기에 파일을 놓아듀 돼요 이 안내멘트 삭제 / 브리핑 요약 삭제하고 파일 제목으로만
// 자료실 파일처럼 한줄로 / 좌우로 스와이프 기능 넣는거 요청했는데 어케됨") ----------
// ① 머리는 한 줄: 화면 안 머리 줄([자료실에서 선택][자료 넣기][−|+])·점선 놓기 안내 줄이 없고, 맨 위 줄(폰·폴드 '브리핑 룸 · 찾기') 끝에 [⋯][+] 둘 — [+]가 맨 오른쪽.
//   PC 틀은 S71-59부터 화면 안 첫 줄 오른쪽 끝(맨 위 줄은 앱 전체 것만).
// ② [+] 작은 메뉴 = 자료실에서 선택 · 파일 업로드. ③ [⋯] = (폰) 정렬 · 글자 크기 [−][+](메뉴를 닫지 않고 한 단계씩) · 쓰는 법. 보기가 열려 있으면 글자 크기는 보기 머리 줄 하나뿐.
// ④ 목록 줄은 이름 한 줄(+ 폰은 [파일] 폰 줄처럼 날짜·크기·종류 작은 줄), 요약 줄 없음. ⑤ 파일을 끌어 오는 동안만 목록에 놓을 곳 점선.
for (const [label, width, height] of [['phone-390', 390, 844], ['fold-690', 690, 900], ['pc-1280', 1280, 860]]) {
  test(`S71-30 머리 한 줄 [⋯][+]·[+] 두 항목·⋯ 안 글자 크기·점선 안내 없음·요약 줄 없음 (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await open(page);
    // ① 화면 안 머리 줄·안내 줄 없음.
    await expect(list(page).locator('.br-head')).toHaveCount(0);
    await expect(page.locator('#briefView .br-drop, #briefView [data-br-pick-lib], #briefView [data-br-add]')).toHaveCount(0);
    await expect(page.locator('#briefView')).not.toContainText('여기에 파일을 놓아도');
    await expect(list(page).locator('[data-text-size-ctl]')).toHaveCount(0);
    // 맨 위 줄 끝 [⋯][+](+ 맨 오른쪽), 화면 이름·찾기와 한 줄.
    const tools = briefTools(page);
    await expect(tools).toBeVisible();
    await expect(tools.locator('button')).toHaveCount(2);
    await expect(tools.locator('button').last()).toHaveAttribute('data-br-top-add', '');
    // S71-59 UI-화면메뉴안으로: PC 틀은 맨 위 줄이 아니라 화면 안 첫 줄 오른쪽 끝(브리핑 룸은 첫 줄이 따로 없어 화면 맨 위 그 한 줄).
    const slot = width <= 760 ? '.mobile-shell-header [data-screen-tools="head"]' : '#briefView [data-screen-tools="line"]';
    await expect(page.locator(`${slot} .sf-tools[data-sf-tools="brief"]`)).toBeVisible();
    if (width > 760) await expect(page.locator('.app-topline .sf-tools[data-sf-tools="brief"]')).toHaveCount(0);
    const line = await page.locator(width <= 760 ? '.mobile-shell-header' : slot).boundingBox();
    for (const b of await tools.locator('button').all()) {
      const r = await b.boundingBox();
      expect(r.y).toBeGreaterThanOrEqual(line.y - 1); expect(r.y + r.height).toBeLessThanOrEqual(line.y + line.height + 1);
      expect(r.height).toBeLessThanOrEqual(34);
    }
    const [more, plus] = [await tools.locator('[data-br-top-more]').boundingBox(), await briefAdd(page).boundingBox()];
    expect(plus.x).toBeGreaterThan(more.x);
    if (width <= 760) {
      const name = await page.locator('.mobile-shell-header [data-mobile-view-name]').boundingBox();
      expect(Math.abs((name.y + name.height / 2) - (plus.y + plus.height / 2))).toBeLessThanOrEqual(4);
    }
    // ④ 요약 줄 없음 — 이름 한 줄.
    await expect(list(page)).not.toContainText(LEAD);
    await expect(list(page).locator('.br-one')).toHaveCount(0);
    for (const n of [1, 2, 3]) {
      const nm = row(page, n).locator('.fx-name');
      expect(await nm.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
    }
    // ② [+] 작은 메뉴 두 항목.
    await briefAdd(page).click();
    await expect(briefAddMenu(page)).toBeVisible();
    await expect(briefAddMenu(page).getByRole('button')).toHaveText(['자료실에서 선택', '파일 업로드']);
    await page.keyboard.press('Escape');
    await expect(briefAddMenu(page)).toBeHidden();
    // ③ [⋯]: 폰은 정렬 + 글자 크기, 두 칸 폭(보기가 오른쪽에 열림)은 글자 크기 없음(보기 머리 줄 하나).
    await briefMore(page).click();
    const menu = briefTopMenu(page);
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-br-top-act="help"]')).toHaveText('쓰는 법');
    if (width < 600) {
      await expect(menu.locator('select[data-br-sort]')).toBeVisible();
      const ctl = menu.locator('[data-text-size-ctl]');
      await expect(ctl).toBeVisible();
      await ctl.getByRole('button', { name: '글자 크게' }).click();
      await expect(menu).toBeVisible(); // 메뉴는 열린 채
      await expect(list(page).locator('.br-rows')).toHaveAttribute('data-text-size', 'l');
      await ctl.getByRole('button', { name: '글자 작게' }).click();
      await expect(list(page).locator('.br-rows')).toHaveAttribute('data-text-size', 'm');
    } else {
      await expect(menu.locator('select[data-br-sort]')).toHaveCount(0);
      await expect(menu.locator('[data-text-size-ctl]')).toHaveCount(0);
      await expect(page.locator('#briefView [data-text-size-ctl]:visible')).toHaveCount(1);
    }
    await page.screenshot({ path: `docs/design/screens/s71-30/${label}-menu.png`, fullPage: false });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    // ⑤ 파일을 끌어 오는 동안만 놓을 곳 표시.
    await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], '예시.pdf', { type: 'application/pdf' })); document.querySelector('#briefView .br-list').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); });
    await expect(page.locator('#briefView')).toHaveClass(/br-dropping/);
    expect(await list(page).evaluate(el => getComputedStyle(el).outlineStyle)).toBe('dashed');
    await page.evaluate(() => { const v = document.querySelector('#briefView'); v.dispatchEvent(new DragEvent('dragleave', { bubbles: true })); });
    await expect(page.locator('#briefView')).not.toHaveClass(/br-dropping/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `docs/design/screens/s71-30/${label}-head.png`, fullPage: false });
    expect(errors).toEqual([]);
  });
}

// S71-30 BRIEF-밀기(폰 390): 줄 밀기 공용 부품(row-swipe.js). 왼쪽 밀기 = 메뉴 칸만 [옮기기][⋯][삭제](끝까지 밀어도 바로 하지 않음 — P5·W1),
// [⋯] = 그 줄 ⋯ 메뉴, [삭제] = ⋯ [브리핑만 삭제]와 같은 길(확인 한 번). 오른쪽 밀기 = 여러 개 선택(공용 고르기 막대, 다른 칸 없음 — W3).
async function swipeRow(locator, dx) {
  await expect(async () => {
    const sent = await locator.evaluate((el, dx) => {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 20);
      const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
      fire('pointerdown', x); for (let i = 1; i <= 12; i++) fire('pointermove', x + dx * i / 12); fire('pointerup', x + dx);
      return true;
    }, dx);
    expect(sent).toBe(true);
  }).toPass({ timeout: 10000 });
}
test('BRIEF-밀기메뉴 폰 390: 브리핑 룸 줄 왼쪽 밀기 = 메뉴 칸 [수정][삭제], 오른쪽 밀기 = 여러 개 선택', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const { db } = await open(page);
  const briefDeletes = [];
  await page.route(SB + '/rest/v1/rpc/app_document_brief_delete', r => { briefDeletes.push(r.request().postDataJSON()); return r.fulfill({ status: 204, body: '' }); });
  const ends = list(page).locator('[data-row-swipe-act="end"]');
  // 끝까지 밀어도 칸만 펼쳐진다.
  await expect(async () => { await swipeRow(row(page, 2), -430); await expect(ends.first()).toBeVisible({ timeout: 1000 }); }).toPass({ timeout: 15000 });
  await expect(ends.locator('.row-swipe-tx')).toHaveText(['수정', '삭제']);
  await page.waitForTimeout(400);
  await expect(page.locator('.kptu-ask')).toHaveCount(0);
  expect(briefDeletes).toEqual([]);
  // [삭제] = 브리핑 + 자료(확인 한 번) — 취소하면 그대로.
  await expect(async () => { await swipeRow(row(page, 2), -200); await expect(ends.first()).toBeVisible({ timeout: 1000 }); }).toPass({ timeout: 15000 });
  await list(page).locator('[data-row-swipe-key="delete"]').click();
  const ask = page.locator('.kptu-ask');
  await expect(ask).toContainText('브리핑과 자료를 삭제할까요?');
  await ask.locator('.kptu-ask-actions button').first().click();
  await expect(ask).toHaveCount(0);
  expect(briefDeletes).toEqual([]);
  // 오른쪽 밀기 = 그 줄이 골라진 채 여러 개 선택(칸이 열려 남지 않음), 막대 [전체 선택][옮기기][삭제].
  const bar = page.locator('#briefView .row-swipe-pickbar');
  await swipeRow(row(page, 1), 80);
  await expect(bar).toBeVisible();
  await expect(bar.locator('.row-swipe-pick-count')).toHaveText('1개 선택됨');
  await expect(list(page).locator('.row-swipe-acts')).toHaveCount(0);
  await expect(bar.locator('[data-row-pick-all]')).toContainText('전체 선택');
  await expect(bar.locator('[data-row-pick-act]')).toHaveText(['옮기기', '삭제']);
  await row(page, 3).click();
  await expect(bar.locator('.row-swipe-pick-count')).toHaveText('2개 선택됨');
  await expect(detail(page)).toBeHidden(); // 고르는 중 줄 누르기는 열지 않는다
  await bar.locator('[data-row-pick-act="delete"]').click();
  await expect(ask).toContainText('2개 브리핑과 자료를 삭제할까요?'); // 지우는 길은 brief-room-delete.spec.mjs가 본다
  await ask.locator('.kptu-ask-actions button').first().click(); // 취소
  await expect(ask).toHaveCount(0);
  expect(briefDeletes).toEqual([]);
  expect(db.writes.filter(w => w.table === 'items' && w.method === 'DELETE').length).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'docs/design/screens/s71-30/phone-390-swipe.png', fullPage: false });
  expect(errors).toEqual([]);
});
