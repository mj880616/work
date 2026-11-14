import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';

// APP-공유노트할일(요청함 11/02 00:22): 폰 공유 창 '웹2 노트'·'웹2 할 일'(앱이 목록에 target을 적음)로 오면 바로 넣지 않고 작은 창
// (제목·폴더/기한·한 줄 더하기 → [저장])을 띄워 노트·할 일 화면과 같은 서버 길로 넣는다. 앱 다리·파일·서버는 시험용 흉내.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.10';
const ID = 'ShareTargetId_0123456789ab';
const NOTE = 'share-target-note-1';
test.use({userAgent:ANDROID, viewport:{width:412, height:915}, hasTouch:true});

async function fixture(page, list) {
  const errors = [], state = {posts:[], patches:[], uploads:[], tasks:[], attach:[], shareReads:[]};
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(list => {
    const listeners = [];
    window.__shareSent = [];
    window.__shareList = list;
    window.KPTUAppShell = {
      postMessage(message) {
        window.__shareSent.push(String(message));
        if (String(message).startsWith('share:get:') && window.__shareList) {
          const reply = 'share:list:' + JSON.stringify(window.__shareList);
          window.__shareList = null;
          setTimeout(() => listeners.forEach(fn => fn({data:reply})), 0);
        }
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    };
  }, list);
  await openHome(page, {beforeLoad:async () => {
    await page.route('**/app/__share/**', route => { state.shareReads.push(new URL(route.request().url()).pathname); return route.fulfill({status:200, contentType:'application/octet-stream', body:Buffer.from('GIF89a')}); });
    await page.route(SB + '/rest/v1/app_note_folders**', route => route.fulfill({json:[{id:'fa', name:'업무', parent_id:null, sort_order:0}, {id:'fb', name:'회의', parent_id:'fa', sort_order:0}]}));
    await page.route(SB + '/rest/v1/app_notes**', route => {
      const req = route.request();
      if (req.method() === 'POST') { const b = req.postDataJSON(); state.posts.push(b); return route.fulfill({status:201, json:[{id:NOTE, workspace_id:b.workspace_id, kind:'note', title:b.title, raw_text:b.raw_text, metadata:{}, attachments:[], created_at:'2026-11-02T01:00:00Z', updated_at:'2026-11-02T01:00:00Z'}]}); }
      if (req.method() === 'GET') return route.fulfill({json:[{id:NOTE, updated_at:'2026-11-02T01:00:00Z', metadata:{}}]});
      if (req.method() === 'PATCH') { const b = req.postDataJSON(); state.patches.push(b); return route.fulfill({json:[{id:NOTE, updated_at:'2026-11-02T01:00:00Z', metadata:b.metadata || {}}]}); }
      return route.fallback();
    });
    await page.route(SB + '/functions/v1/basket-files**', route => {
      const body = route.request().postDataBuffer()?.toString('latin1') || '';
      const noteId = body.match(/name="note_id"\r\n\r\n([^\r]*)/)?.[1] || null;
      state.uploads.push({note_id:noteId, file:Buffer.from(body.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8')});
      return route.fulfill({json:{ok:true, note_id:noteId, attachments:[{drive_file_id:'f' + state.uploads.length, file_name:'a.gif', mime_type:'image/gif', size_bytes:6}]}});
    });
    await page.route(SB + '/functions/v1/google-tasks**', route => {
      const req = route.request(), action = new URL(req.url()).searchParams.get('action');
      if (action === 'create') { const b = req.postDataJSON(); state.tasks.push(b); return route.fulfill({json:{ok:true, task:{id:'task-1', title:b.title, notes:b.notes, due:b.due ? b.due + 'T00:00:00.000Z' : null}, links:[]}}); }
      if (action === 'attach') { state.attach.push(action); return route.fulfill({json:{ok:true, files:[{drive_file_id:'d1', file_name:'a.gif', size_bytes:6}]}}); }
      return route.fallback();
    });
    await page.route(SB + '/rest/v1/app_task_attachments**', route => route.fulfill({json:[]}));
  }});
  return {state, errors};
}
const dialog = page => page.locator('#shareTargetDialog');
const notice = page => page.locator('#kptuNotice:not([hidden])');

test('노동조합+ 노트: 링크 제목이 제목, 폴더 고르고 한 줄 더해 저장하면 노트·폴더·첨부가 기존 길로 들어간다 412', async ({page}, info) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'기사 제목', text:'https://example.org/a', target:'note', items:[{i:0, name:'사진1.gif', type:'image/gif', size:6}]});
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('heading')).toHaveText('노동조합+ 노트');
  await expect(dialog(page).getByRole('textbox', {name:'제목'})).toHaveValue('기사 제목');
  // 받기만 하고 [저장] 전에는 아무것도 저장하지 않는다.
  expect(state.posts).toEqual([]);
  expect(state.shareReads).toEqual([]);
  await expect(dialog(page).getByRole('group', {name:'기한'})).toBeHidden();
  const folder = dialog(page).getByRole('combobox', {name:'폴더'});
  await expect(folder).toBeVisible();
  await folder.selectOption('fb');
  await dialog(page).getByRole('textbox', {name:'한 줄 더하기'}).fill('다음 주에 읽기');
  // 창은 화면 위쪽(하단바에 가리지 않음), 가로 넘침 없음.
  expect((await dialog(page).boundingBox()).y).toBeLessThan(120);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('share-note-412.png')});
  await dialog(page).getByRole('button', {name:'저장'}).tap();
  // UX-알림하나로(S59-21): 사진이 함께면 끝 알림은 하단바 위 한 줄 하나('노트에 사진 1장 올렸어요') — 위쪽 '넣었어요'를 또 띄우지 않는다.
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('노트에 사진 1장 올렸어요');
  await expect(notice(page)).toHaveCount(0);
  await expect(dialog(page)).toBeHidden();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({kind:'note', title:'기사 제목', raw_text:'다음 주에 읽기\n\nhttps://example.org/a'});
  expect(state.patches.at(-1).metadata).toMatchObject({folder_id:'fb', folder:'회의'});
  expect(state.uploads).toEqual([{note_id:NOTE, file:'사진1.gif'}]);
  expect(state.shareReads).toEqual([`/app/__share/${ID}/0`]);
  expect(await page.evaluate(() => window.__shareSent)).toContain(`share:done:${ID}`);
  expect(errors).toEqual([]);
});

