// 빠짐32 공유 페이지 AI 초안(app/share-ai-draft.js): 편집 화면 맨 위 [AI 초안] → 고른 Web2 기록(사업 보고·노트·업데이트)만 재료 →
// 칸별 미리보기 → 고른 칸만 [넣기]로 본문 끝에 들어간다. [넣기] 전에는 본문·페이지가 바뀌지 않고, 넣은 뒤에도 [저장]을 눌러야 저장된다.
// 근거 번호·확인할 것은 본문에 들어가지 않는다. 서버로는 고른 종류·ID와 초점만 간다. Mock Supabase only.
import {test, expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

test.use({hasTouch:true});
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const user = {id:'sad-user', email:'sad@example.org', user_metadata:{display_name:'AI 초안 QA'}};
const WS = 'sad-workspace';
const M1 = 'e0000000-0000-4000-8000-000000000001', N1 = 'f0000000-0000-4000-8000-000000000001', U1 = 'f0000000-0000-4000-8000-000000000002',
  N_OFF = 'f0000000-0000-4000-8000-000000000003', N_SECRET = 'f0000000-0000-4000-8000-000000000004';
const ANSWER = {ok:true, kind:'share_draft', partial:false, skipped:0,
  sections:{
    summary:[{text:'가상철도가 단체협약 해지를 통보해 노조가 철회를 요구하고 있다.', refs:[1, 2]}],
    steps:[{text:'10월 2일 사측이 단체협약 해지를 통보했다.', refs:[1]}],
    schedule:[{text:'10월 30일(목) 14시 국회 앞 기자회견', refs:[2]}],
    issues:[{text:'단체협약 해지 통보 철회', refs:[2]}],
    updates:[],
  },
  checks:['기자회견 시각 확인'],
  sources:[{ref:1, type:'meeting', id:M1, label:'사업 보고', title:'가상지부 임단협 3차', day:'2026-10-02'}, {ref:2, type:'note', id:N1, label:'노트', title:'기자회견 준비', day:'2026-10-25'}]};

function mockApp(page, state) {
  state.writes = []; state.ai = []; state.reads = [];
  return page.route(SB + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const ok = (data, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token:'s-access', refresh_token:'s-refresh', expires_in:3600, expires_at:Math.floor(Date.now() / 1000) + 3600, user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id:WS, user_id:user.id, role:'owner', workspace:{id:WS, slug:'s', name:'웹2'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id:WS, name:'웹2'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id:user.id, display_name:'QA'}]);
    if (path === '/rest/v1/app_meetings' && method === 'GET') { state.reads.push('meetings' + url.search); return ok([{id:M1, title:'3차 교섭', series_name:'가상지부 임단협', round_no:3, meeting_at:'2026-10-02T05:00:00Z', activity_kind:null}]); }
    if (path === '/rest/v1/app_notes' && method === 'GET' && /^eq\.(note|basket)$/.test(url.searchParams.get('kind') || '')) {
      state.reads.push('notes' + url.search);
      const kind = url.searchParams.get('kind').slice(3);
      return ok([
        {id:N1, kind:'note', title:'기자회견 준비', raw_text:'10월 30일 기자회견', metadata:{}, occurred_at:null, updated_at:'2026-10-25T03:00:00Z'},
        {id:U1, kind:'basket', title:'', raw_text:'10.22 대책회의에서 기자회견 하기로 함\n둘째 줄', metadata:{}, occurred_at:'2026-10-22T09:00:00Z', updated_at:'2026-10-22T09:00:00Z'},
        {id:N_OFF, kind:'note', title:'AI 끈 노트', raw_text:'글', metadata:{ai_off:true}, occurred_at:null, updated_at:'2026-10-24T03:00:00Z'},
        {id:N_SECRET, kind:'note', title:'계정', raw_text:'비밀번호: 아무거나', metadata:{}, occurred_at:null, updated_at:'2026-10-23T03:00:00Z'},
      ].filter(n => n.kind === kind));
    }
    if (path === '/functions/v1/ai-assist' && method === 'POST') {
      const body = request.postDataJSON();
      if (body.kind === 'share_draft') { state.ai.push(body); return ok(ANSWER); }
      return ok({});
    }
    if (path === '/rest/v1/app_share_pages') {
      if (method === 'GET') return ok(state.pages);
      const body = request.postDataJSON();
      state.writes.push({method, body});
      if (method === 'POST') { const row = {id:'page-' + (state.pages.length + 1), ...body, updated_at:'2026-11-02T01:00:00.000Z'}; delete row.workspace_id; state.pages.push(row); return ok([row], 201); }
      return ok([]);
    }
    if (path === '/rest/v1/app_share_page_links') return ok([]);
    if (path === '/functions/v1/google-calendar') return ok({connected:false, enabled:false, selected:[], calendars:[], events:[]});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}
async function signIn(page, state) {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mockApp(page, state);
  await page.goto(loginEntry(testOrigin + '/app/'));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout:20000});
  await clickView(page, 'pages');
  return errors;
}
async function openDraft(page, width) {
  const editor = page.locator('[data-sp-editor]');
  if (width < 761) await editor.getByRole('button', {name:'사업영역·링크·AI 초안', exact:true}).click();
  await editor.getByRole('button', {name:'AI 초안', exact:true}).click();
  const d = page.locator('#shareAiDraftDialog');
  await expect(d).toBeVisible();
  return d;
}

