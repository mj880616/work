import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {noteTrash} from './helpers/note-trash.mjs';

// SHARE-바로넣기(2026-10-30 명진 결정): 폰 앱에서 공유하면 확인 줄·[넣기] 없이 바로 정리함에 들어가고,
// 위쪽 작은 알림 "정리함에 넣었어요 [메모 달기] [되돌리기]", 실패하면 "넣지 못했어요 [다시]". 앱 다리·파일은 시험용 흉내(서버 키 없음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.3.3';
const ID = 'ShareTestId_0123456789abcd';
const NOTE = 'share-note-1';
test.use({userAgent:ANDROID, viewport:{width:412, height:915}, hasTouch:true});

const listOf = items => ({id:ID, subject:'', text:'https://example.org/a 받은 링크', items});
const PHOTOS = [{i:0, name:'사진1.gif', type:'image/gif', size:6}, {i:1, name:'사진2.gif', type:'image/gif', size:6}, {i:2, name:'회의.pdf', type:'application/pdf', size:8}];

async function fixture(page, {list = listOf(PHOTOS), uploadStatus = 200} = {}) {
  const errors = [], state = {notes:[], uploads:[], shareReads:[], patches:[], deletes:[], posts:[], uploadStatus};
  page.on('pageerror', e => errors.push(e.message));
  // 앱 다리 흉내: share:get에 목록을 한 번 답하고, 보낸 말을 모두 남긴다.
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
  let trash;
  await openHome(page, {beforeLoad:async () => {
    trash = await noteTrash(page, SB);
    // 앱이 WebView 안에서 흘려주는 공유 파일(서버로 나가지 않음).
    await page.route('**/app/__share/**', route => { state.shareReads.push(new URL(route.request().url()).pathname); return route.fulfill({status:200, contentType:'application/octet-stream', body:Buffer.from('GIF89a')}); });
    await page.route(SB + '/functions/v1/basket-files**', route => {
      const req = route.request();
      if (req.method() !== 'POST') return route.fulfill({status:404, json:{}});
      const body = req.postDataBuffer()?.toString('latin1') || '';
      const field = name => { const m = body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`)); return m ? Buffer.from(m[1], 'latin1').toString('utf8') : null; };
      const fileName = Buffer.from(body.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8');
      state.uploads.push({raw_text:field('raw_text'), note_id:field('note_id'), file:fileName});
      if (state.uploadStatus !== 200) return route.fulfill({status:state.uploadStatus, json:{error:'denied', code:'drive_denied'}});
      let note = state.notes.find(n => n.id === (field('note_id') || NOTE));
      if (!note) { note = {id:NOTE, kind:'basket', workspace_id:'w', raw_text:field('raw_text') || '', occurred_at:'2026-10-06T01:00:00Z', created_at:'2026-10-06T01:00:00Z', updated_at:'2026-10-06T01:00:00Z', ai_export_allowed:true, attachments:[], metadata:{}, doc:null}; state.notes.push(note); }
      note.attachments.push({drive_file_id:'f' + note.attachments.length, file_name:fileName, mime_type:fileName.endsWith('.pdf') ? 'application/pdf' : 'image/gif', size_bytes:6});
      return route.fulfill({json:{ok:true, note_id:note.id, attachments:note.attachments}});
    });
    await page.route(SB + '/rest/v1/app_notes**', route => {
      const req = route.request(), u = new URL(req.url()), id = u.searchParams.get('id')?.slice(3), kind = u.searchParams.get('kind')?.slice(3);
      if (req.method() === 'GET') return route.fulfill({json:state.notes.filter(n => (!id || n.id === id) && (!kind || n.kind === kind))});
      if (req.method() === 'POST') { const b = req.postDataJSON(); state.posts.push(b); const note = {id:NOTE, kind:'basket', workspace_id:'w', raw_text:b.raw_text, occurred_at:'2026-10-06T01:00:00Z', created_at:'2026-10-06T01:00:00Z', updated_at:'2026-10-06T01:00:00Z', ai_export_allowed:true, attachments:[], metadata:{}, doc:null}; state.notes.push(note); return route.fulfill({status:201, json:[note]}); }
      if (req.method() === 'PATCH') { const b = req.postDataJSON(); state.patches.push({id, ...b}); const note = state.notes.find(n => n.id === id); Object.assign(note, b); return route.fulfill({json:[note]}); }
      if (req.method() === 'DELETE') { state.deletes.push(id); const i = state.notes.findIndex(n => n.id === id); if (i >= 0) trash.take(state.notes.splice(i, 1)[0]); trash.onRestore = back => state.notes.push(back); return route.fulfill({json:[]}); }
      return route.fallback();
    });
    await page.route(SB + '/rest/v1/app_record_links?**', route => new URL(route.request().url()).searchParams.has('note_id') ? route.fulfill({json:[]}) : route.fallback());
  }});
  return {state, errors, trash: () => trash};
}
const notice = page => page.locator('#kptuNotice:not([hidden])');
const sent = page => page.evaluate(() => window.__shareSent.filter(m => m.startsWith('share:')));

test('사진 여러 장·파일을 공유하면 버튼 없이 한 번에 정리함에 들어가고, [메모 달기]로 한 줄을 붙인다 412', async ({page}, info) => {
  const {state, errors} = await fixture(page);
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('정리함에 넣었어요');
  // 알림은 화면 위쪽(하단바에 가리지 않음).
  expect((await notice(page).boundingBox()).y).toBeLessThan(200);
  // 확인 줄·메모 칸·[넣기]·[취소]는 없다.
  await expect(page.locator('.share-intake')).toHaveCount(0);
  await expect(page.getByRole('button', {name:'넣기', exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('basket');
  // 알림이 사라지기 전에 [메모 달기]부터 누른다(목록 확인은 그 뒤).
  await notice(page).getByRole('button', {name:'메모 달기'}).tap();
  const input = notice(page).getByRole('textbox', {name:'메모 한 줄'});
  await expect(input).toBeFocused();
  await page.screenshot({path:info.outputPath('share-memo-412.png')});
  await input.fill('다음 주 회의 자료');
  await input.press('Enter');
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('메모를 달았어요');
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].raw_text).toBe('다음 주 회의 자료\nhttps://example.org/a 받은 링크');
  // 첫 파일과 글로 업데이트 하나를 만들고 나머지를 같은 업데이트에 붙인다. 앱에서 각 파일을 한 번씩만 받는다.
  expect(state.uploads).toEqual([
    {raw_text:'https://example.org/a 받은 링크', note_id:null, file:'사진1.gif'},
    {raw_text:null, note_id:NOTE, file:'사진2.gif'},
    {raw_text:null, note_id:NOTE, file:'회의.pdf'},
  ]);
  expect(state.shareReads).toEqual([0, 1, 2].map(i => `/app/__share/${ID}/${i}`));
  expect(await sent(page)).toEqual(expect.arrayContaining([`share:done:${ID}`]));
  expect(await sent(page)).not.toContain('share:back');
  await page.screenshot({path:info.outputPath('share-saved-412.png')});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // 목록에 방금 넣은 업데이트가 보인다.
  await page.locator('[data-basket-filter="unclassified"]').click();
  await expect(page.locator(`[data-basket-row="${NOTE}"]`)).toBeVisible();

  expect(state.deletes).toEqual([]);
  expect(errors).toEqual([]);
});

test('[되돌리기]는 묻지 않고 정리함 [지우기]와 같은 휴지통 길로 바로 뺀다 412', async ({page}) => {
  const {state, errors, trash} = await fixture(page, {list:listOf([PHOTOS[0]])});
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('정리함에 넣었어요');
  let dialogs = 0; page.on('dialog', d => { dialogs++; void d.dismiss(); });
  await notice(page).getByRole('button', {name:'되돌리기'}).tap();
  await expect.poll(() => state.deletes).toEqual([NOTE]);
  expect(trash().trash.map(n => n.id)).toEqual([NOTE]);
  await expect(page.locator('[data-undo-notice]')).toContainText('휴지통');
  await page.locator('[data-basket-filter="unclassified"]').click();
  await expect(page.locator(`[data-basket-row="${NOTE}"]`)).toHaveCount(0);
  expect(dialogs).toBe(0);
  expect(errors).toEqual([]);
});

test('글만 공유해도 바로 넣는다 412', async ({page}) => {
  const {state, errors} = await fixture(page, {list:{id:ID, subject:'제목 줄', text:'본문 글', items:[]}});
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('정리함에 넣었어요');
  expect(state.posts.map(b => b.raw_text)).toEqual(['제목 줄\n본문 글']);
  expect(state.uploads).toEqual([]);
  await expect(notice(page).getByRole('button', {name:'메모 달기'})).toBeVisible();
  await expect(notice(page).getByRole('button', {name:'되돌리기'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('올리다 실패하면 같은 자리 "넣지 못했어요 [다시]", 다시 누르면 받은 파일로 다시 보낸다 412', async ({page}, info) => {
  const {state, errors} = await fixture(page, {list:listOf(PHOTOS.slice(0, 2)), uploadStatus:403});
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('넣지 못했어요');
  await expect(notice(page)).toHaveClass(/error/);
  await page.screenshot({path:info.outputPath('share-failed-412.png')});
  expect(state.uploads).toHaveLength(1);
  state.uploadStatus = 200;
  await notice(page).getByRole('button', {name:'다시'}).tap();
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('정리함에 넣었어요');
  expect(state.uploads.map(u => u.file)).toEqual(['사진1.gif', '사진1.gif', '사진2.gif']);
  // 파일은 이 화면 메모리의 것을 다시 쓴다(앱에 다시 묻지 않음).
  expect(state.shareReads).toHaveLength(2);
  expect(errors).toEqual([]);
});