test('노동조합+ 할 일: 링크 뺀 첫 줄이 제목, 링크는 메모, [내일]을 골라 저장하면 Google 할 일로 간다 412', async ({page}, info) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'', text:'자료 정리 https://example.org/b\n둘째 줄', target:'task', items:[]});
  await expect(dialog(page).getByRole('heading')).toHaveText('노동조합+ 할 일');
  await expect(dialog(page).getByRole('textbox', {name:'제목'})).toHaveValue('자료 정리');
  await expect(dialog(page).getByRole('combobox', {name:'폴더'})).toBeHidden();
  const dues = dialog(page).getByRole('group', {name:'기한'});
  for (const name of ['오늘', '내일', '모레', '다음주', '기한 없음']) await expect(dues.getByRole('button', {name, exact:true})).toBeVisible();
  // S50-36: 새 할 일은 [오늘]이 눌린 채 시작한다(기한 없이 넣으려면 [기한 없음]).
  await expect(dues.getByRole('button', {name:'오늘', exact:true})).toHaveAttribute('aria-pressed', 'true');
  await expect(dues.getByRole('button', {name:'기한 없음'})).toHaveAttribute('aria-pressed', 'false');
  await dues.getByRole('button', {name:'다음주'}).tap();
  await expect(dialog(page).getByRole('group', {name:'다음 주 날짜'}).getByRole('button')).toHaveCount(7);
  await dues.getByRole('button', {name:'내일', exact:true}).tap();
  await expect(dues.getByRole('button', {name:'내일', exact:true})).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog(page).getByRole('group', {name:'다음 주 날짜'})).toBeHidden();
  await page.screenshot({path:info.outputPath('share-task-412.png')});
  await dialog(page).getByRole('button', {name:'저장'}).tap();
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('할 일에 넣었어요');
  expect(state.tasks).toHaveLength(1);
  const tomorrow = await page.evaluate(() => { const d = new Date(Date.now() + 9 * 3600e3 + 86400e3); return d.toISOString().slice(0, 10); });
  expect(state.tasks[0]).toMatchObject({action:'create', title:'자료 정리', notes:'둘째 줄\nhttps://example.org/b', due:tomorrow});
  expect(errors).toEqual([]);
});

