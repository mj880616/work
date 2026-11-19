// S67-06 NEWS-직접넣기 사진 붙여넣기: news-feed ?action=hand_photo_put(사진 한 장 올리기)·?action=hand_photo(내가 올린 사진 보기).
// 시험: 로그인·운영자 기능 키(outside) 작업공간만, 읽을 수 있는 기사만, 그림 종류(머리 바이트까지)·크기 상한, 공유된 폴더 거절,
// 올린 사진은 내 Drive '뉴스 사진' 폴더(Web2 바구니 아래)에만, 보기는 그 기사 본문에 있는 사진만·부른 사람 Drive 연결로만.
// 네트워크 없음(합성 값·example·invalid 주소).
import test from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../../supabase/functions/news-feed/handler.ts');
const P = await import('../../supabase/functions/news-feed/hand-photo.ts');
const NOW = Date.parse('2026-11-19T05:00:00Z');
const SB = 'https://synthetic.supabase.test';
const WS = 'a0000000-0000-4000-8000-000000000001', OTHER = 'a0000000-0000-4000-8000-000000000002';
const USER = 'b0000000-0000-4000-8000-000000000001', JWT = 'synthetic.user.jwt-owner-0001';
const ART = 'c0000000-0000-4000-8000-000000000010', HIDDEN = 'c0000000-0000-4000-8000-000000000099';
const ROOT = 'rootFolder000001', FOLDER = 'newsFolder000001', FILE = 'driveFile0000000001';
const FN = `${SB}/functions/v1/news-feed`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);

