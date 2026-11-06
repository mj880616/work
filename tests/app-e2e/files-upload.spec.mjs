import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles, UPLOAD_HOST, treeGo } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S49-33 FILES-통합 2-④ 올리기(명진 결정 H-3 같은 이름 한 번 묻기·번호, H-4 200MB 묻기, H-6 노트북 '화면 닫으면 일시 정지 → 다시 열면 남은 조각부터') + 별표.
// 시안 ⑦: PC 바탕화면 파일을 끌어 놓으면 점선 '여기 놓으면 ○○에 올리기'. 폰·폴드는 위 줄 [올리기] → 고르기 창.
// 흉내 서버: upload_open이 자리(UPLOAD_HOST/slot/N)를 열고 조각은 4바이트(server.upChunk). 파일 이름·내용은 모두 가짜.
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const bar = page => root(page).locator('[data-fx-bar]');
const jobsBox = page => root(page).locator('[data-fx-jobs]');
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
const SHOTS = process.env.FILES_UPLOAD_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

async function begin(page, width) {
  const { errors, server } = await start(page, width);
  await installViewPrefsServer(page);
  await page.reload();
  return { errors, server };
}
async function intoDocs(page, width, opts) {
  await openFiles(page, width, opts);
  await treeGo(page, 'od', '');
  await row(page, 'od:OD!1').first().click();
  await expect(root(page).locator('.fx-crumb-now').first()).toHaveText('가짜 문서함');
}
// 바탕화면에서 파일을 끌어 오는 것처럼(브라우저 DataTransfer에 파일을 넣어 dragover·drop).
async function dropFiles(page, target, files) {
  const dt = await page.evaluateHandle(list => {
    const d = new DataTransfer();
    for (const f of list) d.items.add(new File([f.text], f.name, { type: 'text/plain' }));
    return d;
  }, files);
  await target.dispatchEvent('dragenter', { dataTransfer: dt });
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  return dt;
}

test('PC 1440: 바탕화면 파일 끌어 놓기 → 점선 안내 → 같은 이름 한 번 묻기 → 조각으로 직접 올림(토큰 없이) → 전송 목록·목록에 바로', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await begin(page, 1440);
  await intoDocs(page, 1440);
  const pane = root(page).locator('[data-fx-pane-i="0"]');
  const dt = await dropFiles(page, pane, [{ name: '가짜 메모.txt', text: '같은 이름 열 글자' }, { name: '가짜 새 글.txt', text: '0123456789' }]);
  await expect(pane).toHaveClass(/fx-drop-up/);
  await expect(pane).toHaveAttribute('data-fx-uptext', '여기 놓으면 가짜 문서함에 올리기');
  await shot(page, 'files-upload-drop-1440');
  await pane.dispatchEvent('drop', { dataTransfer: dt });
  await expect(pane).not.toHaveClass(/fx-drop-up/);
  const askBox = root(page).locator('[data-fx-askbox] .fx-ask');
  await expect(askBox).toContainText('가짜 메모.txt — 같은 이름이 있어요. 그래도 올릴까요?');
  await shot(page, 'files-upload-same-name-1440');
  await askBox.getByRole('button', { name: '그래도 하기' }).click();
  await expect.poll(() => edgeCalls(server, 'upload_open').length).toBe(2);
  expect(edgeCalls(server, 'upload_open')[0].body).toEqual({ action: 'upload_open', confirm: true, to_source: 'od', to: 'OD!1', name: '가짜 메모.txt', size: Buffer.byteLength('같은 이름 열 글자'), mime: 'text/plain' });
  await expect.poll(() => server.jobs.filter(j => j.status === 'done').length, { timeout: 15000 }).toBe(2);
  // 조각은 클라우드 자리로 바로(Edge를 거치지 않음, 토큰 없음). 4바이트씩 이어서.
  expect(server.puts.length).toBeGreaterThan(4);
  expect(server.puts.every(p => p.url.startsWith(UPLOAD_HOST) && !p.auth)).toBe(true);
  expect(server.puts.filter(p => p.url.endsWith('/slot/2')).map(p => p.range)).toEqual(['bytes 0-3/10', 'bytes 4-7/10', 'bytes 8-9/10']);
  expect(server.doneBody).toMatchObject({ action: 'upload_done', confirm: true, item_id: 'cloudNew2' });
  // 목록에 번호 붙은 새 파일이 바로 보인다.
  await expect(row(page, 'od:OD!U01')).toContainText('가짜 메모 (2).txt');
  await expect(row(page, 'od:OD!U02')).toContainText('가짜 새 글.txt');
  expect(errors).toEqual([]);
});