test('노동조합+ 할 일: 기한을 고르지 않으면 오늘로 저장 412', async ({page}) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'', text:'오늘 할 일', target:'task', items:[]});
  const dues = dialog(page).getByRole('group', {name:'기한'});
  await expect(dues.getByRole('button', {name:'오늘', exact:true})).toHaveAttribute('aria-pressed', 'true');
  await dialog(page).getByRole('button', {name:'저장'}).tap();
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('할 일에 넣었어요');
  const today = await page.evaluate(() => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));
  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0]).toMatchObject({action:'create', title:'오늘 할 일', due:today});
  expect(errors).toEqual([]);
});

test('노동조합+ 할 일: [기한 없음]을 누르면 기한 없이 저장 412', async ({page}) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'', text:'기한 없는 일', target:'task', items:[]});
  const dues = dialog(page).getByRole('group', {name:'기한'});
  await dues.getByRole('button', {name:'기한 없음'}).tap();
  await expect(dues.getByRole('button', {name:'기한 없음'})).toHaveAttribute('aria-pressed', 'true');
  await dialog(page).getByRole('button', {name:'저장'}).tap();
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('할 일에 넣었어요');
  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0]).toMatchObject({action:'create', title:'기한 없는 일', due:null});
  expect(errors).toEqual([]);
});

test('창을 닫으면 저장하지 않고 앱에 끝났다고만 알린다 412', async ({page}) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'', text:'글', target:'task', items:[{i:0, name:'a.pdf', type:'application/pdf', size:8}]});
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', {name:'닫기'}).tap();
  await expect(dialog(page)).toBeHidden();
  expect(state.tasks).toEqual([]);
  expect(state.shareReads).toEqual([]);
  expect(await page.evaluate(() => window.__shareSent)).toContain(`share:done:${ID}`);
  expect(errors).toEqual([]);
});

// BIZ-저장먼저닫기 2차(S59-8): 노트(글)가 저장되면 공유 창은 올리기를 기다리지 않고 닫힌다. 받은 사진은 그 노트의 뒤 줄에서 올라가고,
// 못 올린 것은 하단바 위 한 줄에 남아 [다시 올리기](못 올린 것만, 같은 노트로)로 다시 보낸다. 글 저장이 실패하면 창은 그대로·아무것도 보내지 않는다.
test('노동조합+ 노트: [저장]하면 창이 바로 닫히고 사진은 뒤에서, 못 올리면 [다시 올리기] 412', async ({page}) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'사진 공유', text:'', target:'note', items:[{i:0, name:'사진1.gif', type:'image/gif', size:6}, {i:1, name:'사진2.gif', type:'image/gif', size:6}]});
  let open, tries = 0; const gate = new Promise(resolve => { open = resolve; });
  await page.route(SB + '/functions/v1/basket-files**', async route => {
    tries++; await gate;
    // 둘째 사진의 첫 시도만 거절(다시 보내도 되는 거절).
    if (tries === 2) return route.fulfill({status:400, json:{error:'첨부를 저장하지 못했어요.', code:'bad_file'}});
    return route.fallback();
  });
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', {name:'저장'}).tap();
  await expect(dialog(page)).toBeHidden();
  // UX-알림하나로(S59-21): 사진을 올리는 진행·끝은 하단바 위 한 줄 하나 — 위쪽 작은 알림이 '올리는 중'을 또 말하지 않는다.
  await expect(notice(page)).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
  await expect.poll(() => tries).toBe(1);
  await expect(page.locator('#uploadDock:not([hidden])')).toContainText('2개 올리는 중');
  if (process.env.CAPTURE_DIR) await page.screenshot({path:`${process.env.CAPTURE_DIR}/share-note-saving-412.png`});
  open();
  const line = page.locator('#uploadDock:not([hidden])');
  await expect(line).toContainText('노트에 사진 1장 못 올렸어요');
  await line.getByRole('button', {name:'못 올린 파일 다시 올리기'}).tap();
  await expect(line).toContainText('노트에 사진 1장 올렸어요');
  expect(state.uploads).toEqual([{note_id:NOTE, file:'사진1.gif'}, {note_id:NOTE, file:'사진2.gif'}]);
  expect(tries).toBe(3);
  expect(errors).toEqual([]);
});

