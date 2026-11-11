import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openMeetingResult} from './helpers/meeting-open.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {coveredPoints} from './helpers/menu-on-top.mjs';
// S57-23 UI-파일줄메뉴비침(CC가 S57-4 화면 사진에서 봄, 전부터 있던 것): 창 안 파일 줄 ⋯ 메뉴를 열면 아래 줄의 ⋯ 단추가 메뉴 위로 비쳤다.
// 원인: 사업 보고 자료 줄 ⋯(<details class="file-line-more">, ui-standard.css)가 줄마다 position:relative + z-index:2로 제 쌓임 칸을 만들어, 안의 메뉴(z-index:8)는
// 그 칸 안에 갇힌다. 아래 줄의 같은 ⋯ 칸(z-index:2, 문서에서 더 뒤)이 같은 높이에서 뒤쪽 순서로 더 위에 그려지므로 메뉴 위로 비쳤다.
// 이 시험은 '열린 메뉴 안 자리'에서 document.elementFromPoint가 메뉴 안의 것을 돌려주는지(= 메뉴가 그 자리 맨 위인지)를 줄 ⋯ 메뉴가 있는 창마다 본다.
// 서버는 가짜, 파일·회의·할 일 이름은 모두 지어낸 값. 화면 사진은 UI_REVIEW_DIR(+UI_REVIEW_PHASE=before|after)을 줄 때만 찍는다.
const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const reviewDir = process.env.UI_REVIEW_DIR || '', phase = process.env.UI_REVIEW_PHASE || 'after';
const shot = async (page, name) => { if (!reviewDir) return; mkdirSync(reviewDir, {recursive: true}); await page.screenshot({path: `${reviewDir}/${phase}-${name}.png`}); };
const SIZES = [['폰 412', {width: 412, height: 915}], ['PC 1280', {width: 1280, height: 900}]];

// ───────── ① 사업 보고 결과 창 회의자료 줄 (PC는 오른쪽 결과 칸) ─────────
const meeting = {id: 'meeting-1', workspace_id: 'ws', title: '가상 점검 회의', series_name: '가상 점검 회의', meeting_at: '2026-10-10T10:00:00Z', transcript_text: '회의 원문', created_by: 'owner'};
const doc = (i, name) => ({id: 'doc-' + i, workspace_id: 'ws', meeting_id: meeting.id, file_id: 'driveFile' + i, file_name: name, title: name, mime_type: 'application/pdf', drive_url: `https://drive.google.com/file/d/driveFile${i}/view`, file_size: 20480, category: '회의자료'});
for (const [label, size] of SIZES) {
  test(`${label}: 보고 자료 줄 ⋯ 메뉴를 열면 메뉴가 아래 줄 ⋯ 단추보다 위에 그려진다(어느 줄이든)`, async ({page}) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize(size);
    const docs = [doc(0, 'first.pdf'), doc(1, 'second.pdf'), doc(2, 'third.pdf'), doc(3, 'fourth.pdf')];
    await page.route(`${SB}/**`, async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      const ok = data => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data)});
      if (path === '/auth/v1/token') return ok({access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: {id: 'owner', email: 'owner@example.org'}});
      if (path === '/auth/v1/user') return ok({id: 'owner', email: 'owner@example.org'});
      if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: 'ws', user_id: 'owner', role: 'owner', workspace: {id: 'ws', name: '테스트'}}]);
      if (path === '/rest/v1/app_workspaces') return ok([{id: 'ws', name: '테스트'}]);
      if (path === '/rest/v1/app_meetings') return ok([meeting]);
      if (path === '/rest/v1/app_documents') { const id = url.searchParams.get('id')?.replace(/^eq\./, ''), mid = url.searchParams.get('meeting_id')?.replace(/^eq\./, ''); return ok(docs.filter(d => (!id || d.id === id) && (!mid || d.meeting_id === mid))); }
      if (path === '/functions/v1/google-calendar') return ok({connected: false, enabled: false, selected: [], calendars: [], events: []});
      if (path === '/functions/v1/google-tasks') return ok({tasks: []});
      if (path.startsWith('/rest/v1/rpc/')) return ok(null);
      return ok([]);
    });
    await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(BASE + '/app/?view=meetings')}`);
    await signInWithSession(page, 'owner@example.org');
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 15000});
    await openMeetingResult(page, 'meeting-1');
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(4);
    for (const id of ['doc-0', 'doc-1', 'doc-2']) {
      const summary = page.locator(`#mrdMaterials [data-mrd-doc-row="${id}"] .file-line-more > summary`);
      await summary.click();
      const panel = `#mrdMaterials [data-mrd-doc-row="${id}"] .file-line-more-panel`;
      await expect(page.locator(panel)).toBeVisible();
      await page.locator(panel).scrollIntoViewIfNeeded();
      if (id === 'doc-0') await shot(page, `meeting-files-${size.width}`);
      const r = await coveredPoints(page, panel, '#mrdMaterials .file-line-more > summary');
      expect(r.sampled, '재는 자리가 있어야 한다').toBeGreaterThan(3);
      expect(r.bad, `${id} 메뉴가 가려진 자리`).toEqual([]);
      await summary.click(); // 같은 ⋯를 다시 누르면 닫힌다
      await expect(page.locator(`#mrdMaterials [data-mrd-doc-row="${id}"] details.file-line-more`)).not.toHaveAttribute('open', '');
    }
    expect(errors).toEqual([]);
  });
}