function world({newsWs = WS, members = [{user_id: USER, workspace_id: WS}], basket = ROOT, folderPerms = [{type: 'user', role: 'owner'}], blocks = [], drive = true} = {}) {
  const calls = {uploads: [], drive: 0, thumbs: 0, metaFor: []};
  const res = (v, s = 200, type = 'application/json') => new Response(v === null ? null : v instanceof Uint8Array || type !== 'application/json' ? v : JSON.stringify(v), {status: s, headers: {'content-type': type}});
  const folder = {id: FOLDER, name: '뉴스 사진', mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, parents: [ROOT], permissions: folderPerms};
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    if (u.host === 'oauth2.googleapis.com') { calls.drive++; return res({access_token: 'synthetic-drive-access'}); }
    if (u.host === 'www.googleapis.com') {
      calls.drive++;
      if (u.pathname === '/drive/v3/files' && method === 'GET') return res({files: [folder]});
      if (u.pathname === `/drive/v3/files/${FOLDER}`) return res(folder);
      if (u.pathname === '/upload/drive/v3/files' && method === 'POST') { calls.uploads.push(JSON.parse(init.body)); return new Response('', {status: 200, headers: {location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=x'}}); }
      if (u.pathname === '/upload/drive/v3/files' && method === 'PUT') return res({id: FILE});
      if (u.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
        const id = u.pathname.split('/').pop();
        calls.metaFor.push(id);
        if (id !== FILE) return res({}, 404);
        return res({id: FILE, mimeType: 'image/png', ownedByMe: true, trashed: false, size: '19', thumbnailLink: 'https://lh3.googleusercontent.com/thumb=s220'});
      }
      return res({}, 404);
    }
    if (u.host === 'lh3.googleusercontent.com') { calls.thumbs++; return res(PNG, 200, 'image/png'); }
    if (u.origin !== SB) return res('', 404, 'text/plain');
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === `Bearer ${JWT}` ? res({id: USER}) : res({}, 401);
    const p = u.pathname.replace('/rest/v1/', '');
    if (init.headers?.apikey === 'synthetic-anon') {
      if (p === 'rpc/app_news_article_of') return res([]);
      if (p === 'app_news_articles') { const id = u.searchParams.get('id')?.slice(3); return res(id === ART ? [{id: ART, url_key: 'news.example.org/a/1', url: 'https://news.example.org/a/1', state: 'failed'}] : []); }
      throw new Error('unexpected user read ' + p);
    }
    if (p === 'app_workspace_members') return res(members.filter(m => `eq.${m.user_id}` === u.searchParams.get('user_id')).map(m => ({workspace_id: m.workspace_id})));
    if (p === 'rpc/app_operator_feature_workspace') return res(newsWs);
    if (p === 'app_drive_settings') return res(basket ? [{basket_folder_id: basket}] : []);
    if (p === 'public_policy_drive_config') return res([{google_client_id: 'synthetic-client', google_client_secret: 'synthetic-secret'}]);
    if (p === 'app_drive_connections') return res(drive ? [{google_refresh_token: 'synthetic-refresh', workspace_id: WS}] : []);
    if (p === 'app_news_article_bodies') return res(u.searchParams.get('article_id') === `eq.${ART}` ? [{blocks}] : []);
    throw new Error('unexpected ' + method + ' ' + p);
  };
  const handler = H.createNewsFeedHandler({env: k => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', SUPABASE_ANON_KEY: 'synthetic-anon', NEWS_FEED_CRON_SECRET: 'synthetic-news-feed-cron-secret-0123456789abc'})[k],
    fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {}});
  async function put({id = ART, bytes = PNG, type = 'image/png', name = 'image.png', auth = `Bearer ${JWT}`, extra = null, length = null} = {}) {
    const fd = new FormData();
    fd.append('id', id);
    fd.append('file', new File([bytes], name, {type}));
    if (extra) fd.append(extra, 'x');
    const req = new Request(`${FN}?action=hand_photo_put`, {method: 'POST', headers: auth ? {authorization: auth} : {}, body: fd});
    const body = new Uint8Array(await req.arrayBuffer());
    const headers = {'content-type': req.headers.get('content-type'), 'content-length': String(length ?? body.length), ...(auth ? {authorization: auth} : {})};
    return handler(new Request(`${FN}?action=hand_photo_put`, {method: 'POST', headers, body}));
  }
  const view = (body, auth = `Bearer ${JWT}`) => handler(new Request(`${FN}?action=hand_photo`, {method: 'POST', headers: {'content-type': 'application/json', ...(auth ? {authorization: auth} : {})}, body: JSON.stringify(body)}));
  return {calls, put, view};
}
const out = async r => ({status: r.status, body: await r.json()});
const SRC = `https://${P.OWN_PHOTO_HOST}/${FILE}.png`;

test('hand_photo_put: login and the operator feature key are required, nothing goes to Drive otherwise', async () => {
  const w = world();
  assert.equal((await w.put({auth: null})).status, 401);
  assert.equal((await w.put({auth: 'Bearer bad.jwt.value-000000000000'})).status, 401);
  const v = world({newsWs: OTHER});
  assert.deepEqual(await out(await v.put()), {status: 403, body: {ok: false, error: 'FEATURE_OFF'}});
  assert.equal(v.calls.drive, 0);
  // 읽을 수 없는 기사(다른 사람 것·없는 것)는 404, Drive에 올리지 않음.
  const x = world();
  assert.deepEqual(await out(await x.put({id: HIDDEN})), {status: 404, body: {ok: false, error: 'NOT_FOUND'}});
  assert.equal(x.calls.drive, 0);
});

test('hand_photo_put: a picture goes into my private 뉴스 사진 folder and comes back as the inside address', async () => {
  const w = world();
  const r = await out(await w.put());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {ok: true, file: FILE, src: SRC});
  assert.equal(w.calls.uploads.length, 1);
  assert.deepEqual(w.calls.uploads[0].parents, [FOLDER]);
  assert.match(w.calls.uploads[0].name, /^뉴스 사진 c0000000 2026-11-19 140000\.png$/);
  assert.deepEqual(P.ownPhotoOf(r.body.src), {id: FILE, type: 'image/png'});
  // 올린 사진 주소 줄은 손으로 넣기(hand_fill) 규칙에서 그대로 사진 블록이 된다(DB https 검사도 통과하는 모양).
  assert.equal(H.handPhotoSrc(r.body.src), r.body.src);
  assert.deepEqual(H.handBlocks(`첫 문단\n${r.body.src}\n사진: 합성 설명\n끝 문단`).map(b => b.t), ['p', 'img', 'p']);
});

test('hand_photo_put: kind (checked again from the first bytes), size and form shape are checked on the server', async () => {
  const w = world();
  assert.deepEqual(await out(await w.put({type: 'image/svg+xml', bytes: new TextEncoder().encode('<svg/>'), name: 'a.svg'})), {status: 415, body: {ok: false, error: 'PHOTO_TYPE'}});
  assert.deepEqual(await out(await w.put({type: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4'), name: 'a.pdf'})), {status: 415, body: {ok: false, error: 'PHOTO_TYPE'}});
  // 종류를 그림이라고 속인 다른 파일, 머리 바이트와 다른 종류.
  assert.deepEqual(await out(await w.put({type: 'image/png', bytes: new TextEncoder().encode('<html>not a png</html>')})), {status: 415, body: {ok: false, error: 'PHOTO_TYPE'}});
  assert.deepEqual(await out(await w.put({type: 'image/png', bytes: JPG})), {status: 415, body: {ok: false, error: 'PHOTO_TYPE'}});
  assert.equal((await w.put({type: 'image/jpeg', bytes: JPG, name: 'a.jpg'})).status, 200);
  // 10MB 넘는 사진: 몸통 길이로 읽기 전에, 길이를 속이면 파일 크기로.
  const huge = new Uint8Array(P.HAND_PHOTO_MAX_BYTES + 128 * 1024); huge.set(PNG);
  assert.deepEqual(await out(await w.put({bytes: huge})), {status: 413, body: {ok: false, error: 'BODY_TOO_LARGE'}});
  const justOver = new Uint8Array(P.HAND_PHOTO_MAX_BYTES + 1); justOver.set(PNG);
  assert.deepEqual(await out(await w.put({bytes: justOver})), {status: 413, body: {ok: false, error: 'PHOTO_TOO_LARGE'}});
  assert.deepEqual(await out(await w.put({bytes: justOver, length: 1000})), {status: 413, body: {ok: false, error: 'PHOTO_TOO_LARGE'}});
  assert.deepEqual(await out(await w.put({bytes: new Uint8Array(0)})), {status: 400, body: {ok: false, error: 'FILE_EMPTY'}});
  assert.deepEqual(await out(await w.put({extra: 'workspace_id'})), {status: 400, body: {ok: false, error: 'INVALID_BODY'}});
  assert.equal(w.calls.uploads.length, 1);
});

test('hand_photo_put: a shared folder, no Drive connection or no notes folder is refused without uploading', async () => {
  const shared = world({folderPerms: [{type: 'user', role: 'owner'}, {type: 'anyone', role: 'reader'}]});
  assert.deepEqual(await out(await shared.put()), {status: 409, body: {ok: false, error: 'DRIVE_FOLDER_SHARED'}});
  assert.equal(shared.calls.uploads.length, 0);
  const none = world({drive: false});
  assert.deepEqual(await out(await none.put()), {status: 424, body: {ok: false, error: 'DRIVE_NOT_CONNECTED'}});
  const noRoot = world({basket: null});
  assert.deepEqual(await out(await noRoot.put()), {status: 409, body: {ok: false, error: 'DRIVE_FOLDER_MISSING'}});
  assert.equal(noRoot.calls.uploads.length, 0);
});

test('hand_photo: only a photo in that article body, only through my own Drive connection', async () => {
  const w = world({blocks: [{t: 'p', text: '문단'}, {t: 'img', src: SRC, cap: null, alt: null}]});
  const r = await w.view({id: ART, file: FILE, size: 'small'});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.match(r.headers.get('cache-control'), /private/);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), PNG);
  // 본문에 없는 파일 id(내 Drive의 다른 파일)는 Drive를 보지 않고 404.
  const before = w.calls.metaFor.length;
  assert.deepEqual(await out(await w.view({id: ART, file: 'someOtherFile000001'})), {status: 404, body: {ok: false, error: 'PHOTO_NOT_FOUND'}});
  assert.equal(w.calls.metaFor.length, before);
  // 읽을 수 없는 기사, 로그인 없음, 운영자 아님, 모양이 다른 몸통.
  assert.equal((await w.view({id: HIDDEN, file: FILE})).status, 404);
  assert.equal((await w.view({id: ART, file: FILE}, null)).status, 401);
  assert.equal((await world({newsWs: OTHER, blocks: [{t: 'img', src: SRC}]}).view({id: ART, file: FILE})).status, 403);
  assert.equal((await w.view({id: ART, file: FILE, size: 'huge'})).status, 400);
  assert.equal((await w.view({id: ART, file: FILE, workspace_id: OTHER})).status, 400);
  // 바깥 주소 사진은 이 길로 받지 않는다(바깥 사이트에 요청하지 않음).
  const ext = world({blocks: [{t: 'img', src: 'https://news.example.org/a.png'}]});
  assert.equal((await ext.view({id: ART, file: FILE})).status, 404);
});

test('inside address shape: only the reserved host, Drive-id shape and the four kinds', () => {
  assert.equal(P.ownPhotoOf('https://photo.web2.invalid/abcdefghij12.webp')?.type, 'image/webp');
  for (const bad of ['http://photo.web2.invalid/abcdefghij12.png', 'https://photo.web2.invalid.example.org/abcdefghij12.png', 'https://photo.web2.invalid/abc.png',
    'https://photo.web2.invalid/abcdefghij12.svg', 'https://photo.web2.invalid/../abcdefghij12.png', 'https://photo.web2.invalid/abcdefghij12.png?x=1']) assert.equal(P.ownPhotoOf(bad), null, bad);
  assert.equal(P.sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(P.sniffImage(new TextEncoder().encode('GIF89a')), 'image/gif');
  assert.equal(P.sniffImage(new TextEncoder().encode('<svg')), '');
});