// BIZ-저장먼저닫기 3차(S59-18): 웹2 할 일도 할 일(글)이 저장되면 창이 바로 닫히고 받은 사진은 그 할 일의 뒤 줄에서 올라간다.
// 알림은 하단바 위 한 줄 하나(위쪽 '할 일에 넣었어요' 알림과 겹치지 않음). 못 올린 사진은 [다시 올리기]로 그것만, 같은 할 일로.
test('노동조합+ 할 일: [저장]하면 창이 바로 닫히고 사진은 뒤에서, 못 올리면 [다시 올리기] 412', async ({page}) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'', text:'현장 사진 정리', target:'task', items:[{i:0, name:'현장1.gif', type:'image/gif', size:6}, {i:1, name:'현장2.gif', type:'image/gif', size:6}]});
  let open, tries = 0; const gate = new Promise(resolve => { open = resolve; });
  const sent = [];
  await page.route(SB + '/functions/v1/google-tasks**', async route => {
    const req = route.request(), action = new URL(req.url()).searchParams.get('action');
    if (action !== 'attach') return route.fallback();
    const body = req.postDataBuffer()?.toString('latin1') || '';
    sent.push({task:body.match(/name="task_id"\r\n\r\n([^\r]*)/)?.[1], file:Buffer.from(body.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8')});
    tries++; await gate;
    // 둘째 사진의 첫 시도만 거절(서버가 받고 거절 — 다시 보내도 겹치지 않음).
    if (tries === 2) return route.fulfill({status:400, json:{error:'파일 이름이나 형식을 확인해 주세요.', code:'file_metadata_invalid'}});
    return route.fallback();
  });
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', {name:'저장'}).tap();
  await expect(dialog(page)).toBeHidden();
  expect(state.tasks).toHaveLength(1);
  await expect.poll(() => tries).toBe(1);
  const line = page.locator('#uploadDock:not([hidden])');
  await expect(line).toContainText('2개 올리는 중');
  await expect(notice(page)).toHaveCount(0);
  if (process.env.CAPTURE_DIR) await page.screenshot({path:`${process.env.CAPTURE_DIR}/task-share-saving-412.png`});
  open();
  await expect(line).toContainText('할 일에 사진 1장 못 올렸어요');
  await expect(line.locator('.up-dock-note')).toContainText('사진 1장 올렸어요');
  if (process.env.CAPTURE_DIR) await page.screenshot({path:`${process.env.CAPTURE_DIR}/task-share-fail-412.png`});
  await line.getByRole('button', {name:'못 올린 파일 다시 올리기'}).tap();
  await expect(line).toContainText('할 일에 사진 1장 올렸어요');
  expect(sent).toEqual([{task:'task-1', file:'현장1.gif'}, {task:'task-1', file:'현장2.gif'}, {task:'task-1', file:'현장2.gif'}]);
  expect(errors).toEqual([]);
});