test('PC 1440 H-6: 올리는 중 화면을 숨기면 일시 정지(서버 줄) → 다시 보이면 남은 조각부터 / 다시 연 화면은 같은 파일을 골라야 이어 올림', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await begin(page, 1440);
  await intoDocs(page, 1440);
  const pane = root(page).locator('[data-fx-pane-i="0"]');
  server.slotHold = true;
  const dt = await dropFiles(page, pane, [{ name: '가짜 긴 글.txt', text: 'abcdefghijkl' }]);
  await pane.dispatchEvent('drop', { dataTransfer: dt });
  await expect.poll(() => server.puts.length).toBe(1);
  // 숨김: 조각을 멈추고 서버 줄을 '일시 정지'로(닫히는 화면에서도 가는 keepalive 요청).
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => edgeCalls(server, 'job_pause').length).toBe(1);
  const j = () => server.jobs[0];
  expect(edgeCalls(server, 'job_pause')[0].body).toEqual({ action: 'job_pause', confirm: true, ids: [j().id] });
  expect(j().status).toBe('paused');
  server.slotHold = false;
  await page.waitForTimeout(300);
  // 다시 보이면 쥐고 있던 파일로 서버에 '어디까지'를 묻고(upload_resume) 남은 조각부터.
  const before = edgeCalls(server, 'upload_resume').length;
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => edgeCalls(server, 'upload_resume').length).toBeGreaterThan(before);
  await expect.poll(() => j().status, { timeout: 15000 }).toBe('done');
  // 다시 연 화면(파일을 잊음): 멈춘 줄은 [이어 올리기] + '같은 파일을 다시 골라 주세요', 다른 파일이면 거절, 같은 파일이면 남은 조각부터.
  server.slotHold = true;
  const dt2 = await dropFiles(page, pane, [{ name: '가짜 둘째.txt', text: '0123456789' }]);
  await pane.dispatchEvent('drop', { dataTransfer: dt2 });
  await expect.poll(() => server.puts.filter(p => p.url.endsWith('/slot/2')).length).toBe(1);
  server.jobs[1].status = 'paused';
  await page.reload();
  server.slotHold = false;
  await openFiles(page, 1440);
  await root(page).locator('[data-fx-xfer] [data-fx-jobs-open]').click();
  const line = jobsBox(page).locator('.fx-job', { hasText: '가짜 둘째.txt' });
  await expect(line.locator('small')).toContainText('이어 올리려면 같은 파일을 다시 골라 주세요');
  await shot(page, 'files-upload-reopen-1440');
  let chooser = page.waitForEvent('filechooser');
  await line.locator('[data-fx-job-act="reup"]').click();
  await (await chooser).setFiles(file('가짜 둘째.txt', '다른 내용 길이'));
  await expect(page.locator('#kptuNotice')).toContainText('같은 파일이 아니에요');
  chooser = page.waitForEvent('filechooser');
  await line.locator('[data-fx-job-act="reup"]').click();
  await (await chooser).setFiles(file('가짜 둘째.txt', '0123456789'));
  await expect.poll(() => server.jobs[1].status, { timeout: 15000 }).toBe('done');
  // 남은 조각부터(처음 4바이트는 다시 보내지 않음).
  expect(server.puts.filter(p => p.url.endsWith('/slot/2')).map(p => p.range).filter(r => r === 'bytes 0-3/10')).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const width of [412, 884]) {
  test(`${width}: 위 줄 [올리기] → 고르기 창 → 여러 개 올림, 전송 줄·목록 · 별표 누르기([별표] 탭에 바로)`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await begin(page, width);
    await intoDocs(page, width);
    const upBtn = root(page).locator('[data-fx-upload]');
    await expect(upBtn).toBeVisible();
    await shot(page, `files-upload-button-${width}`);
    const chooser = page.waitForEvent('filechooser');
    await upBtn.click();
    await (await chooser).setFiles([file('가짜 폰 사진 설명.txt', 'abcdef'), file('가짜 회의 메모.txt', '123')]);
    await expect.poll(() => server.jobs.filter(j => j.status === 'done').length, { timeout: 15000 }).toBe(2);
    await expect(row(page, 'od:OD!U01')).toBeVisible();
    // 전송 목록: 기기에서 올린 두 줄이 '끝'으로(전송 줄은 끝난 뒤 사라짐 — 목록은 서버 작업표에서 다시 읽음).
    expect(server.jobs.map(j => j.origin)).toEqual(['device', 'device']);
    // 별표: 고르기(Ctrl+누름 — S51-27부터 PC 우클릭은 줄 메뉴) → 막대 [☆ 별표] → 서버에 기억, ★ 표시.
    await row(page, 'od:OD!11').click({ modifiers: ['Control'] });
    await expect(bar(page).locator('[data-fx-star]')).toHaveText('☆ 별표');
    await shot(page, `files-star-bar-${width}`);
    await bar(page).locator('[data-fx-star]').click();
    await expect.poll(() => edgeCalls(server, 'star').at(-1)?.body).toEqual({ action: 'star', confirm: true, source: 'od', ids: ['OD!11'], on: true });
    await expect(row(page, 'od:OD!11').locator('.fx-star')).toBeVisible();
    // 나무 '★ 별표'에 바로(폰은 ‹ 로 나무까지 돌아가서). 개수도 늘어난다.
    if (width < 761) for (let i = 0; i < 4 && !(await root(page).locator('[data-fx-tree]').isVisible()); i++) await root(page).locator('[data-fx-up]').click();
    await expect(root(page).locator('[data-fx-tree] [data-fx-shelf="starred"]').locator(width < 761 ? '.ft-num' : '.nx-num')).toHaveText('2개');
    await root(page).locator('[data-fx-tree] [data-fx-shelf="starred"]').first().click();
    await expect(row(page, 'od:OD!11')).toBeVisible();
    await expect(row(page, 'od:OD!12')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('PC 1440: 미리보기 ☆ 누르기로 켜고 끄기', async ({ page }) => {
  const { errors, server } = await begin(page, 1440);
  await intoDocs(page, 1440);
  await row(page, 'od:OD!13').click();
  const star = root(page).locator('[data-fx-prev] [data-fx-star-one]');
  await expect(star).toHaveText('☆');
  await star.click();
  await expect(star).toHaveText('★');
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'files-star-preview-1440');
  await star.click();
  await expect(star).toHaveText('☆');
  expect(edgeCalls(server, 'star').map(c => c.body.on)).toEqual([true, false]);
  expect(errors).toEqual([]);
});
