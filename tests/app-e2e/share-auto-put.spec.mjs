import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';

// SHARE-바로넣기(2026-10-30 사용자 결정): 폰 앱에서 공유하면 확인 줄·[넣기] 없이 바로 넣는다.
// SHARE-노트로(2026-11-28 사용자 결정 "노트로 보내는 걸로 바꿔서 쓰자, 잊지 말기와는 별개로"): 기본 공유는 잊지 말기가 아니라
// 노트 새 노트 하나(kind note, 폴더 밖)로 들어간다. 글 = 본문(주소는 링크), 사진·파일 = 그 노트 첨부(basket-files 그대로).
// 위쪽 작은 알림 '노트에 넣었어요 [열기]', 실패하면 '넣지 못했어요 [다시]'. 앱 다리·파일·서버는 시험용 흉내(서버 키 없음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.5.32';
const ID = 'ShareTestId_0123456789abcd';
const NOTE = 'share-note-1';
test.use({userAgent:ANDROID, viewport:{width:412, height:915}, hasTouch:true});

const listOf = items => ({id:ID, subject:'', text:'https://example.org/a 받은 링크', items});
const PHOTOS = [{i:0, name:'사진1.gif', type:'image/gif', size:6}, {i:1, name:'사진2.gif', type:'image/gif', size:6}, {i:2, name:'회의.pdf', type:'application/pdf', size:8}];

async function fixture(page, {list = listOf(PHOTOS), postStatus = 201} = {}) {
  const errors = [], state = {notes:[], uploads:[], shareReads:[], posts:[], postStatus};
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
  await openHome(page, {beforeLoad:async () => {
    // 앱이 WebView 안에서 흘려주는 공유 파일(서버로 나가지 않음).
    await page.route('**/app/__share/**', route => { state.shareReads.push(new URL(route.request().url()).pathname); return route.fulfill({status:200, contentType:'application/octet-stream', body:Buffer.from('GIF89a')}); });
    await page.route(SB + '/functions/v1/basket-files**', route => {
      const body = route.request().postDataBuffer()?.toString('latin1') || '';
      const noteId = body.match(/name="note_id"\r\n\r\n([^\r]*)/)?.[1] || null;
      const file = Buffer.from(body.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8');
      state.uploads.push({note_id:noteId, file});
      const note = state.notes.find(n => n.id === noteId);
      note?.attachments.push({drive_file_id:'f' + state.uploads.length, file_name:file, mime_type:file.endsWith('.pdf') ? 'application/pdf' : 'image/gif', size_bytes:6});
      return route.fulfill({json:{ok:true, note_id:noteId, attachments:note?.attachments || []}});
    });
    await page.route(SB + '/rest/v1/app_notes**', route => {
      const req = route.request(), u = new URL(req.url()), id = u.searchParams.get('id')?.slice(3), kind = u.searchParams.get('kind')?.slice(3);
      if (req.method() === 'GET') return route.fulfill({json:state.notes.filter(n => (!id || n.id === id) && (!kind || n.kind === kind))});
      if (req.method() === 'POST') {
        const b = req.postDataJSON(); state.posts.push(b);
        if (state.postStatus !== 201) return route.fulfill({status:state.postStatus, json:{message:'denied'}});
        const note = {id:NOTE, kind:b.kind, workspace_id:b.workspace_id, title:b.title, raw_text:b.raw_text, doc:b.doc || null, occurred_at:'2026-11-28T01:00:00Z', created_at:'2026-11-28T01:00:00Z', updated_at:'2026-11-28T01:00:00Z', ai_export_allowed:true, attachments:[], metadata:b.metadata || {}};
        state.notes.push(note);
        return route.fulfill({status:201, json:[note]});
      }
      return route.fallback();
    });
    await page.route(SB + '/rest/v1/app_record_links?**', route => new URL(route.request().url()).searchParams.has('note_id') ? route.fulfill({json:[]}) : route.fallback());
  }});
  return {state, errors};
}
const notice = page => page.locator('#kptuNotice:not([hidden])');
const sent = page => page.evaluate(() => window.__shareSent.filter(m => m.startsWith('share:')));
const links = doc => JSON.stringify(doc).match(/"href":"[^"]+"/g) || [];

test('사진 여러 장·파일을 공유하면 버튼 없이 새 노트 하나가 되고, 파일은 그 노트 첨부로 올라간다 412', async ({page}, info) => {
  const {state, errors} = await fixture(page);
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('노트에 넣었어요');
  await expect(notice(page).getByRole('button', {name:'열기'})).toBeVisible();
  // 잊지 말기 쪽 단추(메모 달기·되돌리기)는 없다. 확인 줄·[넣기]도 없다.
  await expect(notice(page).getByRole('button', {name:'메모 달기'})).toHaveCount(0);
  await expect(notice(page).getByRole('button', {name:'되돌리기'})).toHaveCount(0);
  await expect(page.getByRole('button', {name:'넣기', exact:true})).toHaveCount(0);
  // 알림은 화면 위쪽(하단바에 가리지 않음). 화면은 옮기지 않는다.
  expect((await notice(page).boundingBox()).y).toBeLessThan(200);
  expect(await page.evaluate(() => window.KPTURouter.current)).toBe('home');
  // 노트 하나(kind note, 폴더 밖 — 폴더 metadata 없음). 잊지 말기(kind basket/update)로는 아무것도 가지 않는다.
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({kind:'note', raw_text:'https://example.org/a 받은 링크', title:'받은 링크'});
  expect(state.posts[0].metadata?.folder_id).toBeUndefined();
  expect(links(state.posts[0].doc)).toEqual(['"href":"https://example.org/a"']);
  // 파일은 모두 그 노트로(노트 첨부 길). 앱에서 각 파일을 한 번씩만 받는다.
  await expect.poll(() => state.uploads.length).toBe(3);
  expect(state.uploads).toEqual(['사진1.gif', '사진2.gif', '회의.pdf'].map(file => ({note_id:NOTE, file})));
  expect(state.shareReads).toEqual([0, 1, 2].map(i => `/app/__share/${ID}/${i}`));
  expect(await sent(page)).toEqual(expect.arrayContaining([`share:done:${ID}`]));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('share-note-saved-412.png')});
  // [열기]: 노트 화면에서 그 노트가 열린다.
  await notice(page).getByRole('button', {name:'열기'}).tap();
  await expect.poll(() => page.evaluate(() => window.KPTURouter.current)).toBe('basket');
  await expect(page.locator('#basketView')).toHaveAttribute('data-kind', 'note');
  expect(errors).toEqual([]);
});