// ───────── ② 할 일 [파일 붙이기] 창 줄 ⋯ (공용 줄 ⋯ row-more.js) ─────────
const NOW = '2026-10-21T03:00:00.000Z';
for (const [label, size] of SIZES) {
  test(`${label}: 할 일 파일 붙이기 창 줄 ⋯ 메뉴도 아래 줄 ⋯ 단추보다 위에 그려진다`, async ({browser}) => {
    const context = await browser.newContext({timezoneId: 'Asia/Seoul', viewport: size, hasTouch: size.width < 600, isMobile: size.width < 600});
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(NOW));
    const files = ['old1', 'old2', 'old3', 'old4'].map((id, i) => ({google_task_id: 'a', drive_file_id: id, file_name: `가짜 자료 ${i + 1}.pdf`, mime_type: 'application/pdf', size_bytes: 9}));
    const task = {id: 'a', title: '가짜 자료 준비', taskListId: '@default', taskListTitle: '내 할 일', due: '2026-10-21T00:00:00.000Z', status: 'needsAction', completed: null, notes: '', source: 'google-task'};
    const ok = (route, data, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(data)});
    await page.route(`${SB}/**`, async route => {
      const u = new URL(route.request().url()), p = u.pathname, action = u.searchParams.get('action');
      if (p === '/auth/v1/token') return ok(route, {access_token: 'qa', refresh_token: 'qa', expires_in: 3600, expires_at: 4102444800, user: {id: 'qa-user', email: 'qa@example.org', user_metadata: {display_name: 'QA'}}});
      if (p === '/auth/v1/user') return ok(route, {id: 'qa-user', email: 'qa@example.org', user_metadata: {display_name: 'QA'}});
      if (p === '/rest/v1/app_workspace_members') return ok(route, [{workspace_id: 'qa-ws', user_id: 'qa-user', role: 'owner'}]);
      if (p === '/rest/v1/app_workspaces') return ok(route, [{id: 'qa-ws', name: 'QA Workspace'}]);
      if (p === '/rest/v1/app_profiles') return ok(route, [{user_id: 'qa-user', display_name: 'QA'}]);
      if (p === '/functions/v1/google-calendar') return ok(route, {connected: false, enabled: false, calendars: [], events: []});
      if (p === '/functions/v1/google-tasks' && action === 'overview') return ok(route, {connected: true, authorized: true, tasks: [{...task}]});
      if (p === '/rest/v1/app_task_attachments') return ok(route, files.map(({google_task_id, drive_file_id, file_name, size_bytes}) => ({google_task_id, drive_file_id, file_name, size_bytes})));
      if (p.startsWith('/rest/v1/') || p.startsWith('/functions/v1/')) return ok(route, []);
      return ok(route, {});
    });
    await page.goto(loginEntry(`${BASE}/app/`));
    await signInWithSession(page, 'qa@example.org');
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 10000});
    await expect.poll(() => page.evaluate(() => typeof window.KPTURouter?.go === 'function'), {timeout: 10000}).toBeTruthy();
    await page.evaluate(() => window.KPTURouter.go('tasks', {source: 'qa'}));
    const row = page.locator('#gtTaskBody [data-google-task="a"]');
    await expect(row).toBeVisible({timeout: 10000});
    await row.locator('[data-gt-menu]').click();
    await page.locator('#gtTaskMenu [data-gt-menu-action="files"]').click();
    const dialog = page.locator('#gtFilesModal');
    await expect(dialog.locator('.gt-files-list .gt-file')).toHaveCount(4);
    for (const id of ['old1', 'old2', 'old3']) {
      await dialog.locator(`[data-gt-file-more="${id}"] > summary`).click();
      const panel = `#gtFilesModal [data-gt-file-more="${id}"] .row-more-menu`;
      await expect(page.locator(panel)).toBeVisible();
      if (id === 'old1') await shot(page, `task-files-${size.width}`);
      const r = await coveredPoints(page, panel, '#gtFilesModal [data-gt-file-more] > summary');
      expect(r.sampled).toBeGreaterThan(3);
      expect(r.bad, `${id} 메뉴가 가려진 자리`).toEqual([]);
      await dialog.locator(`[data-gt-file-more="${id}"] > summary`).click(); // 같은 ⋯를 다시 누르면 닫힌다
      await expect(dialog.locator(`[data-gt-file-more="${id}"]`)).not.toHaveAttribute('open', '');
    }
    await context.close();
  });
}

