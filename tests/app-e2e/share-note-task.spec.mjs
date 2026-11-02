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

test('웹2 노트: 링크 제목이 제목, 폴더 고르고 한 줄 더해 저장하면 노트·폴더·첨부가 기존 길로 들어간다 412', async ({page}, info) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'기사 제목', text:'https://example.org/a', target:'note', items:[{i:0, name:'사진1.gif', type:'image/gif', size:6}]});
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('heading')).toHaveText('웹2 노트');
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
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('노트에 넣었어요');
  await expect(dialog(page)).toBeHidden();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({kind:'note', title:'기사 제목', raw_text:'다음 주에 읽기\n\nhttps://example.org/a'});
  expect(state.patches.at(-1).metadata).toMatchObject({folder_id:'fb', folder:'회의'});
  expect(state.uploads).toEqual([{note_id:NOTE, file:'사진1.gif'}]);
  expect(state.shareReads).toEqual([`/app/__share/${ID}/0`]);
  expect(await page.evaluate(() => window.__shareSent)).toContain(`share:done:${ID}`);
  expect(errors).toEqual([]);
});

test('웹2 할 일: 링크 뺀 첫 줄이 제목, 링크는 메모, [내일]을 골라 저장하면 Google 할 일로 간다 412', async ({page}, info) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'', text:'자료 정리 https://example.org/b\n둘째 줄', target:'task', items:[]});
  await expect(dialog(page).getByRole('heading')).toHaveText('웹2 할 일');
  await expect(dialog(page).getByRole('textbox', {name:'제목'})).toHaveValue('자료 정리');
  await expect(dialog(page).getByRole('combobox', {name:'폴더'})).toBeHidden();
  const dues = dialog(page).getByRole('group', {name:'기한'});
  for (const name of ['오늘', '내일', '모레', '다음주', '기한 없음']) await expect(dues.getByRole('button', {name, exact:true})).toBeVisible();
  await expect(dues.getByRole('button', {name:'기한 없음'})).toHaveAttribute('aria-pressed', 'true');
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
