import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles, treeGo } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S49-27 FILES-통합 2-① 복사(명진 결정 H-3 같은 이름 한 번 묻기·번호 붙여 둘 다, H-4 200MB 넘으면 묻기, H-5 폴더째는 같은 저장소 안만).
// 시안 docs/design/files-unified-mockup.html ③ 고르기 막대 · ④ 받을 곳 창(하단바 위, 최근 보낸 곳 칩) · ⑤ 아래 전송 줄. 서버는 흉내(파일 이름은 모두 가짜).
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const bar = page => root(page).locator('[data-fx-bar]');
const sheet = page => root(page).locator('[data-fx-dest]');
const pick = (page, key) => sheet(page).locator(`[data-fx-dest-pick="${key}"]`).first();
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
const SHOTS = process.env.FILES_COPY_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const fake = o => ({ parent_id: null, is_folder: false, mime: null, size_bytes: 1000, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null, ...o });

async function intoDocs(page, width) {
  await openFiles(page, width);
  await treeGo(page, 'od', '');
  await row(page, 'od:OD!1').click();
  await expect(root(page).locator(':is(.fx-crumb-now, .ft-focus-name)')).toHaveText('가짜 문서함');
}
async function begin(page, width) {
  const { errors, server } = await start(page, width);
  const prefs = await installViewPrefsServer(page);
  await page.reload();
  return { errors, server, prefs };
}