test('글만 공유해도 바로 새 노트로 넣는다(제목 줄 = 노트 제목) — PC 1280', async ({page}) => {
  await page.setViewportSize({width:1280, height:900});
  const {state, errors} = await fixture(page, {list:{id:ID, subject:'제목 줄', text:'본문 글\n둘째 줄 https://example.org/b.', items:[]}});
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('노트에 넣었어요');
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({kind:'note', title:'제목 줄', raw_text:'본문 글\n둘째 줄 https://example.org/b.'});
  // 문장 끝 마침표는 링크에 넣지 않는다.
  expect(links(state.posts[0].doc)).toEqual(['"href":"https://example.org/b"']);
  expect(state.uploads).toEqual([]);
  expect(await sent(page)).toContain(`share:done:${ID}`);
  expect(errors).toEqual([]);
});

test('노트 저장이 실패하면 같은 자리 "넣지 못했어요 [다시]", 다시 누르면 받은 파일로 한 번만 만든다 412', async ({page}, info) => {
  const {state, errors} = await fixture(page, {list:listOf(PHOTOS.slice(0, 2)), postStatus:403});
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('넣지 못했어요');
  await expect(notice(page)).toHaveClass(/error/);
  await page.screenshot({path:info.outputPath('share-note-failed-412.png')});
  expect(state.uploads).toEqual([]);
  state.postStatus = 201;
  await notice(page).getByRole('button', {name:'다시'}).tap();
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('노트에 넣었어요');
  expect(state.posts).toHaveLength(2);
  expect(state.notes).toHaveLength(1);
  await expect.poll(() => state.uploads.map(u => u.file)).toEqual(['사진1.gif', '사진2.gif']);
  // 파일은 이 화면 메모리의 것을 다시 쓴다(앱에 다시 묻지 않음).
  expect(state.shareReads).toHaveLength(2);
  expect(errors).toEqual([]);
});