for (const width of [412, 1440]) test('share AI draft: pick records, preview by section, insert only the chosen sections, save only on [저장] ' + width, async ({page}) => {
  await page.setViewportSize({width, height:900});
  const state = {pages:[]};
  const errors = await signIn(page, state);
  await page.getByRole('button', {name:'새 공유 페이지', exact:true}).click();
  const editor = page.locator('[data-sp-editor]');
  await editor.locator('[data-sp-title]').fill('현장 소식');
  const box = editor.getByRole('textbox', {name:'본문', exact:true});
  await box.click(); await page.keyboard.type('처음 쓴 글');

  const d = await openDraft(page, width);
  await expect(d.locator('h2')).toHaveText('공유 페이지 AI 초안');
  // AI에 보내지 않는 노트([AI에 보내지 않기]·비밀 모양)는 목록에 없다. 읽기는 AI 허용·보관 안 된 노트·업데이트만.
  await expect(d.locator('[data-sa-pick]')).toHaveCount(3);
  await expect(d.locator(`[data-sa-pick="note:${N_OFF}"]`)).toHaveCount(0);
  await expect(d.locator(`[data-sa-pick="note:${N_SECRET}"]`)).toHaveCount(0);
  expect(state.reads.some(r => r.startsWith('notes') && /archived_at=is\.null/.test(r) && /ai_export_allowed=is\.true/.test(r))).toBe(true);
  await expect(d.locator(`label:has([data-sa-pick="note:${U1}"])`)).toContainText('10.22 대책회의에서 기자회견 하기로 함');
  await expect(d.locator('[data-sa-make]')).toBeDisabled();
  await d.locator(`[data-sa-pick="meeting:${M1}"]`).check();
  await d.locator(`[data-sa-pick="note:${N1}"]`).check();
  await d.locator('[data-sa-focus]').fill('단협 해지 철회');
  await d.locator('[data-sa-make]').click();

  await expect(d.locator('[data-sa-insert]')).toBeVisible();
  expect(state.ai).toEqual([{kind:'share_draft', sources:[{type:'meeting', id:M1}, {type:'note', id:N1}], focus:'단협 해지 철회'}]);
  // 미리보기: 줄이 있는 칸만, 처음엔 모두 골라짐. 근거 번호·확인할 것은 미리보기에만.
  await expect(d.locator('[data-sa-section]')).toHaveCount(4);
  await expect(d.locator('.pd-doc')).toContainText('[근거 1]');
  await expect(d.locator('.pd-checks')).toContainText('기자회견 시각 확인');
  // 아직 [넣기] 전: 본문은 그대로, 페이지 저장 요청 없음.
  await expect(box).not.toContainText('진행 단계');
  expect(state.writes).toEqual([]);
  await d.locator('[data-sa-section="schedule"]').uncheck();
  await d.locator('[data-sa-insert]').click();
  await expect(d).toBeHidden();

  // 넣은 뒤: 처음 글 아래에 고른 칸 제목·줄, 뺀 칸·근거 번호·확인할 것은 없음. 저장은 아직 안 됨.
  await expect(box).toContainText('처음 쓴 글');
  await expect(box.locator('h2')).toHaveText(['한 줄 현황', '진행 단계', '쟁점·요구']);
  await expect(box).toContainText('10월 2일 사측이 단체협약 해지를 통보했다.');
  await expect(box).not.toContainText('기자회견');
  await expect(box).not.toContainText('[근거');
  await expect(editor.locator('[data-sp-dirty]')).toBeVisible();
  expect(state.writes).toEqual([]);
  // ↶ 한 번이면 넣은 것만 빠진다.
  await editor.getByRole('button', {name:'되돌리기', exact:true}).click();
  await expect(box.locator('h2')).toHaveCount(0);
  await expect(box).toContainText('처음 쓴 글');
  await editor.getByRole('button', {name:'다시하기', exact:true}).click();
  await expect(box.locator('h2')).toHaveCount(3);

  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect.poll(() => state.writes.length).toBe(1);
  const saved = JSON.stringify(state.writes[0].body.blocks);
  expect(saved).toContain('진행 단계'); expect(saved).toContain('처음 쓴 글'); expect(saved).not.toContain('근거');
  expect(errors).toEqual([]);
});

test('share AI draft: closing without [넣기] leaves the text as it was', async ({page}) => {
  await page.setViewportSize({width:1440, height:900});
  const state = {pages:[]};
  const errors = await signIn(page, state);
  await page.getByRole('button', {name:'새 공유 페이지', exact:true}).click();
  const editor = page.locator('[data-sp-editor]');
  const box = editor.getByRole('textbox', {name:'본문', exact:true});
  const d = await openDraft(page, 1440);
  await d.locator(`[data-sa-pick="meeting:${M1}"]`).check();
  await d.locator('[data-sa-make]').click();
  await expect(d.locator('[data-sa-insert]')).toBeVisible();
  await d.getByRole('button', {name:'닫기', exact:true}).click();
  await expect(d).toBeHidden();
  await expect(box.locator('h2')).toHaveCount(0);
  await expect(box).not.toContainText('단체협약');
  expect(state.writes).toEqual([]);
  expect(errors).toEqual([]);
});