test('PC 1440: 선택 막대 [복사] → 받을 곳 창 → 같은 이름 한 번 묻기(그래도 하기 = 번호) → 차례로 복사, 최근 보낸 곳 칩(서버)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server, prefs } = await begin(page, 1440);
  server.items.push(fake({ source: 'gd', item_id: 'gdSame1', parent_id: 'gdFolder1', name: '가짜 안내문.pdf' }));
  await intoDocs(page, 1440);
  await row(page, 'od:OD!11').click({ modifiers: ['Control'] });
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('2개');
  await bar(page).locator('[data-fx-copy]').click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('#fxDestTitle')).toHaveText('2개 복사할 곳');
  // 처음 받을 곳 = 지금 폴더. 구글 드라이브 나무를 펼쳐 폴더를 고른다.
  await expect(sheet(page).locator('.fx-dest-at')).toContainText('가짜 문서함');
  // S54-07: 받을 곳 창은 저장소가 모두 접힌 채 열리고(전엔 처음부터 펼쳐져 있었다), 지금 폴더는 미리 골라져 바로 보낼 수 있다.
  await expect(sheet(page).locator('[data-fx-dest-twist]')).not.toHaveCount(0);
  await expect(sheet(page).locator('[data-fx-dest-twist][aria-expanded="true"]')).toHaveCount(0);
  await expect(sheet(page).locator('[data-fx-dest-pick]:not([data-fx-dest-pick$=":"])')).toHaveCount(0);
  await expect(sheet(page).locator('[data-fx-dest-go]')).toBeEnabled();
  await pick(page, 'gd:').click();
  await expect(pick(page, 'gd:gdFolder1')).toBeVisible();
  await pick(page, 'gd:gdFolder1').click();
  await expect(sheet(page).locator('.fx-dest-at')).toHaveText('구글 드라이브 › 가짜 업무 공간');
  await expect(sheet(page).locator('[data-fx-dest-go]')).toHaveText('여기에 복사');
  await sheet(page).locator('[data-fx-dest-go]').click();
  const askBox = sheet(page).locator('.fx-ask');
  await expect(askBox).toContainText('가짜 안내문.pdf — 같은 이름이 있어요. 그래도 복사할까요?');
  await expect(askBox.locator('button')).toHaveText(['그래도 하기', '건너뛰기']);
  await expect(askBox.locator('[data-fx-ask-all]')).toHaveCount(0); // 같은 이름은 하나뿐 → '남은 것도 모두 같게' 없음
  await shot(page, 'files-copy-same-name-1440');
  expect(edgeCalls(server, 'job_add')).toHaveLength(0);
  server.jobsHold = true;
  await askBox.getByRole('button', { name: '그래도 하기' }).click();
  await expect(sheet(page)).toBeHidden();
  // S49-28: 복사는 서버 작업표로 한 번에(같은 이름 [그래도 하기] = numbered). 화면이 직접 copy를 부르지 않는다.
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(1);
  expect(edgeCalls(server, 'job_add')[0].body).toEqual({ action: 'job_add', confirm: true, kind: 'copy', to_source: 'gd', to: 'gdFolder1',
    items: [{ source: 'od', id: 'OD!11', numbered: true }, { source: 'od', id: 'OD!13' }] });
  expect(edgeCalls(server, 'copy')).toHaveLength(0);
  // PC: 전송 줄을 누르면 오른쪽 아래 작은 전송 목록(시안 ⑧).
  const strip = root(page).locator('[data-fx-xfer]');
  await expect(strip.locator('b')).toHaveText('1/2 보내는 중');
  await strip.locator('[data-fx-jobs-open]').click();
  const jobs = root(page).locator('[data-fx-jobs]');
  await expect(jobs).toBeVisible();
  await expect(jobs.locator('#fxJobsTitle')).toHaveText('전송 · 1/2');
  await expect(jobs.locator('.fx-job-st')).toHaveText(['기다림', '기다림']);
  const jb = await jobs.boundingBox();
  expect(jb.x + jb.width).toBeGreaterThan(1440 - 40);
  expect(jb.width).toBeLessThanOrEqual(400);
  await shot(page, 'files-jobs-1440');
  server.jobsHold = false;
  await expect(jobs.locator('.fx-job-st')).toHaveText(['끝', '끝'], { timeout: 15000 });
  await expect(jobs.locator('.fx-job', { hasText: '가짜 안내문.pdf' }).locator('small')).toContainText("'가짜 안내문 (2).pdf'로");
  await jobs.locator('[data-fx-jobs-close]').click();
  await expect(jobs).toBeHidden();
  expect(server.items.filter(i => i.parent_id === 'gdFolder1').map(i => i.name).sort()).toEqual(['가짜 결과 정리.pdf', '가짜 메모.txt', '가짜 안내문 (2).pdf', '가짜 안내문.pdf'].sort());
  expect(server.items.filter(i => i.item_id === 'OD!11' || i.item_id === 'OD!13').every(i => !i.trashed)).toBe(true); // 원본 그대로
  // 최근 보낸 곳: 서버(view_prefs.files_dest_recent)에 저장, 다음 창 맨 위 칩.
  await expect.poll(() => prefs.patches.at(-1)?.files_dest_recent).toEqual([{ source: 'gd', id: 'gdFolder1', name: '가짜 업무 공간' }]);
  // 같은 파일을 다시 → 이번엔 [건너뛰기]: 아무것도 보내지 않는다.
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await bar(page).locator('[data-fx-copy]').click();
  await expect(sheet(page).locator('.fx-dest-chip')).toHaveText(['가짜 업무 공간']);
  await sheet(page).locator('.fx-dest-chip').click();
  await expect(sheet(page).locator('.fx-dest-chip')).toHaveClass(/on/);
  await shot(page, 'files-copy-sheet-1440');
  await sheet(page).locator('[data-fx-dest-go]').click();
  await sheet(page).locator('.fx-ask').getByRole('button', { name: '건너뛰기' }).click();
  await expect(page.locator('body')).toContainText('1개 건너뜀');
  expect(edgeCalls(server, 'job_add')).toHaveLength(1);
  // S52-43 ② 폴더째 다른 저장소로: 받을 곳에 같은 이름 폴더를 만들고(mkdir) 안의 파일을 전송 목록에 펼쳐 넣는다(H-5는 내 PC·이 폰만 남음).
  await row(page, 'od:OD!10').click({ modifiers: ['Control'] });
  await bar(page).locator('[data-fx-copy]').click();
  await pick(page, 'gd:').click();
  await sheet(page).locator('[data-fx-dest-go]').click();
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(2);
  expect(edgeCalls(server, 'mkdir').map(c => c.body)).toEqual([{ action: 'mkdir', source: 'gd', parent: null, name: '가짜 2026', confirm: true }]);
  expect(edgeCalls(server, 'job_add')[1].body).toEqual({ action: 'job_add', confirm: true, kind: 'copy', to_source: 'gd', to: 'gdNew90', items: [{ source: 'od', id: 'OD!14' }] });
  await expect(page.locator('body')).toContainText('폴더 1개 · 파일 1개 복사 시작');
  await row(page, 'od:OD!10').click({ modifiers: ['Control'] });
  await bar(page).locator('[data-fx-copy]').click();
  // 같은 저장소 안 폴더째 복사는 된다(같은 곳이면 이름 (2)).
  await pick(page, 'od:OD!1').click();
  await sheet(page).locator('[data-fx-dest-go]').click();
  await expect(sheet(page).locator('.fx-ask')).toContainText('가짜 2026 — 같은 이름이 있어요. 그래도 복사할까요?');
  await sheet(page).locator('.fx-ask').getByRole('button', { name: '그래도 하기' }).click();
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(3);
  expect(edgeCalls(server, 'job_add')[2].body).toEqual({ action: 'job_add', confirm: true, kind: 'copy', to_source: 'od', to: 'OD!1', items: [{ source: 'od', id: 'OD!10', numbered: true }] });
  await expect(root(page).locator('[data-fx-list] :is(.fx-name, .ft-name)').filter({ hasText: '가짜 2026 (2)' })).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('폰 412: 꾹 눌러 선택 → [복사] → 하단바 위 받을 곳 창, 200MB 넘는 파일은 묻고 [그래도 보내기] → 서버 조각 이어 보내기, 전송 목록·모두 멈춤·이어 하기·실패 [다시]', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await begin(page, 412);
  server.items.push(fake({ source: 'od', item_id: 'OD!30', parent_id: 'OD!1', name: '가짜 영상.mp4', mime: 'video/mp4', size_bytes: Math.round(1.2 * 1024 ** 3) }));
  await intoDocs(page, 412);
  await row(page, 'od:OD!30').dispatchEvent('contextmenu');
  await row(page, 'od:OD!11').click();
  await row(page, 'od:OD!12').click();
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('3개');
  await expect(bar(page).locator('button')).toHaveText(['복사', '옮기기', '자료실로', '☆ 별표', '휴지통', '✕']);
  await shot(page, 'files-copy-bar-412');
  await bar(page).locator('[data-fx-copy]').click();
  await expect(sheet(page)).toBeVisible();
  // 하단바 위로 열린다(가리지 않음), 가로 넘침 없음.
  const tab = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kptu-mobile-tab-height')) || 0);
  const box = await sheet(page).boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(900 - tab + 1);
  expect(tab).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pick(page, 'gd:').click();
  await expect(pick(page, 'gd:gdFolder1')).toBeVisible();
  await pick(page, 'gd:gdFolder1').click();
  await shot(page, 'files-copy-sheet-412');
  server.jobsHold = true;
  await sheet(page).locator('[data-fx-dest-go]').click();
  // 200MB 넘는 클라우드 사이 파일: 묻는 창 + 옮기는 방식 한 줄. [그래도 보내기] = 서버가 10MB 조각씩 이어 보냄(big:true).
  const askBox = sheet(page).locator('.fx-ask');
  await expect(askBox).toContainText('가짜 영상.mp4 — 200MB가 넘어요(1.2GB). 그래도 보낼까요?');
  await expect(askBox.locator('.fx-ask-note')).toHaveText('서버가 10MB씩 나눠 이어 보내요. 화면을 닫아도 계속되고, 끊기면 끊긴 곳부터 다시. 폰 데이터는 쓰지 않아요.');
  await shot(page, 'files-copy-big-412');
  await askBox.getByRole('button', { name: '그래도 보내기' }).click();
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(1);
  expect(edgeCalls(server, 'job_add')[0].body.items).toEqual([{ source: 'od', id: 'OD!30', big: true }, { source: 'od', id: 'OD!11' }, { source: 'od', id: 'OD!12' }]);
  // 하단바 위 얇은 전송 줄 → 누르면 하단바 위 전송 목록(시안 ⑤).
  const strip = root(page).locator('[data-fx-xfer]');
  await expect(strip).toBeVisible();
  await expect(strip.locator('b')).toHaveText('1/3 보내는 중');
  const sb = await strip.boundingBox();
  expect(sb.y + sb.height).toBeLessThanOrEqual(900 - tab + 1);
  await shot(page, 'files-copy-strip-412');
  server.jobsHold = false;
  await strip.locator('[data-fx-jobs-open]').click();
  const jobs = root(page).locator('[data-fx-jobs]');
  await expect(jobs).toBeVisible();
  const jb = await jobs.boundingBox();
  expect(jb.y + jb.height).toBeLessThanOrEqual(900 - tab + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // 큰 파일은 진행 막대와 몫(%)이 보인다.
  await expect(jobs.locator('.fx-job').last().locator('.fx-job-st')).toHaveText(/^\d+%$/);
  await expect(jobs.locator('.fx-job').last().locator('.fx-job-pg')).toBeVisible();
  await shot(page, 'files-jobs-412');
  // 모두 멈춤 → 서버 줄이 멈춤, 줄마다 [이어 하기]. 화면을 다시 열어도(새로 고침) 서버 목록으로 이어 보인다.
  await jobs.locator('[data-fx-jobs-all="pause"]').click();
  await expect.poll(async () => (await jobs.locator('.fx-job-st').allTextContents()).every(t => t === '멈춤' || t === '끝')).toBe(true);
  await expect(jobs.locator('[data-fx-job-act="resume"]').first()).toBeVisible();
  expect(edgeCalls(server, 'job_pause').at(-1).body).toEqual({ action: 'job_pause', confirm: true, all: true });
  await page.reload();
  await openFiles(page, 412);
  await expect(root(page).locator('[data-fx-xfer] b')).toHaveText(/개 멈춤$/);
  await root(page).locator('[data-fx-jobs-open]').click();
  // 한 줄은 실패로 만들어 까닭·[다시]를 본다.
  server.jobFail = 'no_space';
  await root(page).locator('[data-fx-jobs] [data-fx-jobs-all="resume"]').click();
  const failed = root(page).locator('[data-fx-jobs] .fx-job-failed');
  await expect(failed).toHaveCount(1, { timeout: 15000 });
  await expect(failed.locator('small')).toContainText('받을 곳 공간이 부족해요');
  await shot(page, 'files-jobs-failed-412');
  server.jobFail = '';
  await failed.locator('[data-fx-job-act="retry"]').click();
  await expect(root(page).locator('[data-fx-jobs] .fx-job-st')).toHaveText(['끝', '끝', '끝'], { timeout: 30000 });
  expect(server.items.filter(i => i.parent_id === 'gdFolder1' && !i.trashed).map(i => i.name).sort()).toEqual(['가짜 결과 정리.pdf', '가짜 안내문.pdf', '가짜 영상.mp4', '가짜 예산표.xlsx'].sort());
  await root(page).locator('[data-fx-jobs] [data-fx-jobs-close]').click();
  // 새로고침해도 보던 폴더(주소 자리)에 그대로 있다.
  await expect(root(page).locator(':is(.fx-crumb-now, .ft-focus-name)')).toHaveText('가짜 문서함');
  // 뒤로가기 한 번 = 받을 곳 창 닫힘.
  await row(page, 'od:OD!13').dispatchEvent('contextmenu');
  await bar(page).locator('[data-fx-copy]').click();
  await expect(sheet(page)).toBeVisible();
  await page.goBack();
  await expect(sheet(page)).toBeHidden();
  await expect(root(page).locator(':is(.fx-crumb-now, .ft-focus-name)')).toHaveText('가짜 문서함');
  expect(errors).toEqual([]);
});

