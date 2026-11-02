import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';

// APP-공유노트할일(앱 0.4.8): 폰 공유 창 '웹2 노트'·'웹2 할 일'. 받기는 정리함과 같은 길(다리 목록 + __share 파일 한 번씩)이고,
// 작은 저장 창에서 [저장]하면 노트(app_notes + 첨부) 또는 할 일(google-tasks create + 첨부)로 들어간다. 앱 다리·서버는 시험용 흉내.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.8';
const ID = 'ShareTargetId_0123456789ab';
test.use({userAgent:ANDROID, viewport:{width:412, height:915}, hasTouch:true});

async function fixture(page, list) {
  const errors = [], state = {notePosts:[], uploads:[], taskCreates:[], taskAttach:[], shareReads:[]};
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
    await page.route(SB + '/rest/v1/app_note_folders**', route => route.fulfill({json:[]}));
    await page.route(SB + '/rest/v1/app_notes**', route => {
      const req = route.request();
      if (req.method() === 'POST') {
        const b = req.postDataJSON(); state.notePosts.push(b);
        return route.fulfill({status:201, json:[{id:'note-from-share', kind:'note', workspace_id:b.workspace_id, title:b.title, raw_text:b.raw_text, attachments:[], metadata:b.metadata || {}, created_at:'2026-11-02T01:00:00Z', updated_at:'2026-11-02T01:00:00Z', occurred_at:'2026-11-02T01:00:00Z', doc:null, ai_export_allowed:true}]});
      }
      return route.fallback();
    });
    await page.route(SB + '/functions/v1/basket-files**', route => {
      const body = route.request().postDataBuffer()?.toString('latin1') || '';
      const noteId = body.match(/name="note_id"\r\n\r\n([^\r]*)/)?.[1] || null;
      const file = Buffer.from(body.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8');
      state.uploads.push({noteId, file});
      return route.fulfill({json:{ok:true, note_id:noteId, attachments:state.uploads.map((u, i) => ({drive_file_id:'f' + i, file_name:u.file, mime_type:'image/gif', size_bytes:6}))}});
    });
    await page.route(SB + '/rest/v1/app_task_attachments**', route => route.fulfill({json:[]}));
    await page.route(SB + '/functions/v1/google-tasks?action=create**', route => {
      const b = route.request().postDataJSON(); state.taskCreates.push(b);
      return route.fulfill({json:{ok:true, task:{id:'task-from-share', taskListId:'list1', title:b.title, notes:b.notes, due:b.due ? b.due + 'T00:00:00.000Z' : null, status:'needsAction'}, links:[]}});
    });
    await page.route(SB + '/functions/v1/google-tasks?action=attach**', route => {
      const body = route.request().postDataBuffer()?.toString('latin1') || '';
      state.taskAttach.push(Buffer.from(body.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8'));
      return route.fulfill({json:{ok:true, files:state.taskAttach.map((n, i) => ({drive_file_id:'t' + i, file_name:n, size_bytes:6}))}});
    });
  }});
  return {state, errors};
}
const modal = page => page.locator('#shareTargetModal:not(.hidden)');
const notice = page => page.locator('#kptuNotice:not([hidden])');

test('웹2 노트: 링크는 페이지 제목이 노트 제목, 한 줄 더하기 + 사진은 노트 첨부 412', async ({page}, info) => {
  const {state, errors} = await fixture(page, {id:ID, target:'note', subject:'기사 제목', text:'https://news.example/a', items:[{i:0, name:'사진1.gif', type:'image/gif', size:6}, {i:1, name:'사진2.gif', type:'image/gif', size:6}]});
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).getByRole('heading')).toHaveText('노트에 넣기');
  await expect(modal(page).locator('[data-st-what]')).toContainText('기사 제목');
  await expect(modal(page).locator('[data-st-folder]')).toHaveText('폴더 없음 ▾');
  // 정리함으로 바로 넣지 않는다.
  expect(state.notePosts).toEqual([]);
  expect(state.shareReads).toEqual([0, 1].map(i => `/app/__share/${ID}/${i}`));
  await page.screenshot({path:info.outputPath('share-note-412.png')});
  // 저장 창이 하단바에 가리지 않는다.
  const box = await modal(page).locator('[data-st-save]').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(915);
  await modal(page).getByRole('textbox', {name:'한 줄 더하기'}).fill('읽어 볼 것');
  await modal(page).getByRole('button', {name:'저장'}).tap();
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('노트에 넣었어요');
  await expect(page.locator('#shareTargetModal')).toHaveClass(/hidden/);
  expect(state.notePosts).toHaveLength(1);
  expect(state.notePosts[0]).toMatchObject({kind:'note', title:'기사 제목', raw_text:'읽어 볼 것\n기사 제목\nhttps://news.example/a'});
  expect(state.uploads).toEqual([{noteId:'note-from-share', file:'사진1.gif'}, {noteId:'note-from-share', file:'사진2.gif'}]);
  expect(state.taskCreates).toEqual([]);
  expect(await page.evaluate(() => window.__shareSent)).toEqual(expect.arrayContaining([`share:done:${ID}`]));
  expect(errors).toEqual([]);
});

test('웹2 할 일: 글이 제목, 링크는 메모, [내일] 기한 + 파일은 할 일 첨부 412', async ({page}, info) => {
  const {state, errors} = await fixture(page, {id:ID, target:'task', subject:'', text:'자료 보내기 https://drive.example/f', items:[{i:0, name:'회의.pdf', type:'application/pdf', size:8}]});
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).getByRole('heading')).toHaveText('할 일에 넣기');
  const title = modal(page).getByRole('textbox', {name:'할 일 제목'});
  await expect(title).toHaveValue('자료 보내기');
  for (const label of ['오늘', '내일', '모레', '다음주', '기한 없음']) await expect(modal(page).getByRole('button', {name:label, exact:true})).toBeVisible();
  await modal(page).getByRole('button', {name:'내일', exact:true}).tap();
  await expect(modal(page).getByRole('button', {name:'내일', exact:true})).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({path:info.outputPath('share-task-412.png')});
  await modal(page).getByRole('button', {name:'저장'}).tap();
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('할 일에 넣었어요');
  expect(state.taskCreates).toHaveLength(1);
  const tomorrow = await page.evaluate(() => { const d = new Date(Date.now() + 9 * 3600000 + 86400000); return d.toISOString().slice(0, 10); });
  expect(state.taskCreates[0]).toMatchObject({action:'create', title:'자료 보내기', notes:'https://drive.example/f', due:tomorrow});
  expect(state.taskAttach).toEqual(['회의.pdf']);
  expect(state.notePosts).toEqual([]);
  expect(errors).toEqual([]);
});

test('창을 닫으면 아무것도 넣지 않는다 412', async ({page}) => {
  const {state, errors} = await fixture(page, {id:ID, target:'task', subject:'', text:'그냥 닫기', items:[]});
  await expect(modal(page)).toBeVisible();
  await modal(page).getByRole('button', {name:'닫기'}).tap();
  await expect(page.locator('#shareTargetModal')).toHaveClass(/hidden/);
  expect(state.taskCreates).toEqual([]);
  expect(state.notePosts).toEqual([]);
  expect(errors).toEqual([]);
});