// ───────── ③ 담당조직·프로젝트 상세 자료 줄 ⋯ (<details class="wd-doc-more"> · <details class="ps3-more">) ─────────
// 이 두 줄 ⋯는 줄마다 쌓임 칸을 만들지 않아(z-index 없음) 메뉴(z-index:8)가 같은 칸에서 아래 줄 ⋯ 단추(z-index 자동)보다 위다. 지금 상태를 지키는 시험이다 —
// 누가 이 ⋯ 칸에 z-index를 주면(① 같은 갇힘) 여기서 먼저 걸린다. 줄 모양은 fixture 안 설명대로 두 그리기 함수와 같다.
for (const [label, size] of SIZES) {
  for (const [name, host, summary, panel] of [['담당조직 자료', '#wdDocBody', '.wd-doc-more > summary', '.wd-doc-panel'], ['프로젝트 자료', '#ps3DocBody', '.ps3-more > summary', '.ps3-more-panel']]) {
    test(`${label}: ${name} 줄 ⋯ 메뉴도 아래 줄 ⋯ 단추보다 위에 그려진다`, async ({page}) => {
      await page.setViewportSize(size);
      await page.goto(`${BASE}/tests/app-e2e/file-row-menu-stacking-fixture.html`);
      const sums = page.locator(`${host} ${summary}`);
      await expect(sums).toHaveCount(4);
      for (const i of [0, 1, 2]) {
        await sums.nth(i).click();
        const open = `${host} details[open] ${panel}`;
        await expect(page.locator(open)).toBeVisible();
        if (i === 0) await shot(page, `${name === '담당조직 자료' ? 'org' : 'project'}-docs-${size.width}`);
        const r = await coveredPoints(page, open, `${host} ${summary}`);
        expect(r.sampled).toBeGreaterThan(3);
        expect(r.bad, `${name} ${i + 1}번째 줄 메뉴가 가려진 자리`).toEqual([]);
        await sums.nth(i).click();
        await expect(page.locator(`${host} details[open]`)).toHaveCount(0);
      }
    });
  }
}