test('폴드 884: [옮기기] → 받을 곳 창, 같은 이름이 둘이면 한 번 묻고 남은 것도 모두 같게 → numbered 옮기기', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await begin(page, 884);
  server.items.push(fake({ source: 'od', item_id: 'OD!15', parent_id: 'OD!10', name: '가짜 메모.txt' }),
    fake({ source: 'od', item_id: 'OD!16', parent_id: 'OD!10', name: '가짜 안내문.pdf' }));
  await intoDocs(page, 884);
  await row(page, 'od:OD!10').click();
  await expect(root(page).locator(':is(.fx-crumb-now, .ft-focus-name)')).toHaveText('가짜 2026');
  for (const k of ['od:OD!14', 'od:OD!15', 'od:OD!16']) await row(page, k).click({ modifiers: ['Control'] });
  await bar(page).locator('[data-fx-cut]').click();
  await expect(sheet(page).locator('#fxDestTitle')).toHaveText('3개 옮길 곳');
  await pick(page, 'od:OD!1').click();
  await expect(sheet(page).locator('[data-fx-dest-go]')).toHaveText('여기에 옮기기');
  await sheet(page).locator('[data-fx-dest-go]').click();
  const askBox = sheet(page).locator('.fx-ask');
  await expect(askBox).toContainText('가짜 메모.txt — 같은 이름이 있어요. 그래도 옮길까요?');
  await askBox.locator('[data-fx-ask-all]').check();
  await shot(page, 'files-move-same-name-884');
  await askBox.getByRole('button', { name: '그래도 하기' }).click();
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(1);
  expect(edgeCalls(server, 'move')[0].body).toEqual({ action: 'move', source: 'od', ids: ['OD!14', 'OD!15', 'OD!16'], to: 'OD!1', numbered: true, confirm: true });
  await expect(page.locator('body')).toContainText('3개 옮김');
  expect(server.items.filter(i => i.parent_id === 'OD!1' && !i.trashed).map(i => i.name).sort())
    .toEqual(['가짜 2026', '가짜 계획안.hwpx', '가짜 메모 (2).txt', '가짜 메모.txt', '가짜 안내문 (2).pdf', '가짜 안내문.pdf', '가짜 예산표.xlsx'].sort());
  // 미리보기 [복사] 단추도 같은 창.
  await treeGo(page, 'od', 'OD!1');
  await row(page, 'od:OD!12').click();
  await root(page).locator('[data-fx-prev] [data-fx-copy-one]').click();
  await expect(sheet(page).locator('#fxDestTitle')).toHaveText('1개 복사할 곳');
  await shot(page, 'files-copy-sheet-884');
  await sheet(page).locator('[data-fx-dest-close]').click();
  await expect(sheet(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('폴드 884: 다른 저장소로 복사 → 서버 작업표, 전송 목록은 오른쪽 아래 작은 칸, 끝나면 받은 폴더에 보임', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await begin(page, 884);
  await intoDocs(page, 884);
  await row(page, 'od:OD!12').click({ modifiers: ['Control'] });
  await bar(page).locator('[data-fx-copy]').click();
  await pick(page, 'gd:').click();
  await pick(page, 'gd:gdFolder1').click();
  server.jobsHold = true;
  await sheet(page).locator('[data-fx-dest-go]').click();
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(1);
  await root(page).locator('[data-fx-xfer] [data-fx-jobs-open]').click();
  const jobs = root(page).locator('[data-fx-jobs]');
  await expect(jobs.locator('.fx-job')).toHaveCount(1);
  await expect(jobs.locator('.fx-job small')).toHaveText('원드라이브 → 구글 드라이브 · 62KB');
  await expect(jobs.locator('[data-fx-job-act="pause"]')).toHaveText('멈춤');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'files-jobs-884');
  server.jobsHold = false;
  await expect(jobs.locator('.fx-job-st')).toHaveText('끝', { timeout: 15000 });
  // Esc = 닫기.
  await page.keyboard.press('Escape');
  await expect(jobs).toBeHidden();
  await treeGo(page, 'gd', '');
  await row(page, 'gd:gdFolder1').click();
  await expect(row(page, 'gd:gdJob01')).toBeVisible();
  expect(errors).toEqual([]);
});
