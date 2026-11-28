import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';

// S62-22 APP-공유로뉴스보관: 폰 공유 창 'WORK ON+ 저장'(옛 'News 보관')(앱이 목록에 target 'news'를 적음)으로 오면 창 없이 글에서 기사 주소 하나를 골라
// 서버(news-feed ?action=save_url)에 주소만 보내고, 위쪽 작은 알림 한 줄 '저장한 글에 넣었어요 [열기]'. 주소가 없으면 '기사 주소가 없어요 [노트로 넣기]'(SHARE-노트로: 새 노트 길).
// 앱 다리·서버는 시험용 흉내(합성 주소). 화면 사진은 docs/design/screens/s62-22/(PR 첨부용, SHOTS=1일 때만 저장).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.5.11';
const ID = 'ShareNewsId_0123456789abcd';
const ART = 'c0000000-0000-4000-8000-000000000101';
const SHOTS = process.env.SHOTS === '1' ? new URL('../../docs/design/screens/s62-22/', import.meta.url).pathname : '';
test.use({userAgent:ANDROID, viewport:{width:412, height:915}, hasTouch:true});

async function fixture(page, list, reply = {status:200, json:{ok:true, status:'saved', id:ART}}) {
  const errors = [], state = {saves:[], posts:[], other:[]};
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
    await page.route(SB + '/functions/v1/news-feed**', route => {
      const req = route.request(), action = new URL(req.url()).searchParams.get('action');
      if (action !== 'save_url') { state.other.push(action); return route.fulfill({json:{ok:true, sources:[], limits:{}, ai:{month_capped:false}}}); }
      state.saves.push(req.postDataJSON());
      return route.fulfill({status:reply.status, json:reply.json});
    });
    await page.route(SB + '/rest/v1/app_notes**', route => {
      const req = route.request();
      if (req.method() === 'POST') { const b = req.postDataJSON(); state.posts.push(b); return route.fulfill({status:201, json:[{id:'note-1', workspace_id:b.workspace_id, kind:b.kind, title:b.title, raw_text:b.raw_text, metadata:{}, attachments:[], created_at:'2026-11-15T01:00:00Z', updated_at:'2026-11-15T01:00:00Z'}]}); }
      return route.fallback();
    });
  }});
  return {state, errors};
}
const notice = page => page.locator('#kptuNotice:not([hidden])');
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, {recursive:true});
  await page.screenshot({path:SHOTS + name});
}

test('저장(공유): 글에서 주소 하나만 서버로 보내고, 알림 한 줄 [열기], 앱에 끝났다고 알림 412', async ({page}) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'합성 기사 제목', text:'합성 기사 제목\nhttps://news.example.org/a/1?utm_source=share', target:'news', items:[]});
  await expect(notice(page)).toContainText('저장한 글에 넣었어요');
  await expect(notice(page).getByRole('button', {name:'열기'})).toBeVisible();
  expect(state.saves).toEqual([{url:'https://news.example.org/a/1?utm_source=share', title:'합성 기사 제목'}]);
  expect(state.posts).toEqual([]);
  expect(await page.evaluate(() => window.__shareSent)).toContain(`share:done:${ID}`);
  // 알림은 위쪽(하단바에 가리지 않음), 가로 넘침 없음.
  expect((await notice(page).boundingBox()).y).toBeLessThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'share-news-412.png');
  expect(errors).toEqual([]);
});

test('저장(공유): 본문을 못 뽑은 기사는 원문 링크로 보라는 한 줄을 더한다 — 폴드 펼침 880', async ({page}) => {
  await page.setViewportSize({width:880, height:1000});
  const {state, errors} = await fixture(page, {id:ID, subject:'', text:'https://news.example.org/b/2', target:'news', items:[]}, {status:200, json:{ok:true, status:'no_body', id:ART}});
  await expect(notice(page)).toContainText('저장한 글에 넣었어요');
  await expect(notice(page)).toContainText('본문을 못 가져왔어요(원문 링크로 보기)');
  expect(state.saves).toEqual([{url:'https://news.example.org/b/2'}]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'share-news-no-body-880.png');
  expect(errors).toEqual([]);
});

test('저장(공유): 주소가 없는 글은 서버로 보내지 않고 [노트로 넣기]를 누를 때만 새 노트 길로 — PC 1280', async ({page}) => {
  await page.setViewportSize({width:1280, height:900});
  const {state, errors} = await fixture(page, {id:ID, subject:'', text:'주소 없는 합성 메모', target:'news', items:[]});
  await expect(notice(page)).toContainText('기사 주소가 없어요');
  const put = notice(page).getByRole('button', {name:'노트로 넣기'});
  await expect(put).toBeVisible();
  expect(state.saves).toEqual([]);
  expect(state.posts).toEqual([]);
  await shot(page, 'share-news-no-url-1280.png');
  await put.click();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toMatchObject({kind:'note', raw_text:'주소 없는 합성 메모'});
  await expect(notice(page).locator('.kptu-notice-text')).toHaveText('노트에 넣었어요');
  expect(state.saves).toEqual([]);
  expect(errors).toEqual([]);
});

test('저장(공유): 서버가 주소를 거절하면 [다시] 없이 이유 한 줄, 다른 실패는 [다시] 412', async ({page}) => {
  const {state, errors} = await fixture(page, {id:ID, subject:'', text:'https://intra.example/x', target:'news', items:[]}, {status:400, json:{ok:false, error:'URL_REFUSED'}});
  await expect(notice(page)).toContainText('저장한 글에 넣지 못했어요');
  await expect(notice(page)).toContainText('이 주소는 넣을 수 없어요.');
  await expect(notice(page).getByRole('button', {name:'다시'})).toHaveCount(0);
  expect(state.saves).toHaveLength(1);
  expect(errors).toEqual([]);
});
