// ED-통합편집기 ②: share-page photos in the browser. A photo is shrunk and drawn again here (long edge 1600px, JPEG, no EXIF:
// diary-data.js shrinkPhoto with redraw), then sent to the Edge function share-page-media, which keeps it in a private bucket
// and answers with "share:<id>". The editor shows it through a short signed address that only the signed-in owner can ask for.
// Nothing is kept in this browser: ids live in the saved page, addresses are asked for again when they run out.
import {shrinkPhoto} from './diary-data.js';

export const SHARE_PHOTO_EDGE = 1600;
export const SHARE_PHOTO_MAX = 40;
const FRESH_MS = 8 * 60 * 1000;
const PHOTO_ID = /^share:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const shareIdOf = src => { const m = PHOTO_ID.exec(String(src || '')); return m ? m[1] : null; };

const ERRORS = {
  401: '로그인이 필요해요. 다시 로그인한 뒤 올려 주세요.',
  404: '이 페이지를 찾을 수 없어요. 목록으로 나갔다가 다시 열어 주세요.',
  413: '사진이 너무 커요. 더 작은 사진으로 올려 주세요.',
  422: '이 사진은 올릴 수 없어요. 다른 사진으로 올려 주세요.',
};
const fail = (status, fallback = '사진을 올리지 못했어요. 잠시 뒤 다시 눌러 주세요.') => Object.assign(new Error(ERRORS[status] || fallback), {status});

// getPageId(): the saved page's id, or null before the first save. The page is saved once first (the photo belongs to a page).
export function createSharePhotos({rt = window.KPTURuntime, getPageId, fetcher = globalThis.fetch.bind(globalThis), shrink = shrinkPhoto, now = Date.now} = {}) {
  const cache = new Map(); // id -> {url, at}; memory only, never saved
  async function call(body, headers = {}) {
    if (!(await rt.session.ensure())) throw fail(401);
    const token = rt.session.read()?.access_token;
    if (!token) throw fail(401);
    let response;
    try {
      response = await fetcher(`${rt.config.url}/functions/v1/share-page-media`,
        {method: 'POST', headers: {apikey: rt.config.key, Authorization: 'Bearer ' + token, ...headers}, body});
    } catch { throw fail(0); }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok || !data || !data.ok) throw fail(response.status);
    return data;
  }
  async function add(file) {
    const pageId = getPageId();
    if (!pageId) throw new Error('사진은 페이지를 한 번 저장한 뒤 넣을 수 있어요. 먼저 [저장]을 눌러 주세요.');
    const jpeg = await shrink(file, {edge: SHARE_PHOTO_EDGE, quality: 0.86, redraw: true});
    const fd = new FormData();
    fd.set('page_id', pageId);
    fd.set('image', jpeg, 'photo.jpg');
    const data = await call(fd);
    return {src: data.src};
  }
  // Fresh addresses for the given photo ids (one request for the ones that are missing or old).
  async function urls(ids) {
    const pageId = getPageId();
    const want = [...new Set(ids)].filter(id => { const c = cache.get(id); return !c || now() - c.at > FRESH_MS; });
    if (want.length && pageId) {
      const data = await call(JSON.stringify({action: 'sign', page_id: pageId, ids: want.slice(0, 60)}), {'Content-Type': 'application/json'});
      for (const id of want) if (data.urls && typeof data.urls[id] === 'string') cache.set(id, {url: data.urls[id], at: now()});
    }
    const out = {};
    for (const id of ids) { const c = cache.get(id); if (c) out[id] = c.url; }
    return out;
  }
  // One address for a "share:<id>" src, asking together with the others asked in the same moment.
  let queue = null;
  function url(src) {
    const id = shareIdOf(src);
    if (!id) return Promise.resolve(null);
    if (!queue) {
      queue = {ids: new Set(), done: null};
      const q = queue;
      q.done = Promise.resolve().then(() => { if (queue === q) queue = null; return urls([...q.ids]); });
    }
    queue.ids.add(id);
    return queue.done.then(map => map[id] || null);
  }
  return {add, url, urls};
}
